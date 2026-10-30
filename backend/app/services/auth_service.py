"""Sign-in and who-is-calling. Passwords are salted PBKDF2 hashes; sessions are signed tokens with an expiry."""
import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.team import INVESTIGATOR, MANAGER, User

_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS).hex()
    return f"pbkdf2${_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations)).hex()
    except ValueError:
        return False
    return hmac.compare_digest(check, digest)


def _sign(payload: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_token(user: User) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"uid": user.id, "exp": int(time.time()) + settings.TOKEN_TTL_HOURS * 3600}).encode()).decode()
    return f"{body}.{_sign(body)}"


def read_token(token: str) -> Optional[str]:
    """The user id inside a valid, unexpired token, else None."""
    try:
        body, sig = token.split(".")
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        data = json.loads(base64.urlsafe_b64decode(body.encode()))
        return data["uid"] if data["exp"] > time.time() else None
    except (ValueError, KeyError, TypeError):
        return None


def _bearer(authorization: Optional[str]) -> Optional[str]:
    return authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else None


def current_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> Optional[User]:
    """The signed-in user. None only when sign-in is switched off (tests); otherwise a missing or bad token is a 401."""
    token = _bearer(authorization)
    user = db.get(User, read_token(token)) if token and read_token(token) else None
    if user is not None and user.is_active is False:
        user = None  # deactivated since they signed in
    if user is None and settings.AUTH_REQUIRED:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def case_user(user: Optional[User] = Depends(current_user)) -> Optional[User]:
    """A signed-in user who may work on cases. A blocked investigator may not open or approve anything."""
    if user and user.role == INVESTIGATOR and user.is_blocked:
        raise HTTPException(status_code=403, detail={"code": "ACCOUNT_BLOCKED", "message": "Your account is blocked. Ask a manager to unblock it."})
    return user


def manager_user(user: Optional[User] = Depends(current_user)) -> Optional[User]:
    if settings.AUTH_REQUIRED and (user is None or user.role != MANAGER):
        raise HTTPException(status_code=403, detail="Only a manager can do this.")
    return user


def require_ai_agent(x_ai_agent_key: Optional[str] = Header(default=None)) -> None:
    """The AI reviewer calls in with a shared key. With no key configured, nobody gets in."""
    expected = settings.AI_AGENT_API_KEY
    if not expected or not x_ai_agent_key or not hmac.compare_digest(x_ai_agent_key, expected):
        raise HTTPException(status_code=401, detail="Missing or wrong AI agent key.")


def actor_name(user: Optional[User], fallback: str) -> str:
    return user.display_name if user else fallback


def public(user: User) -> dict:
    return {"id": user.id, "username": user.username, "name": user.display_name, "role": user.role, "email": user.email,
            "is_blocked": user.is_blocked, "blocked_reason": user.blocked_reason}


def case_scope(request: Request, user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """Runs on every route that names a case (or a message or document on one). An investigator can only reach cases they have.
    A case they can't see answers "not found", so they can't even tell it exists."""
    from backend.app.models.dispute import Dispute
    from backend.app.models.evidence import Evidence
    from backend.app.models.message import DisputeMessage
    from backend.app.services.access import can_access, is_restricted
    if not is_restricted(user):
        return
    params = request.path_params
    dispute_id = params.get("dispute_id")
    if not dispute_id and params.get("message_id"):
        m = db.query(DisputeMessage).filter(DisputeMessage.id == params["message_id"]).first()
        dispute_id = m.dispute_id if m else None
    if not dispute_id and params.get("evidence_id"):
        e = db.query(Evidence).filter(Evidence.id == params["evidence_id"]).first()
        dispute_id = e.dispute_id if e else None
    if not dispute_id:
        return
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if d is not None and not can_access(db, user, d):
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
