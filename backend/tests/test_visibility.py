"""Only the manager sees every case. An investigator sees the cases they own, plus the ones a colleague has shared with them."""
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.main import app

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)
    monkeypatch.setattr(settings, "DEMO_REPLY_DELAY_SECONDS", 999)


def _h(username, password):
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": username, "password": password}).json()["token"]}


MGR = lambda: _h("paypal", "PayPal#Manager2026")
ABH = lambda: _h("abhinav", "Abhinav#Invest2026")
SUS = lambda: _h("susmitha", "Susmitha#Invest2026")
JAH = lambda: _h("jahnavi", "Jahnavi#Invest2026")
OPEN = ("OPEN", "WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_BOTH_RESPONSES", "IN_PROGRESS", "UNDER_REVIEW", "PENDING_AI_REVIEW")


def _all():
    return client.get("/api/disputes", headers=MGR(), params={"limit": 200}).json()


def _ids(headers, **params):
    return {d["id"] for d in client.get("/api/disputes", headers=headers, params={"limit": 200, **params}).json()}


def _uid(name):
    return next(u["id"] for u in client.get("/api/users", headers=MGR()).json() if u["name"] == name)


def _case_of(owner):
    return next(d["id"] for d in _all() if d["assigned_to"] == owner and d["status"] in OPEN)


# ---------- the list ----------
def test_the_manager_sees_every_case():
    assert len(_all()) >= 27


def test_an_investigator_sees_only_their_own_cases():
    mine = _ids(SUS())
    expected = {d["id"] for d in _all() if d["assigned_to"] == "Susmitha"}
    assert mine == expected and mine
    for other in (ABH(), JAH()):
        assert _ids(other).isdisjoint(mine)
    everyone = _ids(MGR(), limit=200)
    unowned = {d["id"] for d in _all() if d["assigned_to"] in (None, "AI Agent", "PayPal")}
    assert unowned and unowned.isdisjoint(mine)                       # nobody's, the AI Agent's and the manager's cases are not on an investigator's list
    assert mine < everyone


def test_searching_never_finds_someone_elses_case():
    theirs = _case_of("Abhinav Chitturi")
    assert client.get("/api/disputes", headers=SUS(), params={"search": theirs}).json() == []
    assert [d["id"] for d in client.get("/api/disputes", headers=ABH(), params={"search": theirs}).json()] == [theirs]
    assert client.get("/api/disputes", headers=SUS(), params={"assigned_to": "Abhinav Chitturi"}).json() == []      # nor by asking for their cases
    assert client.get("/api/disputes", headers=SUS(), params={"unassigned": True}).json() == []
    assert client.get("/api/disputes", headers=SUS(), params={"high_profile": True}).json() == []


