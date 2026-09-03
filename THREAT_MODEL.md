# Threat model

| Threat | Control | Verification |
|---|---|---|
| Recommendation before sufficient context | Deterministic required-field gate | Incomplete profiles always return no shortlist |
| Invented product, price, stock, or score | Model never supplies candidates; server ranks catalog records | Catalog, budget, and stock assertions |
| Prompt injection in shopper or catalog text | Typed read tools, fixed system instructions, strict Zod output, no write tools | Agent failure is fail-closed |
| Stale or modified cart | SHA-256 cart digest plus live variant and price revalidation | Unavailable-item and tampered-cart tests |
| Money action without consent | `confirmedAt`, quote digest, and explicit command required | Early-checkout rejection test |
| Duplicate provider creation | Persisted intent, stable reference, reconciliation, idempotency key | Stable-reference assertions |
| Forged or unrelated webhook | Raw-body HMAC and exact provider/reference/cart/amount match | Signature, mismatch, and duplicate tests |
| Late failure regresses paid | Paid state is monotonic | Webhook state-machine tests |
| Shopper accesses another session | Signed HttpOnly cookie is bound to the path session ID | Route authorization boundary |
| Merchant action by shopper | Separate signed operator cookie and merchant check | Auth token tests |
| Audit editing | Hash chain locally; append-only triggers in Supabase | Chain verification and migration |
| Secret leakage | Gemini, Razorpay, Supabase service role, and session secrets remain server-only | Source inspection and production build |

## Residual risks

The shared demo operator code is not enterprise authentication. A compromised server or service role can still create new evidence; stronger non-repudiation needs an external append-only ledger or KMS signing. The catalog uses real product identities, but its dated prices are frozen and its stock is simulated; payments are Razorpay Test Mode and all funnel metrics describe only demo sessions. Production use also requires live merchant feeds, shipping, tax, fulfillment, fraud, privacy, and merchant identity controls outside this prototype.
