# PayPal Sandbox Runbook

How to get a fresh PayPal sandbox payment, report a problem with it as the buyer, and see the case appear in ResolveIQ.

Everything except the report is one command. The report is made by hand, on PayPal, the way a real buyer would.

---

## Every time: one command

From the project root (macOS / Linux):

```zsh
.venv/bin/python scripts/paypal_sandbox.py
```

Windows (PowerShell):

```powershell
.venv\Scripts\python scripts\paypal_sandbox.py
```

There's no need to load `.env` into the shell first: the script reads it.

### What happens

```text
✓ Sandbox app keys work, and the app can read disputes.
✓ Order 1XM77996R0088562A created for $74.06 (Sandbox test item).

→ Approve the payment as the sandbox BUYER (personal account). Click Pay; the script continues on its own.
  https://www.sandbox.paypal.com/checkoutnow?token=1XM77996R0088562A

✓ Buyer approved.
✓ Payment captured. Transaction ID: 87A048000C0738526  status: COMPLETED

→ Your turn: report a problem with this payment, as the BUYER, on PayPal.
  https://www.sandbox.paypal.com/myaccount/summary
  Under Recent activity, open the -$74.06 payment at the top (to your sandbox business
  account, e.g. 'Test Store') → Report a problem → fill it in → submit.

… Waiting for the report (up to 30 min, Ctrl-C to stop).
✓ Dispute PP-R-XXX-12345678 opened: MERCHANDISE_OR_SERVICE_NOT_RECEIVED, status WAITING_FOR_SELLER_RESPONSE.
  The app will import it as PAYPAL-PP-R-XXX-12345678 within 60s.
```

1. **Keys check.** It checks the sandbox app's keys, and that the app can read disputes.
2. **Order.** It creates the order and opens PayPal's approval page in your browser.
3. **Approval (one click).** Log in as the sandbox **buyer** (personal account) if asked, and click **Pay**. The script notices by itself and captures the payment. You don't copy any IDs.
4. **Report (manual).** Open https://www.sandbox.paypal.com/myaccount/summary as the buyer. The payment is the top row under **Recent activity**, shown with your business account's name (for example "Test Store"). Open it, choose **Report a problem**, fill it in and submit.
   - Each run uses a random amount (like $74.06) so you can tell it from older payments. If you report a different payment by mistake, the script says so and keeps waiting. That dispute still reaches the app.
5. **Confirmation.** The script waits until PayPal has the dispute and prints it.
6. **ResolveIQ.** With `RESOLVEIQ_MODE=sandbox` in `.env`, the backend pulls new disputes every `PAYPAL_POLL_SECONDS` (default 60), and the case appears in the queue. In demo mode, press **Sync PayPal** on the queue page instead.

PayPal's dispute list can take a few minutes to include a new report, so the poller and the script's "Waiting for the report" step only see it after that. To skip the wait, take the case ID PayPal shows the buyer ("Case ID: PP-R-…") and use **Import case** on the queue page. It reads that one case directly.

A new case always arrives as **New**, whatever PayPal calls it. PayPal shows a fresh inquiry as `UNDER_REVIEW`, which in this app would mean "Ready to decide".

### Skipping the approval click

On the first run the script asks PayPal to save the buyer's PayPal. If PayPal saves it, later runs charge that buyer directly, with no browser at all. This only works when the sandbox app has **Save payment methods** turned on (Developer Dashboard → Apps & Credentials → your app → Features). If it's off, every run asks for the one click, and the script says so.

### New reports in seconds (webhooks)

PayPal's dispute list takes a few minutes to include a new case. To skip that wait, run this in a second terminal and leave it running:

```zsh
./scripts/paypal_webhook.py
```

It opens a temporary public HTTPS tunnel to your backend (localhost.run, over `ssh`, nothing to install). It registers that address as the sandbox app's PayPal webhook and saves `PAYPAL_WEBHOOK_ID` to `.env`. From then on PayPal calls ResolveIQ the moment a buyer reports a problem, and the case appears straight away. ResolveIQ only accepts a webhook after PayPal confirms it sent it. Ctrl-C closes the tunnel and unregisters the webhook.

Without it, ResolveIQ still checks PayPal every 10 seconds (`PAYPAL_POLL_SECONDS`), so a case shows up as soon as PayPal lists it. Decisions also reach PayPal within about 10 seconds.

### A meaningful case for a demo

