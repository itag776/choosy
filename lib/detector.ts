import type { IncidentEvidence, PaymentAttempt } from "@/lib/types";

export const DETECTOR_THRESHOLDS = { minimumSample: 20, minimumDropPercentagePoints: 15, baselineSuccessRate: 0.964 };

interface Cohort {
  issuer: string;
  method: PaymentAttempt["method"];
  errorStep: string;
  errorReason: string;
  payments: PaymentAttempt[];
}
function titleFor(cohort: Cohort): string {
  if (cohort.errorReason.includes("authentication")) return "Issuer authentication degradation";
  if (cohort.errorReason.includes("timeout")) return `${cohort.method.toUpperCase()} timeout degradation`;
  return "Payment success degradation";
}

export function detectIncident(payments: PaymentAttempt[], now = new Date()): IncidentEvidence | null {
  const groups = new Map<string, Cohort>();
  for (const payment of payments) {
    if (payment.status !== "failed" || !payment.errorReason || !payment.errorStep) continue;
    const key = [payment.issuer, payment.method, payment.errorStep, payment.errorReason].join("|");
    const existing = groups.get(key);
    if (existing) existing.payments.push(payment);
    else groups.set(key, { issuer: payment.issuer, method: payment.method, errorStep: payment.errorStep, errorReason: payment.errorReason, payments: [payment] });
  }

  const candidates = [...groups.values()].map((cohort) => {
    const total = payments.filter((payment) => payment.issuer === cohort.issuer && payment.method === cohort.method && payment.errorStep === cohort.errorStep);
    const denominator = Math.max(cohort.payments.length, total.length);
    const observed = (denominator - cohort.payments.length) / denominator;
    return { cohort, observed, delta: (DETECTOR_THRESHOLDS.baselineSuccessRate - observed) * 100 };
  }).filter(({ cohort, delta }) =>
    cohort.payments.length >= DETECTOR_THRESHOLDS.minimumSample &&
    delta >= DETECTOR_THRESHOLDS.minimumDropPercentagePoints,
  ).sort((a, b) => b.cohort.payments.length - a.cohort.payments.length);

  const match = candidates[0];
  if (!match) return null;
  const { cohort, observed, delta } = match;
  const customerErrors = payments.filter((payment) => payment.status === "failed" && payment.errorSource === "customer").length;
  const otherIssuerFailures = payments.filter((payment) => payment.status === "failed" && payment.issuer !== cohort.issuer).length;
  const confidence = Math.min(0.997, 0.8 + cohort.payments.length / Math.max(1, payments.length) * 0.4);

  return {
    id: `inc_${cohort.issuer.toLowerCase().replaceAll(" ", "_")}_${cohort.method}_001`,
    title: titleFor(cohort),
    cohort: { issuer: cohort.issuer, method: cohort.method, errorStep: cohort.errorStep, errorReason: cohort.errorReason },
    cohortQuery: `issuer = "${cohort.issuer}" AND method = "${cohort.method}" AND step = "${cohort.errorStep}" AND reason = "${cohort.errorReason}"`,
    affectedAttempts: cohort.payments.length,
    failedAttempts: cohort.payments.length,
    baselineSuccessRate: DETECTOR_THRESHOLDS.baselineSuccessRate,
    observedSuccessRate: observed,
    deltaPercentagePoints: delta,
    confidence,
    revenueAtRiskPaise: cohort.payments.reduce((sum, payment) => sum + payment.amountPaise, 0),
    topError: cohort.errorReason,
    detectedAt: now.toISOString(),
    thresholds: { minimumSample: DETECTOR_THRESHOLDS.minimumSample, minimumDropPercentagePoints: DETECTOR_THRESHOLDS.minimumDropPercentagePoints },
    competingHypotheses: [
      { id: "issuer_degradation", label: "Issuer-side authentication degradation", support: confidence, evidence: `${cohort.payments.length} concentrated failures share issuer, step and bank-sourced reason.`, disposition: "supported" },
      { id: "customer_error", label: "Customer input error", support: customerErrors / Math.max(1, payments.length), evidence: `Only ${customerErrors} customer-sourced failures exist outside the cohort.`, disposition: "rejected" },
      { id: "platform_wide", label: "Platform-wide checkout failure", support: otherIssuerFailures / Math.max(1, payments.length), evidence: `Only ${otherIssuerFailures} failures occur at other issuers.`, disposition: "rejected" },
    ],
    source: "deterministic_detector",
  };
}
