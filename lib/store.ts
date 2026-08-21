import { randomUUID } from "node:crypto";
import { analyzeWithRecoveryAgent } from "@/lib/recovery-agent";
import { createInitialState, DEMO_CAMPAIGN_ID, generatePayments } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { createTestPaymentLink, fetchPaymentLink } from "@/lib/razorpay";
import { persistSnapshot } from "@/lib/supabase";
import { promotedRecoveryAmount, runFixedCanary } from "@/lib/simulator";
import type { AuditEvent, DashboardState, RecoveryCampaign } from "@/lib/types";

declare global {
  var __recoverosState: DashboardState | undefined;
}

function integrationStatus(): DashboardState["integration"] {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    persistence: process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "memory",
  };
}

function state(): DashboardState {
  if (!globalThis.__recoverosState) globalThis.__recoverosState = createInitialState();
  globalThis.__recoverosState.integration = integrationStatus();
  return globalThis.__recoverosState;
}

function event(
  kind: AuditEvent["kind"],
  title: string,
  detail: string,
  actor: AuditEvent["actor"] = "system",
  status: AuditEvent["status"] = "info",
): AuditEvent {
  return { id: randomUUID(), kind, title, detail, actor, status, createdAt: new Date().toISOString() };
}

function append(item: AuditEvent): void {
  state().audit.unshift(item);
  state().audit = state().audit.slice(0, 80);
}

async function saved(): Promise<DashboardState> {
  await persistSnapshot(state());
  return structuredClone(state());
}

export function getDashboard(): DashboardState {
  return structuredClone(state());
}

export async function resetDemo(): Promise<DashboardState> {
  globalThis.__recoverosState = createInitialState();
  append(event("demo", "Demo reset", "All replay-only state was reset; fixed dataset seed is unchanged.", "operator", "success"));
  return saved();
}

export async function streamDemo(): Promise<DashboardState> {
  const current = state();
  current.payments = generatePayments();
  current.incident = detectIncident(current.payments);
  if (!current.incident) throw new Error("The fixed replay did not cross the incident threshold.");
  current.phase = "incident_detected";
  append(
    event(
      "detector",
      "Issuer authentication degradation detected",
      `${current.incident.failedAttempts} failures isolated to Issuer A card authentication; ₹${current.incident.revenueAtRisk.toLocaleString("en-IN")} is at risk in deterministic replay.`,
      "system",
      "warning",
    ),
  );
  return saved();
}

export async function analyzeIncident(incidentId: string): Promise<DashboardState> {
  const current = state();
  if (!current.incident || current.incident.id !== incidentId) throw new Error("Incident not found.");
  const eligible = eligibleCases(current.payments);
  const analysis = await analyzeWithRecoveryAgent({ incident: current.incident, eligibleCount: eligible.length });
  const policy = evaluatePlaybooks(current.incident, analysis.playbooks, eligible);

  current.campaign = {
    id: DEMO_CAMPAIGN_ID,
    incidentId,
    status: policy.outcome === "reject" ? "stopped" : policy.outcome === "allow" ? "approved" : "awaiting_approval",
    agentAnalysis: analysis,
    policy,
  };
  current.phase = "analyzed";

  append(event("agent", "Incident Commander proposed a canary", analysis.recommendation, "agent", "success"));
  append(
    event(
      "policy",
      policy.outcome === "require_approval" ? "Human approval required" : "Policy decision recorded",
      policy.reasons.join(" "),
      "system",
      policy.outcome === "reject" ? "blocked" : "warning",
    ),
  );
  return saved();
}

export async function approveCampaign(campaignId: string, approve: boolean): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  if (current.campaign.status !== "awaiting_approval") throw new Error("Campaign is not awaiting approval.");

  current.campaign.status = approve ? "approved" : "stopped";
  current.campaign.approvedAt = approve ? new Date().toISOString() : undefined;
  current.phase = approve ? "approved" : "analyzed";
  append(
    event(
      "approval",
      approve ? "Canary approved" : "Campaign rejected",
      approve ? "Operator approved twelve replay-only canary cases. No live charge was initiated." : "Operator stopped the campaign before execution.",
      "operator",
      approve ? "success" : "blocked",
    ),
  );
  return saved();
}

export async function runCanary(campaignId: string): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  if (current.campaign.status !== "approved") throw new Error("Approve the campaign before running the canary.");

  current.campaign.status = "canary_running";
  const eligible = eligibleCases(current.payments);
  current.campaign.canary = runFixedCanary(eligible);
  current.campaign.status = "canary_complete";
  current.phase = "canary_complete";
  append(
    event(
      "canary",
      "Alternate-method playbook won the canary",
      "5/6 replay cases recovered with an alternate-method link versus 2/6 with a timed issuer retry. Small-sample warning preserved.",
      "agent",
      "success",
    ),
  );
  return saved();
}

export async function promoteCampaign(campaignId: string): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  if (current.campaign.status !== "canary_complete") throw new Error("The canary must complete before promotion.");
  if (current.campaign.canary?.winnerId !== "alternate_link") throw new Error("No promotable canary winner exists.");

  const recovered = promotedRecoveryAmount(eligibleCases(current.payments).length);
  current.campaign.status = "promoted";
  current.campaign.promotedAt = new Date().toISOString();
  current.phase = "promoted";
  current.ledger.simulatedAmount = recovered.amount;
  current.ledger.simulatedCases = recovered.cases;
  append(
    event(
      "campaign",
      "Winning playbook promoted",
      `₹${recovered.amount.toLocaleString("en-IN")} recovered in deterministic replay. Baseline remains ₹${current.ledger.baselineAmount.toLocaleString("en-IN")}; this is not real merchant revenue.`,
      "operator",
      "success",
    ),
  );
  return saved();
}

