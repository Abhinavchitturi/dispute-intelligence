import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from backend.app.config import settings
from backend.app.database import engine, Base, SessionLocal, ensure_columns
from backend.app.models.dispute import Dispute
from backend.app.seed.seed_data import clear_demo_data, ensure_seed_current, has_demo_data

# Import routers
from backend.app.api.routes_disputes import router as disputes_router
from backend.app.api.routes_briefs import router as briefs_router
from backend.app.api.routes_actions import router as actions_router
from backend.app.api.routes_patterns import router as patterns_router
from backend.app.api.routes_audit import router as audit_router
from backend.app.api.routes_integrations import router as integrations_router
from backend.app.api.routes_messages import router as messages_router
from backend.app.api.routes_auth import router as auth_router
from backend.app.api.routes_oversight import router as oversight_router
from backend.app.api.routes_users import router as users_router
from backend.app.api.routes_assignment import router as assignment_router
from backend.app.api.routes_public import router as public_router
from backend.app.services.accounts import ensure_users
from backend.app.services.strike_service import StrikeService
from backend.app.services import ai_reviewer, case_clock, paypal_sync
from backend.app.services.paypal_client import PayPalClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resolveiq")


async def _reminder_loop():
    """Every minute: re-ping managers about unsorted alerts, re-score open cases against the clock, and hand overdue unassigned cases to the AI Agent."""
    while True:
        await asyncio.sleep(60)
        db = SessionLocal()
        try:
            n = StrikeService.remind_due(db)
            if n:
                logger.info("Sent %s manager reminder(s).", n)
            if settings.AI_AUTO_REVIEW:
                ruled = await ai_reviewer.review_pending(db)
                if ruled:
                    logger.info("The AI reviewer ruled on %s decision(s).", ruled)
            moved = case_clock.tick(db)
            if moved["auto_assigned"]:
                logger.info("Assigned %s unassigned case(s) to investigators at random.", moved["auto_assigned"])
        except Exception:  # a failed reminder must not stop the next one
            logger.exception("Reminder check failed")
        finally:
            db.close()

def paypal_polling_enabled() -> bool:
    return settings.RESOLVEIQ_MODE == "sandbox" and settings.PAYPAL_POLL_SECONDS > 0 and PayPalClient.is_configured()


async def poll_paypal_once() -> dict:
    """One pull from PayPal. Only writes an audit event when something new arrived, so the trail isn't flooded every minute."""
    db = SessionLocal()
    try:
        for line in await paypal_sync.push_decisions(db, actor="paypal_poller"):   # decisions made here go to PayPal first
            logger.info("PayPal: %s", line)
        result = await paypal_sync.sync_disputes(db, actor="paypal_poller", record_when_unchanged=False)
        if result["created"] or result["new_messages"] or result["new_evidence"]:
            logger.info("PayPal poll: %s", result["message"])
        return result
    finally:
        db.close()


async def _paypal_poll_loop():
    """In sandbox mode: pick up disputes buyers file in PayPal's Resolution Center without anyone pressing Sync."""
    while True:
        try:
            await poll_paypal_once()
        except paypal_sync.PayPalSyncError as e:  # PayPal down or credentials wrong: log it and try again next time
            logger.warning("PayPal poll failed: %s", e.detail)
        except Exception:
            logger.exception("PayPal poll failed")
        await asyncio.sleep(settings.PAYPAL_POLL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema exists
    Base.metadata.create_all(bind=engine)
    ensure_columns()
    db = SessionLocal()
    try:
        ensure_users(db)
    finally:
        db.close()
    
    # Sandbox mode holds real PayPal cases only: clear out any demo data and never seed it. Demo mode seeds as before.
    db = SessionLocal()
    try:
        if settings.RESOLVEIQ_MODE == "sandbox":
            if has_demo_data(db):
                removed = clear_demo_data(db)
                logger.info("Sandbox mode: removed the demo data (%s).", ", ".join(f"{n} {t}" for t, n in removed.items()))
            logger.info("Sandbox mode: %s PayPal case(s) in the database.", db.query(Dispute).count())
            result = "sandbox"
        else:
            result = ensure_seed_current(db)
        if result == "refreshed":
            logger.info("Demo data predated the PayPal-side model. Re-seeded it once.")
        elif result == "seeded":
            logger.info("Database was empty. Seeded the demo dataset.")
        elif result != "sandbox":
            logger.info(f"Database contains {db.query(Dispute).count()} disputes.")
    finally:
        db.close()

    reminders = asyncio.create_task(_reminder_loop())
    poller = None
    if paypal_polling_enabled():
        logger.info("Polling PayPal sandbox for new disputes every %ss.", settings.PAYPAL_POLL_SECONDS)
        poller = asyncio.create_task(_paypal_poll_loop())
    yield
    reminders.cancel()
    if poller:
        poller.cancel()

app = FastAPI(
    title="ResolveIQ — AI-Powered PayPal Dispute Intelligence",
    description="Enterprise workbench for payment dispute investigations, evidence verification, and PayPal Sandbox workflow orchestration.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Exception Handler
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error processing {request.method} {request.url}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred in the investigation service.", "error_type": exc.__class__.__name__}
    )

# Health Check Route
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": "ResolveIQ",
        "mode": settings.RESOLVEIQ_MODE,
        "database": "connected",
        "version": "1.0.0"
    }

# Mount Routers
app.include_router(disputes_router, prefix="/api")
app.include_router(briefs_router, prefix="/api")
app.include_router(actions_router, prefix="/api")
app.include_router(patterns_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(integrations_router, prefix="/api")
app.include_router(messages_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(oversight_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(assignment_router, prefix="/api")
app.include_router(public_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
