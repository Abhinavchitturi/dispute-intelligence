"""The 5-day clock: the score climbs as the deadline nears, unassigned cases rise to the top, and nobody-took-it cases go to the AI Agent."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.dispute import Dispute
from backend.app.services import case_clock
from backend.app.services.priority_service import calculate_priority_score

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", False)
    monkeypatch.setattr(settings, "AUTO_ASSIGN_WHEN_DAYS_LEFT", -999)
    monkeypatch.setattr(settings, "AUTO_ASSIGN_AFTER_DAYS", 999)   # these tests are about the AI Agent path; auto-assignment has its own tests below
    case_clock.reset_throttle()


def _score(hours_left):
    return calculate_priority_score(amount=300.0, response_due_date=datetime.utcnow() + timedelta(hours=hours_left), evidence_status="PARTIAL",
                                    delivery_address_match="yes", shipment_status="DELIVERED")[0]


def _set(did, **fields):
    db = SessionLocal()
    try:
        d = db.get(Dispute, did)
        for k, v in fields.items():
            setattr(d, k, v)
        db.commit()
    finally:
        db.close()


def _case(did):
    return client.get(f"/api/disputes/{did}").json()


def _tick(now=None):
    db = SessionLocal()
    try:
        return case_clock.tick(db, now)
    finally:
        db.close()


def _alerts(kind):
    return [a for a in client.get("/api/alerts", params={"status": "OPEN"}).json() if a["kind"] == kind]


# ---------- the score climbs with the days ----------
def test_the_score_rises_steadily_as_the_five_days_run_out():
    window = settings.CASE_WINDOW_DAYS * 24
    scores = [_score(h) for h in (window, 96, 72, 48, 24, 12, 1, 0, -10)]
    assert scores == sorted(scores) and len(set(scores[:-1])) == len(scores) - 1   # every step is higher than the last, until the time is up
    assert scores[-1] == scores[-2]                                                 # and it stops at the top once the deadline has passed
    assert _score(window + 500) == _score(window)                                   # a case with plenty of time sits at the bottom
    assert _score(0) - _score(window) == pytest.approx(30.0, abs=0.2)


def test_stored_scores_follow_the_clock_instead_of_going_stale():
    did = "DEMO-DSP-1044"
    _set(did, response_due_date=datetime.utcnow() + timedelta(days=4, hours=20), priority_score=0.0)
    case_clock.reset_throttle()
    early = _case(did)["priority_score"]
    assert early > 0                                   # reading the case re-scored it
    _set(did, response_due_date=datetime.utcnow() + timedelta(hours=10))
    case_clock.reset_throttle()
    late = _case(did)["priority_score"]
    assert late > early + 20
    why = next(f for f in _case(did)["priority_factors"] if f["name"] == "Response Deadline Urgency")
    assert "hours" in why["explanation"] or "day" in why["explanation"]


# ---------- an unassigned case rises to the top ----------
def test_unassigned_cases_are_listed_most_urgent_first():
    for did, hours in (("DEMO-DSP-1044", 100), ("DEMO-DSP-1045", 5), ("DEMO-DSP-1048", 40)):
        _set(did, assigned_to=None, response_due_date=datetime.utcnow() + timedelta(hours=hours))
    case_clock.reset_throttle()
    rows = client.get("/api/disputes", params={"unassigned": True, "sort_by": "priority_score", "sort_order": "desc"}).json()
    scores = [r["priority_score"] for r in rows]
    assert scores == sorted(scores, reverse=True) and {"DEMO-DSP-1044", "DEMO-DSP-1045", "DEMO-DSP-1048"} <= {r["id"] for r in rows}   # the most urgent leads
    by_id = {r["id"]: r["priority_score"] for r in rows}
    # The same case climbs the list as its deadline closes in.
    _set("DEMO-DSP-1044", response_due_date=datetime.utcnow() + timedelta(hours=2))
    case_clock.reset_throttle()
    assert {r["id"]: r["priority_score"] for r in client.get("/api/disputes", params={"unassigned": True}).json()}["DEMO-DSP-1044"] > by_id["DEMO-DSP-1044"]
    assert all(r["assigned_to"] is None for r in rows)
    assert client.get("/api/dashboard/summary").json()["unassigned_count"] >= 3


# ---------- nobody took it: an investigator does, never the AI Agent ----------
def test_an_unassigned_case_is_never_handed_to_the_ai_agent_even_past_its_deadline():
    did = "DEMO-DSP-1046"
    _set(did, assigned_to=None, response_due_date=datetime.utcnow() - timedelta(hours=1), ai_owned=False, created_at=datetime.utcnow() - timedelta(hours=3))
    out = _tick()
    assert "handed_to_ai" not in out
    d = _case(did)
    assert d["ai_owned"] is False and d["assigned_to"] is None                      # still inside the manager's two days, and not the AI's either
    assert not [a for a in _alerts("AI_TAKEOVER") if a["dispute_id"] == did]


def test_a_case_nobody_assigns_goes_to_an_investigator_after_the_manager_s_days_never_to_the_ai(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_ASSIGN_AFTER_DAYS", 2)
    did = "DEMO-DSP-1053"
    _set(did, assigned_to=None, response_due_date=datetime.utcnow() - timedelta(days=1), ai_owned=False, created_at=datetime.utcnow() - timedelta(days=6))
    _tick()
    d = _case(did)
    assert d["assigned_to"] in ("Abhinav Chitturi", "Susmitha", "Jahnavi") and d["ai_owned"] is False


# ---------- what the AI Agent can do with a case it owns ----------
@pytest.fixture
def agent(monkeypatch):
    monkeypatch.setattr(settings, "AI_AGENT_API_KEY", "agent-key")
    return {"X-AI-Agent-Key": "agent-key"}


def _hand(did):
    """Puts a case with the AI Agent directly. Nothing hands cases over by itself any more, but the Agent's own endpoints still work on one."""
    _set(did, assigned_to="AI Agent", response_due_date=datetime.utcnow() - timedelta(hours=2), ai_owned=True, ai_owned_at=datetime.utcnow())
    assert _case(did)["ai_owned"] is True


