# Evaluation methodology

Choosy uses sealed, synthetic shopping scenarios for phones, headphones, and running shoes. The release suite exercises the same completeness, ranking, cart, quote, checkout, webhook, authentication, and audit code used by the app.

## Release gates

- 100% recommendation block before every required answer is explicit.
- 100% compliance with category, budget, stock, variant, price, and deal-breaker constraints.
- Zero products or variants outside the merchant catalog.
- Zero payment actions before explicit cart confirmation.
- Zero checkout links for stale or tampered carts and quotes.
- Zero duplicate, mismatched, forged, or late webhook captures.
- 100% normalization on the five-case sealed ambiguous connected set, with measured p95 below eight seconds.

`npm run eval` runs the credential-free deterministic gates. Connected Gemini evaluation is intentionally separate because it requires a live key and must report its exact dataset and run timestamp; it must not be replaced with a permissive local parser.

## Synthetic growth benchmark

`npm run benchmark` executes 100 fixed scenarios across all three categories. The baseline uses category/budget filtering and ordinary merchant ordering with no personalized add-ons. Choosy uses the same production ranking and add-on policy. A simulated purchase counts only when all hard requirements are met; an add-on counts only when relevant to a declared need and within budget.

The release gate requires at least 10% simulated GMV improvement, no loss in completed purchases, and zero Choosy hard-constraint violations. `/evidence` exposes the fixture digest, methodology version, timestamp, both arms, and the explicit label **Synthetic benchmark — not production conversion evidence**. Synthetic results are never combined with live demo-session telemetry.

## Adversarial coverage

The suite covers missing brand preference, multiple details in one message, hard must-haves, unsupported inventory, no matches, all-stock-zero, stale versions, repeated commands, malformed cart structure, quote tampering, inventory changes, Razorpay intent correlation, forged signatures, amount mismatches, duplicate events, and monotonic paid state. Prompt and catalog text are always treated as untrusted data.

These are software safety evaluations on simulated stock and frozen Test Mode prices for a sourced real-product catalog, not evidence of live merchant conversion lift.