```zsh
./scripts/paypal_sandbox.py --story not-received       # $289 headphones, USPS says delivered, buyer says it never came
./scripts/paypal_sandbox.py --story not-as-described   # $329 watch sold as sealed, arrives opened and scratched
```

A story pays for a real-looking order (item, SKU, invoice number, shipping address). The seller then adds USPS tracking on PayPal and marks it delivered. At the end, the script prints exactly what to choose, write and attach in PayPal's report form. When the case is imported, ResolveIQ reads that order and tracking back from PayPal, so the case page shows the item, invoice, carrier, tracking number and delivery, all from the sandbox.

### When a case is decided

ResolveIQ sends the final decision to PayPal within a minute, or straight away when you press **Sync PayPal**:

- **PayPal's ruling first.** ResolveIQ is PayPal's own investigation desk, so a decision becomes PayPal's ruling on the case (the sandbox's `adjudicate`). PayPal offers that once a claim is under its review. A buyer's inquiry is escalated to a claim first when PayPal allows it.
- **Buyer's favor, when no ruling is offered:** the buyer is refunded anyway. Either PayPal's own refund is recorded, or the claim is accepted, or the payment is refunded. The buyer sees the refund in their PayPal **Activity**.
- **Seller's favor, when no ruling is offered:** nothing is sent and no money moves, and the case's activity log says why. Press **Sync PayPal** to try again later.

The buyer's Summary page lists payments and can take a while to update. Look under **Activity** for the refund.

For the not-received story, attach `docs/demo/doorbell-camera-front-door.png`, a front-door camera still showing no delivery that afternoon.

### Options

| Command | What it does |
|---|---|
| `scripts/paypal_sandbox.py --amount 120 --item "Wireless headphones"` | A fixed amount and item name (USD), instead of a random amount |
| `scripts/paypal_sandbox.py --story not-received` | A ready-made demo case (see above) |
| `scripts/paypal_sandbox.py --tracking 9400… --carrier UPS --delivered` | Your own tracking number and carrier, marked delivered |
| `scripts/paypal_sandbox.py --no-tracking` | The seller adds no tracking |
| `scripts/paypal_sandbox.py --no-wait` | Stop after the payment, without waiting for the report |
| `scripts/paypal_sandbox.py --no-open` | Print the approval link instead of opening the browser |
| `scripts/paypal_sandbox.py --forget-buyer` | Stop reusing the saved buyer, and approve in the browser again |

The saved buyer is kept in `scripts/.paypal_sandbox_state.json`, which is gitignored.

---

## One time only: setup

PayPal has no API for these steps, so they're done by hand, once.

### 1. Sandbox app (the keys)

1. Sign in at https://developer.paypal.com → **Apps & Credentials** (Sandbox).
2. Create an app linked to your sandbox **business** account. That account is the seller who gets paid and disputed.
3. In the app's features, make sure **Disputes** is on. Optionally turn on **Save payment methods** (see above).
4. Copy the **Client ID** and **Secret** into `.env`:

```env
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
RESOLVEIQ_MODE=sandbox
```

Never use live (production) keys. The script refuses to run against anything but the sandbox.

### 2. Sandbox buyer account

At https://developer.paypal.com/dashboard/accounts → **Create account** → **Personal**, country **United States**, currency **USD**. Keep its email and password: that's who you log in as to approve payments and report problems.

If PayPal says "This seller doesn't accept payments in your currency", the buyer isn't a US/USD account. Orders are made in USD.

---

## If something fails

| Message | Fix |
|---|---|
| `Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env` | Fill in the sandbox app keys (setup step 1). |
| `PayPal refused the sandbox app's keys` | The keys are wrong, or they are live keys. Copy the Sandbox keys again. |
| `The sandbox app can't read disputes` | Turn on the Disputes feature for the app. |
| `Nobody approved the payment within 600s` | Run the script again: each run makes a new order. |
| `No dispute for this payment yet` | PayPal can be slow. Check with `python spike/paypal_spike.py list`, or press Sync PayPal in the app. |
| The case doesn't appear in ResolveIQ | Check `RESOLVEIQ_MODE=sandbox` in `.env` and restart the backend. The log should say `Polling PayPal sandbox for new disputes every 60s.` |

For raw API responses while debugging, `spike/paypal_spike.py` still prints every call in full (`token`, `list`, `show <DISPUTE_ID>`).

The project is for PayPal sandbox testing only. Payments and complaints are made with sandbox accounts.
