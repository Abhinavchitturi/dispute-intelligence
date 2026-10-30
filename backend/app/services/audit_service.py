import uuid
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from backend.app.models.audit import AuditEvent
from backend.app.schemas.audit import AuditEventSchema

class AuditService:
    @classmethod
    def record_event(
        cls,
        db: Session,
        action: str,
        result_summary: str,
        dispute_id: Optional[str] = None,
        actor: str = "investigator_user",
        status: str = "SUCCESS",
        source: str = "synthetic",
        request_reference: Optional[str] = None,
        error_code: Optional[str] = None
    ) -> AuditEvent:
        """
        Creates a persistent audit event. Sanitizes any potential secret keys or tokens.
        """
        # Redact any bearer or key tokens from summaries
        sanitized_summary = result_summary
        for secret_prefix in ["Bearer ", "token=", "key="]:
            if secret_prefix in sanitized_summary:
                sanitized_summary = sanitized_summary.split(secret_prefix)[0] + f"{secret_prefix}[REDACTED]"

        event_id = f"AUDIT-{int(datetime.utcnow().timestamp()*1000)}-{uuid.uuid4().hex[:6]}"  # two events in the same millisecond must not collide
        event = AuditEvent(
            id=event_id,
            dispute_id=dispute_id,
            actor=actor,
            action=action,
            status=status,
            source=source,
            request_reference=request_reference,
            result_summary=sanitized_summary,
            error_code=error_code,
            created_at=datetime.utcnow()
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    @classmethod
    def list_events(
        cls,
        db: Session,
        dispute_id: Optional[str] = None,
        action: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        only_cases=None,
    ) -> List[AuditEventSchema]:
        query = db.query(AuditEvent)
        if only_cases is not None:  # someone who may only see some cases sees only the activity on those
            query = query.filter(AuditEvent.dispute_id.in_(only_cases))
        if dispute_id:
            query = query.filter(AuditEvent.dispute_id == dispute_id)
        if action and action != "ALL":
            query = query.filter(AuditEvent.action == action)
        if status and status != "ALL":
            query = query.filter(AuditEvent.status == status)

        query = query.order_by(AuditEvent.created_at.desc())
        items = query.offset(offset).limit(limit).all()
        return [AuditEventSchema.model_validate(i) for i in items]
