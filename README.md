# Choosy

**Shopping that listens.**

**Live demo:** [trychoosy.vercel.app](https://trychoosy.vercel.app)

Choosy is a conversational commerce system for Razorpay Buildathon Track 01: AI Growth & Agentic Commerce. It now proves four things in one flow: measurable synthetic revenue performance, an independently isolated AI buyer, a Razorpay Test Mode transaction correlated end to end, and a tamper-evident safety audit.

The public shopper works anonymously and does not request personal information. `/agent-buyer` shops exclusively through the public HTTP commerce contract and stops at an exact quote digest. `/evidence` publishes the fixed 100-scenario synthetic benchmark and its methodology. The authenticated `/merchant` cockpit keeps that benchmark separate from live demo telemetry and shows inventory, provider, webhook, and audit-chain proof.

## Catalog truth and cost

Choosy serves a versioned, curated snapshot of popular real phones, headphones, and running shoes across Indian price bands through its own public `/api/catalog`. Product cards link to source pages. Catalog access has no external API fee, API key, affiliate enrollment, or expiring trial. Prices are deliberately frozen for Razorpay Test Mode and stock is simulated, so the app never presents them as live retailer offers. Supabase and Vercel usage remain ordinary hosting costs and quotas, separate from the catalog itself.

## What the model can and cannot do

Gemini runs through the OpenAI Agents SDK. It extracts preference updates, calls typed read tools, and returns Zod-validated structured output. It cannot choose arbitrary SKUs, prices, stock, fit scores, cart totals, or payment actions. Server code owns completeness, filtering, ranking, cart validation, checkout eligibility, and payment state.

Deterministic extraction handles category, rupee budgets, common use cases, brand indifference, canonical attributes, and multiple facts in one turn. Gemini receives only unresolved or ambiguous fields through one typed discovery-context tool, with a two-turn and eight-second ceiling. If Gemini and the exact validated cache are unavailable, ambiguous discovery stops safely. Choosy never generates a recommendation from an unvalidated model response.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The shopper is public. Open `/merchant` and use operator ID `operator_judge` with access code `admin`. Production fails closed unless `CHOOSY_OPERATOR_ACCESS_CODE` and a high-entropy `CHOOSY_SESSION_SECRET` are configured. The demo access code is intentionally weak and must be replaced before a real deployment.

Development defaults to atomic file-backed storage so an older configured database cannot break the demo. Apply migrations `004_choosy_agentic_commerce.sql`, `005_choosy_buyer_runs.sql`, and `006_authoritative_commerce_audit.sql` in order, then set `USE_SUPABASE_COMMERCE=true` to exercise the durable control plane locally. Production automatically uses configured Supabase credentials and fails closed if the schema is missing. Older tables remain untouched only for rollback and are unused by Choosy.

## Razorpay Test Mode

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure `https://YOUR_HOST/api/webhooks/razorpay` for `payment_link.paid`, `payment.captured`, and `payment.failed`.

Before the provider call, Choosy persists an intent bound to the exact session, cart digest, quote digest, amount, and stable reference. A retry reconciles by reference. The webhook verifies HMAC over the untouched request body, deduplicates the provider event ID, and requires exact provider ID, reference, cart digest, and amount correlation. Paid state is monotonic.

## Machine-readable commerce

- `GET /api/commerce/capabilities`
- `GET /api/catalog`
- `GET /api/catalog/:sku`
- `POST /api/commerce/quotes`
- `POST /api/commerce/checkouts`
- `GET /api/commerce/orders/:sessionId`
- `POST /api/buyer/runs`
- `GET /api/buyer/runs/:runId`
- `POST /api/buyer/runs/:runId/approve`

Checkout requires `X-Commerce-Demo-Key`, an accepted quote digest, `confirmation: true`, and an idempotency key. The server recomputes quote integrity and revalidates current stock and price.

## Verify

```bash
npm test
npm run eval
npm run eval:connected
npm run benchmark
npm run test:e2e
npm run lint
npm run build
```

See [architecture](ARCHITECTURE.md), [threat model](THREAT_MODEL.md), [evaluation](EVALUATION.md), [testing walkthrough](TESTING.md), and [submission packet](SUBMISSION.md).
