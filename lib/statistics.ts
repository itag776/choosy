export interface EvidenceGateInput {
  winner: { attempted: number; recovered: number; recoveredAmountPaise: number };
  challenger: { attempted: number; recovered: number; recoveredAmountPaise: number };
  uniqueAssignments: number;
  committedAssignments: number;
}

export function agrestiCaffoInterval(winnerRecovered: number, winnerTotal: number, challengerRecovered: number, challengerTotal: number): [number, number] {
  if (!winnerTotal || !challengerTotal) return [0, 0];
  const winnerRate = (winnerRecovered + 1) / (winnerTotal + 2);
  const challengerRate = (challengerRecovered + 1) / (challengerTotal + 2);
  const difference = winnerRate - challengerRate;
  const error = Math.sqrt(winnerRate * (1 - winnerRate) / (winnerTotal + 2) + challengerRate * (1 - challengerRate) / (challengerTotal + 2));
  return [Math.max(-1, difference - 1.96 * error), Math.min(1, difference + 1.96 * error)];
}

export function buildEvidenceGate(input: EvidenceGateInput) {
  const absoluteLift = input.winner.recovered / input.winner.attempted - input.challenger.recovered / input.challenger.attempted;
  const confidenceInterval = agrestiCaffoInterval(input.winner.recovered, input.winner.attempted, input.challenger.recovered, input.challenger.attempted);
  const reasons: string[] = [];
  if (input.winner.attempted !== 40 || input.challenger.attempted !== 40) reasons.push("Both arms require 40 completed cases.");
  if (input.uniqueAssignments !== 80 || input.committedAssignments !== 80) reasons.push("All 80 assignments must be unique and committed before outcomes are read.");
  if (input.winner.recovered <= input.challenger.recovered || input.winner.recoveredAmountPaise <= input.challenger.recoveredAmountPaise) reasons.push("The leading action must recover more payments and more value.");
  if (absoluteLift < 0.1) reasons.push("Absolute conversion lift must be at least 10 percentage points.");
  if (confidenceInterval[0] <= 0) reasons.push("The 95% interval must remain above zero.");
  return {
    absoluteLift,
    recoveredValueDifferencePaise: input.winner.recoveredAmountPaise - input.challenger.recoveredAmountPaise,
    confidenceLevel: 0.95 as const,
    confidenceInterval,
    minimumPerArm: 40 as const,
    gate: reasons.length ? "extend" as const : "pass" as const,
    gateReasons: reasons,
  };
}

export function inconclusiveEvidenceExample() {
  return buildEvidenceGate({
    winner: { attempted: 40, recovered: 21, recoveredAmountPaise: 420_000 },
    challenger: { attempted: 40, recovered: 19, recoveredAmountPaise: 380_000 },
    uniqueAssignments: 80,
    committedAssignments: 80,
  });
}
