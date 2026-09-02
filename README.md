# Kept

**Revenue that doesn't slip away.**

Kept is a governed revenue-recovery agent for Razorpay Buildathon Track 03. It detects payment degradation, investigates the evidence, enforces merchant policy in deterministic code, requires two authenticated human approvals, compares recovery strategies on a replay canary, and proves the final provider boundary with a correlated Razorpay Test Mode payment.

The product keeps three claims separate:

- **Deterministic replay recovered** is calculated from synthetic fixture outcomes.
- **Razorpay Test Mode recovered** is sandbox money confirmed by an exactly correlated provider response or verified webhook.
- Neither figure is real merchant revenue, and the UI never adds them together.

## Why this is more than a dashboard

The control loop is executable: observe → investigate → approve → experiment → approve → replay promotion → Test Mode proof. The AI can interpret evidence and recommend, but it cannot bypass the typed policy gate, approve its own action, or directly move money. Every browser session receives an isolated run ID, every command is versioned and idempotent, and every approval is bound to the operator, run, reviewed version, policy digest, cohort digest, reason, and timestamp.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. In development, sign in as `operator_judge` with `kept-demo`. Production has no fallback credentials and fails closed unless both operator-auth variables are configured.

The complete replay works without third-party credentials using a visibly labelled deterministic fallback. Add `GEMINI_API_KEY` to use the free-tier Gemini model through the Agents SDK's OpenAI-compatible provider path pinned in code. Without Supabase, isolated run snapshots are atomically stored under the operating-system temporary directory; this is a development convenience, not the production control plane.

## Razorpay Test Mode

Add Test Mode credentials and a webhook secret to `.env.local`, then configure `https://YOUR_HOST/api/webhooks/razorpay` for `payment.captured`, `payment.failed`, and `payment_link.paid`.

Kept verifies the raw-body HMAC and requires `x-razorpay-event-id`. It resolves the run only from correlation metadata placed in the Payment Link, then requires the provider Payment Link ID and reference ID to match the persisted external-action intent. An unrelated signed event cannot capture the run. Event IDs are deduplicated and a late failure cannot regress a paid state.

The production webhook endpoint is `https://usekept.vercel.app/api/webhooks/razorpay`.

## Supabase control plane

Apply `supabase/migrations/002_recoveros_control_plane.sql`, then set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is reserved for future browser-side authenticated features; the current incident room uses only the server client. The migration provides version-checked atomic transitions, atomic webhook deduplication, row-level security, server-secret-only RPC execution, and update/delete blockers for audit events and approval receipts.

Never expose `SUPABASE_SECRET_KEY`, Razorpay secrets, the operator session secret, or the Gemini key to the browser.

## Evidence and verification

```bash
npm test
npm run eval
npm run lint
npm run build
```

`runLockedBenchmark()` generates 160 deterministic adversarial payment windows and executes the real detector, cohort selection, playbook selector, policy evaluator, and replay campaign adapter. Metrics, confusion counts, the dataset SHA-256 digest, and 95% Wilson intervals are derived at runtime. Six malformed or unsafe policy proposals exercise the rejection boundary. Release gates require precision/recall ≥90%, cohort F1 ≥85%, playbook selection ≥80%, zero accepted policy attacks, zero duplicate dispatches, zero contacts after capture, and replay recovery above baseline without extra contacts.

See [architecture](ARCHITECTURE.md), [threat model](THREAT_MODEL.md), [evaluation methodology](EVALUATION.md), [exact testing instructions](TESTING.md), and [submission links/checklist](SUBMISSION.md).

## Live deployment

[Open the production demo](https://usekept.vercel.app). Production has been exercised end to end through Gemini investigation and promotion evaluation, authenticated approvals, Supabase persistence, and Razorpay Test Mode Payment Link creation and synchronization. The Vercel project is intentionally deployed from the CLI without a Git connection, so repository pushes do not trigger automatic deployments.

The Razorpay webhook has been validated end to end with an owner-completed ₹400 Test Mode payment: HMAC verification, exact run/link/reference correlation, Supabase persistence, and duplicate delivery with zero duplicate executions. The demo video remains an owner-completion item; see `SUBMISSION.md` for the final checklist.
