"""The manager hands out cases. An investigator with none can ask."""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, MANAGER, CaseCollaborator, CaseRequest, ManagerAlert, User
from backend.app.services import assignment_service as svc
from backend.app.services.auth_service import actor_name, case_scope, case_user, current_user, manager_user
from backend.app.services.access import can_access
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED
from backend.app.services.strike_service import StrikeService

router = APIRouter(tags=["Assignment"], dependencies=[Depends(case_scope)])


class Distribute(BaseModel):
    investigator_ids: Optional[List[str]] = None   # none means every investigator who can take cases
    per_person: Optional[int] = None               # none means share them out evenly
    counts: Optional[Dict[str, int]] = None        # exactly this many cases for each person (by user id). Overrides the two above.
    include_high_profile: bool = False


@router.get("/cases/distribution")
def preview(db: Session = Depends(get_db), user: Optional[User] = Depends(manager_user)):
    """What is waiting to be handed out, and how loaded each person is now. Drives the Distribute dialog."""
    from backend.app.services.high_profile import high_profile_filter
    from backend.app.services.message_service import OPEN_STATUSES
    base = db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None))
    return {
        "unassigned": base.filter(~high_profile_filter()).count(),
        "unassigned_high_profile": base.filter(high_profile_filter()).count(),
        "people": [{"id": u.id, "name": u.display_name, "open_cases": svc.open_cases(db, u.display_name),
                    "requested": bool(db.query(CaseRequest).filter(CaseRequest.user_id == u.id, CaseRequest.status == "OPEN").first())}
                   for u in svc.workable_investigators(db)],
    }


