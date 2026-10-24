# PayPal Sandbox Reset Runbook

This guide gives you the exact step-by-step reset flow for the ResolveIQ PayPal sandbox setup, including the commands to run and the expected output pattern.

## 1. Prerequisites

You need:
- a PayPal Developer account
- a sandbox business account
- a sandbox personal buyer account
- the project checked out locally at `C:\Users\meher\OneDrive\Desktop\resolveiq`

This project is configured to use the PayPal sandbox, as shown in:
- `.env`
- `backend/app/config.py`
- `spike/paypal_spike.py`

---

## 2. Open the PayPal Developer Dashboard

Go to:

https://developer.paypal.com

Then:
1. Sign in
2. Open `Dashboard`
3. Go to `Apps & Credentials`
4. Create a new sandbox app if needed
5. Select a sandbox business account for the app
6. Copy the new `Client ID` and `Client Secret`

---

## 3. Update the local environment file

Open `.env` and replace the existing PayPal values with the new sandbox app values.

Example:

```env
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
```

Make sure you are not using production credentials.

---

## 4. Load environment variables in PowerShell

From the project root, run:

```powershell
cd "C:\Users\meher\OneDrive\Desktop\resolveiq"

Get-Content .env | ForEach-Object {
  if ($_ -match "^\s*#|^\s*$") { return }
  $name, $value = $_ -split "=", 2
  if ($name -and $value) {
    [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
  }
}
```

This loads the variables in the current PowerShell session so the script can read them.

---

## 5. Verify the token works

Run:

```powershell
python .\spike\paypal_spike.py token
```

### Expected output pattern

```text
[token] expires_in=32400s
[token] scopes: https://uri.paypal.com/services/customer/partner-referrals/readwrite https://uri.paypal.com/services/payments/partnerfee https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/checkout/one-click-with-merchant-issued-token https://uri.paypal.com/services/payments/futurepayments https://uri.paypal.com/services/vault/payment-tokens/read https://uri.paypal.com/services/disputes/read
```

If you see this, the PayPal sandbox app is connected and working.

---

## 6. Create a new sandbox buyer account

Go to the PayPal Developer Dashboard:

https://developer.paypal.com/dashboard/accounts

Then:
1. Click `Create account`
2. Choose `Personal`
3. Set the account country to `United States`
4. Use `USD` as the account currency if available
5. Save the email and password

This buyer account will be used to approve payment.

---

## 7. Create the order

Run:

```powershell
python .\spike\paypal_spike.py order
```

### Expected output pattern

The script prints a PayPal approval link.

```text
POST /v2/checkout/orders -> 201  (PayPal-Debug-Id: ...)
{
  "id": "2FG1234567890",
  "intent": "CAPTURE",
  "status": "CREATED",
  "links": [
    {
      "rel": "approve",
      "href": "https://www.sandbox.paypal.com/checkoutnow?...",
      "method": "GET"
    }
  ]
}
OPEN AS SANDBOX BUYER (personal account): https://www.sandbox.paypal.com/checkoutnow?...
```

Important:
- the order ID is the value in `"id"`, such as `2FG1234567890`
- do not type angle brackets like `<ORDER_ID>`
- use the actual value returned by the script

---

## 8. Approve the fake payment as the sandbox buyer

1. Open the approval URL in your browser
2. Log in with the sandbox personal buyer account
3. Review the transaction
4. Click `Pay Now` / `Continue`
5. Complete the payment

If you see an error like:

> We're sorry. This seller doesn't accept payments in your currency.

Then the buyer account is not compatible with the order currency. Fix by using a US buyer sandbox account with USD, since the app creates orders in USD.

---

## 9. Capture the order

After the buyer approves payment, run:

```powershell
python .\spike\paypal_spike.py capture 2FG1234567890
```

Use the real order ID from the previous step.

### Expected output pattern

```text
POST /v2/checkout/orders/2FG1234567890/capture -> 201  (PayPal-Debug-Id: ...)
{
  "id": "4R1234567890",
  "status": "COMPLETED",
  "payer": {
    "email_address": "buyer-bizperson@example.com"
  },
  "purchase_units": [
    {
      "payments": {
        "captures": [
          {
            "id": "4R1234567890",
            "status": "COMPLETED"
          }
        ]
      }
    }
  ]
}
```

This confirms the fake payment succeeded.

---

## 10. Create a fake dispute as the buyer

Now log in to the sandbox buyer account and open the transaction history or the Resolution Center.

Steps:
1. Open the PayPal sandbox account
2. Go to `Activity` or `Transactions`
3. Find the fake transaction
4. Click the transaction
5. Select `Report a problem` or `Dispute this transaction`
6. Choose a dispute reason such as:
   - `Item not received`
   - `Merchandise not as described`
7. Submit the dispute

This creates the sandbox complaint.

---

## 11. Check the dispute from the project

Back in the terminal, run:

```powershell
python .\spike\paypal_spike.py list
```

### Expected output pattern

```text
GET /v1/customer/disputes -> 200  (PayPal-Debug-Id: ...)
{
  "disputes": [
    {
      "id": "PP-1234567890",
      "status": "OPEN",
      "reason": "ITEM_NOT_RECEIVED",
      "disputed_transactions": [
        {
          "seller_transaction_id": "4R1234567890"
        }
      ]
    }
  ],
  "total_items": 1
}
```

You can also inspect one dispute with:

```powershell
python .\spike\paypal_spike.py show PP-1234567890
```

---

## 12. If a command fails

### Common error: KeyError for PAYPAL_CLIENT_ID

This means env vars are not loaded in the current shell.

Fix with:

```powershell
Get-Content .env | ForEach-Object {
  if ($_ -match "^\s*#|^\s*$") { return }
  $name, $value = $_ -split "=", 2
  if ($name -and $value) {
    [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
  }
}
```

Then rerun:

```powershell
python .\spike\paypal_spike.py token
```

---

## 13. Summary of the working reset flow

```powershell
cd "C:\Users\meher\OneDrive\Desktop\resolveiq"

Get-Content .env | ForEach-Object {
  if ($_ -match "^\s*#|^\s*$") { return }
  $name, $value = $_ -split "=", 2
  if ($name -and $value) {
    [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
  }
}

python .\spike\paypal_spike.py token
python .\spike\paypal_spike.py order
python .\spike\paypal_spike.py capture 2FG1234567890
python .\spike\paypal_spike.py list
```

This is the cleanest sandbox reset path for the project.

---

## 14. Final note

The project is designed for PayPal sandbox testing, not live PayPal. The fake payment and fake complaint are meant to be created using sandbox buyer accounts only.
