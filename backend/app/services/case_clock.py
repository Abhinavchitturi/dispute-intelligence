"""The clock on every case.

A new complaint is assigned at once to the investigator with the fewest open cases. Nobody hands cases out by hand.
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
    """Any open case without an owner goes to the least-busy investigator straight away. (New cases are assigned the moment
    they arrive; this catches the rest, such as cases waiting while every investigator was blocked.)"""
    from backend.app.services.assignment_service import auto_assign
    return auto_assign(db)


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
