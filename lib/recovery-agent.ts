import { createHash } from "node:crypto";
import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { ACTION_CATALOG_VERSION, AVAILABLE_ACTIONS, MERCHANT_POLICY } from "@/lib/policy";
import type { CanaryResult, CandidatePlaybook, IncidentEvidence, InvestigationResult, PaymentAttempt, PromotionRecommendation, ToolEvidence } from "@/lib/types";

export const PINNED_AGENT_MODEL = "gemini-3.5-flash-lite";
export const AGENT_PROMPT_VERSION = "recovery-decision-v2";
const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_RUN_TIMEOUT_MS = 30_000;
let geminiRunner: Runner | undefined;

export class AgentDecisionUnavailableError extends Error {
  constructor(message = "Gemini could not produce a validated recovery decision and no exact cache entry exists.") { super(message); }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function agentInputDigest(input: { incident: IncidentEvidence; eligible: PaymentAttempt[] }): string {
  return createHash("sha256").update(stableJson({
    promptVersion: AGENT_PROMPT_VERSION,
    catalogVersion: ACTION_CATALOG_VERSION,
    model: PINNED_AGENT_MODEL,
    policy: MERCHANT_POLICY,
    incident: input.incident,
    eligibleCaseIds: input.eligible.map((payment) => payment.id).sort(),
  })).digest("hex");
}

function getGeminiRunner(): Runner | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  geminiRunner ??= new Runner({
    modelProvider: new OpenAIProvider({ apiKey, baseURL: GEMINI_OPENAI_BASE_URL, useResponses: false, strictFeatureValidation: true }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
  });
  return geminiRunner;
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
    if (status !== 429 && status !== 503) throw error;
    await new Promise((resolve) => setTimeout(resolve, 800));
    return operation();
  }
}

const ActionSchema = z.object({
  id: z.enum(["timed_retry", "multi_rail_link", "upi_only_link", "observe_escalate"]),
  name: z.string().min(3).max(100),
  action: z.enum(["retry_original", "payment_link", "observe_escalate"]),
  timingMinutes: z.number().int().min(0).max(120),
  enabledMethods: z.array(z.enum(["card", "upi", "netbanking"])).max(3),
  targetCohort: z.string().min(3),
  rationale: z.string().min(10),
  risks: z.array(z.string().min(3)).min(1).max(4),
  contactCount: z.number().int().min(0).max(1),
  amountPolicy: z.literal("preserve_original"),
  channel: z.enum(["email", "none"]),
  rank: z.number().int().min(1).max(4),
  selected: z.boolean(),
});

const InvestigationSchema = z.object({
  decision: z.enum(["test", "hold", "escalate"]),
  primaryHypothesis: z.string().min(10),
  supportingEvidence: z.array(z.string().min(5)).min(2).max(6),
  rejectedHypotheses: z.array(z.string().min(5)).min(1).max(5),
  uncertainty: z.string().min(10),
  eligibleCaseCount: z.number().int().nonnegative(),
  rankedActions: z.array(ActionSchema).length(4),
  rejectedActionReasons: z.array(z.object({ actionId: z.enum(["timed_retry", "multi_rail_link", "upi_only_link", "observe_escalate"]), reason: z.string().min(8) })).max(4),
});

const REQUIRED_INVESTIGATION_TOOLS = ["getIncidentEvidence", "readMerchantRecoveryPolicy", "listEligibleCases", "inspectAvailableActions", "compareFailureExplanations"] as const;

function parseModelJson(value: unknown): z.infer<typeof InvestigationSchema> {
  if (typeof value !== "string") throw new Error("Gemini returned a non-text final answer.");
  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("Gemini did not return a JSON object.");
  return InvestigationSchema.parse(JSON.parse(value.slice(firstBrace, lastBrace + 1)));
}

