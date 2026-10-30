"""The 5-day clock on every case.

Each case has a deadline. As it nears, the priority score climbs, so an unassigned case that is running out of time rises to the top
of the manager's screen. A case nobody has taken by its deadline goes to the AI Agent, which handles the whole case, and the manager is told.
"""
import json
import time
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import OPEN_STATUSES
from backend.app.services.priority_service import calculate_priority_score
from backend.app.services.strike_service import StrikeService

_last_run = 0.0


def refresh_scores(db: Session, now: Optional[datetime] = None) -> int:
    """Re-scores every open case against the clock, so the stored score is never stale."""
    n = 0
    for d in db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES)).all():
        ship = d.order.shipment if d.order else None
        score, factors = calculate_priority_score(
            amount=d.amount, response_due_date=d.response_due_date, evidence_status=d.evidence_status or "PENDING",
            delivery_address_match=ship.delivery_address_match if ship else "unknown", shipment_status=ship.status if ship else None, reason=d.reason,
        )
        if score != d.priority_score:
            d.priority_score = score
            d.priority_factors_json = json.dumps([f.model_dump() for f in factors])
            n += 1
    return n


def hand_over_to_ai(db: Session, now: Optional[datetime] = None) -> int:
    """Every open case that nobody took, and whose deadline has passed, goes to the AI Agent. Each one raises an alert for the manager."""
    now = now or datetime.utcnow()
    taken = 0
    q = db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None), Dispute.response_due_date.isnot(None), Dispute.response_due_date <= now)
    for d in q.all():
        d.assigned_to, d.ai_owned, d.ai_owned_at = settings.AI_AGENT_NAME, True, now
        AuditService.record_event(
            db=db, dispute_id=d.id, actor="system", action="HANDED_TO_AI", status="SUCCESS", source=d.source,
            result_summary=f"Nobody took this case in its {settings.CASE_WINDOW_DAYS} days, so the {settings.AI_AGENT_NAME} is handling the whole case.",
        )
        StrikeService.open_alert(
            db, "AI_TAKEOVER", f"{settings.AI_AGENT_NAME} took {d.id}",
            f"Nobody took {d.id} ({d.currency} {d.amount:,.2f}) in its {settings.CASE_WINDOW_DAYS} days. The {settings.AI_AGENT_NAME} is now handling the whole case. You can give it to someone yourself, or overturn the AI Agent's decision.",
            dispute_id=d.id,
        )
        taken += 1
    return taken


def tick(db: Session, now: Optional[datetime] = None) -> dict:
    scored = refresh_scores(db, now)
    taken = hand_over_to_ai(db, now)
    db.commit()
    return {"rescored": scored, "handed_to_ai": taken}


def tick_if_due(db: Session, every_seconds: float = 30.0) -> None:
    """Called when someone looks at the cases, so what they see is current even between the timer's runs."""
    global _last_run
    if time.monotonic() - _last_run >= every_seconds:
        _last_run = time.monotonic()
        tick(db)


def reset_throttle() -> None:
    global _last_run
    _last_run = 0.0
