"""Evidence that is on file but doesn't hold up: the footage is from a different day than the delivery, for example.

It never rejects anything. It only marks the item, so an investigator reads it with that in mind, and the buyer is told why it didn't help.
"""
import re
from datetime import datetime
from typing import Optional

from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
import json

DATE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")


def concern_for(dispute: Dispute, ev: Evidence) -> Optional[str]:
    """Why this item is doubtful, in a sentence, or None."""
    try:
        meta = json.loads(ev.metadata_json) if ev.metadata_json else {}
    except ValueError:
        meta = {}
    if meta.get("concern"):
        return str(meta["concern"])
    if ev.evidence_type == "BUYER_CAMERA_FOOTAGE":
        ship = dispute.order.shipment if dispute.order else None
        m = DATE.search(ev.description or "")
        if ship and ship.delivered_at and m:
            try:
                shot = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
            except ValueError:
                return None
            if shot != ship.delivered_at.date():
                return f"The footage is from {shot:%b} {shot.day}, but the carrier delivered on {ship.delivered_at:%b} {ship.delivered_at.day}, so it doesn't cover the delivery."
    return None
