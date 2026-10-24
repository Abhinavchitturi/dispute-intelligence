from pydantic import BaseModel
from typing import Optional, List
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
    evidence_type: Optional[str] = None
    tracking_number: Optional[str] = None
    carrier: Optional[str] = None

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
    evidence_type: Optional[str] = None
    tracking_number: Optional[str] = None
    carrier: Optional[str] = None

class ActionExecuteResponse(BaseModel):
    success: bool
    action_type: str
    dispute_id: str
    message: str
    audit_event_id: str
    environment: str
    details: Optional[dict] = None
