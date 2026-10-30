"""Generates a readable document for a piece of evidence, so an investigator can open it and look.

The demo has no real files. Each document is built from the case's own records (order, shipment, buyer's words) and is
stamped as generated, so nobody mistakes it for a real carrier or merchant record. Videos are never generated.
"""
from html import escape
from typing import Any, Dict, List, Optional, Tuple

from backend.app.models.dispute import Dispute
from backend.app.models.evidence import Evidence
from backend.app.services import evidence_catalog as cat

VIDEO_TYPES = {"BUYER_CAMERA_FOOTAGE"}
IMAGE_TYPES = {"BUYER_PHOTOS_OF_ITEM", "PHOTO_PROOF", "PRODUCT_PHOTO"}


def preview_kind(evidence_type: str, content_type: Optional[str] = None) -> Optional[str]:
    """DOCUMENT or IMAGE when we can show it. None for video, which the demo never generates."""
    if evidence_type in VIDEO_TYPES or (content_type or "").startswith("video"):
        return None
    if evidence_type in IMAGE_TYPES or (content_type or "").startswith("image"):
        return "IMAGE"
    return "DOCUMENT"


def _day(value) -> str:
    return value.strftime("%d %b %Y, %H:%M UTC") if value else "not recorded"


def _rows(pairs: List[Tuple[str, Any]]) -> str:
    return "".join(f"<tr><th>{escape(k)}</th><td>{escape(str(v))}</td></tr>" for k, v in pairs if v not in (None, ""))


def _lines(items: List[str]) -> str:
    return "<ul>" + "".join(f"<li>{escape(i)}</li>" for i in items) + "</ul>"


def _body(ev: Evidence, d: Dispute) -> Tuple[str, str]:
    """(title, inner html) for a document."""
    order, ship = d.order, (d.order.shipment if d.order else None)
    t = ev.evidence_type
    if t == "PROOF_OF_DELIVERY_SIGNATURE":
        return "Proof of delivery", (
            "<table>" + _rows([("Carrier", ship.carrier if ship else None), ("Tracking", ship.tracking_reference if ship else None),
                               ("Delivered", _day(ship.delivered_at) if ship else None), ("Delivered to", ship.shipping_address_masked if ship else None),
                               ("Signed by", "Recipient (signature on file with the carrier)")]) + "</table>"
            "<p class='sig'>Signature captured at delivery</p>")
    if t in ("ADDRESS_VERIFICATION", "GPS_COORDINATES"):
        match = ship.delivery_address_match if ship else "unknown"
        return "Delivery address check", (
            "<table>" + _rows([("Address on the order", ship.shipping_address_masked if ship else None), ("Delivered near", ship.destination_city if ship else None),
                               ("Carrier GPS result", {"yes": "Matches the address on the order", "no": "Does NOT match the address on the order"}.get(match, "Not confirmed"))]) + "</table>")
    if t in ("CARRIER_TRACKING", "RETURN_CARRIER_TRACKING", "DELIVERY_CONFIRMATION"):
        events = []
        if ship and ship.shipped_at:
            events.append(f"{_day(ship.shipped_at)}: Picked up by {ship.carrier or 'the carrier'}")
        if ship and ship.delivered_at:
            events.append(f"{_day(ship.delivered_at)}: {str(ship.status).replace('_', ' ').title()}, {ship.destination_city or 'destination'}")
        return "Carrier scan history", (
            "<table>" + _rows([("Carrier", ship.carrier if ship else None), ("Tracking number", ship.tracking_reference if ship else None),
                               ("Status", ship.status if ship else None)]) + "</table><h3>Scans</h3>" + (_lines(events) if events else "<p>No scans recorded.</p>"))
    if t == "MERCHANT_CORRESPONDENCE":
        return "Messages between seller and buyer", _lines([
            f"Buyer: Hi, can you confirm my order {order.id if order else ''} has shipped?",
            "Seller: Yes, it shipped today. Tracking is on the way.",
            "Buyer: Thanks."])
    if t == "PROOF_OF_FULFILLMENT":
        return "Packing and dispatch record", (
            "<table>" + _rows([("Order", order.id if order else None), ("Item", order.item_summary if order else None),
                               ("Packed", _day(order.order_date) if order else None), ("Dispatched", _day(ship.shipped_at) if ship else None),
                               ("Carrier", ship.carrier if ship else None)]) + "</table>")
    if t == "RETURN_RECEIPT":
        return "Return receiving log", "<table>" + _rows([("Order", order.id if order else None), ("Item", order.item_summary if order else None), ("Result", "Returned item received at the warehouse")]) + "</table>"
    if t in ("BUYER_STATEMENT",):
        return "Buyer's written statement", f"<blockquote>{escape(d.buyer_claim or 'No statement recorded.')}</blockquote>"
    if t == "DELIVERY_ADDRESS_CONFIRMATION":
        return "Buyer's address confirmation", "<table>" + _rows([("Address on the order", ship.shipping_address_masked if ship else None), ("Buyer says", "This is correct and still current")]) + "</table>"
    if t == "BUYER_RETURN_PROOF":
        return "Proof of return", "<table>" + _rows([("Order", order.id if order else None), ("Buyer says", "Sent the item back with the carrier's return label")]) + "</table>"
    if t == "REFUND_RECORD":
        return "Refund record", "<table>" + _rows([("Order", order.id if order else None), ("Amount", f"{d.currency} {d.amount:.2f}"), ("Refund", "No refund on file")]) + "</table>"
    return cat.label(t), f"<p>{escape(ev.description)}</p>"


