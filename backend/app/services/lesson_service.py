"""What the AI learns from a correction.

A correction becomes a lesson: for this kind of dispute, with this evidence on file and this item not holding up, the right ruling is X and not Y.
The built-in reviewer checks new cases against its lessons before ruling. A case that matches follows the lesson, and says so.
It is a plain comparison, on purpose: a manager can read exactly what was learned and when it was used.
"""
import json
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.team import AILesson
from backend.app.services import evidence_summary
from backend.app.services.evidence_summary import build


def shape(dispute: Dispute) -> Dict[str, List[str]]:
    """What a case looks like to the AI: the evidence on file, and which of it is doubtful."""
    ev = build(dispute)
    provided = sorted({i["evidence_type"] for side in ("seller", "buyer", "records") for i in ev[side] if i["status"] == "PROVIDED"})
    doubtful = sorted({i["evidence_type"] for side in ("seller", "buyer", "records") for i in ev[side] if i["status"] == "PROVIDED" and i.get("concern")})
    return {"evidence_types": provided, "doubtful_types": doubtful}


def _label(t: str) -> str:
    from backend.app.services import evidence_catalog as cat
    return cat.label(t)


def _summary(dispute: Dispute, sh: Dict[str, List[str]], right: str, wrong: str, note: str) -> str:
    kind = (dispute.reason or "").replace("MERCHANDISE_OR_SERVICE_", "").replace("_", " ").lower()
    side = lambda o: "the buyer" if o == "BUYER_FAVOR" else "the seller"
    if sh["doubtful_types"]:
        bad = " and ".join(_label(t).lower() for t in sh["doubtful_types"])
        return (f"In \"{kind}\" disputes, the {bad} can be on file and still not count when it doesn't hold up (as in {dispute.id}). "
                f"With the same evidence, rule for {side(right)}, not {side(wrong)}.")
    have = ", ".join(_label(t).lower() for t in sh["evidence_types"]) or "no evidence"
    return f"In \"{kind}\" disputes with exactly this on file ({have}), rule for {side(right)}, not {side(wrong)}, as {dispute.id} showed."


def record(db: Session, dispute: Dispute, review_id: str, wrong: str, right: str, note: str, taught_by: str) -> AILesson:
    sh = shape(dispute)
    lesson = AILesson(
        id=f"LSN-{uuid.uuid4().hex[:8]}", review_id=review_id, dispute_id=dispute.id, reason=dispute.reason or "", evidence_types=json.dumps(sh["evidence_types"]),
        doubtful_types=json.dumps(sh["doubtful_types"]), wrong_outcome=wrong, correct_outcome=right, summary=_summary(dispute, sh, right, wrong, note), taught_by=taught_by,
        applied_to=json.dumps([]),
    )
    db.add(lesson)
    return lesson


def match(db: Optional[Session], dispute: Dispute) -> Optional[AILesson]:
    """A lesson that fits this case exactly: same kind of dispute, same evidence on file, same items not holding up."""
    if db is None:
        return None
    sh = shape(dispute)
    for lesson in db.query(AILesson).filter(AILesson.active.is_(True), AILesson.reason == (dispute.reason or "")).order_by(AILesson.created_at.desc()).all():
        if lesson.dispute_id == dispute.id:
            continue
        if json.loads(lesson.evidence_types) == sh["evidence_types"] and json.loads(lesson.doubtful_types) == sh["doubtful_types"]:
            return lesson
    return None


def applied(db: Session, lesson_id: str, dispute_id: str) -> None:
    lesson = db.get(AILesson, lesson_id)
    if not lesson:
        return
    used = json.loads(lesson.applied_to or "[]")
    if dispute_id not in used:
        used.append(dispute_id)
        lesson.applied_to = json.dumps(used)
        lesson.times_applied = len(used)
        db.commit()


def for_review(db: Session, review_id: str) -> Optional[AILesson]:
    return db.query(AILesson).filter(AILesson.review_id == review_id).first()
