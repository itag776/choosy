import { createHash } from "node:crypto";
import type { ActionId, InterventionOutcome, PaymentAttempt } from "@/lib/types";

export const CAUSAL_MODEL_VERSION = "causal-recovery-v2";

export const CAUSAL_MODEL = {
  issuer_outage: { timed_retry: 0.38, multi_rail_link: 0.72, upi_only_link: 0.63, observe_escalate: 0, baseline_generic: 0.29 },
  temporary_timeout: { timed_retry: 0.68, multi_rail_link: 0.51, upi_only_link: 0.46, observe_escalate: 0, baseline_generic: 0.36 },
  upi_degradation: { timed_retry: 0.12, multi_rail_link: 0.58, upi_only_link: 0.18, observe_escalate: 0, baseline_generic: 0.23 },
  customer_error: { timed_retry: 0.24, multi_rail_link: 0.2, upi_only_link: 0.17, observe_escalate: 0, baseline_generic: 0.22 },
  platform_degradation: { timed_retry: 0.2, multi_rail_link: 0.21, upi_only_link: 0.19, observe_escalate: 0, baseline_generic: 0.2 },
} as const;

type Cause = keyof typeof CAUSAL_MODEL;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function causalModelDigest(): string {
  return createHash("sha256").update(stableJson({ version: CAUSAL_MODEL_VERSION, model: CAUSAL_MODEL })).digest("hex");
}

export function inferLatentCause(payment: PaymentAttempt): Cause {
  const reason = `${payment.errorReason ?? ""} ${payment.errorSource ?? ""}`.toLowerCase();
  if (reason.includes("incorrect") || reason.includes("customer")) return "customer_error";
  if (reason.includes("timeout") || reason.includes("temporary") || reason.includes("rate_limit")) return "temporary_timeout";
  if (payment.method === "upi") return "upi_degradation";
  if (reason.includes("platform") || reason.includes("gateway")) return "platform_degradation";
  return "issuer_outage";
}

function draw(seed: number, caseId: string, actionId: ActionId | "baseline_generic"): number {
  const hex = createHash("sha256").update(`${CAUSAL_MODEL_VERSION}:${seed}:${caseId}:${actionId}`).digest("hex").slice(0, 13);
  return Number.parseInt(hex, 16) / 0x1fffffffffffff;
}

export function generateCausalOutcomes(payments: PaymentAttempt[], seed: number): Map<string, InterventionOutcome> {
  const actionIds: Array<ActionId | "baseline_generic"> = ["timed_retry", "multi_rail_link", "upi_only_link", "observe_escalate", "baseline_generic"];
  return new Map(payments.map((payment) => {
    const probabilities = CAUSAL_MODEL[inferLatentCause(payment)];
    const outcomes = Object.fromEntries(actionIds.map((actionId) => [actionId, draw(seed, payment.id, actionId) < probabilities[actionId]])) as InterventionOutcome["outcomes"];
    return [payment.id, { caseId: payment.id, outcomes }];
  }));
}
