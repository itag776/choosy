import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { AVAILABLE_ACTIONS, MERCHANT_POLICY } from "@/lib/policy";
import type { CanaryResult, CandidatePlaybook, IncidentEvidence, InvestigationResult, PaymentAttempt, PromotionRecommendation, ToolEvidence } from "@/lib/types";

export const PINNED_AGENT_MODEL = "gpt-5.4-mini-2026-03-17";
const REQUIRED_INVESTIGATION_TOOLS = [
  "getIncidentEvidence", "readMerchantRecoveryPolicy", "listEligibleCases",
  "inspectAvailableActions", "compareFailureExplanations",
] as const;

const PlaybookSchema = z.object({
  id: z.enum(["wait_retry", "alternate_link"]),
  name: z.string().min(3).max(100),
  action: z.enum(["retry_original", "payment_link"]),
  timingMinutes: z.number().int().min(0).max(1_440),
  enabledMethods: z.array(z.enum(["card", "upi", "netbanking"])).min(1),
  targetCohort: z.string().min(3),
  rationale: z.string().min(10),
  risks: z.array(z.string().min(3)).min(1).max(4),
  contactCount: z.number().int().min(0).max(1),
  amountPolicy: z.literal("preserve_original"),
});

const InvestigationSchema = z.object({
  primaryHypothesis: z.string().min(10),
  supportingEvidence: z.array(z.string().min(5)).min(2).max(6),
  rejectedHypotheses: z.array(z.string().min(5)).min(1).max(5),
  uncertainty: z.string().min(10),
  eligibleCaseCount: z.number().int().nonnegative(),
  playbooks: z.array(PlaybookSchema).length(2),
});

const PromotionSchema = z.object({
  recommendation: z.enum(["promote", "extend_canary", "stop", "escalate"]),
  playbookId: z.enum(["wait_retry", "alternate_link"]).nullable(),
  evidence: z.array(z.string().min(5)).min(2).max(6),
  reason: z.string().min(10),
  uncertainty: z.string().min(10),
  stoppingConditions: z.array(z.string().min(5)).min(2).max(5),
});

function fallbackPlaybooks(incident: IncidentEvidence): CandidatePlaybook[] {
  const cohort = `Eligible ${incident.cohort.issuer} ${incident.cohort.method} failures`;
  return [
    {
      id: "wait_retry", name: "Timed issuer retry", action: "retry_original", timingMinutes: 30,
      enabledMethods: ["card"], targetCohort: cohort,
      rationale: "Wait for a possible issuer recovery, then retry the original method without changing the amount.",
      risks: ["The issuer may remain degraded", "Another card attempt can create customer fatigue"],
      contactCount: 1, amountPolicy: "preserve_original",
    },
    {
      id: "alternate_link", name: "Alternate-method recovery link", action: "payment_link", timingMinutes: 0,
      enabledMethods: ["upi", "netbanking"], targetCohort: cohort,
      rationale: "Bypass the degraded card path with a bounded payment link offering UPI and netbanking.",
      risks: ["Customers must complete a new checkout", "A twelve-case canary has wide uncertainty"],
      contactCount: 1, amountPolicy: "preserve_original",
    },
  ];
}

function deterministicToolEvents(incident: IncidentEvidence, eligibleCount: number): ToolEvidence[] {
  return [
    { name: "getIncidentEvidence", status: "completed", summary: `${incident.failedAttempts} failures; ${incident.deltaPercentagePoints.toFixed(1)}pp drop.` },
    { name: "readMerchantRecoveryPolicy", status: "completed", summary: "Six deterministic recovery constraints loaded." },
    { name: "listEligibleCases", status: "completed", summary: `${eligibleCount} cases remain after consent and contact limits.` },
    { name: "inspectAvailableActions", status: "completed", summary: "Retry and Standard Payment Link actions are available." },
    { name: "compareFailureExplanations", status: "completed", summary: "Issuer degradation outranks customer and platform-wide explanations." },
  ];
}

export function fallbackInvestigation(incident: IncidentEvidence, eligibleCount: number): InvestigationResult {
  return {
    mode: "deterministic_fallback", model: "deterministic-policy-v1",
    primaryHypothesis: `A concentrated ${incident.cohort.errorStep} failure is isolated to ${incident.cohort.issuer}; customer-caused errors do not explain the shift.`,
    supportingEvidence: [
      `${incident.failedAttempts} failures share issuer, method, step and reason.`,
      `Success fell ${incident.deltaPercentagePoints.toFixed(1)} percentage points from the measured baseline.`,
    ],
    rejectedHypotheses: incident.competingHypotheses.filter((item) => item.disposition === "rejected").map((item) => `${item.label}: ${item.evidence}`),
    uncertainty: "Deterministic replay validates workflow behavior, not causal real-world uplift.",
    eligibleCaseCount: eligibleCount,
    playbooks: fallbackPlaybooks(incident),
    toolEvents: deterministicToolEvents(incident, eligibleCount),
    semanticValidation: "fallback",
  };
}

function captureToolEvents(result: { newItems: Array<{ toJSON(): unknown }> }): ToolEvidence[] {
  const calls: ToolEvidence[] = [];
  for (const item of result.newItems) {
    const serialized = item.toJSON() as { rawItem?: { type?: string; name?: string; callId?: string; status?: string } };
    const raw = serialized.rawItem;
    if (raw?.type === "function_call" && raw.name) {
      calls.push({ name: raw.name, callId: raw.callId, status: raw.status === "incomplete" ? "failed" : "completed", summary: "Typed read tool completed." });
    }
  }
  return calls;
}

