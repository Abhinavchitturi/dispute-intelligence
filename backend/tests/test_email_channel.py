"""Sellers and buyers don't use this app. Requests go to them by email, and their replies come back by email to be recorded."""
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.models.team import Email, User
from backend.app.services import email_service
from backend.app.services.appeal_service import case_id_in

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
DID = "DEMO-DSP-1054"


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", False)
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 999)
    monkeypatch.setattr(settings, "INBOUND_MAIL_SECRET", "mail-secret")


def _addr(did, party):
    db = SessionLocal()
    try:
        d = db.query(Dispute).filter(Dispute.id == did).first()
        return email_service.seller_address(d) if party == "SELLER" else email_service.buyer_address(d)
    finally:
        db.close()


def _ask(did, party, items, message="Please send what you have."):
    action = "REQUEST_SELLER_EVIDENCE" if party == "SELLER" else "REQUEST_BUYER_EVIDENCE"
    r = client.post(f"/api/disputes/{did}/actions/execute", json={"action_type": action, "confirmed": True, "message": message, "requested_evidence": items, "deadline_days": 4})
    assert r.status_code == 200, r.text
    return r.json()


def _mail(did, from_address, subject=None, body="Here you go.", attachments=()):
    return client.post("/api/inbound-mail", headers={"X-Inbound-Secret": "mail-secret"},
                       json={"from_address": from_address, "subject": subject or f"Re: [{did}] Evidence request", "body": body, "attachments": list(attachments)})


def _msgs(did):
    return client.get(f"/api/disputes/{did}/messages").json()


def _case(did):
    return client.get(f"/api/disputes/{did}").json()


# ---------- out: the request is emailed ----------
def test_an_evidence_request_is_emailed_to_the_seller_with_the_case_number_and_how_to_reply():
    _ask(DID, "SELLER", ["PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION"])
    mails = [m for m in client.get(f"/api/disputes/{DID}/emails").json() if m["direction"] == "OUT" and m["party"] == "SELLER"]
    assert len(mails) == 1
    m = mails[0]
    assert m["to"] == _addr(DID, "SELLER") and m["to"].endswith("@sellers.example")
    assert m["subject"].startswith(f"[{DID}]")
    assert "Please send what you have." in m["body"]
    assert "Proof of delivery signature" in m["body"] and "Address verification" in m["body"]       # what is needed, by name
    assert f"Keep [{DID}] in the subject" in m["body"] and "attach the documents" in m["body"]
    assert m["status"] == "QUEUED"                                                                 # no mail server here, so kept and not sent
    msg = [x for x in _msgs(DID) if x["direction"] == "OUTBOUND"][-1]
    assert msg["emailed_to"] == m["to"] and msg["email_status"] == "QUEUED"                         # the chat says where it went


def test_a_buyer_request_goes_to_the_buyer_and_the_two_are_separate_emails():
    _ask(DID, "BUYER", ["BUYER_STATEMENT"])
    out = {m["party"]: m for m in client.get(f"/api/disputes/{DID}/emails").json() if m["direction"] == "OUT"}
    assert out["BUYER"]["to"].endswith("@buyers.example") and out["SELLER"]["to"].endswith("@sellers.example")
    assert "Written statement" in out["BUYER"]["body"] and "Written statement" not in out["SELLER"]["body"]


