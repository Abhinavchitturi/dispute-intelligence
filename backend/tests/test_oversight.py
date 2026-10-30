"""Manager, AI reviewer, investigator: strikes, alerts, blocking, flags, training feedback, emails and appeals."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.models.team import Email, ManagerAlert, Notification, User
from backend.app.services.strike_service import StrikeService

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
INV, MGR = "Abhinav Chitturi", "PayPal"


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 999)
    monkeypatch.setattr(settings, "STRIKE_NOTIFY_THRESHOLD", 3)
    monkeypatch.setattr(settings, "STRIKE_BLOCK_THRESHOLD", 10)


def _db():
    return SessionLocal()


def _user(username):
    db = _db()
    try:
        u = db.query(User).filter(User.username == username).first()
        return u.id
    finally:
        db.close()


def _propose(did, outcome="SELLER_FAVOR", reason="The carrier delivered to the address on the order."):
    r = client.post(f"/api/disputes/{did}/decision", json={"outcome": outcome, "reason": reason, "confirmed": True, "actor": INV})
    assert r.status_code == 200, r.text


def _ai(did, verdict, outcome=None, why="The evidence on file points the other way."):
    r = client.post(f"/api/disputes/{did}/ai-verdict/simulate", json={"verdict": verdict, "outcome": outcome, "rationale": why})
    return r


def _case(did):
    return client.get(f"/api/disputes/{did}").json()


def _strikes(username="abhinav"):
    db = _db()
    try:
        return StrikeService.active_strikes(db, _user(username))
    finally:
        db.close()


# ---------- sign in ----------
def test_login_and_wrong_password():
    ok = client.post("/api/auth/login", json={"username": "paypal", "password": "PayPal#Manager2026"})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "MANAGER" and ok.json()["token"]
    for creds in ({"username": "paypal", "password": "nope"}, {"username": "ghost", "password": "x"}):
        bad = client.post("/api/auth/login", json=creds)
        assert bad.status_code == 401 and bad.json()["detail"] == "That username and password don't match."  # same message either way


def test_the_login_page_gives_nothing_away():
    assert client.get("/api/auth/demo-accounts").status_code == 404  # no list of accounts or passwords is served


def test_sign_in_is_enforced_when_switched_on(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)
    assert client.get("/api/disputes").status_code == 401
    assert client.get("/api/disputes", headers={"Authorization": "Bearer junk"}).status_code == 401
    tok = lambda u, p: {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": u, "password": p}).json()["token"]}
    inv, mgr = tok("abhinav", "Abhinav#Invest2026"), tok("paypal", "PayPal#Manager2026")
    assert client.get("/api/disputes", headers=inv).status_code == 200
    assert client.get("/api/auth/me", headers=inv).json()["name"] == INV
    # Only a manager gets the manager's pages.
    assert client.get("/api/alerts", headers=inv).status_code == 403
    assert client.get("/api/team", headers=inv).status_code == 403
    assert client.get("/api/alerts", headers=mgr).status_code == 200
    # Investigators don't pick their own cases. The manager hands them out.
    assert client.post("/api/disputes/DEMO-DSP-1043/assign", headers=mgr, json={"assignee": INV}).status_code == 200
    assert client.post("/api/disputes/DEMO-DSP-1043/assign", headers=inv, json={"assignee": "Susmitha"}).status_code == 403
    assert client.post("/api/disputes/DEMO-DSP-1043/assign", headers=inv, json={"assignee": INV}).status_code == 403  # the manager hands cases out


def test_the_actor_comes_from_the_token_not_the_request(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)
    h = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "abhinav", "password": "Abhinav#Invest2026"}).json()["token"]}
    m = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "paypal", "password": "PayPal#Manager2026"}).json()["token"]}
    client.post("/api/disputes/DEMO-DSP-1049/assign", headers=m, json={"assignee": INV})          # it has to be their case to act on it
    r = client.post("/api/disputes/DEMO-DSP-1049/decision", headers=h, json={"outcome": "SELLER_FAVOR", "reason": "The carrier delivered to the address.", "confirmed": True, "actor": "Someone Else"})
    assert r.status_code == 200
    monkeypatch.setattr(settings, "AUTH_REQUIRED", False)
    assert _case("DEMO-DSP-1049")["proposed_by"] == INV


# ---------- the AI reviewer decides ----------
def test_a_decision_waits_for_the_ai_reviewer():
    _propose("DEMO-DSP-1045")
    d = _case("DEMO-DSP-1045")
    assert d["status"] == "PENDING_AI_REVIEW" and d["outcome"] is None
    assert not [m for m in client.get("/api/disputes/DEMO-DSP-1045/messages").json() if m["action_type"] == "DECIDE_FOR_SELLER"]


def test_ai_approval_makes_it_final_with_no_strike():
    before = _strikes()
    _propose("DEMO-DSP-1046")
    assert _ai("DEMO-DSP-1046", "APPROVE", why="The carrier confirmed delivery.").status_code == 200
    d = _case("DEMO-DSP-1046")
    assert d["status"] == "RESOLVED" and d["outcome"] == "SELLER_FAVOR" and d["ai_verdict"] == "APPROVE" and d["decided_by"] == "INVESTIGATOR"
    assert _strikes() == before


def test_ai_must_overturn_to_the_opposite_outcome():
    _propose("DEMO-DSP-1043")
    assert _ai("DEMO-DSP-1043", "OVERTURN", outcome="SELLER_FAVOR").status_code == 400  # that's the same call
    assert _ai("DEMO-DSP-1043", "OVERTURN", outcome=None).status_code == 400
    assert _ai("DEMO-DSP-1043", "MAYBE").status_code == 400
    assert _ai("DEMO-DSP-1043", "APPROVE", why="  ").status_code == 400  # it has to give reasons
    assert _case("DEMO-DSP-1043")["status"] == "PENDING_AI_REVIEW"


def test_ai_overturn_stands_and_costs_the_investigator_a_strike():
    before = _strikes()
    _propose("DEMO-DSP-1050")
    assert _ai("DEMO-DSP-1050", "OVERTURN", outcome="BUYER_FAVOR", why="No delivery proof, and the buyer sent footage.").status_code == 200
    d = _case("DEMO-DSP-1050")
    assert d["status"] == "RESOLVED" and d["outcome"] == "BUYER_FAVOR" and d["decided_by"] == "AI" and d["proposed_outcome"] == "SELLER_FAVOR"
    assert _strikes() == before + 1


def test_a_case_can_only_be_ruled_on_while_it_waits():
    assert _ai("DEMO-DSP-1050", "APPROVE").status_code == 400  # already decided
    assert _ai("DEMO-DSP-1053", "APPROVE").status_code == 400  # never proposed


def test_the_ai_agent_endpoints_need_the_key(monkeypatch):
    assert client.get("/api/ai-agent/queue").status_code == 401  # no key configured: nobody gets in
    monkeypatch.setattr(settings, "AI_AGENT_API_KEY", "agent-key")
    assert client.get("/api/ai-agent/queue", headers={"X-AI-Agent-Key": "wrong"}).status_code == 401
    h = {"X-AI-Agent-Key": "agent-key"}
    _propose("DEMO-DSP-1051", "BUYER_FAVOR")
    queue = client.get("/api/ai-agent/queue", headers=h).json()
    item = next(q for q in queue if q["dispute_id"] == "DEMO-DSP-1051")
    assert item["proposed_outcome"] == "BUYER_FAVOR" and item["proposed_reason"] and "seller" in item["evidence"] and "claim_points" in item
    r = client.post("/api/ai-agent/cases/DEMO-DSP-1051/verdict", headers=h, json={"verdict": "APPROVE", "rationale": "Agreed.", "model": "reviewer-v1"})
    assert r.status_code == 200 and r.json()["outcome"] == "BUYER_FAVOR"
    assert all(q["dispute_id"] != "DEMO-DSP-1051" for q in client.get("/api/ai-agent/queue", headers=h).json())


# ---------- strikes, alerts, blocking ----------
def _strike(n, user="abhinav", tag="X"):
    db = _db()
    try:
        u = db.get(User, _user(user))
        for i in range(n):
            StrikeService.add_strike(db, u, f"{tag}-{i}-{datetime.utcnow().timestamp()}", "test strike")
        db.commit()
    finally:
        db.close()


def _open_alerts(kind=None):
    alerts = client.get("/api/alerts", params={"status": "OPEN"}).json()
    return [a for a in alerts if kind is None or a["kind"] == kind]


def test_three_strikes_alert_the_manager_and_it_stays_open_until_sorted():
    db = _db()
    base = StrikeService.active_strikes(db, _user("susmitha"))
    db.close()
    assert base == 0
    _strike(2, "susmitha", "A")
    assert not [a for a in _open_alerts("STRIKES") if "Susmitha" in a["title"]]
    _strike(1, "susmitha", "B")
    alert = next(a for a in _open_alerts("STRIKES") if "Susmitha" in a["title"])
    assert alert["strike_level"] == 3 and alert["status"] == "OPEN"
    # The manager has a ping, and the alert is listed as open for the banner on top of every page.
    db = _db()
    n = db.query(Notification).filter(Notification.user_id == _user("paypal"), Notification.alert_id == alert["id"]).count()
    db.close()
    assert n == 1
    # Strike six opens a new alert. Strike four and five don't.
    _strike(2, "susmitha", "C")
    assert len([a for a in _open_alerts("STRIKES") if "Susmitha" in a["title"]]) == 1
    _strike(1, "susmitha", "D")
    assert len([a for a in _open_alerts("STRIKES") if "Susmitha" in a["title"]]) == 2

    # Pressing "sorted" takes it off the list.
    assert client.post(f"/api/alerts/{alert['id']}/sorted", json={"note": "Spoke to them."}).status_code == 200
    assert alert["id"] not in {a["id"] for a in _open_alerts("STRIKES")}


def test_an_unsorted_alert_pings_every_hour_and_stops_when_sorted():
    _strike(3, "susmitha", "H")
    db = _db()
    try:
        alert = db.query(ManagerAlert).filter(ManagerAlert.status == "OPEN", ManagerAlert.kind == "STRIKES").order_by(ManagerAlert.created_at.desc()).first()
        mgr = _user("paypal")
        pings = lambda: db.query(Notification).filter(Notification.user_id == mgr, Notification.alert_id == alert.id).count()
        first = pings()
        assert StrikeService.remind_due(db) == 0 and pings() == first              # not an hour yet
        later = datetime.utcnow() + timedelta(minutes=61)
        StrikeService.remind_due(db, later)
        assert pings() == first + 1 and db.get(ManagerAlert, alert.id).reminder_count == 1
        StrikeService.remind_due(db, later + timedelta(minutes=30))                  # only 30 minutes since the last ping
        assert pings() == first + 1
        StrikeService.remind_due(db, later + timedelta(minutes=62))
        assert pings() == first + 2
        StrikeService.sort_alert(db, alert, MGR, "done")
        StrikeService.remind_due(db, later + timedelta(hours=5))
        assert pings() == first + 2                                                  # sorted: no more pings
    finally:
        db.close()


def test_reaching_the_limit_blocks_the_account_until_a_manager_unblocks_it(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", False)
    db = _db()
    try:
        need = StrikeService.block_threshold() - StrikeService.active_strikes(db, _user("susmitha"))
    finally:
        db.close()
    _strike(need, "susmitha", "BLK")
    team = {t["username"]: t for t in client.get("/api/team").json()}
    assert team["susmitha"]["is_blocked"] and team["susmitha"]["strikes"] >= 10
    assert _open_alerts("BLOCKED")

    # A blocked investigator can't open or approve anything.
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)
    h = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "susmitha", "password": "Susmitha#Invest2026"}).json()["token"]}
    r = client.get("/api/disputes", headers=h)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "ACCOUNT_BLOCKED"
    assert client.get("/api/disputes/DEMO-DSP-1043", headers=h).status_code == 403
    assert client.post("/api/disputes/DEMO-DSP-1043/decision", headers=h, json={"outcome": "SELLER_FAVOR", "reason": "A long enough reason.", "confirmed": True}).status_code == 403
    assert client.get("/api/auth/me", headers=h).json()["is_blocked"] is True  # they can still sign in and see why

    # Only a manager can unblock, and it clears the slate.
    assert client.post(f"/api/team/{_user('susmitha')}/unblock", headers=h, json={"note": "x"}).status_code == 403
    m = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "paypal", "password": "PayPal#Manager2026"}).json()["token"]}
    assert client.post(f"/api/team/{_user('susmitha')}/unblock", headers=m, json={"note": "Talked it through."}).status_code == 200
    assert client.get("/api/disputes", headers=h).status_code == 200
    assert client.get("/api/auth/me", headers=h).json()["strikes"] == 0
    assert client.post(f"/api/team/{_user('susmitha')}/unblock", headers=m, json={}).status_code == 400  # not blocked any more


# ---------- a manager overturns, and the AI learns ----------
def _overturned(did, wrong="SELLER_FAVOR", right="BUYER_FAVOR"):
    _propose(did, wrong)
    assert _ai(did, "OVERTURN", outcome=right, why="AI: the evidence favors the other side.").status_code == 200


def test_manager_overturning_the_ai_removes_the_strike_and_saves_feedback_for_training(monkeypatch):
    _overturned("DEMO-DSP-1044")
    before = _strikes()
    assert client.post("/api/disputes/DEMO-DSP-1044/revise", json={"outcome": "SELLER_FAVOR", "note": "short"}).status_code == 400
    r = client.post("/api/disputes/DEMO-DSP-1044/revise", json={"outcome": "SELLER_FAVOR", "note": "The tracking shows delivery to a confirmed address."})
    assert r.status_code == 200 and _case("DEMO-DSP-1044")["outcome"] == "SELLER_FAVOR" and _case("DEMO-DSP-1044")["decided_by"] == "MANAGER"
    assert _strikes() == before - 1  # the investigator was right
    # Both sides are told, in the chats and by email.
    notices = [m for m in client.get("/api/disputes/DEMO-DSP-1044/messages").json() if m["action_type"] == "DECISION_REVISED"]
    assert {m["counterparty"] for m in notices} == {"SELLER", "BUYER"}
    assert any("Updated decision" in e["subject"] for e in client.get("/api/disputes/DEMO-DSP-1044/emails").json())

    # The correction is the AI team's training data.
    rows = client.get("/api/ai-training").json()
    row = next(r for r in rows if r["dispute_id"] == "DEMO-DSP-1044")
    assert row["ai_outcome"] == "BUYER_FAVOR" and row["correct_outcome"] == "SELLER_FAVOR" and "tracking" in row["correction_note"] and row["source"] == "MANAGER_REVIEW"
    monkeypatch.setattr(settings, "AI_AGENT_API_KEY", "agent-key")
    h = {"X-AI-Agent-Key": "agent-key"}
    pulled = client.get("/api/ai-agent/feedback", headers=h).json()
    assert any(r["dispute_id"] == "DEMO-DSP-1044" for r in pulled)
    assert client.get("/api/ai-agent/feedback", headers=h).json() == []  # already pulled


def test_a_manager_agreeing_with_the_ai_keeps_the_strike():
    _overturned("DEMO-DSP-1053")
    before = _strikes()
    # Changing it to the AI's own answer isn't a change.
    assert client.post("/api/disputes/DEMO-DSP-1053/revise", json={"outcome": "BUYER_FAVOR", "note": "The AI had it right all along."}).status_code == 400
    assert _strikes() == before
    assert not [r for r in client.get("/api/ai-training").json() if r["dispute_id"] == "DEMO-DSP-1053"]


def test_only_a_decided_case_can_be_overturned():
    assert client.post("/api/disputes/DEMO-DSP-1042/revise", json={"outcome": "SELLER_FAVOR", "note": "This was never decided."}).status_code == 400


# ---------- flags ----------
def _flag(did, points="The AI ignored the signed delivery record, which shows the buyer received it."):
    return client.post(f"/api/disputes/{did}/flag", json={"points": points})


def test_an_investigator_can_flag_an_ai_overturn_and_the_manager_can_overturn_the_ai(monkeypatch):
    _overturned("DEMO-DSP-1048")
    assert _flag("DEMO-DSP-1048", "too short").status_code == 400
    assert _flag("DEMO-DSP-1042").status_code == 400                      # not decided by the AI at all
    assert _flag("DEMO-DSP-1048").status_code == 200
    assert _flag("DEMO-DSP-1048").status_code == 400                      # already flagged
    assert any(a["kind"] == "FLAG" and a["dispute_id"] == "DEMO-DSP-1048" for a in _open_alerts("FLAG"))

    flag = client.get("/api/flags", params={"status": "OPEN", "dispute_id": "DEMO-DSP-1048"}).json()[0]
    assert flag["investigator_outcome"] == "SELLER_FAVOR" and flag["ai_outcome"] == "BUYER_FAVOR" and "signed delivery" in flag["points"]
    assert client.post(f"/api/flags/{flag['id']}/resolve", json={"action": "OVERTURN", "note": "x"}).status_code == 400
    assert client.post(f"/api/flags/{flag['id']}/resolve", json={"action": "BOGUS", "note": "Long enough note here."}).status_code == 400
    r = client.post(f"/api/flags/{flag['id']}/resolve", json={"action": "OVERTURN", "note": "The signature is on file. The AI missed it."})
    assert r.status_code == 200 and r.json()["status"] == "OVERTURNED"
    assert _case("DEMO-DSP-1048")["outcome"] == "SELLER_FAVOR"
    row = next(x for x in client.get("/api/ai-training").json() if x["dispute_id"] == "DEMO-DSP-1048")
    assert row["source"] == "INVESTIGATOR_FLAG" and row["correct_outcome"] == "SELLER_FAVOR"
    assert not [a for a in _open_alerts("FLAG") if a["dispute_id"] == "DEMO-DSP-1048"]  # sorted by resolving it
    assert client.post(f"/api/flags/{flag['id']}/resolve", json={"action": "OVERTURN", "note": "Trying twice."}).status_code == 400


def test_a_manager_can_uphold_the_ai_on_a_flag():
    _overturned("DEMO-DSP-1042", "BUYER_FAVOR", "SELLER_FAVOR")
    assert _flag("DEMO-DSP-1042").status_code == 200
    flag = client.get("/api/flags", params={"dispute_id": "DEMO-DSP-1042"}).json()[0]
    r = client.post(f"/api/flags/{flag['id']}/resolve", json={"action": "UPHOLD_AI", "note": "The AI's reasoning holds up."})
    assert r.json()["status"] == "UPHELD" and _case("DEMO-DSP-1042")["outcome"] == "SELLER_FAVOR"
    assert not [x for x in client.get("/api/ai-training").json() if x["dispute_id"] == "DEMO-DSP-1042"]


def test_managers_do_not_flag(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)
    m = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "paypal", "password": "PayPal#Manager2026"}).json()["token"]}
    assert client.post("/api/disputes/DEMO-DSP-1042/flag", headers=m, json={"points": "x" * 40}).status_code == 403


# ---------- emails and appeals ----------
def _decided(did):
    """Decided with the AI's approval, unless an earlier test already got it there."""
    if _case(did)["status"] != "RESOLVED":
        _propose(did)
        assert _ai(did, "APPROVE", why="Agreed.").status_code == 200


