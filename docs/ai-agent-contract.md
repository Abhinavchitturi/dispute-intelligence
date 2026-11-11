# AI reviewer: how it plugs in

The AI reviewer is built separately. This app only provides the hooks it needs. Nothing in this repo makes an AI decision.

## Where it sits

```
Investigator decides  ->  AI reviewer rules  ->  Manager (can overturn anyone, including the AI)
```

1. An investigator submits a decision with a reason. The case moves to `PENDING_AI_REVIEW`. Nobody outside PayPal is told yet.
2. The AI reviewer either **approves** (the investigator's decision stands) or **overturns** (the AI's decision stands and the investigator gets a strike).
3. Either way the case is decided, and the seller and the buyer are told.
4. A manager can later overturn any decision. When they overturn the AI, the correct answer and their reasons are saved as training feedback.
5. An investigator who thinks the AI got a case wrong can flag it. A manager decides, and a correction is saved the same way.

## Authentication

Every call sends `X-AI-Agent-Key: <AI_AGENT_API_KEY>`. If `AI_AGENT_API_KEY` is not set on the server, every call is refused.

## Endpoints

| Call | Purpose |
|------|---------|
| `GET /api/ai-agent/queue` | Cases waiting for a ruling, oldest first, each with everything needed to rule. |
| `GET /api/ai-agent/cases/{dispute_id}` | The same context for one case. |
| `POST /api/ai-agent/cases/{dispute_id}/verdict` | Rule on a case. |
| `GET /api/ai-agent/feedback?only_new=true` | Corrections from managers, for training. Rows returned are marked as pulled. |

### A case, as the AI sees it

```json
{
  "dispute_id": "DEMO-DSP-1042",
  "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "amount": 450.0, "currency": "USD",
  "buyer_claim": "The item never arrived. ...",
  "proposed_outcome": "SELLER_FAVOR",
  "proposed_reason": "The carrier delivered to the confirmed address.",
  "proposed_by": "Abhinav Chitturi",
  "claim_points": [{ "key": "footage", "label": "Camera footage", "quote": "...", "note": "...", "on_file": false }],
  "evidence": { "seller": [ ... ], "buyer": [ ... ], "records": [ ... ] },
  "messages": [ ... ],
  "appeal_of": null
}
```

Each evidence line has `status` (`PROVIDED` or `MISSING`), a `detail` that says why something is missing, and file details for what was sent.

### Ruling on a case

```json
{ "verdict": "APPROVE", "rationale": "The carrier confirmed delivery to the address on the order.", "model": "reviewer-v1" }
```

```json
{ "verdict": "OVERTURN", "outcome": "BUYER_FAVOR", "rationale": "No delivery proof, and the buyer sent footage.", "model": "reviewer-v1" }
```

- `outcome` is required for `OVERTURN` and must be the **opposite** of `proposed_outcome` (`BUYER_FAVOR` or `SELLER_FAVOR`).
- `rationale` is required. It is shown to the investigator and the manager.
- A case can only be ruled on while it is `PENDING_AI_REVIEW`. Anything else returns `400`.

### Training feedback

```json
{
  "review_id": "AIR-...", "dispute_id": "DEMO-DSP-1044",
  "investigator_decision": "SELLER_FAVOR", "ai_verdict": "OVERTURN", "ai_outcome": "BUYER_FAVOR", "ai_rationale": "...",
  "correct_outcome": "SELLER_FAVOR", "correction_note": "The tracking shows delivery to a confirmed address.",
  "corrected_by": "Priya Raman", "source": "MANAGER_REVIEW"
}
```

`source` is `MANAGER_REVIEW` (a manager overturned the AI) or `INVESTIGATOR_FLAG` (an investigator flagged it and a manager agreed).

## Cases the AI Agent owns outright

Every case has a deadline (`CASE_WINDOW_DAYS`, default 5). Its priority score climbs as the deadline nears, so unassigned cases rise to the top of the manager's screen. A case that nobody has taken **by its deadline** is handed to the AI Agent, which then handles the whole case. The manager gets a pinned alert and can give the case to someone at any time (that takes it back from the agent).

| Call | Purpose |
|------|---------|
| `GET /api/ai-agent/owned` | Open cases the agent owns, soonest deadline first, with the same context as a review plus `status`, `response_due_date` and `handed_over_at`. |
| `POST /api/ai-agent/cases/{id}/request-evidence` | Ask the seller or buyer for evidence, as an investigator would. The case then waits for their reply. |
| `POST /api/ai-agent/cases/{id}/decide` | Decide the case. Final: both sides are told and emailed. |

