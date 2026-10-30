import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.config import settings
from backend.app.database import Base, SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.seed.seed_data import SEED_VERSION, ensure_seed_current

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
SIGNATURE, ADDRESS, TRACKING = "PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION", "CARRIER_TRACKING"
FOOTAGE, BUYER_ADDR = "BUYER_CAMERA_FOOTAGE", "DELIVERY_ADDRESS_CONFIRMATION"


@pytest.fixture(autouse=True)
def slow_replies(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 999)  # replies land only when a test says so


def _set_address(did, value):
    db = SessionLocal()
    try:
        db.get(Dispute, did).order.shipment.delivery_address_match = value
        db.commit()
    finally:
        db.close()


def _act(did, action, message="Message text", **extra):
    r = client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": action, "confirmed": True, "message": message, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _reply(message_id):
    r = client.post(f"/api/messages/{message_id}/simulate-reply")
    assert r.status_code == 200, r.text
    return r.json()


def _dispute(did):
    return client.get(f"/api/disputes/{did}").json()


def _messages(did):
    return client.get(f"/api/disputes/{did}/messages").json()


def _thread(did):
    return next((t for t in client.get("/api/message-threads").json() if t["dispute_id"] == did), None)


def _evidence(did):
    return {e["evidence_type"]: e for e in client.get(f"/api/disputes/{did}/evidence").json()}


def test_every_case_the_demo_starts_as_ready_to_decide_has_earned_it():
    """Ready means both the seller and the buyer have answered. The demo data must not claim otherwise."""
    ready = [d for d in client.get("/api/disputes", params={"limit": 200}).json() if d["status"] == "UNDER_REVIEW"]
    assert ready
    for d in ready:
        msgs = _messages(d["id"])
        asked = {m["counterparty"] for m in msgs if m["direction"] == "OUTBOUND" and m["action_type"] in ("REQUEST_SELLER_EVIDENCE", "REQUEST_BUYER_EVIDENCE")}
        answered = {m["counterparty"] for m in msgs if m["direction"] == "INBOUND"}
        # (A case that became ready during these tests did so through real replies, which is the same rule.)
        assert {"SELLER", "BUYER"} <= asked and {"SELLER", "BUYER"} <= answered, f"{d['id']} says Ready to decide but nobody has answered both requests"
        assert not any(m["awaiting_reply"] for m in msgs if m["direction"] == "OUTBOUND")


def test_a_new_case_starts_open_with_nobody_asked():
    d = _dispute("DEMO-DSP-1042")
    assert d["status"] == "OPEN" and d["outcome"] is None
    assert _messages("DEMO-DSP-1042") == [] and _thread("DEMO-DSP-1042") is None


def test_requesting_evidence_from_the_seller_stores_the_message_and_makes_the_case_wait_on_them():
    did = "DEMO-DSP-1046"
    sent = _act(did, "REQUEST_SELLER_EVIDENCE", "Please send these.", requested_evidence=[SIGNATURE, ADDRESS], deadline_days=3)
    assert sent["details"] == {"new_status": "WAITING_FOR_SELLER_RESPONSE", "requested_evidence": [SIGNATURE, ADDRESS]}

    (msg,) = _messages(did)
    assert msg["direction"] == "OUTBOUND" and msg["counterparty"] == "SELLER" and msg["body"] == "Please send these."
    assert msg["requested_evidence"] == [SIGNATURE, ADDRESS] and msg["awaiting_reply"] is True
    assert msg["deadline"] and msg["deadline"][:4] == str(datetime.utcnow().year)

    t = _thread(did)
    assert t["state"] == "WAITING" and t["waiting_on"] == "Seller" and t["pending_message_ids"] == [msg["id"]]
    assert t["expected_reply_at"] and t["unread_count"] == 0 and t["outcome"] is None
    assert _dispute(did)["status"] == "WAITING_FOR_SELLER_RESPONSE"


