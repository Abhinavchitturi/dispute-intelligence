"""Emails to the seller and buyer, and replies coming back.

With SMTP configured they are sent. Without it they are stored, so the team can read exactly what would have gone out.
"""
import logging
import re
import smtplib
import uuid
from email.message import EmailMessage
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.team import Email
from backend.app.services import evidence_catalog as cat
from backend.app.services import evidence_summary

logger = logging.getLogger("resolveiq.email")
OUTCOME_WORDS = {"BUYER_FAVOR": "the buyer's favor", "SELLER_FAVOR": "the seller's favor"}


def _slug(text: Optional[str], fallback: str) -> str:
    m = re.search(r"\(([^)]+)\)", text or "")
    raw = m.group(1) if m else (text or fallback)
    return re.sub(r"[^a-z0-9_.-]+", "", raw.lower().replace(" ", "")) or fallback


def buyer_address(d: Dispute) -> str:
    return d.buyer_email or f"{_slug(d.buyer_reference, 'buyer')}@buyers.example"


def seller_address(d: Dispute) -> str:
    return d.seller_email or f"{_slug(d.merchant_reference, 'seller')}@sellers.example"


def _deliver(msg: Email) -> None:
    if not settings.SMTP_HOST:
        msg.status = "QUEUED"  # kept in the app instead of sent
        return
    try:
        out = EmailMessage()
        out["From"], out["To"], out["Subject"] = msg.from_address, msg.to_address, msg.subject
        out.set_content(msg.body)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD or "")
            smtp.send_message(out)
        msg.status = "SENT"
    except Exception as e:  # a mail failure must never undo a decision
        logger.warning("Email to %s failed: %s", msg.to_address, e)
        msg.status, msg.error = "FAILED", str(e)[:500]


def queue(db: Session, dispute_id: Optional[str], to: str, subject: str, body: str, party: Optional[str] = None, direction: str = "OUT",
          sender: Optional[str] = None) -> Email:
    msg = Email(id=f"EML-{uuid.uuid4().hex[:10]}", dispute_id=dispute_id, direction=direction, to_address=to,
                from_address=sender or settings.MAIL_FROM, subject=subject, body=body, party=party)
    if direction == "OUT":
        _deliver(msg)
    else:
        msg.status = "RECEIVED"
    db.add(msg)
    return msg


def _list(items: List[Dict]) -> str:
    got = [i["label"] for i in items if i["status"] == "PROVIDED"]
    return "\n".join(f"  - {g}" for g in got) if got else "  - Nothing"


def appeal_text(d: Dispute, ev=None, why: str = "") -> str:
    """The paragraph that says what proof was collected and how to ask for a second look. The buyer's chat notice and both emails use it."""
    ev = ev or evidence_summary.build(d)
    return (
        f"We collected proof from both sides before deciding.\n\nThe seller provided:\n{_list(ev['seller'])}\n\nThe buyer provided:\n{_list(ev['buyer'])}\n"
        + (f"\nPayPal's own records also included:\n{_list(ev['records'])}\n" if any(i['status'] == 'PROVIDED' for i in ev['records']) else "")
        + "\n(The items are listed by name only. The documents themselves are not attached.)\n"
        f"\nThe decision was made on that evidence.{why}\nIf you would like further investigation, email {settings.APPEALS_EMAIL} and include {d.id} in the subject. "
        "When we receive your email we will open a new case for a different investigator, with a manager working alongside them."
    )


def decision_emails(db: Session, d: Dispute, outcome: str, revised: bool = False, note: Optional[str] = None) -> List[Email]:
    """One to the seller and one to the buyer. They list what each side sent, by name only, and say how to ask for a second look."""
    ev = evidence_summary.build(d)
    side = OUTCOME_WORDS.get(outcome, "a final outcome")
    lead = ("We have revised our decision on" if revised else "We have decided") + f" dispute {d.id} ({d.currency} {d.amount:,.2f}) in {side}."
    why = f"\nWhy it was revised: {note.strip()}\n" if revised and note and note.strip() else ""
    body_tail = "\n\n" + appeal_text(d, ev, why)
    sent = []
    for party, name, addr in ((cat.SELLER, d.merchant_reference or "there", seller_address(d)), (cat.BUYER, d.buyer_reference or "there", buyer_address(d))):
        subject = f"{'Updated decision' if revised else 'Decision'} on dispute {d.id}"
        sent.append(queue(db, d.id, addr, subject, f"Hello {name},\n\n{lead}{body_tail}\n\nPayPal Dispute Resolution", party))
    return sent


def request_email(db: Session, d: Dispute, party: str, subject: str, body: str, requested: List[str], deadline: Optional[str]) -> Email:
    """An evidence request goes to the seller or buyer by email, because they don't use this app. Their reply comes back by email too."""
    addr = seller_address(d) if party == cat.SELLER else buyer_address(d)
    asked = "\n".join(f"  - {cat.label(t)}" for t in requested)
    by = f" by {deadline[:10]}" if deadline else ""
    footer = (
        f"\n\n---\nWhat we need{by}:\n{asked}\n\nTo reply, answer this email. Keep [{d.id}] in the subject and attach the documents. "
        "If you can't provide something, say so in your reply."
    )
    return queue(db, d.id, addr, f"[{d.id}] {subject}", f"{body}{footer}", party)
