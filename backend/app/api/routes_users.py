"""A manager managing everyone who can sign in."""
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, MANAGER, User
from backend.app.services.audit_service import AuditService
from backend.app.services.auth_service import actor_name, hash_password, manager_user
from backend.app.services.strike_service import StrikeService

router = APIRouter(tags=["Users"], dependencies=[Depends(manager_user)])
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
MIN_PASSWORD = 8


def _out(db: Session, u: User) -> dict:
    return {"id": u.id, "username": u.username, "name": u.display_name, "email": u.email, "role": u.role, "is_active": u.is_active is not False,
            "is_blocked": bool(u.is_blocked), "blocked_reason": u.blocked_reason, "created_at": u.created_at,
            "strikes": StrikeService.active_strikes(db, u.id) if u.role == INVESTIGATOR else 0,
            "open_cases": db.query(Dispute).filter(Dispute.assigned_to == u.display_name, Dispute.status.notin_(["RESOLVED", "CLOSED"])).count()}


def _get(db: Session, user_id: str) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found.")
    return u


def _audit(db: Session, who: str, action: str, text: str) -> None:
    AuditService.record_event(db=db, actor=who, action=action, status="SUCCESS", source="synthetic", result_summary=text)


def _other_active_managers(db: Session, exclude: User) -> int:
    return db.query(User).filter(User.role == MANAGER, User.is_active.isnot(False), User.id != exclude.id).count()


@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    return [_out(db, u) for u in db.query(User).order_by(User.role.desc(), User.display_name).all()]


class NewUser(BaseModel):
    username: str
    display_name: str
    role: str
    password: str
    email: Optional[str] = None


@router.post("/users")
def create_user(request: NewUser, me: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    username = request.username.strip().lower()
    if not USERNAME.match(username):
        raise HTTPException(status_code=400, detail="Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="That username is taken.")
    if request.role not in (INVESTIGATOR, MANAGER):
        raise HTTPException(status_code=400, detail="Role must be INVESTIGATOR or MANAGER.")
    if not request.display_name.strip():
        raise HTTPException(status_code=400, detail="Give them a name.")
    if db.query(User).filter(User.display_name == request.display_name.strip()).first():
        raise HTTPException(status_code=400, detail="Someone already has that name. Cases are assigned by name, so names must be different.")
    if len(request.password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Passwords need at least {MIN_PASSWORD} characters.")
    u = User(id=f"USR-{uuid.uuid4().hex[:8]}", username=username, display_name=request.display_name.strip(), email=(request.email or "").strip() or None,
             role=request.role, password_hash=hash_password(request.password))
    db.add(u)
    _audit(db, actor_name(me, "manager"), "USER_CREATED", f"Created the {request.role.lower()} account {username} ({u.display_name}).")
    db.commit()
    return _out(db, u)


class UserChanges(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/users/{user_id}")
def update_user(user_id: str, request: UserChanges, me: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    who = actor_name(me, "manager")
    if request.display_name is not None and request.display_name.strip() != u.display_name:
        name = request.display_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Give them a name.")
        if db.query(User).filter(User.display_name == name, User.id != u.id).first():
            raise HTTPException(status_code=400, detail="Someone already has that name.")
        # Cases are tied to a person by name, so their cases move with the rename.
        db.query(Dispute).filter(Dispute.assigned_to == u.display_name).update({"assigned_to": name})
        db.query(Dispute).filter(Dispute.proposed_by == u.display_name).update({"proposed_by": name})
        _audit(db, who, "USER_RENAMED", f"Renamed {u.display_name} to {name}.")
        u.display_name = name
    if request.email is not None:
        u.email = request.email.strip() or None
    if request.role is not None and request.role != u.role:
        if request.role not in (INVESTIGATOR, MANAGER):
            raise HTTPException(status_code=400, detail="Role must be INVESTIGATOR or MANAGER.")
        if u.role == MANAGER and _other_active_managers(db, u) == 0:
            raise HTTPException(status_code=400, detail="There must always be at least one manager.")
        if me and me.id == u.id:
            raise HTTPException(status_code=400, detail="You can't change your own role.")
        _audit(db, who, "USER_ROLE_CHANGED", f"{u.display_name} is now a {request.role.lower()}.")
        u.role = request.role
    if request.is_active is not None and request.is_active != (u.is_active is not False):
        if not request.is_active:
            if me and me.id == u.id:
                raise HTTPException(status_code=400, detail="You can't deactivate your own account.")
            if u.role == MANAGER and _other_active_managers(db, u) == 0:
                raise HTTPException(status_code=400, detail="There must always be at least one active manager.")
        u.is_active = request.is_active
        _audit(db, who, "USER_ACTIVATED" if request.is_active else "USER_DEACTIVATED", f"{u.display_name} was {'reactivated' if request.is_active else 'deactivated'}.")
    db.commit()
    return _out(db, u)


class NewPassword(BaseModel):
    password: str


@router.post("/users/{user_id}/password")
def reset_password(user_id: str, request: NewPassword, me: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    u = _get(db, user_id)
    if len(request.password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Passwords need at least {MIN_PASSWORD} characters.")
    u.password_hash = hash_password(request.password)
    _audit(db, actor_name(me, "manager"), "PASSWORD_RESET", f"Reset the password for {u.display_name}.")
    db.commit()
    return {"success": True}


class BlockRequest(BaseModel):
    reason: str


@router.post("/users/{user_id}/block")
def block_user(user_id: str, request: BlockRequest, me: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """Block an investigator by hand, without waiting for strikes. Unblock uses the same call as a strike block."""
    u = _get(db, user_id)
    if u.role != INVESTIGATOR:
        raise HTTPException(status_code=400, detail="Only investigators can be blocked.")
    reason = request.reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="Say why, so they know what to talk to you about.")
    if u.is_blocked:
        raise HTTPException(status_code=400, detail="This account is already blocked.")
    from datetime import datetime
    u.is_blocked, u.blocked_at, u.blocked_reason = True, datetime.utcnow(), f"Blocked by {actor_name(me, 'a manager')}: {reason}"
    StrikeService.notify(db, u.id, "BLOCKED", "Your account is blocked", u.blocked_reason)
    _audit(db, actor_name(me, "manager"), "ACCOUNT_BLOCKED", f"Blocked {u.display_name}. {reason}")
    db.commit()
    return _out(db, u)
