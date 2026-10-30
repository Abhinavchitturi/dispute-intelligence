"""The manager hands cases out; an investigator with none asks for more."""
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.main import app

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
TEAM = ["Abhinav Chitturi", "Susmitha", "Jahnavi"]


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)


def _h(username, password):
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": username, "password": password}).json()["token"]}


MGR = lambda: _h("paypal", "PayPal#Manager2026")
SUS = lambda: _h("susmitha", "Susmitha#Invest2026")
ABH = lambda: _h("abhinav", "Abhinav#Invest2026")


def _open(**params):
    return [d for d in client.get("/api/disputes", headers=MGR(), params={"limit": 200, **params}).json() if d["status"] not in ("RESOLVED", "CLOSED")]


def _regular():
    return [d for d in _open() if not d["is_high_profile"]]


def _release_all():
    """Takes every open case off its owner, as the start of a fresh pile for the manager to share out."""
    for d in _open():
        assert client.post(f"/api/disputes/{d['id']}/assign", headers=MGR(), json={"assignee": None}).status_code == 200


def _counts():
    out = {}
    for d in _open():
        out[d["assigned_to"]] = out.get(d["assigned_to"], 0) + 1
    return out


def _uid(name):
    return next(u["id"] for u in client.get("/api/users", headers=MGR()).json() if u["name"] == name)


def test_only_the_manager_assigns_and_investigators_get_no_take_button():
    case = _open()[0]["id"]
    for name, h in (("Susmitha", SUS()), ("Abhinav Chitturi", ABH())):
        assert client.post(f"/api/disputes/{case}/assign", headers=MGR(), json={"assignee": name}).status_code == 200     # make it theirs, so only the rule is under test
        assert client.post(f"/api/disputes/{case}/assign", headers=h, json={"assignee": "Susmitha"}).status_code == 403
        assert client.post("/api/cases/distribute", headers=h, json={}).status_code == 403
        assert client.post("/api/cases/assign", headers=h, json={"dispute_ids": [case], "assignee_id": None}).status_code == 403
        assert client.get("/api/cases/distribution", headers=h).status_code == 403


def test_the_manager_assigns_one_case_to_a_person_who_is_told():
    case = _regular()[0]["id"]
    r = client.post(f"/api/disputes/{case}/assign", headers=MGR(), json={"assignee": "Jahnavi"})
    assert r.status_code == 200 and r.json()["assigned_to"] == "Jahnavi"
    notes = client.get("/api/notifications", headers=_h("jahnavi", "Jahnavi#Invest2026")).json()["items"]
    assert any(n["title"] == "You have a new case" and case in n["body"] for n in notes)
    # Only real, active, unblocked people can be given a case.
    assert client.post(f"/api/disputes/{case}/assign", headers=MGR(), json={"assignee": "Nobody Here"}).status_code == 400


def test_unassigned_cases_are_shared_out_evenly_and_the_managers_own_are_left_alone():
    _release_all()
    unassigned = _regular()
    plan = client.get("/api/cases/distribution", headers=MGR()).json()
    assert plan["unassigned"] == len(unassigned) and {p["name"] for p in plan["people"]} == set(TEAM)
    r = client.post("/api/cases/distribute", headers=MGR(), json={}).json()
    assert r["total"] == len(unassigned) and r["left_unassigned"] == 0 and r["people"] == 3
    counts = list(r["assigned"].values())
    assert sum(counts) == len(unassigned) and max(counts) - min(counts) <= 1   # level: 10, 10, 10 for thirty
    # High-profile cases were not handed out. They wait for the manager.
    left = [d for d in _open() if d["assigned_to"] is None]
    assert left and all(d["is_high_profile"] for d in left)
    assert client.get("/api/dashboard/summary", headers=MGR()).json()["unassigned_count"] == len(left)


def test_highest_priority_goes_out_first_and_each_person_is_told_how_many():
    _release_all()
    r = client.post("/api/cases/distribute", headers=MGR(), json={"per_person": 1}).json()
    assert all(n == 1 for n in r["assigned"].values()) and r["total"] == 3
    given = [d for d in _open() if d["assigned_to"] in TEAM]
    waiting = [d for d in _open() if d["assigned_to"] is None and not d["is_high_profile"]]
    assert waiting and min(d["priority_score"] for d in given) >= max(d["priority_score"] for d in waiting)  # the urgent ones went first
    assert r["left_unassigned"] == len(waiting)
    note = next(n for n in client.get("/api/notifications", headers=SUS()).json()["items"] if n["kind"] == "ASSIGNED")
    assert note["title"] == "You have 1 new case"


