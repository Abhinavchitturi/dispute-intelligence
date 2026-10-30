"""How a case ends.

Decided cases: an investigator proposes BUYER_FAVOR or SELLER_FAVOR with a reason. The AI reviewer (built elsewhere) rules on it.
If it approves, that is the decision. If it overturns, the AI's call stands and the investigator gets a strike. A manager sits above
both: they can decide a pending case themselves, send it back, or overturn a decision after the fact. When they overturn the AI,
that is recorded as feedback for the AI team to train on. Nobody outside PayPal is told until the case is decided.

Settled cases: each side can say the dispute was settled outside PayPal. It is only SETTLED when both do.
Dismissed cases: only the buyer can withdraw a claim. PayPal then closes it with no refund and no decision.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.models.team import AIReview, Flag, ManagerAlert as ManagerAlertModel, User
from backend.app.services import email_service
from backend.app.services import evidence_catalog as cat
from backend.app.services.audit_service import AuditService
from backend.app.services.message_service import CLOSED, PENDING_REVIEW, MessageService
from backend.app.services.strike_service import StrikeService

OUTCOME_LABEL = {"BUYER_FAVOR": "buyer's favor", "SELLER_FAVOR": "seller's favor"}
OPPOSITE = {"BUYER_FAVOR": "SELLER_FAVOR", "SELLER_FAVOR": "BUYER_FAVOR"}
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
            raise DecisionError("A decision on this case is already waiting for review.")
        reason = (reason or "").strip()
        if len(reason) < 10:
            raise DecisionError("Give the reason for your decision (at least a sentence), so the reviewer can check it.")
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
            result_summary=f"Proposed a decision in the {OUTCOME_LABEL[outcome]} and sent it for AI review. Reason: {reason}",
        )
        db.commit()
        return dispute

    @classmethod
    def send_back(cls, db: Session, dispute: Dispute, admin: str, note: str) -> Dispute:
        """A manager found a problem. The case returns to Ready to decide; nobody outside PayPal is told."""
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
                 note: Optional[str], sandbox: bool, decided_by: str = "MANAGER") -> List[DisputeMessage]:
        """The call is final: both sides are told and the case is resolved."""
        if dispute.status != PENDING_REVIEW:
            raise DecisionError("Only a case waiting for admin review can be finalized.")
        if outcome not in OUTCOME_LABEL:
            raise DecisionError("Choose the buyer's favor or the seller's favor.")
        overridden = outcome != dispute.proposed_outcome
        dispute.review_note, dispute.reviewed_by = (note or "").strip() or None, admin
        dispute.decided_by = decided_by
        audit = AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=admin, action=OUTCOME_ACTION[outcome], status="SUCCESS", source=dispute.source,
            request_reference=f"DECISION-{dispute.id}",
            result_summary=(f"{admin} {'replaced the proposed decision and ' if overridden else 'confirmed the decision and '}"
                            f"resolved the case in the {OUTCOME_LABEL[outcome]}. Both parties notified."),
        )
        return MessageService.record_decision(db, dispute, OUTCOME_ACTION[outcome], body, subject, audit_event_id=audit.id, sandbox=sandbox)

    # ---------- the AI reviewer's ruling ----------
    @classmethod
    def ai_verdict(cls, db: Session, dispute: Dispute, verdict: str, outcome: Optional[str], rationale: str, model: Optional[str],
                   subject: Optional[str], body: str, sandbox: bool) -> AIReview:
        """The AI approves (the investigator's call stands) or overturns (the AI's call stands and the investigator gets a strike)."""
        if dispute.status != PENDING_REVIEW:
            raise DecisionError("This case isn't waiting for an AI review.")
        verdict = (verdict or "").upper()
        if verdict not in ("APPROVE", "OVERTURN"):
            raise DecisionError("Verdict must be APPROVE or OVERTURN.")
        rationale = (rationale or "").strip()
        if not rationale:
            raise DecisionError("The AI reviewer must give its reasons.")
        proposed = dispute.proposed_outcome
        final = proposed if verdict == "APPROVE" else outcome
        if verdict == "OVERTURN" and final != OPPOSITE[proposed]:
            raise DecisionError(f"To overturn a {OUTCOME_LABEL[proposed]} decision, the outcome must be {OPPOSITE[proposed]}.")
        investigator = StrikeService.investigator_named(db, dispute.proposed_by)
        review = AIReview(id=f"AIR-{uuid.uuid4().hex[:10]}", dispute_id=dispute.id, investigator_id=investigator.id if investigator else None,
                          proposed_outcome=proposed, verdict=verdict, ai_outcome=final, rationale=rationale, model=model)
        db.add(review)
        dispute.ai_verdict, dispute.ai_rationale = verdict, rationale
        AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=f"ai_reviewer{f' ({model})' if model else ''}", action="AI_REVIEW", status="SUCCESS", source=dispute.source,
            result_summary=f"AI reviewer {'approved the investigator’s decision' if verdict == 'APPROVE' else 'overturned the investigator’s decision'}. {rationale}",
        )
        cls.finalize(db, dispute, "AI reviewer", final, subject, body, rationale, sandbox, decided_by="INVESTIGATOR" if verdict == "APPROVE" else "AI")
        if verdict == "OVERTURN":
            StrikeService.add_strike(db, investigator, dispute.id, f"The AI reviewer overturned the decision on {dispute.id}.")
            db.commit()
        return review

    # ---------- the AI Agent handles a whole case itself ----------
    @classmethod
    def ai_direct(cls, db: Session, dispute: Dispute, outcome: str, rationale: str, model: Optional[str], subject: Optional[str], body: str, sandbox: bool) -> AIReview:
        """A case nobody took was handed to the AI Agent, which decides it. There is no investigator to approve or overturn, so no strikes.
        The decision can still be overturned by a manager, and that correction is saved for the AI team."""
        if not dispute.ai_owned:
            raise DecisionError("This case isn't with the AI Agent.")
        if dispute.status in CLOSED:
            raise DecisionError(f"This dispute is already {dispute.status.lower()}.")
        if outcome not in OUTCOME_LABEL:
            raise DecisionError("Choose BUYER_FAVOR or SELLER_FAVOR.")
        rationale = (rationale or "").strip()
        if not rationale:
            raise DecisionError("The AI Agent must give its reasons.")
        db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute.id, DisputeMessage.awaiting_reply.is_(True)).update({"awaiting_reply": False, "reply_due_at": None})
        name = settings.AI_AGENT_NAME
        dispute.status, dispute.proposed_outcome, dispute.proposed_reason, dispute.proposed_by, dispute.proposed_at = PENDING_REVIEW, outcome, rationale, name, datetime.utcnow()
        review = AIReview(id=f"AIR-{uuid.uuid4().hex[:10]}", dispute_id=dispute.id, investigator_id=None, proposed_outcome=outcome, verdict="DIRECT", ai_outcome=outcome, rationale=rationale, model=model)
        db.add(review)
        dispute.ai_verdict, dispute.ai_rationale = "DIRECT", rationale
        AuditService.record_event(db=db, dispute_id=dispute.id, actor=f"{name}{f' ({model})' if model else ''}", action="AI_DECISION", status="SUCCESS", source=dispute.source,
                                  result_summary=f"The {name} decided this case in the {OUTCOME_LABEL[outcome]}. {rationale}")
        cls.finalize(db, dispute, name, outcome, subject, body, rationale, sandbox, decided_by="AI")
        for m in StrikeService.managers(db):
            StrikeService.notify(db, m.id, "AI_DECISION", f"{name} decided {dispute.id}", f"The {name} decided it in the {OUTCOME_LABEL[outcome]}. You can overturn it if it is wrong.", dispute.id)
        db.commit()
        return review

    # ---------- a manager overturns a decision that was already made ----------
    @classmethod
    def revise(cls, db: Session, dispute: Dispute, manager: str, outcome: str, note: str, source: str = "MANAGER_REVIEW") -> Dispute:
        """Changes the outcome of a decided case. Both sides are sent a correction. If the AI had a hand in it, the correction is saved for the AI team."""
        if dispute.status != "RESOLVED" or dispute.outcome not in OUTCOME_LABEL:
            raise DecisionError("Only a decided case can be overturned.")
        if outcome not in OUTCOME_LABEL:
            raise DecisionError("Choose the buyer's favor or the seller's favor.")
        note = (note or "").strip()
        if len(note) < 10:
            raise DecisionError("Say why you are changing the decision.")
        if outcome == dispute.outcome:
            raise DecisionError("That is already the outcome.")
        before = dispute.outcome
        dispute.outcome, dispute.decided_by, dispute.reviewed_by, dispute.review_note = outcome, "MANAGER", manager, note
        now = datetime.utcnow()
        for party in (cat.SELLER, cat.BUYER):
            db.add(DisputeMessage(
                id=_msg_id(), dispute_id=dispute.id, direction="OUTBOUND", counterparty=party, action_type="DECISION_REVISED",
                subject=f"Updated decision on dispute {dispute.id}",
                body=f"After a further review, the decision on dispute {dispute.id} changed from {OUTCOME_LABEL[before]} to {OUTCOME_LABEL[outcome]}.\n\nWhy: {note}",
                source="synthetic" if dispute.source == "synthetic" else "paypal_sandbox", awaiting_reply=False, is_read=True, created_at=now,
            ))
        email_service.decision_emails(db, dispute, outcome, revised=True, note=note)

        # What the AI team learns from: the AI said one thing, a human with authority said another.
        review = db.query(AIReview).filter(AIReview.dispute_id == dispute.id).order_by(AIReview.created_at.desc()).first()
        if review and review.ai_outcome != outcome:
            review.correct_outcome, review.correction_note = outcome, note
            review.corrected_by, review.corrected_at, review.correction_source = manager, now, source
        # The investigator had it right all along, so the strike comes off.
        if dispute.proposed_outcome == outcome and dispute.ai_verdict == "OVERTURN":
            StrikeService.void_strike(db, dispute.id, manager, "A manager upheld the investigator's original decision.")
        AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=manager, action="DECISION_OVERTURNED", status="SUCCESS", source=dispute.source,
            result_summary=f"Changed the outcome from {OUTCOME_LABEL[before]} to {OUTCOME_LABEL[outcome]}. {note}"
                           + (" Saved as feedback for the AI team." if review and review.correct_outcome == outcome else ""),
        )
        db.commit()
        return dispute

    # ---------- an investigator says the AI got it wrong ----------
    @classmethod
    def raise_flag(cls, db: Session, dispute: Dispute, user: Optional[User], who: str, points: str) -> Flag:
        if dispute.ai_verdict != "OVERTURN" or dispute.status != "RESOLVED":
            raise DecisionError("You can only flag a case where the AI reviewer overturned your decision.")
        points = (points or "").strip()
        if len(points) < 30:
            raise DecisionError("Explain what the AI got wrong, with your reasons, so the manager can check it.")
        if db.query(Flag).filter(Flag.dispute_id == dispute.id, Flag.status == "OPEN").first():
            raise DecisionError("This case is already flagged and waiting for a manager.")
        flag = Flag(id=f"FLG-{uuid.uuid4().hex[:10]}", dispute_id=dispute.id, raised_by=user.id if user else "unknown", points=points)
        db.add(flag)
        db.flush()
        AuditService.record_event(db=db, dispute_id=dispute.id, actor=who, action="AI_DECISION_FLAGGED", status="SUCCESS", source=dispute.source,
                                  result_summary=f"Flagged the AI reviewer's decision as wrong. {points}")
        StrikeService.open_alert(db, "FLAG", f"{who} flagged an AI decision on {dispute.id}", f"{who} says the AI reviewer got {dispute.id} wrong: {points}",
                                 user_id=user.id if user else None, dispute_id=dispute.id)
        db.commit()
        return flag

    @classmethod
    def resolve_flag(cls, db: Session, flag: Flag, dispute: Dispute, manager: str, action: str, note: str) -> Flag:
        if flag.status != "OPEN":
            raise DecisionError("This flag has already been dealt with.")
        action = (action or "").upper()
        note = (note or "").strip()
        if action not in ("UPHOLD_AI", "OVERTURN"):
            raise DecisionError("Action must be UPHOLD_AI or OVERTURN.")
        if len(note) < 10:
            raise DecisionError("Give your reasons, so the investigator and the AI team can learn from it.")
        if action == "OVERTURN":
            cls.revise(db, dispute, manager, dispute.proposed_outcome, note, source="INVESTIGATOR_FLAG")
        else:
            # The AI stands. Record that a human checked and agreed, which is also useful to the AI team.
            AuditService.record_event(db=db, dispute_id=dispute.id, actor=manager, action="FLAG_UPHELD_AI", status="SUCCESS", source=dispute.source,
                                      result_summary=f"The flag was reviewed and the AI's decision stands. {note}")
        flag.status = "OVERTURNED" if action == "OVERTURN" else "UPHELD"
        flag.resolved_by, flag.resolved_at, flag.resolution_note = manager, datetime.utcnow(), note
        for a in db.query(ManagerAlertModel).filter(ManagerAlertModel.dispute_id == dispute.id, ManagerAlertModel.kind == "FLAG", ManagerAlertModel.status == "OPEN").all():
            a.status, a.sorted_by, a.sorted_at, a.sorted_note = "SORTED", manager, datetime.utcnow(), "Flag resolved"
        db.commit()
        return flag

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
