import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.models.message import DisputeMessage
from backend.app.schemas.messages import ThreadSummary
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services import email_service

PENDING_REVIEW = "PENDING_AI_REVIEW"  # an investigator proposed a decision and the AI reviewer has yet to rule on it
IN_PROGRESS = "IN_PROGRESS"  # some evidence is in, but the case is not ready to decide yet
OPEN_STATUSES = ["OPEN", "WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE", "WAITING_FOR_BOTH_RESPONSES", IN_PROGRESS, "UNDER_REVIEW", PENDING_REVIEW]
CLOSED = ("RESOLVED", "CLOSED")

REQUEST_ACTIONS = {"REQUEST_SELLER_EVIDENCE": cat.SELLER, "REQUEST_BUYER_EVIDENCE": cat.BUYER}
DECISION_ACTIONS = {"DECIDE_FOR_BUYER": "BUYER_FAVOR", "DECIDE_FOR_SELLER": "SELLER_FAVOR"}
ACTION_LABEL = {
    "REQUEST_SELLER_EVIDENCE": "Evidence request to seller",
    "REQUEST_BUYER_EVIDENCE": "Evidence request to buyer",
    "DECIDE_FOR_BUYER": "Decision: buyer's favor",
    "DECIDE_FOR_SELLER": "Decision: seller's favor",
}
PARTY_NAME = {cat.SELLER: "seller", cat.BUYER: "buyer"}


def _new_id() -> str:
    return f"MSG-{uuid.uuid4().hex[:12]}"


def _date(value: Optional[datetime]) -> Optional[str]:
    return value.date().isoformat() if value else None


def _party_label(party: str) -> str:
    return "Seller" if party == cat.SELLER else "Buyer"


KEEP_FOR_SELLER = ("DECISION", "WHAT HAPPENS NEXT", "REVIEW", "MANAGER REVIEW", "INVESTIGATOR REVIEW")


def short_notice(full: str) -> str:
    """The seller only needs the outcome, what happens next and the review. The full write-up goes to the buyer."""
    blocks, current = [], []
    for line in full.split("\n"):
        t = line.strip()
        if t and t == t.upper() and t.replace(" ", "").isalpha():
            current = [t]
            blocks.append(current)
        elif current:
            current.append(line)
        elif not blocks:
            blocks.append([line])  # the header line
    kept = [b for b in blocks if b[0] in KEEP_FOR_SELLER or not b[0].isupper()]
    return "\n\n".join("\n".join(b).strip() for b in kept).strip() or full


