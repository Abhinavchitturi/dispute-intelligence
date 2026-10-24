from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text
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

    # Relationships
    transaction = relationship("Transaction", back_populates="dispute", uselist=False)
    order = relationship("Order", back_populates="dispute", uselist=False)
    evidence_items = relationship("Evidence", back_populates="dispute", cascade="all, delete-orphan")
    briefs = relationship("InvestigationBrief", back_populates="dispute", cascade="all, delete-orphan")
    audit_events = relationship("AuditEvent", back_populates="dispute", cascade="all, delete-orphan")

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
