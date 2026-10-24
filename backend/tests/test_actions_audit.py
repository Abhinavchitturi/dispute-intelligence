import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_action_preview():
    response = client.post(
        "/api/disputes/DEMO-DSP-1042/actions/preview",
        json={"action_type": "PROVIDE_EVIDENCE"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_supported"] is True
    assert data["requires_confirmation"] is True
    assert "Submits tracking" in data["impact_summary"]

def test_action_execution_requires_confirmation():
    # Attempt execution without explicit confirmation flag
    response = client.post(
        "/api/disputes/DEMO-DSP-1042/actions/execute",
        json={"action_type": "ACCEPT_CLAIM", "confirmed": False}
    )
    assert response.status_code == 400
    assert "Human confirmation required" in response.json()["detail"]

def test_demo_action_execution_flow():
    # Execute action with confirmed = True in demo mode
    response = client.post(
        "/api/disputes/DEMO-DSP-1042/actions/execute",
        json={
            "action_type": "PROVIDE_EVIDENCE",
            "confirmed": True,
            "evidence_type": "CARRIER_GPS_TRACE",
            "notes": "Verified carrier postal depot scan matches postal sector.",
            "tracking_number": "1Z9999999999999999",
            "carrier": "UPS"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["environment"] == "demo"
    assert "audit_event_id" in data

    # Verify audit event was persisted in database
    audit_resp = client.get(f"/api/audit-events?dispute_id=DEMO-DSP-1042")
    assert audit_resp.status_code == 200
    events = audit_resp.json()
    assert len(events) >= 1
    assert any(e["action"] == "PROVIDE_EVIDENCE" for e in events)

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
