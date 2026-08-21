import { DEMO_INCIDENT_ID } from "@/lib/demo-data";
import type { IncidentEvidence, PaymentAttempt } from "@/lib/types";

export function detectIncident(payments: PaymentAttempt[], now = new Date()): IncidentEvidence | null {
  const affected = payments.filter(
    (payment) =>
      payment.method === "card" &&
      payment.issuer === "Issuer A" &&
      payment.errorReason === "issuer_authentication_unavailable",
  );

  if (affected.length < 20) return null;

  const failures = affected.filter((payment) => payment.status === "failed");
  const observedSuccessRate = (affected.length - failures.length) / affected.length;
  const baselineSuccessRate = 0.964;
  const delta = baselineSuccessRate - observedSuccessRate;

  if (delta < 0.15) return null;

  return {
    id: DEMO_INCIDENT_ID,
    title: "Issuer authentication degradation",
    affectedCohort: "Issuer A · card · payment authentication",
    affectedAttempts: affected.length,
    failedAttempts: failures.length,
    baselineSuccessRate,
    observedSuccessRate,
    deltaPercentagePoints: delta * 100,
    confidence: 0.997,
    revenueAtRisk: failures.reduce((sum, payment) => sum + payment.amount, 0),
    topError: "issuer_authentication_unavailable",
    detectedAt: now.toISOString(),
    source: "deterministic_detector",
  };
}
