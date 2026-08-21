# RecoverOS Canary Commander

RecoverOS is a governed payment-recovery incident room for Razorpay Buildathon Track 03. It detects a payment degradation, investigates through five typed tools, proposes two policy-bounded playbooks, runs an immutable randomized canary, promotes only after a second human gate, and proves the last mile with a Razorpay Test Mode payment.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The complete deterministic replay works without credentials using a visibly labelled safe fallback. Add `OPENAI_API_KEY` to use the real OpenAI Agents SDK path pinned to `gpt-5.4-mini-2026-03-17`.

The local fallback is durable across browser sessions and server restarts: it writes atomically to the operating-system temporary directory. It is a developer convenience, never presented as the production control plane.

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

## Supabase control plane

Apply `supabase/migrations/002_recoveros_control_plane.sql`, then set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Supabase becomes authoritative for runs, payment attempts, agent runs, external actions, webhook receipts and append-only audit events. The migration includes the atomic `apply_run_transition` and `process_razorpay_webhook` functions.

Never expose `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secrets or the OpenAI key to the browser.

## Production deployment

1. Apply the Supabase control-plane migration.
2. Add the variables from `.env.example` to Vercel Production and Preview environments.
3. Deploy the Next.js application.
4. Point the Razorpay Test Mode webhook to `https://YOUR_HOST/api/webhooks/razorpay`.
5. Run `npm run eval`, then complete one self-owned Test Mode Payment Link before the demo.

## Verification

```bash
npm test
npm run eval
npm run lint
npm run build
```

The benchmark is calculated from a committed 100-window locked holdout. The replay contains 240 attempts, pre-generated intervention outcomes and a SHA-256 manifest. Canary assignment is seeded and persisted before outcome lookup; every displayed result is computed from those artifacts.

Release gates are encoded in `tests/eval.test.ts`: detector precision/recall ≥90%, cohort F1 ≥85%, playbook selection ≥80%, zero policy violations, duplicate executions and post-recovery contacts, and better replay recovery than the baseline without more contacts.

## Claims policy

- **Deterministic replay recovered:** calculated synthetic outcomes used to compare playbooks.
- **Razorpay Test Mode recovered:** sandbox capture received from Razorpay or synchronized from its API.
- These values are deliberately never summed or presented as real merchant revenue.
