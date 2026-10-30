import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from backend.app.config import settings
from backend.app.database import engine, Base, SessionLocal, ensure_columns
from backend.app.models.dispute import Dispute
from backend.app.seed.seed_data import ensure_seed_current

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
from backend.app.services.accounts import ensure_users
from backend.app.services.strike_service import StrikeService
from backend.app.services import case_clock

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
            moved = case_clock.tick(db)
            if moved["handed_to_ai"]:
                logger.info("Handed %s unassigned case(s) to the AI Agent.", moved["handed_to_ai"])
        except Exception:  # a failed reminder must not stop the next one
            logger.exception("Reminder check failed")
        finally:
            db.close()

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
    
    # Auto-seed if database is empty
    db = SessionLocal()
    try:
        result = ensure_seed_current(db)
        if result == "refreshed":
            logger.info("Demo data predated the PayPal-side model. Re-seeded it once.")
        elif result == "seeded":
            logger.info("Database was empty. Seeded the demo dataset.")
        else:
            logger.info(f"Database contains {db.query(Dispute).count()} disputes.")
    finally:
        db.close()

    reminders = asyncio.create_task(_reminder_loop())
    yield
    reminders.cancel()

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
