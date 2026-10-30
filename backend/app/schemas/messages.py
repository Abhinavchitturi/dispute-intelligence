from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class MessageSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    dispute_id: str
    direction: str
    counterparty: str
    action_type: Optional[str] = None
    subject: str
    body: str
    source: str
    awaiting_reply: bool
    reply_due_at: Optional[datetime] = None
    in_reply_to: Optional[str] = None
    is_read: bool
    requested_evidence: List[str] = []   # outbound request: what PayPal asked for
    provided_evidence: List[str] = []    # inbound reply: what they sent
    unavailable_evidence: List[str] = [] # inbound reply: what they couldn't provide
    deadline: Optional[str] = None       # outbound request: reply-by date
    emailed_to: Optional[str] = None     # outbound request: where it was emailed
    email_status: Optional[str] = None   # QUEUED (kept here, not sent), SENT or FAILED
    needs_recording: bool = False        # an emailed reply that still has to be gone through
    attachments: List[str] = []          # files that came with an emailed reply
    created_at: datetime


class ThreadSummary(BaseModel):
    dispute_id: str
    buyer_reference: Optional[str] = None
    merchant_reference: Optional[str] = None
    reason: str
    amount: float
    currency: str
    dispute_status: str
    state: str                       # "WAITING" (a party owes us a reply), "YOUR_TURN" (PayPal must act), "IN_REVIEW" (an admin is checking the decision), "CLOSED"
    waiting_on: Optional[str] = None # "Seller", "Buyer" or "Seller and buyer" when state is WAITING
    last_message_preview: str
    last_message_at: datetime
    last_direction: str
    unread_count: int
    message_count: int
    awaiting_since: Optional[datetime] = None
    expected_reply_at: Optional[datetime] = None
    simulated: bool
    pending_message_ids: List[str] = []
    outcome: Optional[str] = None
    assigned_to: Optional[str] = None
