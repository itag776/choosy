import { describe, expect, it } from "vitest";
import { GROWTH_BENCHMARK_SCENARIOS, runGrowthBenchmark } from "@/lib/growth-benchmark";

describe("synthetic growth benchmark", () => {
  it("uses exactly 100 fixed scenarios and produces stable metrics", () => {
    expect(GROWTH_BENCHMARK_SCENARIOS).toHaveLength(100);
    const first = runGrowthBenchmark(new Date("2026-09-03T00:00:00.000Z"));
    const second = runGrowthBenchmark(new Date("2026-09-03T00:00:00.000Z"));
    expect(second).toEqual(first);
    expect(first.fixtureDigest).toBe("3768666145d426d5317c2c16ad0351301b410884497968e644e1f2cbd7bfb2c4");
  });

  it("passes the honest growth and safety gates", () => {
    const report = runGrowthBenchmark();
    expect(report.choosy.hardConstraintViolations).toBe(0);
    expect(report.choosy.completedPurchases).toBeGreaterThanOrEqual(report.baseline.completedPurchases);
    expect(report.deltas.simulatedGmvPercent).toBeGreaterThanOrEqual(10);
    expect(report.gates.passed).toBe(true);
  });
});
