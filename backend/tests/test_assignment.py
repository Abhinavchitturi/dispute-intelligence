"""Every new case is assigned at once to the investigator with the fewest open cases. Nobody hands cases out by hand."""
import pytest
from fastapi.testclient import TestClient

from backend.app.config import settings
from backend.app.database import SessionLocal
from backend.app.main import app
from backend.app.models.audit import AuditEvent
from backend.app.models.dispute import Dispute
from backend.app.models.team import Notification, User
from backend.app.services import assignment_service as svc
from backend.app.services.message_service import OPEN_STATUSES

pytestmark = pytest.mark.usefixtures("fresh_demo_data")
client = TestClient(app)
TEAM = ["Abhinav Chitturi", "Susmitha", "Jahnavi"]


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.rollback()
    session.close()


def _open_load(db):
    return {name: svc.open_cases(db, name) for name in TEAM}


def _new_case(db, did, priority=50.0):
    db.query(Dispute).filter(Dispute.id == did).delete()
    d = Dispute(id=did, source="synthetic", reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status="OPEN", amount=100.0, priority_score=priority)
    db.add(d)
    db.commit()
    return d


def _cleanup(db, *ids):
    db.query(Notification).filter(Notification.dispute_id.in_(ids)).delete(synchronize_session=False)
    db.query(AuditEvent).filter(AuditEvent.dispute_id.in_(ids)).delete(synchronize_session=False)
    db.query(Dispute).filter(Dispute.id.in_(ids)).delete(synchronize_session=False)
    db.commit()


def test_a_new_case_goes_to_whoever_has_the_fewest_open_cases(db):
    load = _open_load(db)
    lightest = min(TEAM, key=lambda n: (load[n], db.query(Dispute).filter(Dispute.assigned_to == n).count(), n))
    try:
        d = _new_case(db, "TEST-AUTO-1")
        assert svc.auto_assign(db, [d]) == 1
        assert d.assigned_to == lightest
        audit = db.query(AuditEvent).filter(AuditEvent.dispute_id == "TEST-AUTO-1", AuditEvent.action == "AUTO_ASSIGNED").one()
        assert "fewest open cases" in audit.result_summary
        who = db.query(User).filter(User.display_name == lightest).one()
        assert db.query(Notification).filter(Notification.user_id == who.id, Notification.dispute_id == "TEST-AUTO-1").count() == 1
    finally:
        _cleanup(db, "TEST-AUTO-1")


def test_a_batch_of_new_cases_is_spread_so_nobody_ends_up_far_behind(db):
    ids = [f"TEST-AUTO-B{i}" for i in range(6)]
    try:
        cases = [_new_case(db, did) for did in ids]
        before = _open_load(db)
        assert svc.auto_assign(db, cases) == 6
        after = _open_load(db)
        # Each case went to whoever was lightest at that moment, so the gap between people can only shrink (or stay put).
        assert max(after.values()) - min(after.values()) <= max(1, max(before.values()) - min(before.values()))
        assert sum(after.values()) == sum(before.values()) + 6
    finally:
        _cleanup(db, *ids)


def test_a_blocked_investigator_is_never_given_a_case(db):
    sus = db.query(User).filter(User.display_name == "Susmitha").one()
    sus.is_blocked = True
    db.commit()
    ids = [f"TEST-AUTO-X{i}" for i in range(4)]
    try:
        cases = [_new_case(db, did) for did in ids]
        svc.auto_assign(db, cases)
        assert all(c.assigned_to in ("Abhinav Chitturi", "Jahnavi") for c in cases)
    finally:
        sus.is_blocked = False
        db.commit()
        _cleanup(db, *ids)


def test_with_nobody_able_to_take_cases_they_wait_and_go_out_later(db, monkeypatch):
    monkeypatch.setattr(svc, "workable_investigators", lambda _db: [])
    try:
        d = _new_case(db, "TEST-AUTO-W")
        assert svc.auto_assign(db, [d]) == 0 and d.assigned_to is None
        monkeypatch.undo()
        assert svc.auto_assign(db) >= 1                 # the next round picks up whatever is still waiting
        db.refresh(d)
        assert d.assigned_to in TEAM
    finally:
        _cleanup(db, "TEST-AUTO-W")


def test_cases_the_ai_agent_owns_and_closed_cases_are_left_alone(db):
    try:
        mine = _new_case(db, "TEST-AUTO-AI")
        mine.ai_owned = True
        done = _new_case(db, "TEST-AUTO-DONE")
        done.status = "RESOLVED"
        db.commit()
        assert svc.auto_assign(db, [mine, done]) == 0
        assert mine.assigned_to is None and done.assigned_to is None
    finally:
        _cleanup(db, "TEST-AUTO-AI", "TEST-AUTO-DONE")


def test_the_background_round_leaves_no_ordinary_open_case_without_an_owner(db):
    svc.auto_assign(db)
    left = db.query(Dispute).filter(Dispute.status.in_(OPEN_STATUSES), Dispute.assigned_to.is_(None), Dispute.ai_owned.isnot(True),
                                    Dispute.amount < settings.HIGH_PROFILE_AMOUNT).count()
    assert left == 0


def test_a_high_profile_case_is_left_for_the_manager(db):
    try:
        big = _new_case(db, "TEST-AUTO-BIG")
        big.amount = settings.HIGH_PROFILE_AMOUNT + 1
        db.commit()
        assert svc.auto_assign(db, [big]) == 0 and big.assigned_to is None
    finally:
        _cleanup(db, "TEST-AUTO-BIG")


@pytest.mark.parametrize("path", ["/api/cases/distribute", "/api/cases/assign", "/api/case-requests", "/api/disputes/DEMO-DSP-1043/assign"])
def test_nobody_hands_cases_out_by_hand_any_more(path, monkeypatch):
    monkeypatch.setattr(settings, "AUTH_REQUIRED", False)
    assert client.post(path, json={"assignee": "Susmitha"}).status_code in (404, 405)
