import json
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from backend.app.models.brief import HistoricalCase
from backend.app.models.dispute import Dispute
from backend.app.schemas.dispute import HistoricalCaseSchema

class SimilarCasesService:
    """
    Deterministic historical case matching engine based on multi-dimensional
    weighted similarity (dispute reason, evidence profile, financial exposure, keyword overlap).
    """

    @classmethod
    def find_similar_cases(
        cls,
        dispute_id: str,
        db: Session,
        limit: int = 5
    ) -> List[HistoricalCaseSchema]:
        dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
        if not dispute:
            return []

        all_historical = db.query(HistoricalCase).all()
        scored_cases = []

        # Current dispute profile
        curr_reason = dispute.reason
        curr_amount = dispute.amount
        curr_shipment = dispute.order.shipment if (dispute.order and dispute.order.shipment) else None
        curr_tracking_status = curr_shipment.status if curr_shipment else "UNKNOWN"
        curr_addr_match = curr_shipment.delivery_address_match if curr_shipment else "unknown"

        for h in all_historical:
            score = 0.0
            matching_factors: List[str] = []
            evid_attrs: Dict[str, Any] = {}

            if h.evidence_attributes_json:
                try:
                    evid_attrs = json.loads(h.evidence_attributes_json)
                except Exception:
                    evid_attrs = {}

            # 1. Reason matching (Weight: 40%)
            if h.reason == curr_reason:
                score += 40.0
                matching_factors.append(f"Matching dispute reason: {curr_reason}")
            elif ("NOT_RECEIVED" in h.reason and "NOT_RECEIVED" in curr_reason) or \
                 ("NOT_AS_DESCRIBED" in h.reason and "NOT_AS_DESCRIBED" in curr_reason):
                score += 30.0
                matching_factors.append("Similar claim category family")

            # 2. Tracking & Delivery Match (Weight: 30%)
            h_tracking = evid_attrs.get("tracking_status")
            h_addr = evid_attrs.get("address_match")

            if h_tracking and h_tracking == curr_tracking_status:
                score += 15.0
                matching_factors.append(f"Identical shipment state: {curr_tracking_status}")
            
            if h_addr and h_addr == curr_addr_match:
                score += 15.0
                matching_factors.append(f"Matched delivery address verification state: {curr_addr_match}")

            # 3. Financial Amount Proximity (Weight: 20%)
            if h.amount and curr_amount > 0:
                ratio = min(h.amount, curr_amount) / max(h.amount, curr_amount)
                amt_pts = round(ratio * 20.0, 1)
                score += amt_pts
                if ratio > 0.7:
                    matching_factors.append(f"Comparable disputed value (${h.amount:.2f} vs ${curr_amount:.2f})")

            # 4. Keyword / Narrative relevance (Weight: 10%)
            if h.similarity_keywords and dispute.buyer_claim:
                claim_words = set(dispute.buyer_claim.lower().split())
                kw_words = set(h.similarity_keywords.lower().split())
                overlap = claim_words.intersection(kw_words)
                if overlap:
                    score += min(10.0, len(overlap) * 3.0)
                    matching_factors.append(f"Overlapping terminology: {', '.join(list(overlap)[:3])}")

            normalized_score = round(min(100.0, score), 1)

            scored_cases.append({
                "case": h,
                "score": normalized_score,
                "factors": matching_factors,
                "evidence_attributes": evid_attrs
            })

        # Sort descending by score
        scored_cases.sort(key=lambda x: x["score"], reverse=True)
        top_cases = scored_cases[:limit]

        results: List[HistoricalCaseSchema] = []
        for item in top_cases:
            c = item["case"]
            results.append(HistoricalCaseSchema(
                id=c.id,
                source=c.source,
                reason=c.reason,
                case_summary=c.case_summary,
                evidence_attributes=item["evidence_attributes"],
                outcome=c.outcome,
                created_at=c.created_at,
                amount=c.amount,
                currency=c.currency or "USD",
                similarity_score=item["score"],
                matching_factors=item["factors"]
            ))

        return results

    @classmethod
    def search_historical_cases(
        cls,
        db: Session,
        reason: Optional[str] = None,
        outcome: Optional[str] = None,
        search_query: Optional[str] = None,
        limit: int = 20
    ) -> List[HistoricalCaseSchema]:
        query = db.query(HistoricalCase)

        if reason and reason != "ALL":
            query = query.filter(HistoricalCase.reason == reason)
        if outcome and outcome != "ALL":
            query = query.filter(HistoricalCase.outcome == outcome)
        if search_query:
            term = f"%{search_query}%"
            query = query.filter(
                (HistoricalCase.case_summary.ilike(term)) |
                (HistoricalCase.similarity_keywords.ilike(term)) |
                (HistoricalCase.id.ilike(term))
            )

        cases = query.limit(limit).all()
        results: List[HistoricalCaseSchema] = []
        for c in cases:
            evid_attrs = {}
            if c.evidence_attributes_json:
                try:
                    evid_attrs = json.loads(c.evidence_attributes_json)
                except Exception:
                    pass

            results.append(HistoricalCaseSchema(
                id=c.id,
                source=c.source,
                reason=c.reason,
                case_summary=c.case_summary,
                evidence_attributes=evid_attrs,
                outcome=c.outcome,
                created_at=c.created_at,
                amount=c.amount,
                currency=c.currency or "USD",
                similarity_score=None,
                matching_factors=[]
            ))
        return results
