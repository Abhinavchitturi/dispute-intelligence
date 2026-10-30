from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
ASK_BUYER, ASK_SELLER = "REQUEST_BUYER_EVIDENCE", "REQUEST_SELLER_EVIDENCE"


@pytest.fixture(autouse=True)
def slow_replies(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 999)


def _dispute(did):
    return client.get(f"/api/disputes/{did}").json()


def _ask(did, action, items, days=5):
    r = client.post(f"/api/disputes/{did}/actions/execute", json={
        "action_type": action, "confirmed": True, "message": "Please send this.", "requested_evidence": items, "deadline_days": days})
    assert r.status_code == 200, r.text
    return r.json()


def _propose(did, outcome="SELLER_FAVOR", reason="The carrier delivered to the confirmed address."):
    return client.post(f"/api/disputes/{did}/decision", json={"outcome": outcome, "reason": reason, "confirmed": True, "actor": "Abhinav Chitturi"})


def _review(did, action, **extra):
    return client.post(f"/api/disputes/{did}/admin-review", json={"action": action, "reviewer": "PayPal", "role": "MANAGER", **extra})


def _declare(did, party, kind):
    return client.post(f"/api/disputes/{did}/parties/{party}/declare", json={"kind": kind})


# ---------- decisions go through an admin ----------
def test_decision_needs_a_reason():
    r = _propose("DEMO-DSP-1043", reason="  ")
    assert r.status_code == 400
    assert _dispute("DEMO-DSP-1043")["status"] == "UNDER_REVIEW"


def test_proposed_decision_waits_for_review_and_tells_nobody():
    r = _propose("DEMO-DSP-1043", "BUYER_FAVOR", "Photos show damage and the seller sent nothing back.")
    assert r.status_code == 200
    d = _dispute("DEMO-DSP-1043")
    assert d["status"] == "PENDING_AI_REVIEW" and d["outcome"] is None
    assert d["proposed_outcome"] == "BUYER_FAVOR" and "damage" in d["proposed_reason"]
    assert not [m for m in client.get("/api/disputes/DEMO-DSP-1043/messages").json() if m["action_type"] == "DECIDE_FOR_BUYER"]


def test_cannot_ask_for_more_while_waiting_for_admin():
    r = client.post("/api/disputes/DEMO-DSP-1043/actions/execute", json={
        "action_type": ASK_BUYER, "confirmed": True, "message": "x", "requested_evidence": ["BUYER_STATEMENT"]})
    assert r.status_code == 400 and "ai reviewer" in r.json()["detail"].lower()


def test_only_an_admin_can_review():
    r = client.post("/api/disputes/DEMO-DSP-1043/admin-review", json={"action": "APPROVE", "reviewer": "Abhinav", "role": "INVESTIGATOR"})
    assert r.status_code == 403


def test_admin_approves_and_both_sides_are_told():
    r = _review("DEMO-DSP-1043", "APPROVE")
    assert r.status_code == 200, r.text
    d = _dispute("DEMO-DSP-1043")
    assert d["status"] == "RESOLVED" and d["outcome"] == "BUYER_FAVOR" and d["reviewed_by"] == "PayPal"
    sent = [m for m in client.get("/api/disputes/DEMO-DSP-1043/messages").json() if m["action_type"] == "DECIDE_FOR_BUYER"]
    assert {m["counterparty"] for m in sent} == {"SELLER", "BUYER"}
    assert "Photos show damage" in sent[0]["body"]  # the investigator's reason travels with the notice


def test_admin_can_reopen_a_proposal():
    assert _propose("DEMO-DSP-1049").status_code == 200
    assert _review("DEMO-DSP-1049", "REOPEN", note="  ").status_code == 400  # must say what is wrong
    r = _review("DEMO-DSP-1049", "REOPEN", note="The address check is missing. Ask the seller first.")
    assert r.status_code == 200
    d = _dispute("DEMO-DSP-1049")
    assert d["status"] == "UNDER_REVIEW" and d["outcome"] is None and "address check" in d["review_note"]


