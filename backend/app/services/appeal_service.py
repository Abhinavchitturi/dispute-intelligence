"""When someone is unhappy with a decision and emails the appeals address, a new case opens for a different investigator, with a manager joined."""
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.models.team import INVESTIGATOR, User
from backend.app.services import email_service
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED, OPEN_STATUSES
from backend.app.services.strike_service import StrikeService

CASE_ID = re.compile(r"\b([A-Z]+(?:-[A-Z]+)*-\d+(?:-A\d+)?)\b")   # DEMO-DSP-1042, or its appeal DEMO-DSP-1042-A1


class AppealError(ValueError):
    pass


def case_id_in(*texts: str) -> Optional[str]:
    for t in texts:
        m = CASE_ID.search(t or "")
        if m:
            return m.group(1)
    return None


def _pick_investigator(db: Session, original: Dispute) -> Optional[User]:
    """Someone other than whoever decided the first time: the active investigator with the fewest open cases."""
    avoid = {original.proposed_by, original.assigned_to}
    people = [u for u in db.query(User).filter(User.role == INVESTIGATOR, User.is_blocked.is_(False)).all() if u.display_name not in avoid]
    if not people:
        return None
    load = lambda u: db.query(Dispute).filter(Dispute.assigned_to == u.display_name, Dispute.status.in_(OPEN_STATUSES)).count()
    return min(people, key=load)


def open_appeal(db: Session, original: Dispute, from_address: str, body: str, subject: str = "") -> Dispute:
    if original.status not in CLOSED or original.outcome not in ("BUYER_FAVOR", "SELLER_FAVOR"):
        raise AppealError("Only a decided case can be appealed.")
    sender = (from_address or "").strip().lower()
    party = cat.BUYER if sender == email_service.buyer_address(original).lower() else cat.SELLER if sender == email_service.seller_address(original).lower() else None
    if party is None:
        raise AppealError("That email address isn't the buyer or the seller on this case, so no appeal was opened.")
    siblings = db.query(Dispute).filter(Dispute.parent_dispute_id == original.id).all()
    if any(s.status in OPEN_STATUSES for s in siblings):
        raise AppealError("An appeal on this case is already open.")

    now = datetime.utcnow()
    n = len(siblings) + 1
    investigator = _pick_investigator(db, original)
    manager = next(iter(StrikeService.managers(db)), None)

    appeal = Dispute(
        id=f"{original.id}-A{n}", source=original.source, transaction_id=original.transaction_id, order_id=original.order_id,
        buyer_reference=original.buyer_reference, merchant_reference=original.merchant_reference, reason=original.reason,
        status="OPEN", amount=original.amount, currency=original.currency, response_due_date=now + timedelta(days=settings.CASE_WINDOW_DAYS), created_at=now, updated_at=now,
        buyer_claim=original.buyer_claim, evidence_status=original.evidence_status, priority_score=min(100.0, (original.priority_score or 0) + 10),
        priority_factors_json=original.priority_factors_json, assigned_to=investigator.display_name if investigator else None,
        manager_assigned=manager.display_name if manager else None, parent_dispute_id=original.id, appeal_number=n,
        buyer_email=original.buyer_email, seller_email=original.seller_email,
    )
    db.add(appeal)
    db.flush()

    # The new investigator starts with everything already on file, so nothing has to be asked for twice.
    for ev in original.evidence_items:
        if ev.availability_status == "AVAILABLE":
            db.add(Evidence(id=f"{appeal.id}-{uuid.uuid4().hex[:8]}", dispute_id=appeal.id, evidence_type=ev.evidence_type, description=ev.description,
                            source_record_id=ev.source_record_id, source=ev.source, submitted_at=ev.submitted_at, availability_status="AVAILABLE",
                            metadata_json=ev.metadata_json))
    db.add(DisputeMessage(
        id=f"MSG-{uuid.uuid4().hex[:12]}", dispute_id=appeal.id, direction="INBOUND", counterparty=party, action_type="APPEAL_REQUEST",
        subject=subject or f"Appeal of dispute {original.id}", body=(body or "").strip() or "Requested further investigation.", source="synthetic" if original.source == "synthetic" else "paypal_sandbox",
        awaiting_reply=False, is_read=False, created_at=now,
    ))

    who = "the buyer" if party == cat.BUYER else "the seller"
    email_service.queue(db, appeal.id, from_address, f"We received your request about dispute {original.id}",
                        f"Thank you. We have opened a new case, {appeal.id}, for further investigation. A different investigator"
                        f"{' (' + investigator.display_name + ')' if investigator else ''} will review everything again, with a manager"
                        f"{' (' + manager.display_name + ')' if manager else ''} working alongside them. We will write to you with the result.\n\nPayPal Dispute Resolution",
                        party)
    AuditService.record_event(db=db, dispute_id=original.id, actor="system", action="APPEAL_RECEIVED", status="SUCCESS", source=original.source,
                              result_summary=f"{who.capitalize()} asked for further investigation by email. New case {appeal.id} opened.")
    AuditService.record_event(db=db, dispute_id=appeal.id, actor="system", action="APPEAL_OPENED", status="SUCCESS", source=original.source,
                              result_summary=f"Appeal of {original.id}, requested by {who}. Assigned to {appeal.assigned_to or 'nobody yet'} with {appeal.manager_assigned or 'no manager'} joined.")

    StrikeService.open_alert(db, "APPEAL", f"Appeal opened: {appeal.id}",
                             f"{who.capitalize()} asked for further investigation of {original.id}. New case {appeal.id} is with {appeal.assigned_to or 'nobody yet'}, and you are joined to it.",
                             dispute_id=appeal.id)
    if investigator:
        StrikeService.notify(db, investigator.id, "APPEAL", f"New appeal case: {appeal.id}",
                             f"You have a new case, {appeal.id}. It appeals a decision on {original.id}. A manager is joined to it.", appeal.id)
    db.commit()
    return appeal


def handle_inbound(db: Session, from_address: str, to_address: str, subject: str, body: str, attachments: Optional[list] = None) -> dict:
    """An email arrived. On an open case from the seller or buyer it is a reply to a request. On a decided case it is a request for a second look, and opens an appeal."""
    case = case_id_in(subject, body)
    mail = email_service.queue(db, case, to_address or settings.APPEALS_EMAIL, subject or "(no subject)", body or "", direction="IN", sender=from_address)
    original = db.query(Dispute).filter(Dispute.id == case).first() if case else None
    if not original:
        db.commit()
        return {"opened": False, "reason": "No case number found in the email. Ask them to include it in the subject.", "email_id": mail.id}
    sender = (from_address or "").strip().lower()
    party = cat.BUYER if sender == email_service.buyer_address(original).lower() else cat.SELLER if sender == email_service.seller_address(original).lower() else None
    if original.status in OPEN_STATUSES and party:
        from backend.app.services import reply_service
        reply = reply_service.receive_reply(db, original, party, subject, body, attachments)
        return {"opened": False, "reply_recorded_for": original.id, "message_id": reply.id, "email_id": mail.id,
                "reason": "Reply added to the case. Someone at PayPal will go through what came with it."}
    try:
        appeal = open_appeal(db, original, from_address, body, subject)
    except AppealError as e:
        db.commit()
        return {"opened": False, "reason": str(e), "email_id": mail.id, "case_id": original.id}
    return {"opened": True, "appeal_id": appeal.id, "assigned_to": appeal.assigned_to, "manager": appeal.manager_assigned, "email_id": mail.id}