def test_the_seller_provides_what_they_can_and_the_case_is_in_progress():
    did = "DEMO-DSP-1046"  # continues the case above
    _set_address(did, "yes")
    (msg,) = [m for m in _messages(did) if m["direction"] == "OUTBOUND"]
    reply = _reply(msg["id"])

    assert reply["direction"] == "INBOUND" and reply["counterparty"] == "SELLER" and reply["source"] == "synthetic"
    assert reply["provided_evidence"] == [SIGNATURE, ADDRESS] and reply["unavailable_evidence"] == []
    assert reply["in_reply_to"] == msg["id"] and reply["is_read"] is False
    assert "WHAT WE'RE SENDING" in reply["body"] and "WHAT WE CAN'T PROVIDE" not in reply["body"]

    ev = _evidence(did)
    for t in (SIGNATURE, ADDRESS):
        assert ev[t]["availability_status"] == "AVAILABLE" and ev[t]["description"].startswith("Provided by seller:")
    assert _dispute(did)["status"] == "IN_PROGRESS"                    # only the seller has answered, so it isn't ready to decide yet
    assert _thread(did)["state"] == "IN_PROGRESS" and _thread(did)["unread_count"] == 1
    assert any(e["action"] == "REPLY_RECEIVED" and "seller" in e["result_summary"] for e in client.get(f"/api/audit-events?dispute_id={did}").json())

    assert client.post(f"/api/disputes/{did}/messages/read").json()["marked_read"] == 1
    assert _thread(did)["unread_count"] == 0
    assert client.post(f"/api/messages/{msg['id']}/simulate-reply").status_code == 400  # answered only once


def test_the_seller_cannot_produce_a_signature_when_the_carrier_never_confirmed_the_address():
    did = "DEMO-DSP-1053"
    _set_address(did, "unknown")
    sent = _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE, TRACKING])
    reply = _reply(sent["message_id"])
    assert reply["provided_evidence"] == [TRACKING] and reply["unavailable_evidence"] == [SIGNATURE]
    assert "- Proof of delivery signature: we don't have this." in reply["body"]
    ev = _evidence(did)
    assert SIGNATURE not in ev or ev[SIGNATURE]["availability_status"] != "AVAILABLE"  # nothing was invented
    assert ev[TRACKING]["availability_status"] == "AVAILABLE"  # what they could provide was recorded
    assert _dispute(did)["status"] == "IN_PROGRESS"  # the seller answered, but the buyer hasn't been asked


def test_the_buyer_supplies_footage_as_a_reference_and_nothing_is_stored_as_a_file():
    did = "DEMO-DSP-1058"
    sent = _act(did, "REQUEST_BUYER_EVIDENCE", requested_evidence=[FOOTAGE, BUYER_ADDR])
    assert _dispute(did)["status"] == "WAITING_FOR_BUYER_RESPONSE"
    reply = _reply(sent["message_id"])
    assert reply["counterparty"] == "BUYER" and reply["provided_evidence"] == [FOOTAGE, BUYER_ADDR]

    clip = _evidence(did)[FOOTAGE]
    assert clip["availability_status"] == "AVAILABLE" and "No carrier visible" in clip["description"]
    meta = json.loads(clip["metadata_json"])
    assert meta["provided_by"] == "BUYER" and meta["content_type"] == "video/mp4" and meta["file_name"].endswith(".mp4")
    assert "stored by PayPal" in meta["storage"]
    assert _dispute(did)["status"] == "IN_PROGRESS"


def test_asking_both_sides_waits_on_both_until_each_has_answered():
    did = "DEMO-DSP-1050"
    _set_address(did, "yes")
    to_seller = _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE])
    assert _dispute(did)["status"] == "WAITING_FOR_SELLER_RESPONSE"
    to_buyer = _act(did, "REQUEST_BUYER_EVIDENCE", requested_evidence=[FOOTAGE])
    assert _dispute(did)["status"] == "WAITING_FOR_BOTH_RESPONSES"
    t = _thread(did)
    assert t["state"] == "WAITING" and t["waiting_on"] == "Seller and buyer" and len(t["pending_message_ids"]) == 2

    _reply(to_seller["message_id"])
    assert _dispute(did)["status"] == "WAITING_FOR_BUYER_RESPONSE" and _thread(did)["waiting_on"] == "Buyer"
    _reply(to_buyer["message_id"])
    assert _dispute(did)["status"] == "UNDER_REVIEW" and _thread(did)["state"] == "YOUR_TURN"


