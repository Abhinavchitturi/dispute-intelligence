from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.app.database import Base

class InvestigationBrief(Base):
    __tablename__ = "investigation_briefs"

    id = Column(String(64), primary_key=True, index=True)
    dispute_id = Column(String(64), ForeignKey("disputes.id"), nullable=False, index=True)
    generated_at = Column(DateTime, default=datetime.utcnow)
    provider = Column(String(32), default="rule_based")
    model = Column(String(64), nullable=True)
    summary = Column(Text, nullable=False)
    structured_findings_json = Column(Text, nullable=False)  # JSON array of findings
    evidence_gaps_json = Column(Text, nullable=False)        # JSON array of evidence gaps
    recommendations_json = Column(Text, nullable=False)      # JSON array of recommendations
    generation_status = Column(String(32), default="SUCCESS") # SUCCESS, FAILED, FALLBACK

    dispute = relationship("Dispute", back_populates="briefs")

class HistoricalCase(Base):
    __tablename__ = "historical_cases"

    id = Column(String(64), primary_key=True, index=True)
    source = Column(String(32), default="synthetic")
    reason = Column(String(128), nullable=False)
    case_summary = Column(Text, nullable=False)
    evidence_attributes_json = Column(Text, nullable=False)  # JSON object describing evidence factors
    outcome = Column(String(64), nullable=True)             # MERCHANT_FAVOR, BUYER_FAVOR, SETTLED, DISMISSED
    created_at = Column(DateTime, default=datetime.utcnow)
    amount = Column(Float, nullable=True)
    currency = Column(String(8), default="USD")
    similarity_keywords = Column(Text, nullable=True)
