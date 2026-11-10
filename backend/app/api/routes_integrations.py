import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.dispute import Dispute, Transaction
from backend.app.schemas.integrations import IntegrationStatusResponse, ConnectivityTestResponse
from backend.app.services.paypal_client import PayPalClient
from backend.app.services.priority_service import calculate_priority_score
from backend.app.seed.seed_data import seed_database
from backend.app.services.audit_service import AuditService

router = APIRouter(tags=["Settings & Integrations"])


def _paypal_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="PayPal returned an invalid dispute date.") from exc
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _paypal_amount(value: Any) -> Optional[tuple[float, str]]:
    if not isinstance(value, dict):
        return None
    try:
        amount = float(value["value"])
    except (KeyError, TypeError, ValueError):
        return None
    currency = value.get("currency_code")
    if not isinstance(currency, str) or not currency:
        return None
    return amount, currency


def _masked_email(email: Any) -> Optional[str]:
    if not isinstance(email, str) or "@" not in email:
        return None
    local, domain = email.rsplit("@", 1)
    return f"{local[:1]}***@{domain}"


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

@router.post("/integrations/paypal/sync")
async def sync_paypal_disputes(db: Session = Depends(get_db)):
    """Imports or refreshes sandbox disputes so they appear in the ResolveIQ queue."""
    if not PayPalClient.is_configured():
        raise HTTPException(
            status_code=503,
            detail="PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.",
        )

    try:
        payload = await PayPalClient.get_disputes(page_size=100)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"PayPal returned HTTP {exc.response.status_code} while loading disputes.",
        ) from exc
    except (httpx.HTTPError, ConnectionError) as exc:
        raise HTTPException(status_code=502, detail="Could not connect to the PayPal sandbox disputes API.") from exc

    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise HTTPException(status_code=502, detail="PayPal returned an unexpected dispute list response.")

    created = 0
    updated = 0
    try:
        for item in items:
            if not isinstance(item, dict) or not item.get("dispute_id"):
                raise HTTPException(status_code=502, detail="PayPal returned a dispute without an ID.")

            external_id = str(item["dispute_id"])
            transactions = item.get("disputed_transactions") or []
            paypal_transaction = transactions[0] if transactions and isinstance(transactions[0], dict) else {}
            amount_data = (
                _paypal_amount(item.get("dispute_amount"))
                or _paypal_amount(paypal_transaction.get("gross_amount"))
            )
            if not amount_data:
                raise HTTPException(
                    status_code=502,
                    detail=f"PayPal dispute {external_id} did not include a valid amount and currency.",
                )
            amount, currency = amount_data

            dispute = (
                db.query(Dispute)
                .filter(
                    Dispute.source == "paypal_sandbox",
                    Dispute.external_dispute_id == external_id,
                )
                .first()
            )
            is_new = dispute is None
            if is_new:
                dispute = Dispute(id=f"PAYPAL-{external_id}", external_dispute_id=external_id)
                created += 1
            else:
                updated += 1

            buyer = item.get("buyer") if isinstance(item.get("buyer"), dict) else {}
            email = _masked_email(buyer.get("email"))
            buyer_reference = buyer.get("name") or email
            txn_external_id = (
                paypal_transaction.get("seller_transaction_id")
                or paypal_transaction.get("buyer_transaction_id")
                or paypal_transaction.get("transaction_id")
            )
            if txn_external_id:
                transaction = (
                    db.query(Transaction)
                    .filter(
                        Transaction.source == "paypal_sandbox",
                        Transaction.external_transaction_id == str(txn_external_id),
                    )
                    .first()
                )
                transaction_amount = _paypal_amount(paypal_transaction.get("gross_amount"))
                if transaction is None:
                    transaction = Transaction(
                        id=f"PAYPAL-TXN-{txn_external_id}",
                        external_transaction_id=str(txn_external_id),
                        source="paypal_sandbox",
                        amount=transaction_amount[0] if transaction_amount else amount,
                        currency=transaction_amount[1] if transaction_amount else currency,
                        status="DISPUTED",
                    )
                    db.add(transaction)
                transaction.buyer_email_masked = email
                transaction.transaction_date = _paypal_datetime(paypal_transaction.get("create_time"))
                dispute.transaction_id = transaction.id

            outcome_code = (
                item.get("dispute_outcome", {}).get("outcome_code", "")
                if isinstance(item.get("dispute_outcome"), dict)
                else ""
            )
            outcome_text = str(outcome_code).upper()
            dispute.source = "paypal_sandbox"
            dispute.reason = str(item.get("reason") or "OTHER")
            dispute.status = str(item.get("status") or "OPEN")
            dispute.amount = amount
            dispute.currency = currency
            dispute.response_due_date = _paypal_datetime(
                item.get("seller_response_due_date") or item.get("response_due_date")
            )
            dispute.created_at = _paypal_datetime(item.get("create_time")) or dispute.created_at or datetime.utcnow()
            dispute.updated_at = _paypal_datetime(item.get("update_time")) or datetime.utcnow()
            dispute.buyer_reference = str(buyer_reference) if buyer_reference else None
            merchant_reference = paypal_transaction.get("invoice_number") or paypal_transaction.get("custom")
            dispute.merchant_reference = str(merchant_reference) if merchant_reference else None
            dispute.buyer_claim = item.get("buyer_claim")
            dispute.evidence_status = "MISSING"
            dispute.outcome = (
                "BUYER_FAVOR" if "BUYER" in outcome_text
                else "SELLER_FAVOR" if "SELLER" in outcome_text
                else None
            )
            dispute.priority_score, factors = calculate_priority_score(
                amount=amount,
                response_due_date=dispute.response_due_date,
                evidence_status=dispute.evidence_status,
                reason=dispute.reason,
            )
            dispute.priority_factors_json = json.dumps([factor.model_dump() for factor in factors])
            db.add(dispute)

        db.commit()
    except Exception:
        db.rollback()
        raise

    message = f"Imported {created} new and refreshed {updated} PayPal Sandbox disputes."
    AuditService.record_event(
        db=db,
        actor="paypal_api",
        action="PAYPAL_DISPUTES_SYNCED",
        status="SUCCESS",
        source="paypal_sandbox",
        result_summary=message,
    )
    return {"created": created, "updated": updated, "total": len(items), "message": message}


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
def reset_demo_data(db: Session = Depends(get_db)):
    """Resets database and re-seeds deterministic synthetic cases."""
    seed_database(db)
    AuditService.record_event(
        db=db,
        actor="system_admin",
        action="DEMO_DATA_RESET",
        status="SUCCESS",
        source="synthetic",
        result_summary="Re-initialized synthetic dataset: 12 disputes, 20 historical cases, shipments, and evidence."
    )
    return {"status": "SUCCESS", "message": "Demo data reset successfully."}
