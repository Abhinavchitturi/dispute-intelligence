import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.seed.seed_data import seed_database
from backend.app.models.dispute import Dispute

client = TestClient(app)

def test_full_e2e_investigation_scenario():
    # 0. Ensure fresh database state
    seed_database()

    # 1. Step 1: Open dashboard summary
    dash_resp = client.get("/api/dashboard/summary")
    assert dash_resp.status_code == 200
    dash_data = dash_resp.json()
    assert dash_data["total_open_disputes"] >= 8
    assert dash_data["missing_evidence_count"] >= 3
    assert dash_data["environment_mode"] == "demo"

    # 2. Step 2: Query queue and search for main demo case DEMO-DSP-1042
    queue_resp = client.get("/api/disputes?search=1042")
    assert queue_resp.status_code == 200
    queue_data = queue_resp.json()
    assert len(queue_data) == 1
    case_summary = queue_data[0]
    assert case_summary["id"] == "DEMO-DSP-1042"
    assert case_summary["amount"] == 450.00
    assert case_summary["priority_score"] >= 40.0
    assert len(case_summary["priority_factors"]) > 0

    # 3. Step 3: Open dispute detail and inspect context
    detail_resp = client.get("/api/disputes/DEMO-DSP-1042")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["buyer_reference"] == "Alex Morgan (alex_m_demo)"
    assert detail["merchant_reference"] == "TechStore"
    assert detail["order"]["shipment"]["status"] == "DELIVERED"
    assert detail["order"]["shipment"]["delivery_address_match"] == "unknown"
    assert len(detail["evidence_items"]) >= 4

    # 4. Step 4: Generate AI investigation brief
    brief_resp = client.post("/api/disputes/DEMO-DSP-1042/brief?force_regenerate=true")
    assert brief_resp.status_code == 200
    brief = brief_resp.json()
    assert brief["dispute_id"] == "DEMO-DSP-1042"
    assert len(brief["structured_findings"]) >= 3

    # Check prompt requirement: reports delivery while address verification is unavailable
    findings_claims = " ".join([f["claim"] for f in brief["structured_findings"]])
    assert "DELIVERED" in findings_claims or "delivered" in findings_claims
    assert "address verification is unavailable" in findings_claims or "postal" in findings_claims

    # Check prompt requirement: every factual finding cites source records
    for f in brief["structured_findings"]:
        if f["classification"] == "fact" and f["verification_status"] == "verified":
            assert len(f["source_record_ids"]) > 0

    # Check evidence gaps
    assert len(brief["evidence_gaps"]) >= 1
    gap_types = [g["evidence_type"] for g in brief["evidence_gaps"]]
    assert "PROOF_OF_DELIVERY_SIGNATURE" in gap_types or "ADDRESS_VERIFICATION" in gap_types or "MERCHANT_CORRESPONDENCE" in gap_types

    # Check recommendations require human review
    assert len(brief["recommendations"]) >= 1
    for r in brief["recommendations"]:
        assert r["human_review_required"] is True

    # 5. Step 5: Retrieve similar historical cases
    similar_resp = client.get("/api/disputes/DEMO-DSP-1042/similar-cases")
    assert similar_resp.status_code == 200
    similar = similar_resp.json()
    assert len(similar) >= 1
    top_match = similar[0]
    assert top_match["similarity_score"] is not None
    assert top_match["similarity_score"] > 60.0
    assert len(top_match["matching_factors"]) > 0

    # 6. Step 6: Investigator previews asking the seller for the evidence the brief says is missing
    ask = {"requested_evidence": ["PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION"], "message": "Please send the delivery signature or address check."}
    preview_resp = client.post("/api/disputes/DEMO-DSP-1042/actions/preview", json={"action_type": "REQUEST_SELLER_EVIDENCE", **ask})
    assert preview_resp.status_code == 200
    prev_data = preview_resp.json()
    assert prev_data["is_supported"] is True
    assert prev_data["requires_confirmation"] is True

    # 7. Step 7: Investigator sends the request
    exec_resp = client.post("/api/disputes/DEMO-DSP-1042/actions/execute", json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, **ask})
    assert exec_resp.status_code == 200
    exec_data = exec_resp.json()
    assert exec_data["success"] is True
    assert exec_data["environment"] == "demo"
    audit_id = exec_data["audit_event_id"]

    # 8. Step 8: The case now waits on the seller
    updated_dsp = client.get("/api/disputes/DEMO-DSP-1042").json()
    assert updated_dsp["status"] == "WAITING_FOR_SELLER_RESPONSE"

    # 9. Step 9: The seller answers. The buyer hasn't been asked, so the case is in progress. The investigator can still decide with what is on file.
    msg = client.get("/api/disputes/DEMO-DSP-1042/messages").json()[0]
    assert client.post(f"/api/messages/{msg['id']}/simulate-reply").status_code == 200
    assert client.get("/api/disputes/DEMO-DSP-1042").json()["status"] == "IN_PROGRESS"
    from backend.tests.helpers import decide
    decide(client, "DEMO-DSP-1042", "BUYER_FAVOR")
    final = client.get("/api/disputes/DEMO-DSP-1042").json()
    assert final["status"] == "RESOLVED" and final["outcome"] == "BUYER_FAVOR"

    # 10. Step 10: Everything is in the audit trail
    events = client.get("/api/audit-events?dispute_id=DEMO-DSP-1042").json()
    matching_event = next((e for e in events if e["id"] == audit_id), None)
    assert matching_event is not None
    assert matching_event["action"] == "REQUEST_SELLER_EVIDENCE"
    assert matching_event["status"] == "SUCCESS"
    actions = {e["action"] for e in events}
    assert {"REPLY_RECEIVED", "DECIDE_FOR_BUYER"} <= actions
