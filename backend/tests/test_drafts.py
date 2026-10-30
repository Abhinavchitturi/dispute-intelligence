import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.services.ai_service import AIService
from backend.app.services.citation_validator import CitationValidator
from backend.app.services.draft_service import DraftService

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
SIGNATURE, ADDRESS = "PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION"


def _draft(did, action, **extra):
    r = client.post(f"/api/disputes/{did}/actions/draft", json={"action_type": action, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _valid_ids(did):
    db = SessionLocal()
    try:
        return CitationValidator.extract_valid_record_ids(AIService.build_case_context(db.get(Dispute, did)))
    finally:
        db.close()


def _set_address(did, value):
    db = SessionLocal()
    try:
        db.get(Dispute, did).order.shipment.delivery_address_match = value
        db.commit()
    finally:
        db.close()


@pytest.mark.parametrize("action,recipient", [
    ("REQUEST_SELLER_EVIDENCE", "Seller"), ("REQUEST_BUYER_EVIDENCE", "Buyer"),
    ("DECIDE_FOR_BUYER", "Seller and buyer"), ("DECIDE_FOR_SELLER", "Seller and buyer"),
])
def test_every_action_has_a_draft_that_cites_only_real_records(action, recipient):
    d = _draft("DEMO-DSP-1043", action, requested_evidence=[SIGNATURE] if action == "REQUEST_SELLER_EVIDENCE" else ["BUYER_STATEMENT"])
    assert d["source"] == "rules" and d["recipient"] == recipient
    assert d["subject"] and d["body"]
    assert set(d["cited_record_ids"]) <= _valid_ids("DEMO-DSP-1043")
    assert "DEMO-DSP-1043" in d["body"]


def test_seller_request_lays_out_what_paypal_has_and_what_it_needs():
    d = _draft("DEMO-DSP-1042", "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE, ADDRESS], deadline_days=3)
    body = d["body"]
    headings = ["WHY WE'RE WRITING", "WHAT WE ALREADY HAVE", "WHAT WE NEED FROM YOU", "PLEASE RESPOND BY"]
    positions = [body.index(h) for h in headings]
    assert positions == sorted(positions)
    assert "The buyer opened a dispute (item not received)" in body and "Front porch camera" in body  # the claim, so the seller can answer it
    assert "Carrier status: Delivered" in body and "Delivery address: not confirmed" in body
    assert "1. Proof of delivery signature: Shows who received the package." in body
    assert "2. Address verification: Confirms the carrier delivered to the address on the order." in body
    assert not d["warnings"]
    assert any("due" in n for n in d["notes"])


def test_buyer_request_asks_only_for_what_was_selected_and_hides_nothing_the_buyer_should_see():
    d = _draft("DEMO-DSP-1042", "REQUEST_BUYER_EVIDENCE", requested_evidence=["BUYER_CAMERA_FOOTAGE", "DELIVERY_ADDRESS_CONFIRMATION"])
    body = d["body"]
    assert body.startswith("Hello,") and "WHAT YOU TOLD US" in body
    assert "The carrier shows the shipment as delivered" in body and "couldn't confirm it reached the address" in body
    assert "1. Camera footage:" in body and "2. Delivery address confirmation:" in body
    assert "BUYER_STATEMENT" not in body and "Written statement" not in body
    # Nothing the seller might have said or sent is repeated to the buyer.
    assert "signature" not in body.lower()


def test_a_request_with_nothing_selected_is_flagged():
    d = _draft("DEMO-DSP-1043", "REQUEST_SELLER_EVIDENCE", requested_evidence=[])
    assert any("at least one item" in w for w in d["warnings"])


def test_the_decision_notice_shows_the_evidence_from_both_sides_and_what_is_missing():
    did = "DEMO-DSP-1044"
    client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": "REQUEST_BUYER_EVIDENCE", "confirmed": True, "message": "m", "requested_evidence": ["BUYER_CAMERA_FOOTAGE"]})
    sent = client.get(f"/api/disputes/{did}/messages").json()[0]
    client.post(f"/api/messages/{sent['id']}/simulate-reply")

    d = _draft(did, "DECIDE_FOR_BUYER")
    body = d["body"]
    headings = ["DECISION", "WHAT WE REVIEWED", "REASON", "WHAT HAPPENS NEXT"]
    positions = [body.index(h) for h in headings]
    assert positions == sorted(positions)
    assert "Resolved in the buyer's favor." in body
    assert "- Provided by buyer: Camera footage [DEMO-EVID-" in body
    # The app can't see inside a video, so it must not say what the footage shows.
    assert "- The buyer provided camera footage for the delivery window." in body
    assert "shows no delivery" not in body
    assert any("can't watch footage" in n for n in d["notes"])
    assert "- The buyer is refunded USD 320.00." in body and "- The seller is debited USD 320.00." in body
    assert d["recipient"] == "Seller and buyer" and any("both the seller and the buyer" in n for n in d["notes"])
    assert any("can't be undone" in w for w in d["warnings"])


def test_decisions_push_back_when_they_contradict_the_records():
    _set_address("DEMO-DSP-1046", "yes")
    for_buyer = _draft("DEMO-DSP-1046", "DECIDE_FOR_BUYER")
    assert any("matching address" in w for w in for_buyer["warnings"])
    for_seller = _draft("DEMO-DSP-1046", "DECIDE_FOR_SELLER")
    assert not any("hard to support" in w for w in for_seller["warnings"])
    assert "- The carrier delivered to the address on the order." in for_seller["body"]

    _set_address("DEMO-DSP-1047", "unknown")
    weak = _draft("DEMO-DSP-1047", "DECIDE_FOR_SELLER")
    assert any("hard to support" in w for w in weak["warnings"])


def test_deciding_warns_that_open_requests_will_be_closed():
    did = "DEMO-DSP-1048"
    client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "message": "m", "requested_evidence": [SIGNATURE]})
    d = _draft(did, "DECIDE_FOR_SELLER")
    assert any("1 evidence request is still waiting" in w for w in d["warnings"])
    # And asking the same party twice is flagged too.
    again = _draft(did, "REQUEST_SELLER_EVIDENCE", requested_evidence=[ADDRESS])
    assert any("already an open request to the seller" in w for w in again["warnings"])


def test_asking_for_something_already_on_file_is_flagged():
    d = _draft("DEMO-DSP-1042", "REQUEST_SELLER_EVIDENCE", requested_evidence=["CARRIER_TRACKING"])
    assert any("already on file" in w for w in d["warnings"])


RETURN_RECEIPT, REFUND_RECORD, RETURN_PROOF = "RETURN_RECEIPT", "REFUND_RECORD", "BUYER_RETURN_PROOF"


def _options(did):
    o = client.get(f"/api/disputes/{did}/evidence-requests/options").json()
    return {k: {i["evidence_type"]: i for i in v} for k, v in o.items()}


def _reply_to(did, action, items):
    sent = client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": action, "confirmed": True, "message": "m", "requested_evidence": items}).json()
    return client.post(f"/api/messages/{sent['message_id']}/simulate-reply").json()


def test_a_return_claim_asks_about_the_return_and_the_refund_not_the_original_delivery():
    o = _options("DEMO-DSP-1050")  # CANCELLED_OR_RETURNED: "returned the package, never got my refund"
    assert list(o["seller"]) == [REFUND_RECORD, RETURN_RECEIPT, "MERCHANT_CORRESPONDENCE"]
    assert not {SIGNATURE, ADDRESS, "CARRIER_TRACKING"} & set(o["seller"])  # the delivery questions don't apply
    assert o["seller"][REFUND_RECORD]["suggested"] and o["seller"][RETURN_RECEIPT]["suggested"]  # worth asking even though the case doesn't list them as missing
    assert list(o["buyer"]) == [RETURN_PROOF, "BUYER_STATEMENT"]
    # A delivery claim is unchanged.
    assert SIGNATURE in _options("DEMO-DSP-1043")["seller"] and REFUND_RECORD not in _options("DEMO-DSP-1043")["seller"]


def test_return_replies_follow_the_facts_on_file():
    # The case holds return tracking showing arrival, so the seller can confirm receipt, but has no refund record to send.
    seller = _reply_to("DEMO-DSP-1050", "REQUEST_SELLER_EVIDENCE", [REFUND_RECORD, RETURN_RECEIPT])
    assert seller["provided_evidence"] == [RETURN_RECEIPT] and seller["unavailable_evidence"] == [REFUND_RECORD]
    assert "- Refund record: we don't have this." in seller["body"]
    buyer = _reply_to("DEMO-DSP-1050", "REQUEST_BUYER_EVIDENCE", [RETURN_PROOF])
    assert buyer["provided_evidence"] == [RETURN_PROOF] and "Return shipping receipt" in buyer["body"]


def test_a_return_decision_reasons_about_the_return_and_never_cites_the_original_delivery():
    d = _draft("DEMO-DSP-1050", "DECIDE_FOR_BUYER")
    body = d["body"]
    reason = body.split("REASON")[1].split("WHAT HAPPENS NEXT")[0]
    assert "Return tracking shows the return arriving at the seller." in reason
    assert "The seller didn't show a refund for the returned item." in reason
    for delivery_talk in ("delivered to the address", "signature", "address check"):
        assert delivery_talk not in reason
    assert "- Original shipment, carrier status:" in body and "- Carrier status:" not in body  # the shipment is labelled as the original one
    assert not any("hard to support" in w for w in d["warnings"])

    # Deciding the other way is flagged: the return arrived and no refund was shown.
    for_seller = _draft("DEMO-DSP-1050", "DECIDE_FOR_SELLER")
    assert any("return is shown arriving" in w for w in for_seller["warnings"])


def test_the_decision_shows_what_points_each_way_without_picking_a_winner():
    b = _draft("DEMO-DSP-1050", "DECIDE_FOR_BUYER")["evidence_balance"]
    assert "Return tracking shows the return arriving at the seller" in b["toward_buyer"]
    assert "The seller has shown no refund" in b["toward_buyer"]
    assert b["toward_seller"] == []                     # nothing on the seller's side, and it says so rather than inventing something
    assert b["other"] == []
    # Same facts whichever decision you're looking at: it's a summary of the records, not a verdict.
    assert _draft("DEMO-DSP-1050", "DECIDE_FOR_SELLER")["evidence_balance"] == b

    # A delivery claim sorts its own facts: delivered and matching address help the seller, an unconfirmed address helps the buyer.
    _set_address("DEMO-DSP-1046", "yes")
    seller_side = _draft("DEMO-DSP-1046", "DECIDE_FOR_SELLER")["evidence_balance"]
    assert "The delivery address matches the order" in seller_side["toward_seller"] and "The buyer sent no evidence beyond their claim" in seller_side["toward_seller"]
    _set_address("DEMO-DSP-1046", "unknown")
    assert "Delivery to the address on the order isn't confirmed" in _draft("DEMO-DSP-1046", "DECIDE_FOR_BUYER")["evidence_balance"]["toward_buyer"]
    # Asking for something the seller then couldn't provide counts toward the buyer's side.
    _reply_to("DEMO-DSP-1046", "REQUEST_SELLER_EVIDENCE", [SIGNATURE])
    assert "The seller couldn't provide proof of delivery signature" in _draft("DEMO-DSP-1046", "DECIDE_FOR_BUYER")["evidence_balance"]["toward_buyer"]

    # Requests have no balance. Only decisions do.
    assert _draft("DEMO-DSP-1042", "REQUEST_SELLER_EVIDENCE", requested_evidence=[SIGNATURE])["evidence_balance"] is None


def test_a_single_piece_of_evidence_on_file_is_enough_to_decide_on():
    """A case already holding one concrete document, with nobody asked for anything, must produce a complete notice."""
    did = "DEMO-DSP-1051"  # seeded OPEN with only the evidence it arrived with, and untouched by the other tests in this file
    detail = client.get(f"/api/disputes/{did}").json()
    assert detail["status"] == "OPEN"
    on_file = [e for e in detail["evidence_items"] if e["availability_status"] == "AVAILABLE"]
    assert on_file, "fixture should have at least one document on file"

    for action in ("DECIDE_FOR_BUYER", "DECIDE_FOR_SELLER"):
        d = _draft(did, action)
        body = d["body"]
        assert "- On file: " in body.split("WHAT WE REVIEWED")[1].split("REASON")[0]  # the document is named in what was reviewed
        assert on_file[0]["id"] in body and on_file[0]["id"] in d["cited_record_ids"]
        assert body.split("REASON")[1].split("WHAT HAPPENS NEXT")[0].strip().startswith("-")  # a reason is always given
        assert set(d["cited_record_ids"]) <= _valid_ids(did)

    # And it can actually be sent: deciding needs no request to either party first.
    from backend.tests.helpers import decide
    assert decide(client, did, "SELLER_FAVOR")["outcome"] == "SELLER_FAVOR"


def test_unknown_action_and_dispute_are_rejected():
    assert client.post("/api/disputes/DEMO-DSP-1042/actions/draft", json={"action_type": "NOPE"}).status_code == 400
    assert client.post("/api/disputes/NOPE/actions/draft", json={"action_type": "DECIDE_FOR_BUYER"}).status_code == 404


def test_the_approved_wording_is_what_gets_stored():
    msg = "Approved wording from the investigator."
    r = client.post("/api/disputes/DEMO-DSP-1049/actions/execute", json={
        "action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "message": msg, "subject": "My subject", "requested_evidence": [SIGNATURE]})
    assert r.status_code == 200
    stored = next(m for m in client.get("/api/disputes/DEMO-DSP-1049/messages").json() if m["id"] == r.json()["message_id"])
    assert stored["body"] == msg and stored["subject"] == "My subject" and stored["counterparty"] == "SELLER"


@pytest.mark.asyncio
async def test_llm_wording_is_used_only_when_it_cites_real_records(monkeypatch):
    monkeypatch.setattr(settings, "AI_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")
    db = SessionLocal()
    try:
        dispute = db.get(Dispute, "DEMO-DSP-1043")

        async def good(context, draft):
            return {"subject": "Polished", "body": "Polished body", "cited_record_ids": ["DEMO-DSP-1043"]}
        monkeypatch.setattr(DraftService, "_call_llm", classmethod(lambda cls, c, d: good(c, d)))
        ok = await DraftService.generate(dispute, "DECIDE_FOR_SELLER")
        assert ok.source == "llm" and ok.body == "Polished body"

        async def bad(context, draft):
            return {"subject": "x", "body": "Invented", "cited_record_ids": ["TRK-FAKE"]}
        monkeypatch.setattr(DraftService, "_call_llm", classmethod(lambda cls, c, d: bad(c, d)))
        rejected = await DraftService.generate(dispute, "DECIDE_FOR_SELLER")
        assert rejected.source == "rules" and "Invented" not in rejected.body
        assert any("rejected" in w for w in rejected.warnings)

        async def boom(context, draft):
            raise RuntimeError("provider down")
        monkeypatch.setattr(DraftService, "_call_llm", classmethod(lambda cls, c, d: boom(c, d)))
        assert (await DraftService.generate(dispute, "DECIDE_FOR_SELLER")).source == "rules"
    finally:
        db.close()
