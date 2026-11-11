import pytest
from datetime import datetime, timedelta
from backend.app.services.priority_service import calculate_priority_score

def test_priority_score_boundaries():
    # Maximum extreme scenario: imminent deadline, high value, conflicting evidence, unauthorized
    score_max, factors_max = calculate_priority_score(
        amount=5000.0,
        response_due_date=datetime.utcnow() + timedelta(hours=4),
        evidence_status="CONFLICTING",
        delivery_address_match="no",
        shipment_status="DELIVERED",
        reason="UNAUTHORISED"
    )
    assert 0.0 <= score_max <= 100.0
    assert score_max >= 80.0
    assert len(factors_max) == 4

    # Minimum extreme scenario: no deadline, tiny amount, complete evidence, low sensitivity
    score_min, factors_min = calculate_priority_score(
        amount=15.0,
        response_due_date=datetime.utcnow() + timedelta(days=30),
        evidence_status="COMPLETE",
        delivery_address_match="yes",
        shipment_status="DELIVERED",
        reason="OTHER"
    )
    assert 0.0 <= score_min <= 100.0
    assert score_min < 30.0

def test_missing_deadline_handled_as_unknown():
    # Prompt rule: Handle missing deadlines as unknown, not overdue!
    score_none_due, factors = calculate_priority_score(
        amount=200.0,
        response_due_date=None,
        evidence_status="PARTIAL",
        delivery_address_match="unknown",
        shipment_status="DELIVERED",
        reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    )
    deadline_factor = next(f for f in factors if f.name == "Response Deadline Urgency")
    assert "No explicit response deadline" in deadline_factor.explanation
    assert deadline_factor.contribution < 20.0  # Should not be assigned overdue 35.0 points

def test_conflicting_evidence_increases_priority():
    score_conflicting, _ = calculate_priority_score(
        amount=450.0,
        response_due_date=datetime.utcnow() + timedelta(hours=48),
        evidence_status="CONFLICTING",
        delivery_address_match="unknown",
        shipment_status="DELIVERED",
        reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    )
    score_complete, _ = calculate_priority_score(
        amount=450.0,
        response_due_date=datetime.utcnow() + timedelta(hours=48),
        evidence_status="COMPLETE",
        delivery_address_match="yes",
        shipment_status="DELIVERED",
        reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    )
    assert score_conflicting > score_complete


def test_handles_string_and_missing_inputs_safely():
    score, factors = calculate_priority_score(
        amount="199.99",
        response_due_date="2026-01-01T12:00:00+00:00",
        evidence_status="partial",
        delivery_address_match="YES",
        shipment_status="delivered",
        reason=None,
    )

    assert 0.0 <= score <= 100.0
    assert any(f.name == "Evidence Integrity & Gaps" for f in factors)
    assert any(f.name == "Claim Classification Sensitivity" for f in factors)


def test_reason_matching_handles_varied_case_and_spacing():
    score, _ = calculate_priority_score(
        amount=250.0,
        response_due_date=None,
        evidence_status="PENDING",
        delivery_address_match="no",
        shipment_status=None,
        reason="  not as described  ",
    )

    assert score >= 30.0
