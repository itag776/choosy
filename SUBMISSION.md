# Buildathon submission packet

**Title:** Choosy

**Track:** AI Growth & Agentic Commerce<br>
**Tagline:** Shopping that listens.<br>
**One line:** An independent AI buyer turns intent into a revenue-positive, digest-approved basket, a Razorpay Test Mode checkout, and a webhook-verified tamper-evident audit.

## Why it can win

Most shopping assistants jump to plausible products. Choosy makes restraint demonstrable: no recommendation before context, no invented catalog facts, no promotion hiding inside fit, and no payment action before exact confirmation. The out-of-stock demo proves the agent can stop gracefully at the most important boundary. The merchant cockpit then makes every model, policy, inventory, cart, and payment decision explainable through one audit trail.

The same catalog, quote, checkout, and payment-safe order boundary is exposed through HTTP. A separately isolated buyer discovers the contract, reads the catalog, proposes a basket, and stops. Only a server controller can add checkout authority after exact approval. A reproducible 100-scenario synthetic benchmark supplies honest revenue evidence without pretending to be production uplift.

## Five-minute demo

1. Open `/evidence`: show the synthetic baseline comparison and honest methodology.
2. Open `/agent-buyer`: submit the pre-filled goal, show the proposed cart, then expand **Technical details** to inspect the API activity.
3. Show the exact basket, amount, expiry, reasoning, trade-off, and quote digest. State that no checkout exists.
4. Approve once, complete Razorpay Test Mode, and wait for webhook-confirmed `paid`.
5. Open `/merchant`: show external-agent origin, provider/reference/digests, webhook event, and verified audit chain.
6. Show the inventory-change failure: checkout is blocked, no Razorpay action is created, no substitution occurs, and demo inventory can be restored.

## Truth statement

Choosy uses real product identities and sourced specifications in a dated catalog snapshot. Prices are frozen for Razorpay Test Mode and inventory is simulated; they are not live retailer offers. Funnel values describe demo sessions only. No production conversion lift, real merchant revenue, fulfillment capability, or formal AP2/x402 compliance is claimed.

## Owner checklist

- [x] Rename/link the Vercel project as `choosy` and deploy at `https://trychoosy.vercel.app`.
- [ ] Apply `004_choosy_agentic_commerce.sql` to the configured Supabase project.
- [ ] Apply `005_choosy_buyer_runs.sql` to the configured Supabase project.
- [ ] Apply `006_authoritative_commerce_audit.sql` to backfill and enforce the authoritative audit ledger.
- [ ] Set the production `CHOOSY_*` and `COMMERCE_AGENT_API_KEY` variables.
- [ ] Update and verify the Razorpay webhook URL.
- [ ] Complete one Test Mode payment and duplicate/mismatch replay.
- [ ] Record the 90-second video and add live demo, source, and video links.
- [ ] Capture shopper shortlist, failure/reselection, payment, and merchant audit screenshots.
