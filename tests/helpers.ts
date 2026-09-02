import { ACTION_CATALOG_VERSION, AVAILABLE_ACTIONS } from "@/lib/policy";
import { AGENT_PROMPT_VERSION, agentInputDigest, PINNED_AGENT_MODEL } from "@/lib/recovery-agent";
import type { CandidatePlaybook, IncidentEvidence, InvestigationResult, PaymentAttempt } from "@/lib/types";

export function testInvestigation(incident: IncidentEvidence, eligible: PaymentAttempt[]): InvestigationResult {
  const rankedActions: CandidatePlaybook[] = AVAILABLE_ACTIONS.map((definition, index) => ({
    id: definition.id,
    name: definition.name,
    action: definition.action,
    timingMinutes: definition.id === "timed_retry" ? 30 : 0,
    enabledMethods: [...definition.methods],
    targetCohort: `Eligible ${incident.cohort.issuer} ${incident.cohort.method} failures`,
    rationale: `Test decision ranks ${definition.name} against the measured incident evidence.`,
    risks: ["Synthetic outcomes do not estimate live merchant lift."],
    contactCount: definition.channel === "none" ? 0 : 1,
    amountPolicy: "preserve_original",
    channel: definition.channel,
    rank: index + 1,
    selected: definition.id === "timed_retry" || definition.id === "multi_rail_link",
  }));
  return {
    mode: "gemini_agent",
    model: PINNED_AGENT_MODEL,
    inputDigest: agentInputDigest({ incident, eligible }),
    promptVersion: AGENT_PROMPT_VERSION,
    catalogVersion: ACTION_CATALOG_VERSION,
    decision: "test",
    primaryHypothesis: "Issuer authentication degradation is concentrated in the measured card cohort.",
    supportingEvidence: ["Failures share issuer and authentication step.", "Observed success fell materially below baseline."],
    rejectedHypotheses: ["Customer error does not explain the concentrated bank-source failures."],
    uncertainty: "The causal replay validates software decisions, not live merchant uplift.",
    eligibleCaseCount: eligible.length,
    playbooks: rankedActions.filter((action) => action.selected),
    rankedActions,
    rejectedActionReasons: rankedActions.filter((action) => !action.selected).map((action) => ({ actionId: action.id, reason: "A more distinct action pair provides a clearer causal comparison." })),
    toolEvents: ["getIncidentEvidence", "readMerchantRecoveryPolicy", "listEligibleCases", "inspectAvailableActions", "compareFailureExplanations"].map((name) => ({ name, status: "completed", summary: "Typed read tool completed." })),
    responseId: "response_test",
    semanticValidation: "passed",
  };
}
