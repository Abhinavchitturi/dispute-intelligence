import asyncio

import httpx

import pytest
from fastapi.testclient import TestClient

from backend.app.database import SessionLocal
from backend.app.main import app, poll_paypal_once
from backend.app.models.audit import AuditEvent
from backend.app.models.dispute import Dispute, Order, Shipment, Transaction
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.services.paypal_client import PayPalClient

client = TestClient(app)

EXTERNAL_ID = "PP-R-TEST-10000001"
TRANSACTION_ID = "TEST-PAYPAL-TXN-1"
LOCAL_ID = f"PAYPAL-{EXTERNAL_ID}"


def _summary(update_time="2026-10-21T10:00:00Z", status="WAITING_FOR_SELLER_RESPONSE"):
    """What the list call returns: a summary only."""
    return {
        "dispute_id": EXTERNAL_ID,
        "create_time": "2026-10-20T10:00:00Z",
        "update_time": update_time,
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "status": status,
        "dispute_amount": {"value": "49.99", "currency_code": "USD"},
    }


def _details(status="WAITING_FOR_SELLER_RESPONSE", messages=None, outcome=None):
    """What the details call returns once the buyer has reported the problem in the Resolution Center."""
    body = {
        "dispute_id": EXTERNAL_ID,
        "status": status,
        "seller_response_due_date": "2026-10-30T10:00:00Z",
        # Shaped like a real sandbox response: the buyer sits on the transaction, and their description on the item.
        "disputed_transactions": [{
            "seller_transaction_id": TRANSACTION_ID,
            "gross_amount": {"value": "49.99", "currency_code": "USD"},
            "create_time": "2026-10-19T10:00:00Z",
            "buyer": {"name": "Sandbox Buyer", "email": "buyer@example.test", "payer_id": "PAYER1"},
            "items": [{"item_name": "Spike test item", "notes": "It arrived broken and doesn't match the photos."}],
        }],
        "messages": messages if messages is not None else [
            {"posted_by": "BUYER", "time_posted": "2026-10-20T10:05:00Z", "content": "The parcel never arrived."},
        ],
        "evidences": [{
            "evidence_type": "OTHER", "source": "SUBMITTED_BY_BUYER", "date": "2026-10-20T10:06:00Z",
            "notes": "Photo of my empty mailbox.", "documents": [{"name": "mailbox.jpg"}],
        }, {
            "evidence_type": "PROOF_OF_REFUND", "source": "REQUESTED_FROM_SELLER", "documents": [],
        }],
    }
    if outcome:
        body["dispute_outcome"] = {"outcome_code": outcome}
    return body


class FakePayPal:
    def __init__(self, monkeypatch):
        self.summary = _summary()
        self.details = _details()
        self.detail_calls = 0
        fake = self

        async def get_disputes(cls, page_size=50, max_pages=20):
            return {"items": [fake.summary]}

        async def get_dispute_details(cls, external_dispute_id):
            assert external_dispute_id == EXTERNAL_ID
            fake.detail_calls += 1
            return fake.details

        # The order behind the payment, and the seller's tracking on it, as PayPal returns them.
        self.order = {
            "id": "ORDER1", "create_time": "2026-10-19T09:00:00Z", "update_time": "2026-10-19T12:00:00Z",
            "purchase_units": [{
                "invoice_id": "INV-1001", "amount": {"currency_code": "USD", "value": "49.99"},
                "items": [{"name": "Wireless headphones", "quantity": "1"}],
                "shipping": {"address": {"address_line_1": "2211 N First Street", "admin_area_2": "San Jose", "admin_area_1": "CA", "postal_code": "95131"},
                             "trackers": [{"id": f"{TRANSACTION_ID}-9400100000000000000001", "status": "DELIVERED"}]},
            }],
        }

        async def get_json(cls, path):
            if path == f"/v2/payments/captures/{TRANSACTION_ID}":
                return {"links": [{"rel": "up", "href": "https://api.sandbox.paypal.com/v2/checkout/orders/ORDER1"}]}
            if path == "/v2/checkout/orders/ORDER1":
                return fake.order
            if path.startswith("/v1/shipping/trackers/"):
                return {"tracking_number": "9400100000000000000001", "status": "DELIVERED", "carrier": "USPS"}
            raise AssertionError(f"unexpected PayPal call {path}")

        monkeypatch.setattr(PayPalClient, "is_configured", classmethod(lambda cls: True))
        monkeypatch.setattr(PayPalClient, "get_disputes", classmethod(get_disputes))
        monkeypatch.setattr(PayPalClient, "get_dispute_details", classmethod(get_dispute_details))
        monkeypatch.setattr(PayPalClient, "get_json", classmethod(get_json))