_STYLE = """
body{font:15px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;color:#1d1d1f;background:#fff;margin:0;padding:32px;line-height:1.5}
h1{font-size:22px;margin:0 0 4px}h3{font-size:14px;margin:20px 0 6px}.ref{color:#6e6e73;font-size:13px;margin-bottom:20px}
table{border-collapse:collapse;width:100%}th{text-align:left;color:#6e6e73;font-weight:500;width:34%;padding:8px 12px 8px 0;vertical-align:top;border-bottom:1px solid #e5e5ea}
td{padding:8px 0;border-bottom:1px solid #e5e5ea}ul{padding-left:20px}blockquote{margin:0;padding:12px 16px;background:#f5f5f7;border-radius:10px}
.sig{margin-top:24px;border-top:1px solid #1d1d1f;width:240px;padding-top:4px;color:#6e6e73;font-size:12px}
.stamp{margin-top:32px;padding:10px 14px;background:#fff4e5;border-radius:10px;color:#8a5200;font-size:12px}
"""


def render_html(ev: Evidence, d: Dispute) -> str:
    title, inner = _body(ev, d)
    return (
        f"<!doctype html><html><head><meta charset='utf-8'><title>{escape(title)}</title><style>{_STYLE}</style></head><body>"
        f"<h1>{escape(title)}</h1><div class='ref'>Case {escape(d.id)} · {escape(ev.id)}</div>{inner}"
        "<div class='stamp'>Generated by the demo from this case's records. It is not a real carrier or merchant document.</div></body></html>"
    )


def render_image_svg(ev: Evidence, d: Dispute) -> str:
    """A labelled placeholder picture. The demo has no real photos, so it says what it stands in for."""
    label = escape(cat.label(ev.evidence_type if ev.evidence_type in cat.BUYER_ITEMS else "BUYER_PHOTOS_OF_ITEM"))
    item = escape((d.order.item_summary if d.order else "the item")[:60])
    return (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 400' width='100%'>"
        "<rect width='640' height='400' fill='#f5f5f7'/><rect x='170' y='90' width='300' height='180' rx='14' fill='#e5e5ea' stroke='#c7c7cc' stroke-width='3'/>"
        "<circle cx='320' cy='170' r='34' fill='none' stroke='#8e8e93' stroke-width='4'/><path d='M255 250l50-45 40 32 35-28 40 41z' fill='#c7c7cc'/>"
        f"<text x='320' y='312' text-anchor='middle' font-family='-apple-system,Helvetica,sans-serif' font-size='20' fill='#1d1d1f'>{label}: {item}</text>"
        "<text x='320' y='342' text-anchor='middle' font-family='-apple-system,Helvetica,sans-serif' font-size='13' fill='#8a5200'>"
        "Generated placeholder. The demo has no real photos.</text></svg>"
    )


def for_evidence(ev: Evidence, d: Dispute) -> Optional[Dict[str, str]]:
    import json
    try:
        ctype = (json.loads(ev.metadata_json) if ev.metadata_json else {}).get("content_type")
    except ValueError:
        ctype = None
    kind = preview_kind(ev.evidence_type, ctype)
    if kind == "IMAGE":
        return {"media_type": "image/svg+xml", "content": render_image_svg(ev, d)}
    if kind == "DOCUMENT":
        return {"media_type": "text/html", "content": render_html(ev, d)}
    return None
