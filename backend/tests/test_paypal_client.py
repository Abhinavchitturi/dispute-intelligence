import pytest
from backend.app.services.paypal_client import PayPalClient
from backend.app.config import settings

@pytest.mark.asyncio
async def test_paypal_client_unconfigured_error():
    # When credentials are none or empty
    orig_id = settings.PAYPAL_CLIENT_ID
    orig_secret = settings.PAYPAL_CLIENT_SECRET
    try:
        settings.PAYPAL_CLIENT_ID = None
        settings.PAYPAL_CLIENT_SECRET = None
        
        connected, msg, code = await PayPalClient.test_connection()
        assert connected is False
        assert "not configured" in msg
    finally:
        settings.PAYPAL_CLIENT_ID = orig_id
        settings.PAYPAL_CLIENT_SECRET = orig_secret

@pytest.mark.asyncio
async def test_ai_brief_generation_demo_case():
    from backend.app.database import SessionLocal
    from backend.app.services.ai_service import AIService
    from backend.app.models.dispute import Dispute
    from backend.app.seed.seed_data import seed_database

    db = SessionLocal()
    try:
        if not db.query(Dispute).filter(Dispute.id == "DEMO-DSP-1042").first():
            seed_database(db)

        brief = await AIService.generate_brief(
            dispute_id="DEMO-DSP-1042",
            db=db,
            force_regenerate=True
        )
        assert brief.dispute_id == "DEMO-DSP-1042"
        assert len(brief.structured_findings) >= 3
        # Check that findings have valid source citations
        for f in brief.structured_findings:
            if f.verification_status == "verified":
                assert len(f.source_record_ids) > 0
        assert len(brief.evidence_gaps) >= 1
        assert len(brief.recommendations) >= 1
        for r in brief.recommendations:
            assert r.human_review_required is True
    finally:
        db.close()
