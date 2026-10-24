# Phase 0 sandbox spike

## One-time setup
1. developer.paypal.com → Sandbox → Accounts: create a **Business** (seller) and a **Personal** (buyer) account.
2. Apps & Credentials → Sandbox → create an app tied to the business account. Under Features, enable **Disputes** (and Transaction Search / Tracking if listed).
3. `cp ../.env.example ../.env`, fill in client id/secret, then `set -a; source ../.env; set +a`.
4. `pip install requests`

## Run order
```
python paypal_spike.py token
python paypal_spike.py order              # open the printed link, log in as the buyer, approve
python paypal_spike.py capture <ORDER_ID> # note the capture id
python paypal_spike.py create-dispute <CAPTURE_ID>
python paypal_spike.py list
python paypal_spike.py show <DISPUTE_ID>
python paypal_spike.py require-evidence <DISPUTE_ID>
python paypal_spike.py track <CAPTURE_ID> 1234567890 USPS
python paypal_spike.py get-tracking <CAPTURE_ID> 1234567890
python paypal_spike.py adjudicate <DISPUTE_ID> SELLER_FAVOR
```

If `create-dispute` fails, open sandbox.paypal.com as the buyer → Resolution Center → report a problem on the transaction, then continue from `list`.

## Record findings
For each step note: worked? exact request body, response shape, error text, `PayPal-Debug-Id` on failures. Save responses to `../fixtures/paypal/`. Anything marked UNVERIFIED in the script is a guess until it has succeeded here.