def test_with_a_mail_server_it_is_sent(monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=0): sent.append(("connect", host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): pass
        def login(self, u, p): sent.append(("login", u))
        def send_message(self, msg): sent.append(("send", msg["To"], msg["Subject"]))

    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(settings, "SMTP_USERNAME", "robot")
    monkeypatch.setattr("backend.app.services.email_service.smtplib.SMTP", FakeSMTP)
    _ask("DEMO-DSP-1057", "SELLER", ["CARRIER_TRACKING"])
    assert ("send", _addr("DEMO-DSP-1057", "SELLER"), "[DEMO-DSP-1057] " + [x for x in _msgs("DEMO-DSP-1057") if x["direction"] == "OUTBOUND"][-1]["subject"]) in sent
    assert [x for x in _msgs("DEMO-DSP-1057") if x["direction"] == "OUTBOUND"][-1]["email_status"] == "SENT"


def test_a_failing_mail_server_never_stops_the_request(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.test")

    class Boom:
        def __init__(self, *a, **k): raise OSError("connection refused")

    monkeypatch.setattr("backend.app.services.email_service.smtplib.SMTP", Boom)
    _ask("DEMO-DSP-1060", "SELLER", ["CARRIER_TRACKING"])
    msg = [x for x in _msgs("DEMO-DSP-1060") if x["direction"] == "OUTBOUND"][-1]
    assert msg["email_status"] == "FAILED" and _case("DEMO-DSP-1060")["status"] == "WAITING_FOR_SELLER_RESPONSE"


# ---------- in: the reply lands on the case ----------
def test_an_emailed_reply_lands_on_the_case_unread_and_needs_going_through():
    out = _mail(DID, _addr(DID, "SELLER"), body="Signature attached. We have no address check.", attachments=["signature.pdf"])
    assert out.status_code == 200 and out.json()["reply_recorded_for"] == DID
    reply = [m for m in _msgs(DID) if m["direction"] == "INBOUND" and m["counterparty"] == "SELLER"][-1]
    assert reply["source"] == "email" and reply["is_read"] is False and reply["needs_recording"] is True
    assert reply["attachments"] == ["signature.pdf"] and "Signature attached" in reply["body"]
    # Nothing counts as received until someone has looked.
    assert not [e for e in _case(DID)["evidence_items"] if e["evidence_type"] == "PROOF_OF_DELIVERY_SIGNATURE" and e["availability_status"] == "AVAILABLE"]
    assert _case(DID)["status"] == "WAITING_FOR_BOTH_RESPONSES" or _case(DID)["status"].startswith("WAITING")
    assert any(e["action"] == "EMAIL_REPLY_RECEIVED" for e in client.get("/api/audit-events", params={"dispute_id": DID}).json())
    assert any(e["direction"] == "IN" for e in client.get(f"/api/disputes/{DID}/emails").json())


def test_the_owner_is_told_a_reply_arrived():
    db = SessionLocal()
    try:
        owner = db.query(User).filter(User.display_name == _case(DID)["assigned_to"]).first()
        from backend.app.models.team import Notification
        titles = [n.title for n in db.query(Notification).filter(Notification.user_id == owner.id).all()]
    finally:
        db.close()
    assert f"The seller replied on {DID}" in titles


def test_going_through_a_reply_records_what_came_and_what_did_not():
    reply = next(m for m in _msgs(DID) if m["direction"] == "INBOUND" and m["needs_recording"])
    # Only things that were asked for can be recorded.
    bad = client.post(f"/api/disputes/{DID}/replies/{reply['id']}/record", json={"provided": [{"evidence_type": "BUYER_STATEMENT"}]})
    assert bad.status_code == 400 and "wasn't one of the things asked for" in bad.json()["detail"]
    r = client.post(f"/api/disputes/{DID}/replies/{reply['id']}/record", json={"provided": [{"evidence_type": "PROOF_OF_DELIVERY_SIGNATURE", "file_name": "signature.pdf"}], "note": "Signature only."})
    assert r.status_code == 200 and r.json()["needs_recording"] is False
    assert r.json()["provided_evidence"] == ["PROOF_OF_DELIVERY_SIGNATURE"] and r.json()["unavailable_evidence"] == ["ADDRESS_VERIFICATION"]
    summary = {i["evidence_type"]: i for i in client.get(f"/api/disputes/{DID}/evidence-summary").json()["seller"]}
    sig, addr = summary["PROOF_OF_DELIVERY_SIGNATURE"], summary["ADDRESS_VERIFICATION"]
    assert sig["status"] == "PROVIDED" and sig["file_name"] == "signature.pdf" and sig["content_type"] == "application/pdf" and "by email" not in (sig["detail"] or "")
    assert addr["status"] == "MISSING" and "can't provide" in addr["detail"]                       # asked, and they didn't send it
    assert not [m for m in _msgs(DID) if m["direction"] == "OUTBOUND" and m["counterparty"] == "SELLER" and m["awaiting_reply"]]   # the seller's request is answered
    assert any(e["action"] == "REPLY_RECORDED" for e in client.get("/api/audit-events", params={"dispute_id": DID}).json())
    again = client.post(f"/api/disputes/{DID}/replies/{reply['id']}/record", json={"provided": []})
    assert again.status_code == 400 and "already been gone through" in again.json()["detail"]


def test_once_every_request_is_recorded_the_case_is_ready_to_decide():
    buyer_reply = _mail(DID, _addr(DID, "BUYER"), body="My statement is below.")
    assert buyer_reply.json()["reply_recorded_for"] == DID
    reply = next(m for m in _msgs(DID) if m["direction"] == "INBOUND" and m["counterparty"] == "BUYER" and m["needs_recording"])
    assert _case(DID)["status"] == "WAITING_FOR_BUYER_RESPONSE"
    client.post(f"/api/disputes/{DID}/replies/{reply['id']}/record", json={"provided": [{"evidence_type": "BUYER_STATEMENT", "description": "Typed statement in the email body."}]})
    assert _case(DID)["status"] == "UNDER_REVIEW"
    st = next(i for i in client.get(f"/api/disputes/{DID}/evidence-summary").json()["buyer"] if i["evidence_type"] == "BUYER_STATEMENT")
    assert st["status"] == "PROVIDED" and "Typed statement" in st["description"]


# ---------- in: who it is from matters ----------
def test_email_from_a_stranger_is_kept_but_changes_nothing():
    did = "DEMO-DSP-1057"
    before = len(_msgs(did))
    out = _mail(did, "random@elsewhere.example", body="Hello?").json()
    assert out["opened"] is False and out.get("reply_recorded_for") is None
    assert len(_msgs(did)) == before
    assert any(e["direction"] == "IN" and e["from"] == "random@elsewhere.example" for e in client.get(f"/api/disputes/{did}/emails").json())


def test_a_reply_when_nothing_was_asked_is_filed_but_has_nothing_to_record():
    did = "DEMO-DSP-1061"
    out = _mail(did, _addr(did, "BUYER"), body="Any news on my case?").json()
    reply = next(m for m in _msgs(did) if m["id"] == out["message_id"])
    assert reply["needs_recording"] is False and reply["source"] == "email"
    assert client.post(f"/api/disputes/{did}/replies/{reply['id']}/record", json={"provided": []}).status_code == 400


def test_an_email_about_a_decided_case_is_still_a_request_for_a_second_look():
    did = "DEMO-DSP-1067"            # decided before the demo started
    out = _mail(did, _addr(did, "BUYER"), subject=f"Re: Decision on dispute {did}", body="Please look again.").json()
    assert out["opened"] is True and out["appeal_id"] == f"{did}-A1"


def test_a_reply_to_an_appeal_email_is_matched_to_the_appeal_not_the_original():
    assert case_id_in("Re: [DEMO-DSP-1067-A1] Evidence request") == "DEMO-DSP-1067-A1"
    assert case_id_in("Re: [DEMO-DSP-1067] Evidence request") == "DEMO-DSP-1067"
    assert case_id_in("no case here") is None


def test_the_demo_button_sends_an_email_reply_in_the_same_way():
    did = "DEMO-DSP-1062"
    _ask(did, "SELLER", ["CARRIER_TRACKING"])
    r = client.post(f"/api/disputes/{did}/inbound/simulate", json={"party": "SELLER", "body": "Tracking is attached.", "attachments": ["tracking.pdf"]})
    assert r.status_code == 200 and r.json()["reply_recorded_for"] == did
    reply = [m for m in _msgs(did) if m["direction"] == "INBOUND"][-1]
    assert reply["needs_recording"] and reply["attachments"] == ["tracking.pdf"]
    assert client.post(f"/api/disputes/{did}/inbound/simulate", json={"party": "NOBODY"}).status_code == 400


def test_the_demo_does_not_invent_a_reply_when_a_real_email_is_already_waiting(monkeypatch):
    from backend.app.models.message import DisputeMessage
    from backend.app.services.message_service import MessageService
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 0)
    did = "DEMO-DSP-1064"
    _ask(did, "SELLER", ["CARRIER_TRACKING"])
    _mail(did, _addr(did, "SELLER"), body="Tracking attached.", attachments=["t.pdf"])
    db = SessionLocal()
    try:
        MessageService.deliver_due(db, did)
    finally:
        db.close()
    inbound = [m for m in _msgs(did) if m["direction"] == "INBOUND"]
    assert len(inbound) == 1 and inbound[0]["source"] == "email"
