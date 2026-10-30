from sqlalchemy import Boolean, Column, String, Float, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.app.database import Base

class Dispute(Base):
    __tablename__ = "disputes"

    id = Column(String(64), primary_key=True, index=True)
    external_dispute_id = Column(String(64), nullable=True, index=True)
    source = Column(String(32), default="synthetic")  # "paypal_sandbox" or "synthetic"
    transaction_id = Column(String(64), ForeignKey("transactions.id"), nullable=True)
    order_id = Column(String(64), ForeignKey("orders.id"), nullable=True)
    buyer_reference = Column(String(128), nullable=True)
    merchant_reference = Column(String(128), nullable=True)
    reason = Column(String(128), nullable=False)
    status = Column(String(64), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="USD")
    response_due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    raw_payload_reference = Column(Text, nullable=True)
    priority_score = Column(Float, default=0.0)
    priority_factors_json = Column(Text, nullable=True)
    buyer_claim = Column(Text, nullable=True)
    evidence_status = Column(String(64), default="PENDING")  # COMPLETE, PARTIAL, MISSING, CONFLICTING
    outcome = Column(String(32), nullable=True)  # set when PayPal decides: BUYER_FAVOR, SELLER_FAVOR, SETTLED or DISMISSED

    # Who is working the case, and the investigator's proposed decision while an admin reviews it.
    assigned_to = Column(String(128), nullable=True)
    proposed_outcome = Column(String(32), nullable=True)    # BUYER_FAVOR or SELLER_FAVOR
    proposed_reason = Column(Text, nullable=True)
    proposed_by = Column(String(128), nullable=True)
    proposed_at = Column(DateTime, nullable=True)
    review_note = Column(Text, nullable=True)               # the admin's note when sending a case back or overriding
    reviewed_by = Column(String(128), nullable=True)
    # Each side can say the dispute was settled outside PayPal. It is only settled when both say so.
    seller_settled_at = Column(DateTime, nullable=True)
    buyer_settled_at = Column(DateTime, nullable=True)
    # Who made the final call, and the people watching the case.
    decided_by = Column(String(16), nullable=True)           # INVESTIGATOR (AI approved), AI (AI overturned) or MANAGER
    ai_verdict = Column(String(12), nullable=True)           # APPROVE or OVERTURN, from the AI reviewer
    ai_rationale = Column(Text, nullable=True)
    manager_assigned = Column(String(128), nullable=True)    # a manager who has joined this case (appeals)
    buyer_email = Column(String(255), nullable=True)
    seller_email = Column(String(255), nullable=True)
    parent_dispute_id = Column(String(64), nullable=True, index=True)   # set on an appeal: the case it appeals
    appeal_number = Column(Integer, nullable=True)
    # Set when nobody took the case before its deadline, so the AI Agent handles the whole case.
    ai_owned = Column(Boolean, default=False)
    ai_owned_at = Column(DateTime, nullable=True)

    # Relationships
    transaction = relationship("Transaction", back_populates="dispute", uselist=False)
    order = relationship("Order", back_populates="dispute", uselist=False)
    evidence_items = relationship("Evidence", back_populates="dispute", cascade="all, delete-orphan")
    briefs = relationship("InvestigationBrief", back_populates="dispute", cascade="all, delete-orphan")
    audit_events = relationship("AuditEvent", back_populates="dispute", cascade="all, delete-orphan")
    messages = relationship("DisputeMessage", back_populates="dispute", cascade="all, delete-orphan", order_by="DisputeMessage.created_at")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(64), primary_key=True, index=True)
    external_transaction_id = Column(String(64), nullable=True, index=True)
    source = Column(String(32), default="synthetic")
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="USD")
    status = Column(String(64), nullable=False)
    transaction_date = Column(DateTime, nullable=True)
    related_order_id = Column(String(64), nullable=True)
    payment_method = Column(String(64), nullable=True)
    buyer_email_masked = Column(String(128), nullable=True)

    dispute = relationship("Dispute", back_populates="transaction")

class Order(Base):
    __tablename__ = "orders"

    id = Column(String(64), primary_key=True, index=True)
    external_order_id = Column(String(64), nullable=True, index=True)
    source = Column(String(32), default="synthetic")
    item_summary = Column(Text, nullable=False)
    order_date = Column(DateTime, nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="USD")
    merchant_reference = Column(String(128), nullable=True)

    dispute = relationship("Dispute", back_populates="order")
    shipment = relationship("Shipment", back_populates="order", uselist=False, cascade="all, delete-orphan")

class Shipment(Base):
    __tablename__ = "shipments"

    id = Column(String(64), primary_key=True, index=True)
    order_id = Column(String(64), ForeignKey("orders.id"), nullable=False)
    source = Column(String(32), default="synthetic")
    tracking_reference = Column(String(128), nullable=True)
    status = Column(String(64), default="UNKNOWN")  # DELIVERED, IN_TRANSIT, LABEL_CREATED, UNKNOWN
    carrier = Column(String(64), nullable=True)
    shipped_at = Column(DateTime, nullable=True)
    delivered_at = Column(DateTime, nullable=True)
    delivery_address_match = Column(String(32), default="unknown")  # "unknown", "yes", "no"
    shipping_address_masked = Column(String(256), nullable=True)
    destination_city = Column(String(64), nullable=True)

    order = relationship("Order", back_populates="shipment")
