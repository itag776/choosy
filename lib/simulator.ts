import type { CanaryResult, CandidatePlaybook, PaymentAttempt } from "@/lib/types";

export function runFixedCanary(cases: PaymentAttempt[]): CanaryResult {
  const canaryCases = cases.slice(0, 12);
  const assignments = canaryCases.map((payment, index) => ({
    caseId: payment.id,
    playbookId: (index % 2 === 0 ? "wait_retry" : "alternate_link") as CandidatePlaybook["id"],
    immutable: true as const,
  }));

  const waitCases = assignments.filter((assignment) => assignment.playbookId === "wait_retry");
  const alternateCases = assignments.filter((assignment) => assignment.playbookId === "alternate_link");

  return {
    assignments,
    results: [
      {
        playbookId: "wait_retry",
        attempted: waitCases.length,
        recovered: 2,
        recoveredAmount: 8_000,
        conversionRate: 2 / 6,
      },
      {
        playbookId: "alternate_link",
        attempted: alternateCases.length,
        recovered: 5,
        recoveredAmount: 20_000,
        conversionRate: 5 / 6,
      },
    ],
    winnerId: "alternate_link",
    confidenceWarning: "Directional twelve-case canary; expansion remains approval-gated.",
  };
}

export function promotedRecoveryAmount(eligibleCount: number): { amount: number; cases: number } {
  const remaining = Math.max(0, eligibleCount - 12);
  const recoveredRemaining = Math.floor(remaining * 0.7);
  return {
    cases: recoveredRemaining + 7,
    amount: recoveredRemaining * 4_000 + 28_000,
  };
}
