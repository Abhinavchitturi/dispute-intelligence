import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_action_preview_describes_what_the_action_will_do():
    r = client.post("/api/disputes/DEMO-DSP-1042/actions/preview",
                    json={"action_type": "REQUEST_SELLER_EVIDENCE", "requested_evidence": ["PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION"]})
    assert r.status_code == 200
    data = r.json()
    assert data["is_supported"] is True and data["requires_confirmation"] is True
    assert data["target_environment"] == "demo"
    assert "seller for 2 items" in data["impact_summary"]


def test_unknown_actions_are_not_supported():
    r = client.post("/api/disputes/DEMO-DSP-1042/actions/preview", json={"action_type": "PROVIDE_EVIDENCE"})  # a seller action, not PayPal's
    assert r.status_code == 200 and r.json()["is_supported"] is False


def test_action_execution_requires_confirmation():
    r = client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json={"action_type": "DECIDE_FOR_BUYER", "confirmed": False})
    assert r.status_code == 400
    assert "Human confirmation required" in r.json()["detail"]


def test_a_request_needs_at_least_one_valid_item():
    base = {"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "message": "m"}
    assert client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json=base).status_code == 400
    assert client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json={**base, "requested_evidence": []}).status_code == 400
    # A buyer-only item can't be asked of the seller, and vice versa.
    bad = client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json={**base, "requested_evidence": ["BUYER_CAMERA_FOOTAGE"]})
    assert bad.status_code == 400 and "BUYER_CAMERA_FOOTAGE" in bad.json()["detail"]


def test_demo_action_execution_flow():
    r = client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json={
        "action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "message": "Please send proof of delivery.",
        "requested_evidence": ["PROOF_OF_DELIVERY_SIGNATURE"]})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True and data["environment"] == "demo" and data["message_id"]
    assert data["details"]["new_status"] == "WAITING_FOR_SELLER_RESPONSE"

    events = client.get("/api/audit-events?dispute_id=DEMO-DSP-1042").json()
    assert any(e["action"] == "REQUEST_SELLER_EVIDENCE" and "Proof of delivery signature" in e["result_summary"] for e in events)


def test_a_decision_cannot_skip_review():
    r = client.post("/api/disputes/DEMO-DSP-1048/actions/execute", json={"action_type": "DECIDE_FOR_SELLER", "confirmed": True, "message": "Decided."})
    assert r.status_code == 400 and "review" in r.json()["detail"].lower()
    assert client.get("/api/disputes/DEMO-DSP-1048").json()["status"] != "RESOLVED"


def test_a_decided_dispute_accepts_no_further_action():
    from backend.tests.helpers import decide
    decide(client, "DEMO-DSP-1053", "SELLER_FAVOR")
    again = client.post("/api/disputes/DEMO-DSP-1053/actions/execute", json={"action_type": "REQUEST_BUYER_EVIDENCE", "confirmed": True, "requested_evidence": ["BUYER_STATEMENT"]})
    assert again.status_code == 400 and "already resolved" in again.json()["detail"]
    preview = client.post("/api/disputes/DEMO-DSP-1053/actions/preview", json={"action_type": "DECIDE_FOR_BUYER"}).json()
    assert preview["is_supported"] is False


def test_secret_redaction_in_audit_service():
    from backend.app.services.audit_service import AuditService
    from backend.app.database import SessionLocal

    db = SessionLocal()
    try:
        raw_msg = "Dispatched request with Bearer secret-paypal-token-9988 and token=12345"
        evt = AuditService.record_event(
            db=db,
            action="TEST_SECRET_REDACTION",
            result_summary=raw_msg,
            dispute_id="DEMO-DSP-1042"
        )
        assert "secret-paypal-token" not in evt.result_summary
        assert "Bearer [REDACTED]" in evt.result_summary
    finally:
        db.close()
