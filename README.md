# PayPal Dispute Intelligence

An AI investigation workbench for a PayPal dispute operations team. It is a prototype of an internal tool, built entirely on the PayPal **sandbox** for the PayPal AI Hackathon (Devpost).

> **Status:** early development. Only the Phase 0 sandbox spike, the sample case and the record-ID convention exist today. Everything under "Planned features" is the design, not shipped code. This README is updated as pieces land.

## What it does (planned)

1. **Dispute queue:** open disputes sorted by an explainable priority score (deadline proximity, amount, merchant dispute rate, pattern flags). The UI shows how each factor contributed.
2. **Investigation brief:** for each dispute the AI writes a summary, timeline, evidence checklist and a list of missing evidence.
3. **No invented evidence:** every claim in a brief cites a source record (dispute, order, transaction, tracking event, message). The backend checks every citation. A claim with no valid source is marked "unverified" or removed.
4. **Similar cases and patterns:** shows similar past cases and how they were resolved, and flags cross-seller patterns, such as one buyer filing against many sellers.
5. **Human decides:** the AI recommends. The investigator picks the action and the app runs it through the PayPal API.
6. **Audit log:** every action is recorded.

MVP dispute reasons: *item not received* and *not as described*.

## Real vs. synthetic data

| Data | Source |
|------|--------|
| Disputes, orders, payments, tracking, transactions, all actions | **Real**, from the PayPal sandbox |
| Past resolved cases (similar-case search) | Synthetic, seeded |
| Buyer-seller chat logs, product descriptions | Synthetic, seeded |
| The suspicious multi-seller buyer pattern | Synthetic, seeded |

Synthetic records carry `synthetic: true` and are badged in the UI. Nothing here is real customer data.

## Record IDs

Every citable piece of data has an ID such as `DSP-1`, `ORD-1`, `TXN-1`, `TRK-1`, `MSG-1`. The AI may only cite IDs that exist in the case. See [docs/record-ids.md](docs/record-ids.md). A hand-written example case is in [fixtures/sample_case.json](fixtures/sample_case.json).

## Tech stack

- Backend: Python, FastAPI
- Frontend: React + AG Grid
- Database: Postgres with pgvector (app data, audit log, case embeddings)
- AI: Gemini (generation and embeddings)
- PayPal: Disputes API v1, Orders/Payments, Shipment Tracking, Reporting, Webhooks (sandbox)
- Hosting: Render

## Repository layout

```
spike/                 Phase 0 PayPal sandbox scripts and setup notes
fixtures/              Sample case (and, later, saved sandbox responses)
docs/record-ids.md     Record ID convention
requirements.txt       Python dependencies
.env.example           Required environment variables
```

The backend, frontend and docker-compose setup are not in the repo yet.

## Running what exists today

### Prerequisites
- Python 3.11+ (assumed; not yet tested on other versions)
- A free PayPal developer account with sandbox business and personal accounts

### Setup
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, GEMINI_API_KEY
set -a; source .env; set +a
```

In the PayPal developer dashboard, create a sandbox app linked to the business account and enable the **Disputes** feature.

### Sandbox spike
Follow [spike/README.md](spike/README.md). It walks through getting a token, creating an order, opening a dispute, listing and fetching it, and adding tracking.

```bash
python spike/paypal_spike.py token
```

Some request shapes in the spike script are marked `UNVERIFIED` until they have been run against the sandbox.

## Safety rules

- The AI never executes anything. Actions need an explicit human confirmation.
- Sandbox-only endpoints (`adjudicate`, `require-evidence`) are demo controls, not part of the investigator's real action set.
- `.env` holds secrets and must never be committed.

## Roadmap

| Phase | Dates | Goal |
|-------|-------|------|
| 0 | Oct 24–25 | Setup and sandbox spike |
| 1 | by Nov 1 | End-to-end skeleton |
| 2 | Nov 7 (freeze) | Full features |
| 3 | Nov 8–10 | Polish and deploy |
| 4 | Nov 11–12 | Demo video and submission |

## License

MIT is the intended license. The `LICENSE` file has not been added yet, and the hackathon requires an open-source license in the public repo.
