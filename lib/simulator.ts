import { loadReplayFixture } from "@/lib/fixtures";
import type { CanaryAssignment, CanaryResult, InterventionOutcome, PaymentAttempt, PlaybookId, RecoveryLedger } from "@/lib/types";

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
    immutable: true,
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
    confidenceWarning: "Directional twelve-case canary; expansion remains approval-gated.",
    completedAt: now.toISOString(),
  };
}

export function computeReplayLedger(cases: PaymentAttempt[]): RecoveryLedger {
  const { outcomes } = loadReplayFixture();
  const simulatedRecovered = cases.filter((payment) => outcomes.get(payment.id)?.alternate_link);
  const baselineRecovered = cases.filter((payment) => outcomes.get(payment.id)?.baseline_generic);
  return {
    simulatedAmountPaise: simulatedRecovered.reduce((sum, payment) => sum + payment.amountPaise, 0),
    baselineAmountPaise: baselineRecovered.reduce((sum, payment) => sum + payment.amountPaise, 0),
    razorpayTestAmountPaise: 0,
    simulatedCases: simulatedRecovered.length,
    baselineCases: baselineRecovered.length,
    testModeCases: 0,
    simulatedContacts: cases.length,
    baselineContacts: cases.length,
  };
}
