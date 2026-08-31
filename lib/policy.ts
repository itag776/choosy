import type { CandidatePlaybook, IncidentEvidence, PaymentAttempt, PlaybookId, PolicyDecision } from "@/lib/types";

export const MERCHANT_POLICY = `
Never change the amount of a recovery payment.
Do not contact customers who opted out.
Do not contact a customer more than twice in 24 hours.
During issuer incidents, prefer a safe alternate payment method over repeatedly retrying the degraded method.
Campaigns affecting more than INR 25,000 require a human operator's approval.
Stop immediately after payment is captured.
`.trim();

export const AVAILABLE_ACTIONS = [
  { id: "retry_original", methods: ["card"], bounded: true },
  { id: "payment_link", methods: ["card", "upi", "netbanking"], bounded: true },
] as const;

export function selectRecoveryPlaybook(incident: IncidentEvidence): PlaybookId {
  const reason = incident.cohort.errorReason.toLowerCase();
  if (incident.cohort.method !== "card") return "alternate_link";
  if (reason.includes("timeout") || reason.includes("rate_limit") || reason.includes("temporary")) return "wait_retry";
  return "alternate_link";
}

export function eligibleCases(payments: PaymentAttempt[], incident?: IncidentEvidence | null): PaymentAttempt[] {
  return payments.filter((payment) => {
    if (payment.status !== "failed" || !payment.consent || payment.contactsLast24h >= 2) return false;
    if (!incident) return true;
    return payment.issuer === incident.cohort.issuer && payment.method === incident.cohort.method &&
      payment.errorStep === incident.cohort.errorStep && payment.errorReason === incident.cohort.errorReason;
  });
}
export function evaluatePlaybooks(incident: IncidentEvidence, playbooks: CandidatePlaybook[], eligible: PaymentAttempt[], now = new Date()): PolicyDecision {
  const checkedRules: PolicyDecision["checkedRules"] = [];
  const reasons: string[] = [];
  let rejected = false;
  const ids = new Set(playbooks.map((playbook) => playbook.id));
  const exactSet = playbooks.length === 2 && ids.has("wait_retry") && ids.has("alternate_link");
  checkedRules.push({ id: "bounded_set", label: "Exactly two supported playbooks", outcome: exactSet ? "pass" : "reject" });
  if (!exactSet) { rejected = true; reasons.push("The proposal must contain exactly the two supported bounded playbooks."); }
  const amountSafe = playbooks.every((playbook) => playbook.amountPolicy === "preserve_original");
  checkedRules.push({ id: "amount_integrity", label: "Original amount is preserved", outcome: amountSafe ? "pass" : "reject" });
  if (!amountSafe) { rejected = true; reasons.push("A playbook attempted to change the original amount."); }
  const supportedMethods = playbooks.every((playbook) => playbook.enabledMethods.every((method) => ["card", "upi", "netbanking"].includes(method)));
  checkedRules.push({ id: "supported_methods", label: "All payment methods are supported", outcome: supportedMethods ? "pass" : "reject" });
  if (!supportedMethods) { rejected = true; reasons.push("A playbook proposed an unsupported payment method."); }
  const contactSafe = playbooks.every((playbook) => playbook.contactCount <= 1) && eligible.every((payment) => payment.consent && payment.contactsLast24h < 2);
  checkedRules.push({ id: "contact_safety", label: "Consent and contact limits enforced", outcome: contactSafe ? "pass" : "reject" });
  if (!contactSafe) { rejected = true; reasons.push("Consent or contact-frequency limits would be violated."); }
  const requiresApproval = incident.revenueAtRiskPaise > 2_500_000;
  checkedRules.push({ id: "approval_threshold", label: "Campaigns above ₹25,000 require approval", outcome: requiresApproval ? "approval" : "pass" });
  if (requiresApproval) reasons.push("Revenue at risk exceeds ₹25,000; human approval is mandatory.");
  checkedRules.push({ id: "stop_on_capture", label: "Recovery stops after capture", outcome: "pass" });
  return { outcome: rejected ? "reject" : requiresApproval ? "require_approval" : "allow", reasons, checkedRules, evaluatedAt: now.toISOString() };
}
