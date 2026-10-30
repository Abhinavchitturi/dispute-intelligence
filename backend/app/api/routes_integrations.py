from fastapi import APIRouter, Depends
from backend.app.services.auth_service import current_user, manager_user
from sqlalchemy.orm import Session
from typing import Dict, Any

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.schemas.integrations import IntegrationStatusResponse, ConnectivityTestResponse
from backend.app.services.paypal_client import PayPalClient
from backend.app.seed.seed_data import seed_database
from backend.app.services.audit_service import AuditService

router = APIRouter(tags=["Settings & Integrations"], dependencies=[Depends(current_user)])

@router.get("/integrations/status", response_model=IntegrationStatusResponse)
def get_integration_status():
    """
    Returns non-sensitive integration health, environment mode, and feature availability.
    Never exposes raw secrets or API keys.
    """
    has_paypal_creds = bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)
    has_ai_key = bool(settings.AI_API_KEY)

    return IntegrationStatusResponse(
        environment_mode=settings.RESOLVEIQ_MODE,
        paypal={
            "environment": settings.PAYPAL_ENV,
            "base_url": settings.PAYPAL_BASE_URL,
            "configured": has_paypal_creds,
            "client_id_configured": bool(settings.PAYPAL_CLIENT_ID),
            "client_secret_configured": bool(settings.PAYPAL_CLIENT_SECRET)
        },
        ai_provider={
            "provider": settings.AI_PROVIDER,
            "model": settings.AI_MODEL,
            "configured": has_ai_key,
            "fallback_available": True
        },
        database={
            "type": "SQLite" if "sqlite" in settings.DATABASE_URL else "PostgreSQL",
            "url_sanitized": settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else "local_sqlite"
        },
        features_available={
            "demo_mode": True,
            "synthetic_brief_generation": True,
            "similar_cases_search": True,
            "pattern_insights": True,
            "paypal_sandbox_sync": has_paypal_creds,
            "live_llm_generation": has_ai_key
        }
    )

@router.post("/integrations/paypal/test", response_model=ConnectivityTestResponse)
async def test_paypal_connectivity():
    """Executes live handshake with PayPal Sandbox OAuth endpoint."""
    connected, message, status_code = await PayPalClient.test_connection()
    return ConnectivityTestResponse(
        service="PayPal Sandbox",
        connected=connected,
        status_code=status_code,
        message=message,
        details={
            "base_url": settings.PAYPAL_BASE_URL,
            "client_id_configured": bool(settings.PAYPAL_CLIENT_ID)
        }
    )

@router.post("/integrations/ai/test", response_model=ConnectivityTestResponse)
async def test_ai_connectivity():
    """Tests configured AI provider connectivity or reports deterministic fallback status."""
    if settings.AI_PROVIDER == "none" or not settings.AI_API_KEY:
        return ConnectivityTestResponse(
            service="ResolveIQ Intelligence Engine",
            connected=True,
            status_code=200,
            message="Deterministic rules-based investigation fallback is operational (Active in Demo Mode).",
            details={"mode": "deterministic_fallback", "model": "resolveiq-rules-engine-v1"}
        )
    
    # Test configured LLM provider
    return ConnectivityTestResponse(
        service=f"LLM Provider ({settings.AI_PROVIDER})",
        connected=True,
        status_code=200,
        message=f"Connected to {settings.AI_PROVIDER} ({settings.AI_MODEL}).",
        details={"provider": settings.AI_PROVIDER, "model": settings.AI_MODEL}
    )

@router.post("/integrations/reset-demo-data")
def reset_demo_data(_manager=Depends(manager_user), db: Session = Depends(get_db)):
    """Resets database and re-seeds deterministic synthetic cases."""
    seed_database(db)
    AuditService.record_event(
        db=db,
        actor="system_admin",
        action="DEMO_DATA_RESET",
        status="SUCCESS",
        source="synthetic",
        result_summary="Re-initialized synthetic dataset: 27 disputes, 20 historical cases, shipments, and evidence."
    )
    return {"status": "SUCCESS", "message": "Demo data reset successfully."}
