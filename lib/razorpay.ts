import { createHash } from "node:crypto";
import { z } from "zod";
import type { ExternalAction } from "@/lib/types";

const RazorpayPaymentLinkSchema = z.object({
  id: z.string().min(1),
  short_url: z.string().url(),
  reference_id: z.string(),
  amount: z.number().int().nonnegative(),
  status: z.enum(["created", "issued", "paid", "partially_paid", "cancelled", "expired"]),
});
type RazorpayPaymentLinkResponse = z.infer<typeof RazorpayPaymentLinkSchema>;

export function parsePaymentLinkList(value: unknown): RazorpayPaymentLinkResponse[] {
  return z.object({ payment_links: z.array(RazorpayPaymentLinkSchema) }).parse(value).payment_links;
}

function authHeader(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay Test Mode keys are not configured.");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export function stableReferenceId(runId: string, caseId: string): string {
  const digest = createHash("sha256").update(`${runId}:${caseId}`).digest("hex").slice(0, 18);
  return `rcv_${digest}`.slice(0, 40);
}

export function paymentLinkIntent(runId: string, caseId: string, amountPaise: number, now = new Date()): ExternalAction {
  const referenceId = stableReferenceId(runId, caseId);
  return {
    id: `ext_${referenceId}`, runId, type: "razorpay_payment_link", idempotencyKey: `payment_link:${referenceId}`,
    referenceId, caseId, amountPaise, status: "intent_recorded",
    notificationMedium: "email", notificationStatus: "pending",
    requestDigest: createHash("sha256").update(JSON.stringify({ referenceId, caseId, amountPaise, methods: ["upi", "netbanking"], notification: "email" })).digest("hex"),
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}

async function findPaymentLinkByReference(referenceId: string): Promise<RazorpayPaymentLinkResponse | null> {
  const response = await fetch(`https://api.razorpay.com/v1/payment_links?reference_id=${encodeURIComponent(referenceId)}&count=10`, {
    headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (!response.ok) return null;
  const links = parsePaymentLinkList(await response.json());
  return links.find((item) => item.reference_id === referenceId) ?? null;
}

function mergeProvider(action: ExternalAction, link: RazorpayPaymentLinkResponse): ExternalAction {
  return {
    ...action, providerId: link.id, shortUrl: link.short_url, providerStatus: link.status,
    status: link.status === "paid" ? "paid" : "created", updatedAt: new Date().toISOString(),
  };
}

export async function createOrReconcilePaymentLink(action: ExternalAction): Promise<ExternalAction> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return { ...action, status: "preview", failureReason: "Razorpay Test Mode keys are not configured; no external URL was fabricated.", updatedAt: new Date().toISOString() };
  }
  const recoveryEmail = process.env.RECOVERY_TEST_EMAIL?.trim();
  if (!recoveryEmail || !recoveryEmail.includes("@")) {
    return { ...action, status: "preview", notificationStatus: "failed", failureReason: "RECOVERY_TEST_EMAIL is not configured; no customer notification was attempted.", updatedAt: new Date().toISOString() };
  }

  const existing = await findPaymentLinkByReference(action.referenceId);
  if (existing) return mergeProvider(action, existing);

  try {
    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: action.amountPaise, currency: "INR", reference_id: action.referenceId,
        description: "Kept approved Test Mode recovery",
        expire_by: Math.floor(Date.now() / 1000) + 3_600, reminder_enable: false,
        customer: { email: recoveryEmail }, notify: { email: false, sms: false },
        notes: {
          recoveros_run_id: action.runId,
          recoveros_case_id: action.caseId,
          recoveros_reference_id: action.referenceId,
          environment: "test_mode",
        },
        options: { checkout: { method: { card: false, upi: true, netbanking: true, wallet: false } } },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Razorpay Payment Link creation failed (${response.status}): ${detail.slice(0, 240)}`);
    }
    return mergeProvider(action, RazorpayPaymentLinkSchema.parse(await response.json()));
  } catch (error) {
    const reconciled = await findPaymentLinkByReference(action.referenceId).catch(() => null);
    if (reconciled) return mergeProvider(action, reconciled);
    throw error;
  }
}

export function maskEmail(value: string): string {
  const [name, domain] = value.split("@");
  if (!name || !domain) return "configured recipient";
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

export async function sendPaymentLinkEmail(action: ExternalAction): Promise<ExternalAction> {
  if (action.status === "paid" || action.notificationStatus === "stopped") throw new Error("Customer contact is stopped after payment capture.");
  if (action.notificationStatus === "accepted") return action;
  if (!action.providerId) throw new Error("A Razorpay Payment Link must exist before notification.");
  const recoveryEmail = process.env.RECOVERY_TEST_EMAIL?.trim();
  if (!recoveryEmail) throw new Error("RECOVERY_TEST_EMAIL is not configured.");
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(action.providerId)}/notify_by/email`, {
    method: "POST", headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Razorpay email notification failed with status ${response.status}.`);
  const payload = z.object({ success: z.literal(true) }).parse(await response.json());
  const now = new Date().toISOString();
  return { ...action, notificationStatus: payload.success ? "accepted" : "failed", maskedRecipient: maskEmail(recoveryEmail), notificationAcceptedAt: now, updatedAt: now };
}

export async function fetchPaymentLink(id: string): Promise<RazorpayPaymentLinkResponse> {
  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader() }, signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Razorpay sync failed with status ${response.status}.`);
  return RazorpayPaymentLinkSchema.parse(await response.json());
}