def test_the_agent_sees_the_cases_it_owns_with_everything_it_needs(agent):
    assert client.get("/api/ai-agent/owned").status_code == 401
    _hand("DEMO-DSP-1048")
    owned = client.get("/api/ai-agent/owned", headers=agent).json()
    item = next(o for o in owned if o["dispute_id"] == "DEMO-DSP-1048")
    assert item["evidence"]["seller"] and "buyer_claim" in item and item["response_due_date"] and item["handed_over_at"]
    assert all(o["dispute_id"] != "DEMO-DSP-1044" for o in owned)           # a case a person has is not in the list


def test_the_agent_can_ask_for_evidence_like_an_investigator_and_the_case_waits(agent):
    did = "DEMO-DSP-1048"
    r = client.post(f"/api/ai-agent/cases/{did}/request-evidence", headers=agent, json={"party": "SELLER", "evidence_types": ["PROOF_OF_DELIVERY_SIGNATURE"], "message": "Please send the signature."})
    assert r.status_code == 200 and r.json()["status"] == "WAITING_FOR_SELLER_RESPONSE"
    msgs = client.get(f"/api/disputes/{did}/messages").json()
    assert msgs[-1]["counterparty"] == "SELLER" and msgs[-1]["requested_evidence"] == ["PROOF_OF_DELIVERY_SIGNATURE"]
    assert any(e["actor"] == "AI Agent" for e in client.get("/api/audit-events", params={"dispute_id": did}).json())
    bad = client.post(f"/api/ai-agent/cases/{did}/request-evidence", headers=agent, json={"party": "BUYER", "evidence_types": ["PROOF_OF_DELIVERY_SIGNATURE"], "message": "x"})
    assert bad.status_code == 400                                              # that is a seller item
    assert client.post(f"/api/ai-agent/cases/{did}/request-evidence", headers=agent, json={"party": "SELLER", "evidence_types": [], "message": "x"}).status_code == 400
    assert client.post("/api/ai-agent/cases/DEMO-DSP-1044/request-evidence", headers=agent, json={"party": "SELLER", "evidence_types": ["CARRIER_TRACKING"], "message": "x"}).status_code == 400  # not its case


def test_the_agent_decides_the_whole_case_and_everyone_is_told(agent):
    did = "DEMO-DSP-1048"
    r = client.post(f"/api/ai-agent/cases/{did}/decide", headers=agent, json={"outcome": "BUYER_FAVOR", "rationale": "No proof of delivery and the buyer sent footage.", "model": "agent-v1"})
    assert r.status_code == 200 and r.json()["status"] == "RESOLVED"
    d = _case(did)
    assert d["outcome"] == "BUYER_FAVOR" and d["decided_by"] == "AI" and d["ai_verdict"] == "DIRECT" and "No proof of delivery" in d["ai_rationale"]
    assert {m["counterparty"] for m in client.get(f"/api/disputes/{did}/messages").json() if m["action_type"] == "DECIDE_FOR_BUYER"} == {"SELLER", "BUYER"}
    assert {e["party"] for e in client.get(f"/api/disputes/{did}/emails").json() if e["direction"] == "OUT"} == {"SELLER", "BUYER"}
    assert not any(a["dispute_id"] == did for a in client.get("/api/alerts").json() if a["kind"] == "STRIKES")      # no investigator, so no strike
    assert not any(h["dispute_id"] == did for t in client.get("/api/team").json() for h in t["history"])
    assert client.post(f"/api/ai-agent/cases/{did}/decide", headers=agent, json={"outcome": "SELLER_FAVOR", "rationale": "Again."}).status_code == 400   # already decided


