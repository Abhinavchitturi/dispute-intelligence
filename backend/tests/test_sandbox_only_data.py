"""Sandbox mode holds PayPal cases only: demo data is removed and never seeded."""
from datetime import datetime

from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.audit import AuditEvent
from backend.app.models.brief import HistoricalCase
from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.models.team import Notification, User
from backend.app.seed.seed_data import clear_demo_data, has_demo_data, seed_database

client = TestClient(app)
PAYPAL_ID = "PAYPAL-PP-R-KEEP-10000001"


def test_clearing_demo_data_keeps_paypal_cases_and_accounts():
    db = SessionLocal()
    try:
        db.add(Dispute(id=PAYPAL_ID, external_dispute_id="PP-R-KEEP-10000001", source="paypal_sandbox",
                       reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status="OPEN", amount=20.0))
        db.add(DisputeMessage(id="PPMSG-keep", dispute_id=PAYPAL_ID, direction="INBOUND", counterparty="BUYER",
                              subject="s", body="b", source="paypal_sandbox", created_at=datetime.utcnow()))
        db.add(AuditEvent(id="AUDIT-keep", dispute_id=PAYPAL_ID, actor="paypal_api", action="X", status="SUCCESS",
                          source="paypal_sandbox", result_summary="kept", created_at=datetime.utcnow()))
        db.commit()
        users_before = db.query(User).count()
        assert has_demo_data(db)

        removed = clear_demo_data(db)

        assert removed["disputes"] > 0
        assert not has_demo_data(db)
        assert [d.id for d in db.query(Dispute).all()] == [PAYPAL_ID]
        assert db.query(DisputeMessage).filter(DisputeMessage.dispute_id == PAYPAL_ID).count() == 1
        assert db.query(DisputeMessage).count() == 1
        assert db.get(AuditEvent, "AUDIT-keep") is not None
        assert db.query(HistoricalCase).count() == 0
        assert db.query(Notification).count() == 0
        assert db.query(User).count() == users_before
    finally:
        db.rollback()
        db.query(DisputeMessage).filter(DisputeMessage.dispute_id == PAYPAL_ID).delete()
        db.query(AuditEvent).filter(AuditEvent.id == "AUDIT-keep").delete()
        db.query(Dispute).filter(Dispute.id == PAYPAL_ID).delete()
        db.commit()
        seed_database(db)  # put the demo data back for the other tests
        db.close()


def test_demo_reset_is_refused_in_sandbox_mode(monkeypatch):
    monkeypatch.setattr(settings, "RESOLVEIQ_MODE", "sandbox")
    response = client.post("/api/integrations/reset-demo-data")
    assert response.status_code == 409
    assert "sandbox mode" in response.json()["detail"]
