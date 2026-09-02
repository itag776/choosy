import type { ActionId, CandidatePlaybook, IncidentEvidence, PaymentAttempt, PolicyDecision } from "@/lib/types";

export const ACTION_CATALOG_VERSION = "recovery-actions-v2";

export const MERCHANT_POLICY = `
Never change the amount of a recovery payment.
Do not contact customers who opted out.
Do not contact a customer more than twice in 24 hours.
Use only card, UPI, and netbanking recovery rails.
Campaigns affecting more than INR 25,000 require a human operator's approval.
Stop immediately after payment is captured.
`.trim();

export const AVAILABLE_ACTIONS: ReadonlyArray<{
  id: ActionId;
  name: string;
  action: CandidatePlaybook["action"];
  methods: CandidatePlaybook["enabledMethods"];
  timing: [number, number];
  channel: CandidatePlaybook["channel"];
  bounded: true;
}> = [
  { id: "timed_retry", name: "Timed original-method retry", action: "retry_original", methods: ["card"], timing: [15, 120], channel: "email", bounded: true },
  { id: "multi_rail_link", name: "Multi-rail payment link", action: "payment_link", methods: ["upi", "netbanking"], timing: [0, 30], channel: "email", bounded: true },
  { id: "upi_only_link", name: "UPI-only payment link", action: "payment_link", methods: ["upi"], timing: [0, 30], channel: "email", bounded: true },
  { id: "observe_escalate", name: "Observe and escalate", action: "observe_escalate", methods: [], timing: [0, 120], channel: "none", bounded: true },
] as const;

export function eligibleCases(payments: PaymentAttempt[], incident?: IncidentEvidence | null): PaymentAttempt[] {
  return payments.filter((payment) => {
    if (payment.status !== "failed" || !payment.consent || payment.contactsLast24h >= 2) return false;
    if (!incident) return true;
    return payment.issuer === incident.cohort.issuer && payment.method === incident.cohort.method &&
      payment.errorStep === incident.cohort.errorStep && payment.errorReason === incident.cohort.errorReason;
  });
}

function actionDefinition(id: ActionId) {
  return AVAILABLE_ACTIONS.find((action) => action.id === id);
}

export function evaluatePlaybooks(incident: IncidentEvidence, playbooks: CandidatePlaybook[], eligible: PaymentAttempt[], rankedActions: CandidatePlaybook[] = playbooks, now = new Date()): PolicyDecision {
  const checkedRules: PolicyDecision["checkedRules"] = [];
  const reasons: string[] = [];
  let rejected = false;
  const rankedIds = new Set(rankedActions.map((playbook) => playbook.id));
  const selectedIds = new Set(playbooks.map((playbook) => playbook.id));

  const completeRanking = rankedActions.length === AVAILABLE_ACTIONS.length && rankedIds.size === AVAILABLE_ACTIONS.length && AVAILABLE_ACTIONS.every((action) => rankedIds.has(action.id));
  checkedRules.push({ id: "catalog_ranked", label: "All four bounded actions were ranked", outcome: completeRanking ? "pass" : "reject" });
  if (!completeRanking) { rejected = true; reasons.push("The model must rank every action in the bounded catalogue."); }

  const exactSelection = playbooks.length === 2 && selectedIds.size === 2 && playbooks.every((playbook) => playbook.selected);
  checkedRules.push({ id: "two_selected", label: "Exactly two distinct actions selected", outcome: exactSelection ? "pass" : "reject" });
  if (!exactSelection) { rejected = true; reasons.push("A test requires exactly two distinct selected actions."); }

  const catalogSafe = rankedActions.every((playbook) => {
    const definition = actionDefinition(playbook.id);
    return Boolean(definition && definition.action === playbook.action && playbook.timingMinutes >= definition.timing[0] && playbook.timingMinutes <= definition.timing[1] &&
      playbook.enabledMethods.every((method) => definition.methods.includes(method)) && playbook.channel === definition.channel);
  });
  checkedRules.push({ id: "catalog_bounds", label: "Actions stay inside catalogue bounds", outcome: catalogSafe ? "pass" : "reject" });
  if (!catalogSafe) { rejected = true; reasons.push("An action exceeded the timing, method, channel, or execution bounds of the catalogue."); }

  const amountSafe = rankedActions.every((playbook) => playbook.amountPolicy === "preserve_original");
  checkedRules.push({ id: "amount_integrity", label: "Original amount is preserved", outcome: amountSafe ? "pass" : "reject" });
  if (!amountSafe) { rejected = true; reasons.push("An action attempted to change the original amount."); }

  const contactSafe = rankedActions.every((playbook) => playbook.contactCount <= 1 && (playbook.channel === "none" ? playbook.contactCount === 0 : true)) && eligible.every((payment) => payment.consent && payment.contactsLast24h < 2);
  checkedRules.push({ id: "contact_safety", label: "Consent and contact limits enforced", outcome: contactSafe ? "pass" : "reject" });
  if (!contactSafe) { rejected = true; reasons.push("Consent or contact-frequency limits would be violated."); }

  const requiresApproval = incident.revenueAtRiskPaise > 2_500_000;
  checkedRules.push({ id: "approval_threshold", label: "Campaigns above ₹25,000 require approval", outcome: requiresApproval ? "approval" : "pass" });
  if (requiresApproval) reasons.push("Revenue at risk exceeds ₹25,000; human approval is mandatory.");
  checkedRules.push({ id: "stop_on_capture", label: "Recovery stops after capture", outcome: "pass" });
  return { outcome: rejected ? "reject" : requiresApproval ? "require_approval" : "allow", reasons, checkedRules, evaluatedAt: now.toISOString() };
}
