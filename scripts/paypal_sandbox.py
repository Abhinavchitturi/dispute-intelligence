#!/usr/bin/env python3
"""One command for a fresh PayPal sandbox payment that a buyer can dispute.

    python scripts/paypal_sandbox.py                 # pay, capture, then wait for you to report it on PayPal
    python scripts/paypal_sandbox.py --no-wait       # stop once the payment is captured
    python scripts/paypal_sandbox.py --amount 120 --item "Wireless headphones"
    python scripts/paypal_sandbox.py --forget-buyer  # stop reusing the saved buyer, approve in the browser again

What it does (the runbook's steps 3-11, minus the report):
  1. Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from .env. No need to load .env into the shell.
  2. Checks the sandbox app's token, and that it can read disputes.
  3. Creates an order. If a buyer's PayPal was saved on an earlier run, it is charged straight away: no browser.
     Otherwise the approval page opens in your browser. Click Pay as the sandbox buyer, and the script carries on by itself.
  4. Captures the payment and prints its transaction ID.
  5. Waits for you to report a problem with that payment in PayPal's Resolution Center (the one manual step),
     then prints the new dispute. With RESOLVEIQ_MODE=sandbox the backend imports it within PAYPAL_POLL_SECONDS.

Still one-time and manual, because PayPal has no API for them: creating the sandbox app (keys) and the buyer account.
"""
import argparse
import json
import random
import os
import subprocess
import sys
import textwrap
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

try:
    import httpx
except ImportError:  # run as ./scripts/paypal_sandbox.py with a Python that lacks httpx: use the project's virtualenv instead
    _venv_dir = Path(__file__).resolve().parent.parent / ".venv"
    _venv = _venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    # Compare environments, not binaries: the venv's python is usually a symlink to the system one.
    if _venv.exists() and Path(sys.prefix).resolve() != _venv_dir.resolve():
        os.execv(str(_venv), [str(_venv), sys.argv[0], *sys.argv[1:]])   # re-run whichever script was started
    sys.exit("httpx isn't installed. Run: pip install -r requirements.txt")

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "scripts" / ".paypal_sandbox_state.json"   # gitignored: holds the saved buyer's vault token
SANDBOX_BASE = "https://api-m.sandbox.paypal.com"
DEMO_IMAGE = ROOT / "docs" / "demo" / "doorbell-camera-front-door.png"   # the not-received story's doorbell-camera still
BUYER_SUMMARY_URL = "https://www.sandbox.paypal.com/myaccount/summary"
APPROVED = ("APPROVED",)
DONE = ("COMPLETED",)


class SandboxError(Exception):
    pass


# ---------- setup ----------

def load_env(path: Path) -> Dict[str, str]:
    """Reads KEY=VALUE lines. Values already in the environment win, like the backend's settings."""
    values: Dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    values.update({k: v for k, v in os.environ.items() if k.startswith("PAYPAL_") or k == "RESOLVEIQ_MODE"})
    return values


def load_state() -> Dict[str, Any]:
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: Dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))
    try:
        STATE_FILE.chmod(0o600)
    except OSError:
        pass


class PayPal:
    def __init__(self, client_id: str, secret: str, base: str = SANDBOX_BASE, http: Optional[httpx.Client] = None):
        if "sandbox" not in base:
            raise SandboxError(f"Refusing to run against {base}: this script is for the PayPal sandbox only.")
        self.base = base
        self.http = http or httpx.Client(timeout=30.0)
        resp = self.http.post(f"{base}/v1/oauth2/token", auth=(client_id, secret), data={"grant_type": "client_credentials"})
        if resp.status_code != 200:
            raise SandboxError(f"PayPal refused the sandbox app's keys (HTTP {resp.status_code}). Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.")
        body = resp.json()
        self.token = body["access_token"]
        self.scopes = set(body.get("scope", "").split())

    def call(self, method: str, path: str, idempotent: bool = False, **kwargs) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        if idempotent:
            headers["PayPal-Request-Id"] = str(uuid.uuid4())
        url = path if path.startswith("http") else self.base + path
        return self.http.request(method, url, headers=headers, **kwargs)

    def ok(self, resp: httpx.Response, what: str) -> Dict[str, Any]:
        if resp.status_code >= 400:
            try:
                body = resp.json()
                detail = "; ".join(f"{d.get('issue')}: {d.get('description')}" for d in body.get("details", [])) or body.get("message", "")
            except ValueError:
                detail = resp.text[:300]
            raise SandboxError(f"{what} failed (HTTP {resp.status_code}, debug id {resp.headers.get('Paypal-Debug-Id')}). {detail}")
        return resp.json() if resp.text else {}