def _clean(db):
    db.query(Shipment).filter(Shipment.order_id == "PAYPAL-ORD-ORDER1").delete()
    db.query(Order).filter(Order.id == "PAYPAL-ORD-ORDER1").delete()
    db.query(DisputeMessage).filter(DisputeMessage.dispute_id == LOCAL_ID).delete()
    db.query(Evidence).filter(Evidence.dispute_id == LOCAL_ID).delete()
    db.query(AuditEvent).filter(AuditEvent.actor == "paypal_poller").delete()
    db.query(Dispute).filter(Dispute.external_dispute_id == EXTERNAL_ID).delete()
    db.query(Transaction).filter(Transaction.external_transaction_id == TRANSACTION_ID).delete()
    db.commit()


@pytest.fixture
def db():
    session = SessionLocal()
    _clean(session)
    try:
        yield session
    finally:
        session.rollback()
        _clean(session)
        session.close()


@pytest.fixture
def paypal(monkeypatch):
    return FakePayPal(monkeypatch)


def test_paypal_disputes_sync_are_imported_and_updated(db, paypal):
    first = client.post("/api/integrations/paypal/sync")
    assert first.status_code == 200
    assert first.json()["created"] == 1
    assert first.json()["updated"] == 0

    imported = client.get(f"/api/disputes?search={EXTERNAL_ID}")
    assert imported.status_code == 200
    dispute = imported.json()[0]
    assert dispute["id"] == LOCAL_ID
    assert dispute["source"] == "paypal_sandbox"
    assert dispute["amount"] == 49.99
    assert dispute["buyer_reference"] == "Sandbox Buyer"

    second = client.post("/api/integrations/paypal/sync")
    assert second.status_code == 200
    assert second.json()["created"] == 0
    assert second.json()["updated"] == 1


def test_buyer_report_details_become_messages_and_evidence(db, paypal):
    result = client.post("/api/integrations/paypal/sync").json()
    assert result["new_messages"] == 1
    assert result["new_evidence"] == 1

    msg = db.query(DisputeMessage).filter(DisputeMessage.dispute_id == LOCAL_ID).one()
    assert (msg.direction, msg.counterparty, msg.source, msg.is_read) == ("INBOUND", "BUYER", "paypal_sandbox", False)
    assert msg.body == "The parcel never arrived."
    ev = db.query(Evidence).filter(Evidence.dispute_id == LOCAL_ID).one()
    assert ev.availability_status == "PENDING_VERIFICATION"
    assert ev.description == "Photo of my empty mailbox."  # the REQUESTED_FROM_SELLER entry is not evidence
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    assert d.buyer_claim == "It arrived broken and doesn't match the photos."
    txn = db.query(Transaction).filter(Transaction.external_transaction_id == TRANSACTION_ID).one()
    assert txn.buyer_email_masked == "b***@example.test"