def test_decision_emails_list_the_proof_by_name_and_say_how_to_ask_again():
    did = "DEMO-DSP-1051"
    _decided(did)
    mails = client.get(f"/api/disputes/{did}/emails").json()
    assert {m["party"] for m in mails} == {"SELLER", "BUYER"}
    buyer = next(m for m in mails if m["party"] == "BUYER")
    assert buyer["to"].endswith("@buyers.example") and buyer["status"] == "QUEUED"  # no SMTP here, so it is kept and not sent
    body = buyer["body"]
    assert "We collected proof from both sides" in body and "The seller provided:" in body and "The buyer provided:" in body
    assert "listed by name only" in body                    # names, not the documents
    assert settings.APPEALS_EMAIL in body and did in body and "different investigator" in body and "manager" in body
    assert "Carrier tracking" in body or "Nothing" in body


def test_an_email_from_the_buyer_opens_a_new_case_with_another_investigator_and_a_manager():
    did = "DEMO-DSP-1046"
    _decided(did)
    original = _case(did)
    r = client.post(f"/api/disputes/{did}/appeal/simulate", json={"party": "BUYER", "body": "I disagree. Please look again."})
    out = r.json()
    assert out["opened"] is True and out["appeal_id"] == f"{did}-A1"
    new = _case(out["appeal_id"])
    assert new["status"] == "OPEN" and new["parent_dispute_id"] == did and new["appeal_number"] == 1
    assert new["assigned_to"] and new["assigned_to"] not in (original["assigned_to"], original["proposed_by"])  # a different investigator
    assert new["manager_assigned"] == MGR                                                                  # and a manager joined
    assert len(new["evidence_items"]) == len([e for e in original["evidence_items"] if e["availability_status"] == "AVAILABLE"])
    assert any(m["action_type"] == "APPEAL_REQUEST" and "disagree" in m["body"] for m in client.get(f"/api/disputes/{out['appeal_id']}/messages").json())
    assert any(a["kind"] == "APPEAL" and a["dispute_id"] == out["appeal_id"] for a in _open_alerts("APPEAL"))
    assert client.get(f"/api/disputes/{did}/appeals").json()["appeals"][0]["id"] == out["appeal_id"]
    ack = [m for m in client.get(f"/api/disputes/{out['appeal_id']}/emails").json() if "We received your request" in m["subject"]]
    assert ack and "different investigator" in ack[0]["body"]
    # While one is open, a second request doesn't open another.
    again = client.post(f"/api/disputes/{did}/appeal/simulate", json={"party": "BUYER"}).json()
    assert again["opened"] is False and "already open" in again["reason"]