Ask for evidence:

```json
{ "party": "SELLER", "evidence_types": ["PROOF_OF_DELIVERY_SIGNATURE"], "message": "Please send the signed delivery record.", "deadline_days": 3 }
```

Decide:

```json
{ "outcome": "BUYER_FAVOR", "rationale": "No delivery proof, and the buyer sent footage.", "model": "agent-v1" }
```

- These only work on a case the agent owns. Any other case returns `400`.
- `outcome` is `BUYER_FAVOR` or `SELLER_FAVOR`. `rationale` is required.
- There is no investigator in the loop, so there are no strikes. The decision is recorded with `ai_verdict: "DIRECT"`.
- A manager can overturn it. The correction shows up in `GET /api/ai-agent/feedback` with `ai_verdict: "DIRECT"`, so it can be trained on like any other.
- Replies from the seller and buyer arrive through the normal flow. Poll `GET /api/ai-agent/owned` (or the case) to see when everything is in.

## Until the agent is connected

In demo mode, a case waiting for the AI shows two buttons, "AI approves" and "AI overturns", so the rest of the flow can be tried by hand. They call `POST /api/disputes/{id}/ai-verdict/simulate`, which is refused outside demo mode.

## Strikes, alerts and blocking

- Each overturn is one strike for the investigator. A manager overturning the AI back to the investigator's answer removes that strike.
- Every `STRIKE_NOTIFY_THRESHOLD` strikes (default 3), every manager is alerted. The alert is pinned on top of their screen and pings again every `ALERT_REMINDER_MINUTES` (default 60) until they press **Sorted**.
- At `STRIKE_BLOCK_THRESHOLD` strikes (default 10) the account is blocked. A blocked investigator can sign in but cannot open or approve any case until a manager unblocks them, which also clears their strikes.

## Appeals by email

When a decision is made, the seller and the buyer each get an email that lists, by name, the proof both sides sent, and says to email `APPEALS_EMAIL` for further investigation. Point the mail provider's inbound webhook at `POST /api/inbound-mail` (header `X-Inbound-Secret`). An email from the buyer or seller of a decided case, with the case number in the subject, opens a new case (`<case>-A1`) for a different investigator with a manager joined.

## What happens after an OVERTURN
- The AI's decision is final straight away. The investigator gets a strike, and the manager gets an `AI_OVERTURN` alert to read the case and evidence.
- The investigator can question the decision with reasons. The manager then gets a `FLAG` alert ("Conflict raised by …") due in 2 days.
- If the manager agrees with the AI, the strike stays and the investigator gets the reasoning plus a warning. If the manager disagrees, the strike is removed, the investigator is congratulated, and the correction appears in `GET /api/ai-agent/feedback` for training.

## When the buyer never answers
- If PayPal asked the buyer for evidence and the deadline passed with no reply, the case is dismissed. It is not decided for the seller, even if the seller sent strong proof.
- `GET /api/ai-agent/cases/{id}` includes `buyer_silent: true` for such a case. The AI Agent can end it with `POST /api/ai-agent/cases/{id}/decide` and `{"outcome": "DISMISSED", ...}`, which is refused unless the buyer really was silent.
- `POST /api/disputes/{id}/ai-review` answers `ai_decision: "DISMISS_NO_RESPONSE"` for such a case. It returns `AGREES` for a proposed `DISMISSED`, and `DISAGREES` for a buyer's or seller's favor.

## Appeals and strikes
- Only the buyer can appeal a decision. A seller's email to the appeals address is refused, and the seller's decision email does not mention appeals.
- A manager can reset an investigator's strikes at any time with `POST /api/team/{user_id}/reset-strikes`. It also unblocks the account.

## Cases without an owner, and how the AI is trained
- A case nobody takes is never given to the AI Agent. Every new case is assigned at once to the investigator with the fewest open cases.
- When a manager presses **Train the AI** on a reported case, or revises an AI ruling, the correction is stored as a training example. `GET /api/ai-agent/feedback` returns each one once, with the case facts, the evidence (doubtful items marked), the investigator's reasons, the AI's own analysis, the AI's outcome, the correct outcome and the manager's reasons. `GET /api/ai-training` shows the same list to managers without marking anything as pulled.
- The built-in reviewer does learn: each correction is also saved as a lesson (same kind of dispute, same evidence on file, same items not holding up, and the right ruling). New cases that match exactly follow the lesson, and say which case taught it. The real agent can ignore this and train on `/api/ai-agent/feedback` instead.
