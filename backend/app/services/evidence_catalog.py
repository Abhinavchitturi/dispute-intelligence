"""What PayPal can ask each side for, and why. The server owns this list so the UI, drafts and simulated replies agree."""
from typing import Any, Dict, List, Optional

SELLER = "SELLER"
BUYER = "BUYER"

# type -> (label, why PayPal asks)
SELLER_ITEMS: Dict[str, Dict[str, str]] = {
    "PROOF_OF_DELIVERY_SIGNATURE": {"label": "Proof of delivery signature", "why": "Shows who received the package."},
    "ADDRESS_VERIFICATION": {"label": "Address verification", "why": "Confirms the carrier delivered to the address on the order."},
    "CARRIER_TRACKING": {"label": "Carrier tracking", "why": "Scan history for the shipment."},
    "MERCHANT_CORRESPONDENCE": {"label": "Messages with the buyer", "why": "Shows what was agreed before the dispute."},
    "PROOF_OF_FULFILLMENT": {"label": "Proof of fulfillment", "why": "Shows the order was shipped as listed."},
    # For cancelled or returned claims, what matters is the return and the refund, not the original delivery.
    "RETURN_RECEIPT": {"label": "Return receipt", "why": "Shows whether the returned item arrived at the seller."},
    "REFUND_RECORD": {"label": "Refund record", "why": "Shows whether a refund was issued, and when."},
}

# Which seller items make sense for a claim type. Anything not listed here gets the delivery-focused default list.
DELIVERY_SELLER_ITEMS = ["PROOF_OF_DELIVERY_SIGNATURE", "ADDRESS_VERIFICATION", "CARRIER_TRACKING", "MERCHANT_CORRESPONDENCE", "PROOF_OF_FULFILLMENT"]
SELLER_ITEMS_BY_REASON: Dict[str, List[str]] = {
    "CANCELLED_OR_RETURNED": ["REFUND_RECORD", "RETURN_RECEIPT", "MERCHANT_CORRESPONDENCE"],
}
# Items that are always worth asking for on that claim type, even if the case doesn't list them as missing.
SELLER_CORE_BY_REASON: Dict[str, List[str]] = {
    "CANCELLED_OR_RETURNED": ["REFUND_RECORD", "RETURN_RECEIPT"],
}
# Recorded evidence that isn't something PayPal asks for, but still needs a readable name.
EXTRA_LABELS: Dict[str, str] = {"RETURN_CARRIER_TRACKING": "Return tracking"}

BUYER_ITEMS: Dict[str, Dict[str, str]] = {
    "BUYER_CAMERA_FOOTAGE": {"label": "Camera footage", "why": "Footage from a porch or doorbell camera during the delivery window, if you have it."},
    "DELIVERY_ADDRESS_CONFIRMATION": {"label": "Delivery address confirmation", "why": "Confirms the address the order was meant to go to."},
    "BUYER_PHOTOS_OF_ITEM": {"label": "Photos of the item", "why": "Shows the condition of what you received."},
    "BUYER_STATEMENT": {"label": "Written statement", "why": "Your account of what happened."},
    "BUYER_RETURN_PROOF": {"label": "Proof of return", "why": "Your return receipt or the carrier tracking number for the package you sent back."},
}

BUYER_ITEMS_BY_REASON: Dict[str, List[str]] = {
    "CANCELLED_OR_RETURNED": ["BUYER_RETURN_PROOF", "BUYER_STATEMENT"],
    "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": ["BUYER_CAMERA_FOOTAGE", "DELIVERY_ADDRESS_CONFIRMATION", "BUYER_STATEMENT"],
    "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": ["BUYER_PHOTOS_OF_ITEM", "BUYER_STATEMENT"],
    "UNAUTHORISED": ["BUYER_STATEMENT", "DELIVERY_ADDRESS_CONFIRMATION"],
}
DEFAULT_BUYER_ITEMS = ["BUYER_STATEMENT"]

# Evidence recorded before this catalog existed under different names.
ALIASES: Dict[str, List[str]] = {"BUYER_PHOTOS_OF_ITEM": ["PHOTO_PROOF", "PRODUCT_PHOTO"]}


def label(evidence_type: str) -> str:
    item = SELLER_ITEMS.get(evidence_type) or BUYER_ITEMS.get(evidence_type)
    if item:
        return item["label"]
    return EXTRA_LABELS.get(evidence_type) or evidence_type.replace("_", " ").capitalize()


def why(evidence_type: str) -> str:
    item = SELLER_ITEMS.get(evidence_type) or BUYER_ITEMS.get(evidence_type)
    return item["why"] if item else ""


def party_of(evidence_type: str) -> Optional[str]:
    if evidence_type in SELLER_ITEMS:
        return SELLER
    if evidence_type in BUYER_ITEMS:
        return BUYER
    return None


def _on_file(context: Dict[str, Any], evidence_type: str) -> Optional[Dict[str, Any]]:
    names = {evidence_type, *ALIASES.get(evidence_type, [])}
    return next((e for e in context.get("evidence_items", []) if e["evidence_type"] in names and e.get("availability_status") == "AVAILABLE"), None)


def options_for(context: Dict[str, Any], party: str) -> List[Dict[str, Any]]:
    """The checklist PayPal sees when asking a party for evidence."""
    reason = context.get("reason", "")
    if party == SELLER:
        types = SELLER_ITEMS_BY_REASON.get(reason, DELIVERY_SELLER_ITEMS)
    else:
        types = BUYER_ITEMS_BY_REASON.get(reason, DEFAULT_BUYER_ITEMS)
    core = SELLER_CORE_BY_REASON.get(reason, [])
    missing_types = {e["evidence_type"] for e in context.get("evidence_items", []) if e.get("availability_status") in ("MISSING", "NOT_REQUESTED")}
    out = []
    for t in types:
        have = _on_file(context, t)
        out.append({
            "evidence_type": t, "label": label(t), "why": why(t),
            "on_file": bool(have), "on_file_description": have["description"] if have else None,
            # Seller: suggest what the case is known to lack. Buyer: suggest whatever we don't yet have.
            "suggested": (not have) and ((t in missing_types or t in core) if party == SELLER else True),
        })
    return out


REASON_LABELS = {
    "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": "item not received",
    "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": "item not as described",
    "UNAUTHORISED": "unauthorized payment",
    "CANCELLED_OR_RETURNED": "cancelled or returned",
    "DUPLICATE_TRANSACTION": "duplicate charge",
}


def reason_label(reason: str) -> str:
    return REASON_LABELS.get(reason, reason.replace("_", " ").lower())
