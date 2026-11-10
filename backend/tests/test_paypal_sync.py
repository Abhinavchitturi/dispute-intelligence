from fastapi.testclient import TestClient

from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute, Transaction
from backend.app.services.paypal_client import PayPalClient

client = TestClient(app)


def test_paypal_disputes_sync_are_imported_and_updated(monkeypatch):
    external_id = "TEST-PAYPAL-SYNC-1"
    transaction_id = "TEST-PAYPAL-TXN-1"

    async def fake_get_disputes(cls, page_size=100):
        assert page_size == 100
        return {
            "items": [
                {
                    "dispute_id": external_id,
                    "create_time": "2026-10-20T10:00:00Z",
                    "update_time": "2026-10-21T10:00:00Z",
                    "seller_response_due_date": "2026-10-30T10:00:00Z",
                    "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                    "status": "WAITING_FOR_SELLER_RESPONSE",
                    "dispute_amount": {"value": "49.99", "currency_code": "USD"},
                    "buyer": {"name": "Sandbox Buyer", "email": "buyer@example.test"},
                    "disputed_transactions": [
                        {
                            "seller_transaction_id": transaction_id,
                            "gross_amount": {"value": "49.99", "currency_code": "USD"},
                            "create_time": "2026-10-19T10:00:00Z",
                        }
                    ],
                }
            ]
        }

    monkeypatch.setattr(PayPalClient, "is_configured", classmethod(lambda cls: True))
    monkeypatch.setattr(PayPalClient, "get_disputes", classmethod(fake_get_disputes))

    db = SessionLocal()
    try:
        db.query(Dispute).filter(Dispute.external_dispute_id == external_id).delete()
        db.query(Transaction).filter(Transaction.external_transaction_id == transaction_id).delete()
        db.commit()

        first = client.post("/api/integrations/paypal/sync")
        assert first.status_code == 200
        assert first.json()["created"] == 1
        assert first.json()["updated"] == 0

        imported = client.get(f"/api/disputes?search={external_id}")
        assert imported.status_code == 200
        dispute = imported.json()[0]
        assert dispute["id"] == f"PAYPAL-{external_id}"
        assert dispute["source"] == "paypal_sandbox"
        assert dispute["amount"] == 49.99
        assert dispute["buyer_reference"] == "Sandbox Buyer"

        second = client.post("/api/integrations/paypal/sync")
        assert second.status_code == 200
        assert second.json()["created"] == 0
        assert second.json()["updated"] == 1
    finally:
        db.query(Dispute).filter(Dispute.external_dispute_id == external_id).delete()
        db.query(Transaction).filter(Transaction.external_transaction_id == transaction_id).delete()
        db.commit()
        db.close()
