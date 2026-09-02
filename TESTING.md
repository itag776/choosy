# Exact testing instructions

## Automated gate

```bash
npm install
npm test
npm run eval
npm run lint
npm run build
```

All commands must exit zero.

## Judge walkthrough

1. Open `/` and enter a vague phone request.
2. Answer the adaptive questions; confirm no shortlist appears early. Click any completed preference chip and verify it must be answered again.
3. Inspect Best fit, Best value, and Alternative, including matches, trade-offs, current prices, variants, and any promotion disclosure.
4. Choose a product, accept or skip the optional budget-safe add-ons, and review the exact cart.
5. In a second window, sign in at `/merchant` with development code `choosy-demo`. Select the same session and choose **Mark unavailable**.
6. Return to the shopper and confirm the cart. Verify checkout is blocked before Razorpay, the reason is explained, and fresh compliant alternatives appear without substitution.
7. Select a replacement, re-confirm the cart, then click **Pay securely with Razorpay**. Verify the browser redirects to Razorpay Test Mode.
8. Complete an owner-controlled Test Mode payment. Return to the shopper and merchant cockpit; verify paid state and the signed webhook audit event.
9. Replay the same provider event and a correctly signed mismatched event. Neither may change the amount or duplicate paid state.
10. Open `/api/commerce/capabilities` and `/api/catalog` to show the agent-readable surface.

## Production preflight

Use HTTPS; apply migration 004; configure all `CHOOSY_*`, Gemini, Supabase, Razorpay Test Mode, webhook, and commerce API variables; update the webhook URL; verify no secret appears in client bundles; and use only fictional inventory and Test Mode instruments.
