import pytest
from fastapi.testclient import TestClient
from backend.app.main import app
from backend.app.database import SessionLocal
from backend.app.models.dispute import Dispute

client = TestClient(app)

def test_ai_review_validation_errors():
    """Validates that invalid outcomes or missing reasons are rejected."""
    # Invalid outcome
    resp = client.post("/api/disputes/DEMO-DSP-1042/ai-review", json={
        "proposed_outcome": "INVALID_OUTCOME",
        "proposed_reason": "This is a valid test reasoning with enough characters."
    })
    assert resp.status_code == 400

    # Empty reasoning
    resp = client.post("/api/disputes/DEMO-DSP-1042/ai-review", json={
        "proposed_outcome": "BUYER_FAVOR",
        "proposed_reason": "   "
    })
    assert resp.status_code == 400


def test_ai_review_does_not_modify_dispute_state():
    """The AI review is advisory and MUST NOT change or overwrite dispute state."""
    db = SessionLocal()
    try:
        dsp = db.query(Dispute).filter(Dispute.id == "DEMO-DSP-1042").first()
        assert dsp is not None
        initial_status = dsp.status
        initial_outcome = dsp.outcome
        initial_proposed = dsp.proposed_outcome

        resp = client.post("/api/disputes/DEMO-DSP-1042/ai-review", json={
            "proposed_outcome": "BUYER_FAVOR",
            "proposed_reason": "Buyer claims front porch camera shows no carrier delivery."
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "ai_verdict" in data
        assert data["ai_verdict"] in ("AGREES", "DISAGREES", "INCONCLUSIVE")
        assert "ai_decision" in data
        assert data["ai_decision"] in ("FULFILL_BUYER", "FULFILL_SELLER", "INSUFFICIENT_EVIDENCE")
        assert "reasoning" in data
        assert "key_evidence" in data
        assert "supporting_evidence" in data["key_evidence"]
        assert "contradicting_evidence" in data["key_evidence"]
        assert "investigator_comparison" in data
        assert "evidence_gaps" in data
        assert "verdict" in data
        assert data["verdict"] in ("AGREE", "DISAGREE", "INCONCLUSIVE")

        # Re-check database state
        db.refresh(dsp)
        assert dsp.status == initial_status
        assert dsp.outcome == initial_outcome
        assert dsp.proposed_outcome == initial_proposed
    finally:
        db.close()


def test_ai_review_independent_analysis_disagree_on_contradiction():
    """
    Tests that the AI acts as an independent verification agent and disagrees
    when the investigator's decision contradicts verified records.
    """
    db = SessionLocal()
    try:
        # Find or use a dispute where delivery address doesn't match
        dsp = db.query(Dispute).filter(Dispute.id == "DEMO-DSP-1044").first()
        if dsp and dsp.order and dsp.order.shipment:
            dsp.order.shipment.delivery_address_match = "no"
            db.commit()

            resp = client.post(f"/api/disputes/{dsp.id}/ai-review", json={
                "proposed_outcome": "SELLER_FAVOR",
                "proposed_reason": "The seller shipped the goods."
            })
            assert resp.status_code == 200
            data = resp.json()
            # Carrier delivery was to wrong address, so favoring seller must be disagreed with
            assert data["ai_verdict"] == "DISAGREES"
            assert data["ai_decision"] == "FULFILL_BUYER"
            assert data["verdict"] == "DISAGREE"
            assert data["agrees"] is False
            assert len(data["key_evidence"]["supporting_evidence"]) > 0
    finally:
        db.close()


def test_ai_review_inconclusive_when_evidence_is_insufficient():
    """
    Tests that if available records are insufficient (e.g. unknown address match,
    no signature, no camera footage), the AI clearly reports INCONCLUSIVE.
    """
    db = SessionLocal()
    try:
        dsp = db.query(Dispute).filter(Dispute.id == "DEMO-DSP-1042").first()
        if dsp and dsp.order and dsp.order.shipment:
            dsp.order.shipment.delivery_address_match = "unknown"
            dsp.order.shipment.status = "DELIVERED"
            # Ensure no signature and no footage
            for ev in dsp.evidence_items:
                if ev.evidence_type in ("PROOF_OF_DELIVERY_SIGNATURE", "BUYER_CAMERA_FOOTAGE"):
                    ev.availability_status = "MISSING"
            db.commit()

            resp = client.post(f"/api/disputes/{dsp.id}/ai-review", json={
                "proposed_outcome": "SELLER_FAVOR",
                "proposed_reason": "Carrier marked delivered."
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["ai_verdict"] == "INCONCLUSIVE"
            assert data["ai_decision"] == "INSUFFICIENT_EVIDENCE"
            assert data["verdict"] == "INCONCLUSIVE"
            assert data["agrees"] is None
            assert len(data["evidence_gaps"]) > 0
    finally:
        db.close()


def test_existing_decision_submission_still_works():
    """Verifies that submitting decisions via the existing workflow continues to work."""
    resp = client.post("/api/disputes/DEMO-DSP-1042/decision", json={
        "outcome": "BUYER_FAVOR",
        "reason": "Carrier delivery verification was unknown and buyer stated non-receipt.",
        "confirmed": True
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