def test_admin_can_override_with_their_own_call():
    assert _propose("DEMO-DSP-1049", "SELLER_FAVOR").status_code == 200
    assert _review("DEMO-DSP-1049", "OVERRIDE", outcome="BUYER_FAVOR").status_code == 400  # needs a note
    r = _review("DEMO-DSP-1049", "OVERRIDE", outcome="BUYER_FAVOR", note="Footage clearly shows no delivery.")
    assert r.status_code == 200
    d = _dispute("DEMO-DSP-1049")
    assert d["status"] == "RESOLVED" and d["outcome"] == "BUYER_FAVOR"


def test_admin_can_reopen_a_decided_case():
    assert _review("DEMO-DSP-1043", "REOPEN", note="Reviewing after a complaint.").status_code == 200
    d = _dispute("DEMO-DSP-1043")
    assert d["status"] == "UNDER_REVIEW" and d["outcome"] is None


# ---------- settled and dismissed ----------
def test_one_side_saying_settled_is_not_settled():
    r = _declare("DEMO-DSP-1042", "SELLER", "SETTLED")
    assert r.status_code == 200
    d = _dispute("DEMO-DSP-1042")
    assert d["status"] not in ("CLOSED", "RESOLVED") and d["outcome"] is None and d["seller_settled_at"]
    notices = [m for m in client.get("/api/disputes/DEMO-DSP-1042/messages").json() if m["action_type"] == "SETTLEMENT_NOTICE"]
    assert len(notices) == 1 and notices[0]["counterparty"] == "BUYER"
    assert _declare("DEMO-DSP-1042", "SELLER", "SETTLED").status_code == 400  # saying it twice changes nothing


def test_both_sides_saying_settled_settles_the_case():
    assert _declare("DEMO-DSP-1042", "BUYER", "SETTLED").status_code == 200
    d = _dispute("DEMO-DSP-1042")
    assert d["status"] == "CLOSED" and d["outcome"] == "SETTLED"


def test_only_the_buyer_can_withdraw_and_it_dismisses_the_case():
    assert _declare("DEMO-DSP-1050", "SELLER", "WITHDRAWN").status_code == 400
    assert _declare("DEMO-DSP-1050", "BUYER", "WITHDRAWN").status_code == 200
    d = _dispute("DEMO-DSP-1050")
    assert d["status"] == "CLOSED" and d["outcome"] == "DISMISSED"


def test_closed_case_takes_no_more_declarations():
    assert _declare("DEMO-DSP-1050", "BUYER", "SETTLED").status_code == 400


# ---------- time is up ----------
def test_passed_reply_deadline_makes_the_case_ready_to_decide():
    did = "DEMO-DSP-1053"
    _ask(did, ASK_SELLER, ["PROOF_OF_DELIVERY_SIGNATURE"])
    assert _dispute(did)["status"] == "WAITING_FOR_SELLER_RESPONSE"
    db = SessionLocal()
    try:
        m = db.query(DisputeMessage).filter(DisputeMessage.dispute_id == did, DisputeMessage.awaiting_reply.is_(True)).first()
        meta = m._meta()
        meta["deadline"] = (datetime.utcnow() - timedelta(hours=1)).isoformat()
        import json
        m.meta_json = json.dumps(meta)
        m.reply_due_at = None
        db.commit()
    finally:
        db.close()
    client.get("/api/dashboard/summary")
    assert _dispute(did)["status"] == "UNDER_REVIEW"
    missing = {i["evidence_type"]: i for i in client.get(f"/api/disputes/{did}/evidence-summary").json()["seller"]}
    assert missing["PROOF_OF_DELIVERY_SIGNATURE"]["status"] == "MISSING"
    assert "did not send" in missing["PROOF_OF_DELIVERY_SIGNATURE"]["detail"]


