"""Picks out what the buyer said that an investigator would otherwise miss, e.g. "I have camera footage".

Rule based on purpose: every point quotes the buyer's own words, so nothing is invented.
"""
import re
from typing import Dict, List, Optional

from backend.app.models.dispute import Dispute
from backend.app.schemas.dispute import ClaimPoint
from backend.app.services import evidence_catalog as cat

# key -> (label, words that trigger it, evidence that would back it up, who has it, note when it is on file, note when it is not)
_RULES: List[Dict] = [
    {
        "key": "footage", "label": "Camera footage", "words": r"camera|footage|video|cctv|doorbell|ring cam",
        "evidence_type": "BUYER_CAMERA_FOOTAGE", "party": cat.BUYER,
        "on": "The buyer mentioned footage and it is on file. Watch the delivery window before deciding.",
        "off": "The buyer mentions footage, but none is on file. Ask the buyer for it before deciding.",
    },
    {
        "key": "photos", "label": "Photos", "words": r"photo|picture|screenshot|image",
        "evidence_type": "BUYER_PHOTOS_OF_ITEM", "party": cat.BUYER,
        "on": "The buyer mentioned photos and they are on file.",
        "off": "The buyer mentions photos, but none are on file. Ask the buyer to send them.",
    },
    {
        "key": "damage", "label": "Damage or defect", "words": r"damag|broken|cracked|defect|inoperable|not working|doesn.t work|water",
        "evidence_type": "BUYER_PHOTOS_OF_ITEM", "party": cat.BUYER,
        "on": "The buyer reports damage and photos of the item are on file.",
        "off": "The buyer reports damage, but there are no photos of the item. Ask the buyer for photos.",
    },
    {
        "key": "tracking", "label": "Tracking or carrier", "words": r"tracking|carrier|ups|fedex|usps|dhl|courier|delivered",
        "evidence_type": "CARRIER_TRACKING", "party": cat.SELLER,
        "on": "The buyer talks about tracking or the carrier. Carrier tracking is on file, so compare it with what they say.",
        "off": "The buyer talks about tracking or the carrier, but no carrier tracking is on file. Ask the seller for it.",
    },
    {
        "key": "return", "label": "Return or refund", "words": r"return|refund|sent it back|sent back",
        "evidence_type": "BUYER_RETURN_PROOF", "party": cat.BUYER,
        "on": "The buyer mentions a return and proof of return is on file.",
        "off": "The buyer mentions a return, but there is no proof of it. Ask the buyer for the receipt or tracking number.",
    },
    {
        "key": "unauthorised", "label": "Did not place the order", "words": r"did not (place|make|authori)|didn.t (place|make|authori)|compromised|unauthori|fraud|hacked",
        "evidence_type": "IP_AND_DEVICE_LOG", "party": None,
        "on": "The buyer says they did not place this order. The IP and device log is on file. Compare it with the buyer's usual details.",
        "off": "The buyer says they did not place this order, and there is no IP or device log on file.",
    },
    {
        "key": "address", "label": "Delivery address", "words": r"wrong address|different address|address",
        "evidence_type": "DELIVERY_ADDRESS_CONFIRMATION", "party": cat.BUYER,
        "on": "The buyer raises the delivery address and a confirmation is on file.",
        "off": "The buyer raises the delivery address. Ask the buyer to confirm the address the order should have gone to.",
    },
]


def _on_file(dispute: Dispute, evidence_type: Optional[str]) -> bool:
    if not evidence_type:
        return False
    names = {evidence_type, *cat.ALIASES.get(evidence_type, [])}
    return any(e.evidence_type in names and e.availability_status == "AVAILABLE" for e in dispute.evidence_items)


def _quote(text: str, match: "re.Match[str]") -> str:
    """The sentence of the claim that triggered the rule."""
    start = max(text.rfind(".", 0, match.start()), text.rfind("!", 0, match.start()), text.rfind("?", 0, match.start())) + 1
    ends = [i for i in (text.find(c, match.end()) for c in ".!?") if i != -1]
    end = min(ends) + 1 if ends else len(text)
    return text[start:end].strip()


def extract(dispute: Dispute) -> List[ClaimPoint]:
    claim = (dispute.buyer_claim or "").strip()
    if not claim:
        return []
    points: List[ClaimPoint] = []
    seen_labels = set()
    for rule in _RULES:
        m = re.search(rule["words"], claim, flags=re.IGNORECASE)
        if not m:
            continue
        have = _on_file(dispute, rule["evidence_type"])
        point = ClaimPoint(
            key=rule["key"], label=rule["label"], quote=_quote(claim, m), note=rule["on"] if have else rule["off"],
            on_file=have, evidence_type=rule["evidence_type"], party=rule["party"],
        )
        if point.label not in seen_labels:
            seen_labels.add(point.label)
            points.append(point)
    return points
