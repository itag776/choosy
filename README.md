# RecoverOS Canary Commander

RecoverOS is a governed payment-recovery agent for Razorpay Buildathon Track 03. It detects a synthetic issuer incident, investigates through typed tools, proposes two bounded recovery playbooks, runs a fixed canary, promotes the measured winner, and keeps deterministic replay money separate from Razorpay Test Mode money.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The complete replay works without credentials using a clearly labelled deterministic agent fallback. Add `OPENAI_API_KEY` to use the real OpenAI Agents SDK path.

## Razorpay Test Mode

Add Test Mode credentials and a webhook secret to `.env.local`:

```text
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Configure the public webhook URL as:

```text
https://YOUR_HOST/api/webhooks/razorpay
```

Subscribe to `payment.captured`, `payment.failed`, and `payment_link.paid`. RecoverOS validates the raw-body HMAC, requires `x-razorpay-event-id`, suppresses duplicates, and never lets a late failure overwrite a paid state.

## Optional Supabase persistence

Apply `supabase/migrations/001_recoveros_snapshots.sql`, then set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Without those values, the demo uses an in-memory store and resets when the server restarts.

## Verification

```bash
npm test
npm run lint
npm run build
```

The benchmark is calculated from a fixed 100-window holdout in `lib/benchmark.ts`; dashboard percentages are not hand-entered. The main 240-payment replay, its seed, and manifest hash are displayed in-product.

## Claims policy

- **Deterministic replay recovered:** calculated synthetic outcomes used to compare playbooks.
- **Razorpay Test Mode recovered:** sandbox capture received from Razorpay or synchronized from its API.
- These values are deliberately never summed or presented as real merchant revenue.