function captureToolEvents(result: { newItems: Array<{ toJSON(): unknown }> }): ToolEvidence[] {
  const calls: ToolEvidence[] = [];
  for (const item of result.newItems) {
    const serialized = item.toJSON() as { rawItem?: { type?: string; name?: string; callId?: string; status?: string } };
    const raw = serialized.rawItem;
    if (raw?.type === "function_call" && raw.name) calls.push({ name: raw.name, callId: raw.callId, status: raw.status === "incomplete" ? "failed" : "completed", summary: "Typed read tool completed." });
  }
  return calls;
}

function validDecision(output: z.infer<typeof InvestigationSchema>, tools: ToolEvidence[], eligibleCount: number): boolean {
  const ids = new Set(output.rankedActions.map((action) => action.id));
  const ranks = new Set(output.rankedActions.map((action) => action.rank));
  const selected = output.rankedActions.filter((action) => action.selected);
  const toolNames = new Set(tools.map((item) => item.name));
  const fullCatalog = AVAILABLE_ACTIONS.every((action) => ids.has(action.id)) && ids.size === AVAILABLE_ACTIONS.length && ranks.size === 4;
  const selectionValid = output.decision === "test" ? selected.length === 2 : selected.length === 0;
  return output.eligibleCaseCount === eligibleCount && fullCatalog && selectionValid && REQUIRED_INVESTIGATION_TOOLS.every((name) => toolNames.has(name));
}

export function validCachedInvestigation(cached: InvestigationResult | null | undefined, inputDigest: string): cached is InvestigationResult {
  if (!cached || cached.inputDigest !== inputDigest || cached.model !== PINNED_AGENT_MODEL || cached.promptVersion !== AGENT_PROMPT_VERSION || cached.catalogVersion !== ACTION_CATALOG_VERSION) return false;
  const selected = cached.rankedActions.filter((action) => action.selected);
  return cached.mode !== "gemini_cache" && cached.semanticValidation === "passed" && cached.rankedActions.length === 4 && cached.decision === "test" && selected.length === 2;
}

