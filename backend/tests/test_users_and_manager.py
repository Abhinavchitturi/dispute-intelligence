"""Managing users, high-profile cases, and the manager deciding cases directly."""
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.team import User
from backend.app.services.accounts import DEMO_ACCOUNTS, ensure_users
from backend.app.services.auth_service import hash_password

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", True)


def _login(username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    return r


def _h(username, password):
    return {"Authorization": "Bearer " + _login(username, password).json()["token"]}


MGR = lambda: _h("paypal", "PayPal#Manager2026")
INV = lambda: _h("abhinav", "Abhinav#Invest2026")


# ---------- the accounts ----------
def test_three_investigators_and_a_manager_named_paypal_can_sign_in():
    for acct in DEMO_ACCOUNTS:
        r = _login(acct["username"], acct["password"])
        assert r.status_code == 200, acct["username"]
        assert r.json()["user"]["name"] == acct["display_name"] and r.json()["user"]["role"] == acct["role"]
    roles = sorted((a["display_name"], a["role"]) for a in DEMO_ACCOUNTS)
    assert roles == [("Abhinav Chitturi", "INVESTIGATOR"), ("Jahnavi", "INVESTIGATOR"), ("PayPal", "MANAGER"), ("Susmitha", "INVESTIGATOR")]


def test_the_old_demo_logins_are_renamed_not_duplicated():
    db = SessionLocal()
    try:
        before = {u.username for u in db.query(User).all()}
        assert not before & {"investigator", "investigator2", "manager"}
        # An old database: the earlier usernames. Starting up again renames them and keeps who they are.
        u = db.query(User).filter(User.username == "susmitha").first()
        uid = u.id
        u.username, u.display_name = "investigator2", "Neha Rao"
        db.commit()
        ensure_users(db)
        again = db.get(User, uid)
        assert (again.username, again.display_name) == ("susmitha", "Susmitha")  # same account, now renamed
        assert db.query(User).filter(User.username == "investigator2").count() == 0
    finally:
        db.close()


def test_starting_up_never_resets_a_password_someone_changed():
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == "jahnavi").first()
        u.password_hash = hash_password("Changed#Pass1")
        db.commit()
        ensure_users(db)
    finally:
        db.close()
    assert _login("jahnavi", "Changed#Pass1").status_code == 200
    assert _login("jahnavi", "Jahnavi#Invest2026").status_code == 401
    assert client.post(f"/api/users/{_uid('jahnavi')}/password", headers=MGR(), json={"password": "Jahnavi#Invest2026"}).status_code == 200


def _uid(username):
    db = SessionLocal()
    try:
        return db.query(User).filter(User.username == username).first().id
    finally:
        db.close()


# ---------- managing users ----------
def test_only_a_manager_manages_users():
    assert client.get("/api/users", headers=INV()).status_code == 403
    assert client.post("/api/users", headers=INV(), json={"username": "x1x", "display_name": "X", "role": "INVESTIGATOR", "password": "longenough1"}).status_code == 403
    users = client.get("/api/users", headers=MGR()).json()
    assert {u["username"] for u in users} == {"abhinav", "susmitha", "jahnavi", "paypal"}


def test_a_manager_can_add_a_user_who_can_then_sign_in():
    good = {"username": "Ravi.K", "display_name": "Ravi Kumar", "role": "INVESTIGATOR", "password": "Ravi#Invest2026", "email": "ravi@x.example"}
    r = client.post("/api/users", headers=MGR(), json=good)
    assert r.status_code == 200 and r.json()["username"] == "ravi.k" and r.json()["role"] == "INVESTIGATOR"
    assert _login("ravi.k", "Ravi#Invest2026").json()["user"]["name"] == "Ravi Kumar"
    # Bad requests say what is wrong.
    for change, text in (({"username": "ravi.k"}, "taken"), ({"username": "a"}, "3 to 32"), ({"password": "short"}, "at least 8"), ({"role": "BOSS"}, "Role"),
                         ({"username": "new.one", "display_name": "Susmitha"}, "same name|already has that name"), ({"username": "new.two", "display_name": " "}, "name")):
        bad = client.post("/api/users", headers=MGR(), json={**good, "username": "fresh.user", "display_name": "Fresh Person", **change})
        assert bad.status_code == 400, change
        import re
        assert re.search(text, bad.json()["detail"], re.I), (change, bad.json())


