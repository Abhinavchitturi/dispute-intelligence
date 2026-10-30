from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.team import INVESTIGATOR, MANAGER, User
from backend.app.services.auth_service import actor_name, case_scope, case_user, manager_user
from backend.app.services.strike_service import StrikeService
from backend.app.schemas.audit import (
    ActionDraftResponse,
    AdminReviewRequest,
    AssignRequest,
    DecisionSubmitRequest,
    ActionExecuteRequest,
    ActionExecuteResponse,
    ActionPreviewRequest,
    ActionPreviewResponse,
)
from backend.app.services import evidence_catalog as cat
from backend.app.services.ai_service import AIService
from backend.app.services.audit_service import AuditService
from backend.app.services.draft_service import DraftService
from backend.app.services.decision_service import DecisionError, DecisionService
from backend.app.services.message_service import (
    CLOSED,
    PENDING_REVIEW,
    DECISION_ACTIONS,
    OPEN_STATUSES,
    REQUEST_ACTIONS,
    MessageService,
)

router = APIRouter(tags=["Dispute Actions"], dependencies=[Depends(case_user), Depends(case_scope)])

# What a PayPal investigator can do on a dispute.
SUPPORTED_ACTIONS: Dict[str, Dict[str, Any]] = {
    "REQUEST_SELLER_EVIDENCE": {
        "impact": "Asks the seller for the selected evidence. The case waits on the seller until they reply.",
        "warning": "The seller will see the buyer's claim and the carrier facts in your message.",
    },
    "REQUEST_BUYER_EVIDENCE": {
        "impact": "Asks the buyer for the selected evidence. The case waits on the buyer until they reply.",
        "warning": "The buyer will see the carrier facts in your message.",
    },
    "DECIDE_FOR_BUYER": {
        "impact": "Closes the case in the buyer's favor. The buyer is refunded, the amount is taken from the seller, and both are notified.",
        "warning": "A decision is final. It closes the case and moves money.",
    },
    "DECIDE_FOR_SELLER": {
        "impact": "Closes the case in the seller's favor. No refund is issued, and both parties are notified.",
        "warning": "A decision is final. It closes the case.",
    },
}


def _get_dispute(db: Session, dispute_id: str) -> Dispute:
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    return dispute


@router.get("/disputes/{dispute_id}/evidence-requests/options")
def evidence_request_options(dispute_id: str, db: Session = Depends(get_db)):
    """The checklist PayPal sees when asking the seller or the buyer for evidence."""
    context = AIService.build_case_context(_get_dispute(db, dispute_id))
    return {"seller": cat.options_for(context, cat.SELLER), "buyer": cat.options_for(context, cat.BUYER)}


@router.post("/disputes/{dispute_id}/actions/preview", response_model=ActionPreviewResponse)
def preview_action(dispute_id: str, request: ActionPreviewRequest, db: Session = Depends(get_db)):
    """Pre-flight check for an action: is it allowed, and what will it do?"""
    dispute = _get_dispute(db, dispute_id)
    info = SUPPORTED_ACTIONS.get(request.action_type)
    if not info:
        return ActionPreviewResponse(
            dispute_id=dispute.id, action_type=request.action_type, is_supported=False, requires_confirmation=False,
            impact_summary="Action is not recognized.", warning_message="Unsupported action code.", target_environment=settings.RESOLVEIQ_MODE,
        )

    allowed = dispute.status in OPEN_STATUSES and not (dispute.status == PENDING_REVIEW and request.action_type in REQUEST_ACTIONS)
    impact = info["impact"]
    if request.action_type in REQUEST_ACTIONS and request.requested_evidence:
        n = len(request.requested_evidence)
        party = "seller" if REQUEST_ACTIONS[request.action_type] == cat.SELLER else "buyer"
        impact = f"Asks the {party} for {n} item{'s' if n != 1 else ''}. The case waits on the {party} until they reply."
    warning = info["warning"] if allowed else f"This dispute is already {dispute.status.lower()}, so no further action can be taken."
    is_sandbox = settings.RESOLVEIQ_MODE == "sandbox" and dispute.source == "paypal_sandbox"
    return ActionPreviewResponse(
        dispute_id=dispute.id, action_type=request.action_type, is_supported=allowed, requires_confirmation=True,
        impact_summary=impact, warning_message=warning, target_environment="paypal_sandbox" if is_sandbox else "demo",
    )


