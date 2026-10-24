# ResolveIQ — AI-Powered PayPal Dispute Intelligence

> **"Every claim. Every source. One clearer investigation."**

ResolveIQ is an enterprise-grade AI-assisted dispute investigation workbench engineered to help payment risk analysts, operations investigators, and merchant dispute teams resolve payment disputes faster, with verifiable evidentiary integrity.

Instead of navigating fragmented carrier tracking portals, billing ledgers, customer correspondence threads, and PayPal interfaces, ResolveIQ aggregates available transaction facts into a unified workbench, computes explainable 0–100 risk priority scores, generates structured evidence-linked AI briefs, detects systemic anomaly patterns, and enables human-supervised action dispatching to the PayPal Sandbox REST API.

---

## 1. The Problem ResolveIQ Addresses

- **Evidence Fragmentation:** Investigators lose 15–30 minutes per dispute reconciling detached data points across carrier scans, order systems, customer messages, and payment records.
- **Hallucination & Bias Risk:** Generic generative AI solutions invent timestamps, make unfounded assumptions about buyer/seller integrity, and hallucinate delivery confirmations without audit trails.
- **Default Settlement Penalties:** Inflexible response deadlines mean merchants default and lose disputes simply because missing documentation was not surfaced in time.
- **Black-box Decisioning:** Opaque automated decision engines create regulatory exposure and lack explainable reasoning for human analysts.

### How ResolveIQ Solves This
- **Evidence-Linked AI Briefs:** Every factual finding in an AI brief cites exact source record IDs (`DEMO-DSP-1042`, `DEMO-SHIP-1042`, etc.). Clicking any citation immediately scrolls and highlights the source evidence record.
- **Strict Human-in-the-Loop Safeguards:** AI acts solely as an analytical assistant, never an autonomous judge. Consequential actions require explicit two-step investigator confirmation before sending API requests.
- **Explainable Priority Scoring:** A deterministic 0–100 scoring model breaks down deadline urgency, evidence gaps, contradictory records, and financial exposure with human-readable factor contributions.
- **Dual Operational Modes:** Works completely out of the box in **Demo Mode** using a deterministic synthetic dataset and an offline rules-based intelligence fallback, while supporting live **PayPal Sandbox Mode** for real OAuth 2.0 dispute orchestration.

---

## 2. Architecture Overview

```mermaid
flowchart TD
    subgraph Frontend["Frontend Client (React 18 + TypeScript + Vite + Tailwind CSS)"]
        UI[Enterprise Fintech App Shell]
        Dash[Overview Analytics Dashboard]
        Queue[Prioritized Dispute Queue]
        Investigate[Investigation Workbench]
        BriefView[AI Brief & Citation Linker]
        ActionPanel[Investigator Action Panel & 2-Step Confirmation]
        SimilarView[Historical Precedent Explorer]
        PatternView[Authorized Pattern Insights]
        AuditView[Compliance Audit Trail]
        SettingsView[Settings & Connectivity Tester]
    end

    subgraph Backend["Backend Services (FastAPI + Python 3.12)"]
        API[FastAPI REST API Endpoints]
        PrioritySvc[Explainable Priority Scoring Engine]
        AISvc[Provider-Agnostic Intelligence Service]
        CitationVal[Citation Validator & Evidence Grounding]
        SimSvc[Weighted Historical Case Matcher]
        PatternSvc[Authorized Anomaly & Cluster Analyzer]
        AuditSvc[Sanitized Event Audit Trail Engine]
        PayPalClient[PayPal Sandbox REST Client (OAuth 2.0)]
    end

    subgraph Storage["Persistence Layer (SQLAlchemy 2.0)"]
        DB[(Relational DB: Disputes, Transactions, Orders, Shipments, Evidence, Briefs, HistoricalCases, AuditEvents)]
    end

    subgraph External["External Integrations"]
        PayPalAPI["PayPal Sandbox REST API (api-m.sandbox.paypal.com)"]
        LLMAPI["External LLM Provider (Google Gemini / OpenAI / Anthropic)"]
    end

    UI --> API
    API --> PrioritySvc
    API --> AISvc
    AISvc --> CitationVal
    AISvc -.-> LLMAPI
    API --> SimSvc
    API --> PatternSvc
    API --> AuditSvc
    API --> PayPalClient
    PayPalClient -.-> PayPalAPI
    API --> DB
```

---

## 3. Technology Stack

- **Frontend:**
  - React 18 with TypeScript
  - Vite build tool & development server
  - Tailwind CSS with a custom fintech theme (`#070D1E`, `#0B132B`, `#161F38`, `#233054`)
  - Lucide React iconography
  - Recharts for portfolio analytics and priority distributions
  - React Router DOM (v6) for multi-view routing
  - TanStack React Query (v5) for server state management & caching
  - Vitest + Happy-DOM + React Testing Library for frontend component testing

