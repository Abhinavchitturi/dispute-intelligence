
"""Phase 0 PayPal sandbox spike. Run one step at a time and read the raw output.

    python paypal_spike.py token
    python paypal_spike.py order                 # prints approve link; buyer approves in browser
    python paypal_spike.py capture <ORDER_ID>    # capture id = seller transaction id
    python paypal_spike.py create-dispute <CAPTURE_ID> [ITEM_NOT_RECEIVED|MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED]
    python paypal_spike.py list
    python paypal_spike.py show <DISPUTE_ID>
    python paypal_spike.py require-evidence <DISPUTE_ID>
    python paypal_spike.py adjudicate <DISPUTE_ID> [BUYER_FAVOR|SELLER_FAVOR]
    python paypal_spike.py track <CAPTURE_ID> <TRACKING_NUMBER> [CARRIER]
    python paypal_spike.py get-tracking <CAPTURE_ID> <TRACKING_NUMBER>

Every call prints status + full body: the point is to learn the real response shapes.
Save useful responses to fixtures/paypal/.
"""
import json
import os
import sys
import time

import requests

BASE = "https://api-m.sandbox.paypal.com"

_token = {"value": None, "expires_at": 0.0}


def get_token() -> str:
    """Cached client-credentials token; refreshes 60s before expiry (reuse in the backend)."""
    if _token["value"] and time.time() < _token["expires_at"] - 60:
        return _token["value"]
    r = requests.post(
        f"{BASE}/v1/oauth2/token",
        auth=(os.environ["PAYPAL_CLIENT_ID"], os.environ["PAYPAL_CLIENT_SECRET"]),
        data={"grant_type": "client_credentials"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    _token["value"] = body["access_token"]
    _token["expires_at"] = time.time() + body["expires_in"]
    print(f"[token] expires_in={body['expires_in']}s\n[token] scopes: {body.get('scope', '')[:400]}")
    return _token["value"]


def call(method: str, path: str, **kwargs):
    headers = {"Authorization": f"Bearer {get_token()}", "Content-Type": "application/json"}
    r = requests.request(method, BASE + path, headers=headers, timeout=60, **kwargs)
    print(f"\n{method} {path} -> {r.status_code}  (PayPal-Debug-Id: {r.headers.get('Paypal-Debug-Id')})")
    try:
        print(json.dumps(r.json(), indent=2))
    except ValueError:
        print(r.text or "<empty body>")
    return r


def main(argv):
    cmd, args = argv[1], argv[2:]

    if cmd == "token":
        get_token()

    elif cmd == "order":
        r = call("POST", "/v2/checkout/orders", json={
            "intent": "CAPTURE",
            "purchase_units": [{"amount": {"currency_code": "USD", "value": "49.99"},
                                "description": "Spike test item"}],
            "payment_source": {"paypal": {"experience_context": {
                "return_url": "https://example.com/return", "cancel_url": "https://example.com/cancel"}}},
        })
        for link in r.json().get("links", []):
            if link["rel"] in ("approve", "payer-action"):
                print(f"\nOPEN AS SANDBOX BUYER (personal account): {link['href']}")

    elif cmd == "capture":
        call("POST", f"/v2/checkout/orders/{args[0]}/capture")

    elif cmd == "create-dispute":
        # UNVERIFIED: request shape of this sandbox create endpoint. If it 4xx's, have the buyer
        # open the dispute in the sandbox Resolution Center UI and continue from `list`.
        reason = args[1] if len(args) > 1 else "ITEM_NOT_RECEIVED"
        call("POST", "/v1/customer/disputes", json={
            "disputed_transactions": [{"seller_transaction_id": args[0]}],
            "reason": reason,
            "dispute_amount": {"currency_code": "USD", "value": "49.99"},
        })

    elif cmd == "list":
        call("GET", "/v1/customer/disputes", params={"page_size": 20})

    elif cmd == "show":
        call("GET", f"/v1/customer/disputes/{args[0]}")

    elif cmd == "require-evidence":  # sandbox-only; UNVERIFIED action enum
        call("POST", f"/v1/customer/disputes/{args[0]}/require-evidence", json={"action": "SELLER_EVIDENCE"})

    elif cmd == "adjudicate":  # sandbox-only; UNVERIFIED outcome enum
        outcome = args[1] if len(args) > 1 else "BUYER_FAVOR"
        call("POST", f"/v1/customer/disputes/{args[0]}/adjudicate", json={"adjudication_outcome": outcome})

    elif cmd == "track":  # UNVERIFIED which tracking endpoint links to a dispute
        carrier = args[2] if len(args) > 2 else "OTHER"
        call("POST", "/v1/shipping/trackers-batch", json={"trackers": [{
            "transaction_id": args[0], "tracking_number": args[1],
            "status": "SHIPPED", "carrier": carrier}]})

    elif cmd == "get-tracking":
        call("GET", f"/v1/shipping/trackers/{args[0]}-{args[1]}")

    else:
        print(__doc__)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
    else:
        main(sys.argv)
