import { randomUUID } from "node:crypto";
import { CATALOG_VERSION } from "@/lib/catalog";
import { createCommerceAuditEvent } from "@/lib/commerce-audit";
import { emptyPreferenceProfile, nextQuestion } from "@/lib/commerce-policy";
import type { OperatorIdentity, ShoppingSessionSnapshot } from "@/lib/types";

export const DEFAULT_MERCHANT_ID = "merchant_choosy_demo";
export const DEMO_MERCHANT_OPERATOR: OperatorIdentity = {
  actorId: "merchant_demo",
  role: "operator",
  merchantId: DEFAULT_MERCHANT_ID,
};

export function createShoppingSession(now = new Date(), sessionId = `shop_${randomUUID().replaceAll("-", "").slice(0, 24)}`): ShoppingSessionSnapshot {
  const createdAt = now.toISOString();
  const profile = emptyPreferenceProfile();
  const firstQuestion = nextQuestion(profile)!;
  const session: ShoppingSessionSnapshot = {
    id: sessionId, merchantId: DEFAULT_MERCHANT_ID, origin: "shopper_ui", phase: "discovering", version: 1, profile, activeQuestionKey: firstQuestion.key,
    messages: [{ id: randomUUID(), role: "assistant", text: "What are you shopping for? Tell me in your own words, or choose an example below.", createdAt }],
    recommendations: [], selectedProductId: null, selectedVariantId: null, offeredAddonIds: [], cart: null, quote: null, checkout: null,
    audit: [], commandReceipts: [], processedWebhookIds: [], catalogVersion: CATALOG_VERSION,
    integration: { gemini: Boolean(process.env.GEMINI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) ? "supabase" : "local_file" },
    createdAt, updatedAt: createdAt,
  };
  session.audit.push(createCommerceAuditEvent(session, { kind: "session", title: "Shopping session started", detail: "Anonymous session created. No personal information was requested.", actor: "system", status: "success", evidence: { catalogVersion: CATALOG_VERSION } }, now));
  return session;
}

export function publicShoppingSession(session: ShoppingSessionSnapshot): ShoppingSessionSnapshot { return structuredClone(session); }