# ---------- the flow ----------

def check_app(pp: PayPal) -> None:
    if not any("disputes/read-seller" in s or s.endswith("/disputes/read") for s in pp.scopes):
        raise SandboxError("The sandbox app can't read disputes. In the developer dashboard, open the app and enable the Disputes feature.")
    print("✓ Sandbox app keys work, and the app can read disputes.")


# Ready-made cases for a demo: a believable purchase, the seller's shipping, and what the buyer reports.
STORIES: Dict[str, Dict[str, Any]] = {
    "not-received": {
        "item": "Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Black)",
        "sku": "SONY-WH1000XM5-B", "description": "Brand new, factory sealed. Ships USPS Priority.",
        "amount": "289.00", "delivered": True,
        "report_choice": "I haven't received the item or service",
        "report_detail": "The item hasn't reached me or I refused delivery",
        "report_text": ("Tracking says my headphones were delivered, but nothing arrived. I was home all afternoon and my "
                        "doorbell camera shows no delivery to my door that day. I checked with my neighbours and the "
                        "building mailroom too. I'd like a refund."),
        "attach": "the doorbell-camera still, docs/demo/doorbell-camera-front-door.png",
    },
    "not-as-described": {
        "item": "Apple Watch Series 9 GPS 45mm, Midnight Aluminium",
        "sku": "APL-WS9-45-MID", "description": "New, factory sealed, with 1-year warranty.",
        "amount": "329.00", "delivered": True,
        "report_choice": "I received an item or service that was different or not as described",
        "report_text": ("The listing said new and factory sealed. The box arrived already opened, the screen has scratches, "
                        "and the band is a different colour from the listing. It looks used. I have photos of the watch "
                        "and the box."),
        "attach": "a photo or two of the item (any picture works for the sandbox)",
    },
}

# Where the sandbox buyer's order ships. Shown masked in the app (no house number).
SHIP_TO = {"name": {"full_name": "John Doe"}, "address": {
    "address_line_1": "1 Main St", "admin_area_2": "San Jose", "admin_area_1": "CA", "postal_code": "95131", "country_code": "US"}}