@router.post("/cases/distribute")
def distribute(request: Distribute, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    if request.per_person is not None and request.per_person < 1:
        raise HTTPException(status_code=400, detail="Give each person at least one case, or leave it blank to share evenly.")
    if request.counts is not None:
        if any(n < 0 for n in request.counts.values()):
            raise HTTPException(status_code=400, detail="A person can't be given fewer than none.")
        try:
            return svc.distribute_counts(db, actor_name(user, "manager"), request.counts, request.include_high_profile)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return svc.distribute(db, actor_name(user, "manager"), request.investigator_ids, request.per_person, request.include_high_profile)


class BulkAssign(BaseModel):
    dispute_ids: List[str]
    assignee_id: Optional[str] = None   # none releases them


@router.post("/cases/assign")
def bulk_assign(request: BulkAssign, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """Hand specific cases to one person."""
    who = actor_name(user, "manager")
    target = db.get(User, request.assignee_id) if request.assignee_id else None
    if request.assignee_id and (target is None or target.is_active is False):
        raise HTTPException(status_code=400, detail="That person can't be given cases.")
    if target and target.is_blocked:
        raise HTTPException(status_code=400, detail=f"{target.display_name} is blocked. Unblock them first.")
    n = 0
    for d in db.query(Dispute).filter(Dispute.id.in_(request.dispute_ids)).all():
        if d.status in CLOSED:
            continue
        svc.assign_one(db, d, target, who)
        n += 1
    if target and n:
        StrikeService.notify(db, target.id, "ASSIGNED", f"You have {n} new case{'s' if n != 1 else ''}", f"{who} assigned you {n} case{'s' if n != 1 else ''}.")
        svc.settle_requests(db, target, who, n)
    db.commit()
    return {"assigned": n}


# ---------- asking for cases ----------
class AskForCases(BaseModel):
    note: Optional[str] = None


def _req(db: Session, r: CaseRequest) -> dict:
    u = db.get(User, r.user_id)
    return {"id": r.id, "user_id": r.user_id, "name": u.display_name if u else r.user_id, "note": r.note, "status": r.status, "created_at": r.created_at,
            "resolved_by": r.resolved_by, "resolved_at": r.resolved_at, "resolution_note": r.resolution_note, "cases_given": r.cases_given}


@router.post("/case-requests")
def ask(request: AskForCases, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        return _req(db, svc.request_cases(db, user, request.note))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/case-requests")
def list_requests(status: Optional[str] = None, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    q = db.query(CaseRequest)
    if status:
        q = q.filter(CaseRequest.status == status.upper())
    if user and user.role == INVESTIGATOR:
        q = q.filter(CaseRequest.user_id == user.id)
    return [_req(db, r) for r in q.order_by(CaseRequest.created_at.desc()).limit(50).all()]


class Decline(BaseModel):
    note: str


@router.post("/case-requests/{request_id}/decline")
def decline(request_id: str, body: Decline, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    r = db.get(CaseRequest, request_id)
    if not r:
        raise HTTPException(status_code=404, detail="Request not found.")
    if r.status != "OPEN":
        raise HTTPException(status_code=400, detail="This request has already been dealt with.")
    note = body.note.strip()
    if len(note) < 5:
        raise HTTPException(status_code=400, detail="Say why, so they know what to do next.")
    who = actor_name(user, "manager")
    r.status, r.resolved_by, r.resolved_at, r.resolution_note = "DECLINED", who, datetime.utcnow(), note
    for a in db.query(ManagerAlert).filter(ManagerAlert.kind == "REQUEST", ManagerAlert.user_id == r.user_id, ManagerAlert.status == "OPEN").all():
        a.status, a.sorted_by, a.sorted_at, a.sorted_note = "SORTED", who, datetime.utcnow(), "Request declined"
    StrikeService.notify(db, r.user_id, "REQUEST", "No new cases for now", f"{who}: {note}")
    db.commit()
    return _req(db, r)


# ---------- sharing a case: more than one investigator on it ----------
@router.get("/people")
def people(user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)):
    """Investigators who can be asked to help on a case. Anyone signed in can see the names."""
    return [{"id": u.id, "name": u.display_name} for u in svc.workable_investigators(db)]


def _collab(db: Session, c: CaseCollaborator) -> dict:
    u = db.get(User, c.user_id)
    return {"id": c.id, "user_id": c.user_id, "name": u.display_name if u else c.user_id, "added_by": c.added_by, "created_at": c.created_at}


@router.get("/disputes/{dispute_id}/collaborators")
def list_collaborators(dispute_id: str, db: Session = Depends(get_db)):
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    return {"owner": d.assigned_to, "collaborators": [_collab(db, c) for c in db.query(CaseCollaborator).filter(CaseCollaborator.dispute_id == d.id).order_by(CaseCollaborator.created_at).all()]}


class Share(BaseModel):
    user_id: str


@router.post("/disputes/{dispute_id}/collaborators")
def share_case(dispute_id: str, request: Share, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """Another investigator joins the case. The manager can add anyone; an investigator already on the case can bring a colleague in."""
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    if d.status in CLOSED:
        raise HTTPException(status_code=400, detail="This case is closed.")
    target = db.get(User, request.user_id)
    if not target or target.role != INVESTIGATOR or target.is_active is False:
        raise HTTPException(status_code=400, detail="That person can't be added to a case.")
    if target.is_blocked:
        raise HTTPException(status_code=400, detail=f"{target.display_name} is blocked.")
    if d.assigned_to == target.display_name:
        raise HTTPException(status_code=400, detail=f"{target.display_name} already owns this case.")
    if db.query(CaseCollaborator).filter(CaseCollaborator.dispute_id == d.id, CaseCollaborator.user_id == target.id).first():
        raise HTTPException(status_code=400, detail=f"{target.display_name} is already on this case.")
    by = actor_name(user, "manager")
    c = CaseCollaborator(id=f"COL-{uuid.uuid4().hex[:10]}", dispute_id=d.id, user_id=target.id, added_by=by)
    db.add(c)
    StrikeService.notify(db, target.id, "SHARED", f"{by} added you to {d.id}", f"You are now working on {d.id} with {d.assigned_to or 'the team'}. It is in Your cases.", d.id)
    AuditService.record_event(db=db, dispute_id=d.id, actor=by, action="CASE_SHARED", status="SUCCESS", source=d.source, result_summary=f"{by} added {target.display_name} to the case.")
    db.commit()
    return _collab(db, c)


@router.delete("/disputes/{dispute_id}/collaborators/{user_id}")
def unshare_case(dispute_id: str, user_id: str, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """Takes someone off the case. The manager, the owner, or the person themselves (leaving) can do it."""
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    c = db.query(CaseCollaborator).filter(CaseCollaborator.dispute_id == dispute_id, CaseCollaborator.user_id == user_id).first()
    if not d or not c:
        raise HTTPException(status_code=404, detail="That person isn't on this case.")
    if user and user.role != MANAGER and user.id != user_id and d.assigned_to != user.display_name:
        raise HTTPException(status_code=403, detail="Only the manager, the case owner, or the person themselves can take someone off a case.")
    who = db.get(User, user_id)
    by = actor_name(user, "manager")
    db.delete(c)
    AuditService.record_event(db=db, dispute_id=d.id, actor=by, action="CASE_UNSHARED", status="SUCCESS", source=d.source,
                              result_summary=f"{who.display_name if who else user_id} was taken off the case{' (they left)' if user and user.id == user_id else ''}.")
    db.commit()
    return {"success": True}