def test_the_agent_must_give_a_real_outcome_and_reasons(agent):
    _hand("DEMO-DSP-1051")
    assert client.post("/api/ai-agent/cases/DEMO-DSP-1051/decide", headers=agent, json={"outcome": "MAYBE", "rationale": "x"}).status_code == 400
    assert client.post("/api/ai-agent/cases/DEMO-DSP-1051/decide", headers=agent, json={"outcome": "SELLER_FAVOR", "rationale": "  "}).status_code == 400
    assert _case("DEMO-DSP-1051")["status"] != "RESOLVED"


def test_a_manager_overturning_the_agent_is_saved_as_training_feedback(agent):
    did = "DEMO-DSP-1048"
    r = client.post(f"/api/disputes/{did}/revise", json={"outcome": "SELLER_FAVOR", "note": "The carrier signature was on file. The agent missed it."})
    assert r.status_code == 200 and _case(did)["outcome"] == "SELLER_FAVOR"
    row = next(x for x in client.get("/api/ai-training").json() if x["dispute_id"] == did)
    assert row["ai_verdict"] == "DIRECT" and row["ai_outcome"] == "BUYER_FAVOR" and row["correct_outcome"] == "SELLER_FAVOR"
    assert row["investigator_decision"] == "BUYER_FAVOR"       # there was no investigator: this is the agent's own call
    assert any(x["dispute_id"] == did for x in client.get("/api/ai-agent/feedback", headers=agent).json())


def test_a_decided_case_leaves_the_agents_list(agent):
    assert all(o["dispute_id"] != "DEMO-DSP-1048" for o in client.get("/api/ai-agent/owned", headers=agent).json())


# ---------- a complaint nobody assigns is given out at random ----------
def test_a_case_the_manager_doesnt_assign_in_a_day_goes_to_an_investigator_at_random(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_ASSIGN_AFTER_DAYS", 1)
    monkeypatch.setattr(settings, "AUTO_ASSIGN_WHEN_DAYS_LEFT", 3)
    now = datetime.utcnow()
    _set("DEMO-DSP-1056", assigned_to=None, created_at=now - timedelta(hours=30), status="OPEN", response_due_date=now + timedelta(days=4))
    _set("DEMO-DSP-1058", assigned_to=None, created_at=now - timedelta(hours=10), status="OPEN", response_due_date=now + timedelta(days=4, hours=14))
    _tick(now)
    late = _case("DEMO-DSP-1056")
    assert late["assigned_to"] in ("Abhinav Chitturi", "Susmitha", "Jahnavi") and not late["ai_owned"]
    assert _case("DEMO-DSP-1058")["assigned_to"] is None                   # still inside its day, with plenty of time left: the manager has time
    db = SessionLocal()
    try:
        from backend.app.models.audit import AuditEvent
        assert db.query(AuditEvent).filter(AuditEvent.dispute_id == "DEMO-DSP-1056", AuditEvent.action == "AUTO_ASSIGNED").count() == 1
    finally:
        db.close()
    assert _tick(now)["auto_assigned"] == 0                                # and it isn't given out twice


def test_a_case_with_little_time_left_does_not_wait_for_the_manager(monkeypatch):
    monkeypatch.setattr(settings, "AUTO_ASSIGN_AFTER_DAYS", 1)
    monkeypatch.setattr(settings, "AUTO_ASSIGN_WHEN_DAYS_LEFT", 3)
    now = datetime.utcnow()
    # It arrived two hours ago, but only three days are left. Waiting would take the investigator's time, so it goes out now.
    _set("DEMO-DSP-1063", assigned_to=None, created_at=now - timedelta(hours=2), status="OPEN", response_due_date=now + timedelta(days=3))
    _tick(now)
    assert _case("DEMO-DSP-1063")["assigned_to"] in ("Abhinav Chitturi", "Susmitha", "Jahnavi")
