"""The people who can sign in. The demo's logins are listed in the README. Managers can add, change and deactivate users in the app."""
import uuid
from typing import Dict, List

from sqlalchemy.orm import Session

from backend.app.models.team import INVESTIGATOR, MANAGER, User
from backend.app.services.auth_service import hash_password

DEMO_ACCOUNTS: List[Dict] = [
    {"username": "abhinav", "password": "Abhinav#Invest2026", "display_name": "Abhinav Chitturi", "role": INVESTIGATOR, "email": "abhinav@resolveiq.example", "was": "investigator"},
    {"username": "susmitha", "password": "Susmitha#Invest2026", "display_name": "Susmitha", "role": INVESTIGATOR, "email": "susmitha@resolveiq.example", "was": "investigator2"},
    {"username": "jahnavi", "password": "Jahnavi#Invest2026", "display_name": "Jahnavi", "role": INVESTIGATOR, "email": "jahnavi@resolveiq.example", "was": None},
    {"username": "paypal", "password": "PayPal#Manager2026", "display_name": "PayPal", "role": MANAGER, "email": "disputes-manager@resolveiq.example", "was": "manager"},
]


def ensure_users(db: Session) -> None:
    """Creates any demo account that is missing. Earlier versions used other usernames, so those are renamed in place (keeping their strikes and history)
    rather than left behind. An account that already exists is never touched, so a changed password or name survives a restart."""
    for acct in DEMO_ACCOUNTS:
        if db.query(User).filter(User.username == acct["username"]).first():
            continue
        old = db.query(User).filter(User.username == acct["was"]).first() if acct["was"] else None
        if old:
            old.username, old.display_name, old.email, old.password_hash = acct["username"], acct["display_name"], acct["email"], hash_password(acct["password"])
        else:
            db.add(User(id=f"USR-{uuid.uuid4().hex[:8]}", username=acct["username"], display_name=acct["display_name"], email=acct["email"],
                        role=acct["role"], password_hash=hash_password(acct["password"])))
    db.commit()
