# StudentNest Backend Stage 5 — Protected Payments & Transactions

This stage adds the transaction and payment-protection foundation. It does **not** process live money unless a real Flutterwave test account and credentials are configured.

## Database migration
Run `database/stage5_payments_migration.sql` in the existing `studentnest` database after Stages 1–4.

## Local test mode (recommended first)
In `backend/.env`:

```env
PAYMENT_MODE=mock
```

Mock mode never charges a real card or moves money. It lets the team test the full transaction state machine.

## Flutterwave test mode
When ready to connect a test gateway account, set:

```env
PAYMENT_MODE=flutterwave
FLW_SECRET_KEY=your_test_secret_key
FLW_SECRET_HASH=your_webhook_secret_hash
FLW_REDIRECT_URL=http://localhost:5173/payment/callback
```

Do not put secret keys in the React frontend or commit `.env` to source control.

## Core flow
1. Provider has a verified bank account.
2. Student requests a quote for an approved + verified property.
3. Student initializes payment.
4. Gateway payment is verified server-side.
5. Transaction enters `funds_protected` with a 7-day inspection deadline.
6. Student can confirm or open a dispute.
7. Admin/payment-gateway integration later releases or refunds funds.

The application deliberately does **not** claim that the local Node/MySQL app itself holds customer money. Actual custody, escrow, settlement and payout are handled by the licensed payment provider and its supported product configuration.