@pytest.mark.parametrize("did,action,outcome,winner", [
    ("DEMO-DSP-1051", "DECIDE_FOR_BUYER", "BUYER_FAVOR", "buyer"),
    ("DEMO-DSP-1045", "DECIDE_FOR_SELLER", "SELLER_FAVOR", "seller"),
])
def test_a_decision_resolves_the_case_and_tells_both_parties(did, action, outcome, winner):
    _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE])  # left unanswered on purpose
    from backend.tests.helpers import decide
    sent = decide(client, did, outcome)
    assert sent["status"] == "RESOLVED" and sent["outcome"] == outcome
    assert f"Resolved in the {winner}'s favor" in sent["message"]

    d = _dispute(did)
    assert d["status"] == "RESOLVED" and d["outcome"] == outcome

    notices = [m for m in _messages(did) if m["action_type"] == action]
    assert sorted(m["counterparty"] for m in notices) == ["BUYER", "SELLER"]  # one notice to each side
    assert all(f"Resolved in the {winner}'s favor" in m["body"] and not m["awaiting_reply"] for m in notices)

    # The open request no longer waits for anything, and the thread shows the case as closed.
    assert not any(m["awaiting_reply"] for m in _messages(did))
    t = _thread(did)
    assert t["state"] == "CLOSED" and t["outcome"] == outcome and t["pending_message_ids"] == []

    again = client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": "REQUEST_BUYER_EVIDENCE", "confirmed": True, "requested_evidence": [FOOTAGE]})
    assert again.status_code == 400


def test_a_reply_shows_up_by_itself_once_the_wait_is_over(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 0)
    did = "DEMO-DSP-1048"
    _act(did, "REQUEST_BUYER_EVIDENCE", requested_evidence=[BUYER_ADDR])
    msgs = _messages(did)  # reading is what delivers anything that is due
    assert [(m["direction"], m["counterparty"]) for m in msgs] == [("OUTBOUND", "BUYER"), ("INBOUND", "BUYER")]
    assert _dispute(did)["status"] == "IN_PROGRESS"


def test_the_wait_is_respected_before_the_reply_is_due(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 3600)
    did = "DEMO-DSP-1044"
    _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[TRACKING])
    assert [m["direction"] for m in _messages(did)] == ["OUTBOUND"]
    assert _thread(did)["state"] == "WAITING"


def test_real_sandbox_messages_are_never_faked():
    did = "DEMO-DSP-1059"
    db = SessionLocal()
    try:
        db.add(DisputeMessage(id="MSG-SANDBOX-1", dispute_id=did, direction="OUTBOUND", counterparty="SELLER", action_type="REQUEST_SELLER_EVIDENCE",
                              subject="s", body="b", source="paypal_sandbox", awaiting_reply=True, reply_due_at=None, created_at=datetime.utcnow()))
        db.commit()
    finally:
        db.close()
    r = client.post("/api/messages/MSG-SANDBOX-1/simulate-reply")
    assert r.status_code == 400 and "Real replies come from the seller or buyer" in r.json()["detail"]
    assert [m["direction"] for m in _messages(did)] == ["OUTBOUND"]


def test_decided_cases_from_the_seed_cannot_be_acted_on():
    for did in ("DEMO-DSP-1047", "DEMO-DSP-1052"):  # seeded as RESOLVED and CLOSED
        r = client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "message": "m", "requested_evidence": [TRACKING]})
        assert r.status_code == 400
        assert _dispute(did)["outcome"] in ("SELLER_FAVOR", "BUYER_FAVOR")


def test_unknown_messages_and_disputes_are_404():
    assert client.post("/api/messages/NOPE/simulate-reply").status_code == 404
    assert client.get("/api/disputes/NOPE/messages").status_code == 404


def test_the_evidence_checklist_suggests_what_is_missing_and_marks_what_is_on_file():
    o = client.get("/api/disputes/DEMO-DSP-1043/evidence-requests/options").json()
    seller = {i["evidence_type"]: i for i in o["seller"]}
    assert set(seller) == {SIGNATURE, ADDRESS, TRACKING, "MERCHANT_CORRESPONDENCE", "PROOF_OF_FULFILLMENT"}
    assert all({"label", "why", "on_file", "suggested"} <= set(i) for i in o["seller"])
    # NOT_AS_DESCRIBED asks the buyer for photos, not delivery footage.
    buyer = {i["evidence_type"] for i in o["buyer"]}
    assert "BUYER_PHOTOS_OF_ITEM" in buyer and FOOTAGE not in buyer
    assert next(i for i in o["buyer"] if i["evidence_type"] == "BUYER_PHOTOS_OF_ITEM")["on_file"] is True  # legacy PHOTO_PROOF counts

    not_received = client.get("/api/disputes/DEMO-DSP-1042/evidence-requests/options").json()
    assert FOOTAGE in {i["evidence_type"] for i in not_received["buyer"]}
    s42 = {i["evidence_type"]: i for i in not_received["seller"]}
    assert s42[TRACKING]["on_file"] is True and s42[TRACKING]["suggested"] is False
    assert s42[SIGNATURE]["on_file"] is False and s42[SIGNATURE]["suggested"] is True