def test_deactivating_stops_sign_in_even_for_a_signed_in_session_and_can_be_undone():
    h = _h("jahnavi", "Jahnavi#Invest2026")
    assert client.get("/api/disputes", headers=h).status_code == 200
    assert client.patch(f"/api/users/{_uid('jahnavi')}", headers=MGR(), json={"is_active": False}).status_code == 200
    assert client.get("/api/disputes", headers=h).status_code == 401                       # the token they already held stops working
    denied = _login("jahnavi", "Jahnavi#Invest2026")
    assert denied.status_code == 403 and "deactivated" in denied.json()["detail"]
    assert client.patch(f"/api/users/{_uid('jahnavi')}", headers=MGR(), json={"is_active": True}).status_code == 200
    assert _login("jahnavi", "Jahnavi#Invest2026").status_code == 200


def test_you_cannot_lock_the_last_manager_out_or_change_your_own_role():
    me = _uid("paypal")
    assert client.patch(f"/api/users/{me}", headers=MGR(), json={"is_active": False}).status_code == 400
    assert client.patch(f"/api/users/{me}", headers=MGR(), json={"role": "INVESTIGATOR"}).status_code == 400
    # With a second manager, the first can be demoted by them, but never by themselves.
    client.post("/api/users", headers=MGR(), json={"username": "second.boss", "display_name": "Second Boss", "role": "MANAGER", "password": "Second#Boss2026"})
    other = _h("second.boss", "Second#Boss2026")
    assert client.patch(f"/api/users/{me}", headers=other, json={"role": "INVESTIGATOR"}).status_code == 200
    assert client.patch(f"/api/users/{_uid('second.boss')}", headers=other, json={"role": "INVESTIGATOR"}).status_code == 400  # now the only manager, and themselves
    client.patch(f"/api/users/{me}", headers=other, json={"role": "MANAGER"})


def test_renaming_someone_moves_their_cases_with_them():
    before = [d["id"] for d in client.get("/api/disputes", headers=MGR(), params={"assigned_to": "Susmitha"}).json()]
    assert before
    assert client.patch(f"/api/users/{_uid('susmitha')}", headers=MGR(), json={"display_name": "Susmitha R"}).status_code == 200
    after = [d["id"] for d in client.get("/api/disputes", headers=MGR(), params={"assigned_to": "Susmitha R"}).json()]
    assert sorted(after) == sorted(before)
    assert client.patch(f"/api/users/{_uid('susmitha')}", headers=MGR(), json={"display_name": "Jahnavi"}).status_code == 400  # taken
    client.patch(f"/api/users/{_uid('susmitha')}", headers=MGR(), json={"display_name": "Susmitha"})


def test_a_manager_can_reset_a_password_and_block_someone_by_hand():
    uid = _uid("abhinav")
    assert client.post(f"/api/users/{uid}/password", headers=MGR(), json={"password": "short"}).status_code == 400
    assert client.post(f"/api/users/{uid}/password", headers=MGR(), json={"password": "Fresh#Pass2026"}).status_code == 200
    assert _login("abhinav", "Abhinav#Invest2026").status_code == 401 and _login("abhinav", "Fresh#Pass2026").status_code == 200
    h = _h("abhinav", "Fresh#Pass2026")
    assert client.post(f"/api/users/{uid}/block", headers=MGR(), json={"reason": "no"}).status_code == 400
    assert client.post(f"/api/users/{uid}/block", headers=MGR(), json={"reason": "Reviewing their recent cases."}).status_code == 200
    assert client.get("/api/disputes", headers=h).status_code == 403
    assert client.post(f"/api/users/{uid}/block", headers=MGR(), json={"reason": "Twice in a row."}).status_code == 400
    assert client.post(f"/api/team/{uid}/unblock", headers=MGR(), json={}).status_code == 200
    assert client.get("/api/disputes", headers=h).status_code == 200
    assert client.post(f"/api/users/{_uid('paypal')}/block", headers=MGR(), json={"reason": "Can't block a manager."}).status_code == 400
    client.post(f"/api/users/{uid}/password", headers=MGR(), json={"password": "Abhinav#Invest2026"})


