# Buildathon submission packet

**Title:** Choosy

**Track:** AI Growth & Agentic Commerce<br>
**Tagline:** Shopping that listens.<br>
**One line:** Choosy asks the useful questions first, recommends only compliant merchant inventory, and turns an explicitly approved cart into a safe Razorpay checkout.

## Why it can win

Most shopping assistants jump to plausible products. Choosy makes restraint demonstrable: no recommendation before context, no invented catalog facts, no promotion hiding inside fit, and no payment action before exact confirmation. The out-of-stock demo proves the agent can stop gracefully at the most important boundary. The merchant cockpit then makes every model, policy, inventory, cart, and payment decision explainable through one audit trail.

The same catalog, quote, and checkout boundary is exposed to external agent buyers through a thin machine-readable API, making the merchant both conversationally shoppable and agent-readable.

## 90-second demo

1. Ask vaguely for a phone and show one-at-a-time adaptive questions.
2. Reveal the transparent three-product shortlist only after completeness passes.
3. Select a product and optionally attach one relevant, budget-safe add-on.
4. Use the merchant control to make the selected variant unavailable.
5. Confirm the cart and show Choosy stop before Razorpay, explain why, and offer safe alternatives.
6. Re-select, explicitly confirm, and open the Razorpay Test Mode link.
7. Show the signed webhook and complete audit trail in `/merchant`.
8. Open `/api/commerce/capabilities` for the agent-buyer story.

## Truth statement

Choosy uses fictional demo inventory and Razorpay Test Mode. Funnel values describe demo sessions only. No production conversion lift, real merchant revenue, fulfillment capability, or formal AP2/x402 compliance is claimed.

## Owner checklist

- [ ] Rename/link the Vercel project as `choosy` and deploy.
- [ ] Apply `004_choosy_agentic_commerce.sql` to the configured Supabase project.
- [ ] Set the production `CHOOSY_*` and `COMMERCE_AGENT_API_KEY` variables.
- [ ] Update and verify the Razorpay webhook URL.
- [ ] Complete one Test Mode payment and duplicate/mismatch replay.
- [ ] Record the 90-second video and add live demo, source, and video links.
- [ ] Capture shopper shortlist, failure/reselection, payment, and merchant audit screenshots.
