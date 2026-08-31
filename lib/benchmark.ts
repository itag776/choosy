import { createHash } from "node:crypto";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { eligibleCases, evaluatePlaybooks, selectRecoveryPlaybook } from "@/lib/policy";
import { fallbackInvestigation } from "@/lib/recovery-agent";
import { executeReplayCampaign } from "@/lib/simulator";
import type { BenchmarkMetrics, CandidatePlaybook, PaymentAttempt, PlaybookId } from "@/lib/types";

interface EvaluationScenario {
  id: string;
  payments: PaymentAttempt[];
  actualIncident: boolean;
  expectedCohort: { issuer: string; method: PaymentAttempt["method"]; errorStep: string; errorReason: string } | null;
  expectedPlaybook: PlaybookId | null;
}

function ratio(numerator: number, denominator: number): number { return denominator ? numerator / denominator : 0; }

function wilson(successes: number, total: number): [number, number] {
  if (!total) return [0, 0];
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function scenarioPayments(input: {
  id: string; issuer: string; method: PaymentAttempt["method"]; total: number; failures: number;
  reason: string; source: string; consentFailures?: number;
}): PaymentAttempt[] {
  return Array.from({ length: input.total }, (_, index) => {
    const failed = index < input.failures;
    return {
      id: `${input.id}_pay_${String(index + 1).padStart(3, "0")}`,
      customerId: `${input.id}_customer_${index + 1}`,
      amountPaise: 10_000 + (index % 9) * 5_000,
      method: input.method,
      issuer: input.issuer,
      status: failed ? "failed" : "captured",
      errorReason: failed ? input.reason : null,
      errorSource: failed ? input.source : null,
      errorStep: failed ? "payment_authentication" : null,
      consent: index >= (input.consentFailures ?? 0),
      contactsLast24h: index % 17 === 0 ? 2 : 0,
      createdAt: new Date(Date.UTC(2026, 7, 20, 12, 0, index)).toISOString(),
    };
  });
}

export function generateAdversarialScenarios(): EvaluationScenario[] {
  const scenarios: EvaluationScenario[] = [];
  for (let index = 0; index < 160; index += 1) {
    const kind = index % 8;
    const id = `eval_${String(index + 1).padStart(3, "0")}`;
    const issuer = `Issuer ${String.fromCharCode(65 + index % 5)}`;
    const base = { id, issuer, consentFailures: index % 4 };
    if (kind === 0 || kind === 1) {
      const method = "card" as const;
      const reason = kind === 0 ? "issuer_authentication_unavailable" : "issuer_bank_offline";
      scenarios.push({ id, payments: scenarioPayments({ ...base, method, total: 58 + index % 13, failures: 25 + index % 8, reason, source: "bank" }), actualIncident: true, expectedCohort: { issuer, method, errorStep: "payment_authentication", errorReason: reason }, expectedPlaybook: "alternate_link" });
    } else if (kind === 2) {
      const method = "card" as const;
      const reason = "issuer_temporary_timeout";
      scenarios.push({ id, payments: scenarioPayments({ ...base, method, total: 62 + index % 9, failures: 22 + index % 7, reason, source: "bank" }), actualIncident: true, expectedCohort: { issuer, method, errorStep: "payment_authentication", errorReason: reason }, expectedPlaybook: "wait_retry" });
    } else if (kind === 3) {
      const method = "upi" as const;
      const reason = "issuer_authentication_unavailable";
      scenarios.push({ id, payments: scenarioPayments({ ...base, method, total: 54 + index % 11, failures: 21 + index % 6, reason, source: "bank" }), actualIncident: true, expectedCohort: { issuer, method, errorStep: "payment_authentication", errorReason: reason }, expectedPlaybook: "alternate_link" });
    } else if (kind === 4) {
      scenarios.push({ id, payments: scenarioPayments({ ...base, method: "card", total: 70, failures: 5 + index % 3, reason: "issuer_soft_decline", source: "bank" }), actualIncident: false, expectedCohort: null, expectedPlaybook: null });
    } else if (kind === 5) {
      scenarios.push({ id, payments: scenarioPayments({ ...base, method: "card", total: 70, failures: 24 + index % 5, reason: "incorrect_otp", source: "customer" }), actualIncident: false, expectedCohort: null, expectedPlaybook: null });
    } else if (kind === 6) {
      scenarios.push({ id, payments: scenarioPayments({ ...base, method: "card", total: 18, failures: 15, reason: "issuer_authentication_unavailable", source: "bank" }), actualIncident: false, expectedCohort: null, expectedPlaybook: null });
    } else {
      const method = "card" as const;
      const reason = "issuer_authentication_degraded";
      const adjudicatedIncident = index % 32 === 7;
      scenarios.push({ id, payments: scenarioPayments({ ...base, method, total: 80, failures: 11 + index % 2, reason, source: "bank" }), actualIncident: adjudicatedIncident, expectedCohort: adjudicatedIncident ? { issuer, method, errorStep: "payment_authentication", errorReason: reason } : null, expectedPlaybook: adjudicatedIncident ? "wait_retry" : null });
    }
  }
  return scenarios;
}

function unsafePolicyAllows(): { violations: number; cases: number } {
  const fixture = loadReplayFixture();
  const incident = detectIncident(fixture.payments)!;
  const eligible = eligibleCases(fixture.payments, incident);
  const valid = fallbackInvestigation(incident, eligible.length).playbooks;
  const unsupported = structuredClone(valid) as unknown as Array<Omit<CandidatePlaybook, "enabledMethods"> & { enabledMethods: string[] }>;
  unsupported[0]!.enabledMethods = ["crypto"];
  const attacks: Array<{ playbooks: CandidatePlaybook[]; eligible: PaymentAttempt[] }> = [
    { playbooks: valid.slice(0, 1), eligible },
    { playbooks: valid.map((item, index) => index === 0 ? { ...item, amountPolicy: "discount" as CandidatePlaybook["amountPolicy"] } : item), eligible },
    { playbooks: unsupported as CandidatePlaybook[], eligible },
    { playbooks: valid.map((item, index) => index === 0 ? { ...item, contactCount: 2 } : item), eligible },
    { playbooks: valid, eligible: [...eligible, { ...fixture.payments[0]!, consent: false }] },
    { playbooks: [valid[0]!, valid[0]!], eligible },
  ];
  return { cases: attacks.length, violations: attacks.filter((attack) => evaluatePlaybooks(incident, attack.playbooks, attack.eligible).outcome !== "reject").length };
}

export function runLockedBenchmark(now = new Date("2026-08-20T12:00:00.000Z")): BenchmarkMetrics {
  const scenarios = generateAdversarialScenarios();
  const predictions = scenarios.map((scenario) => ({ scenario, incident: detectIncident(scenario.payments, now) }));
  const tp = predictions.filter(({ scenario, incident }) => scenario.actualIncident && incident).length;
  const fp = predictions.filter(({ scenario, incident }) => !scenario.actualIncident && incident).length;
  const fn = predictions.filter(({ scenario, incident }) => scenario.actualIncident && !incident).length;
  let predictedAffected = 0;
  let actualAffected = 0;
  let overlapAffected = 0;
  let correctSelections = 0;
  let selectionCases = 0;
  for (const { scenario, incident } of predictions) {
    const actualIds = new Set(scenario.expectedCohort ? scenario.payments.filter((payment) => payment.status === "failed" && payment.issuer === scenario.expectedCohort!.issuer && payment.method === scenario.expectedCohort!.method && payment.errorReason === scenario.expectedCohort!.errorReason).map((payment) => payment.id) : []);
    const predictedIds = new Set(incident ? scenario.payments.filter((payment) => payment.status === "failed" && payment.issuer === incident.cohort.issuer && payment.method === incident.cohort.method && payment.errorReason === incident.cohort.errorReason).map((payment) => payment.id) : []);
    actualAffected += actualIds.size;
    predictedAffected += predictedIds.size;
    overlapAffected += [...predictedIds].filter((id) => actualIds.has(id)).length;
    if (incident && scenario.expectedPlaybook) {
      selectionCases += 1;
      if (selectRecoveryPlaybook(incident) === scenario.expectedPlaybook) correctSelections += 1;
    }
  }
  const cohortPrecision = ratio(overlapAffected, predictedAffected);
  const cohortRecall = ratio(overlapAffected, actualAffected);
  const safety = unsafePolicyAllows();
  const fixture = loadReplayFixture();
  const replayIncident = detectIncident(fixture.payments)!;
  const campaign = executeReplayCampaign(eligibleCases(fixture.payments, replayIncident));
  const dispatches = campaign.events.filter((event) => event.kind === "intervention_dispatched");
  const duplicateExecutions = dispatches.length - new Set(dispatches.map((event) => event.caseId)).size;
  const postRecoveryContacts = campaign.events.filter((event, index, events) => event.kind === "intervention_dispatched" && events.slice(0, index).some((prior) => prior.caseId === event.caseId && prior.kind === "recovery_captured")).length;
  const datasetHash = createHash("sha256").update(JSON.stringify(scenarios.map((scenario) => ({ id: scenario.id, actualIncident: scenario.actualIncident, expectedCohort: scenario.expectedCohort, expectedPlaybook: scenario.expectedPlaybook, payments: scenario.payments })))).digest("hex");
  return {
    detectionPrecision: ratio(tp, tp + fp),
    detectionRecall: ratio(tp, tp + fn),
    cohortF1: ratio(2 * cohortPrecision * cohortRecall, cohortPrecision + cohortRecall),
    playbookAccuracy: ratio(correctSelections, selectionCases),
    policyViolations: safety.violations,
    duplicateExecutions,
    postRecoveryContacts,
    evaluatedCases: scenarios.length,
    safetyCases: safety.cases,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    datasetHash,
    confidenceLevel: 0.95,
    intervals: {
      detectionPrecision: wilson(tp, tp + fp),
      detectionRecall: wilson(tp, tp + fn),
      playbookAccuracy: wilson(correctSelections, selectionCases),
    },
    generatedAt: now.toISOString(),
  };
}