def test_everyone_ends_up_level_counting_what_they_already_have():
    _release_all()
    # Give Abhinav two cases by hand first.
    mine = [d["id"] for d in _regular()[:2]]
    assert client.post("/api/cases/assign", headers=MGR(), json={"dispute_ids": mine, "assignee_id": _uid("Abhinav Chitturi")}).json()["assigned"] == 2
    r = client.post("/api/cases/distribute", headers=MGR(), json={}).json()
    assert r["assigned"]["Abhinav Chitturi"] <= min(r["assigned"]["Susmitha"], r["assigned"]["Jahnavi"])  # he already had a head start
    totals = {n: c for n, c in _counts().items() if n in TEAM}
    assert max(totals.values()) - min(totals.values()) <= 1


def test_you_can_choose_who_gets_cases_and_a_blocked_person_never_does():
    _release_all()
    assert client.post(f"/api/users/{_uid('Jahnavi')}/block", headers=MGR(), json={"reason": "Out for a week."}).status_code == 200
    r = client.post("/api/cases/distribute", headers=MGR(), json={}).json()
    assert set(r["assigned"]) == {"Abhinav Chitturi", "Susmitha"}                     # Jahnavi is blocked, so skipped
    assert client.post("/api/cases/assign", headers=MGR(), json={"dispute_ids": [_open()[0]["id"]], "assignee_id": _uid("Jahnavi")}).status_code == 400
    client.post(f"/api/team/{_uid('Jahnavi')}/unblock", headers=MGR(), json={})
    _release_all()
    only = client.post("/api/cases/distribute", headers=MGR(), json={"investigator_ids": [_uid("Susmitha")]}).json()
    assert list(only["assigned"]) == ["Susmitha"]
    assert client.post("/api/cases/distribute", headers=MGR(), json={"per_person": 0}).status_code == 400
    assert client.post("/api/cases/distribute", headers=MGR(), json={"investigator_ids": ["USR-none"]}).json()["total"] == 0


# ---------- asking for cases ----------
def _clear(name):
    for d in _open(assigned_to=name):
        client.post(f"/api/disputes/{d['id']}/assign", headers=MGR(), json={"assignee": None})


def test_an_investigator_with_cases_cannot_ask_for_more():
    client.post("/api/cases/distribute", headers=MGR(), json={})
    r = client.post("/api/case-requests", headers=SUS(), json={})
    assert r.status_code == 400 and "still have" in r.json()["detail"]


def test_an_investigator_with_no_cases_asks_and_the_manager_gets_an_alert():
    _clear("Susmitha")
    r = client.post("/api/case-requests", headers=SUS(), json={"note": "All done. Happy to take more."})
    assert r.status_code == 200 and r.json()["status"] == "OPEN" and r.json()["name"] == "Susmitha"
    alert = next(a for a in client.get("/api/alerts", headers=MGR(), params={"status": "OPEN"}).json() if a["kind"] == "REQUEST")
    assert "Susmitha has no cases" in alert["title"] and "Happy to take more" in alert["body"]
    banner = client.get("/api/notifications", headers=MGR()).json()
    assert any(a["id"] == alert["id"] for a in banner["open_alerts"])               # pinned on top, like the other alerts
    # Asking twice doesn't spam the manager.
    again = client.post("/api/case-requests", headers=SUS(), json={})
    assert again.status_code == 400 and "already asked" in again.json()["detail"]
    mine = client.get("/api/case-requests", headers=SUS()).json()
    assert [m["name"] for m in mine] == ["Susmitha"]
    assert client.get("/api/case-requests", headers=ABH()).json() == []              # others only see their own
    assert client.get("/api/case-requests", headers=MGR(), params={"status": "OPEN"}).json()[0]["name"] == "Susmitha"


