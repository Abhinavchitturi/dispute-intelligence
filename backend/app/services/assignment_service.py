"""Who works which case. Every new case goes straight to the investigator with the fewest open cases."""
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, CaseCollaborator, User
from backend.app.services.audit_service import AuditService
from backend.app.services.high_profile import is_high_profile
from backend.app.services.message_service import OPEN_STATUSES
from backend.app.services.strike_service import StrikeService


def open_cases(db: Session, name: str) -> int:
    """Open cases someone is working: the ones they own, plus the ones another investigator has shared with them."""
    owned = db.query(Dispute).filter(Dispute.assigned_to == name, Dispute.status.in_(OPEN_STATUSES)).count()
    who = db.query(User).filter(User.display_name == name).first()
    shared = 0
    if who:
        shared = (db.query(Dispute).join(CaseCollaborator, CaseCollaborator.dispute_id == Dispute.id)
                  .filter(CaseCollaborator.user_id == who.id, Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to != name).count())
    return owned + shared


def workable_investigators(db: Session) -> List[User]:
    """Investigators who can be given cases: signed-in-able and not blocked."""
    return [u for u in db.query(User).filter(User.role == INVESTIGATOR).order_by(User.display_name).all() if u.is_active is not False and not u.is_blocked]


def assign_one(db: Session, dispute: Dispute, assignee: Optional[User], by: str) -> None:
    dispute.assigned_to = assignee.display_name if assignee else None
    if assignee:  # they own it now, so they are no longer just helping on it
        db.query(CaseCollaborator).filter(CaseCollaborator.dispute_id == dispute.id, CaseCollaborator.user_id == assignee.id).delete()
    if dispute.ai_owned:
        dispute.ai_owned, dispute.ai_owned_at = False, None  # taken back from the AI Agent
    AuditService.record_event(
        db=db, dispute_id=dispute.id, actor=by, action="CASE_ASSIGNED" if assignee else "CASE_RELEASED", status="SUCCESS", source=dispute.source,
        result_summary=f"{by} assigned the case to {assignee.display_name}." if assignee else f"{by} took the case off its owner. It is unassigned.",
    )


def pick_investigator(db: Session) -> Optional[User]:
    """Who gets the next case: the investigator with the fewest open cases. Ties go to whoever has had fewer cases overall,
    then alphabetically, so cases spread evenly and the choice is predictable."""
    people = workable_investigators(db)
    if not people:
        return None
    total = {u.display_name: db.query(Dispute).filter(Dispute.assigned_to == u.display_name).count() for u in people}
    return min(people, key=lambda u: (open_cases(db, u.display_name), total[u.display_name], u.display_name))


def auto_assign(db: Session, disputes: Optional[List[Dispute]] = None) -> int:
    """Gives every unassigned open case (or just the ones passed in) to the least-busy investigator, the moment it arrives.
    Nobody hands cases out by hand. High-profile cases (HIGH_PROFILE_AMOUNT and up) are left for the manager, who takes
    those on personally. Returns how many were assigned."""
    if disputes is None:
        disputes = (db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None), Dispute.ai_owned.isnot(True))
                    .order_by(Dispute.priority_score.desc()).all())
    n = 0
    for d in disputes:
        if d.assigned_to or d.ai_owned or d.status not in OPEN_STATUSES or is_high_profile(d):
            continue
        who = pick_investigator(db)
        if who is None:
            break   # nobody can take cases right now (all blocked or inactive); the next round tries again
        load = open_cases(db, who.display_name)
        d.assigned_to = who.display_name
        db.flush()
        AuditService.record_event(
            db=db, dispute_id=d.id, actor="system", action="AUTO_ASSIGNED", status="SUCCESS", source=d.source,
            result_summary=f"Assigned to {who.display_name} automatically: they had the fewest open cases ({load}).",
        )
        StrikeService.notify(db, who.id, "ASSIGNED", f"New case: {d.id}",
                             f"{d.id} ({d.currency} {d.amount:,.2f}) was assigned to you automatically.", d.id)
        n += 1
    if n:
        db.commit()
    return n