def test_unchanged_dispute_is_not_reread_and_nothing_is_duplicated(db, paypal):
    client.post("/api/integrations/paypal/sync")
    assert paypal.detail_calls == 1
    client.post("/api/integrations/paypal/sync")
    assert paypal.detail_calls == 1  # PayPal's update_time didn't move, so the details aren't fetched again

    # The buyer adds a message on PayPal: the details are read again, and only the new message is added.
    paypal.summary = _summary(update_time="2026-10-22T10:00:00Z")
    paypal.details = _details(messages=paypal.details["messages"] + [
        {"posted_by": "BUYER", "time_posted": "2026-10-22T09:00:00Z", "content": "Still nothing."},
    ])
    result = client.post("/api/integrations/paypal/sync").json()
    assert paypal.detail_calls == 2
    assert result["new_messages"] == 1
    assert result["new_evidence"] == 0
    assert db.query(DisputeMessage).filter(DisputeMessage.dispute_id == LOCAL_ID).count() == 2


def test_refresh_keeps_the_investigation_state(db, paypal):
    client.post("/api/integrations/paypal/sync")
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    d.status, d.evidence_status, d.assigned_to = "IN_PROGRESS", "PARTIAL", "investigator_1"
    db.commit()

    paypal.summary = _summary(update_time="2026-10-23T10:00:00Z")
    client.post("/api/integrations/paypal/sync")
    db.expire_all()
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    assert (d.status, d.evidence_status, d.assigned_to) == ("IN_PROGRESS", "PARTIAL", "investigator_1")


def test_dispute_resolved_on_paypal_closes_the_local_case(db, paypal):
    client.post("/api/integrations/paypal/sync")
    paypal.summary = _summary(update_time="2026-10-24T10:00:00Z", status="RESOLVED")
    paypal.details = _details(status="RESOLVED", outcome="RESOLVED_BUYER_FAVOUR")
    client.post("/api/integrations/paypal/sync")
    db.expire_all()
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    assert (d.status, d.outcome) == ("RESOLVED", "BUYER_FAVOR")


def test_poller_imports_a_new_report_and_stays_quiet_when_nothing_changed(db, paypal):
    first = asyncio.run(poll_paypal_once())
    assert first["new_dispute_ids"] == [LOCAL_ID]
    assert db.query(AuditEvent).filter(AuditEvent.actor == "paypal_poller").count() == 1

    second = asyncio.run(poll_paypal_once())
    assert second["created"] == 0
    assert db.query(AuditEvent).filter(AuditEvent.actor == "paypal_poller").count() == 1


def test_sync_without_credentials_is_refused(monkeypatch):
    monkeypatch.setattr(PayPalClient, "is_configured", classmethod(lambda cls: False))
    response = client.post("/api/integrations/paypal/sync")
    assert response.status_code == 503