@router.post("/disputes/{dispute_id}/actions/draft", response_model=ActionDraftResponse)
async def draft_action_message(dispute_id: str, request: ActionPreviewRequest, db: Session = Depends(get_db)):
    """Drafts the message for an action from case records only. Nothing is sent; the investigator reviews and edits it."""
    dispute = _get_dispute(db, dispute_id)
    if request.action_type not in SUPPORTED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported action '{request.action_type}'.")
    return await DraftService.generate(dispute, request.action_type, request.requested_evidence, request.deadline_days)


@router.post("/disputes/{dispute_id}/actions/execute", response_model=ActionExecuteResponse)
async def execute_action(dispute_id: str, request: ActionExecuteRequest, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """Carries out an action, but only after explicit human confirmation."""
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Human confirmation required. Action execution aborted without explicit confirmation flag.")
    dispute = _get_dispute(db, dispute_id)
    action = request.action_type
    if action not in SUPPORTED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported action '{action}'.")
    if action in DECISION_ACTIONS:
        raise HTTPException(status_code=400, detail="A decision goes through review. Submit it with your reason, and the AI reviewer rules on it.")
    if dispute.status in CLOSED:
        raise HTTPException(status_code=400, detail=f"Dispute is already {dispute.status.lower()}. No further action can be taken.")
    if dispute.status == PENDING_REVIEW and action in REQUEST_ACTIONS:
        raise HTTPException(status_code=400, detail="This case is with the AI reviewer. A manager has to reopen it before you can ask for more evidence.")

    is_sandbox = settings.RESOLVEIQ_MODE == "sandbox" and dispute.source == "paypal_sandbox"
    source = "paypal_sandbox" if is_sandbox else "synthetic"
    tag = "" if is_sandbox else "[DEMO MODE] "
    env = "paypal_sandbox" if is_sandbox else "demo"
    note = request.message or request.notes
    suffix = " Messages aren't sent to PayPal Sandbox yet, so this is recorded here only." if is_sandbox else ""

    if action in REQUEST_ACTIONS:
        party = REQUEST_ACTIONS[action]
        items = list(dict.fromkeys(request.requested_evidence or []))
        if not items:
            raise HTTPException(status_code=400, detail="Choose at least one item to ask for.")
        allowed = cat.SELLER_ITEMS if party == cat.SELLER else cat.BUYER_ITEMS
        unknown = [t for t in items if t not in allowed]
        if unknown:
            raise HTTPException(status_code=400, detail=f"Can't ask the {party.lower()} for: {', '.join(unknown)}.")

        audit = AuditService.record_event(
            db=db, dispute_id=dispute.id, actor=actor_name(user, "investigator_user"), action=action, status="SUCCESS", source=source,
            request_reference=f"REQ-{dispute.id}",
            result_summary=f"{tag}Asked the {party.lower()} for: {', '.join(cat.label(t) for t in items)}.",
        )
        sent = MessageService.record_request(
            db, dispute, action, note, request.subject, items, request.deadline_days or 5, audit_event_id=audit.id, sandbox=is_sandbox)
        return ActionExecuteResponse(
            success=True, action_type=action, dispute_id=dispute.id, message_id=sent.id, audit_event_id=audit.id, environment=env,
            message=f"Request sent to the {party.lower()}. The case is now {dispute.status.replace('_', ' ').lower()}.{suffix}",
            details={"new_status": dispute.status, "requested_evidence": items},
        )


def _is_sandbox(dispute: Dispute) -> bool:
    return settings.RESOLVEIQ_MODE == "sandbox" and dispute.source == "paypal_sandbox"


@router.post("/disputes/{dispute_id}/decision")
async def submit_decision(dispute_id: str, request: DecisionSubmitRequest, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """An investigator's call goes to the AI reviewer before anyone is told. A manager is the top of the chain, so theirs is final at once."""
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Human confirmation required.")
    dispute = _get_dispute(db, dispute_id)
    who = actor_name(user, request.actor or "investigator_user")
    try:
        DecisionService.propose(db, dispute, request.outcome, request.reason, who)
        if user and user.role == MANAGER:
            action_type = "DECIDE_FOR_BUYER" if request.outcome == "BUYER_FAVOR" else "DECIDE_FOR_SELLER"
            draft = await DraftService.generate(dispute, action_type, None, None)
            body = f"{draft.body}\n\nMANAGER REVIEW\n- {request.reason.strip()}"
            DecisionService.finalize(db, dispute, who, request.outcome, draft.subject, body, request.reason, _is_sandbox(dispute))
            return {"success": True, "dispute_id": dispute.id, "status": dispute.status, "outcome": dispute.outcome,
                    "message": "Decided. The seller and the buyer have been told."}
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "dispute_id": dispute.id, "status": dispute.status, "proposed_outcome": dispute.proposed_outcome,
            "message": "Sent for AI review. Nobody has been told yet."}


@router.post("/disputes/{dispute_id}/admin-review")
async def manager_review(dispute_id: str, request: AdminReviewRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """A manager decides a pending case themselves, or sends it back. Also how a manager reopens a decided case."""
    if user is None and request.role.upper() != "MANAGER":
        raise HTTPException(status_code=403, detail="Only a manager can review decisions.")
    reviewer = actor_name(user, request.reviewer)
    dispute = _get_dispute(db, dispute_id)
    action = request.action.upper()
    try:
        if action == "REOPEN":
            DecisionService.send_back(db, dispute, reviewer, request.note or "")
            return {"success": True, "dispute_id": dispute.id, "status": dispute.status, "message": "Case reopened and sent back to the investigator."}
        if action not in ("APPROVE", "OVERRIDE"):
            raise HTTPException(status_code=400, detail="Action must be APPROVE, OVERRIDE or REOPEN.")
        if dispute.status != PENDING_REVIEW:
            raise HTTPException(status_code=400, detail="Only a case waiting for admin review can be finalized.")
        outcome = request.outcome if action == "OVERRIDE" else dispute.proposed_outcome
        if action == "OVERRIDE" and not (request.note or "").strip():
            raise HTTPException(status_code=400, detail="Say why you are replacing the investigator's decision.")
        action_type = "DECIDE_FOR_BUYER" if outcome == "BUYER_FAVOR" else "DECIDE_FOR_SELLER"
        body, subject = request.message, request.subject
        if not (body or "").strip():
            draft = await DraftService.generate(dispute, action_type, None, None)
            body, subject = draft.body, subject or draft.subject
            extra = (dispute.proposed_reason if action == "APPROVE" else request.note) or ""
            if extra:
                body += f"\n\nINVESTIGATOR REVIEW\n- {extra.strip()}" if action == "APPROVE" else f"\n\nMANAGER REVIEW\n- {extra.strip()}"
        msgs = DecisionService.finalize(db, dispute, reviewer, outcome, subject, body, request.note, _is_sandbox(dispute))
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    side = "buyer" if outcome == "BUYER_FAVOR" else "seller"
    return {"success": True, "dispute_id": dispute.id, "status": dispute.status, "outcome": dispute.outcome, "message_id": msgs[0].id,
            "message": f"Resolved in the {side}'s favor. The seller and the buyer have been told."}


@router.post("/disputes/{dispute_id}/assign")
def assign_dispute(dispute_id: str, request: AssignRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """The manager gives a case to someone, or takes it off its owner. Investigators ask for cases instead of taking them."""
    from backend.app.services import assignment_service as assigner
    dispute = _get_dispute(db, dispute_id)
    if dispute.status in CLOSED:
        raise HTTPException(status_code=400, detail="This case is closed.")
    who = (request.assignee or "").strip()
    target = db.query(User).filter(User.display_name == who).first() if who else None
    if who and (target is None or target.is_active is False):
        raise HTTPException(status_code=400, detail=f"{who} isn't someone who can be given cases.")
    if target and target.is_blocked:
        raise HTTPException(status_code=400, detail=f"{who} is blocked. Unblock them first.")
    by = actor_name(user, "manager")
    assigner.assign_one(db, dispute, target, by)
    if target:
        StrikeService.notify(db, target.id, "ASSIGNED", "You have a new case", f"{by} assigned you {dispute.id}.", dispute.id)
        assigner.settle_requests(db, target, by, 1)
    db.commit()
    return {"success": True, "dispute_id": dispute.id, "assigned_to": dispute.assigned_to}
