from fastapi import APIRouter, Depends, Query
from backend.app.services.auth_service import current_user
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.app.database import get_db
from backend.app.schemas.audit import AuditEventSchema
from backend.app.services.audit_service import AuditService
from backend.app.models.dispute import Dispute
from backend.app.models.team import User
from backend.app.services.access import visible_filter

router = APIRouter(tags=["Audit Trail"], dependencies=[Depends(current_user)])

@router.get("/audit-events", response_model=List[AuditEventSchema])
def get_audit_trail(
    dispute_id: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: Optional[User] = Depends(current_user),
    db: Session = Depends(get_db)
):
    """
    Returns persistent, database-backed audit records.
    Never exposes secrets, authorization tokens, or raw credentials.
    """
    return AuditService.list_events(
        db=db,
        dispute_id=dispute_id,
        action=action,
        status=status,
        limit=limit,
        offset=offset,
        only_cases=db.query(Dispute.id).filter(scope) if (scope := visible_filter(db, user)) is not None else None,
    )
