"""A buyer who didn't answer in time has their dispute dismissed. They can open a new case themselves from a link in the email."""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.services import email_service
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services.auth_service import _sign
from backend.app.services.message_service import CLOSED, OPEN_STATUSES
from backend.app.services.strike_service import StrikeService


class ReopenError(ValueError):
    pass


def buyer_went_silent(d: Dispute, now: Optional[datetime] = None) -> bool:
    """PayPal asked the buyer for evidence, the deadline passed, and nothing came back. Such a case is dismissed, not decided for the seller."""
    now = now or datetime.utcnow()
    for ask in d.messages:
        if ask.direction != "OUTBOUND" or ask.counterparty != cat.BUYER or ask.action_type != "REQUEST_BUYER_EVIDENCE":
            continue
        try:
            due = datetime.fromisoformat(ask.deadline) if ask.deadline else None
        except ValueError:
            due = None
        passed = bool(ask._meta().get("expired")) or (due is not None and due <= now)
        answered = any(m.direction == "INBOUND" and m.counterparty == cat.BUYER and m.created_at and ask.created_at and m.created_at > ask.created_at for m in d.messages)
        if passed and not answered:
            return True
    return False


def new_case_link(d: Dispute) -> str:
    return f"{settings.PUBLIC_URL.rstrip('/')}/api/public/new-case/{d.id}.{_sign('new-case:' + d.id)}"


def dispute_id_from(token: str) -> Optional[str]:
    """The case id inside a valid link token, else None."""
    import hmac
    try:
        did, sig = token.rsplit(".", 1)
    except ValueError:
        return None
    return did if hmac.compare_digest(sig, _sign("new-case:" + did)) else None


def dismiss_for_silence(db: Session, d: Dispute, now: Optional[datetime] = None) -> None:
    """The buyer was asked for evidence and didn't answer before the deadline. The case is dismissed and they are told how to start again."""
    now = now or datetime.utcnow()
    source = "synthetic" if d.source == "synthetic" else "paypal_sandbox"
    db.query(DisputeMessage).filter(DisputeMessage.dispute_id == d.id, DisputeMessage.awaiting_reply.is_(True)).update({"awaiting_reply": False, "reply_due_at": None})
    d.status, d.outcome = "CLOSED", "DISMISSED"
    link = new_case_link(d)
    buyer_text = (f"We asked for more evidence on dispute {d.id}, and we didn't hear back before the deadline. Since you didn't respond, the case is dismissed and no refund is issued.\n\n"
                  f"If you want to reopen the case, create a new one by clicking this button: {link}")
    db.add(DisputeMessage(id=f"MSG-{uuid.uuid4().hex[:12]}", dispute_id=d.id, direction="OUTBOUND", counterparty=cat.BUYER, action_type="DISPUTE_DISMISSED",
                          subject=f"Dispute {d.id} dismissed", body=buyer_text, source=source, awaiting_reply=False, is_read=True, created_at=now))
    db.add(DisputeMessage(id=f"MSG-{uuid.uuid4().hex[:12]}", dispute_id=d.id, direction="OUTBOUND", counterparty=cat.SELLER, action_type="DISPUTE_DISMISSED",
                          subject=f"Dispute {d.id} dismissed",
                          body=f"Dispute {d.id} is dismissed. The buyer didn't respond to our request for evidence in time. No action is needed from you.",
                          source=source, awaiting_reply=False, is_read=True, created_at=now))
    email_service.queue(db, d.id, email_service.buyer_address(d), f"Dispute {d.id} dismissed",
                        f"Hello {d.buyer_reference or 'there'},\n\n{buyer_text}\n\nPayPal Dispute Resolution", cat.BUYER)
    AuditService.record_event(db=db, dispute_id=d.id, actor="system", action="CASE_DISMISSED_NO_RESPONSE", status="SUCCESS", source=d.source,
                              result_summary="The buyer didn't answer the evidence request before the deadline. The case is dismissed and the buyer was sent a link to open a new case.")
    AuditService.record_event(db=db, dispute_id=d.id, actor="ai_agent", action="AI_REVIEW", status="SUCCESS", source=d.source,
                              result_summary="The AI Agent agrees the case is dismissed. The buyer was asked for evidence and didn't respond, so there is no decision for the seller, even though the seller sent evidence.")
    owner = StrikeService.investigator_named(db, d.assigned_to) if d.assigned_to else None
    if owner:
        StrikeService.notify(db, owner.id, "DISMISSED", f"{d.id} was dismissed", "The buyer didn't answer the evidence request in time, so the case was dismissed.", d.id)


def open_new_case(db: Session, original: Dispute) -> Dispute:
    if original.status not in CLOSED or original.outcome != "DISMISSED":
        raise ReopenError("Only a dismissed case can be reopened with a new one.")
    siblings = db.query(Dispute).filter(Dispute.parent_dispute_id == original.id).all()
    if siblings:
        raise ReopenError("A new case was already opened from this one.")
    now = datetime.utcnow()
    new = Dispute(
        id=f"{original.id}-R1", source=original.source, transaction_id=original.transaction_id, order_id=original.order_id,
        buyer_reference=original.buyer_reference, merchant_reference=original.merchant_reference, reason=original.reason, status="OPEN",
        amount=original.amount, currency=original.currency, response_due_date=now + timedelta(days=settings.CASE_WINDOW_DAYS), created_at=now, updated_at=now,
        buyer_claim=original.buyer_claim, evidence_status=original.evidence_status, priority_score=min(100.0, (original.priority_score or 0) + 5),
        priority_factors_json=original.priority_factors_json, assigned_to=original.assigned_to, parent_dispute_id=original.id,
        buyer_email=original.buyer_email, seller_email=original.seller_email,
    )
    db.add(new)
    db.flush()
    for ev in original.evidence_items:
        if ev.availability_status == "AVAILABLE":
            db.add(Evidence(id=f"{new.id}-{uuid.uuid4().hex[:8]}", dispute_id=new.id, evidence_type=ev.evidence_type, description=ev.description,
                            source_record_id=ev.source_record_id, source=ev.source, submitted_at=ev.submitted_at, availability_status="AVAILABLE", metadata_json=ev.metadata_json))
    db.add(DisputeMessage(id=f"MSG-{uuid.uuid4().hex[:12]}", dispute_id=new.id, direction="INBOUND", counterparty=cat.BUYER, action_type="NEW_CASE_REQUEST",
                          subject=f"New case after the dismissal of {original.id}", body="The buyer asked to reopen the dispute by opening a new case.",
                          source="synthetic" if original.source == "synthetic" else "paypal_sandbox", awaiting_reply=False, is_read=False, created_at=now))
    email_service.queue(db, new.id, email_service.buyer_address(original), f"We opened a new case for you: {new.id}",
                        f"Hello {original.buyer_reference or 'there'},\n\nYour new case is {new.id}. We will ask for the evidence we need and write to you with the result.\n\nPayPal Dispute Resolution", cat.BUYER)
    AuditService.record_event(db=db, dispute_id=original.id, actor="system", action="NEW_CASE_REQUESTED", status="SUCCESS", source=original.source,
                              result_summary=f"The buyer opened a new case, {new.id}, after the dismissal.")
    AuditService.record_event(db=db, dispute_id=new.id, actor="system", action="CASE_OPENED", status="SUCCESS", source=original.source,
                              result_summary=f"Opened by the buyer after {original.id} was dismissed. Assigned to {new.assigned_to or 'nobody yet'}.")
    db.commit()
    return new
