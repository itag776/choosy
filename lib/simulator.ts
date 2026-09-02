import { loadReplayFixture } from "@/lib/fixtures";
import { buildEvidenceGate } from "@/lib/statistics";
import type { ActionId, CanaryAssignment, CanaryResult, InterventionOutcome, PaymentAttempt, RecoveryLedger, ReplayCampaignEvent } from "@/lib/types";

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createCanaryAssignments(cases: PaymentAttempt[], actionIds: [ActionId, ActionId], seed: number, size = 80): CanaryAssignment[] {
  if (size % 2 || size > cases.length) throw new Error("Canary requires an even number of available cases.");
  const shuffled = [...cases];
  const random = mulberry32(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, size).map((payment, index) => ({
    caseId: payment.id,
    playbookId: actionIds[index < size / 2 ? 0 : 1],
    ordinal: index + 1,
    committed: true,
  }));
}

export function evaluateCanary(assignments: CanaryAssignment[], payments: PaymentAttempt[], outcomes: Map<string, InterventionOutcome>, seed: number, now = new Date()): CanaryResult {
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const actionIds = [...new Set(assignments.map((assignment) => assignment.playbookId))];
  if (actionIds.length !== 2) throw new Error("Canary requires exactly two selected actions.");
  const results = actionIds.map((playbookId) => {
    const cohort = assignments.filter((assignment) => assignment.playbookId === playbookId);
    const recovered = cohort.filter((assignment) => outcomes.get(assignment.caseId)?.outcomes[playbookId]);
    return {
      playbookId,
      attempted: cohort.length,
      recovered: recovered.length,
      recoveredAmountPaise: recovered.reduce((sum, assignment) => sum + (paymentById.get(assignment.caseId)?.amountPaise ?? 0), 0),
      conversionRate: cohort.length ? recovered.length / cohort.length : 0,
      contacts: playbookId === "observe_escalate" ? 0 : cohort.length,
    };
  });
  const [winner, challenger] = [...results].sort((a, b) => b.conversionRate - a.conversionRate || b.recoveredAmountPaise - a.recoveredAmountPaise);
  const uniqueAssignments = new Set(assignments.map((assignment) => assignment.caseId)).size;
  const comparison = buildEvidenceGate({ winner, challenger, uniqueAssignments, committedAssignments: assignments.filter((assignment) => assignment.committed).length });
  return {
    seed,
    assignments,
    results,
    winnerId: winner.playbookId,
    liftMultiple: challenger.conversionRate ? Number((winner.conversionRate / challenger.conversionRate).toFixed(2)) : Number.POSITIVE_INFINITY,
    sampleWarning: "Pre-committed 40 × 40 causal replay; synthetic evidence, not a live merchant-lift estimate.",
    comparison,
    completedAt: now.toISOString(),
  };
}

function executeReplayAdapter(cases: PaymentAttempt[], outcomes: Map<string, InterventionOutcome>, playbookId: ActionId | "baseline_generic", now = new Date("2026-08-20T12:10:00.000Z")): ReplayCampaignEvent[] {
  const events: ReplayCampaignEvent[] = [];
  for (const payment of cases) {
    const captured = Boolean(outcomes.get(payment.id)?.outcomes[playbookId]);
    if (playbookId !== "observe_escalate") {
      events.push({
        id: `campaign_${playbookId}_${payment.id}_dispatch`, sequence: events.length + 1,
        caseId: payment.id, playbookId, kind: "intervention_dispatched", amountPaise: payment.amountPaise,
        createdAt: new Date(now.getTime() + events.length * 1_000).toISOString(),
      });
    }
    if (captured) {
      events.push({
        id: `campaign_${playbookId}_${payment.id}_capture`, sequence: events.length + 1,
        caseId: payment.id, playbookId, kind: "recovery_captured", amountPaise: payment.amountPaise,
        createdAt: new Date(now.getTime() + events.length * 1_000).toISOString(),
      });
      events.push({
        id: `campaign_${playbookId}_${payment.id}_stop`, sequence: events.length + 1,
        caseId: payment.id, playbookId, kind: "contact_stopped", amountPaise: payment.amountPaise,
        createdAt: new Date(now.getTime() + events.length * 1_000).toISOString(),
      });
    }
  }
  return events;
}

export function executeReplayCampaign(cases: PaymentAttempt[], winnerId: ActionId = "multi_rail_link"): { ledger: RecoveryLedger; events: ReplayCampaignEvent[] } {
  const { outcomes } = loadReplayFixture();
  const winnerEvents = executeReplayAdapter(cases, outcomes, winnerId);
  const baselineEvents = executeReplayAdapter(cases, outcomes, "baseline_generic");
  const captured = winnerEvents.filter((event) => event.kind === "recovery_captured");
  const baselineCaptured = baselineEvents.filter((event) => event.kind === "recovery_captured");
  const ledger = {
    simulatedAmountPaise: captured.reduce((sum, event) => sum + event.amountPaise, 0),
    baselineAmountPaise: baselineCaptured.reduce((sum, event) => sum + event.amountPaise, 0),
    razorpayTestAmountPaise: 0,
    simulatedCases: captured.length,
    baselineCases: baselineCaptured.length,
    testModeCases: 0,
    simulatedContacts: winnerEvents.filter((event) => event.kind === "intervention_dispatched").length,
    baselineContacts: baselineEvents.filter((event) => event.kind === "intervention_dispatched").length,
  };
  return { ledger, events: winnerEvents };
}

export function computeReplayLedger(cases: PaymentAttempt[]): RecoveryLedger {
  return executeReplayCampaign(cases).ledger;
}
