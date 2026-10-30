from pydantic import BaseModel
from typing import Dict, Optional, List
from datetime import datetime

class AuditEventSchema(BaseModel):
    id: str
    dispute_id: Optional[str] = None
    actor: str
    action: str
    status: str
    source: str
    request_reference: Optional[str] = None
    result_summary: str
    error_code: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class ActionPreviewRequest(BaseModel):
    action_type: str  # e.g., "ACCEPT_CLAIM", "PROVIDE_EVIDENCE", "REQUEST_BUYER_INFO", "ESCALATE_TO_PAYPAL"
    notes: Optional[str] = None
    requested_evidence: Optional[List[str]] = None  # evidence types being asked of the seller or buyer
    deadline_days: Optional[int] = None             # how long they have to reply

class ActionPreviewResponse(BaseModel):
    dispute_id: str
    action_type: str
    is_supported: bool
    requires_confirmation: bool
    impact_summary: str
    warning_message: Optional[str] = None
    target_environment: str  # "demo" or "paypal_sandbox"
    api_endpoint: Optional[str] = None

class ActionExecuteRequest(BaseModel):
    action_type: str
    confirmed: bool
    confirmation_token: Optional[str] = None
    notes: Optional[str] = None
    message: Optional[str] = None  # the drafted/edited message the investigator approved
    subject: Optional[str] = None
    requested_evidence: Optional[List[str]] = None
    deadline_days: Optional[int] = None

class ActionExecuteResponse(BaseModel):
    success: bool
    action_type: str
    dispute_id: str
    message: str
    audit_event_id: str
    environment: str
    message_id: Optional[str] = None
    details: Optional[dict] = None

class EvidenceBalance(BaseModel):
    """Facts from the case, sorted by which side they support. Not a verdict: the investigator makes the call."""
    toward_buyer: List[str] = []
    toward_seller: List[str] = []
    other: List[str] = []  # on file but doesn't clearly favor either side


class ActionDraftResponse(BaseModel):
    dispute_id: str
    action_type: str
    recipient: str  # "Seller", "Buyer" or "Seller and buyer"
    subject: str
    body: str
    cited_record_ids: List[str]
    warnings: List[str] = []  # things the investigator must decide on
    notes: List[str] = []  # informational only
    source: str  # "rules" or "llm"
    model: Optional[str] = None
    evidence_balance: Optional[EvidenceBalance] = None  # decisions only


class DecisionSubmitRequest(BaseModel):
    """An investigator's proposed decision. It goes to an admin; nobody is told until the admin confirms it."""
    outcome: str  # BUYER_FAVOR or SELLER_FAVOR
    reason: str
    confirmed: bool
    actor: Optional[str] = None


class AdminReviewRequest(BaseModel):
    action: str  # APPROVE, OVERRIDE or REOPEN
    reviewer: str
    role: str = "ADMIN"
    outcome: Optional[str] = None   # OVERRIDE only: the admin's own call
    note: Optional[str] = None
    message: Optional[str] = None   # the notice both parties will get (APPROVE and OVERRIDE)
    subject: Optional[str] = None


class AssignRequest(BaseModel):
    assignee: Optional[str] = None  # None releases the case


class DeclareRequest(BaseModel):
    kind: str  # SETTLED, or WITHDRAWN (buyer only)
