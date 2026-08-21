import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { MERCHANT_POLICY } from "@/lib/demo-data";
import type { AgentAnalysis, CandidatePlaybook, IncidentEvidence } from "@/lib/types";

const PlaybookSchema = z.object({
  id: z.enum(["wait_retry", "alternate_link"]),
  name: z.string(),
  action: z.enum(["retry_original", "payment_link"]),
  timingMinutes: z.number().int().min(0).max(1_440),
  enabledMethods: z.array(z.enum(["card", "upi", "netbanking"])),
  targetCohort: z.string(),
  rationale: z.string(),
  risks: z.array(z.string()),
  contactCount: z.number().int().min(0).max(2),
});

const AgentOutputSchema = z.object({
  hypothesis: z.string(),
  recommendation: z.string(),
  uncertainty: z.string(),
  playbooks: z.array(PlaybookSchema).length(2),
});

const fallbackPlaybooks: CandidatePlaybook[] = [
  {
    id: "wait_retry",
    name: "Timed issuer retry",
    action: "retry_original",
    timingMinutes: 30,
    enabledMethods: ["card"],
    targetCohort: "Eligible Issuer A card failures",
    rationale: "Wait for a possible issuer recovery, then retry without changing the payment amount.",
    risks: ["The issuer may remain degraded", "A repeated card attempt can create customer fatigue"],
    contactCount: 1,
  },
  {
    id: "alternate_link",
    name: "Alternate-method recovery link",
    action: "payment_link",
    timingMinutes: 0,
    enabledMethods: ["upi", "netbanking"],
    targetCohort: "Eligible Issuer A card failures",
    rationale: "Bypass the degraded card path with a bounded link offering UPI and netbanking.",
    risks: ["Customers must complete a new checkout", "A twelve-case canary has wide uncertainty"],
    contactCount: 1,
  },
];

export function fallbackAnalysis(): AgentAnalysis {
  return {
    mode: "deterministic_fallback",
    hypothesis:
      "A concentrated authentication failure pattern is isolated to Issuer A card attempts; customer-caused errors do not explain the cohort shift.",
    recommendation:
      "Run a randomized twelve-case canary comparing a delayed issuer retry with an alternate-method payment link, then require approval before expanding the winner.",
    uncertainty:
      "The replay proves workflow behavior, not real-world causal uplift. Canary results must remain separately labelled.",
    playbooks: fallbackPlaybooks,
    toolsUsed: ["getIncidentEvidence", "readMerchantRecoveryPolicy", "listEligibleCases"],
  };
}

export async function analyzeWithRecoveryAgent(input: {
  incident: IncidentEvidence;
  eligibleCount: number;
}): Promise<AgentAnalysis> {
  if (!process.env.OPENAI_API_KEY) return fallbackAnalysis();

  const getIncidentEvidence = tool({
    name: "getIncidentEvidence",
    description: "Return measured payment incident evidence. Always call this before proposing a recovery action.",
    parameters: z.object({ incidentId: z.string() }),
    execute: async () => input.incident,
  });

  const readMerchantRecoveryPolicy = tool({
    name: "readMerchantRecoveryPolicy",
    description: "Read the merchant's plain-language recovery policy and approval constraints.",
    parameters: z.object({ merchantId: z.string() }),
    execute: async () => ({ merchantId: "merchant_demo", policy: MERCHANT_POLICY }),
  });

  const listEligibleCases = tool({
    name: "listEligibleCases",
    description: "Return the count of failed cases remaining after consent and contact-limit filters.",
    parameters: z.object({ incidentId: z.string() }),
    execute: async () => ({ eligibleCount: input.eligibleCount, excludedCount: input.incident.failedAttempts - input.eligibleCount }),
  });

  const agent = new Agent({
    name: "RecoverOS Incident Commander",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    instructions: `You are a payment recovery incident commander. Investigate with all three tools before answering.
Generate exactly two bounded canary playbooks: wait_retry and alternate_link. Never alter the amount, invent a payment method, contact opted-out customers, or exceed contact limits. Alternate links may only enable UPI and netbanking. Be explicit that replay results are not real merchant revenue.`,
    tools: [getIncidentEvidence, readMerchantRecoveryPolicy, listEligibleCases],
    outputType: AgentOutputSchema,
  });

  try {
    const result = await run(
      agent,
      `Investigate incident ${input.incident.id} for merchant_demo and propose the governed canary.`,
      { maxTurns: 8 },
    );

    if (!result.finalOutput) return fallbackAnalysis();

    return {
      mode: "openai_agent",
      ...result.finalOutput,
      toolsUsed: ["getIncidentEvidence", "readMerchantRecoveryPolicy", "listEligibleCases"],
    };
  } catch (error) {
    console.error("RecoverOS agent fallback", error);
    return fallbackAnalysis();
  }
}
