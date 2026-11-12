"""A case decided in ResolveIQ is carried out on PayPal: the buyer's favor refunds the buyer there."""
import asyncio

import httpx
import pytest

from backend.app.database import SessionLocal
from backend.app.models.audit import AuditEvent
from backend.app.models.dispute import Dispute
from backend.app.models.team import Flag
from backend.app.services import paypal_sync
from backend.app.services.paypal_client import PayPalClient

CASE, PP = "PAYPAL-PP-R-DEC-10000001", "PP-R-DEC-10000001"


class FakePayPal:
    def __init__(self, monkeypatch, refund_types=("REFUND", "PARTIAL_REFUND"), fail=None, links=("self", "accept_claim"),
                 refunded=False, status="WAITING_FOR_SELLER_RESPONSE"):
        self.posts = []
        fake = self

        self.links = list(links)

        async def details(cls, did):
            body = {"dispute_id": did, "status": status,
                    "links": [{"rel": r, "href": "x"} for r in fake.links],
                    "disputed_transactions": [{"seller_transaction_id": "CAP1"}],
                    "dispute_amount": {"currency_code": "USD", "value": "289.00"},
                    "refund_details": {"allowed_refund_amount": {"currency_code": "USD", "value": "289.00"}},
                    "allowed_response_options": {"accept_claim": {"accept_claim_types": list(refund_types)}}}
            if refunded:
                body["fund_movements"] = [{"party": "BUYER", "type": "CREDIT", "reason": "DISPUTE_SETTLEMENT",
                                           "amount": {"currency_code": "USD", "value": "289.00"}}]
            return body

        async def post(cls, path, body):
            fake.posts.append((path, body))
            if path.endswith("/escalate"):          # a claim under PayPal's review can be ruled on
                fake.links = ["self", "adjudicate"]
            if fail:
                request = httpx.Request("POST", "https://api-m.sandbox.paypal.com" + path)
                raise httpx.HTTPStatusError("x", request=request, response=httpx.Response(
                    fail, request=request, json={"details": [{"issue": "X", "description": "Not allowed at this stage."}]}))
            return {}

        monkeypatch.setattr(PayPalClient, "is_configured", classmethod(lambda cls: True))
        monkeypatch.setattr(PayPalClient, "get_dispute_details", classmethod(details))
        monkeypatch.setattr(PayPalClient, "post_json", classmethod(post))


@pytest.fixture
def db():
    session = SessionLocal()

    def clean():
        session.query(AuditEvent).filter(AuditEvent.dispute_id == CASE).delete()
        session.query(Flag).filter(Flag.dispute_id == CASE).delete()
        session.query(Dispute).filter(Dispute.id == CASE).delete()
        session.commit()
    clean()
    yield session
    session.rollback()
    clean()
    session.close()