function validInvestigation(output: z.infer<typeof InvestigationSchema>, tools: ToolEvidence[], eligibleCount: number): boolean {
  const ids = new Set(output.playbooks.map((playbook) => playbook.id));
  const toolNames = new Set(tools.map((item) => item.name));
  return output.playbooks.length === 2 && ids.size === 2 && ids.has("wait_retry") && ids.has("alternate_link") &&
    output.eligibleCaseCount === eligibleCount &&
    output.playbooks.every((playbook) =>
      playbook.amountPolicy === "preserve_original" &&
      playbook.enabledMethods.every((method) => ["card", "upi", "netbanking"].includes(method)),
    ) &&
    REQUIRED_INVESTIGATION_TOOLS.every((name) => toolNames.has(name));
}

export async function investigateIncident(input: { incident: IncidentEvidence; eligible: PaymentAttempt[] }): Promise<InvestigationResult> {
  const fallback = fallbackInvestigation(input.incident, input.eligible.length);
  if (!process.env.OPENAI_API_KEY) return fallback;

  const tools = [
    tool({ name: "getIncidentEvidence", description: "Return measured incident evidence.", parameters: z.object({ incidentId: z.string() }), execute: async () => input.incident }),
    tool({ name: "readMerchantRecoveryPolicy", description: "Read the merchant recovery policy.", parameters: z.object({ merchantId: z.string() }), execute: async () => ({ merchantId: "merchant_demo", policy: MERCHANT_POLICY }) }),
    tool({ name: "listEligibleCases", description: "Count cases after consent and contact limits.", parameters: z.object({ incidentId: z.string() }), execute: async () => ({ eligibleCaseCount: input.eligible.length, excludedCount: input.incident.failedAttempts - input.eligible.length }) }),
    tool({ name: "inspectAvailableActions", description: "List the only actions the product can safely execute.", parameters: z.object({ incidentId: z.string() }), execute: async () => AVAILABLE_ACTIONS }),
    tool({ name: "compareFailureExplanations", description: "Compare measured competing incident explanations.", parameters: z.object({ incidentId: z.string() }), execute: async () => input.incident.competingHypotheses }),
  ];

  const agent = new Agent({
    name: "RecoverOS Incident Commander", model: PINNED_AGENT_MODEL, tools, outputType: InvestigationSchema,
    instructions: `Investigate a payment incident. Call all five tools before answering. Return exactly two bounded playbooks: wait_retry and alternate_link. Preserve every amount, use only supported methods, never target ineligible customers, and be explicit about uncertainty. Do not claim simulated money is real revenue.`,
  });

  try {
    const result = await run(agent, `Investigate ${input.incident.id} for merchant_demo.`, {
      maxTurns: 6, signal: AbortSignal.timeout(20_000),
    });
    if (!result.finalOutput) return fallback;
    const parsed = InvestigationSchema.parse(result.finalOutput);
    const toolEvents = captureToolEvents(result);
    if (!validInvestigation(parsed, toolEvents, input.eligible.length)) return fallback;
    return {
      mode: "openai_agent", model: PINNED_AGENT_MODEL, ...parsed, toolEvents,
      responseId: result.lastResponseId, semanticValidation: "passed",
    };
  } catch (error) {
    console.error("RecoverOS investigation fallback", error);
    return fallback;
  }
}

export function fallbackPromotion(canary: CanaryResult): PromotionRecommendation {
  const winner = canary.results.find((result) => result.playbookId === canary.winnerId)!;
  const challenger = canary.results.find((result) => result.playbookId !== canary.winnerId)!;
  return {
    mode: "deterministic_fallback", model: "deterministic-policy-v1", recommendation: "promote",
    playbookId: canary.winnerId,
    evidence: [
      `${winner.recovered}/${winner.attempted} recovered for ${winner.playbookId}.`,
      `${challenger.recovered}/${challenger.attempted} recovered for ${challenger.playbookId}.`,
    ],
    reason: "Promote the measured winner while preserving approval and stop conditions.",
    uncertainty: canary.sampleWarning,
    stoppingConditions: ["Stop after payment capture", "Stop on any policy violation", "Escalate if provider state cannot be reconciled"],
    toolEvents: [{ name: "getCanaryResults", status: "completed", summary: "Persisted assignments and measured replay outcomes read." }],
    semanticValidation: "fallback",
  };
}

export async function evaluatePromotion(canary: CanaryResult): Promise<PromotionRecommendation> {
  const fallback = fallbackPromotion(canary);
  if (!process.env.OPENAI_API_KEY) return fallback;
  const getCanaryResults = tool({
    name: "getCanaryResults", description: "Read persisted canary assignments and measured results.",
    parameters: z.object({ campaignId: z.string() }), execute: async () => canary,
  });
  const agent = new Agent({
    name: "RecoverOS Incident Commander", model: PINNED_AGENT_MODEL, tools: [getCanaryResults], outputType: PromotionSchema,
    instructions: "Call getCanaryResults. Recommend promote, extend_canary, stop, or escalate. Never treat a 12-case canary as statistically conclusive. If promoting, select only the measured winner and preserve stopping conditions.",
  });
  try {
    const result = await run(agent, "Evaluate the completed canary for promotion.", {
      maxTurns: 4, signal: AbortSignal.timeout(20_000),
    });
    if (!result.finalOutput) return fallback;
    const parsed = PromotionSchema.parse(result.finalOutput);
    const toolEvents = captureToolEvents(result);
    const valid = toolEvents.some((item) => item.name === "getCanaryResults") &&
      (parsed.recommendation !== "promote" || parsed.playbookId === canary.winnerId);
    if (!valid) return fallback;
    return { mode: "openai_agent", model: PINNED_AGENT_MODEL, ...parsed, toolEvents, responseId: result.lastResponseId, semanticValidation: "passed" };
  } catch (error) {
    console.error("RecoverOS promotion fallback", error);
    return fallback;
  }
}
