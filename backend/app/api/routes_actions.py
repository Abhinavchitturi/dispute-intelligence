import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.schemas.audit import (
    ActionPreviewRequest,
    ActionPreviewResponse,
    ActionExecuteRequest,
    ActionExecuteResponse
)
from backend.app.services.paypal_client import PayPalClient
from backend.app.services.audit_service import AuditService

router = APIRouter(tags=["Dispute Actions"])

SUPPORTED_ACTIONS = {
    "PROVIDE_EVIDENCE": {
        "valid_statuses": ["WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW"],
        "impact": "Submits tracking, delivery verification, or merchant documentation to rebut buyer claim.",
        "warning": "Ensure submitted evidence complies with PayPal seller protection guidelines. Once submitted, documentation becomes permanent record."
    },
    "ACCEPT_CLAIM": {
        "valid_statuses": ["WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW"],
        "impact": "Consents to claim settlement and authorizes refund of disputed transaction amount to the buyer.",
        "warning": "This action is final and irreversible. Merchant account will be debited for the full disputed amount."
    },
    "REQUEST_BUYER_INFO": {
        "valid_statuses": ["WAITING_FOR_SELLER_RESPONSE", "UNDER_REVIEW"],
        "impact": "Requests supplementary clarification or photos from the buyer via PayPal communication portal.",
        "warning": "Response deadline remains active while awaiting buyer clarification."
    },
    "ESCALATE_TO_PAYPAL": {
        "valid_statuses": ["WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE"],
        "impact": "Requests official PayPal dispute specialist adjudication.",
        "warning": "Escalation transfers binding resolution authority to PayPal."
    }
}

@router.post("/disputes/{dispute_id}/actions/preview", response_model=ActionPreviewResponse)
def preview_action(
    dispute_id: str,
    request: ActionPreviewRequest,
    db: Session = Depends(get_db)
):
    """
    Pre-flight inspection for a dispute action.
    Validates eligibility, calculates impact, and determines confirmation requirement.
    """
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")

    act_info = SUPPORTED_ACTIONS.get(request.action_type)
    if not act_info:
        return ActionPreviewResponse(
            dispute_id=dispute.id,
            action_type=request.action_type,
            is_supported=False,
            requires_confirmation=False,
            impact_summary="Action is not recognized by ResolveIQ dispute rules engine.",
            warning_message="Unsupported action code.",
            target_environment=settings.RESOLVEIQ_MODE
        )

    # Validate against dispute status
    is_valid_status = dispute.status in act_info["valid_statuses"]
    is_sandbox = (settings.RESOLVEIQ_MODE == "sandbox" and dispute.source == "paypal_sandbox")

    warning = act_info["warning"]
    if not is_valid_status:
        warning = f"Action '{request.action_type}' is typically only permitted when dispute status is {act_info['valid_statuses']}. Current status is '{dispute.status}'."

    endpoint = None
    if is_sandbox:
        if request.action_type == "PROVIDE_EVIDENCE":
            endpoint = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes/{dispute.external_dispute_id}/provide-evidence"
        elif request.action_type == "ACCEPT_CLAIM":
            endpoint = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes/{dispute.external_dispute_id}/accept-claim"

    return ActionPreviewResponse(
        dispute_id=dispute.id,
        action_type=request.action_type,
        is_supported=is_valid_status,
        requires_confirmation=True,
        impact_summary=act_info["impact"],
        warning_message=warning,
        target_environment="paypal_sandbox" if is_sandbox else "demo",
        api_endpoint=endpoint
    )

