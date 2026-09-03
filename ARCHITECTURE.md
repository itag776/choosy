# Choosy architecture

## Control flow

```mermaid
flowchart LR
  S[Anonymous shopper] -->|signed HttpOnly session| API[Next.js route handlers]
  B[Isolated external AI buyer] -->|public HTTP only| API
  API --> A[Gemini discovery agent]
  A -->|typed reads + Zod output| P[Deterministic commerce policy]
  P --> C[(Versioned commerce session)]
  M[Authenticated merchant] -->|inventory control + audit read| C
  C -->|confirmed cart intent| R[Razorpay Test Mode]
  R -->|raw-body HMAC webhook| W[Exact correlation gate]
  W --> C
  C -->|payment-safe status only| B
  C --> D[(Local preview or Supabase)]
  D --> E[Append-only hash-chained audit]
```

## Responsibility split

- Gemini extracts multiple preferences from natural language and helps identify the next missing field. It has only typed, read-only tools.
- Deterministic code owns required-field completeness, catalog lookup, hard constraints, stock and price filtering, fit scoring, promotion tie-break disclosure, add-on limits, totals, quote integrity, and checkout eligibility.
- The catalog is a merchant-scoped, versioned snapshot of real product identities and sourced specifications. Prices are frozen for Razorpay Test Mode, stock is simulated, and unknown categories are honestly refused. No paid retail catalog API is a runtime dependency.
- Every mutation uses optimistic versioning and a persisted idempotency receipt.
- The external buyer module can import only `fetch`-level contracts and neutral shared types. It cannot import the catalog, ranking policy, repository, or commerce service, and it never receives a checkout tool.

## State machine

`discovering → recommendations_ready → item_selected → cart_review → checkout_ready → paid`

Safe branches are `agent_failure`, `needs_reselection`, and `payment_failed`. An unavailable variant moves the session to `needs_reselection` before any provider call. A late failure cannot regress `paid`.

Buyer runs use `planning → awaiting_approval → approved → checkout_ready → paid`, with `blocked` and `failed` exits. Approval is bound to the displayed quote digest and one stable idempotency key. Buyer status reaches `paid` only after the order endpoint observes a webhook-updated commerce session.

## Trust boundaries

1. Shopper sessions use a signed, HttpOnly, SameSite=Lax cookie containing only the allowed shopping session ID.
2. Merchant APIs use a separate signed, HttpOnly operator cookie and merchant identity.
3. AI output is untrusted until strict schema and semantic validation pass; it never receives write or payment tools.
4. Payment intent is persisted before the Razorpay call and bound to cart/quote digests, reference, and amount.
5. Webhooks are verified from raw bytes, deduplicated by event ID, and exactly correlated before state changes.
6. Supabase transitions are version-checked; audit rows reject update and delete.

## Persistence

`004_choosy_agentic_commerce.sql` adds the core commerce schema. `005_choosy_buyer_runs.sql` adds durable buyer runs plus session origin and buyer-run linkage. Existing legacy tables are retained for rollback but are not read by the Choosy application.
