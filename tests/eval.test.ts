import { describe, expect, it } from "vitest";
import { runLockedBenchmark } from "@/lib/benchmark";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { eligibleCases } from "@/lib/policy";
import { computeReplayLedger } from "@/lib/simulator";

describe("Kept release gates", () => {
  it("passes the locked holdout quality and safety thresholds", () => {
    const metrics = runLockedBenchmark();
    expect(metrics.detectionPrecision).toBeGreaterThanOrEqual(0.9);
    expect(metrics.detectionRecall).toBeGreaterThanOrEqual(0.9);
    expect(metrics.cohortF1).toBeGreaterThanOrEqual(0.85);
    expect(metrics.playbookAccuracy).toBeGreaterThanOrEqual(0.8);
    expect(metrics.policyViolations).toBe(0);
    expect(metrics.duplicateExecutions).toBe(0);
    expect(metrics.postRecoveryContacts).toBe(0);
  });

  it("beats the declared baseline without increasing customer contacts", () => {
    const fixture = loadReplayFixture();
    const incident = detectIncident(fixture.payments);
    expect(incident).not.toBeNull();
    const ledger = computeReplayLedger(eligibleCases(fixture.payments, incident!));
    expect(ledger.simulatedAmountPaise).toBeGreaterThan(ledger.baselineAmountPaise);
    expect(ledger.simulatedContacts).toBeLessThanOrEqual(ledger.baselineContacts);
    expect(ledger.razorpayTestAmountPaise).toBe(0);
  });
});
