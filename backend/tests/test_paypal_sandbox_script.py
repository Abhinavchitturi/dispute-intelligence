"""The one-command sandbox payment script, against a fake PayPal."""
import importlib.util
from pathlib import Path

import httpx
import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "paypal_sandbox.py"
spec = importlib.util.spec_from_file_location("paypal_sandbox", SCRIPT)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)

BASE = ps.SANDBOX_BASE


class FakePayPal:
    """Just enough of the Orders and Disputes APIs. approve_after: how many status checks before the buyer clicks Pay."""

    def __init__(self, approve_after=1, vault_works=True, vault_charge_fails=False):
        self.approve_after = approve_after
        self.vault_works = vault_works
        self.vault_charge_fails = vault_charge_fails
        self.status_checks = 0
        self.orders = {}
        self.disputes = {}       # id -> detail
        self.calls = []

    def completed(self, oid, body):
        out = {"id": oid, "status": "COMPLETED", "payer": {"email_address": "buyer@example.test"},
               "purchase_units": [{"payments": {"captures": [{"id": f"CAP-{oid}", "status": "COMPLETED"}]}}]}
        if self.vault_works and "attributes" in body["payment_source"]["paypal"]:
            out["payment_source"] = {"paypal": {"attributes": {"vault": {"id": "VAULT-1", "status": "VAULTED"}}}}
        return out

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.calls.append((request.method, path))
        if path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "t", "scope": "https://uri.paypal.com/services/disputes/read-seller"})
        if request.method == "POST" and path == "/v2/checkout/orders":
            import json
            body = json.loads(request.content)
            oid = f"O{len(self.orders) + 1}"
            if "vault_id" in body["payment_source"]["paypal"]:
                if self.vault_charge_fails:
                    return httpx.Response(422, json={"name": "UNPROCESSABLE_ENTITY", "details": [{"issue": "PAYMENT_SOURCE_DECLINED"}]})
                self.orders[oid] = self.completed(oid, body)  # a saved buyer is charged at once
            else:
                self.orders[oid] = {"id": oid, "status": "PAYER_ACTION_REQUIRED", "body": body,
                                    "links": [{"rel": "payer-action", "href": f"https://www.sandbox.paypal.com/checkoutnow?token={oid}"}]}
            return httpx.Response(200, json=self.orders[oid])
        if request.method == "GET" and path.startswith("/v2/checkout/orders/"):
            order = self.orders[path.rsplit("/", 1)[1]]
            self.status_checks += 1
            if order["status"] == "PAYER_ACTION_REQUIRED" and self.status_checks >= self.approve_after:
                order["status"] = "APPROVED"
            return httpx.Response(200, json=order)
        if request.method == "POST" and path.endswith("/capture"):
            oid = path.split("/")[-2]
            assert self.orders[oid]["status"] == "APPROVED", "captured before the buyer approved"
            self.orders[oid] = self.completed(oid, self.orders[oid]["body"])
            return httpx.Response(201, json=self.orders[oid])
        if request.method == "POST" and path.endswith("/track"):
            import json
            self.tracked = json.loads(request.content)
            return httpx.Response(201, json={"id": path.split("/")[-2], "status": "COMPLETED"})
        if request.method == "PUT" and path.startswith("/v1/shipping/trackers/"):
            import json
            self.tracker_update = (path.rsplit("/", 1)[1], json.loads(request.content))
            return httpx.Response(204)
        if path == "/v1/customer/disputes":
            return httpx.Response(200, json={"items": [{"dispute_id": d} for d in self.disputes]})
        if path.startswith("/v1/customer/disputes/"):
            return httpx.Response(200, json=self.disputes[path.rsplit("/", 1)[1]])
        return httpx.Response(404, json={"message": f"unexpected {request.method} {path}"})


@pytest.fixture
def state_file(tmp_path, monkeypatch):
    monkeypatch.setattr(ps, "STATE_FILE", tmp_path / "state.json")
    return tmp_path / "state.json"


def client(fake):
    return ps.PayPal("id", "secret", BASE, http=httpx.Client(transport=httpx.MockTransport(fake)))


def no_sleep(_):
    pass


def test_first_run_waits_for_the_buyer_then_captures_and_saves_the_buyer(state_file):
    fake = FakePayPal(approve_after=3)
    pp = client(fake)
    ps.check_app(pp)
    state = ps.load_state()
    payment = ps.make_payment(pp, "49.99", "Item", state, open_browser=False, approve_timeout=60, interval=0, sleep=no_sleep)
    assert payment["capture_id"] == "CAP-O1"
    assert fake.status_checks == 3                        # it kept checking until the buyer clicked Pay
    assert ps.load_state()["vault_id"] == "VAULT-1"


