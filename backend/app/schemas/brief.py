from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class Finding(BaseModel):
    finding_id: str
    claim: str
    classification: str = Field(description="'fact', 'inference', or 'unknown'")
    source_record_ids: List[str] = Field(default_factory=list)
    explanation: str
    confidence_label: Optional[str] = "HIGH"
    verification_status: str = Field(default="verified", description="'verified', 'unverified', or 'contradicted'")

class EvidenceGap(BaseModel):
    evidence_type: str
    reason_required: str
    current_status: str
    supporting_record_ids: List[str] = Field(default_factory=list)
    suggested_follow_up: str

class Recommendation(BaseModel):
    recommendation: str
    rationale: str
    supporting_record_ids: List[str] = Field(default_factory=list)
    limitations: str
    human_review_required: bool = True

class InvestigationBriefSchema(BaseModel):
    summary: str
    executive_summary: Optional[str] = None
    buyer_claim_summary: Optional[str] = None
    payment_facts_summary: Optional[str] = None
    order_facts_summary: Optional[str] = None
    shipment_facts_summary: Optional[str] = None
    seller_evidence_summary: Optional[str] = None
    structured_findings: List[Finding] = Field(default_factory=list)
    evidence_gaps: List[EvidenceGap] = Field(default_factory=list)
    recommendations: List[Recommendation] = Field(default_factory=list)

class InvestigationBriefResponse(BaseModel):
    id: str
    dispute_id: str
    generated_at: datetime
    provider: str
    model: Optional[str] = None
    summary: str
    structured_findings: List[Finding]
    evidence_gaps: List[EvidenceGap]
    recommendations: List[Recommendation]
    generation_status: str

    class Config:
        from_attributes = True
