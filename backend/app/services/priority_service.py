from typing import Tuple, List, Optional
from datetime import datetime, timezone
from backend.app.config import settings
from backend.app.schemas.dispute import PriorityFactor

def calculate_priority_score(
    amount: float,
    response_due_date: Optional[datetime] = None,
    evidence_status: str = "PENDING",
    delivery_address_match: str = "unknown",
    shipment_status: Optional[str] = None,
    reason: str = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
) -> Tuple[float, List[PriorityFactor]]:
    """
    Computes a deterministic, explainable priority score between 0.0 and 100.0.
    Factors considered:
    1. Deadline Urgency (0 to 35 points)
    2. Evidence Conflicts & Gaps (0 to 30 points)
    3. Exposure / Disputed Amount (0 to 20 points)
    4. Dispute Category Sensitivity (0 to 15 points)
    """
    score = 0.0
    factors: List[PriorityFactor] = []

    # 1. Deadline Urgency (Max 35 points)
    if response_due_date is not None:
        # Normalize datetime comparison
        now = datetime.utcnow()
        if response_due_date.tzinfo:
            now = datetime.now(timezone.utc)
            
        diff_hours = (response_due_date - now).total_seconds() / 3600.0
        # The score climbs steadily as the deadline closes in: 5 points when the case has just arrived, 35 when the time is up.
        window = max(1.0, settings.CASE_WINDOW_DAYS * 24.0)
        left = max(0.0, min(1.0, diff_hours / window))
        points = round(5.0 + 30.0 * (1.0 - left), 1)
        if diff_hours <= 0:
            explanation = "The deadline has passed. The time to deal with this case is up."
        elif diff_hours <= 24:
            explanation = f"Less than a day left ({diff_hours:.1f} hours) before the deadline."
        else:
            explanation = f"{diff_hours / 24:.1f} days left of the {settings.CASE_WINDOW_DAYS}-day window. The score rises every day it stays open."
    else:
        # Explicit rule from Section 9: Handle missing deadlines as unknown, not overdue!
        points = 8.0
        explanation = "No explicit response deadline in source data; assessed at standard baseline urgency."
    
    score += points
    factors.append(PriorityFactor(
        name="Response Deadline Urgency",
        weight=35.0,
        contribution=points,
        explanation=explanation
    ))

    # 2. Evidence Completeness & Contradictions (Max 30 points)
    evid_points = 0.0
    evid_explanations = []

    if evidence_status == "CONFLICTING":
        evid_points += 22.0
        evid_explanations.append("Active contradiction between buyer assertion and carrier/order records.")
    elif evidence_status == "MISSING":
        evid_points += 18.0
        evid_explanations.append("Key required evidence documents are currently unsubmitted.")
    elif evidence_status == "PARTIAL":
        evid_points += 10.0
        evid_explanations.append("Partial evidence provided; awaiting secondary verification.")
    else:
        evid_points += 3.0
        evid_explanations.append("Standard evidence verification on file.")

    # Check for delivery vs address ambiguity
    if shipment_status == "DELIVERED" and delivery_address_match == "unknown":
        evid_points += 8.0
        evid_explanations.append("Carrier reports delivered but delivery street address confirmation is unverified.")
    elif shipment_status == "DELIVERED" and delivery_address_match == "no":
        evid_points += 10.0
        evid_explanations.append("Geocoded carrier scan indicates delivery at a different location from recipient billing address.")

    evid_points = min(30.0, evid_points)
    score += evid_points
    factors.append(PriorityFactor(
        name="Evidence Integrity & Gaps",
        weight=30.0,
        contribution=evid_points,
        explanation=" ".join(evid_explanations)
    ))

    # 3. Disputed Amount / Financial Exposure (Max 20 points)
    if amount >= 1000.0:
        amt_points = 20.0
        amt_exp = f"High financial exposure (${amount:.2f}): Tier 1 threshold exceeded."
    elif amount >= 500.0:
        amt_points = 15.0
        amt_exp = f"Substantial financial exposure (${amount:.2f}): Tier 2 review recommended."
    elif amount >= 250.0:
        amt_points = 10.0
        amt_exp = f"Moderate financial exposure (${amount:.2f}): Tier 3 standard tier."
    elif amount >= 100.0:
        amt_points = 6.0
        amt_exp = f"Standard financial exposure (${amount:.2f}): Minor claim amount."
    else:
        amt_points = 2.0
        amt_exp = f"Low financial exposure (${amount:.2f}): Below standard review threshold."
    
    score += amt_points
    factors.append(PriorityFactor(
        name="Financial Exposure",
        weight=20.0,
        contribution=amt_points,
        explanation=amt_exp
    ))

    # 4. Dispute Category Sensitivity (Max 15 points)
    if "UNAUTHORISED" in reason.upper():
        cat_points = 14.0
        cat_exp = "Unauthorized transaction claims require immediate security evaluation for potential account compromise."
    elif "NOT_AS_DESCRIBED" in reason.upper():
        cat_points = 10.0
        cat_exp = "Item Not As Described claims require subjective inspection of buyer photos and merchant catalog descriptions."
    elif "NOT_RECEIVED" in reason.upper():
        cat_points = 8.0
        cat_exp = "Item Not Received claims require carrier tracking and proof-of-delivery cross-referencing."
    elif "DUPLICATE" in reason.upper():
        cat_points = 6.0
        cat_exp = "Duplicate billing claims require transaction ledger reconciliation."
    else:
        cat_points = 5.0
        cat_exp = f"Standard dispute reason classification: {reason}."

    score += cat_points
    factors.append(PriorityFactor(
        name="Claim Classification Sensitivity",
        weight=15.0,
        contribution=cat_points,
        explanation=cat_exp
    ))

    normalized_score = max(0.0, min(100.0, round(score, 1)))
    return normalized_score, factors
