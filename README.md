# Choosy
Website : https://trychoosy.vercel.app/
**Shopping that listens.**

Choosy is a conversational buying agent for Razorpay Buildathon Track 01: AI Growth & Agentic Commerce. It asks adaptive questions until every required constraint is explicit, ranks only real merchant inventory with deterministic code, explains the shortlist, builds a budget-safe cart, and creates a Razorpay Test Mode Payment Link only after explicit confirmation.

The public shopper works anonymously and does not request personal information. The authenticated `/merchant` cockpit shows demo funnel metrics, inventory controls, integration health, and a tamper-evident audit trail. All products, conversion evidence, and payments are clearly labelled demo or Test Mode.

## What the model can and cannot do

Gemini runs through the OpenAI Agents SDK. It extracts preference updates, calls typed read tools, and returns Zod-validated structured output. It cannot choose arbitrary SKUs, prices, stock, fit scores, cart totals, or payment actions. Server code owns completeness, filtering, ranking, cart validation, checkout eligibility, and payment state.

If Gemini and the exact validated cache are unavailable, free-text discovery stops with a retryable message. Controlled quick replies still work because their values are already bounded by the active question. Choosy never generates a recommendation from an unvalidated model response.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The shopper is public. Open `/merchant` and, in development, use operator ID `operator_judge` with access code `choosy-demo`. Production fails closed unless `CHOOSY_OPERATOR_ACCESS_CODE` and a high-entropy `CHOOSY_SESSION_SECRET` are configured.

Development defaults to atomic file-backed storage so an older configured database cannot break the demo. Apply `supabase/migrations/004_choosy_agentic_commerce.sql` and set `USE_SUPABASE_COMMERCE=true` to exercise the durable control plane locally; production automatically uses configured Supabase credentials and fails closed if the schema is missing. Older tables remain untouched only for rollback and are unused by Choosy

## Razorpay Test Mode

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure `https://YOUR_HOST/api/webhooks/razorpay` for `payment_link.paid`, `payment.captured`, and `payment.failed`.

Before the provider call, Choosy persists an intent bound to the exact session, cart digest, quote digest, amount, and stable reference. A retry reconciles by reference. The webhook verifies HMAC over the untouched request body, deduplicates the provider event ID, and requires exact provider ID, reference, cart digest, and amount correlation. Paid state is monotonic.

## Machine-readable commerce

- `GET /api/commerce/capabilities`
- `GET /api/catalog`
- `GET /api/catalog/:sku`
- `POST /api/commerce/quotes`
- `POST /api/commerce/checkouts`

Checkout requires `X-Commerce-Demo-Key`, an accepted quote digest, `confirmation: true`, and an idempotency key. The server recomputes quote integrity and revalidates current stock and price.

## Verify

```bash
npm test
npm run eval
npm run lint
npm run build
```

See [architecture](ARCHITECTURE.md), [threat model](THREAT_MODEL.md), [evaluation](EVALUATION.md), [testing walkthrough](TESTING.md), and [submission packet](SUBMISSION.md).
