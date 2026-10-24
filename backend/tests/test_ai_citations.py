import pytest
from backend.app.schemas.brief import Finding
from backend.app.services.citation_validator import CitationValidator

def test_citation_validator_valid_and_invalid():
    case_context = {
        "dispute_id": "DEMO-DSP-1042",
        "transaction": {"id": "DEMO-TXN-1042", "external_transaction_id": "TXN-987"},
        "order": {"id": "DEMO-ORD-1042"},
        "shipment": {"id": "DEMO-SHIP-1042", "tracking_reference": "1Z99999"},
        "evidence_items": [
            {"id": "DEMO-EVID-1042-01", "source_record_id": "DEMO-SHIP-1042"}
        ]
    }

    findings = [
        Finding(
            finding_id="F-1",
            claim="Dispute initiated for USD 450",
            classification="fact",
            source_record_ids=["DEMO-DSP-1042"],
            explanation="Header fact"
        ),
        Finding(
            finding_id="F-2",
            claim="Carrier tracking states delivered",
            classification="fact",
            source_record_ids=["DEMO-SHIP-1042", "INVALID-RECORD-999"],
            explanation="Shipment fact"
        ),
        Finding(
            finding_id="F-3",
            claim="Customer was rude during chat",
            classification="fact",
            source_record_ids=[],  # Missing citation
            explanation="Ungrounded statement"
        )
    ]

    sanitized, verified_cnt, flagged_cnt = CitationValidator.validate_and_sanitize_findings(
        findings, case_context
    )

    assert verified_cnt == 1  # F-1 is fully verified
    assert flagged_cnt == 2   # F-2 (has invalid id pruned) and F-3 (missing citation)

    # Check F-1
    assert sanitized[0].verification_status == "verified"
    assert sanitized[0].source_record_ids == ["DEMO-DSP-1042"]

    # Check F-2 has invalid ID removed
    assert sanitized[1].verification_status == "unverified"
    assert "INVALID-RECORD-999" not in sanitized[1].source_record_ids
    assert "DEMO-SHIP-1042" in sanitized[1].source_record_ids
    assert "Invalid citation references removed" in sanitized[1].explanation

    # Check F-3 flagged as unverified
    assert sanitized[2].verification_status == "unverified"
    assert "Flagged: Fact stated without source citation" in sanitized[2].explanation
