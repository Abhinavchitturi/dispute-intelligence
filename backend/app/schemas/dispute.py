from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class PriorityFactor(BaseModel):
    name: str
    weight: float
    contribution: float
    explanation: str

class ShipmentSchema(BaseModel):
    id: str
    order_id: str
    source: str
    tracking_reference: Optional[str] = None
    status: str
    carrier: Optional[str] = None
    shipped_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    delivery_address_match: str
    shipping_address_masked: Optional[str] = None
    destination_city: Optional[str] = None

    class Config:
        from_attributes = True

class OrderSchema(BaseModel):
    id: str
    external_order_id: Optional[str] = None
    source: str
    item_summary: str
    order_date: Optional[datetime] = None
    amount: float
    currency: str
    merchant_reference: Optional[str] = None
    shipment: Optional[ShipmentSchema] = None

    class Config:
        from_attributes = True

class TransactionSchema(BaseModel):
    id: str
    external_transaction_id: Optional[str] = None
    source: str
    amount: float
    currency: str
    status: str
    transaction_date: Optional[datetime] = None
    related_order_id: Optional[str] = None
    payment_method: Optional[str] = None
    buyer_email_masked: Optional[str] = None

    class Config:
        from_attributes = True

class EvidenceSchema(BaseModel):
    id: str
    dispute_id: str
    evidence_type: str
    description: str
    source_record_id: Optional[str] = None
    source: str
    submitted_at: Optional[datetime] = None
    availability_status: str
    metadata_json: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class DisputeListItem(BaseModel):
    id: str
    external_dispute_id: Optional[str] = None
    source: str
    transaction_id: Optional[str] = None
    order_id: Optional[str] = None
    buyer_reference: Optional[str] = None
    merchant_reference: Optional[str] = None
    reason: str
    status: str
    amount: float
    currency: str
    response_due_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    priority_score: float
    priority_factors: List[PriorityFactor] = []
    evidence_status: str
    buyer_claim: Optional[str] = None

    class Config:
        from_attributes = True

class DisputeDetail(DisputeListItem):
    transaction: Optional[TransactionSchema] = None
    order: Optional[OrderSchema] = None
    evidence_items: List[EvidenceSchema] = []
    latest_brief_id: Optional[str] = None

class TimelineEvent(BaseModel):
    id: str
    timestamp: datetime
    event_type: str  # PAYMENT, ORDER, SHIPMENT, DISPUTE, EVIDENCE, INVESTIGATOR_ACTION
    title: str
    description: str
    source: str  # "synthetic" or "paypal_sandbox"
    source_record_id: Optional[str] = None
    status: Optional[str] = None

class HistoricalCaseSchema(BaseModel):
    id: str
    source: str
    reason: str
    case_summary: str
    evidence_attributes: Dict[str, Any]
    outcome: Optional[str] = None
    created_at: Optional[datetime] = None
    amount: Optional[float] = None
    currency: str = "USD"
    similarity_score: Optional[float] = None
    matching_factors: List[str] = []

    class Config:
        from_attributes = True