def _decided(db, outcome="BUYER_FAVOR", decided_by="MANAGER"):
    db.add(Dispute(id=CASE, external_dispute_id=PP, source="paypal_sandbox", status="RESOLVED", outcome=outcome,
                   decided_by=decided_by, amount=289.0, currency="USD", reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED"))
    db.commit()


def _audits(db):
    return [(a.action, a.status) for a in db.query(AuditEvent).filter(AuditEvent.dispute_id == CASE).all()]


def test_buyers_favor_refunds_the_buyer_on_paypal_once(db, monkeypatch):
    fake = FakePayPal(monkeypatch)
    _decided(db)
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [(f"/v1/customer/disputes/{PP}/accept-claim",
                           {"note": f"Decided in the buyer's favor after investigation in ResolveIQ ({CASE}).", "accept_claim_type": "REFUND"})]
    assert "Accepted the buyer's claim on PayPal" in sent[0]
    assert _audits(db) == [("PAYPAL_DECISION_SENT", "SUCCESS")]
    asyncio.run(paypal_sync.push_decisions(db))
    assert len(fake.posts) == 1                                   # never refunded twice


def test_sellers_favor_is_settled_on_paypal(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self", "adjudicate"))
    _decided(db, "SELLER_FAVOR")
    asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [(f"/v1/customer/disputes/{PP}/adjudicate", {"adjudication_outcome": "SELLER_FAVOR"})]


def test_paypal_refusing_is_recorded_once_and_not_retried(db, monkeypatch):
    fake = FakePayPal(monkeypatch, fail=422, links=("self", "adjudicate"))
    _decided(db, "SELLER_FAVOR")
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert "Not allowed at this stage." in sent[0]
    asyncio.run(paypal_sync.push_decisions(db))
    assert len(fake.posts) == 1
    assert _audits(db) == [("PAYPAL_DECISION_NOT_SENT", "FAILED")]


def test_a_paypal_outage_is_retried_next_round(db, monkeypatch):
    fake = FakePayPal(monkeypatch, fail=503)
    _decided(db)
    assert asyncio.run(paypal_sync.push_decisions(db)) == []
    asyncio.run(paypal_sync.push_decisions(db))
    assert len(fake.posts) == 2 and _audits(db) == []


def test_a_case_paypal_closed_by_itself_is_left_alone(db, monkeypatch):
    fake = FakePayPal(monkeypatch)
    _decided(db, decided_by=None)
    asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == []


def test_when_paypal_already_paid_the_buyer_back_nothing_more_is_sent(db, monkeypatch):
    fake = FakePayPal(monkeypatch, refunded=True)
    _decided(db)
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [] and "has refunded the buyer USD 289.00" in sent[0]


def test_with_no_seller_action_open_the_payment_itself_is_refunded(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self",))         # an inquiry PayPal is reviewing: no accept-claim
    _decided(db)
    asyncio.run(paypal_sync.push_decisions(db))
    path, body = fake.posts[0]
    assert path == "/v2/payments/captures/CAP1/refund"
    assert body["amount"] == {"currency_code": "USD", "value": "289.00"}


def test_sellers_favor_that_paypal_wont_take_is_explained(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self", "accept_claim", "make_offer"))
    _decided(db, "SELLER_FAVOR")
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [] and "No money moved" in sent[0]


def test_sync_paypal_tries_a_refused_case_again(db, monkeypatch):
    fake = FakePayPal(monkeypatch, fail=422, links=("self", "adjudicate"))
    _decided(db, "SELLER_FAVOR")
    asyncio.run(paypal_sync.push_decisions(db))
    asyncio.run(paypal_sync.push_decisions(db, retry_refused=True))
    assert len(fake.posts) == 2


def test_the_decision_is_paypals_ruling_when_paypal_offers_one(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self", "adjudicate", "accept_claim"))
    _decided(db)
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [(f"/v1/customer/disputes/{PP}/adjudicate", {"adjudication_outcome": "BUYER_FAVOR"})]
    assert "ruled it in the buyer's favor" in sent[0]


def test_an_inquiry_is_escalated_to_a_claim_and_then_ruled_on(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self", "escalate", "accept_claim"))
    _decided(db, "SELLER_FAVOR")
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert [p for p, _ in fake.posts] == [f"/v1/customer/disputes/{PP}/escalate", f"/v1/customer/disputes/{PP}/adjudicate"]
    assert fake.posts[1][1] == {"adjudication_outcome": "SELLER_FAVOR"}
    assert "escalated the inquiry to a claim and ruled it in the seller's favor" in sent[0]


def _overturned(db, to):
    """PayPal was already told the first outcome; then a manager overturned it."""
    from datetime import datetime, timedelta
    d = db.get(Dispute, CASE)
    d.outcome = to
    now = datetime.utcnow()
    db.add(AuditEvent(id="AUDIT-sent-1", dispute_id=CASE, actor="paypal_poller", action="PAYPAL_DECISION_SENT", status="SUCCESS",
                      source="paypal_sandbox", result_summary="first", created_at=now - timedelta(minutes=5)))
    db.add(AuditEvent(id="AUDIT-over-1", dispute_id=CASE, actor="manager", action="DECISION_OVERTURNED", status="SUCCESS",
                      source="paypal_sandbox", result_summary="changed", created_at=now))
    db.commit()


def test_an_overturn_to_the_buyer_refunds_them_after_paypal_closed_it(db, monkeypatch):
    fake = FakePayPal(monkeypatch, status="RESOLVED", links=("self",))
    _decided(db, "SELLER_FAVOR")
    _overturned(db, "BUYER_FAVOR")
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts[0][0] == "/v2/payments/captures/CAP1/refund"
    assert "the decision was overturned" in sent[0]


def test_an_overturn_to_the_seller_cant_take_a_refund_back(db, monkeypatch):
    fake = FakePayPal(monkeypatch, status="RESOLVED", links=("self",), refunded=True)
    _decided(db, "BUYER_FAVOR")
    _overturned(db, "SELLER_FAVOR")
    sent = asyncio.run(paypal_sync.push_decisions(db))
    assert fake.posts == [] and "can't be taken back" in sent[0]


def test_a_reported_decision_waits_for_the_manager(db, monkeypatch):
    fake = FakePayPal(monkeypatch, links=("self", "adjudicate"))
    _decided(db)
    db.add(Flag(id="FLG-test1", dispute_id=CASE, raised_by="u1", points="The AI missed the camera footage.", status="OPEN"))
    db.commit()
    assert asyncio.run(paypal_sync.push_decisions(db)) == [] and fake.posts == []


def test_a_reported_case_cant_be_reopened_only_overturned_or_kept(db):
    from backend.app.services.decision_service import DecisionError, DecisionService
    _decided(db)
    db.add(Flag(id="FLG-test2", dispute_id=CASE, raised_by="u1", points="The AI missed the camera footage.", status="OPEN"))
    db.commit()
    with pytest.raises(DecisionError, match="stays closed"):
        DecisionService.send_back(db, db.get(Dispute, CASE), "manager", "Look again at this one.")
    assert db.get(Dispute, CASE).status == "RESOLVED"


def test_a_refused_case_is_tried_again_by_itself_once_paypal_changes_it(db, monkeypatch):
    from datetime import datetime, timedelta
    fake = FakePayPal(monkeypatch, fail=422, links=("self", "adjudicate"))
    _decided(db, "SELLER_FAVOR")
    asyncio.run(paypal_sync.push_decisions(db))
    asyncio.run(paypal_sync.push_decisions(db))
    assert len(fake.posts) == 1                                     # nothing changed on PayPal: no retry
    d = db.get(Dispute, CASE)
    d.raw_payload_reference = (datetime.utcnow() + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")   # PayPal moved the case on
    db.commit()
    asyncio.run(paypal_sync.push_decisions(db))
    assert len(fake.posts) == 2