def test_the_dashboard_counts_where_cases_stand():
    s = client.get("/api/dashboard/summary").json()
    assert s["new_cases_count"] >= 1 and s["waiting_on_parties_count"] >= 1 and s["awaiting_review_count"] >= 1
    assert s["total_open_disputes"] >= s["new_cases_count"] + s["waiting_on_parties_count"] + s["awaiting_review_count"]


def test_demo_data_from_an_older_version_is_refreshed_exactly_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        assert ensure_seed_current(db) == "seeded"          # empty database
        assert ensure_seed_current(db) == "current"         # nothing to do
        from backend.app.models.meta import AppMeta
        db.merge(AppMeta(key="seed_version", value="1"))    # pretend this database was seeded by an older version
        db.get(Dispute, "DEMO-DSP-1042").status = "WAITING_FOR_SELLER_RESPONSE"
        db.commit()
        assert ensure_seed_current(db) == "refreshed"
        assert db.get(Dispute, "DEMO-DSP-1042").status == "OPEN"
        assert db.get(AppMeta, "seed_version").value == SEED_VERSION
        assert ensure_seed_current(db) == "current"         # and not again
    finally:
        db.close()
        engine.dispose()


def test_ready_to_decide_needs_both_sides_to_have_answered():
    did = "DEMO-DSP-1054"
    _set_address(did, "yes")
    seller = _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE])
    _reply(seller["message_id"])
    assert _dispute(did)["status"] == "IN_PROGRESS"                    # the buyer has not been asked, so we are not ready
    assert _thread(did)["state"] == "IN_PROGRESS"
    buyer = _act(did, "REQUEST_BUYER_EVIDENCE", requested_evidence=[FOOTAGE])
    assert _dispute(did)["status"] == "WAITING_FOR_BUYER_RESPONSE"
    _reply(buyer["message_id"])
    assert _dispute(did)["status"] == "UNDER_REVIEW" and _thread(did)["state"] == "YOUR_TURN"      # both have answered
    assert client.get("/api/dashboard/summary").json()["awaiting_review_count"] >= 1


def test_when_time_is_up_the_case_is_ready_to_decide_even_if_only_one_side_answered():
    from backend.app.database import SessionLocal
    from backend.app.models.message import DisputeMessage
    from backend.app.services.message_service import MessageService
    did = "DEMO-DSP-1057"
    _set_address(did, "yes")
    seller = _act(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE])
    _reply(seller["message_id"])
    assert _dispute(did)["status"] == "IN_PROGRESS"
    buyer = _act(did, "REQUEST_BUYER_EVIDENCE", requested_evidence=[FOOTAGE])
    db = SessionLocal()
    try:
        m = db.get(DisputeMessage, buyer["message_id"])
        meta = m._meta()
        meta["deadline"] = "2020-01-01T00:00:00"
        m.meta_json = json.dumps(meta)
        m.reply_due_at = None
        db.commit()
        MessageService.expire_overdue(db)
    finally:
        db.close()
    assert _dispute(did)["status"] == "UNDER_REVIEW"                   # the buyer never answered, but the deadline has passed


def test_seller_notice_is_short_and_buyer_notice_carries_the_appeal_paragraph():
    from backend.app.services.message_service import short_notice
    full = "Dispute D-1 · USD 10.00\n\nDECISION\nResolved in the seller's favor.\n\nWHAT WE REVIEWED\n- Carrier status: delivered\n\nREASON\n- Delivered.\n\nWHAT HAPPENS NEXT\n- No refund.\n\nREVIEW\n- Looks right."
    short = short_notice(full)
    assert "Resolved in the seller's favor." in short and "WHAT HAPPENS NEXT" in short and "REVIEW" in short
    assert "WHAT WE REVIEWED" not in short and "REASON" not in short