def test_saved_buyer_is_charged_without_the_browser(state_file):
    ps.save_state({"vault_id": "VAULT-1"})
    fake = FakePayPal()
    payment = ps.make_payment(client(fake), "10.00", "Item", ps.load_state(), open_browser=False, approve_timeout=60, interval=0, sleep=no_sleep)
    assert payment["capture_id"] == "CAP-O1"
    assert fake.status_checks == 0
    assert not any(p.endswith("/capture") for _, p in fake.calls)


def test_a_saved_buyer_that_fails_falls_back_to_the_browser(state_file):
    ps.save_state({"vault_id": "VAULT-OLD"})
    fake = FakePayPal(vault_charge_fails=True, vault_works=False)
    payment = ps.make_payment(client(fake), "10.00", "Item", ps.load_state(), open_browser=False, approve_timeout=60, interval=0, sleep=no_sleep)
    assert payment["capture_id"] == "CAP-O1"
    assert "vault_id" not in ps.load_state()


def test_no_approval_in_time_is_a_clear_error(state_file):
    fake = FakePayPal(approve_after=10_000)
    with pytest.raises(ps.SandboxError, match="Nobody approved"):
        ps.make_payment(client(fake), "10.00", "Item", {}, open_browser=False, approve_timeout=0, interval=0, sleep=no_sleep)


def test_waits_for_the_report_on_this_payment_and_ignores_older_disputes(state_file):
    fake = FakePayPal()
    fake.disputes["PP-OLD"] = {"dispute_id": "PP-OLD", "disputed_transactions": [{"seller_transaction_id": "CAP-OTHER"}]}
    pp = client(fake)
    polls = []

    def buyer_reports_on_second_poll(_):
        polls.append(1)
        if len(polls) == 2:
            fake.disputes["PP-NEW"] = {"dispute_id": "PP-NEW", "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                                       "status": "WAITING_FOR_SELLER_RESPONSE",
                                       "disputed_transactions": [{"seller_transaction_id": "CAP-O1"}]}

    found = ps.wait_for_report(pp, "CAP-O1", timeout_s=60, interval_s=0, sleep=buyer_reports_on_second_poll)
    assert found["dispute_id"] == "PP-NEW"


def test_refuses_anything_but_the_sandbox():
    with pytest.raises(ps.SandboxError, match="sandbox only"):
        ps.PayPal("id", "secret", "https://api-m.paypal.com")


def test_missing_disputes_permission_is_explained():
    fake = FakePayPal()
    pp = client(fake)
    pp.scopes = set()
    with pytest.raises(ps.SandboxError, match="Disputes feature"):
        ps.check_app(pp)


def test_a_report_on_another_payment_is_pointed_out(state_file, capsys):
    fake = FakePayPal()
    pp = client(fake)
    known = set()
    fake.disputes["PP-WRONG"] = {"dispute_id": "PP-WRONG", "dispute_amount": {"value": "49.99"},
                                 "disputed_transactions": [{"seller_transaction_id": "CAP-OLDER"}]}
    assert ps.dispute_for(pp, "CAP-O1", known) is None
    assert "PP-WRONG ($49.99) is on a different payment" in capsys.readouterr().out
    assert ps.dispute_for(pp, "CAP-O1", known) is None
    assert capsys.readouterr().out == ""   # said once, not on every poll


def test_a_story_order_looks_like_a_real_checkout():
    story = ps.STORIES["not-received"]
    body = ps.order_body(story["amount"], story["item"], None, story["sku"], story["description"])
    unit = body["purchase_units"][0]
    assert unit["items"][0]["name"].startswith("Sony WH-1000XM5")
    assert unit["amount"]["breakdown"]["item_total"]["value"] == unit["amount"]["value"] == "289.00"
    assert unit["invoice_id"].startswith("INV-")
    assert unit["shipping"]["address"]["admin_area_2"] == "San Jose"
    assert body["payment_source"]["paypal"]["experience_context"]["shipping_preference"] == "SET_PROVIDED_ADDRESS"
    saved = ps.order_body("10.00", "Item", "VAULT-1")                 # a saved buyer gets the same full order
    assert saved["purchase_units"][0]["items"] and saved["payment_source"] == {"paypal": {"vault_id": "VAULT-1"}}


def test_the_seller_adds_tracking_and_marks_it_delivered():
    fake = FakePayPal()
    ps.add_tracking(client(fake), "O1", "CAP-O1", "USPS", "9400111111111111111111", delivered=True)
    assert fake.tracked == {"capture_id": "CAP-O1", "tracking_number": "9400111111111111111111", "carrier": "USPS", "notify_payer": False}
    assert fake.tracker_update[0] == "CAP-O1-9400111111111111111111"
    assert fake.tracker_update[1]["status"] == "DELIVERED"


def test_usps_numbers_look_real():
    n = ps.usps_number()
    assert len(n) == 22 and n.startswith("9400") and n.isdigit()
