"""Replies from sellers and buyers, who are outside this app and answer by email.

An email reply lands on the case as an unread message. Someone at PayPal opens it, ticks which documents actually came with it,
and only then does the evidence count and the case move on.
"""
import json
import mimetypes
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import REQUEST_ACTIONS, MessageService
from backend.app.services.strike_service import StrikeService


class ReplyError(ValueError):
    pass


def _party_word(party: str) -> str:
    return "seller" if party == cat.SELLER else "buyer"


def receive_reply(db: Session, d: Dispute, party: str, subject: str, body: str, attachments: Optional[List[str]] = None) -> DisputeMessage:
    """Puts an emailed reply on the case, unread, and tells whoever owns the case."""
    asked = db.query(DisputeMessage).filter(DisputeMessage.dispute_id == d.id, DisputeMessage.direction == "OUTBOUND", DisputeMessage.counterparty == party,
                                            DisputeMessage.awaiting_reply.is_(True), DisputeMessage.action_type.in_(list(REQUEST_ACTIONS))).order_by(DisputeMessage.created_at.desc()).first()
    now = datetime.utcnow()
    msg = DisputeMessage(
        id=f"MSG-{uuid.uuid4().hex[:12]}", dispute_id=d.id, direction="INBOUND", counterparty=party, action_type=asked.action_type if asked else "EMAIL_REPLY",
        subject=subject or f"Re: dispute {d.id}", body=(body or "").strip() or "(no text)", source="email", awaiting_reply=False,
        in_reply_to=asked.id if asked else None, is_read=False, created_at=now,
        meta_json=json.dumps({"needs_recording": bool(asked), "attachments": list(attachments or [])}),
    )
    db.add(msg)
    AuditService.record_event(db=db, dispute_id=d.id, actor=f"{_party_word(party)}_email", action="EMAIL_REPLY_RECEIVED", status="SUCCESS", source=d.source,
                              result_summary=f"The {_party_word(party)} replied by email{f' with {len(attachments)} attachment(s)' if attachments else ''}. It needs to be gone through.")
    owner = StrikeService.investigator_named(db, d.assigned_to)
    targets = [owner] if owner else StrikeService.managers(db)
    for u in targets:
        StrikeService.notify(db, u.id, "REPLY", f"The {_party_word(party)} replied on {d.id}", f"An email reply arrived. Open the case and record what they sent.", d.id)
    db.commit()
    db.refresh(msg)
    return msg


def record_reply(db: Session, d: Dispute, reply_id: str, provided: List[Dict], note: Optional[str], who: str) -> DisputeMessage:
    """The person at PayPal says which of the requested documents actually arrived. The rest are recorded as not sent."""
    reply = db.query(DisputeMessage).filter(DisputeMessage.id == reply_id, DisputeMessage.dispute_id == d.id, DisputeMessage.direction == "INBOUND").first()
    if not reply:
        raise ReplyError("That reply isn't on this case.")
    if not reply.needs_recording:
        raise ReplyError("This reply has already been gone through.")
    outbound = db.query(DisputeMessage).filter(DisputeMessage.id == reply.in_reply_to).first()
    if not outbound:
        raise ReplyError("This reply isn't answering a request, so there is nothing to record against.")
    party = reply.counterparty
    allowed = list(outbound.requested_evidence)
    got, seen = [], set()
    for item in provided:
        t = item.get("evidence_type")
        if t not in allowed:
            raise ReplyError(f"{cat.label(t or 'That')} wasn't one of the things asked for.")
        if t in seen:
            continue
        seen.add(t)
        got.append(item)
    now = datetime.utcnow()
    for item in got:
        t = item["evidence_type"]
        name = (item.get("file_name") or "").strip() or None
        text = (item.get("description") or "").strip() or f"Received by email{f' ({name})' if name else ''}."
        extra: Dict = {"via": "email"}
        if name:
            extra.update({"file_name": name, "content_type": mimetypes.guess_type(name)[0] or "application/octet-stream"})
        MessageService._upsert_evidence(db, d, t, f"Provided by {_party_word(party)}: {text}", party, now, extra)
    unable = [t for t in allowed if t not in seen]
    meta = reply._meta()
    meta.update({"needs_recording": False, "provided_evidence": [i["evidence_type"] for i in got], "unable_to_provide": unable, "recorded_by": who, "recorded_note": (note or "").strip() or None})
    reply.meta_json = json.dumps(meta)
    reply.is_read = True
    outbound.awaiting_reply, outbound.reply_due_at = False, None
    db.flush()
    d.status = MessageService.status_from_requests(db, d) if d.status != "PENDING_AI_REVIEW" else d.status
    if d.evidence_status != "CONFLICTING":
        still = any(e.availability_status in ("MISSING", "NOT_REQUESTED") for e in d.evidence_items)
        d.evidence_status = "PARTIAL" if still else "COMPLETE"
    AuditService.record_event(db=db, dispute_id=d.id, actor=who, action="REPLY_RECORDED", status="SUCCESS", source=d.source, request_reference=outbound.id,
                              result_summary=f"Recorded the {_party_word(party)}'s email reply: {len(got)} of {len(allowed)} requested items received. Case is now {d.status}.")
    db.commit()
    db.refresh(reply)
    return reply