def test_giving_cases_closes_the_request_and_the_alert():
    assert client.get("/api/case-requests", headers=MGR(), params={"status": "OPEN"}).json()           # from the test above
    client.post("/api/cases/distribute", headers=MGR(), json={"investigator_ids": [_uid("Susmitha")], "per_person": 3, "include_high_profile": True})
    done = client.get("/api/case-requests", headers=MGR(), params={"status": "FULFILLED"}).json()
    assert done and done[0]["name"] == "Susmitha" and done[0]["cases_given"] == 3 and done[0]["resolved_by"] == "PayPal"
    assert not [a for a in client.get("/api/alerts", headers=MGR(), params={"status": "OPEN"}).json() if a["kind"] == "REQUEST"]


def test_the_manager_can_decline_with_a_reason_and_the_investigator_hears():
    _clear("Jahnavi")
    rid = client.post("/api/case-requests", headers=_h("jahnavi", "Jahnavi#Invest2026"), json={}).json()["id"]
    assert client.post(f"/api/case-requests/{rid}/decline", headers=SUS(), json={"note": "Not yours to decline."}).status_code == 403
    assert client.post(f"/api/case-requests/{rid}/decline", headers=MGR(), json={"note": "no"}).status_code == 400
    r = client.post(f"/api/case-requests/{rid}/decline", headers=MGR(), json={"note": "Nothing new until Monday."})
    assert r.status_code == 200 and r.json()["status"] == "DECLINED"
    assert client.post(f"/api/case-requests/{rid}/decline", headers=MGR(), json={"note": "Again."}).status_code == 400
    note = next(n for n in client.get("/api/notifications", headers=_h("jahnavi", "Jahnavi#Invest2026")).json()["items"] if n["title"] == "No new cases for now")
    assert "Nothing new until Monday" in note["body"]
    assert not [a for a in client.get("/api/alerts", headers=MGR(), params={"status": "OPEN"}).json() if a["kind"] == "REQUEST"]
    # They may ask again afterwards.
    assert client.post("/api/case-requests", headers=_h("jahnavi", "Jahnavi#Invest2026"), json={}).status_code == 200


def test_a_blocked_investigator_cannot_ask():
    client.post(f"/api/users/{_uid('Abhinav Chitturi')}/block", headers=MGR(), json={"reason": "Reviewing their cases."})
    assert client.post("/api/case-requests", headers=ABH(), json={}).status_code == 403
    client.post(f"/api/team/{_uid('Abhinav Chitturi')}/unblock", headers=MGR(), json={})


# ---------- choosing a number for each person ----------
def test_the_manager_chooses_how_many_cases_each_person_gets():
    _release_all()
    waiting = len(_regular())
    ids = {n: _uid(n) for n in TEAM}
    r = client.post("/api/cases/distribute", headers=MGR(), json={"counts": {ids["Abhinav Chitturi"]: 3, ids["Susmitha"]: 1, ids["Jahnavi"]: 0}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["assigned"] == {"Abhinav Chitturi": 3, "Susmitha": 1}      # Jahnavi was set to none, so she is left out
    assert out["total"] == 4 and out["left_unassigned"] == waiting - 4
    got = {n: len(_open(assigned_to=n)) for n in TEAM}
    assert got["Abhinav Chitturi"] == 3 and got["Susmitha"] == 1 and got["Jahnavi"] == 0


def test_asking_for_more_cases_than_are_waiting_is_refused_and_nothing_moves():
    _release_all()
    waiting = len(_regular())
    r = client.post("/api/cases/distribute", headers=MGR(), json={"counts": {_uid("Abhinav Chitturi"): waiting + 1}})
    assert r.status_code == 400 and f"only {waiting}" in r.json()["detail"]
    assert len(_regular()) == waiting and all(d["assigned_to"] is None for d in _regular())
    assert client.post("/api/cases/distribute", headers=MGR(), json={"counts": {_uid("Abhinav Chitturi"): -1}}).status_code == 400
    assert client.post("/api/cases/distribute", headers=MGR(), json={"counts": {"USR-nobody": 1}}).status_code == 400


def test_a_number_for_someone_who_asked_closes_their_request():
    _clear("Jahnavi")
    client.post("/api/case-requests", headers=_h("jahnavi", "Jahnavi#Invest2026"), json={})
    _release_all()
    client.post("/api/cases/distribute", headers=MGR(), json={"counts": {_uid("Jahnavi"): 2}})
    done = [r for r in client.get("/api/case-requests", headers=MGR(), params={"status": "FULFILLED"}).json() if r["name"] == "Jahnavi"]
    assert done and done[0]["cases_given"] == 2
