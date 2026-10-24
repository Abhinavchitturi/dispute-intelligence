from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta

from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence

class PatternService:
    """
    Authorized Dataset Pattern Analyzer.
    Detects clustering in dispute reasons, recurring evidentiary gaps,
    and merchant-level volume patterns using authorized local records.
    """

    @classmethod
    def get_pattern_insights(cls, db: Session) -> List[Dict[str, Any]]:
        patterns: List[Dict[str, Any]] = []

        # 1. Recurring Missing Evidence Categories
        missing_evidence_query = (
            db.query(Evidence.evidence_type, func.count(Evidence.id).label("cnt"))
            .filter(Evidence.availability_status == "MISSING")
            .group_by(Evidence.evidence_type)
            .order_by(func.count(Evidence.id).desc())
            .all()
        )

        for ev_type, count in missing_evidence_query:
            if count >= 2:
                # Find supporting dispute IDs
                sample_evids = (
                    db.query(Evidence.dispute_id)
                    .filter(Evidence.evidence_type == ev_type, Evidence.availability_status == "MISSING")
                    .limit(5)
                    .all()
                )
                dispute_ids = [e[0] for e in sample_evids]
                patterns.append({
                    "pattern_id": f"PAT-EVID-{ev_type.lower()}",
                    "title": f"Recurring Missing Documentation: {ev_type.replace('_', ' ').title()}",
                    "category": "EVIDENTIARY_GAP",
                    "case_count": count,
                    "supporting_record_ids": dispute_ids,
                    "time_window": "Active Portfolio (Last 30 Days)",
                    "why_noteworthy": (
                        f"{count} active disputes lack '{ev_type}'. "
                        "When merchants do not systematically archive this artifact, "
                        "rebuttal eligibility drops significantly under dispute response rules."
                    ),
                    "data_source": "synthetic_seed_dataset",
                    "severity": "HIGH" if count >= 3 else "MEDIUM",
                    "recommended_action": f"Establish automated CRM / carrier webhook ingestion for {ev_type}."
                })

        # 2. Merchant Dispute Reason Concentration
        merchant_reason_query = (
            db.query(Dispute.merchant_reference, Dispute.reason, func.count(Dispute.id).label("cnt"))
            .group_by(Dispute.merchant_reference, Dispute.reason)
            .having(func.count(Dispute.id) >= 2)
            .all()
        )

        for merch, rsn, count in merchant_reason_query:
            sample_dsps = (
                db.query(Dispute.id)
                .filter(Dispute.merchant_reference == merch, Dispute.reason == rsn)
                .all()
            )
            dispute_ids = [d[0] for d in sample_dsps]
            patterns.append({
                "pattern_id": f"PAT-MERCH-{merch.lower()}-{rsn.lower()[:8]}",
                "title": f"Dispute Reason Concentration: {merch} ({rsn})",
                "category": "MERCHANT_CONCENTRATION",
                "case_count": count,
                "supporting_record_ids": dispute_ids,
                "time_window": "Current Ingestion Cycle",
                "why_noteworthy": (
                    f"{count} claims against merchant '{merch}' share identical reason '{rsn}'. "
                    "This pattern warrants fulfillment process review rather than treating each claim in isolation."
                ),
                "data_source": "synthetic_seed_dataset",
                "severity": "MEDIUM",
                "recommended_action": f"Audit {merch} fulfillment and tracking confirmation pipeline for {rsn} root causes."
            })

        # 3. Delivery Scan vs Address Verification Gap
        conflicting_cases = (
            db.query(Dispute.id)
            .filter(Dispute.evidence_status == "CONFLICTING")
            .all()
        )
        if conflicting_cases:
            dsp_ids = [c[0] for c in conflicting_cases]
            patterns.append({
                "pattern_id": "PAT-CARRIER-ADDR-GAP",
                "title": "Tracking Delivered with Street Address Verification Ambiguity",
                "category": "CARRIER_INTEGRITY",
                "case_count": len(dsp_ids),
                "supporting_record_ids": dsp_ids,
                "time_window": "Active Dispute Queue",
                "why_noteworthy": (
                    f"{len(dsp_ids)} disputes exhibit carrier 'DELIVERED' status with ambiguous "
                    "or unknown destination street address matches. Investigators must differentiate between porch theft "
                    "and carrier scan misdelivery."
                ),
                "data_source": "synthetic_seed_dataset",
                "severity": "HIGH",
                "recommended_action": "Require GPS geocoordinates or signature confirmation for disputed deliveries above $250."
            })

        return patterns
