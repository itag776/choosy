# Exact testing instructions

## Automated release gate

From the repository root with Node.js 20+:

```bash
npm install
npm test
npm run eval
npm run lint
npm run build
```

Expected result: every command exits zero. `npm test` covers detector/cohort behavior, generated evaluation metadata, policy attacks, deterministic canary assignment, authenticated session integrity/expiry, run isolation, approval receipts, audit hash-chain verification, command idempotency, exact webhook correlation, duplicate delivery, and late-event monotonicity.

## Local judge walkthrough

1. Copy `.env.example` to `.env.local` and run `npm run dev`.
2. Open `http://localhost:3000` in two private browser windows.
3. In each window sign in with a distinct operator ID and local access code `recoveros-demo`.
4. Confirm that the two browser/API sessions use different run IDs and actions in one window do not move the other.
5. Complete: Inject → Investigate → Approve canary → Run canary → Evaluate → Approve promotion.
6. Expand the evidence drawer. Confirm two approvals, unique receipt digests, a changing audit hash, 160 evaluation windows, and six policy attacks.
7. Without integrations, choose Create Test Mode proof. Confirm the UI reports an integration failure in the **Prove** chapter and does not fabricate a provider URL.

## Connected Razorpay Test Mode walkthrough

After the project owner configures integrations:

1. Create the Test Mode proof after promotion and record the Payment Link ID/reference shown in the UI.
2. Pay only with the owner's Razorpay Test Mode instrument.
3. Confirm the verified webhook moves the run to `test_payment_captured` and only the Test Mode ledger becomes ₹400.
4. Choose **Replay duplicate webhook**. Confirm the run completes without increasing the Test Mode ledger.
5. Send or replay a correctly signed webhook carrying another Payment Link ID. Confirm it is recorded/ignored and does not capture the run.
6. Confirm Supabase contains one `webhook_receipts` row for the provider event and two append-only `approval_receipts` rows.

## Production preflight

Use HTTPS; set both operator-auth variables; confirm the four integration indicators independently; verify no `SUPABASE_SERVICE_ROLE_KEY`, Razorpay secret, Gemini key, or session secret appears in browser bundles or logs; and use only synthetic/Test Mode data during judging.