- **Backend:**
  - Python 3.12+ with FastAPI
  - Pydantic v2 & Pydantic-Settings for strict request/response data contracts
  - SQLAlchemy 2.0 ORM with SQLite local fallback (or PostgreSQL in production)
  - HTTPX for asynchronous external REST communications
  - Pytest & Pytest-Asyncio for backend integration & unit test suites

---

## 4. Local Setup Guide

### Prerequisites
- Python 3.11 or newer (Python 3.12 recommended)
- Node.js 18 or 20+ with npm (or pnpm)
- Git

### Step 1: Clone and Configure Environment
```bash
git clone <repository-url>
cd resolveiq

# Copy environment configuration
cp .env.example .env
```

### Step 2: Install Backend Dependencies & Seed Database
```bash
# Install backend requirements
python -m pip install -r backend/requirements.txt

# Populate initial synthetic dataset (12 disputes, 20 historical precedents)
python -m backend.app.seed.seed_data
```

### Step 3: Install Frontend Dependencies
```bash
cd frontend
npm install
cd ..
```

### Step 4: Run Application
Open two terminal windows:

**Terminal 1 — Backend API Server (Port 8000):**
```bash
# Windows PowerShell
$env:PYTHONPATH="."
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload

# Linux / macOS
PYTHONPATH=. uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```
FastAPI Interactive OpenAPI Docs will be available at: `http://127.0.0.1:8000/docs`

**Terminal 2 — Frontend Dev Server (Port 5173):**
```bash
cd frontend
npm run dev
```
Open your browser at `http://localhost:5173`.

---

## 5. Environment Variables & Modes

