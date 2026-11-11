# ResolveIQ: AI dispute investigation for PayPal

ResolveIQ is a workbench for **PayPal's own dispute team**: the investigators who decide who is right when a buyer says "my order never came" or "this isn't what I ordered", and the managers who oversee them.

Today an investigator jumps between the payment, the order, the carrier's tracking and messages from both sides. ResolveIQ puts all of it on one screen, has AI brief every case with each claim traced to its source record, and has a second AI check every decision before it reaches PayPal. It runs on the real **PayPal sandbox** and uses **Gemini** for the AI.

Built for the PayPal AI Hackathon. It's a prototype, not an official PayPal product.

---

## What it does

- **Live PayPal cases.** A buyer reports a problem in PayPal's Resolution Center. The dispute arrives in ResolveIQ within seconds (PayPal webhooks, plus a check every 10 seconds), with the order, the seller's tracking and the buyer's own words and photos.
- **Assigned automatically.** Each new case goes straight to the investigator with the fewest open cases. High-profile cases (USD 1,000 and up) go to the manager.
- **AI brief.** Gemini summarises the case. Every finding links to the record it comes from, and the brief lists what's missing.
- **Evidence from both sides.** The investigator asks the seller and the buyer for evidence; the AI drafts each message from the case records. Replies are simulated for sandbox cases.
- **AI-reviewed decisions.** The investigator decides with a reason, and an AI reviewer checks it against the evidence. If it agrees, the decision goes back to PayPal as PayPal's own ruling, and the buyer's refund lands in their PayPal account. If it overturns the investigator, that counts as a strike.
- **Oversight.** The manager is alerted every 3 strikes, and an account is blocked at 10. An investigator can report an AI ruling they think is wrong; the manager reviews it and can overturn it, which also teaches the AI.
- **A real data table.** The dispute queue is an AG Grid table: sort any column, filter each one, page through results and export to CSV.

## Who uses it

| Role | What they do |
|---|---|
| **Investigator** | Works the cases assigned to them, asks both sides for evidence, and decides. Can share a case with a colleague. |
| **Manager** | Sees every case, handles high-profile ones, overturns any decision (including the AI's), and manages the team: strikes, blocks, users. |
| **AI reviewer** | Checks each decision before it's final: approves it or overturns it. |
| **AI Agent** | Can handle a case from start to finish (see [docs/ai-agent-contract.md](docs/ai-agent-contract.md)). |

Sellers and buyers never sign in. They're reached by email (or, in the sandbox, on PayPal itself).

---

## Quick start (demo mode, no keys needed)

Demo mode runs entirely on your machine, with a ready-made set of sample cases and a built-in rules engine in place of the AI.

**You need:** Python 3.11 or newer, Node.js 18 or newer, and Git.

**1. Get the code**

```bash
git clone https://github.com/Abhinavchitturi/dispute-intelligence.git
cd dispute-intelligence
cp .env.example .env
```

**2. Install the backend** (in a virtual environment)

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

**3. Install the frontend**

```bash
cd frontend
npm install
cd ..
```

**4. Start both** (two terminals, both from the project folder)

```bash
# Terminal 1: backend, http://127.0.0.1:8000
source .venv/bin/activate
python -m uvicorn backend.app.main:app --port 8000 --reload
```

```bash
# Terminal 2: frontend, http://localhost:5173
cd frontend
npm run dev
```

**5. Open http://localhost:5173 and sign in.** The demo accounts are in [credentials.md](credentials.md): a manager (`paypal`) and three investigators. The sample cases are created automatically the first time the backend starts.

> If port 8000 is taken, run the backend on another port (for example `--port 8001`) and start the frontend with `API_TARGET=http://127.0.0.1:8001 npm run dev`.

---

## PayPal sandbox mode (real PayPal, live AI)

**One-time setup:**

1. At [developer.paypal.com](https://developer.paypal.com), create a **sandbox app** linked to a sandbox **business** account, and turn on its **Disputes** feature. Also create a sandbox **personal** (buyer) account, US / USD.
2. Get a Gemini API key at [aistudio.google.com](https://aistudio.google.com).
3. In `.env`, set:

   ```env
   RESOLVEIQ_MODE=sandbox
   PAYPAL_CLIENT_ID=your-sandbox-client-id
   PAYPAL_CLIENT_SECRET=your-sandbox-secret
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your-gemini-key
   ```

4. Restart the backend. In sandbox mode the sample cases are removed: ResolveIQ shows only real PayPal sandbox cases.

**Make a case (any time):**

```bash
./scripts/paypal_sandbox.py --story not-received
```

This pays for a realistic order (Sony headphones, $289), adds the seller's USPS tracking marked "delivered", and prints exactly what to choose, write and upload when you report the problem on PayPal as the buyer. Approve the payment in the browser the first time; after that, the saved buyer is charged directly. The other story is `--story not-as-described`.

**Get cases in seconds:** in another terminal, leave this running:

```bash
./scripts/paypal_webhook.py
```

It opens a temporary public tunnel to your backend and registers it as the sandbox app's PayPal webhook. Without it, new cases still arrive: ResolveIQ checks PayPal every 10 seconds, but PayPal's own list can take a few minutes to include a new case. To skip that wait for one case, copy the case ID PayPal shows the buyer and use **Import case** on the Disputes page.

The full sandbox guide, with troubleshooting, is in [docs/paypal-sandbox-reset-runbook.md](docs/paypal-sandbox-reset-runbook.md).

---

## Settings

All settings live in `.env` (see [.env.example](.env.example)). The ones you're most likely to change:

| Setting | Default | What it does |
|---|---|---|
| `RESOLVEIQ_MODE` | `demo` | `demo` uses sample cases; `sandbox` uses real PayPal sandbox cases only. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | Your PayPal sandbox app's keys. |
| `AI_PROVIDER` | `gemini` | `gemini` for live AI, or `none` for the built-in rules engine. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | empty, `gemini-3.5-flash-lite` | Your Gemini key and model. |
| `PAYPAL_POLL_SECONDS` | `10` | How often to check PayPal for new cases (sandbox mode). |
| `SIMULATE_REPLIES` | `true` | Simulate the seller's and buyer's replies on sandbox cases. |
| `HIGH_PROFILE_AMOUNT` | `1000` | Cases at or above this amount go to the manager. |
| `PAYPAL_HIDDEN_CASES` | empty | PayPal case IDs the automatic sync should skip (for example, old test cases). |
| `SMTP_HOST` | empty | A mail server for real emails. Without it, emails are kept in the app and shown on each case. |

---

## Tests

```bash
# Backend (from the project folder, virtual environment active)
python -m pytest backend/tests -q

# Frontend
cd frontend && npm test
```

The tests run offline on the sample data, whatever your `.env` says: they never call PayPal or Gemini.

---

## Project layout

```
backend/app/       FastAPI app: API routes, services (PayPal sync, AI, decisions, assignment), models
backend/tests/     Backend tests (pytest)
frontend/src/      React app: pages, components (the AG Grid queue is components/DisputeGrid.tsx)
scripts/           paypal_sandbox.py (make a sandbox case) and paypal_webhook.py (instant cases)
docs/              Sandbox guide, AI agent contract, demo assets and video script
credentials.md     Demo sign-in accounts
```

**Built with:** Python, FastAPI, SQLAlchemy, SQLite · React, TypeScript, Vite, Tailwind, TanStack Query, AG Grid · PayPal Disputes, Orders, Payments, Shipment Tracking and Webhooks APIs (sandbox) · Google Gemini.

## License

See [LICENSE](LICENSE).
