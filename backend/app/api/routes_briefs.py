from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.schemas.brief import InvestigationBriefResponse
from backend.app.services.ai_service import AIService
from backend.app.services.audit_service import AuditService

router = APIRouter(tags=["AI Investigation Briefs"])

@router.post("/disputes/{dispute_id}/brief", response_model=InvestigationBriefResponse)
async def generate_investigation_brief(
    dispute_id: str,
    force_regenerate: bool = Query(default=False),
    db: Session = Depends(get_db)
):
    """
    Generates a structured, evidence-linked AI investigation brief for a dispute.
    Strictly verifies citations against source records.
    """
    try:
        brief = await AIService.generate_brief(
            dispute_id=dispute_id,
            db=db,
            force_regenerate=force_regenerate
        )

        AuditService.record_event(
            db=db,
            dispute_id=dispute_id,
            actor="system_ai_engine",
            action="BRIEF_GENERATED",
            status="SUCCESS",
            source="synthetic",
            request_reference=brief.id,
            result_summary=f"Generated investigation brief ({brief.provider}) with {len(brief.structured_findings)} verified findings and {len(brief.evidence_gaps)} evidence gaps."
        )

        return brief
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate brief: {str(e)}")

@router.get("/disputes/{dispute_id}/brief", response_model=InvestigationBriefResponse)
async def get_investigation_brief(
    dispute_id: str,
    db: Session = Depends(get_db)
):
    """Retrieves existing brief or generates fresh brief if none found."""
    return await AIService.generate_brief(
        dispute_id=dispute_id,
        db=db,
        force_regenerate=False
    )
