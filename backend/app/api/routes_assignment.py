"""People and case sharing. Cases are assigned automatically (assignment_service.auto_assign); nobody hands them out by hand."""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, MANAGER, CaseCollaborator, User
from backend.app.services import assignment_service as svc
from backend.app.services.auth_service import actor_name, case_scope, case_user, current_user, manager_user
from backend.app.services.access import can_access
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED
from backend.app.services.strike_service import StrikeService

router = APIRouter(tags=["Assignment"], dependencies=[Depends(case_scope)])


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