def test_client_pages_through_disputes_within_paypals_limit(monkeypatch):
    """PayPal rejects page_size over 50 and pages with a "next" link."""
    from backend.app.config import settings
    from backend.app.services import paypal_client as pc
    base = settings.PAYPAL_BASE_URL
    seen = []

    def handler(request):
        seen.append(request.url)
        if "next_page_token" in str(request.url):
            return pc.httpx.Response(200, json={"items": [{"dispute_id": "B"}], "links": []})
        assert request.url.params["page_size"] == "50"
        return pc.httpx.Response(200, json={"items": [{"dispute_id": "A"}], "links": [
            {"rel": "next", "href": f"{base}/v1/customer/disputes?page_size=50&next_page_token=xyz"}]})

    real = pc.httpx.AsyncClient
    monkeypatch.setattr(pc.httpx, "AsyncClient", lambda **kw: real(transport=pc.httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(PayPalClient, "get_access_token", classmethod(lambda cls: _token()))
    result = asyncio.run(PayPalClient.get_disputes(page_size=100))
    assert [i["dispute_id"] for i in result["items"]] == ["A", "B"]
    assert len(seen) == 2


async def _token():
    return "test-token"


def test_new_cases_arrive_as_new_whatever_paypal_calls_them(db, paypal):
    # PayPal shows an inquiry as UNDER_REVIEW, which this app would read as "Ready to decide".
    paypal.details = _details(status="UNDER_REVIEW")
    client.post("/api/integrations/paypal/sync")
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    assert d.status == "OPEN"


def test_import_one_case_by_id_before_paypal_lists_it(db, paypal):
    # Not synced from the list at all: the case is read directly by its ID.
    first = client.post(f"/api/integrations/paypal/import/{EXTERNAL_ID.lower()}")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["dispute_id"] == LOCAL_ID and body["created"] is True
    assert body["new_messages"] == 1 and body["new_evidence"] == 1

    again = client.post(f"/api/integrations/paypal/import/{EXTERNAL_ID}")
    assert again.json()["created"] is False
    assert db.query(DisputeMessage).filter(DisputeMessage.dispute_id == LOCAL_ID).count() == 1


def test_import_rejects_something_that_isnt_a_case_id(db, paypal):
    assert client.post("/api/integrations/paypal/import/hello").status_code == 400


def test_import_of_an_unknown_case_says_so(db, monkeypatch):
    async def not_found(cls, external_dispute_id):
        request = httpx.Request("GET", "https://api-m.sandbox.paypal.com/x")
        raise httpx.HTTPStatusError("404", request=request, response=httpx.Response(404, request=request))
    monkeypatch.setattr(PayPalClient, "is_configured", classmethod(lambda cls: True))
    monkeypatch.setattr(PayPalClient, "get_dispute_details", classmethod(not_found))
    response = client.post("/api/integrations/paypal/import/PP-R-NOPE-1")
    assert response.status_code == 404
    assert "no case PP-R-NOPE-1" in response.json()["detail"]


def test_import_brings_in_what_was_bought_and_the_sellers_tracking(db, paypal):
    client.post("/api/integrations/paypal/sync")
    d = db.query(Dispute).filter(Dispute.id == LOCAL_ID).one()
    assert d.order_id == "PAYPAL-ORD-ORDER1"
    order = db.get(Order, "PAYPAL-ORD-ORDER1")
    assert order.item_summary == "1 × Wireless headphones"
    assert order.merchant_reference == "INV-1001"
    ship = db.query(Shipment).filter(Shipment.order_id == order.id).one()
    assert (ship.carrier, ship.tracking_reference, ship.status) == ("USPS", "9400100000000000000001", "DELIVERED")
    assert ship.shipping_address_masked == "*** N First Street, San Jose, CA, 95131"   # no house number
    assert ship.delivered_at is not None


def test_a_dispute_still_imports_when_the_order_cant_be_read(db, paypal, monkeypatch):
    async def broken(cls, path):
        raise ConnectionError("PayPal down")
    monkeypatch.setattr(PayPalClient, "get_json", classmethod(broken))
    assert client.post("/api/integrations/paypal/sync").json()["created"] == 1
    assert db.query(Dispute).filter(Dispute.id == LOCAL_ID).one().order_id is None


def test_the_buyers_text_is_found_on_their_filing_when_the_item_has_none(db, paypal):
    paypal.details["disputed_transactions"][0]["items"] = [{"item_name": "Wireless headphones"}]   # no notes on the item
    paypal.details["evidences"][0]["notes"] = "Tracking says delivered, but nothing arrived."
    client.post("/api/integrations/paypal/sync")
    assert db.query(Dispute).filter(Dispute.id == LOCAL_ID).one().buyer_claim == "Tracking says delivered, but nothing arrived."


def test_hidden_cases_are_left_out_of_the_sync(db, paypal, monkeypatch):
    from backend.app.config import settings
    monkeypatch.setattr(settings, "PAYPAL_HIDDEN_CASES", f"{EXTERNAL_ID.lower()}, PP-R-OTHER-1")
    result = client.post("/api/integrations/paypal/sync").json()
    assert result["created"] == 0 and result["total"] == 0
    assert db.query(Dispute).filter(Dispute.id == LOCAL_ID).count() == 0
