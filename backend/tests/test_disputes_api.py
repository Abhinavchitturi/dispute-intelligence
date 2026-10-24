import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["app"] == "ResolveIQ"

def test_dashboard_summary():
    response = client.get("/api/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert "total_open_disputes" in data
    assert data["total_open_disputes"] > 0
    assert "disputes_by_reason" in data
    assert "priority_distribution" in data

def test_list_disputes_and_filter():
    response = client.get("/api/disputes")
    assert response.status_code == 200
    disputes = response.json()
    assert len(disputes) >= 12

    # Test search for DEMO-DSP-1042
    search_resp = client.get("/api/disputes?search=1042")
    assert search_resp.status_code == 200
    results = search_resp.json()
    assert len(results) == 1
    assert results[0]["id"] == "DEMO-DSP-1042"

    # Test filter by reason
    inr_resp = client.get("/api/disputes?reason=MERCHANDISE_OR_SERVICE_NOT_RECEIVED")
    assert inr_resp.status_code == 200
    for d in inr_resp.json():
        assert d["reason"] == "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"

def test_get_demo_case_1042():
    response = client.get("/api/disputes/DEMO-DSP-1042")
    assert response.status_code == 200
    d = response.json()
    assert d["id"] == "DEMO-DSP-1042"
    assert d["amount"] == 450.0
    assert d["order"]["merchant_reference"] == "TechStore"
    assert d["order"]["shipment"]["status"] == "DELIVERED"
    assert d["order"]["shipment"]["delivery_address_match"] == "unknown"
    assert len(d["evidence_items"]) >= 4

def test_timeline_for_demo_case():
    response = client.get("/api/disputes/DEMO-DSP-1042/timeline")
    assert response.status_code == 200
    events = response.json()
    assert len(events) >= 3
    # Check event types present
    types = [e["event_type"] for e in events]
    assert "ORDER" in types
    assert "PAYMENT" in types
    assert "DISPUTE" in types
