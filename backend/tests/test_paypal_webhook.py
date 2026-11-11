"""PayPal's webhook brings a new dispute in at once, and only events PayPal confirms it sent are accepted."""
from fastapi.testclient import TestClient

from backend.app.api import routes_public
from backend.app.main import app
from backend.app.services.paypal_client import PayPalClient

client = TestClient(app)
SIGNED = {"paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
          "paypal-transmission-id": "T1", "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-11T06:19:30Z"}
EVENT = {"id": "WH-1", "event_type": "CUSTOMER.DISPUTE.CREATED", "resource": {"dispute_id": "PP-R-NEW-10000001"}}


def _setup(monkeypatch, verdict="SUCCESS"):
    imported, checks = [], []

    async def verify(cls, path, body):
        checks.append((path, body))
        return {"verification_status": verdict}

    async def fake_import(dispute_id):
        imported.append(dispute_id)

    monkeypatch.setattr(routes_public, "_webhook_id", lambda: "WH-ID-1")
    monkeypatch.setattr(PayPalClient, "post_json", classmethod(verify))
    monkeypatch.setattr(routes_public, "_import_now", fake_import)
    return imported, checks


def test_a_verified_new_dispute_is_imported_straight_away(monkeypatch):
    imported, checks = _setup(monkeypatch)
    r = client.post("/api/public/paypal/webhook", json=EVENT, headers=SIGNED)
    assert r.status_code == 200 and r.json()["dispute_id"] == "PP-R-NEW-10000001"
    assert imported == ["PP-R-NEW-10000001"]
    path, body = checks[0]
    assert path == "/v1/notifications/verify-webhook-signature"
    assert body["webhook_id"] == "WH-ID-1" and body["transmission_sig"] == "sig" and body["webhook_event"] == EVENT


def test_an_event_paypal_didnt_send_is_refused(monkeypatch):
    imported, _ = _setup(monkeypatch, verdict="FAILURE")
    assert client.post("/api/public/paypal/webhook", json=EVENT, headers=SIGNED).status_code == 401
    assert imported == []


def test_an_unsigned_event_is_refused_without_asking_paypal(monkeypatch):
    imported, checks = _setup(monkeypatch)
    assert client.post("/api/public/paypal/webhook", json=EVENT).status_code == 401
    assert imported == [] and checks == []


def test_other_events_are_acknowledged_and_ignored(monkeypatch):
    imported, _ = _setup(monkeypatch)
    r = client.post("/api/public/paypal/webhook", json={"event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {}}, headers=SIGNED)
    assert r.status_code == 200 and r.json()["ignored"] == "PAYMENT.CAPTURE.COMPLETED"
    assert imported == []
