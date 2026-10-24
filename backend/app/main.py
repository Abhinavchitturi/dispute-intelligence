from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging

from backend.app.config import settings
from backend.app.database import engine, Base, SessionLocal
from backend.app.models.dispute import Dispute
from backend.app.seed.seed_data import seed_database

# Import routers
from backend.app.api.routes_disputes import router as disputes_router
from backend.app.api.routes_briefs import router as briefs_router
from backend.app.api.routes_actions import router as actions_router
from backend.app.api.routes_patterns import router as patterns_router
from backend.app.api.routes_audit import router as audit_router
from backend.app.api.routes_integrations import router as integrations_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resolveiq")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema exists
    Base.metadata.create_all(bind=engine)
    
    # Auto-seed if database is empty
    db = SessionLocal()
    try:
        dispute_count = db.query(Dispute).count()
        if dispute_count == 0:
            logger.info("Database is empty. Populating initial synthetic seed dataset...")
            seed_database(db)
        else:
            logger.info(f"Database contains {dispute_count} existing disputes.")
    finally:
        db.close()

    yield

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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
