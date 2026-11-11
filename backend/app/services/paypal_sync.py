"""Brings PayPal sandbox disputes into the queue.

A buyer who reports a problem in PayPal's Resolution Center opens a dispute on PayPal's side. This module pulls those disputes
(the list, then each dispute's details) and keeps the local copy in step. It runs from the "Sync PayPal" button and, in sandbox
mode, from a background poll, so a newly filed case shows up here on its own.

What PayPal owns and what this app owns:
- PayPal owns the amount, reason, dates, the buyer's claim, and the messages and evidence filed on PayPal. Those are refreshed.
- This app owns the investigation: its status while the case is worked, evidence_status, assignment and the decision. A refresh
  never overwrites them. The one exception is a dispute PayPal itself has resolved: that closes the local case too.
"""
import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute, Order, Shipment, Transaction
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.models.audit import AuditEvent
from backend.app.models.team import Flag
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED
from backend.app.services.paypal_client import PayPalClient
from backend.app.services.priority_service import calculate_priority_score

logger = logging.getLogger(__name__)

SOURCE = "paypal_sandbox"
PAYPAL_RESOLVED = "RESOLVED"
PARTY = {"BUYER": "BUYER", "SELLER": "SELLER"}


class PayPalSyncError(Exception):
    """The sync could not finish. status_code is what the API route returns."""

    def __init__(self, detail: str, status_code: int = 502):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _paypal_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise PayPalSyncError("PayPal returned an invalid dispute date.") from exc
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _paypal_amount(value: Any) -> Optional[Tuple[float, str]]:
    if not isinstance(value, dict):
        return None
    try:
        amount = float(value["value"])
    except (KeyError, TypeError, ValueError):
        return None
    currency = value.get("currency_code")
    if not isinstance(currency, str) or not currency:
        return None
    return amount, currency


def _masked_email(email: Any) -> Optional[str]:
    if not isinstance(email, str) or "@" not in email:
        return None
    local, domain = email.rsplit("@", 1)
    return f"{local[:1]}***@{domain}"


def _stable_id(prefix: str, *parts: Any) -> str:
    """The same PayPal record always gets the same local ID, so a re-sync never imports it twice."""
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _first_transaction(data: Dict[str, Any]) -> Dict[str, Any]:
    transactions = data.get("disputed_transactions") or []
    return transactions[0] if transactions and isinstance(transactions[0], dict) else {}


def _buyer(data: Dict[str, Any]) -> Dict[str, Any]:
    """PayPal puts the buyer on the disputed transaction, not on the dispute itself."""
    for candidate in (data.get("buyer"), _first_transaction(data).get("buyer")):
        if isinstance(candidate, dict) and (candidate.get("name") or candidate.get("email")):
            return candidate
    return {}


def _buyer_description(data: Dict[str, Any]) -> Optional[str]:
    """What the buyer wrote when reporting the problem: PayPal keeps it on each disputed item."""
    notes = [str(i.get("notes")).strip() for i in _first_transaction(data).get("items") or []
             if isinstance(i, dict) and str(i.get("notes") or "").strip()]
    if notes:
        return "\n\n".join(notes)
    # Some reports keep it on the buyer's filing instead (the CREATE entry, next to any photo they attached).
    for e in data.get("evidences") or []:
        if isinstance(e, dict) and e.get("source") == "SUBMITTED_BY_BUYER" and str(e.get("notes") or "").strip():
            return str(e["notes"]).strip()
    return None


def _documents(entry: Dict[str, Any]) -> List[str]:
    docs = entry.get("documents") or []
    return [str(d.get("name")) for d in docs if isinstance(d, dict) and d.get("name")]


