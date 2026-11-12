# ResolveIQ demo video: 3-minute script

Narration is written for about 150 words a minute, so each section fits its time slot when read at a normal pace.

## Before you record

1. Backend in sandbox mode with Gemini on (`RESOLVEIQ_MODE=sandbox`, `AI_PROVIDER=gemini`), frontend running.
2. Second terminal: `./scripts/paypal_webhook.py` running, so new reports arrive in seconds.
3. Two cases:
   - **Case A, the headphones** (`./scripts/paypal_sandbox.py --story not-received`). Filmed live in section 2 and decided in section 3.
   - **Case B, the Apple Watch** (`./scripts/paypal_sandbox.py --story not-as-described`). Report it beforehand and let it import. It's for the strike in section 4.
   - Cases are assigned automatically to whoever has the fewest open cases. Check the **Owner** column, and record each case signed in as its owner.
4. Browser tabs ready: PayPal sandbox signed in as the **buyer**, ResolveIQ signed in as the cases' **investigator** (see the Owner column), and a private window signed in as **PayPal** (manager).
5. Have both photos ready to upload: `docs/demo/doorbell-camera-front-door.png` (Case A) and `docs/demo/watch-as-received.png` (Case B).

---

## 0:00–0:40 · The problem, the solution, who it's for

**On screen:** ResolveIQ Overview page, then the Disputes queue.

> Every day, PayPal's dispute team decides who's right when a buyer says "my order never came". An investigator jumps between the payment, the order, the carrier's tracking and messages from both sides. It's slow, decisions vary, and nothing checks a decision before money moves.
>
> ResolveIQ is a workbench for PayPal's own dispute investigators and their managers. It brings every record for a case onto one screen, uses AI to brief the investigator with each claim traced to its source, and has a second AI review every decision before it reaches PayPal. It runs on the real PayPal sandbox.

## 0:40–1:10 · A real transaction and report in the PayPal sandbox

**On screen:** terminal, then PayPal as the buyer, then ResolveIQ.

1. Run `./scripts/paypal_sandbox.py --story not-received`.
2. PayPal buyer → **Activity** → the **-$289.00 Test Store** payment → **Report a problem** → *I haven't received the item or service* → *The item hasn't reached me…* → paste the statement → upload the doorbell photo → submit.
3. Switch to ResolveIQ: the case appears in the queue.

> This is a real sandbox purchase: Sony headphones for $289, paid through PayPal's Orders API. The seller added USPS tracking marked "delivered". Now, as the buyer, I report that it never arrived, and attach my doorbell camera. PayPal opens a dispute, and its webhook pushes it straight into ResolveIQ: here it is, seconds later.

## 1:10–2:10 · The case in ResolveIQ, start to finish

**On screen (as the case's investigator):** open Case A from the queue.

1. **Header and evidence tab:** amount, deadline, priority. Order, Shipment (USPS, Delivered) and Payment, all read from PayPal.
2. **AI brief:** findings with record IDs, and the conflict: carrier says delivered, buyer's camera says no.
3. **Take action → Ask the seller** (the AI drafts the message), then **Ask the buyer**. Show both replies arriving in Messages.
4. **Decide in the buyer's favor**, with a reason. Show the AI reviewer approving it.
5. Switch to the PayPal buyer tab → **Activity**: the **+$289.00 refund**.

> The case was assigned to me automatically, and it opens with everything in one place: the order, the shipment, the payment, all pulled from PayPal's APIs. Gemini writes the brief, and every finding links back to the record it comes from. It spots the conflict straight away: USPS says delivered, but the buyer's camera shows nothing at the door.
>
> I ask both sides for evidence. The AI drafts each message from the case's own records, and I can edit it before sending. The replies come in, and every request is answered, so it's time to decide. I rule for the buyer. Before anything is final, the AI reviewer checks my decision against the evidence. It agrees, so ResolveIQ sends the ruling to PayPal. And on the buyer's side, the $289 refund has landed.

## 2:10–2:50 · An investigator gets a strike

**On screen:** the Disputes queue (AG Grid), then Case B as its investigator, then the manager window.

1. **Queue:** sort by **Amount**, type "watch" in the **Case** filter (or "described"), then open Case B, the $349 Apple Watch.
2. Decide Case B in the **seller's favor**, giving the reason "Tracking shows it was delivered".
3. The AI reviewer **overturns** it: the buyer's photos show an opened box, a scratched screen and the wrong band. Show "This counted as a strike".
4. Click **Report this** and write why you disagree.
5. Manager window → **Team**: the investigator's strike bar. Open the case: it's still closed. Click **Overturn decision** or **Keep the AI decision**.

> My queue is an AG Grid table: I sort by amount and filter any column to find my next case, this $349 Apple Watch. Now a wrong call. I decide for the seller, just because tracking says delivered. The AI reviewer overturns me: the buyer's photos show an opened box, a scratched screen and the wrong band. That's a strike. Three strikes alert the manager; ten block the account.
>
> If I disagree, I report it. The case stays closed. My manager reviews it and keeps the AI's call or overturns it, which removes my strike and teaches the AI.

## 2:50–3:00 · Close

**On screen:** the Disputes queue, or the ResolveIQ logo.

> ResolveIQ: faster dispute decisions, every claim backed by evidence, and an AI that keeps decisions consistent. Built on the PayPal Developer Platform and Gemini. Thank you.

---

**Tips:**
- Record each section separately and join them. That makes the timings easy to hit, and you can redo one section without restarting.
- Speed up any waiting: PayPal's checkout, or the simulated replies, which arrive after about 20 seconds.
- If the AI reviewer agrees with your seller's-favor decision on Case B, make the reason weaker, and record that section again.
- PayPal can take a few minutes to release a buyer's refund. Record the decision, then record the refund in the buyer's **Activity** once it lands, and cut them together.
