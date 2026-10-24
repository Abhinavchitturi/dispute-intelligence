from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.app.database import Base

class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(String(64), primary_key=True, index=True)
    dispute_id = Column(String(64), ForeignKey("disputes.id"), nullable=False, index=True)
    evidence_type = Column(String(64), nullable=False)  # PROOF_OF_DELIVERY, CARRIER_TRACKING, MERCHANT_CORRESPONDENCE, etc.
    description = Column(Text, nullable=False)
    source_record_id = Column(String(64), nullable=True)
    source = Column(String(32), default="synthetic")  # "synthetic" or "paypal_sandbox"
    submitted_at = Column(DateTime, nullable=True)
    availability_status = Column(String(32), default="AVAILABLE")  # "AVAILABLE", "MISSING", "PENDING_VERIFICATION", "NOT_REQUESTED"
    metadata_json = Column(Text, nullable=True)  # JSON string for additional attributes
    created_at = Column(DateTime, default=datetime.utcnow)

    dispute = relationship("Dispute", back_populates="evidence_items")
