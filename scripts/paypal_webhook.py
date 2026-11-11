#!/usr/bin/env python3
"""Makes a buyer's PayPal report show up in ResolveIQ within seconds, using PayPal webhooks.

    ./scripts/paypal_webhook.py                      # open a public tunnel to your backend and register it with PayPal
    ./scripts/paypal_webhook.py --url https://...    # use a public URL you already have (ngrok, cloudflared, a server)
    ./scripts/paypal_webhook.py --remove             # unregister ResolveIQ's webhooks from the sandbox app

Why: PayPal's dispute list takes minutes to include a new case, so polling it is slow. A webhook is PayPal calling
ResolveIQ the moment the case exists. PayPal can't reach localhost, so this opens a temporary public HTTPS tunnel with
ssh (localhost.run, nothing to install), registers it as the sandbox app's webhook, saves PAYPAL_WEBHOOK_ID to .env,
and keeps the tunnel open. Leave it running while you demo; Ctrl-C closes the tunnel and unregisters the webhook.

While it runs, the backend is reachable at the tunnel's address. Its API still needs a sign-in, and webhooks are only
accepted when PayPal confirms it sent them.
"""
import argparse
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import paypal_sandbox as sandbox  # noqa: E402  (reuses its .env reader, the PayPal client, and the venv fallback)

WEBHOOK_PATH = "/api/public/paypal/webhook"
EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]
TUNNEL_URL = re.compile(r"https://[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:lhr\.life|localhost\.run)")


def backend_port() -> int:
    """The port ResolveIQ's backend answers on (8001 in this project's dev setup, else the default 8000)."""
    for port in (8001, 8000):
        try:
            resp = sandbox.httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2)
            if resp.status_code == 200 and "mode" in resp.json():
                return port
        except Exception:
            continue
    raise sandbox.SandboxError("ResolveIQ's backend isn't running on port 8001 or 8000. Start it first.")


def save_webhook_id(webhook_id: str) -> None:
    env = ROOT / ".env"
    lines = env.read_text().splitlines() if env.exists() else []
    lines = [l for l in lines if not l.startswith("PAYPAL_WEBHOOK_ID=")] + [f"PAYPAL_WEBHOOK_ID={webhook_id}"]
    env.write_text("\n".join(lines) + "\n")


def ours(pp: "sandbox.PayPal") -> list:
    hooks = pp.ok(pp.call("GET", "/v1/notifications/webhooks"), "Listing webhooks").get("webhooks", [])
    return [h for h in hooks if str(h.get("url", "")).endswith(WEBHOOK_PATH)]


def remove_ours(pp: "sandbox.PayPal") -> int:
    gone = 0
    for h in ours(pp):
        resp = pp.call("DELETE", f"/v1/notifications/webhooks/{h['id']}")
        gone += resp.status_code in (200, 204)
    return gone


def register(pp: "sandbox.PayPal", base_url: str) -> str:
    url = base_url.rstrip("/") + WEBHOOK_PATH
    removed = remove_ours(pp)   # an old tunnel's address is dead, and PayPal allows only a few webhooks per app
    if removed:
        print(f"✓ Removed {removed} old ResolveIQ webhook(s).")
    hook = pp.ok(pp.call("POST", "/v1/notifications/webhooks", json={"url": url, "event_types": [{"name": e} for e in EVENTS]}),
                 "Registering the webhook")
    save_webhook_id(hook["id"])
    print(f"✓ PayPal will call {url}")
    print(f"✓ Saved PAYPAL_WEBHOOK_ID={hook['id']} to .env (the backend picks it up without a restart).")
    return hook["id"]


def open_tunnel(port: int) -> "tuple[subprocess.Popen, str]":
    print(f"… Opening a public tunnel to localhost:{port} (localhost.run)")
    proc = subprocess.Popen(
        ["ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30", "-o", "ExitOnForwardFailure=yes",
         "-R", f"80:localhost:{port}", "nokey@localhost.run"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    for line in proc.stdout:
        found = TUNNEL_URL.search(line)
        if found:
            return proc, found.group(0)
    raise sandbox.SandboxError("The tunnel closed before giving an address. Try again, or pass --url with your own tunnel.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="a public HTTPS address that forwards to the backend, instead of opening a tunnel")
    ap.add_argument("--remove", action="store_true", help="unregister ResolveIQ's webhooks and stop")
    args = ap.parse_args(argv)

    env = sandbox.load_env(ROOT / ".env")
    try:
        pp = sandbox.PayPal(env.get("PAYPAL_CLIENT_ID", ""), env.get("PAYPAL_CLIENT_SECRET", ""), env.get("PAYPAL_BASE_URL", sandbox.SANDBOX_BASE))
        if args.remove:
            print(f"✓ Removed {remove_ours(pp)} ResolveIQ webhook(s).")
            return 0
        if args.url:
            register(pp, args.url)
            print("  Done. Keep that address forwarding to the backend while you demo.")
            return 0

        proc, url = open_tunnel(backend_port())
        print(f"✓ Tunnel open: {url}")
        hook_id = register(pp, url)
        print("\n  New PayPal reports now reach ResolveIQ in seconds. Leave this running; Ctrl-C to stop.\n")

        def stop(*_):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, stop)
        try:
            for line in proc.stdout:           # keep the tunnel alive; show if it drops
                if "connection" in line.lower() and "closed" in line.lower():
                    print("! The tunnel dropped. Run this again for a new one.")
            proc.wait()
        except KeyboardInterrupt:
            pass
        finally:
            proc.terminate()
            pp.call("DELETE", f"/v1/notifications/webhooks/{hook_id}")
            print("\n✓ Tunnel closed and webhook unregistered. ResolveIQ falls back to checking PayPal every few seconds.")
        return 0
    except sandbox.SandboxError as e:
        print(f"✗ {e}")
        return 1
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
