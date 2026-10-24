from typing import List, Set, Dict, Any, Tuple
from backend.app.schemas.brief import Finding, EvidenceGap, Recommendation

class CitationValidator:
    """
    Validates that cited record IDs exist in the case context (dispute, transaction,
    order, shipment, evidence records). Flags any invalid citations or ungrounded claims.
    """

    @staticmethod
    def extract_valid_record_ids(case_context: Dict[str, Any]) -> Set[str]:
        valid_ids: Set[str] = set()

        # Dispute ID
        if case_context.get("dispute_id"):
            valid_ids.add(case_context["dispute_id"])
        
        # Transaction ID
        txn = case_context.get("transaction")
        if txn and txn.get("id"):
            valid_ids.add(txn["id"])
            if txn.get("external_transaction_id"):
                valid_ids.add(txn["external_transaction_id"])
        
        # Order ID
        ord_data = case_context.get("order")
        if ord_data and ord_data.get("id"):
            valid_ids.add(ord_data["id"])
            if ord_data.get("external_order_id"):
                valid_ids.add(ord_data["external_order_id"])

        # Shipment ID & tracking
        ship = case_context.get("shipment")
        if ship and ship.get("id"):
            valid_ids.add(ship["id"])
            if ship.get("tracking_reference"):
                valid_ids.add(ship["tracking_reference"])

        # Evidence IDs
        for evid in case_context.get("evidence_items", []):
            if evid.get("id"):
                valid_ids.add(evid["id"])
            if evid.get("source_record_id"):
                valid_ids.add(evid["source_record_id"])

        return valid_ids

    @classmethod
    def validate_and_sanitize_findings(
        cls,
        findings: List[Finding],
        case_context: Dict[str, Any]
    ) -> Tuple[List[Finding], int, int]:
        """
        Validates findings against valid case record IDs.
        Returns (validated_findings, verified_count, unverified_or_flagged_count).
        """
        valid_ids = cls.extract_valid_record_ids(case_context)
        sanitized_findings: List[Finding] = []
        verified_count = 0
        flagged_count = 0

        for f in findings:
            cited_ids = f.source_record_ids or []
            # Check which cited IDs are actually valid in the case context
            real_citations = [cid for cid in cited_ids if cid in valid_ids]
            invalid_citations = [cid for cid in cited_ids if cid not in valid_ids]

            if f.classification == "fact":
                if not cited_ids:
                    # Rule 4: If a claim lacks supporting records, label it unverified or unknown
                    f.verification_status = "unverified"
                    f.explanation += " [Flagged: Fact stated without source citation]"
                    flagged_count += 1
                elif invalid_citations:
                    # Flag invalid cited records
                    f.verification_status = "unverified"
                    f.source_record_ids = real_citations
                    f.explanation += f" [Warning: Invalid citation references removed: {', '.join(invalid_citations)}]"
                    flagged_count += 1
                else:
                    f.verification_status = "verified"
                    f.source_record_ids = real_citations
                    verified_count += 1
            else:
                # Inferences or unknowns
                f.source_record_ids = real_citations
                if invalid_citations:
                    f.explanation += f" [Unverified citations pruned: {', '.join(invalid_citations)}]"
                f.verification_status = "verified" if real_citations else "unverified"

            sanitized_findings.append(f)

        return sanitized_findings, verified_count, flagged_count
