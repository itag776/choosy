import { createHash } from "node:crypto";
import { z } from "zod";
import type { CheckoutAction, Quote } from "@/lib/types";

const PaymentLinkSchema = z.object({ id: z.string().min(1), short_url: z.string().url(), reference_id: z.string(), amount: z.number().int().nonnegative(), status: z.enum(["created", "issued", "paid", "partially_paid", "cancelled", "expired"]) });
type PaymentLink = z.infer<typeof PaymentLinkSchema>;

export function parsePaymentLinkList(value: unknown): PaymentLink[] { return z.object({ payment_links: z.array(PaymentLinkSchema) }).parse(value).payment_links; }
function authHeader(): string { const id = process.env.RAZORPAY_KEY_ID; const secret = process.env.RAZORPAY_KEY_SECRET; if (!id || !secret) throw new Error("Razorpay Test Mode keys are not configured."); return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`; }

export function stableReferenceId(sessionId: string, cartDigest: string): string { return `chy_${createHash("sha256").update(`${sessionId}:${cartDigest}`).digest("hex").slice(0, 20)}`; }

export function checkoutIntent(sessionId: string, quote: Quote, idempotencyKey: string, now = new Date()): CheckoutAction {
  const referenceId = stableReferenceId(sessionId, quote.cart.digest);
  const body = { sessionId, cartId: quote.cart.id, cartDigest: quote.cart.digest, quoteDigest: quote.digest, referenceId, amountPaise: quote.cart.totalPaise, currency: "INR", environment: "test_mode" };
  return { id: `checkout_${referenceId}`, sessionId, cartId: quote.cart.id, cartDigest: quote.cart.digest, quoteDigest: quote.digest, idempotencyKey, referenceId, amountPaise: quote.cart.totalPaise, status: "intent_recorded", requestDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"), createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

async function findByReference(referenceId: string): Promise<PaymentLink | null> {
  const response = await fetch(`https://api.razorpay.com/v1/payment_links?reference_id=${encodeURIComponent(referenceId)}&count=10`, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!response.ok) return null;
  return parsePaymentLinkList(await response.json()).find((item) => item.reference_id === referenceId) ?? null;
}

function mergeProvider(action: CheckoutAction, link: PaymentLink): CheckoutAction { return { ...action, providerId: link.id, shortUrl: link.short_url, providerStatus: link.status, status: link.status === "paid" ? "paid" : "created", updatedAt: new Date().toISOString() }; }

export async function createOrReconcileCheckout(action: CheckoutAction): Promise<CheckoutAction> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return { ...action, status: "preview", failureReason: "Razorpay Test Mode keys are not configured; no checkout URL was fabricated.", updatedAt: new Date().toISOString() };
  const existing = await findByReference(action.referenceId);
  if (existing) return mergeProvider(action, existing);
  try {
    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: action.amountPaise, currency: "INR", reference_id: action.referenceId, description: "Choosy Test Mode order", expire_by: Math.floor(Date.now() / 1000) + 3_600, reminder_enable: false, notify: { email: false, sms: false }, notes: { choosy_session_id: action.sessionId, choosy_cart_id: action.cartId, choosy_cart_digest: action.cartDigest, choosy_quote_digest: action.quoteDigest, choosy_reference_id: action.referenceId, environment: "test_mode" } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Razorpay Payment Link creation failed (${response.status}): ${(await response.text()).slice(0, 220)}`);
    return mergeProvider(action, PaymentLinkSchema.parse(await response.json()));
  } catch (error) {
    const reconciled = await findByReference(action.referenceId).catch(() => null);
    if (reconciled) return mergeProvider(action, reconciled);
    throw error;
  }
}

export async function fetchPaymentLink(id: string): Promise<PaymentLink> { const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}`, { headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8_000), cache: "no-store" }); if (!response.ok) throw new Error(`Razorpay sync failed with status ${response.status}.`); return PaymentLinkSchema.parse(await response.json()); }