async def _details(external_id: str) -> Dict[str, Any]:
    try:
        details = await PayPalClient.get_dispute_details(external_id)
    except httpx.HTTPStatusError as exc:
        raise PayPalSyncError(f"PayPal returned HTTP {exc.response.status_code} while loading dispute {external_id}.") from exc
    except (httpx.HTTPError, ConnectionError) as exc:
        raise PayPalSyncError("Could not connect to the PayPal sandbox disputes API.") from exc
    return details if isinstance(details, dict) else {}


def _sync_transaction(db: Session, dispute: Dispute, data: Dict[str, Any], amount: float, currency: str) -> None:
    txn = _first_transaction(data)
    external_txn_id = txn.get("seller_transaction_id") or txn.get("buyer_transaction_id") or txn.get("transaction_id")
    if not external_txn_id:
        return
    transaction = (
        db.query(Transaction)
        .filter(Transaction.source == SOURCE, Transaction.external_transaction_id == str(external_txn_id))
        .first()
    )
    if transaction is None:
        txn_amount = _paypal_amount(txn.get("gross_amount"))
        transaction = Transaction(
            id=f"PAYPAL-TXN-{external_txn_id}",
            external_transaction_id=str(external_txn_id),
            source=SOURCE,
            amount=txn_amount[0] if txn_amount else amount,
            currency=txn_amount[1] if txn_amount else currency,
            status="DISPUTED",
        )
        db.add(transaction)
    transaction.buyer_email_masked = _masked_email(_buyer(data).get("email")) or transaction.buyer_email_masked
    transaction.transaction_date = _paypal_datetime(txn.get("create_time")) or transaction.transaction_date
    dispute.transaction_id = transaction.id
    merchant_reference = txn.get("invoice_number") or txn.get("custom")
    if merchant_reference:
        dispute.merchant_reference = str(merchant_reference)


def _import_messages(db: Session, dispute: Dispute, data: Dict[str, Any]) -> int:
    added = 0
    for entry in data.get("messages") or []:
        if not isinstance(entry, dict):
            continue
        party = PARTY.get(str(entry.get("posted_by") or "").upper())
        content = str(entry.get("content") or "").strip()
        if not party or not content:
            continue
        msg_id = _stable_id("PPMSG", dispute.external_dispute_id, entry.get("time_posted"), party, content)
        if db.get(DisputeMessage, msg_id):
            continue
        attachments = _documents(entry)
        db.add(DisputeMessage(
            id=msg_id, dispute_id=dispute.id, direction="INBOUND", counterparty=party, action_type="PAYPAL_MESSAGE",
            subject=f"Message from the {party.lower()} on PayPal", body=content, source=SOURCE,
            awaiting_reply=False, is_read=False,
            meta_json=json.dumps({"attachments": attachments}) if attachments else None,
            created_at=_paypal_datetime(entry.get("time_posted")) or datetime.utcnow(),
        ))
        added += 1
    return added


def _import_evidence(db: Session, dispute: Dispute, data: Dict[str, Any]) -> int:
    added = 0
    for entry in data.get("evidences") or []:
        if not isinstance(entry, dict):
            continue
        origin = str(entry.get("source") or "")
        if not origin.startswith("SUBMITTED_BY_"):
            continue  # e.g. REQUESTED_FROM_SELLER: PayPal asking for something, not evidence anyone filed
        evidence_type = str(entry.get("evidence_type") or "OTHER")
        documents = _documents(entry)
        ev_id = _stable_id("PPEV", dispute.external_dispute_id, evidence_type, entry.get("date"), entry.get("source"), ",".join(documents))
        if db.get(Evidence, ev_id):
            continue
        notes = str(entry.get("notes") or "").strip()
        submitted_by = origin.replace("SUBMITTED_BY_", "").lower() or "a party"
        db.add(Evidence(
            id=ev_id, dispute_id=dispute.id, evidence_type=evidence_type,
            description=notes or f"{evidence_type.replace('_', ' ').capitalize()} filed on PayPal by the {submitted_by}.",
            source_record_id=dispute.external_dispute_id, source=SOURCE,
            submitted_at=_paypal_datetime(entry.get("date")),
            # Filed on PayPal is not the same as checked: an investigator still verifies it.
            availability_status="PENDING_VERIFICATION",
            metadata_json=json.dumps({"documents": documents, "submitted_by": submitted_by}),
        ))
        added += 1
    return added