Configuration is managed via `.env` (sanitized example in `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `RESOLVEIQ_MODE` | `demo` | `"demo"` (offline synthetic dataset) or `"sandbox"` (live PayPal Sandbox API). |
| `DATABASE_URL` | `sqlite:///./resolveiq.db` | SQLAlchemy connection string (SQLite local, PostgreSQL supported). |
| `PAYPAL_ENV` | `sandbox` | Target PayPal environment (`sandbox` or `production`). |
| `PAYPAL_CLIENT_ID` | `""` | PayPal Sandbox App Client ID (Required for Sandbox Mode). |
| `PAYPAL_CLIENT_SECRET` | `""` | PayPal Sandbox App Client Secret (Server-side only). |
| `AI_PROVIDER` | `none` | `"none"` (deterministic rules engine), `"gemini"`, or `"openai"`. |
| `AI_API_KEY` | `""` | API key for external LLM provider. |
| `AI_MODEL` | `gemini-1.5-pro` | Model name when an external AI provider is configured. |

---

## 6. How to Run Demo Mode vs PayPal Sandbox Mode

### A. Running in Demo Mode (Zero Credentials Required)
1. Ensure `RESOLVEIQ_MODE=demo` in `.env`.
2. Leave `PAYPAL_CLIENT_ID` and `AI_API_KEY` blank.
3. Boot the application.
4. ResolveIQ will utilize the 12 synthetic seeded disputes and 20 historical cases.
5. AI Briefs are produced via the deterministic rules engine following strict evidence-grounding constraints.
6. Actions (e.g., submitting tracking or accepting claims) execute in a verified local simulation, updating dispute state and persisting entries to the Compliance Audit Trail without calling external endpoints.

### B. Configuring PayPal Sandbox Mode
1. Register or log in to [PayPal Developer Portal](https://developer.paypal.com).
2. Create a REST API app under **Dashboard > My Apps & Credentials > Sandbox**.
3. Copy the Client ID and Secret into your `.env`:
   ```bash
   RESOLVEIQ_MODE=sandbox
   PAYPAL_CLIENT_ID=your_sandbox_client_id
   PAYPAL_CLIENT_SECRET=your_sandbox_secret
   ```
4. Restart the backend.
5. In ResolveIQ, navigate to **Settings & Integrations** and click **Test PayPal Sandbox Connection**.
6. When investigating sandbox-originated disputes, approved actions will be dispatched directly to PayPal's REST endpoints (`/v1/customer/disputes/{id}/provide-evidence` and `/accept-claim`).

---

## 7. How to Run the Automated Test Suites

### Backend Tests (Pytest)
Exercises priority scoring boundaries, citation validation, dispute filtering, action confirmation checks, secret redaction, and full E2E investigation workflow:
```bash
# Windows PowerShell
$env:PYTHONPATH="."
python -m pytest backend/tests -v

# Linux / macOS
PYTHONPATH=. pytest backend/tests -v
```
*(Result: 16 passed tests in ~6 seconds)*

### Frontend Tests (Vitest + Testing Library)
Exercises priority score thresholds, badge rendering, evidence completeness indicators, and environment labels:
```bash
cd frontend
npm test
```
*(Result: 6 passed tests in ~5 seconds)*

---

## 8. Real Capabilities vs Synthetic Data

| Feature | Real Implementation | Synthetic / Demo Data Boundary |
|---|---|---|
| **Priority Scoring** | **100% Real:** Deterministic 4-factor scoring engine with explainable weights. | Operates on seeded or sandbox fields. |
| **Evidence Grounding** | **100% Real:** Citation validator verifies cited record IDs in bounded case context. | Operates on seeded or sandbox records. |
| **Investigation Briefs** | **100% Real:** Rules-based fallback or real Gemini LLM API when configured. | Factual details derived from bounded case records. |
| **Historical Matching** | **100% Real:** Multi-attribute weighted similarity search algorithm. | 20 seeded precedents with outcome labels. |
| **Pattern Insights** | **100% Real:** SQL cluster analysis across reasons, missing evidence, and address gaps. | Aggregates authorized local dispute records. |
| **PayPal Sandbox Client**| **100% Real:** OAuth 2.0 token caching and authenticated REST calls. | Used when valid Sandbox credentials are provided. |
| **Customer Identifiers**| Masked / Fictional | All names (e.g. Alex Morgan, TechStore) are visibly synthetic. |

---

## 9. Demo Walkthrough: Investigating Main Demo Case `DEMO-DSP-1042`

1. **Open Overview Dashboard:**
   - Notice the aggregate metrics (12 open cases, approaching deadlines, evidence gaps, volume chart).
   - Click the top banner button: **Open Main Demo Case (Alex Morgan #1042)**.
2. **Review Case Header & Transaction Context:**
   - Case ID: `DEMO-DSP-1042`
   - Disputed Amount: `USD 450.00`
   - Reason: `Item Not Received`
   - Buyer Statement: *"The item never arrived. Front porch camera shows no carrier delivery at stated time."*
   - Carrier: `UPS` (`1Z9999999999999999`), Status: `DELIVERED`, Address Verification: `unknown`.
3. **Inspect AI Investigation Brief:**
   - Observe that the AI reports carrier tracking indicates delivery while address verification and merchant correspondence remain unavailable.
   - Notice that the AI **does not** conclude either party is dishonest and **does not** automatically decide who wins.
   - Click on the source citation `DEMO-SHIP-1042` under Finding 4: The workbench automatically switches to the **Source Evidence** tab and highlights the shipment record.
4. **Inspect Missing Evidence & Inconsistencies:**
   - The brief flags `PROOF_OF_DELIVERY_SIGNATURE` and `ADDRESS_VERIFICATION` as missing documents.
5. **Inspect Similar Historical Precedents:**
   - Click the **Similar Cases** tab to view matching historical cases (e.g., `HIST-CASE-203` with 80% match, where tracking was delivered but address verification was unknown).
6. **Execute Investigator Action:**
   - In the right-hand **Investigator Action Panel**, select *Provide Rebuttal Evidence*.
   - Click **Review & Confirm Action**: A modal opens displaying pre-flight impact, affected environment (`demo`), and required human authorization.
   - Click **Confirm & Execute Action**.
   - The dispute transitions to `UNDER_REVIEW`, an evidence record is logged, and an immutable audit event is persisted.
7. **Verify Compliance Audit Trail:**
   - Navigate to the **Audit Trail** page to observe the full audit log with timestamp, actor (`investigator_user`), sanitized parameters, and success outcome.

---

## 10. Security & Privacy Safeguards

- **No Secret Leakage:** Client secrets, bearer tokens, and API keys are stored exclusively in backend server environments and are systematically redacted from audit logs (`[REDACTED]`).
- **Prompt Injection Defense:** Customer messages and dispute remarks are strictly bounded within structured JSON contexts; system prompt instructions forbid treating user messages as AI operational instructions.
- **Human Approval Mandatory:** No automated closing, refunding, or evidence rebuttal can execute without active human confirmation.
- **Safe Development Environment:** Local SQLite fallback with check_same_thread safe pooling, parameterized queries via SQLAlchemy ORM, and comprehensive CORS whitelisting.

---

## 11. Hackathon Pitch Summary

Payment dispute investigation is one of the highest-friction bottlenecks in modern fintech operations. Today's analysts spend up to 70% of their time copy-pasting tracking numbers, cross-referencing order records, and reading lengthy customer threads.

**ResolveIQ** transforms dispute management with an intelligent, evidence-grounded workbench that:
1. Surfaces what matters instantly with explainable 0–100 risk priority scoring.
2. Synthesizes complex claims into verified, citation-backed investigation briefs.
3. Automatically identifies missing documentation before response windows expire.
4. Keeps the human analyst firmly in control with one-click sandbox action orchestration.

*"Every claim. Every source. One clearer investigation."*