export async function investigateIncident(input: { incident: IncidentEvidence; eligible: PaymentAttempt[]; cached?: InvestigationResult | null }): Promise<InvestigationResult> {
  const inputDigest = agentInputDigest(input);
  const runner = getGeminiRunner();
  if (!runner) {
    if (validCachedInvestigation(input.cached, inputDigest)) return { ...input.cached, mode: "gemini_cache", semanticValidation: "cache_validated" };
    throw new AgentDecisionUnavailableError();
  }

  const tools = [
    tool({ name: "getIncidentEvidence", description: "Return measured incident evidence.", parameters: z.object({ incidentId: z.string() }), execute: async () => input.incident }),
    tool({ name: "readMerchantRecoveryPolicy", description: "Read the merchant recovery policy.", parameters: z.object({ merchantId: z.string() }), execute: async () => ({ merchantId: "merchant_demo", policy: MERCHANT_POLICY }) }),
    tool({ name: "listEligibleCases", description: "Count cases after consent and contact limits.", parameters: z.object({ incidentId: z.string() }), execute: async () => ({ eligibleCaseCount: input.eligible.length, excludedCount: input.incident.failedAttempts - input.eligible.length }) }),
    tool({ name: "inspectAvailableActions", description: "Read the complete bounded action catalogue. Rank these actions; do not invent another.", parameters: z.object({ incidentId: z.string() }), execute: async () => ({ version: ACTION_CATALOG_VERSION, actions: AVAILABLE_ACTIONS }) }),
    tool({ name: "compareFailureExplanations", description: "Compare measured competing incident explanations.", parameters: z.object({ incidentId: z.string() }), execute: async () => input.incident.competingHypotheses }),
  ];
  const agent = new Agent({
    name: "Kept Recovery Decision Agent",
    model: PINNED_AGENT_MODEL,
    tools,
    modelSettings: { reasoning: { effort: "minimal" }, parallelToolCalls: true, temperature: 0 },
    instructions: `You are the only component that chooses which recovery actions are worth testing. Call all five read tools in the first turn. Return only one JSON object. Rank all four catalogue actions exactly once using ranks 1-4. For a test decision, mark exactly two meaningfully different actions selected=true; mark the other two false and explain each rejection. Do not select both link variants unless the evidence makes an original-method retry unsafe. For hold or escalate, select none. Copy each catalogue action's id, action, allowed methods, channel and timing bounds exactly; you may choose timing within its bounds. Include decision, primaryHypothesis, 2-6 supportingEvidence strings, 1-5 rejectedHypotheses strings, uncertainty, eligibleCaseCount, rankedActions, and rejectedActionReasons. Every action preserves the original amount. Never inspect or claim knowledge of replay outcomes. Never describe synthetic recovery as real revenue.`,
  });

  try {
    const result = await withTransientRetry(() => runner.run(agent, `Investigate ${input.incident.id} for merchant_demo.`, { maxTurns: 4, signal: AbortSignal.timeout(GEMINI_RUN_TIMEOUT_MS) }));
    if (!result.finalOutput) throw new Error("Gemini returned no final decision.");
    const parsed = parseModelJson(result.finalOutput);
    const toolEvents = captureToolEvents(result);
    if (!validDecision(parsed, toolEvents, input.eligible.length)) throw new Error("Gemini decision failed semantic validation.");
    const playbooks = parsed.rankedActions.filter((action) => action.selected) as CandidatePlaybook[];
    return {
      mode: "gemini_agent", model: PINNED_AGENT_MODEL, inputDigest, promptVersion: AGENT_PROMPT_VERSION, catalogVersion: ACTION_CATALOG_VERSION,
      ...parsed, playbooks, toolEvents, responseId: result.lastResponseId, semanticValidation: "passed",
    };
  } catch (error) {
    if (validCachedInvestigation(input.cached, inputDigest)) return { ...input.cached, mode: "gemini_cache", semanticValidation: "cache_validated" };
    console.error("Kept Gemini decision unavailable", error);
    throw new AgentDecisionUnavailableError();
  }
}

export function isDirectionallyPromotable(canary: CanaryResult): boolean {
  return canary.comparison.gate === "pass" && canary.assignments.length === 80 && new Set(canary.assignments.map((assignment) => assignment.caseId)).size === 80;
}

export function fallbackPromotion(canary: CanaryResult): PromotionRecommendation {
  const winner = canary.results.find((result) => result.playbookId === canary.winnerId)!;
  const challenger = canary.results.find((result) => result.playbookId !== canary.winnerId)!;
  const promotable = isDirectionallyPromotable(canary);
  return {
    mode: "statistical_gate", model: "agresti-caffo-95-v1", recommendation: promotable ? "promote" : "extend_canary",
    playbookId: promotable ? canary.winnerId : null,
    evidence: [
      `${winner.recovered}/${winner.attempted} recovered for ${winner.playbookId}.`,
      `${challenger.recovered}/${challenger.attempted} recovered for ${challenger.playbookId}.`,
      `95% uplift interval ${(canary.comparison.confidenceInterval[0] * 100).toFixed(1)} to ${(canary.comparison.confidenceInterval[1] * 100).toFixed(1)} percentage points.`,
    ],
    reason: promotable
      ? "The pre-committed 40 × 40 test cleared sample, value, uplift, and 95% evidence gates."
      : `Expansion withheld: ${canary.comparison.gateReasons.join(" ")}`,
    uncertainty: canary.sampleWarning,
    stoppingConditions: ["Stop after payment capture", "Stop on any policy violation", "Escalate if provider state cannot be reconciled"],
    toolEvents: [{ name: "computeEvidenceGate", status: "completed", summary: "Pre-registered statistical thresholds evaluated." }],
    semanticValidation: "passed",
  };
}

export async function evaluatePromotion(canary: CanaryResult): Promise<PromotionRecommendation> {
  return fallbackPromotion(canary);
}