def _apply(db: Session, dispute: Dispute, data: Dict[str, Any], is_new: bool) -> None:
    external_id = dispute.external_dispute_id
    amount_data = _paypal_amount(data.get("dispute_amount")) or _paypal_amount(_first_transaction(data).get("gross_amount"))
    if not amount_data:
        raise PayPalSyncError(f"PayPal dispute {external_id} did not include a valid amount and currency.")
    amount, currency = amount_data

    paypal_status = str(data.get("status") or "OPEN")
    outcome_data = data.get("dispute_outcome") if isinstance(data.get("dispute_outcome"), dict) else {}
    outcome_text = str(outcome_data.get("outcome_code") or "").upper()
    paypal_outcome = "BUYER_FAVOR" if "BUYER" in outcome_text else "SELLER_FAVOR" if "SELLER" in outcome_text else None

    dispute.source = SOURCE
    dispute.reason = str(data.get("reason") or dispute.reason or "OTHER")
    dispute.amount = amount
    dispute.currency = currency
    dispute.response_due_date = _paypal_datetime(data.get("seller_response_due_date") or data.get("response_due_date")) or dispute.response_due_date
    dispute.created_at = _paypal_datetime(data.get("create_time")) or dispute.created_at or datetime.utcnow()
    dispute.updated_at = _paypal_datetime(data.get("update_time")) or datetime.utcnow()
    claim = data.get("buyer_claim") or _buyer_description(data)
    if claim:
        dispute.buyer_claim = str(claim)
    buyer = _buyer(data)
    buyer_reference = buyer.get("name") or _masked_email(buyer.get("email"))
    if buyer_reference:
        dispute.buyer_reference = str(buyer_reference)

    if is_new:
        # A case PayPal hasn't resolved arrives as New: nobody here has asked anyone for anything yet. PayPal's own status
        # (UNDER_REVIEW for an inquiry, WAITING_FOR_SELLER_RESPONSE for a claim) means something else in this app's model.
        dispute.status = PAYPAL_RESOLVED if paypal_status == PAYPAL_RESOLVED else "OPEN"
        dispute.evidence_status = "MISSING"
        dispute.outcome = paypal_outcome
    elif paypal_status == PAYPAL_RESOLVED and dispute.status not in CLOSED:
        # PayPal closed it outside this app. Follow PayPal, and keep any decision this app already recorded.
        dispute.status = PAYPAL_RESOLVED
        dispute.outcome = dispute.outcome or paypal_outcome

    _sync_transaction(db, dispute, data, amount, currency)


def _rescore(db: Session, dispute: Dispute) -> None:
    order = db.get(Order, dispute.order_id) if dispute.order_id else None   # just set by id, so don't trust the relationship
    shipment = db.query(Shipment).filter(Shipment.order_id == order.id).first() if order else None
    dispute.priority_score, factors = calculate_priority_score(
        amount=dispute.amount,
        response_due_date=dispute.response_due_date,
        evidence_status=dispute.evidence_status,
        shipment_status=shipment.status if shipment else None,
        reason=dispute.reason,
    )
    dispute.priority_factors_json = json.dumps([factor.model_dump() for factor in factors])


SHIPMENT_STATUS = {"DELIVERED": "DELIVERED", "SHIPPED": "IN_TRANSIT", "ON_HOLD": "IN_TRANSIT", "LOCAL_PICKUP": "DELIVERED"}


