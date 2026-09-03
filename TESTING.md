# Exact testing instructions

## Automated gate

```bash
npm install
npm test
npm run eval
npm run eval:connected
npm run benchmark
npm run test:e2e
npm run lint
npm run build
```

All commands must exit zero.

## Judge walkthrough

1. Open `/evidence`; show the fixed dataset, fixture digest, methodology, release gate, and synthetic disclaimer.
2. Open `/agent-buyer` and submit the pre-filled goal. Narrate the capabilities, catalog, quote, and approval trace. Confirm that no payment action exists.
3. Approve the displayed digest once. Verify one Razorpay Test Mode Payment Link is created and a repeated approval returns the same run.
4. Complete an owner-controlled Test Mode payment. Keep `/agent-buyer` open until it changes to `paid`; this must come from the signed webhook, never the redirect.
5. Open `/merchant`; select the `external_agent` session and verify buyer linkage, provider ID, reference, exact amount, cart/quote digests, webhook audit, and valid hash chain.
6. For the failure proof, prepare a shopper cart, mark its selected variant unavailable in `/merchant`, and confirm it. Verify **No Razorpay action created**, a precise blocked audit event, and no silent substitution. Use **Restore demo inventory** after rehearsal.
7. Replay the same provider event and a correctly signed mismatched event. Neither may change the amount or duplicate paid state.

## Production preflight

Use HTTPS; apply migrations 004 and 005; configure all `CHOOSY_*`, Gemini, Supabase, Razorpay Test Mode, webhook, and commerce API variables; update the webhook URL; verify no secret appears in client bundles; and use only the dated catalog snapshot, simulated stock, frozen prices, and Test Mode instruments. Run three clean buyer-to-paid rehearsals plus one blocked-inventory rehearsal before recording.
