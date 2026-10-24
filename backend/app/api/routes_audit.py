from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.app.database import get_db
from backend.app.schemas.audit import AuditEventSchema
from backend.app.services.audit_service import AuditService

router = APIRouter(tags=["Audit Trail"])

@router.get("/audit-events", response_model=List[AuditEventSchema])
def get_audit_trail(
    dispute_id: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
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
        offset=offset
    )