# ---------- every door to a case ----------
def test_someone_elses_case_is_not_found_whichever_way_you_ask():
    theirs = _case_of("Abhinav Chitturi")
    h = SUS()
    for path in ("", "/timeline", "/evidence", "/evidence-summary", "/messages", "/emails", "/appeals", "/similar-cases", "/collaborators", "/flag"):
        r = client.get(f"/api/disputes/{theirs}{path}", headers=h)
        assert r.status_code in (404, 405), (path, r.status_code)           # 405 only where that path is a POST
    for path, body in (("/brief", None), ("/decision", {"outcome": "SELLER_FAVOR", "reason": "I should not be able to do this.", "confirmed": True}),
                       ("/actions/execute", {"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "requested_evidence": ["CARRIER_TRACKING"]}),
                       ("/actions/draft", {"action_type": "REQUEST_SELLER_EVIDENCE"}), ("/messages/read", None), ("/collaborators", {"user_id": _uid("Susmitha")}),
                       ("/flag", {"points": "x" * 40}), ("/appeal/simulate", {"party": "BUYER"}), ("/inbound/simulate", {"party": "SELLER"})):
        r = client.post(f"/api/disputes/{theirs}{path}", headers=h, json=body) if body is not None else client.post(f"/api/disputes/{theirs}{path}", headers=h)
        assert r.status_code == 404, (path, r.status_code)
    # And it really wasn't touched.
    after = client.get(f"/api/disputes/{theirs}", headers=ABH()).json()
    assert after["status"] in OPEN and after["proposed_outcome"] is None


def test_a_document_or_message_on_someone_elses_case_is_not_reachable_either():
    theirs = _case_of("Abhinav Chitturi")
    ev = next(e for e in client.get(f"/api/disputes/{theirs}/evidence", headers=ABH()).json() if e["availability_status"] == "AVAILABLE")
    assert client.get(f"/api/evidence/{ev['id']}/preview", headers=ABH()).status_code == 200
    assert client.get(f"/api/evidence/{ev['id']}/preview", headers=SUS()).status_code == 404
    client.post(f"/api/disputes/{theirs}/actions/execute", headers=ABH(), json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "requested_evidence": ["CARRIER_TRACKING"], "message": "Please send it."})
    msg = next(m for m in client.get(f"/api/disputes/{theirs}/messages", headers=ABH()).json() if m["direction"] == "OUTBOUND")
    assert client.post(f"/api/messages/{msg['id']}/simulate-reply", headers=SUS()).status_code == 404
    assert client.post(f"/api/messages/{msg['id']}/simulate-reply", headers=ABH()).status_code == 200


def test_the_manager_can_open_anything():
    for owner in ("Abhinav Chitturi", "Susmitha", "Jahnavi"):
        assert client.get(f"/api/disputes/{_case_of(owner)}", headers=MGR()).status_code == 200
    unowned = next(d["id"] for d in _all() if d["assigned_to"] is None)
    assert client.get(f"/api/disputes/{unowned}", headers=MGR()).status_code == 200
    assert client.get(f"/api/disputes/{unowned}", headers=SUS()).status_code == 404


# ---------- the numbers and feeds ----------
def test_the_dashboard_counts_only_what_the_investigator_can_see():
    s = client.get("/api/dashboard/summary", headers=SUS()).json()
    m = client.get("/api/dashboard/summary", headers=MGR()).json()
    own_open = [d for d in _all() if d["assigned_to"] == "Susmitha" and d["status"] in OPEN]
    assert s["my_cases_count"] == len(own_open) and s["unassigned_count"] == 0 and s["high_profile_count"] == 0 and s["ai_owned_count"] == 0
    assert s["new_cases_count"] == len([d for d in own_open if d["status"] == "OPEN"])
    assert s["approaching_deadline_count"] <= len(own_open) < m["approaching_deadline_count"] + m["new_cases_count"] + 1
    assert m["unassigned_count"] > 0 and m["high_profile_count"] > 0


def test_messages_and_activity_are_limited_to_their_cases_too():
    mine, theirs = _case_of("Susmitha"), _case_of("Abhinav Chitturi")
    for did, h in ((mine, SUS()), (theirs, ABH())):
        client.post(f"/api/disputes/{did}/actions/execute", headers=h, json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "requested_evidence": ["CARRIER_TRACKING"], "message": "Please send it."})
    sus_threads = {t["dispute_id"] for t in client.get("/api/message-threads", headers=SUS()).json()}
    abh_threads = {t["dispute_id"] for t in client.get("/api/message-threads", headers=ABH()).json()}
    assert mine in sus_threads and theirs not in sus_threads and sus_threads <= _ids(SUS())      # only conversations on cases they can see
    assert theirs in abh_threads and mine not in abh_threads and abh_threads <= _ids(ABH())
    assert {t["dispute_id"] for t in client.get("/api/message-threads", headers=MGR()).json()} >= {mine, theirs}
    seen = {e["dispute_id"] for e in client.get("/api/audit-events", headers=SUS(), params={"limit": 200}).json()}
    assert theirs not in seen and None not in seen and mine in seen
    assert client.get("/api/audit-events", headers=SUS(), params={"dispute_id": theirs}).json() == []
    recent = {e["dispute_id"] for e in client.get("/api/dashboard/summary", headers=SUS()).json()["recent_activity"]}
    assert theirs not in recent
    assert theirs in {e["dispute_id"] for e in client.get("/api/audit-events", headers=MGR(), params={"limit": 200}).json()}


def test_portfolio_wide_patterns_are_for_the_manager() -> None:
    assert client.get("/api/patterns", headers=MGR()).status_code == 200
    assert client.get("/api/patterns", headers=SUS()).status_code == 403


# ---------- sharing a case ----------
def test_an_investigator_can_bring_a_colleague_onto_their_case():
    did = _case_of("Susmitha")
    assert did not in _ids(ABH())
    r = client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("Abhinav Chitturi")})
    assert r.status_code == 200 and r.json()["name"] == "Abhinav Chitturi" and r.json()["added_by"] == "Susmitha"
    # Now it is on their list, and the case says who else is on it.
    assert did in _ids(ABH())
    d = client.get(f"/api/disputes/{did}", headers=ABH()).json()
    assert d["assigned_to"] == "Susmitha" and d["collaborators"] == ["Abhinav Chitturi"]
    assert next(x for x in client.get("/api/disputes", headers=SUS(), params={"limit": 200}).json() if x["id"] == did)["collaborators"] == ["Abhinav Chitturi"]
    listing = client.get(f"/api/disputes/{did}/collaborators", headers=ABH()).json()
    assert listing["owner"] == "Susmitha" and [c["name"] for c in listing["collaborators"]] == ["Abhinav Chitturi"]
    # They are told, and the case is in their "Your cases" numbers.
    note = next(n for n in client.get("/api/notifications", headers=ABH()).json()["items"] if n["kind"] == "SHARED")
    assert did in note["body"] and "Susmitha added you" in note["title"]
    assert client.get("/api/dashboard/summary", headers=ABH()).json()["my_cases_count"] >= 1
    # Someone not on it still can't see it.
    assert did not in _ids(JAH())


