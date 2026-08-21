import { createHash } from "node:crypto";
import { runLockedBenchmark } from "@/lib/benchmark";
import type { AuditEvent, DashboardState, PaymentAttempt } from "@/lib/types";

export const DEMO_SEED = 20260905;
export const DEMO_INCIDENT_ID = "inc_issuer_a_auth_001";
export const DEMO_CAMPAIGN_ID = "cmp_canary_001";
export const MERCHANT_POLICY = `
Never change the amount of a recovery payment.
Do not contact customers who opted out.
Do not contact a customer more than twice in 24 hours.
During issuer incidents, prefer a safe alternate payment method over repeatedly retrying the degraded method.
Campaigns affecting more than INR 25,000 require a human operator's approval.
Stop immediately after payment is captured.
`;

function audit(
  title: string,
  detail: string,
  status: AuditEvent["status"] = "info",
): AuditEvent {
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: "demo",
    title,
    detail,
    actor: "system",
    status,
    createdAt: new Date().toISOString(),
  };
}

export function generatePayments(now = new Date()): PaymentAttempt[] {
  const payments: PaymentAttempt[] = [];
  const incidentStart = now.getTime() - 6 * 60 * 1000;

  for (let index = 0; index < 240; index += 1) {
    const affected = index < 120;
    const amount = affected ? 4_000 : 2_400 + ((index * 137) % 4_000);
    payments.push({
      id: `pay_demo_${String(index + 1).padStart(3, "0")}`,
      customerId: `cus_${String(index + 1).padStart(3, "0")}`,
      amount,
      method: affected ? "card" : index % 3 === 0 ? "upi" : "card",
      issuer: affected ? "Issuer A" : index % 2 === 0 ? "Issuer B" : "Issuer C",
      status: affected ? "failed" : index % 28 === 0 ? "failed" : "captured",
      errorReason: affected ? "issuer_authentication_unavailable" : index % 28 === 0 ? "incorrect_otp" : null,
      errorSource: affected ? "bank" : index % 28 === 0 ? "customer" : null,
      errorStep: affected ? "payment_authentication" : index % 28 === 0 ? "payment_authentication" : null,
      consent: index % 41 !== 0,
      contactsLast24h: index % 47 === 0 ? 2 : 0,
      createdAt: new Date(incidentStart + index * 1_250).toISOString(),
    });
  }

  return payments;
}

export function createInitialState(): DashboardState {
  const manifest = JSON.stringify({
    seed: DEMO_SEED,
    cases: 240,
    families: ["issuer_auth", "upi_timeout", "incorrect_otp", "cancelled_mandate"],
    holdoutPercent: 30,
  });

  return {
    phase: "idle",
    payments: [],
    incident: null,
    campaign: null,
    ledger: {
      simulatedAmount: 0,
      baselineAmount: 168_000,
      razorpayTestAmount: 0,
      simulatedCases: 0,
      testModeCases: 0,
    },
    metrics: runLockedBenchmark(),
    audit: [
      audit(
        "Recovery control plane ready",
        "Fixed-seed replay loaded. Synthetic and Razorpay Test Mode ledgers are isolated.",
        "success",
      ),
    ],
    processedWebhookIds: [],
    integration: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      persistence: process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "memory",
    },
    dataset: {
      name: "RecoverOS Payment Incident Replay",
      version: "1.0.0",
      seed: DEMO_SEED,
      manifestHash: createHash("sha256").update(manifest).digest("hex").slice(0, 16),
      totalAttempts: 240,
      holdoutPercent: 30,
    },
  };
}