class MessageService:
    """Stores every message PayPal sends and, in demo mode, simulates how the seller and buyer answer."""

    # ---------- case status ----------
    @classmethod
    def pending_parties(cls, db: Session, dispute_id: str) -> List[str]:
        rows = db.query(DisputeMessage.counterparty).filter(
            DisputeMessage.dispute_id == dispute_id, DisputeMessage.direction == "OUTBOUND", DisputeMessage.awaiting_reply.is_(True)
        ).distinct().all()
        return sorted(r[0] for r in rows)

    @classmethod
    def status_from_requests(cls, db: Session, dispute: Dispute) -> str:
        """Where the case stands. Waiting while anyone owes a reply. Ready to decide only once BOTH the seller and the buyer have answered,
        or a reply deadline has passed. In between (one side has answered, the other not asked yet) it is simply in progress."""
        pending = cls.pending_parties(db, dispute.id)
        if cat.SELLER in pending and cat.BUYER in pending:
            return "WAITING_FOR_BOTH_RESPONSES"
        if cat.SELLER in pending:
            return "WAITING_FOR_SELLER_RESPONSE"
        if cat.BUYER in pending:
            return "WAITING_FOR_BUYER_RESPONSE"
        asked = db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute.id, DisputeMessage.direction == "OUTBOUND",
                                                DisputeMessage.action_type.in_(list(REQUEST_ACTIONS))).all()
        if not asked:
            return "OPEN"
        timed_out = any(m._meta().get("expired") for m in asked)
        answered = {m.counterparty for m in asked if not m.awaiting_reply}
        return "UNDER_REVIEW" if timed_out or {cat.SELLER, cat.BUYER} <= answered else IN_PROGRESS

    # ---------- outbound ----------
    @classmethod
    def record_request(
        cls, db: Session, dispute: Dispute, action_type: str, body: Optional[str], subject: Optional[str],
        requested_evidence: List[str], deadline_days: int = 5, audit_event_id: Optional[str] = None, sandbox: bool = False,
    ) -> DisputeMessage:
        party = REQUEST_ACTIONS[action_type]
        now = datetime.utcnow()
        label = ACTION_LABEL[action_type]
        msg = DisputeMessage(
            id=_new_id(), dispute_id=dispute.id, direction="OUTBOUND", counterparty=party, action_type=action_type,
            subject=subject or f"{label} for dispute {dispute.id}",
            body=(body or "").strip() or f"{label}. No message text was provided.",
            source="paypal_sandbox" if sandbox else "synthetic",
            awaiting_reply=True,
            # Only the demo simulates answers. A real party would reply through PayPal itself.
            reply_due_at=None if sandbox else now + timedelta(seconds=max(0, settings.DEMO_REPLY_DELAY_SECONDS)),
            is_read=True, audit_event_id=audit_event_id,
            meta_json=json.dumps({"requested_evidence": requested_evidence, "deadline": (now + timedelta(days=deadline_days)).isoformat()}),
            created_at=now,
        )
        db.add(msg)
        mail = email_service.request_email(db, dispute, party, msg.subject, msg.body, requested_evidence, (now + timedelta(days=deadline_days)).isoformat())
        meta = msg._meta()
        meta.update({"emailed_to": mail.to_address, "email_status": mail.status, "email_id": mail.id})
        msg.meta_json = json.dumps(meta)
        db.commit()
        db.refresh(msg)
        dispute.status = cls.status_from_requests(db, dispute)
        db.commit()
        return msg

    @classmethod
    def record_decision(
        cls, db: Session, dispute: Dispute, action_type: str, body: Optional[str], subject: Optional[str],
        audit_event_id: Optional[str] = None, sandbox: bool = False,
    ) -> List[DisputeMessage]:
        """A decision notifies both parties. Nobody is expected to answer it."""
        now = datetime.utcnow()
        label = ACTION_LABEL[action_type]
        msgs = []
        full = (body or "").strip() or f"{label}. No message text was provided."
        for party in (cat.SELLER, cat.BUYER):
            msgs.append(DisputeMessage(
                id=_new_id(), dispute_id=dispute.id, direction="OUTBOUND", counterparty=party, action_type=action_type,
                subject=subject or f"{label} for dispute {dispute.id}",
                body=short_notice(full) if party == cat.SELLER else f"{full}\n\n{email_service.appeal_text(dispute)}",
                source="paypal_sandbox" if sandbox else "synthetic", awaiting_reply=False, reply_due_at=None,
                is_read=True, audit_event_id=audit_event_id, created_at=now,
            ))
        db.add_all(msgs)
        # Anything still outstanding no longer matters once PayPal has decided.
        db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute.id, DisputeMessage.awaiting_reply.is_(True)).update(
            {"awaiting_reply": False, "reply_due_at": None})
        dispute.status = "RESOLVED"
        dispute.outcome = DECISION_ACTIONS[action_type]
        email_service.decision_emails(db, dispute, dispute.outcome)  # the seller and buyer each get an email that lists the evidence
        db.commit()
        return msgs

    # ---------- simulated replies ----------
    @classmethod
    def _upsert_evidence(cls, db: Session, dispute: Dispute, evidence_type: str, description: str, provided_by: str, now: datetime,
                         extra: Optional[Dict[str, Any]] = None) -> Evidence:
        existing = next((e for e in dispute.evidence_items if e.evidence_type == evidence_type), None)
        meta = json.dumps({"provided_by": provided_by, **(extra or {})})
        if existing:
            existing.availability_status, existing.description = "AVAILABLE", description
            existing.submitted_at, existing.source, existing.metadata_json = now, "synthetic", meta
            return existing
        ev = Evidence(
            id=f"DEMO-EVID-{dispute.id}-{evidence_type}-{uuid.uuid4().hex[:6]}", dispute_id=dispute.id, evidence_type=evidence_type,
            description=description, source="synthetic", submitted_at=now, availability_status="AVAILABLE", metadata_json=meta,
        )
        db.add(ev)
        dispute.evidence_items.append(ev)
        return ev

    @classmethod
    def _seller_reply(cls, db: Session, dispute: Dispute, outbound: DisputeMessage, now: datetime) -> Tuple[str, str, Dict[str, List[str]]]:
        ship = dispute.order.shipment if dispute.order else None
        address_confirmed = bool(ship) and ship.delivery_address_match == "yes"
        delivered = _date(ship.delivered_at) if ship else None
        texts = {
            "PROOF_OF_DELIVERY_SIGNATURE": f"Delivery signed for on {delivered or 'the delivery date'} (carrier signature record attached).",
            "ADDRESS_VERIFICATION": "Carrier GPS coordinates for the delivery match the address on the order.",
            "CARRIER_TRACKING": f"Full carrier scan history{f' ({ship.carrier} {ship.tracking_reference})' if ship and ship.tracking_reference else ''}.",
            "MERCHANT_CORRESPONDENCE": "Emails with the buyer before the dispute (3 messages).",
            "PROOF_OF_FULFILLMENT": "Packing and dispatch record for the order.",
            "RETURN_RECEIPT": "Warehouse receiving log showing the return arriving.",
        }
        # The seller can only confirm a return if the return tracking on file shows it arrived.
        return_arrived = any(e.evidence_type == "RETURN_CARRIER_TRACKING" and e.availability_status == "AVAILABLE" for e in dispute.evidence_items)
        provided: List[str] = []
        unable: List[str] = []
        lines = [f"Thank you for your request about dispute {dispute.id}.", ""]
        sending: List[str] = []
        for t in outbound.requested_evidence:
            existing = next((e for e in dispute.evidence_items if e.evidence_type == t and e.availability_status == "AVAILABLE"), None)
            if existing is not None:
                can = True
            elif t in ("PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION"):
                can = address_confirmed          # a signature or address check only exists if the carrier really confirmed the address
            elif t == "RETURN_RECEIPT":
                can = return_arrived
            elif t == "REFUND_RECORD":
                can = False                      # the buyer says no refund came, and nothing on file says one was issued, so there's no record to send
            else:
                can = True
            if can:
                text = existing.description if existing else texts.get(t, "Documentation attached.")
                if not existing:
                    cls._upsert_evidence(db, dispute, t, f"Provided by seller: {text}", cat.SELLER, now)
                provided.append(t)
                sending.append(f"- {cat.label(t)}: {text}")
            else:
                unable.append(t)
        lines += ["WHAT WE'RE SENDING"] + (sending or ["- Nothing. We were unable to provide any of the requested items."])
        if unable:
            lines += ["", "WHAT WE CAN'T PROVIDE"] + [f"- {cat.label(t)}: we don't have this." for t in unable]
        return f"Re: {outbound.subject}", "\n".join(lines), {"provided_evidence": provided, "unable_to_provide": unable}

    @classmethod
    def _buyer_reply(cls, db: Session, dispute: Dispute, outbound: DisputeMessage, now: datetime) -> Tuple[str, str, Dict[str, List[str]]]:
        ship = dispute.order.shipment if dispute.order else None
        day = _date(ship.delivered_at) if ship and ship.delivered_at else _date(dispute.order.order_date) if dispute.order else None
        provided: List[str] = []
        sending: List[str] = []
        for t in outbound.requested_evidence:
            if t == "BUYER_CAMERA_FOOTAGE":
                name = f"porch-camera-{day or 'delivery-day'}.mp4"
                text = f"Porch camera video, {day or 'delivery day'}, 14:00 to 18:00. No carrier visible. ({name}, 1m 48s, 23 MB)"
                cls._upsert_evidence(db, dispute, t, f"Provided by buyer: {text}", cat.BUYER, now, {
                    "file_name": name, "content_type": "video/mp4", "size_bytes": 24_117_248, "duration_seconds": 108,
                    "storage": "File is stored by PayPal. The demo keeps this reference only."})
            elif t == "DELIVERY_ADDRESS_CONFIRMATION":
                text = "The address on the order is correct and still current."
                cls._upsert_evidence(db, dispute, t, f"Provided by buyer: {text}", cat.BUYER, now)
            elif t == "BUYER_PHOTOS_OF_ITEM":
                text = "3 photos of the item as received (box, item, damage). (photos-1.jpg to photos-3.jpg)"
                cls._upsert_evidence(db, dispute, t, f"Provided by buyer: {text}", cat.BUYER, now, {"file_name": "photos-1.jpg +2", "content_type": "image/jpeg"})
            elif t == "BUYER_RETURN_PROOF":
                track = next((e for e in dispute.evidence_items if e.evidence_type == "RETURN_CARRIER_TRACKING" and e.availability_status == "AVAILABLE"), None)
                text = "Return shipping receipt and carrier tracking number for the package I sent back." + (f" {track.description}" if track else "")
                cls._upsert_evidence(db, dispute, t, f"Provided by buyer: {text}", cat.BUYER, now, {"file_name": "return-receipt.pdf", "content_type": "application/pdf"})
            else:
                claim = (dispute.buyer_claim or "I did not get what I paid for.").strip()
                text = f"\"{claim}\" I have nothing further to add."
                cls._upsert_evidence(db, dispute, t, f"Provided by buyer: {text}", cat.BUYER, now)
            provided.append(t)
            sending.append(f"- {cat.label(t)}: {text}")
        body = "\n".join([f"Hi, here's what I can send for dispute {dispute.id}.", "", "ATTACHED"] + sending)
        return f"Re: {outbound.subject}", body, {"provided_evidence": provided, "unable_to_provide": []}

    @classmethod
    def deliver_reply(cls, db: Session, outbound: DisputeMessage, now: Optional[datetime] = None) -> Optional[DisputeMessage]:
        """Creates the party's simulated answer to one evidence request and moves the case along."""
        if not outbound.awaiting_reply or outbound.action_type not in REQUEST_ACTIONS:
            return None
        # A real emailed reply is already waiting to be gone through, so the demo doesn't invent a second one.
        if db.query(DisputeMessage).filter(DisputeMessage.in_reply_to == outbound.id, DisputeMessage.direction == "INBOUND").first():
            outbound.reply_due_at = None
            return None
        now = now or datetime.utcnow()
        dispute = db.query(Dispute).filter(Dispute.id == outbound.dispute_id).first()
        party = outbound.counterparty
        build = cls._seller_reply if party == cat.SELLER else cls._buyer_reply
        subject, body, meta = build(db, dispute, outbound, now)

        inbound = DisputeMessage(
            id=_new_id(), dispute_id=dispute.id, direction="INBOUND", counterparty=party, action_type=outbound.action_type,
            subject=subject, body=body, source="synthetic", awaiting_reply=False, in_reply_to=outbound.id, is_read=False,
            meta_json=json.dumps(meta), created_at=now,
        )
        outbound.awaiting_reply = False
        outbound.reply_due_at = None
        db.add(inbound)
        db.flush()
        if dispute.status != PENDING_REVIEW:
            dispute.status = cls.status_from_requests(db, dispute)
        if dispute.evidence_status != "CONFLICTING":  # a conflict between the sides isn't resolved by more documents arriving
            still_missing = any(e.availability_status in ("MISSING", "NOT_REQUESTED") for e in dispute.evidence_items)
            dispute.evidence_status = "PARTIAL" if still_missing else "COMPLETE"
        db.commit()

        sent = len(meta["provided_evidence"])
        AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=f"{PARTY_NAME[party]}_simulator", action="REPLY_RECEIVED", status="SUCCESS",
            source="synthetic", request_reference=outbound.id,
            result_summary=f"[DEMO MODE] Simulated reply from the {PARTY_NAME[party]}: {sent} of {len(outbound.requested_evidence)} requested items provided. Case is now {dispute.status}.",
        )
        db.refresh(inbound)
        return inbound

    @classmethod
    def expire_overdue(cls, db: Session, now: Optional[datetime] = None) -> int:
        """When a reply deadline passes, stop waiting. The case becomes Ready to decide and whatever never arrived stays missing."""
        now = now or datetime.utcnow()
        touched = set()
        for m in db.query(DisputeMessage).filter(DisputeMessage.direction == "OUTBOUND", DisputeMessage.awaiting_reply.is_(True)).all():
            raw = m.deadline
            try:
                due = datetime.fromisoformat(raw) if raw else None
            except ValueError:
                due = None
            if due is None or due > now:
                continue
            meta = m._meta()
            meta["expired"] = True
            m.meta_json = json.dumps(meta)
            m.awaiting_reply = False
            m.reply_due_at = None
            touched.add(m.dispute_id)
        db.flush()
        for did in touched:
            d = db.query(Dispute).filter(Dispute.id == did).first()
            if d and d.status not in CLOSED and d.status != PENDING_REVIEW:
                d.status = cls.status_from_requests(db, d)
                AuditService.record_event(
                    db=db, dispute_id=d.id, actor="system", action="REPLY_DEADLINE_PASSED", status="SUCCESS", source=d.source,
                    result_summary="The reply deadline passed. Anything not received is missing. The case is ready to decide.",
                )
        db.commit()
        return len(touched)

    @classmethod
    def deliver_due(cls, db: Session, dispute_id: Optional[str] = None, now: Optional[datetime] = None) -> int:
        """Delivers every simulated reply whose wait is over. Called whenever messages are read."""
        now = now or datetime.utcnow()
        cls.expire_overdue(db, now)
        q = db.query(DisputeMessage).filter(
            DisputeMessage.awaiting_reply.is_(True), DisputeMessage.reply_due_at.isnot(None), DisputeMessage.reply_due_at <= now
        )
        if dispute_id:
            q = q.filter(DisputeMessage.dispute_id == dispute_id)
        n = 0
        for m in q.order_by(DisputeMessage.created_at).all():
            if cls.deliver_reply(db, m, now):
                n += 1
        return n

    # ---------- read side ----------
    @classmethod
    def thread_for(cls, dispute: Dispute, messages: List[DisputeMessage]) -> ThreadSummary:
        last = messages[-1]
        pending = [m for m in messages if m.direction == "OUTBOUND" and m.awaiting_reply]
        if pending:
            parties = {m.counterparty for m in pending}
            state = "WAITING"
            waiting_on = "Seller and buyer" if len(parties) == 2 else _party_label(next(iter(parties)))
        elif dispute.status in CLOSED:
            state, waiting_on = "CLOSED", None
        elif dispute.status == PENDING_REVIEW:
            state, waiting_on = "IN_REVIEW", None  # the investigator has decided and the AI reviewer is checking it
        elif dispute.status == "UNDER_REVIEW":
            state, waiting_on = "YOUR_TURN", None  # both sides have answered, so it's PayPal's move
        else:
            state, waiting_on = "IN_PROGRESS", None  # some evidence is in, but not from both sides yet
        preview = " ".join(last.body.split())
        return ThreadSummary(
            dispute_id=dispute.id, buyer_reference=dispute.buyer_reference, merchant_reference=dispute.merchant_reference,
            reason=dispute.reason, amount=dispute.amount, currency=dispute.currency, dispute_status=dispute.status,
            state=state, waiting_on=waiting_on, assigned_to=dispute.assigned_to,
            last_message_preview=preview[:140] + ("…" if len(preview) > 140 else ""),
            last_message_at=last.created_at, last_direction=last.direction,
            unread_count=sum(1 for m in messages if m.direction == "INBOUND" and not m.is_read),
            message_count=len(messages),
            awaiting_since=min((m.created_at for m in pending), default=None),
            expected_reply_at=min((m.reply_due_at for m in pending if m.reply_due_at), default=None),
            simulated=all(m.source == "synthetic" for m in messages),
            pending_message_ids=[m.id for m in pending],
            outcome=dispute.outcome,
        )

    @classmethod
    def list_threads(cls, db: Session, user=None) -> List[ThreadSummary]:
        from backend.app.services.access import can_access
        cls.deliver_due(db)
        rows = db.query(DisputeMessage).order_by(DisputeMessage.created_at).all()
        by_dispute: dict = {}
        for m in rows:
            by_dispute.setdefault(m.dispute_id, []).append(m)
        out = []
        for did, msgs in by_dispute.items():
            d = db.query(Dispute).filter(Dispute.id == did).first()
            if d and can_access(db, user, d):
                out.append(cls.thread_for(d, msgs))
        return sorted(out, key=lambda t: t.last_message_at, reverse=True)