def test_a_colleague_on_the_case_can_work_it_like_the_owner():
    did = _case_of("Susmitha")
    r = client.post(f"/api/disputes/{did}/actions/execute", headers=ABH(), json={"action_type": "REQUEST_SELLER_EVIDENCE", "confirmed": True, "requested_evidence": ["CARRIER_TRACKING"], "message": "Helping out on this one."})
    assert r.status_code == 200
    seen_by_owner = client.get(f"/api/disputes/{did}/messages", headers=SUS()).json()
    assert any(m["body"] == "Helping out on this one." for m in seen_by_owner)             # both are looking at the same conversation
    assert did in {t["dispute_id"] for t in client.get("/api/message-threads", headers=ABH()).json()}
    assert any(e["actor"] == "Abhinav Chitturi" for e in client.get("/api/audit-events", headers=SUS(), params={"dispute_id": did}).json())


def test_sharing_has_rules():
    did = _case_of("Susmitha")
    abh = _uid("Abhinav Chitturi")
    assert client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": abh}).status_code == 400            # already on it
    assert client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("Susmitha")}).status_code == 400  # the owner can't be added to their own case
    assert client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("PayPal")}).status_code == 400    # the manager already sees everything
    assert client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": "USR-nobody"}).status_code == 400
    client.post(f"/api/users/{_uid('Jahnavi')}/block", headers=MGR(), json={"reason": "Out this week."})
    assert client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("Jahnavi")}).status_code == 400   # blocked people can't be added
    client.post(f"/api/team/{_uid('Jahnavi')}/unblock", headers=MGR(), json={})
    closed = next(d["id"] for d in _all() if d["status"] in ("RESOLVED", "CLOSED"))
    assert client.post(f"/api/disputes/{closed}/collaborators", headers=MGR(), json={"user_id": abh}).status_code == 400            # nothing to work on


def test_who_can_take_someone_off_a_case():
    did = _case_of("Susmitha")
    client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("Jahnavi")})
    # A colleague can't remove another colleague. Someone with no access can't even find the case.
    assert client.delete(f"/api/disputes/{did}/collaborators/{_uid('Jahnavi')}", headers=ABH()).status_code == 403
    other = next(d for d in _all() if d["assigned_to"] == "Jahnavi" and d["status"] in OPEN)["id"]
    assert client.delete(f"/api/disputes/{other}/collaborators/{_uid('Jahnavi')}", headers=SUS()).status_code == 404
    # The owner can, the person themselves can (leave), and so can the manager.
    assert client.delete(f"/api/disputes/{did}/collaborators/{_uid('Jahnavi')}", headers=SUS()).status_code == 200
    assert did not in _ids(JAH())
    assert client.delete(f"/api/disputes/{did}/collaborators/{_uid('Abhinav Chitturi')}", headers=ABH()).status_code == 200      # leaving
    assert did not in _ids(ABH())
    client.post(f"/api/disputes/{did}/collaborators", headers=MGR(), json={"user_id": _uid("Jahnavi")})
    assert client.delete(f"/api/disputes/{did}/collaborators/{_uid('Jahnavi')}", headers=MGR()).status_code == 200
    assert client.delete(f"/api/disputes/{did}/collaborators/{_uid('Jahnavi')}", headers=MGR()).status_code == 404                # already off


def test_the_manager_can_add_anyone_to_any_case_and_everyone_sees_it_in_their_workload():
    did = _case_of("Jahnavi")
    before = client.get("/api/cases/distribution", headers=MGR()).json()
    sus_before = next(p["open_cases"] for p in before["people"] if p["name"] == "Susmitha")
    assert client.post(f"/api/disputes/{did}/collaborators", headers=MGR(), json={"user_id": _uid("Susmitha")}).status_code == 200
    after = next(p["open_cases"] for p in client.get("/api/cases/distribution", headers=MGR()).json()["people"] if p["name"] == "Susmitha")
    assert after == sus_before + 1                                                      # a shared case counts as work, for handing out fairly


def test_a_case_shared_with_someone_means_they_are_not_out_of_cases():
    for d in _all():
        if d["assigned_to"] == "Jahnavi" and d["status"] in OPEN:
            client.post(f"/api/disputes/{d['id']}/assign", headers=MGR(), json={"assignee": None})
    assert client.post("/api/case-requests", headers=JAH(), json={}).status_code == 200                 # genuinely none left: they may ask
    from backend.app.database import SessionLocal
    from backend.app.models.team import CaseRequest
    db = SessionLocal()
    try:
        db.query(CaseRequest).delete()
        db.commit()
    finally:
        db.close()
    shared = _case_of("Susmitha")
    client.post(f"/api/disputes/{shared}/collaborators", headers=SUS(), json={"user_id": _uid("Jahnavi")})
    refused = client.post("/api/case-requests", headers=JAH(), json={})
    assert refused.status_code == 400 and "still have 1 open case" in refused.json()["detail"]


def test_making_a_colleague_the_owner_takes_them_off_the_helpers_list():
    did = _case_of("Susmitha")
    client.post(f"/api/disputes/{did}/collaborators", headers=SUS(), json={"user_id": _uid("Abhinav Chitturi")})
    client.post(f"/api/disputes/{did}/assign", headers=MGR(), json={"assignee": "Abhinav Chitturi"})
    d = client.get(f"/api/disputes/{did}", headers=ABH()).json()
    assert d["assigned_to"] == "Abhinav Chitturi" and "Abhinav Chitturi" not in d["collaborators"]