@router.post("/disputes/{dispute_id}/actions/execute", response_model=ActionExecuteResponse)
async def execute_action(
    dispute_id: str,
    request: ActionExecuteRequest,
    db: Session = Depends(get_db)
):
    """
    Executes a verified dispute action only following explicit human confirmation.
    Operates in live PayPal Sandbox or validated Demo mode.
    """
    if not request.confirmed:
        raise HTTPException(
            status_code=400,
            detail="Human confirmation required. Action execution aborted without explicit confirmation flag."
        )

    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")

    act_info = SUPPORTED_ACTIONS.get(request.action_type)
    if not act_info:
        raise HTTPException(status_code=400, detail=f"Unsupported action '{request.action_type}'.")

    is_sandbox = (settings.RESOLVEIQ_MODE == "sandbox" and dispute.source == "paypal_sandbox")

    # Case 1: Sandbox Execution
    if is_sandbox:
        if not dispute.external_dispute_id:
            raise HTTPException(
                status_code=400,
                detail="Dispute lacks external PayPal reference ID required for sandbox REST call."
            )

        try:
            if request.action_type == "PROVIDE_EVIDENCE":
                res = await PayPalClient.execute_provide_evidence(
                    external_dispute_id=dispute.external_dispute_id,
                    evidence_type=request.evidence_type or "PROOF_OF_FULFILLMENT",
                    notes=request.notes or "Investigator evidence submission.",
                    tracking_number=request.tracking_number,
                    carrier=request.carrier
                )
                dispute.status = "UNDER_REVIEW"
                dispute.evidence_status = "COMPLETE"
                db.commit()

                audit_evt = AuditService.record_event(
                    db=db,
                    dispute_id=dispute.id,
                    actor="investigator_user",
                    action="PROVIDE_EVIDENCE",
                    status="SUCCESS",
                    source="paypal_sandbox",
                    request_reference=dispute.external_dispute_id,
                    result_summary=f"Dispatched evidence ({request.evidence_type}) to PayPal Sandbox REST API successfully."
                )

                return ActionExecuteResponse(
                    success=True,
                    action_type=request.action_type,
                    dispute_id=dispute.id,
                    message="Evidence submitted directly to PayPal Sandbox.",
                    audit_event_id=audit_evt.id,
                    environment="paypal_sandbox",
                    details=res
                )

            elif request.action_type == "ACCEPT_CLAIM":
                res = await PayPalClient.execute_accept_claim(
                    external_dispute_id=dispute.external_dispute_id,
                    notes=request.notes
                )
                dispute.status = "RESOLVED"
                dispute.evidence_status = "SETTLED"
                db.commit()

                audit_evt = AuditService.record_event(
                    db=db,
                    dispute_id=dispute.id,
                    actor="investigator_user",
                    action="ACCEPT_CLAIM",
                    status="SUCCESS",
                    source="paypal_sandbox",
                    request_reference=dispute.external_dispute_id,
                    result_summary="Accepted buyer claim in PayPal Sandbox. Refund settlement initiated."
                )

                return ActionExecuteResponse(
                    success=True,
                    action_type=request.action_type,
                    dispute_id=dispute.id,
                    message="Buyer claim accepted in PayPal Sandbox.",
                    audit_event_id=audit_evt.id,
                    environment="paypal_sandbox",
                    details=res
                )
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Action '{request.action_type}' is not currently mapped for direct PayPal Sandbox invocation."
                )
        except Exception as e:
            audit_evt = AuditService.record_event(
                db=db,
                dispute_id=dispute.id,
                actor="investigator_user",
                action=request.action_type,
                status="FAILED",
                source="paypal_sandbox",
                request_reference=dispute.external_dispute_id,
                result_summary=f"PayPal Sandbox action failure: {str(e)}",
                error_code="PAYPAL_API_ERROR"
            )
            return ActionExecuteResponse(
                success=False,
                action_type=request.action_type,
                dispute_id=dispute.id,
                message=f"PayPal Sandbox call failed: {str(e)}",
                audit_event_id=audit_evt.id,
                environment="paypal_sandbox"
            )

    # Case 2: Demo Mode Execution (Deterministic, synthetic simulation)
    now = datetime.utcnow()
    new_evidence_id = f"DEMO-EVID-{dispute.id}-{int(now.timestamp())}"

    if request.action_type == "PROVIDE_EVIDENCE":
        dispute.status = "UNDER_REVIEW"
        dispute.evidence_status = "COMPLETE"

        # Create simulated evidence entity
        ev = Evidence(
            id=new_evidence_id,
            dispute_id=dispute.id,
            evidence_type=request.evidence_type or "PROOF_OF_FULFILLMENT",
            description=request.notes or "Investigator verified tracking and proof of delivery documentation.",
            source_record_id=request.tracking_number,
            source="synthetic",
            submitted_at=now,
            availability_status="AVAILABLE",
            metadata_json=json.dumps({"tracking_number": request.tracking_number, "carrier": request.carrier})
        )
        db.add(ev)
        db.commit()

        audit_evt = AuditService.record_event(
            db=db,
            dispute_id=dispute.id,
            actor="investigator_user",
            action="PROVIDE_EVIDENCE",
            status="SUCCESS",
            source="synthetic",
            request_reference=f"DEMO-SUBMISSION-{dispute.id}",
            result_summary=f"[DEMO MODE] Verified evidence submitted for {dispute.id}. Status transitioned to UNDER_REVIEW."
        )

        return ActionExecuteResponse(
            success=True,
            action_type=request.action_type,
            dispute_id=dispute.id,
            message="Evidence verified and logged in Demo mode. Dispute updated to UNDER_REVIEW.",
            audit_event_id=audit_evt.id,
            environment="demo",
            details={"simulated_evidence_id": new_evidence_id}
        )

    elif request.action_type == "ACCEPT_CLAIM":
        dispute.status = "RESOLVED"
        dispute.evidence_status = "SETTLED"
        db.commit()

        audit_evt = AuditService.record_event(
            db=db,
            dispute_id=dispute.id,
            actor="investigator_user",
            action="ACCEPT_CLAIM",
            status="SUCCESS",
            source="synthetic",
            request_reference=f"DEMO-SETTLE-{dispute.id}",
            result_summary=f"[DEMO MODE] Investigator approved claim settlement. Dispute marked RESOLVED (Settled in buyer favor)."
        )

        return ActionExecuteResponse(
            success=True,
            action_type=request.action_type,
            dispute_id=dispute.id,
            message="Claim accepted in Demo mode. Dispute transitioned to RESOLVED.",
            audit_event_id=audit_evt.id,
            environment="demo",
            details={"new_status": "RESOLVED"}
        )

    elif request.action_type in ["REQUEST_BUYER_INFO", "ESCALATE_TO_PAYPAL"]:
        dispute.status = "UNDER_REVIEW" if request.action_type == "ESCALATE_TO_PAYPAL" else "WAITING_FOR_BUYER_RESPONSE"
        db.commit()

        audit_evt = AuditService.record_event(
            db=db,
            dispute_id=dispute.id,
            actor="investigator_user",
            action=request.action_type,
            status="SUCCESS",
            source="synthetic",
            request_reference=f"DEMO-ACT-{dispute.id}",
            result_summary=f"[DEMO MODE] {request.action_type} dispatched. Updated dispute status to {dispute.status}."
        )

        return ActionExecuteResponse(
            success=True,
            action_type=request.action_type,
            dispute_id=dispute.id,
            message=f"{request.action_type} processed in Demo mode.",
            audit_event_id=audit_evt.id,
            environment="demo"
        )

    raise HTTPException(status_code=400, detail="Unhandled action type.")
