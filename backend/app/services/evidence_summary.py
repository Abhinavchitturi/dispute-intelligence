"""What PayPal has, and what it is missing, laid out per side so an investigator can see it at a glance.

Anything that is not on file is MISSING, and says why: never asked, asked and still no reply, or they said they can't provide it.
"""
import json
from typing import Any, Dict, List, Optional

from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.services import evidence_catalog as cat
from backend.app.services.evidence_documents import VIDEO_TYPES, preview_kind


def _meta(ev: Evidence) -> Dict[str, Any]:
    try:
        return json.loads(ev.metadata_json) if ev.metadata_json else {}
    except ValueError:
        return {}


def _item(evidence_type: str, party: Optional[str], ev: Optional[Evidence], missing_note: str = "") -> Dict[str, Any]:
    if ev is None:
        return {
            "evidence_type": evidence_type, "label": cat.label(evidence_type), "party": party, "status": "MISSING",
            "detail": missing_note, "why": cat.why(evidence_type), "description": None, "evidence_id": None,
            "provided_at": None, "file_name": None, "content_type": None, "size_bytes": None, "duration_seconds": None, "storage": None,
            "preview": None, "is_video": False,
        }
    m = _meta(ev)
    return {
        "evidence_type": evidence_type, "label": cat.label(evidence_type), "party": party, "status": "PROVIDED",
        "detail": "", "why": cat.why(evidence_type), "description": ev.description, "evidence_id": ev.id,
        "provided_at": ev.submitted_at.isoformat() if ev.submitted_at else None,
        "file_name": m.get("file_name"), "content_type": m.get("content_type"), "size_bytes": m.get("size_bytes"),
        "duration_seconds": m.get("duration_seconds"), "storage": m.get("storage"),
        "preview": preview_kind(evidence_type, m.get("content_type")),  # DOCUMENT, IMAGE, or None for video
        "is_video": evidence_type in VIDEO_TYPES or str(m.get("content_type") or "").startswith("video"),
    }


def _available(dispute: Dispute, evidence_type: str) -> Optional[Evidence]:
    names = {evidence_type, *cat.ALIASES.get(evidence_type, [])}
    return next((e for e in dispute.evidence_items if e.evidence_type in names and e.availability_status == "AVAILABLE"), None)


def _why_missing(dispute: Dispute, party: str, evidence_type: str) -> str:
    asked = [m for m in dispute.messages if m.direction == "OUTBOUND" and m.counterparty == party and evidence_type in m.requested_evidence]
    who = "seller" if party == cat.SELLER else "buyer"
    if not asked:
        return f"Not requested yet. Ask the {who} for it."
    if any(evidence_type in m.unavailable_evidence for m in dispute.messages if m.direction == "INBOUND" and m.counterparty == party):
        return f"The {who} said they can't provide it."
    if any(m.awaiting_reply for m in asked):
        return f"Requested. Still waiting for the {who}."
    return f"Requested, but the {who} did not send it."


def build(dispute: Dispute) -> Dict[str, List[Dict[str, Any]]]:
    reason = dispute.reason
    seller_types = cat.SELLER_ITEMS_BY_REASON.get(reason, cat.DELIVERY_SELLER_ITEMS)
    buyer_types = cat.BUYER_ITEMS_BY_REASON.get(reason, cat.DEFAULT_BUYER_ITEMS)

    used: set = set()

    def side(party: str, types: List[str]) -> List[Dict[str, Any]]:
        rows = []
        for t in types:
            ev = _available(dispute, t)
            if ev:
                used.add(ev.id)
            rows.append(_item(t, party, ev, "" if ev else _why_missing(dispute, party, t)))
        return rows

    seller = side(cat.SELLER, seller_types)
    buyer = side(cat.BUYER, buyer_types)

    # Anything else on file: either the buyer or seller sent it, or it is PayPal's own record (logs, GPS, appraisals).
    records: List[Dict[str, Any]] = []
    for ev in dispute.evidence_items:
        if ev.id in used or ev.availability_status != "AVAILABLE":
            continue
        by = _meta(ev).get("provided_by")
        row = _item(ev.evidence_type, by or None, ev)
        (buyer if by == cat.BUYER else seller if by == cat.SELLER else records).append(row)
    # Missing items that the case itself flagged, but that are not on the standard checklist.
    listed = {r["evidence_type"] for r in seller + buyer + records}
    for ev in dispute.evidence_items:
        if ev.availability_status in ("MISSING", "NOT_REQUESTED") and ev.evidence_type not in listed and not _available(dispute, ev.evidence_type):
            party = cat.party_of(ev.evidence_type) or cat.SELLER
            (buyer if party == cat.BUYER else seller).append(_item(ev.evidence_type, party, None, _why_missing(dispute, party, ev.evidence_type)))
            listed.add(ev.evidence_type)
    # Anything that was asked for must show up, even if it isn't on this kind of case's usual checklist.
    for m in dispute.messages:
        if m.direction != "OUTBOUND" or m.counterparty not in (cat.SELLER, cat.BUYER):
            continue
        for t in m.requested_evidence:
            if t not in listed:
                row = _item(t, m.counterparty, _available(dispute, t), "" if _available(dispute, t) else _why_missing(dispute, m.counterparty, t))
                (seller if m.counterparty == cat.SELLER else buyer).append(row)
                listed.add(t)
    return {"seller": seller, "buyer": buyer, "records": records}
