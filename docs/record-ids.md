# Record IDs

Every piece of data the AI may cite gets a short internal ID. The brief generator may only cite IDs that exist in the case's `records` list. The backend validates this; anything else is shown as "unverified" or dropped.

| Prefix | Record | Example | Source |
|--------|--------|---------|--------|
| DSP | dispute | DSP-1 | PayPal Disputes API |
| ORD | order | ORD-1 | PayPal Orders API |
| TXN | payment / transaction | TXN-1 | PayPal Payments / Reporting |
| TRK | tracking event | TRK-1 | PayPal Shipment Tracking |
| MSG | message | MSG-1 | dispute messages (PayPal) or buyer-seller chat (synthetic) |

Rules
- IDs are `PREFIX-N`, N is a counter **per case**, assigned at ingest. Stable once assigned.
- Each record keeps `external_id` (the real PayPal ID, or null if synthetic) and `synthetic: true|false`. The UI shows a badge for synthetic records.
- A brief claim is `{ "text": "...", "section": "...", "source_ids": ["TRK-1"] }`. Empty or unknown `source_ids` means the claim is not shown as fact.
- Absence is not evidence: "no delivery scan exists" may cite the record that proves the gap only if the checker computes it (e.g. TRK-1 is the latest event and is not a delivery). The LLM never states a gap on its own.
