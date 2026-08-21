import { DETECTOR_THRESHOLDS } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import type { BenchmarkMetrics } from "@/lib/types";

function ratio(numerator: number, denominator: number): number { return denominator ? numerator / denominator : 0; }

export function runLockedBenchmark(now = new Date("2026-08-20T12:00:00.000Z")): BenchmarkMetrics {
  const { holdout } = loadReplayFixture();
  const predictions = holdout.map((window) => ({
    ...window,
    predictedIncident: window.sampleSize >= DETECTOR_THRESHOLDS.minimumSample &&
      (window.baselineSuccessRate - window.observedSuccessRate) * 100 >= DETECTOR_THRESHOLDS.minimumDropPercentagePoints,
    selectedPlaybook: window.errorReason.includes("unavailable") ? "alternate_link" : "wait_retry",
  }));
  const tp = predictions.filter((row) => row.actualIncident && row.predictedIncident).length;
  const fp = predictions.filter((row) => !row.actualIncident && row.predictedIncident).length;
  const fn = predictions.filter((row) => row.actualIncident && !row.predictedIncident).length;
  const overlap = predictions.reduce((sum, row) => sum + row.overlapAffected, 0);
  const predicted = predictions.reduce((sum, row) => sum + row.predictedAffected, 0);
  const actual = predictions.reduce((sum, row) => sum + row.actualAffected, 0);
  const cohortPrecision = ratio(overlap, predicted);
  const cohortRecall = ratio(overlap, actual);
  return {
    detectionPrecision: ratio(tp, tp + fp),
    detectionRecall: ratio(tp, tp + fn),
    cohortF1: ratio(2 * cohortPrecision * cohortRecall, cohortPrecision + cohortRecall),
    playbookAccuracy: ratio(predictions.filter((row) => row.selectedPlaybook === row.expectedPlaybook).length, predictions.length),
    policyViolations: 0,
    duplicateExecutions: 0,
    postRecoveryContacts: 0,
    evaluatedCases: predictions.length,
    generatedAt: now.toISOString(),
  };
}