def purchase_unit(amount: str, item: str, sku: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
    """A full order line: what was bought, an invoice number, and where it ships, like a real checkout would send."""
    money = {"currency_code": "USD", "value": amount}
    invoice = f"INV-{datetime.now():%Y%m%d}-{random.randint(1000, 9999)}"
    line = {"name": item[:127], "quantity": "1", "unit_amount": money, "category": "PHYSICAL_GOODS"}
    if sku:
        line["sku"] = sku
    if description:
        line["description"] = description[:127]
    return {
        "invoice_id": invoice, "description": item[:127],
        "amount": {**money, "breakdown": {"item_total": money}},
        "items": [line],
        "shipping": SHIP_TO,
    }


def order_body(amount: str, item: str, vault_id: Optional[str], sku: Optional[str] = None,
               description: Optional[str] = None) -> Dict[str, Any]:
    unit = purchase_unit(amount, item, sku, description)
    if vault_id:
        return {"intent": "CAPTURE", "purchase_units": [unit], "payment_source": {"paypal": {"vault_id": vault_id}}}
    return {
        "intent": "CAPTURE",
        "purchase_units": [unit],
        "payment_source": {"paypal": {
            # Ask PayPal to remember this buyer, so the next run can charge them without the browser.
            # If the app doesn't have "Save payment methods" turned on, PayPal just doesn't save it.
            "attributes": {"vault": {"store_in_vault": "ON_SUCCESS", "usage_type": "MERCHANT", "customer_type": "CONSUMER"}},
            "experience_context": {
                "user_action": "PAY_NOW", "shipping_preference": "SET_PROVIDED_ADDRESS",
                "return_url": "https://example.com/return", "cancel_url": "https://example.com/cancel",
            },
        }},
    }


def usps_number() -> str:
    return "9400" + "".join(random.choice("0123456789") for _ in range(18))


def add_tracking(pp: "PayPal", order_id: str, capture_id: str, carrier: str, number: str, delivered: bool) -> None:
    """The seller adds tracking to the payment on PayPal, and optionally marks it delivered, as a real seller would."""
    pp.ok(pp.call("POST", f"/v2/checkout/orders/{order_id}/track", idempotent=True, json={
        "capture_id": capture_id, "tracking_number": number, "carrier": carrier, "notify_payer": False}), "Adding tracking")
    status = "SHIPPED"
    if delivered:
        resp = pp.call("PUT", f"/v1/shipping/trackers/{capture_id}-{number}", json={
            "transaction_id": capture_id, "tracking_number": number, "status": "DELIVERED", "carrier": carrier})
        pp.ok(resp, "Marking the shipment delivered")
        status = "DELIVERED"
    print(f"✓ Seller added {carrier} tracking {number}: {status.lower()}.")


def approval_link(order: Dict[str, Any]) -> Optional[str]:
    return next((l["href"] for l in order.get("links", []) if l.get("rel") in ("payer-action", "approve")), None)


def open_in_browser(url: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["open", url], check=False)
    else:
        webbrowser.open(url)


def wait_for_approval(pp: PayPal, order_id: str, timeout_s: float, interval_s: float, sleep=time.sleep) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout_s
    while True:
        order = pp.ok(pp.call("GET", f"/v2/checkout/orders/{order_id}"), "Checking the order")
        if order.get("status") in APPROVED + DONE:
            return order
        if order.get("status") == "VOIDED":
            raise SandboxError("The buyer cancelled the payment.")
        if time.monotonic() >= deadline:
            raise SandboxError(f"Nobody approved the payment within {int(timeout_s)}s. Run the script again for a new one.")
        sleep(interval_s)


def capture_of(order: Dict[str, Any]) -> Dict[str, Any]:
    for unit in order.get("purchase_units", []):
        for cap in (unit.get("payments") or {}).get("captures", []):
            return cap
    return {}


def make_payment(pp: PayPal, amount: str, item: str, state: Dict[str, Any], open_browser: bool,
                 approve_timeout: float, interval: float, sleep=time.sleep, sku: Optional[str] = None,
                 description: Optional[str] = None) -> Dict[str, Any]:
    vault_id = state.get("vault_id")
    resp = pp.call("POST", "/v2/checkout/orders", idempotent=True, json=order_body(amount, item, vault_id, sku, description))
    if vault_id and resp.status_code >= 400:
        print("! The saved buyer couldn't be charged, so this one goes through the browser.")
        state.pop("vault_id", None)
        save_state(state)
        vault_id = None
        resp = pp.call("POST", "/v2/checkout/orders", idempotent=True, json=order_body(amount, item, None, sku, description))
    order = pp.ok(resp, "Creating the order")
    print(f"✓ Order {order['id']} created for ${amount} ({item}).")

    if order.get("status") not in DONE:
        if order.get("status") not in APPROVED:
            link = approval_link(order)
            if not link:
                raise SandboxError(f"PayPal didn't return an approval link (order status {order.get('status')}).")
            print("\n→ Approve the payment as the sandbox BUYER (personal account). Click Pay; the script continues on its own.")
            print(f"  {link}\n")
            if open_browser:
                open_in_browser(link)
            wait_for_approval(pp, order["id"], approve_timeout, interval, sleep)
            print("✓ Buyer approved.")
        order = pp.ok(pp.call("POST", f"/v2/checkout/orders/{order['id']}/capture", idempotent=True), "Capturing the payment")

    cap = capture_of(order)
    if order.get("status") not in DONE or not cap.get("id"):
        raise SandboxError(f"The payment didn't complete (order status {order.get('status')}).")

    payer = order.get("payer") or {}
    vault = ((order.get("payment_source") or {}).get("paypal") or {}).get("attributes", {}).get("vault", {})
    if vault.get("status") == "VAULTED" and vault.get("id") and vault["id"] != state.get("vault_id"):
        state.update(vault_id=vault["id"], buyer_email=payer.get("email_address"))
        save_state(state)
        print("✓ Saved this buyer's PayPal: next time no browser is needed.")
    elif not vault_id:
        print("  (PayPal didn't save the buyer, so the next run will ask for approval again. To skip it, turn on\n"
              "   'Save payment methods' for the app in the developer dashboard.)")

    print(f"✓ Payment captured. Transaction ID: {cap['id']}  status: {cap.get('status')}")
    return {"order_id": order["id"], "capture_id": cap["id"], "buyer_email": payer.get("email_address"),
            "paid_at": datetime.now(timezone.utc)}


def dispute_for(pp: PayPal, capture_id: str, known: set) -> Optional[Dict[str, Any]]:
    listing = pp.ok(pp.call("GET", "/v1/customer/disputes", params={"page_size": 50}), "Listing disputes")
    for item in listing.get("items", []):
        if item.get("dispute_id") in known:
            continue
        known.add(item["dispute_id"])
        detail = pp.ok(pp.call("GET", f"/v1/customer/disputes/{item['dispute_id']}"), "Reading a dispute")
        if any(t.get("seller_transaction_id") == capture_id for t in detail.get("disputed_transactions", [])):
            return detail
        # A new report, but on another payment: say so, since it is easy to open the wrong row in Recent activity.
        amount = (detail.get("dispute_amount") or {}).get("value", "?")
        print(f"! New dispute {item['dispute_id']} (${amount}) is on a different payment, not this one. "
              f"It will still show up in the app. Still waiting for a report on this payment...")
    return None


def wait_for_report(pp: PayPal, capture_id: str, timeout_s: float, interval_s: float, sleep=time.sleep) -> Optional[Dict[str, Any]]:
    # Disputes that existed before this payment can't be about it.
    known = {i["dispute_id"] for i in pp.ok(pp.call("GET", "/v1/customer/disputes", params={"page_size": 50}), "Listing disputes").get("items", [])}
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        found = dispute_for(pp, capture_id, known)
        if found:
            return found
        sleep(interval_s)
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--story", choices=sorted(STORIES), help="a ready-made demo case: the item, price, shipping and what to report")
    ap.add_argument("--amount", default=None, help="USD amount (default: the story's price, or a random amount so the payment is easy to spot)")
    ap.add_argument("--item", default=None, help="what the buyer paid for (default: the story's item, or 'Sandbox test item')")
    ap.add_argument("--carrier", default="USPS", help="the seller's carrier for the tracking number (default USPS)")
    ap.add_argument("--tracking", default=None, help="the seller's tracking number (default: a made-up USPS number)")
    ap.add_argument("--delivered", action="store_true", help="the seller marks the shipment delivered (stories that need it do this)")
    ap.add_argument("--no-tracking", action="store_true", help="the seller adds no tracking at all")
    ap.add_argument("--no-wait", action="store_true", help="stop after the payment; don't wait for the report")
    ap.add_argument("--no-open", action="store_true", help="print the approval link instead of opening the browser")
    ap.add_argument("--forget-buyer", action="store_true", help="drop the saved buyer and approve in the browser again")
    ap.add_argument("--approve-timeout", type=float, default=600, help="seconds to wait for the buyer to approve (default 600)")
    ap.add_argument("--report-timeout", type=float, default=1800, help="seconds to wait for the report (default 1800)")
    args = ap.parse_args(argv)

    env = load_env(ROOT / ".env")
    client_id, secret = env.get("PAYPAL_CLIENT_ID", ""), env.get("PAYPAL_CLIENT_SECRET", "")
    if not client_id or not secret or "your_paypal" in client_id:
        print("✗ Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env (sandbox app keys from developer.paypal.com).")
        return 1
    story = STORIES.get(args.story or "", {})
    args.item = args.item or story.get("item") or "Sandbox test item"
    args.delivered = args.delivered or bool(story.get("delivered"))
    if args.amount is None:
        # e.g. 37.42: unlike earlier payments, so you know which to report
        args.amount = story.get("amount") or f"{random.randint(1000, 9999) / 100:.2f}"
    try:
        float(args.amount)
    except ValueError:
        print("✗ --amount must be a number, like 49.99")
        return 1

    state = load_state()
    if args.forget_buyer and state.pop("vault_id", None):
        save_state(state)
        print("✓ Forgot the saved buyer.")

    try:
        pp = PayPal(client_id, secret, env.get("PAYPAL_BASE_URL", SANDBOX_BASE))
        check_app(pp)
        payment = make_payment(pp, f"{float(args.amount):.2f}", args.item, state, not args.no_open, args.approve_timeout, 3,
                               sku=story.get("sku"), description=story.get("description"))
        if not args.no_tracking:
            try:
                add_tracking(pp, payment["order_id"], payment["capture_id"], args.carrier, args.tracking or usps_number(), args.delivered)
            except SandboxError as e:  # the payment is fine without it; the case just has no shipment on record
                print(f"! Couldn't add tracking: {e}")

        print("\n→ Your turn: report a problem with this payment, as the BUYER, on PayPal.")
        print(f"  {BUYER_SUMMARY_URL}")
        print(f"  Under Recent activity, open the -${float(args.amount):.2f} payment at the top (to your sandbox business\n"
              f"  account, e.g. 'Test Store') → Report a problem.")
        if story:
            print(f"\n  Choose:  {story['report_choice']}")
            if story.get("report_detail"):
                print(f"  Then:    {story['report_detail']}")
            print("  Write:   " + textwrap.fill(story["report_text"], 100, subsequent_indent="           "))
            print(f"  Attach:  {story['attach']}" + (f"\n           ({DEMO_IMAGE})" if args.story == "not-received" and DEMO_IMAGE.exists() else ""))
        print(f"  Refund:  if PayPal asks what you want, choose a full refund; if it asks how much, type {float(args.amount):.2f}")
        print("  Then submit.")
        if args.no_wait:
            return 0

        print(f"\n… Waiting for the report (up to {int(args.report_timeout // 60)} min, Ctrl-C to stop).")
        dispute = wait_for_report(pp, payment["capture_id"], args.report_timeout, 10)
        if not dispute:
            print("✗ No dispute for this payment yet. PayPal can be slow: check again with  python spike/paypal_spike.py list")
            return 2
        print(f"✓ Dispute {dispute['dispute_id']} opened: {dispute.get('reason')}, status {dispute.get('status')}.")
        if env.get("RESOLVEIQ_MODE") == "sandbox":
            print(f"  The app will import it as PAYPAL-{dispute['dispute_id']} within {env.get('PAYPAL_POLL_SECONDS', '60')}s.")
        else:
            print("  RESOLVEIQ_MODE isn't 'sandbox', so the app won't pull it by itself. Set it in .env and restart, or press Sync PayPal.")
        return 0
    except SandboxError as e:
        print(f"✗ {e}")
        return 1
    except httpx.HTTPError as e:
        print(f"✗ Couldn't reach PayPal: {e}")
        return 1
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
