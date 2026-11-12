"""The AI reviewer, working by itself: a decision gets its ruling the moment the investigator sends it.

It uses the same analysis as the investigator's own "AI Review" check, so what it rules is what that check already showed.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.services import lesson_service
from backend.app.services.ai_service import AIService
from backend.app.services.decision_service import DecisionError, DecisionService
from backend.app.services.draft_service import DraftService
from backend.app.services.message_service import PENDING_REVIEW

logger = logging.getLogger(__name__)
SIDE = {"FULFILL_BUYER": "BUYER_FAVOR", "FULFILL_SELLER": "SELLER_FAVOR"}


async def review_one(db: Session, d: Dispute) -> bool:
    """Rules on one decision straight away. Returns True if the AI ruled."""
    if d.status != PENDING_REVIEW or d.ai_owned or not d.proposed_outcome:
        return False
    try:
        a = await AIService.review_decision(d, d.proposed_outcome, d.proposed_reason or "")
        if a.ai_decision == "DISMISS_NO_RESPONSE":
            return False   # that is a dismissal, not a ruling on a side: left for a manager or the investigator to deal with
        final = SIDE.get(a.ai_decision)
        overturn = final is not None and final != d.proposed_outcome
        verdict = "OVERTURN" if overturn else "APPROVE"
        rationale = (a.reasoning or a.explanation or "").strip() or "Reviewed the evidence on file."
        if verdict == "APPROVE" and final is None:
            rationale = f"The AI found no stronger case for the other side, so the investigator's decision stands. {rationale}"
        action = "DECIDE_FOR_BUYER" if (final if overturn else d.proposed_outcome) == "BUYER_FAVOR" else "DECIDE_FOR_SELLER"
        draft = await DraftService.generate(d, action, None, None)
        body = f"{draft.body}\n\nREVIEW\n- {rationale}"
        sandbox = settings.RESOLVEIQ_MODE == "sandbox" and d.source == "paypal_sandbox"
        DecisionService.ai_verdict(db, d, verdict, final if overturn else None, rationale, a.model, draft.subject, body, sandbox, assessment=a.model_dump())
        if a.lesson_id:
            lesson_service.applied(db, a.lesson_id, d.id)
        return True
    except DecisionError:
        logger.exception("AI review of %s was refused", d.id)
        db.rollback()
    except Exception:
        logger.exception("AI review of %s failed", d.id)
        db.rollback()
    return False


async def review_pending(db: Session, now: Optional[datetime] = None) -> int:
    """A safety net for decisions that were not ruled on when they were sent. Rules on every one that has waited long enough."""
    now = now or datetime.utcnow()
    cutoff = now - timedelta(seconds=settings.AI_REVIEW_DELAY_SECONDS)
    ruled = 0
    for d in db.query(Dispute).filter(Dispute.status == PENDING_REVIEW, Dispute.proposed_at.isnot(None), Dispute.proposed_at <= cutoff).all():
        if await review_one(db, d):
            ruled += 1
    return ruled
