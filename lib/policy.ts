import type { CandidatePlaybook, IncidentEvidence, PaymentAttempt, PolicyDecision } from "@/lib/types";

const SUPPORTED_METHODS = new Set(["card", "upi", "netbanking"]);

export function evaluatePlaybooks(
  incident: IncidentEvidence,
  playbooks: CandidatePlaybook[],
  eligible: PaymentAttempt[],
): PolicyDecision {
  const reasons: string[] = [];

  if (playbooks.length !== 2) {
    return { outcome: "reject", reasons: ["Exactly two canary playbooks are required."], checkedRules: 6 };
  }

  if (playbooks.some((playbook) => playbook.enabledMethods.some((method) => !SUPPORTED_METHODS.has(method)))) {
    return { outcome: "reject", reasons: ["A playbook contains an unsupported payment method."], checkedRules: 6 };
  }

  if (eligible.some((payment) => !payment.consent || payment.contactsLast24h >= 2)) {
    reasons.push("Ineligible customers were excluded before random assignment.");
  }

  if (incident.revenueAtRisk > 25_000) {
    reasons.push("Revenue at risk exceeds the INR 25,000 approval threshold.");
  }

  reasons.push("Amounts are immutable and every campaign stops after capture.");

  return {
    outcome: incident.revenueAtRisk > 25_000 ? "require_approval" : "allow",
    reasons,
    checkedRules: 6,
  };
}

export function eligibleCases(payments: PaymentAttempt[]): PaymentAttempt[] {
  return payments.filter(
    (payment) =>
      payment.status === "failed" &&
      payment.issuer === "Issuer A" &&
      payment.consent &&
      payment.contactsLast24h < 2,
  );
}
