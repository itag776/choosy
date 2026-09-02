import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { describe, expect, it } from "vitest";
import { investigateIncident } from "@/lib/recovery-agent";
import type { ActionId, IncidentEvidence, PaymentAttempt } from "@/lib/types";

loadEnvConfig(process.cwd(), true);

interface SealedCase {
  id: string;
  method: PaymentAttempt["method"];
  reason: string;
  source: string;
  observed: number;
  expected: ActionId;
  hypothesis: string;
}

const SEALED_CASES: SealedCase[] = [
  { id: "issuer_outage", method: "card", reason: "issuer_authentication_unavailable", source: "bank", observed: 0.31, expected: "multi_rail_link", hypothesis: "The card issuer is unavailable while alternate rails remain healthy." },
  { id: "temporary_timeout", method: "card", reason: "issuer_temporary_timeout", source: "bank", observed: 0.48, expected: "timed_retry", hypothesis: "The original issuer path is timing out temporarily and is expected to recover." },
  { id: "upi_degradation", method: "upi", reason: "upi_provider_degraded", source: "bank", observed: 0.29, expected: "multi_rail_link", hypothesis: "UPI is degraded, so a link with netbanking provides a distinct healthy rail." },
  { id: "customer_error", method: "card", reason: "incorrect_otp", source: "customer", observed: 0.54, expected: "observe_escalate", hypothesis: "The failures are customer-caused and do not justify a recovery campaign." },
  { id: "platform_degradation", method: "card", reason: "gateway_platform_unavailable", source: "platform", observed: 0.27, expected: "observe_escalate", hypothesis: "A platform-wide outage makes every outbound payment action unsafe." },
  { id: "upi_only", method: "card", reason: "issuer_bank_offline_netbanking_degraded", source: "bank", observed: 0.25, expected: "upi_only_link", hypothesis: "The card issuer and netbanking path are degraded while UPI remains healthy." },
  { id: "borderline", method: "card", reason: "issuer_authentication_degraded_low_confidence", source: "bank", observed: 0.84, expected: "observe_escalate", hypothesis: "The drop barely crosses the alert boundary and needs more evidence before contact." },
  { id: "bank_offline", method: "card", reason: "issuer_bank_offline", source: "bank", observed: 0.2, expected: "multi_rail_link", hypothesis: "The issuing bank is offline and alternate payment rails remain available." },
];

function inputFor(item: SealedCase): { incident: IncidentEvidence; eligible: PaymentAttempt[] } {
  const eligible = Array.from({ length: 80 }, (_, index): PaymentAttempt => ({
    id: `${item.id}_${index}`, customerId: `${item.id}_customer_${index}`, amountPaise: 40_000,
    method: item.method, issuer: "Sealed Issuer", status: "failed", errorReason: item.reason,
    errorSource: item.source, errorStep: "payment_authentication", consent: true, contactsLast24h: 0,
    createdAt: new Date(Date.UTC(2026, 7, 22, 12, 0, index)).toISOString(),
  }));
  const incident: IncidentEvidence = {
    id: `incident_${item.id}`, title: item.hypothesis,
    cohort: { issuer: "Sealed Issuer", method: item.method, errorStep: "payment_authentication", errorReason: item.reason },
    cohortQuery: `sealed:${item.id}`, affectedAttempts: 80, failedAttempts: 80,
    baselineSuccessRate: 0.964, observedSuccessRate: item.observed,
    deltaPercentagePoints: (0.964 - item.observed) * 100, incidentScore: item.observed < 0.5 ? 0.95 : 0.62,
    revenueAtRiskPaise: 3_200_000, topError: item.reason, detectedAt: "2026-08-22T12:05:00.000Z",
    thresholds: { minimumSample: 40, minimumDropPercentagePoints: 10 },
    competingHypotheses: [
      { id: "leading", label: item.hypothesis, support: 0.9, evidence: `${item.reason} originates from ${item.source}.`, disposition: "supported" },
      { id: "alternative", label: "Unrelated customer behavior", support: 0.1, evidence: "The failure concentration does not support this explanation.", disposition: "rejected" },
    ],
    source: "deterministic_detector",
  };
  return { incident, eligible };
}

function rulesBaseline(item: SealedCase): ActionId {
  if (item.reason.includes("timeout") || item.reason.includes("temporary")) return "timed_retry";
  return "multi_rail_link";
}

describe("sealed Gemini action-selection evaluation", () => {
  it("beats the rules baseline without seeing causal outcomes", async () => {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for npm run eval:agent.");
    let agentCorrect = 0;
    let baselineCorrect = 0;
    const decisions = [];
    for (const item of SEALED_CASES) {
      const result = await investigateIncident(inputFor(item));
      const top = [...result.rankedActions].sort((a, b) => a.rank - b.rank)[0]!.id;
      if (top === item.expected) agentCorrect += 1;
      if (rulesBaseline(item) === item.expected) baselineCorrect += 1;
      decisions.push({ id: item.id, expected: item.expected, top, decision: result.decision });
    }
    const agentAccuracy = agentCorrect / SEALED_CASES.length;
    const baselineAccuracy = baselineCorrect / SEALED_CASES.length;
    const datasetHash = createHash("sha256").update(JSON.stringify(SEALED_CASES)).digest("hex");
    process.stdout.write(`${JSON.stringify({ cases: SEALED_CASES.length, agentAccuracy, baselineAccuracy, datasetHash, decisions }, null, 2)}\n`);
    expect(agentAccuracy).toBeGreaterThanOrEqual(0.75);
    expect(agentAccuracy - baselineAccuracy).toBeGreaterThanOrEqual(0.1);
  }, 300_000);
});
