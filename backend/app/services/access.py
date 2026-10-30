"""Who can see which case.

The manager sees every case. An investigator sees only the cases they own, plus the ones another investigator has shared with them.
Cases nobody owns, and cases the AI Agent has, are not visible to investigators.
"""
from typing import Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, CaseCollaborator, User


def is_restricted(user: Optional[User]) -> bool:
    """True for an investigator. A manager, or nobody (sign-in off, as in tests), sees everything."""
    return bool(user and user.role == INVESTIGATOR)


def shared_with(db: Session, user_id: str):
    return db.query(CaseCollaborator.dispute_id).filter(CaseCollaborator.user_id == user_id)


def visible_filter(db: Session, user: Optional[User]):
    """A database filter for the cases this person may see, or None when they may see all of them."""
    if not is_restricted(user):
        return None
    return or_(Dispute.assigned_to == user.display_name, Dispute.id.in_(shared_with(db, user.id)))


def can_access(db: Session, user: Optional[User], dispute: Dispute) -> bool:
    if not is_restricted(user):
        return True
    if dispute.assigned_to == user.display_name:
        return True
    return db.query(CaseCollaborator).filter(CaseCollaborator.dispute_id == dispute.id, CaseCollaborator.user_id == user.id).first() is not None


def collaborator_names(db: Session, dispute_ids: List[str]) -> Dict[str, List[str]]:
    """Everyone a case has been shared with, by case. One query for the whole list."""
    out: Dict[str, List[str]] = {}
    if not dispute_ids:
        return out
    rows = (db.query(CaseCollaborator.dispute_id, User.display_name).join(User, User.id == CaseCollaborator.user_id)
            .filter(CaseCollaborator.dispute_id.in_(dispute_ids)).order_by(CaseCollaborator.created_at).all())
    for did, name in rows:
        out.setdefault(did, []).append(name)
    return out
