"""PayPal sandbox cases get simulated seller and buyer replies, like the demo: their test accounts never really answer."""
from datetime import datetime, timedelta

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.services import evidence_catalog as cat
from backend.app.services.message_service import MessageService

CASE = "PAYPAL-PP-R-SIM-10000001"


def _case(db):
    db.query(DisputeMessage).filter(DisputeMessage.dispute_id == CASE).delete()
    db.query(Evidence).filter(Evidence.dispute_id == CASE).delete()
    db.query(Dispute).filter(Dispute.id == CASE).delete()
    d = Dispute(id=CASE, external_dispute_id="PP-R-SIM-10000001", source="paypal_sandbox", status="OPEN", amount=49.0,
                reason="MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", evidence_status="MISSING",
                buyer_claim="x" * 200)  # no order, shipment or transaction behind it, like a fresh PayPal import
    db.add(d)
    db.commit()
    return d


def _ask(db, d, action, sandbox=True):
    party = cat.SELLER if action == "REQUEST_SELLER_EVIDENCE" else cat.BUYER
    wanted = [o["evidence_type"] for o in cat.options_for(__import__("backend.app.services.ai_service", fromlist=["AIService"]).AIService.build_case_context(d), party)][:2]
    return MessageService.record_request(db, d, action, "Please send these.", None, wanted, sandbox=sandbox)


def test_sandbox_case_gets_simulated_replies_from_both_sides(monkeypatch):
    monkeypatch.setattr(settings, "SIMULATE_REPLIES", True)
    db = SessionLocal()
    try:
        d = _case(db)
        seller_ask = _ask(db, d, "REQUEST_SELLER_EVIDENCE")
        buyer_ask = _ask(db, d, "REQUEST_BUYER_EVIDENCE")
        assert seller_ask.reply_due_at is not None and buyer_ask.reply_due_at is not None

        delivered = MessageService.deliver_due(db, CASE, now=datetime.utcnow() + timedelta(hours=1))
        assert delivered == 2
        replies = db.query(DisputeMessage).filter(DisputeMessage.dispute_id == CASE, DisputeMessage.direction == "INBOUND").all()
        assert {r.counterparty for r in replies} == {cat.SELLER, cat.BUYER}
        assert all(r.source == "synthetic" for r in replies)   # shown with the "Simulated" badge
        db.refresh(d)
        assert d.status == "UNDER_REVIEW"                       # both sides answered: ready to decide
    finally:
        db.rollback()
        _case(db)
        db.query(Dispute).filter(Dispute.id == CASE).delete()
        db.commit()
        db.close()


def test_simulation_can_be_turned_off_for_sandbox_cases(monkeypatch):
    monkeypatch.setattr(settings, "SIMULATE_REPLIES", False)
    db = SessionLocal()
    try:
        d = _case(db)
        ask = _ask(db, d, "REQUEST_SELLER_EVIDENCE")
        assert ask.reply_due_at is None
        assert MessageService.deliver_due(db, CASE, now=datetime.utcnow() + timedelta(hours=1)) == 0
    finally:
        db.rollback()
        _case(db)
        db.query(Dispute).filter(Dispute.id == CASE).delete()
        db.commit()
        db.close()
