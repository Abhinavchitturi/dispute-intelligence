"""Who works which case. The manager hands cases out; an investigator with none can ask for more."""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, CaseCollaborator, CaseRequest, ManagerAlert, User
from backend.app.services.audit_service import AuditService
from backend.app.services.high_profile import high_profile_filter
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


def settle_requests(db: Session, user: User, manager: str, given: int) -> None:
    """Cases arrived for someone who had asked: close their request, and the alert that went with it."""
    for r in db.query(CaseRequest).filter(CaseRequest.user_id == user.id, CaseRequest.status == "OPEN").all():
        r.status, r.resolved_by, r.resolved_at, r.cases_given = "FULFILLED", manager, datetime.utcnow(), given
        for a in db.query(ManagerAlert).filter(ManagerAlert.kind == "REQUEST", ManagerAlert.user_id == user.id, ManagerAlert.status == "OPEN").all():
            a.status, a.sorted_by, a.sorted_at, a.sorted_note = "SORTED", manager, datetime.utcnow(), f"{given} case{'s' if given != 1 else ''} assigned"


def distribute(db: Session, manager: str, investigator_ids: Optional[List[str]], per_person: Optional[int], include_high_profile: bool) -> Dict:
    """Hands out the open cases nobody owns. Highest priority first, always to whoever has the fewest cases, so everyone ends up level.
    With `per_person`, nobody gets more than that many new cases."""
    people = [u for u in workable_investigators(db) if not investigator_ids or u.id in investigator_ids]
    if not people:
        return {"assigned": {}, "total": 0, "left_unassigned": 0, "people": 0}
    q = db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None))
    if not include_high_profile:
        q = q.filter(~high_profile_filter())  # those are the manager's
    cases = q.order_by(Dispute.priority_score.desc(), Dispute.id).all()

    load = {u.id: open_cases(db, u.display_name) for u in people}
    given: Dict[str, int] = {u.id: 0 for u in people}
    left = 0
    for case in cases:
        eligible = [u for u in people if per_person is None or given[u.id] < per_person]
        if not eligible:
            left += 1
            continue
        pick = min(eligible, key=lambda u: (load[u.id], u.display_name))
        assign_one(db, case, pick, manager)
        load[pick.id] += 1
        given[pick.id] += 1

    result = {}
    for u in people:
        n = given[u.id]
        if n:
            StrikeService.notify(db, u.id, "ASSIGNED", f"You have {n} new case{'s' if n != 1 else ''}", f"{manager} assigned you {n} case{'s' if n != 1 else ''}. They are in Your cases.")
            settle_requests(db, u, manager, n)
        result[u.display_name] = n
    db.commit()
    return {"assigned": result, "total": sum(given.values()), "left_unassigned": left, "people": len(people)}


def distribute_counts(db: Session, manager: str, counts: Dict[str, int], include_high_profile: bool) -> Dict:
    """Gives each person exactly the number of cases the manager chose. The most urgent cases go out first."""
    people = {u.id: u for u in workable_investigators(db)}
    unknown = [i for i, n in counts.items() if n and i not in people]
    if unknown:
        raise ValueError("One of those people can't be given cases right now.")
    quota = {i: n for i, n in counts.items() if n > 0}
    q = db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None))
    if not include_high_profile:
        q = q.filter(~high_profile_filter())
    cases = q.order_by(Dispute.priority_score.desc(), Dispute.id).all()
    if sum(quota.values()) > len(cases):
        raise ValueError(f"That is {sum(quota.values())} cases but only {len(cases)} {'is' if len(cases) == 1 else 'are'} waiting.")
    load = {i: open_cases(db, people[i].display_name) for i in quota}
    given = {i: 0 for i in quota}
    for case in cases:
        left = [i for i in quota if given[i] < quota[i]]
        if not left:
            break
        # Whoever still has the most to receive goes next, so the urgent cases are shared in proportion to the numbers chosen.
        pick = max(left, key=lambda i: (quota[i] - given[i], -load[i], people[i].display_name))
        assign_one(db, case, people[pick], manager)
        given[pick] += 1
        load[pick] += 1
    result = {}
    for i, n in given.items():
        if n:
            u = people[i]
            StrikeService.notify(db, u.id, "ASSIGNED", f"You have {n} new case{'s' if n != 1 else ''}", f"{manager} assigned you {n} case{'s' if n != 1 else ''}. They are in Your cases.")
            settle_requests(db, u, manager, n)
        result[people[i].display_name] = n
    db.commit()
    return {"assigned": result, "total": sum(given.values()), "left_unassigned": len(cases) - sum(given.values()), "people": len(quota)}


def request_cases(db: Session, user: User, note: Optional[str]) -> CaseRequest:
    if user.role != INVESTIGATOR:
        raise ValueError("Only investigators ask for cases.")
    still = open_cases(db, user.display_name)
    if still:
        raise ValueError(f"You still have {still} open case{'s' if still != 1 else ''}. You can ask for more once you have none.")
    if db.query(CaseRequest).filter(CaseRequest.user_id == user.id, CaseRequest.status == "OPEN").first():
        raise ValueError("You have already asked. Your manager has been alerted.")
    req = CaseRequest(id=f"REQ-{uuid.uuid4().hex[:10]}", user_id=user.id, note=(note or "").strip() or None)
    db.add(req)
    StrikeService.open_alert(db, "REQUEST", f"{user.display_name} has no cases", f"{user.display_name} has finished their cases and is asking for more.{' They said: ' + req.note if req.note else ''}", user_id=user.id)
    AuditService.record_event(db=db, actor=user.display_name, action="CASES_REQUESTED", status="SUCCESS", source="synthetic", result_summary=f"{user.display_name} has no open cases and asked for more.")
    db.commit()
    return req
