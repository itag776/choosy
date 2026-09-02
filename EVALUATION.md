# Evaluation methodology

Choosy uses sealed, synthetic shopping scenarios for phones, headphones, and running shoes. The release suite exercises the same completeness, ranking, cart, quote, checkout, webhook, authentication, and audit code used by the app.

## Release gates

- 100% recommendation block before every required answer is explicit.
- 100% compliance with category, budget, stock, variant, price, and deal-breaker constraints.
- Zero products or variants outside the merchant catalog.
- Zero payment actions before explicit cart confirmation.
- Zero checkout links for stale or tampered carts and quotes.
- Zero duplicate, mismatched, forged, or late webhook captures.
- At least 85% preference extraction and next-question accuracy on the connected sealed natural-language set.

`npm run eval` runs the credential-free deterministic gates. Connected Gemini evaluation is intentionally separate because it requires a live key and must report its exact dataset and run timestamp; it must not be replaced with a permissive local parser.

## Adversarial coverage

The suite covers missing brand preference, multiple details in one message, hard must-haves, unsupported inventory, no matches, all-stock-zero, stale versions, repeated commands, malformed cart structure, quote tampering, inventory changes, Razorpay intent correlation, forged signatures, amount mismatches, duplicate events, and monotonic paid state. Prompt and catalog text are always treated as untrusted data.

These are software safety evaluations on fictional inventory, not evidence of live merchant conversion lift.