def test_user_changes_are_in_the_activity_log():
    actions = {e["action"] for e in client.get("/api/audit-events", headers=MGR()).json()}
    assert {"USER_CREATED", "USER_DEACTIVATED", "PASSWORD_RESET", "ACCOUNT_BLOCKED"} <= actions


# ---------- high-profile cases go to the manager ----------
def test_high_profile_goes_by_price_alone_not_by_score():
    cases = client.get("/api/disputes", headers=MGR(), params={"limit": 100}).json()
    for c in cases:
        assert c["is_high_profile"] == (c["amount"] >= settings.HIGH_PROFILE_AMOUNT)
    # A very urgent small case is not high-profile, and a calm big one is. The score is irrelevant.
    assert any(c["priority_score"] >= 70 and not c["is_high_profile"] for c in cases)
    assert not hasattr(settings, "HIGH_PROFILE_SCORE")
    hp = client.get("/api/disputes", headers=MGR(), params={"high_profile": True, "limit": 100}).json()
    assert hp and {c["id"] for c in hp} == {c["id"] for c in cases if c["is_high_profile"]}


def test_the_threshold_is_a_setting(monkeypatch):
    big = [c for c in client.get("/api/disputes", headers=MGR(), params={"limit": 100}).json() if c["amount"] >= 500]
    monkeypatch.setattr(settings, "HIGH_PROFILE_AMOUNT", 500.0)
    after = {c["id"]: c["is_high_profile"] for c in client.get("/api/disputes", headers=MGR(), params={"limit": 100}).json()}
    assert big and all(after[c["id"]] for c in big)
    hp = client.get("/api/disputes", headers=MGR(), params={"high_profile": True, "limit": 100}).json()
    assert {c["id"] for c in hp} == {i for i, v in after.items() if v}


def test_open_high_profile_cases_are_assigned_to_the_manager_and_the_rest_are_shared():
    cases = [c for c in client.get("/api/disputes", headers=MGR(), params={"limit": 100}).json() if c["status"] not in ("RESOLVED", "CLOSED")]
    assert all(c["assigned_to"] == "PayPal" for c in cases if c["is_high_profile"])
    others = {c["assigned_to"] for c in cases if not c["is_high_profile"] and c["assigned_to"]}
    assert others <= {"Abhinav Chitturi", "Susmitha", "Jahnavi"} and len(others) >= 2  # shared out, not all on one person
    waiting = [c for c in cases if not c["assigned_to"]]
    assert len(waiting) >= 3 and not any(c["is_high_profile"] for c in waiting)        # a few new arrivals are left for the manager to hand out
    summary = client.get("/api/dashboard/summary", headers=MGR()).json()
    assert summary["high_profile_count"] == len([c for c in cases if c["is_high_profile"]])


# ---------- the manager decides directly ----------
def test_a_managers_decision_is_final_at_once_with_no_ai_review():
    hp = next(c for c in client.get("/api/disputes", headers=MGR(), params={"high_profile": True}).json() if c["status"] not in ("RESOLVED", "CLOSED"))
    did = hp["id"]
    r = client.post(f"/api/disputes/{did}/decision", headers=MGR(), json={"outcome": "BUYER_FAVOR", "reason": "The carrier never confirmed the address.", "confirmed": True})
    assert r.status_code == 200 and r.json()["status"] == "RESOLVED"
    d = client.get(f"/api/disputes/{did}", headers=MGR()).json()
    assert d["status"] == "RESOLVED" and d["outcome"] == "BUYER_FAVOR" and d["decided_by"] == "MANAGER" and d["ai_verdict"] is None
    notices = [m for m in client.get(f"/api/disputes/{did}/messages", headers=MGR()).json() if m["action_type"] == "DECIDE_FOR_BUYER"]
    assert {m["counterparty"] for m in notices} == {"SELLER", "BUYER"} and "The carrier never confirmed" in notices[0]["body"]
    assert any("Decision on dispute" in e["subject"] for e in client.get(f"/api/disputes/{did}/emails", headers=MGR()).json())
    # No strike for anyone: the AI never overturned an investigator.
    assert all(t["strikes"] == 0 for t in client.get("/api/team", headers=MGR()).json())
