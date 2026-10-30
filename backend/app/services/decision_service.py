"""How a case ends.

Decided cases: an investigator proposes BUYER_FAVOR or SELLER_FAVOR with a reason. An admin then confirms it,
replaces it with their own call, or sends it back. Nobody is told until the admin confirms.

Settled cases: each side can say the dispute was settled outside PayPal. It is only SETTLED when both do.
Dismissed cases: only the buyer can withdraw a claim. PayPal then closes it with no refund and no decision.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED, PENDING_REVIEW, MessageService

OUTCOME_LABEL = {"BUYER_FAVOR": "buyer's favor", "SELLER_FAVOR": "seller's favor"}
OUTCOME_ACTION = {"BUYER_FAVOR": "DECIDE_FOR_BUYER", "SELLER_FAVOR": "DECIDE_FOR_SELLER"}
PARTY_WORD = {cat.SELLER: "seller", cat.BUYER: "buyer"}


class DecisionError(ValueError):
    """The requested step isn't allowed in the case's current state."""


def _msg_id() -> str:
    return f"MSG-{uuid.uuid4().hex[:12]}"


def _close(db: Session, dispute: Dispute, outcome: str) -> None:
    db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute.id, DisputeMessage.awaiting_reply.is_(True)).update(
        {"awaiting_reply": False, "reply_due_at": None})
    dispute.status = "CLOSED"
    dispute.outcome = outcome


class DecisionService:
    # ---------- investigator proposes, admin confirms ----------
    @classmethod
    def propose(cls, db: Session, dispute: Dispute, outcome: str, reason: str, actor: str) -> Dispute:
        if outcome not in OUTCOME_LABEL:
            raise DecisionError("Choose the buyer's favor or the seller's favor.")
        if dispute.status in CLOSED:
            raise DecisionError(f"This dispute is already {dispute.status.lower()}.")
        if dispute.status == PENDING_REVIEW:
            raise DecisionError("A decision on this case is already waiting for an admin.")
        reason = (reason or "").strip()
        if len(reason) < 10:
            raise DecisionError("Give the reason for your decision (at least a sentence), so the admin can check it.")
        # Whatever was still outstanding no longer matters: the investigator is deciding with what is on file.
        db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute.id, DisputeMessage.awaiting_reply.is_(True)).update(
            {"awaiting_reply": False, "reply_due_at": None})
        dispute.status = PENDING_REVIEW
        dispute.proposed_outcome, dispute.proposed_reason = outcome, reason
        dispute.proposed_by, dispute.proposed_at = actor, datetime.utcnow()
        if not dispute.assigned_to:
            dispute.assigned_to = actor  # whoever makes the call owns the case
        dispute.review_note = None
        AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=actor, action="DECISION_SUBMITTED", status="SUCCESS", source=dispute.source,
            request_reference=f"PROPOSAL-{dispute.id}",
            result_summary=f"Proposed a decision in the {OUTCOME_LABEL[outcome]} and sent it to an admin. Reason: {reason}",
        )
        db.commit()
        return dispute

    @classmethod
    def send_back(cls, db: Session, dispute: Dispute, admin: str, note: str) -> Dispute:
        """The admin found a problem. The case returns to Ready to decide; nobody outside PayPal is told."""
        if dispute.status not in (PENDING_REVIEW, "RESOLVED"):
            raise DecisionError("Only a case waiting for review, or one already decided, can be reopened.")
        note = (note or "").strip()
        if not note:
            raise DecisionError("Say what the issue is, so the investigator knows what to fix.")
        was_final = dispute.status == "RESOLVED"
        dispute.status = "UNDER_REVIEW"
        dispute.outcome = None
        dispute.review_note, dispute.reviewed_by = note, admin
        AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=admin, action="CASE_REOPENED", status="SUCCESS", source=dispute.source,
            request_reference=f"REVIEW-{dispute.id}",
            result_summary=f"Reopened {'a decided case' if was_final else 'the proposed decision'}. Admin note: {note}",
        )
        db.commit()
        return dispute

    @classmethod
    def finalize(cls, db: Session, dispute: Dispute, admin: str, outcome: str, subject: Optional[str], body: str,
                 note: Optional[str], sandbox: bool) -> List[DisputeMessage]:
        """The admin's call is final: both sides are told and the case is resolved."""
        if dispute.status != PENDING_REVIEW:
            raise DecisionError("Only a case waiting for admin review can be finalized.")
        if outcome not in OUTCOME_LABEL:
            raise DecisionError("Choose the buyer's favor or the seller's favor.")
        overridden = outcome != dispute.proposed_outcome
        dispute.review_note, dispute.reviewed_by = (note or "").strip() or None, admin
        audit = AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=admin, action=OUTCOME_ACTION[outcome], status="SUCCESS", source=dispute.source,
            request_reference=f"DECISION-{dispute.id}",
            result_summary=(f"Admin {'replaced the proposed decision and ' if overridden else 'confirmed the decision and '}"
                            f"resolved the case in the {OUTCOME_LABEL[outcome]}. Both parties notified."),
        )
        return MessageService.record_decision(db, dispute, OUTCOME_ACTION[outcome], body, subject, audit_event_id=audit.id, sandbox=sandbox)

    # ---------- settled and dismissed ----------
    @classmethod
    def declare(cls, db: Session, dispute: Dispute, party: str, kind: str) -> DisputeMessage:
        """A seller or buyer tells PayPal the dispute is settled, or the buyer withdraws. Returns their message."""
        if party not in PARTY_WORD:
            raise DecisionError("Party must be SELLER or BUYER.")
        if kind not in ("SETTLED", "WITHDRAWN"):
            raise DecisionError("Kind must be SETTLED or WITHDRAWN.")
        if kind == "WITHDRAWN" and party != cat.BUYER:
            raise DecisionError("Only the buyer can withdraw a claim.")
        if dispute.status in CLOSED:
            raise DecisionError(f"This dispute is already {dispute.status.lower()}.")
        now = datetime.utcnow()
        who = PARTY_WORD[party]
        source = "synthetic" if dispute.source == "synthetic" else "paypal_sandbox"

        if kind == "SETTLED":
            if (dispute.seller_settled_at if party == cat.SELLER else dispute.buyer_settled_at):
                raise DecisionError(f"The {who} has already said this is settled.")
            subject, text = f"Re: dispute {dispute.id}", f"We have settled this with the {'buyer' if party == cat.SELLER else 'seller'} outside PayPal. Please close the dispute."
            if party == cat.SELLER:
                dispute.seller_settled_at = now
            else:
                dispute.buyer_settled_at = now
        else:
            subject, text = f"Re: dispute {dispute.id}", "I'd like to withdraw my claim. I no longer want to pursue this dispute."

        inbound = DisputeMessage(
            id=_msg_id(), dispute_id=dispute.id, direction="INBOUND", counterparty=party, action_type=f"DECLARE_{kind}",
            subject=subject, body=text, source=source, awaiting_reply=False, is_read=False, created_at=now,
        )
        db.add(inbound)

        if kind == "WITHDRAWN":
            _close(db, dispute, "DISMISSED")
            notice = f"Dispute {dispute.id} is dismissed. The buyer withdrew the claim. No refund is issued and no decision was made."
            cls._notify_both(db, dispute, "DISPUTE_DISMISSED", f"Dispute {dispute.id} dismissed", notice, now, source)
            AuditService.record_event(db=db, dispute_id=dispute.id, actor=f"{who}_simulator" if source == "synthetic" else who, action="CLAIM_WITHDRAWN",
                                      status="SUCCESS", source=source, result_summary="The buyer withdrew the claim. The case is dismissed.")
        elif dispute.seller_settled_at and dispute.buyer_settled_at:
            _close(db, dispute, "SETTLED")
            notice = f"Dispute {dispute.id} is settled. Both the seller and the buyer confirmed they settled it outside PayPal. No decision was made."
            cls._notify_both(db, dispute, "DISPUTE_SETTLED", f"Dispute {dispute.id} settled", notice, now, source)
            AuditService.record_event(db=db, dispute_id=dispute.id, actor="system", action="CASE_SETTLED", status="SUCCESS", source=source,
                                      result_summary="Both sides confirmed a settlement outside PayPal. The case is settled.")
        else:
            other = cat.BUYER if party == cat.SELLER else cat.SELLER
            db.add(DisputeMessage(
                id=_msg_id(), dispute_id=dispute.id, direction="OUTBOUND", counterparty=other, action_type="SETTLEMENT_NOTICE",
                subject=f"The {who} says dispute {dispute.id} is settled",
                body=f"The {who} says this was settled outside PayPal. It only counts as settled if you confirm too. If it isn't, ignore this and the case continues.",
                source=source, awaiting_reply=False, is_read=True, created_at=now,
            ))
            AuditService.record_event(db=db, dispute_id=dispute.id, actor=f"{who}_simulator" if source == "synthetic" else who, action="SETTLEMENT_CLAIMED",
                                      status="SUCCESS", source=source,
                                      result_summary=f"The {who} says it was settled outside PayPal. Not settled until the {PARTY_WORD[other]} confirms.")
        db.commit()
        db.refresh(inbound)
        return inbound

    @classmethod
    def _notify_both(cls, db: Session, dispute: Dispute, action: str, subject: str, body: str, now: datetime, source: str) -> None:
        for party in (cat.SELLER, cat.BUYER):
            db.add(DisputeMessage(
                id=_msg_id(), dispute_id=dispute.id, direction="OUTBOUND", counterparty=party, action_type=action,
                subject=subject, body=body, source=source, awaiting_reply=False, is_read=True, created_at=now,
            ))