# ---------- evidence and claims ----------
def test_evidence_summary_marks_missing_and_shows_file_details():
    did = "DEMO-DSP-1045"
    summary = client.get(f"/api/disputes/{did}/evidence-summary").json()
    assert {"seller", "buyer", "records"} <= set(summary)
    assert all(i["status"] == "MISSING" and i["detail"] for i in summary["buyer"] if not i["evidence_id"])

    _ask(did, ASK_BUYER, ["BUYER_CAMERA_FOOTAGE"])
    msg = client.get(f"/api/disputes/{did}/messages").json()[-1]
    client.post(f"/api/messages/{msg['id']}/simulate-reply")
    footage = next(i for i in client.get(f"/api/disputes/{did}/evidence-summary").json()["buyer"] if i["evidence_type"] == "BUYER_CAMERA_FOOTAGE")
    assert footage["status"] == "PROVIDED" and footage["file_name"].endswith(".mp4") and footage["size_bytes"]


def test_claim_points_pick_up_what_the_buyer_says():
    d = _dispute("DEMO-DSP-1042")  # "Front porch camera shows no carrier delivery..."
    footage = next(p for p in d["claim_points"] if p["key"] == "footage")
    assert footage["on_file"] is False and footage["party"] == "BUYER" and "camera" in footage["quote"].lower()
    filed = next(e for e in client.get("/api/disputes/DEMO-DSP-1042/timeline").json() if e["event_type"] == "DISPUTE")
    assert any(p["key"] == "footage" for p in filed["claim_points"])


# ---------- ownership ----------
def test_assign_and_filter_your_cases():
    r = client.post("/api/disputes/DEMO-DSP-1051/assign", json={"assignee": "Abhinav Chitturi"})
    assert r.status_code == 200
    mine = client.get("/api/disputes", params={"assigned_to": "Abhinav Chitturi"}).json()
    assert "DEMO-DSP-1051" in {d["id"] for d in mine} and all(d["assigned_to"] == "Abhinav Chitturi" for d in mine)
    summary = client.get("/api/dashboard/summary", params={"assignee": "Abhinav Chitturi"}).json()
    assert summary["my_cases_count"] >= 1
    assert client.post("/api/disputes/DEMO-DSP-1051/assign", json={"assignee": None}).json()["assigned_to"] is None


# ---------- previews ----------
def test_documents_have_a_preview_and_videos_do_not():
    did = "DEMO-DSP-1045"
    _ask(did, ASK_BUYER, ["BUYER_CAMERA_FOOTAGE", "BUYER_STATEMENT"])
    msg = [m for m in client.get(f"/api/disputes/{did}/messages").json() if m["awaiting_reply"]][-1]
    client.post(f"/api/messages/{msg['id']}/simulate-reply")
    buyer = {i["evidence_type"]: i for i in client.get(f"/api/disputes/{did}/evidence-summary").json()["buyer"]}
    video, statement = buyer["BUYER_CAMERA_FOOTAGE"], buyer["BUYER_STATEMENT"]
    assert video["is_video"] and video["preview"] is None
    assert client.get(f"/api/evidence/{video['evidence_id']}/preview").status_code == 404
    assert statement["preview"] == "DOCUMENT"
    doc = client.get(f"/api/evidence/{statement['evidence_id']}/preview")
    assert doc.status_code == 200 and doc.headers["content-type"].startswith("text/html")
    assert "sandbox" in doc.headers["content-security-policy"] and "Generated by the demo" in doc.text


def test_a_seller_document_is_built_from_the_case_records():
    did = "DEMO-DSP-1042"
    seller = {i["evidence_type"]: i for i in client.get(f"/api/disputes/{did}/evidence-summary").json()["seller"]}
    tracking = seller["CARRIER_TRACKING"]
    assert tracking["preview"] == "DOCUMENT"
    html = client.get(f"/api/evidence/{tracking['evidence_id']}/preview").text
    assert "Carrier scan history" in html and "1Z9999999999999999" in html


def test_missing_evidence_has_no_preview():
    assert client.get("/api/evidence/NOPE/preview").status_code == 404


def test_deciding_a_case_nobody_owned_makes_it_yours():
    client.post("/api/disputes/DEMO-DSP-1048/assign", json={"assignee": None})
    assert _propose("DEMO-DSP-1048").status_code == 200
    assert _dispute("DEMO-DSP-1048")["assigned_to"] == "Abhinav Chitturi"
