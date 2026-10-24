from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.app.database import Base

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(String(64), primary_key=True, index=True)
    dispute_id = Column(String(64), ForeignKey("disputes.id"), nullable=True, index=True)
    actor = Column(String(64), default="system")  # "investigator_sarah", "system_ai", "paypal_api", etc.
    action = Column(String(64), nullable=False)   # "BRIEF_GENERATED", "EVIDENCE_SUBMITTED", "CLAIM_ACCEPTED", etc.
    status = Column(String(32), default="SUCCESS")# "SUCCESS", "FAILED", "PENDING_APPROVAL"
    source = Column(String(32), default="synthetic") # "synthetic", "paypal_sandbox"
    request_reference = Column(String(128), nullable=True)
    result_summary = Column(Text, nullable=False)
    error_code = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    dispute = relationship("Dispute", back_populates="audit_events")
