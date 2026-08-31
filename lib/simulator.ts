import { loadReplayFixture } from "@/lib/fixtures";
import type { CanaryAssignment, CanaryResult, InterventionOutcome, PaymentAttempt, PlaybookId, RecoveryLedger, ReplayCampaignEvent } from "@/lib/types";

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createCanaryAssignments(cases: PaymentAttempt[], seed: number, size = 12): CanaryAssignment[] {
  const shuffled = [...cases];
  const random = mulberry32(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, size).map((payment, index) => ({
    caseId: payment.id,
    playbookId: (index < size / 2 ? "wait_retry" : "alternate_link") as PlaybookId,
    ordinal: index + 1,
    committed: true,
  }));
}

export function evaluateCanary(assignments: CanaryAssignment[], payments: PaymentAttempt[], outcomes: Map<string, InterventionOutcome>, seed: number, now = new Date()): CanaryResult {
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const results = (["wait_retry", "alternate_link"] as PlaybookId[]).map((playbookId) => {
    const cohort = assignments.filter((assignment) => assignment.playbookId === playbookId);
    const recovered = cohort.filter((assignment) => outcomes.get(assignment.caseId)?.[playbookId]);
    return {
      playbookId,
      attempted: cohort.length,
      recovered: recovered.length,
      recoveredAmountPaise: recovered.reduce((sum, assignment) => sum + (paymentById.get(assignment.caseId)?.amountPaise ?? 0), 0),
      conversionRate: cohort.length ? recovered.length / cohort.length : 0,
      contacts: cohort.length,
    };
  });
  const [wait, alternate] = results;
  const winner = [...results].sort((a, b) => b.conversionRate - a.conversionRate || b.recoveredAmountPaise - a.recoveredAmountPaise)[0];
  return {
    seed,
    assignments,
    results,
    winnerId: winner.playbookId,
    liftMultiple: wait.conversionRate ? Number((alternate.conversionRate / wait.conversionRate).toFixed(2)) : Number.POSITIVE_INFINITY,
    sampleWarning: "Directional twelve-case canary; expansion remains approval-gated.",
    completedAt: now.toISOString(),
  };
}

function executeReplayAdapter(cases: PaymentAttempt[], outcomes: Map<string, InterventionOutcome>, playbookId: PlaybookId | "baseline_generic", now = new Date("2026-08-20T12:10:00.000Z")): ReplayCampaignEvent[] {
  const events: ReplayCampaignEvent[] = [];
  for (const payment of cases) {
    const captured = Boolean(outcomes.get(payment.id)?.[playbookId]);
    events.push({
      id: `campaign_${playbookId}_${payment.id}_dispatch`, sequence: events.length + 1,
      caseId: payment.id, playbookId, kind: "intervention_dispatched", amountPaise: payment.amountPaise,
      createdAt: new Date(now.getTime() + events.length * 1_000).toISOString(),
    });
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

export function executeReplayCampaign(cases: PaymentAttempt[], winnerId: PlaybookId = "alternate_link"): { ledger: RecoveryLedger; events: ReplayCampaignEvent[] } {
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
