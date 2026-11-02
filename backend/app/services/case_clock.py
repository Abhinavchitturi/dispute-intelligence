"""The clock on every case.

A new complaint goes to the manager, who has a day to assign it, and less if the deadline is close. If they don't, it is given to an investigator at random.
Cases never go to the AI Agent for want of an owner: a person always ends up with them.

Each case has a deadline. As it nears, the priority score climbs, so an unassigned case that is running out of time rises to the top
of the manager's screen.
"""
import json
import random
import time
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, User
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


def auto_assign_stale(db: Session, now: Optional[datetime] = None) -> int:
    """A case the manager hasn't assigned within the window goes to a randomly chosen investigator, and both are told."""
    now = now or datetime.utcnow()
    people = db.query(User).filter(User.role == INVESTIGATOR, User.is_active.is_(True), User.is_blocked.is_(False)).all()
    if not people:
        return 0
    cutoff = now - timedelta(days=settings.AUTO_ASSIGN_AFTER_DAYS)
    squeezed = now + timedelta(days=settings.AUTO_ASSIGN_WHEN_DAYS_LEFT)
    # The manager's time comes out of the investigator's. So a case goes out after its day, or at once if little time is left.
    q = db.query(Dispute).filter(
        Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None),
        or_(and_(Dispute.created_at.isnot(None), Dispute.created_at <= cutoff), and_(Dispute.response_due_date.isnot(None), Dispute.response_due_date <= squeezed)),
    )
    n = 0
    for d in q.all():
        who = random.choice(people)
        d.assigned_to = who.display_name
        AuditService.record_event(
            db=db, dispute_id=d.id, actor="system", action="AUTO_ASSIGNED", status="SUCCESS", source=d.source,
            result_summary=f"The manager didn't assign this case in time, so it was given to {who.display_name} at random.",
        )
        StrikeService.notify(db, who.id, "ASSIGNED", f"New case: {d.id}", f"{d.id} ({d.currency} {d.amount:,.2f}) was assigned to you automatically, because it wasn't assigned in time and the deadline is getting close.", d.id)
        for m in StrikeService.managers(db):
            StrikeService.notify(db, m.id, "AUTO_ASSIGNED", f"{d.id} was assigned to {who.display_name}", f"You didn't assign {d.id} in time, so it went to {who.display_name} at random.", d.id)
        n += 1
    return n


def tick(db: Session, now: Optional[datetime] = None) -> dict:
    scored = refresh_scores(db, now)
    assigned = auto_assign_stale(db, now)
    db.commit()
    return {"rescored": scored, "auto_assigned": assigned}


def tick_if_due(db: Session, every_seconds: float = 30.0) -> None:
    """Called when someone looks at the cases, so what they see is current even between the timer's runs."""
    global _last_run
    if time.monotonic() - _last_run >= every_seconds:
        _last_run = time.monotonic()
        tick(db)


def reset_throttle() -> None:
    global _last_run
    _last_run = 0.0