def _masked_address(addr: Dict[str, Any]) -> Optional[str]:
    if not isinstance(addr, dict):
        return None
    line = str(addr.get("address_line_1") or "")
    street = re.sub(r"^\d+", "***", line) if line else None   # hide the house number
    parts = [street, addr.get("admin_area_2"), addr.get("admin_area_1"), addr.get("postal_code")]
    return ", ".join(str(p) for p in parts if p) or None


async def _import_order(db: Session, dispute: Dispute, data: Dict[str, Any]) -> None:
    """What was bought and how it was shipped, read from PayPal: dispute -> captured payment -> order -> seller's tracking.

    Best effort: a dispute still imports when any of this is missing (an old payment, or one with no tracking)."""
    txn = _first_transaction(data)
    seller = txn.get("seller") if isinstance(txn.get("seller"), dict) else {}
    if seller.get("name"):
        dispute.merchant_reference = str(seller["name"])
    capture_id = txn.get("seller_transaction_id")
    if not capture_id:
        return
    try:
        capture = await PayPalClient.get_json(f"/v2/payments/captures/{capture_id}")
        up = next((l.get("href") for l in capture.get("links", []) if l.get("rel") == "up" and "/checkout/orders/" in str(l.get("href"))), None)
        if not up:
            return
        order_id = str(up).rstrip("/").rsplit("/", 1)[-1]
        order = await PayPalClient.get_json(f"/v2/checkout/orders/{order_id}")
    except (httpx.HTTPError, ConnectionError, ValueError) as exc:
        logger.warning("Couldn't read the order behind PayPal dispute %s: %s", dispute.external_dispute_id, exc)
        return

    unit = (order.get("purchase_units") or [{}])[0]
    items = [i for i in unit.get("items") or [] if isinstance(i, dict) and i.get("name")]
    summary = ", ".join(f"{i.get('quantity', '1')} × {i['name']}" for i in items) or unit.get("description") or "Item not named on the order"
    amount = _paypal_amount(unit.get("amount")) or (dispute.amount, dispute.currency)
    row = db.get(Order, f"PAYPAL-ORD-{order_id}") or Order(id=f"PAYPAL-ORD-{order_id}", external_order_id=order_id, source=SOURCE,
                                                            item_summary=summary, amount=amount[0], currency=amount[1])
    row.item_summary, row.amount, row.currency = summary, amount[0], amount[1]
    row.order_date = _paypal_datetime(order.get("create_time")) or row.order_date
    row.merchant_reference = unit.get("invoice_id") or dispute.merchant_reference
    db.add(row)
    dispute.order_id = row.id

    shipping = unit.get("shipping") if isinstance(unit.get("shipping"), dict) else {}
    trackers = [t for t in shipping.get("trackers") or [] if isinstance(t, dict) and t.get("id")]
    if not trackers:
        return
    tracker_id = str(trackers[-1]["id"])                       # the seller's latest tracking number
    try:
        tracker = await PayPalClient.get_json(f"/v1/shipping/trackers/{tracker_id}")
    except (httpx.HTTPError, ConnectionError, ValueError):
        tracker = {"tracking_number": tracker_id.split("-", 1)[-1], "status": trackers[-1].get("status")}
    status = SHIPMENT_STATUS.get(str(tracker.get("status") or "").upper(), "UNKNOWN")
    ship = db.get(Shipment, f"PAYPAL-SHIP-{tracker_id}") or Shipment(id=f"PAYPAL-SHIP-{tracker_id}", order_id=row.id, source=SOURCE)
    ship.tracking_reference = tracker.get("tracking_number")
    ship.carrier = tracker.get("carrier")
    ship.status = status
    ship.shipped_at = ship.shipped_at or _paypal_datetime(order.get("update_time"))
    # PayPal records that the seller marked it delivered, not when, so the order's last update stands in for the date.
    ship.delivered_at = (ship.delivered_at or _paypal_datetime(order.get("update_time"))) if status == "DELIVERED" else None
    address = shipping.get("address") if isinstance(shipping.get("address"), dict) else {}
    ship.shipping_address_masked = _masked_address(address)
    ship.destination_city = address.get("admin_area_2")
    db.add(ship)