def test_only_a_decided_case_can_be_appealed():
    out = client.post("/api/disputes/DEMO-DSP-1045/appeal/simulate", json={"party": "BUYER"}).json()  # still open, so an email from the buyer is a reply, not an appeal
    assert out["opened"] is False and out["reply_recorded_for"] == "DEMO-DSP-1045"
    assert not client.get("/api/disputes/DEMO-DSP-1045/appeals").json()["appeals"]


def test_the_inbound_mail_webhook_checks_its_secret_and_the_sender(monkeypatch):
    did = "DEMO-DSP-1052"   # decided before the demo started
    body = {"from_address": "nobody@elsewhere.example", "subject": f"Re: Decision on dispute {did}", "body": "Please reopen."}
    assert client.post("/api/inbound-mail", json=body).status_code == 401            # no secret configured
    monkeypatch.setattr(settings, "INBOUND_MAIL_SECRET", "mail-secret")
    assert client.post("/api/inbound-mail", json=body, headers={"X-Inbound-Secret": "wrong"}).status_code == 401
    h = {"X-Inbound-Secret": "mail-secret"}
    stranger = client.post("/api/inbound-mail", json=body, headers=h).json()
    assert stranger["opened"] is False and "isn't the buyer or the seller" in stranger["reason"]
    assert client.post("/api/inbound-mail", json={**body, "subject": "No case number", "from_address": "x@y.z", "body": "hello"}, headers=h).json()["opened"] is False
    from backend.app.services import email_service
    db = _db()
    try:
        buyer = email_service.buyer_address(db.query(Dispute).filter(Dispute.id == did).first())
        mails_before = db.query(Email).count()
    finally:
        db.close()
    ok = client.post("/api/inbound-mail", json={**body, "from_address": buyer.upper()}, headers=h).json()   # case of the address doesn't matter
    assert ok["opened"] is True and ok["appeal_id"] == f"{did}-A1"
    db = _db()
    try:
        assert db.query(Email).filter(Email.direction == "IN").count() >= 3 and db.query(Email).count() > mails_before
    finally:
        db.close()