export async function stopCampaign(campaignId: string, reason = "Stopped by the operator."): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  current.campaign.status = "stopped";
  append(event("campaign", "Campaign stopped", reason, "operator", "blocked"));
  return saved();
}

export async function escalateCampaign(campaignId: string, reason = "Evidence was insufficient for autonomous recovery."): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  current.campaign.status = "escalated";
  append(event("campaign", "Incident escalated", reason, "agent", "warning"));
  return saved();
}

export async function createCampaignTestLink(campaignId: string): Promise<DashboardState> {
  const current = state();
  if (!current.campaign || current.campaign.id !== campaignId) throw new Error("Campaign not found.");
  if (current.campaign.status !== "promoted") throw new Error("Promote the winning playbook before creating a Test Mode link.");
  if (current.campaign.paymentLink?.status === "paid") throw new Error("The Test Mode recovery is already complete.");

  try {
    const paymentLink = await createTestPaymentLink("live_demo_001", 400);
    current.campaign.paymentLink = paymentLink;
    append(
      event(
        "razorpay",
        paymentLink.mode === "razorpay_test" ? "Razorpay Test Mode link created" : "Razorpay preview prepared",
        paymentLink.mode === "razorpay_test"
          ? "A ₹400 Test Mode link was created with a unique reference ID and bounded checkout methods."
          : "Add Razorpay Test Mode keys to create a real link. No URL has been fabricated.",
        "system",
        paymentLink.mode === "razorpay_test" ? "success" : "warning",
      ),
    );
  } catch (error) {
    append(event("guardrail", "Payment Link creation failed safely", error instanceof Error ? error.message : "Unknown Razorpay error", "system", "blocked"));
    throw error;
  }
  return saved();
}

export async function syncCampaignPaymentLink(campaignId: string): Promise<DashboardState> {
  const current = state();
  const link = current.campaign?.id === campaignId ? current.campaign.paymentLink : undefined;
  if (!link || link.mode !== "razorpay_test") throw new Error("No real Razorpay Test Mode link is available to sync.");
  const remote = await fetchPaymentLink(link.id);
  if (remote.status === "paid" && link.status !== "paid") markTestModePaid(link.amount, "Razorpay API synchronization");
  else append(event("razorpay", "Razorpay state synchronized", `Authoritative Payment Link status: ${remote.status}.`, "razorpay", "info"));
  return saved();
}

export function markTestModePaid(amount: number, source: string): void {
  const current = state();
  const link = current.campaign?.paymentLink;
  if (!link || link.status === "paid") return;
  link.status = "paid";
  current.ledger.razorpayTestAmount += amount;
  current.ledger.testModeCases += 1;
  append(event("razorpay", "Test Mode recovery captured", `₹${amount.toLocaleString("en-IN")} captured in Razorpay Test Mode via ${source}.`, "razorpay", "success"));
}

export function processWebhookEvent(eventId: string, payload: Record<string, unknown>): { duplicate: boolean; ignored: boolean } {
  const current = state();
  if (current.processedWebhookIds.includes(eventId)) {
    append(event("webhook", "Duplicate webhook ignored", `${eventId} was already processed; no money or contact state changed.`, "razorpay", "success"));
    return { duplicate: true, ignored: true };
  }

  current.processedWebhookIds.push(eventId);
  const eventName = String(payload.event || "unknown");
  const paymentLink = ((payload.payload as Record<string, unknown> | undefined)?.payment_link as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
  const payment = ((payload.payload as Record<string, unknown> | undefined)?.payment as Record<string, unknown> | undefined)?.entity as Record<string, unknown> | undefined;
  const paid = eventName === "payment_link.paid" || eventName === "payment.captured";

  if (paid && current.campaign?.paymentLink?.mode === "razorpay_test") {
    const remoteId = String(paymentLink?.id || "");
    if (!remoteId || remoteId === current.campaign.paymentLink.id) {
      const amountPaise = Number(payment?.amount || paymentLink?.amount || current.campaign.paymentLink.amount * 100);
      markTestModePaid(Math.round(amountPaise / 100), `webhook ${eventName}`);
      return { duplicate: false, ignored: false };
    }
  }

  if (eventName === "payment.failed" && current.campaign?.paymentLink?.status === "paid") {
    append(event("webhook", "Late failure ignored", "A terminal paid state already exists, so the out-of-order failure was ignored.", "razorpay", "success"));
    return { duplicate: false, ignored: true };
  }

  append(event("webhook", "Webhook recorded", `${eventName} did not change a tracked recovery case.`, "razorpay", "info"));
  return { duplicate: false, ignored: true };
}

export function demoWebhookPayload(): Record<string, unknown> {
  const current = state();
  return {
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: current.campaign?.paymentLink?.id || "plink_demo", amount: 40_000 } },
      payment: { entity: { amount: 40_000, status: "captured" } },
    },
  };
}

export function campaignOrThrow(id: string): RecoveryCampaign {
  const campaign = state().campaign;
  if (!campaign || campaign.id !== id) throw new Error("Campaign not found.");
  return campaign;
}
