"""The pages a buyer or seller reaches from a link in an email. They have no account, so each link carries a signed token."""
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.services import reopen_service

router = APIRouter(tags=["Public"])


def _page(title: str, text: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title>"
                        f"<body style='font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1d1d1f'>"
                        f"<h1 style='font-size:24px'>{title}</h1><p style='font-size:16px;line-height:1.5'>{text}</p></body>", status_code=status)


@router.get("/public/new-case/{token}", response_class=HTMLResponse)
def new_case(token: str, db: Session = Depends(get_db)):
    did = reopen_service.dispute_id_from(token)
    original = db.query(Dispute).filter(Dispute.id == did).first() if did else None
    if not original:
        return _page("This link isn't valid", "Check that you used the whole link from the email.", 404)
    try:
        new = reopen_service.open_new_case(db, original)
    except reopen_service.ReopenError as e:
        return _page("No new case opened", str(e), 400)
    return _page("Your new case is open", f"Your new case is {new.id}. We will email you what we need next.")


# ---------- PayPal webhooks ----------
import asyncio  # noqa: E402
import logging  # noqa: E402
from typing import Any, Dict  # noqa: E402

from fastapi import HTTPException, Request  # noqa: E402

from backend.app.config import Settings, settings  # noqa: E402
from backend.app.database import SessionLocal  # noqa: E402
from backend.app.services import paypal_sync  # noqa: E402
from backend.app.services.paypal_client import PayPalClient  # noqa: E402

logger = logging.getLogger(__name__)
_SIGNATURE_HEADERS = {
    "auth_algo": "paypal-auth-algo", "cert_url": "paypal-cert-url", "transmission_id": "paypal-transmission-id",
    "transmission_sig": "paypal-transmission-sig", "transmission_time": "paypal-transmission-time",
}


def _webhook_id() -> str:
    # Read fresh, so registering a webhook (which writes PAYPAL_WEBHOOK_ID to .env) works without restarting the backend.
    return settings.PAYPAL_WEBHOOK_ID or Settings().PAYPAL_WEBHOOK_ID or ""


async def _verified(request: Request, event: Dict[str, Any]) -> bool:
    """Asks PayPal whether it really sent this event (PayPal's own signature check). Anything unverified is ignored."""
    webhook_id = _webhook_id()
    headers = {field: request.headers.get(name) for field, name in _SIGNATURE_HEADERS.items()}
    if not webhook_id or not all(headers.values()):
        return False
    try:
        result = await PayPalClient.post_json("/v1/notifications/verify-webhook-signature",
                                              {**headers, "webhook_id": webhook_id, "webhook_event": event})
    except Exception as exc:  # PayPal unreachable: treat as unverified; the background poll still finds the case
        logger.warning("Couldn't verify a PayPal webhook: %s", exc)
        return False
    return result.get("verification_status") == "SUCCESS"


async def _import_now(dispute_id: str) -> None:
    db = SessionLocal()
    try:
        result = await paypal_sync.import_dispute(db, dispute_id, actor="paypal_webhook")
        logger.info("PayPal webhook: %s", result["message"])
    except paypal_sync.PayPalSyncError as exc:
        logger.warning("PayPal webhook for %s couldn't be imported yet: %s", dispute_id, exc.detail)
    except Exception:
        logger.exception("PayPal webhook import failed for %s", dispute_id)
    finally:
        db.close()


@router.post("/public/paypal/webhook")
async def paypal_webhook(request: Request):
    """PayPal calls this the moment a dispute is created or changes, so a buyer's report shows up in seconds instead of
    waiting for PayPal's dispute list to catch up. Register it with scripts/paypal_webhook.py."""
    try:
        event = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Expected a JSON PayPal event.")
    if not isinstance(event, dict) or not await _verified(request, event):
        raise HTTPException(status_code=401, detail="Not a verified PayPal webhook.")
    kind = str(event.get("event_type") or "")
    resource = event.get("resource") if isinstance(event.get("resource"), dict) else {}
    dispute_id = resource.get("dispute_id")
    if kind.startswith("CUSTOMER.DISPUTE.") and dispute_id:
        asyncio.create_task(_import_now(str(dispute_id)))   # answer PayPal straight away; the import runs alongside
        return {"received": True, "dispute_id": dispute_id}
    return {"received": True, "ignored": kind}
