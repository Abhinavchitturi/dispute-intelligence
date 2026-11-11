from typing import Tuple, List, Optional, Union
from datetime import datetime, timezone
from backend.app.config import settings
from backend.app.schemas.dispute import PriorityFactor


def _coerce_string(value: Optional[Union[str, object]], default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _coerce_datetime(value: Optional[Union[str, datetime]]) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def calculate_priority_score(
    amount: Union[float, int, str, None],
    response_due_date: Optional[Union[datetime, str]] = None,
    evidence_status: Optional[str] = "PENDING",
    delivery_address_match: Optional[str] = "unknown",
    shipment_status: Optional[str] = None,
    reason: Optional[str] = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
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

    numeric_amount = 0.0
    try:
        numeric_amount = float(amount) if amount is not None else 0.0
    except (TypeError, ValueError):
        numeric_amount = 0.0

    normalized_response_due_date = _coerce_datetime(response_due_date)
    normalized_evidence_status = _coerce_string(evidence_status, "PENDING").upper()
    normalized_delivery_address_match = _coerce_string(delivery_address_match, "unknown").lower()
    normalized_shipment_status = _coerce_string(shipment_status, "").upper()
    normalized_reason = _coerce_string(reason, "OTHER").upper().replace("-", "_").replace(" ", "_")

    # 1. Deadline Urgency (Max 35 points)
    if normalized_response_due_date is not None:
        if normalized_response_due_date.tzinfo:
            now = datetime.now(timezone.utc)
            due = normalized_response_due_date.astimezone(timezone.utc)
        else:
            now = datetime.utcnow()
            due = normalized_response_due_date

        diff_hours = (due - now).total_seconds() / 3600.0
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

    if normalized_evidence_status == "CONFLICTING":
        evid_points += 22.0
        evid_explanations.append("Active contradiction between buyer assertion and carrier/order records.")
    elif normalized_evidence_status == "MISSING":
        evid_points += 18.0
        evid_explanations.append("Key required evidence documents are currently unsubmitted.")
    elif normalized_evidence_status == "PARTIAL":
        evid_points += 10.0
        evid_explanations.append("Partial evidence provided; awaiting secondary verification.")
    else:
        evid_points += 3.0
        evid_explanations.append("Standard evidence verification on file.")

    if normalized_shipment_status == "DELIVERED" and normalized_delivery_address_match == "unknown":
        evid_points += 8.0
        evid_explanations.append("Carrier reports delivered but delivery street address confirmation is unverified.")
    elif normalized_shipment_status == "DELIVERED" and normalized_delivery_address_match == "no":
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
    if numeric_amount >= 1000.0:
        amt_points = 20.0
        amt_exp = f"High financial exposure (${numeric_amount:.2f}): Tier 1 threshold exceeded."
    elif numeric_amount >= 500.0:
        amt_points = 15.0
        amt_exp = f"Substantial financial exposure (${numeric_amount:.2f}): Tier 2 review recommended."
    elif numeric_amount >= 250.0:
        amt_points = 10.0
        amt_exp = f"Moderate financial exposure (${numeric_amount:.2f}): Tier 3 standard tier."
    elif numeric_amount >= 100.0:
        amt_points = 6.0
        amt_exp = f"Standard financial exposure (${numeric_amount:.2f}): Minor claim amount."
    else:
        amt_points = 2.0
        amt_exp = f"Low financial exposure (${numeric_amount:.2f}): Below standard review threshold."

    score += amt_points
    factors.append(PriorityFactor(
        name="Financial Exposure",
        weight=20.0,
        contribution=amt_points,
        explanation=amt_exp
    ))

    # 4. Dispute Category Sensitivity (Max 15 points)
    if "UNAUTHOR" in normalized_reason:
        cat_points = 14.0
        cat_exp = "Unauthorized transaction claims require immediate security evaluation for potential account compromise."
    elif "NOT_AS_DESCRIBED" in normalized_reason or "NOT_DESCRIBED" in normalized_reason:
        cat_points = 10.0
        cat_exp = "Item Not As Described claims require subjective inspection of buyer photos and merchant catalog descriptions."
    elif "NOT_RECEIVED" in normalized_reason:
        cat_points = 8.0
        cat_exp = "Item Not Received claims require carrier tracking and proof-of-delivery cross-referencing."
    elif "DUPLICATE" in normalized_reason:
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
