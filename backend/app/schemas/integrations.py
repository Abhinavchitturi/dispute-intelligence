from pydantic import BaseModel
from typing import Optional, Dict, Any, List

class IntegrationStatusResponse(BaseModel):
    environment_mode: str  # "demo" or "sandbox"
    paypal: Dict[str, Any]
    ai_provider: Dict[str, Any]
    database: Dict[str, Any]
    features_available: Dict[str, bool]

class ConnectivityTestResponse(BaseModel):
    service: str
    connected: bool
    status_code: Optional[int] = None
    message: str
    details: Optional[Dict[str, Any]] = None

class DashboardSummaryResponse(BaseModel):
    environment_mode: str
    total_open_disputes: int
    approaching_deadline_count: int
    missing_evidence_count: int
    awaiting_review_count: int
    disputes_by_reason: List[Dict[str, Any]]
    priority_distribution: Dict[str, int]
    recent_activity: List[Dict[str, Any]]
    action_outcomes_summary: Dict[str, int]
