from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.team import User
from backend.app.services import auth_service
from backend.app.services.strike_service import StrikeService

router = APIRouter(tags=["Sign in"])


class LoginRequest(BaseModel):
    username: str
    password: str


def _session(user: User, db: Session) -> dict:
    return {**auth_service.public(user), "strikes": StrikeService.active_strikes(db, user.id),
            "block_at": StrikeService.block_threshold(), "notify_at": StrikeService.notify_threshold()}


@router.post("/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username.strip().lower()).first()
    # One message for both failures, so it doesn't reveal which usernames exist.
    if not user or not auth_service.verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="That username and password don't match.")
    if user.is_active is False:
        raise HTTPException(status_code=403, detail="This account has been deactivated. Ask a manager.")
    return {"token": auth_service.create_token(user), "user": _session(user, db)}


@router.get("/auth/me")
def me(user: Optional[User] = Depends(auth_service.current_user), db: Session = Depends(get_db)):
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return _session(user, db)