def _find(db: Session, external_id: str) -> Optional[Dispute]:
    return db.query(Dispute).filter(Dispute.source == SOURCE, Dispute.external_dispute_id == external_id).first()


async def _upsert(db: Session, external_id: str, dispute: Optional[Dispute], data: Dict[str, Any]) -> Tuple[Dispute, bool, int, int]:
    """Creates or refreshes one dispute from PayPal's details. Returns (dispute, is_new, new messages, new evidence)."""
    is_new = dispute is None
    if is_new:
        dispute = Dispute(id=f"PAYPAL-{external_id}", external_dispute_id=external_id)
        db.add(dispute)
    _apply(db, dispute, data, is_new)
    db.flush()
    await _import_order(db, dispute, data)
    db.flush()
    _rescore(db, dispute)
    msgs = _import_messages(db, dispute, data)
    evs = _import_evidence(db, dispute, data)
    if is_new:
        from backend.app.services.assignment_service import auto_assign
        auto_assign(db, [dispute])   # straight to the least-busy investigator, the moment it arrives
    dispute.raw_payload_reference = str(data.get("update_time") or "") or None  # PayPal's update_time when we last read it
    return dispute, is_new, msgs, evs


async def import_dispute(db: Session, external_id: str, actor: str = "paypal_api") -> Dict[str, Any]:
    """Imports or refreshes one dispute by its PayPal case ID (like PP-R-ABC-12345678).

    A buyer sees the case ID the moment they file. PayPal's dispute list can take a while to include a new case, so this
    reads the case directly instead of waiting for the list."""
    if not PayPalClient.is_configured():
        raise PayPalSyncError(
            "PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", status_code=503)
    external_id = (external_id or "").strip().upper()
    if not external_id.startswith("PP-") or len(external_id) > 64:
        raise PayPalSyncError("That isn't a PayPal case ID. It looks like PP-R-ABC-12345678.", status_code=400)
    try:
        details = await PayPalClient.get_dispute_details(external_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise PayPalSyncError(f"PayPal has no case {external_id} for this sandbox app's seller.", status_code=404) from exc
        raise PayPalSyncError(f"PayPal returned HTTP {exc.response.status_code} while loading case {external_id}.") from exc
    except (httpx.HTTPError, ConnectionError) as exc:
        raise PayPalSyncError("Could not connect to the PayPal sandbox disputes API.") from exc
    if not isinstance(details, dict) or not details.get("dispute_id"):
        raise PayPalSyncError("PayPal returned an unexpected dispute response.")
    try:
        dispute, is_new, msgs, evs = await _upsert(db, external_id, _find(db, external_id), details)
        db.commit()
    except Exception:
        db.rollback()
        raise
    message = (f"Imported PayPal case {external_id}" if is_new else f"Refreshed PayPal case {external_id}") + \
        (f", with {msgs} message(s) and {evs} evidence item(s)." if msgs or evs else ".")
    AuditService.record_event(db=db, dispute_id=dispute.id, actor=actor, action="PAYPAL_DISPUTE_IMPORTED", status="SUCCESS",
                              source=SOURCE, result_summary=message)
    return {"dispute_id": dispute.id, "created": is_new, "new_messages": msgs, "new_evidence": evs, "message": message}


async def sync_disputes(db: Session, actor: str = "paypal_api", record_when_unchanged: bool = True) -> Dict[str, Any]:
    """Imports new PayPal disputes and refreshes known ones. Raises PayPalSyncError if PayPal can't be read."""
    if not PayPalClient.is_configured():
        raise PayPalSyncError(
            "PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.", status_code=503)

    try:
        payload = await PayPalClient.get_disputes()
    except httpx.HTTPStatusError as exc:
        raise PayPalSyncError(f"PayPal returned HTTP {exc.response.status_code} while loading disputes.") from exc
    except (httpx.HTTPError, ConnectionError) as exc:
        raise PayPalSyncError("Could not connect to the PayPal sandbox disputes API.") from exc

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise PayPalSyncError("PayPal returned an unexpected dispute list response.")

    hidden = {c.strip().upper() for c in (settings.PAYPAL_HIDDEN_CASES or "").split(",") if c.strip()}
    items = [i for i in items if not (isinstance(i, dict) and str(i.get("dispute_id", "")).upper() in hidden)]
    created = updated = new_messages = new_evidence = 0
    new_ids: List[str] = []
    try:
        for item in items:
            if not isinstance(item, dict) or not item.get("dispute_id"):
                raise PayPalSyncError("PayPal returned a dispute without an ID.")
            external_id = str(item["dispute_id"])
            dispute = _find(db, external_id)
            seen_update = str(item.get("update_time") or "")
            # The list is only a summary. Fetch the details (buyer, transaction, messages, evidence) for a new dispute,
            # and again only when PayPal says it changed, so a poll every minute doesn't re-read every case.
            if dispute is not None:
                updated += 1
                if seen_update and dispute.raw_payload_reference == seen_update:
                    continue  # unchanged on PayPal since the last read
            data = {**item, **(await _details(external_id))}
            dispute, is_new, msgs, evs = await _upsert(db, external_id, dispute, data)
            if is_new:
                created += 1
                new_ids.append(dispute.id)
            new_messages += msgs
            new_evidence += evs
        db.commit()
    except Exception:
        db.rollback()
        raise

    message = f"Imported {created} new and refreshed {updated} PayPal Sandbox disputes."
    if new_messages or new_evidence:
        message += f" Added {new_messages} message(s) and {new_evidence} evidence item(s) filed on PayPal."
    if record_when_unchanged or created or new_messages or new_evidence:
        AuditService.record_event(
            db=db, actor=actor, action="PAYPAL_DISPUTES_SYNCED", status="SUCCESS", source=SOURCE, result_summary=message,
        )
    return {
        "created": created, "updated": updated, "total": len(items),
        "new_messages": new_messages, "new_evidence": new_evidence, "new_dispute_ids": new_ids, "message": message,
    }


# ---------- decisions back to PayPal ----------

SENT, NOT_SENT = "PAYPAL_DECISION_SENT", "PAYPAL_DECISION_NOT_SENT"


def _paypal_error(exc: httpx.HTTPStatusError) -> str:
    try:
        body = exc.response.json()
        details = "; ".join(str(d.get("description") or d.get("issue")) for d in body.get("details", []) if isinstance(d, dict))
        return details or str(body.get("message") or exc.response.status_code)
    except ValueError:
        return f"HTTP {exc.response.status_code}"


def _links(details: Dict[str, Any]) -> set:
    return {str(l.get("rel")) for l in details.get("links", []) if isinstance(l, dict)}


def _buyer_already_refunded(details: Dict[str, Any]) -> Optional[str]:
    """When PayPal has already paid the buyer back on this case, the refund's amount; otherwise None."""
    for move in details.get("fund_movements") or []:
        if isinstance(move, dict) and move.get("party") == "BUYER" and move.get("type") == "CREDIT":
            amount = move.get("amount") or {}
            return f"{amount.get('currency_code', '')} {amount.get('value', '')}".strip()
    refunds = (details.get("refund_details") or {}).get("transactions") or []
    if refunds:
        amount = refunds[0].get("gross_amount") or {}
        return f"{amount.get('currency_code', '')} {amount.get('value', '')}".strip()
    return None


def _has(links: set, name: str) -> bool:
    return any(name in rel for rel in links)


async def _rule_as_paypal(dispute: Dispute, details: Dict[str, Any]) -> Optional[Tuple[Dict[str, Any], str]]:
    """ResolveIQ is PayPal's own investigation desk, so the decision is PayPal's ruling (the sandbox's adjudicate).
    PayPal offers it once a claim is under its review; an inquiry is escalated to a claim first when PayPal allows that.
    Returns (latest details, what was done), or None when PayPal doesn't offer a ruling on this case right now."""
    did = dispute.external_dispute_id
    links = _links(details)
    steps = []
    if not _has(links, "adjudicate") and _has(links, "escalate"):
        await PayPalClient.post_json(f"/v1/customer/disputes/{did}/escalate",
                                     {"note": f"Escalated by the PayPal investigator in ResolveIQ ({dispute.id}) to rule on it."})
        steps.append("escalated the inquiry to a claim")
        details = await PayPalClient.get_dispute_details(did)
        links = _links(details)
    if not _has(links, "adjudicate"):
        return None
    await PayPalClient.post_json(f"/v1/customer/disputes/{did}/adjudicate", {"adjudication_outcome": dispute.outcome})
    side = "buyer's" if dispute.outcome == "BUYER_FAVOR" else "seller's"
    steps.append(f"ruled it in the {side} favor")
    return details, f"On PayPal: {' and '.join(steps)} (case {did})."


async def _refund_payment(dispute: Dispute, details: Dict[str, Any]) -> Tuple[str, str]:
    did = dispute.external_dispute_id
    capture_id = _first_transaction(details).get("seller_transaction_id")
    if not capture_id:
        return NOT_SENT, f"PayPal didn't say which payment case {did} is about, so it couldn't be refunded."
    amount = (details.get("refund_details") or {}).get("allowed_refund_amount") or details.get("dispute_amount")
    body: Dict[str, Any] = {"note_to_payer": f"Refund for PayPal case {did}: decided in your favor."}
    if _paypal_amount(amount):
        body["amount"] = {"currency_code": amount["currency_code"], "value": amount["value"]}
    await PayPalClient.post_json(f"/v2/payments/captures/{capture_id}/refund", body)
    shown = f"{amount['currency_code']} {amount['value']}" if _paypal_amount(amount) else "the payment"
    return SENT, f"Refunded the buyer {shown} on PayPal for case {did}."


async def _send_revision(dispute: Dispute, details: Dict[str, Any]) -> Tuple[str, str]:
    """A manager overturned a decision PayPal has already carried out. Money can follow in one direction only."""
    did = dispute.external_dispute_id
    refunded = _buyer_already_refunded(details)
    if dispute.outcome == "BUYER_FAVOR":
        if refunded:
            return SENT, f"The buyer already has their money back on PayPal ({refunded}) for case {did}."
        action, summary = await _refund_payment(dispute, details)
        return action, summary + " (the decision was overturned)."
    if refunded:
        return NOT_SENT, (f"PayPal already refunded the buyer {refunded} on case {did}, and a refund can't be taken back from here. "
                          "The overturned decision is recorded in ResolveIQ only.")
    return SENT, f"PayPal had already closed case {did} with no refund, which matches the overturned decision."


async def _send_decision(dispute: Dispute, revised: bool = False) -> Tuple[str, str]:
    """Carries this app's final decision out on PayPal. Returns (audit action, what happened).

    PayPal only allows some actions at each stage of a case, so this goes by the links and money movements on the case."""
    did = dispute.external_dispute_id
    details = await PayPalClient.get_dispute_details(did)
    if details.get("status") == PAYPAL_RESOLVED:
        if revised:
            return await _send_revision(dispute, details)
        return SENT, f"PayPal had already closed case {did}."
    ruled = await _rule_as_paypal(dispute, details)
    if ruled:
        return SENT, ruled[1]

    links = _links(details)
    if dispute.outcome == "BUYER_FAVOR":
        refunded = _buyer_already_refunded(details)
        if refunded:
            return SENT, f"PayPal has refunded the buyer {refunded} on case {did}."
        if _has(links, "accept_claim"):
            # The seller accepts the buyer's claim: PayPal refunds the buyer and closes the case.
            types = ((details.get("allowed_response_options") or {}).get("accept_claim") or {}).get("accept_claim_types") or []
            body: Dict[str, Any] = {"note": f"Decided in the buyer's favor after investigation in ResolveIQ ({dispute.id})."}
            if "REFUND" in types:
                body["accept_claim_type"] = "REFUND"
            await PayPalClient.post_json(f"/v1/customer/disputes/{did}/accept-claim", body)
            return SENT, f"Accepted the buyer's claim on PayPal: the buyer is refunded and case {did} closes in their favor."
        # Any other stage: refund the payment itself. The buyer sees it in their PayPal activity, and PayPal closes the
        # case once the disputed amount is back with the buyer.
        return await _refund_payment(dispute, details)

    return NOT_SENT, (f"PayPal doesn't offer a ruling on case {did} at this stage, so it can't be closed for the seller yet. "
                      "No money moved; press Sync PayPal to try again once PayPal is reviewing it.")


async def push_decisions(db: Session, actor: str = "paypal_api", retry_refused: bool = False) -> List[str]:
    """Sends every decided PayPal case's outcome to PayPal once. Returns what happened, one line per case.

    A case PayPal refused isn't tried again by the background poll; pressing Sync PayPal (retry_refused) tries it again."""
    if not PayPalClient.is_configured():
        return []
    markers = [SENT] if retry_refused else [SENT, NOT_SENT]
    last_sent: Dict[str, datetime] = {}
    for did_, at in db.query(AuditEvent.dispute_id, AuditEvent.created_at).filter(AuditEvent.action.in_(markers)).all():
        last_sent[did_] = max(at, last_sent.get(did_, at))
    last_overturn: Dict[str, datetime] = {}
    for did_, at in db.query(AuditEvent.dispute_id, AuditEvent.created_at).filter(AuditEvent.action == "DECISION_OVERTURNED").all():
        last_overturn[did_] = max(at, last_overturn.get(did_, at))
    # A case is done once PayPal has been told its latest outcome. A manager's overturn makes it due again.
    handled = {d for d, at in last_sent.items() if d not in last_overturn or at > last_overturn[d]}
    reported = {row[0] for row in db.query(Flag.dispute_id).filter(Flag.status == "OPEN").all()}
    decided = (db.query(Dispute)
               .filter(Dispute.source == SOURCE, Dispute.status.in_(list(CLOSED)), Dispute.outcome.in_(["BUYER_FAVOR", "SELLER_FAVOR"]),
                       Dispute.decided_by.isnot(None))   # decided here, not a case PayPal closed by itself
               .all())
    done: List[str] = []
    for dispute in decided:
        if dispute.id in handled or dispute.id in reported or not dispute.external_dispute_id:
            continue   # a reported decision waits for the manager: PayPal hears the outcome they settle on
        try:
            action, summary = await _send_decision(dispute, revised=dispute.id in last_overturn and dispute.id in last_sent)
            status = "SUCCESS" if action == SENT else "FAILED"
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:   # PayPal hiccup: try again on the next round
                logger.warning("PayPal couldn't take the decision on %s yet: %s", dispute.id, _paypal_error(exc))
                continue
            action, status = NOT_SENT, "FAILED"
            summary = f"PayPal refused the decision on case {dispute.external_dispute_id}: {_paypal_error(exc)}"
        except (httpx.HTTPError, ConnectionError) as exc:
            logger.warning("Couldn't reach PayPal to send the decision on %s: %s", dispute.id, exc)
            continue
        AuditService.record_event(db=db, dispute_id=dispute.id, actor=actor, action=action, status=status, source=SOURCE,
                                  request_reference=dispute.external_dispute_id, result_summary=summary)
        done.append(summary)
    return done
