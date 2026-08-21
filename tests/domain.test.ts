import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { runLockedBenchmark } from "@/lib/benchmark";
import { generatePayments } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { fallbackAnalysis } from "@/lib/recovery-agent";
import { resetDemo, streamDemo, analyzeIncident, approveCampaign, runCanary, promoteCampaign, getDashboard, processWebhookEvent } from "@/lib/store";
import { verifyRazorpaySignature } from "@/lib/webhook";

describe("deterministic incident and policy loop", () => {
  it("detects the synthetic issuer cohort and exact at-risk amount", () => {
    const incident = detectIncident(generatePayments(new Date("2026-08-20T12:00:00.000Z")));
    expect(incident).not.toBeNull();
    expect(incident?.failedAttempts).toBe(120);
    expect(incident?.revenueAtRisk).toBe(480_000);
    expect(incident?.affectedCohort).toContain("Issuer A");
  });

  it("requires approval for the high-value campaign", () => {
    const payments = generatePayments();
    const incident = detectIncident(payments)!;
    const decision = evaluatePlaybooks(incident, fallbackAnalysis().playbooks, eligibleCases(payments));
    expect(decision.outcome).toBe("require_approval");
    expect(decision.reasons.join(" ")).toContain("25,000");
  });

  it("rejects an incomplete playbook set", () => {
    const payments = generatePayments();
    const incident = detectIncident(payments)!;
    const decision = evaluatePlaybooks(incident, fallbackAnalysis().playbooks.slice(0, 1), eligibleCases(payments));
    expect(decision.outcome).toBe("reject");
  });
});

describe("locked benchmark", () => {
  it("meets the declared acceptance thresholds through calculated metrics", () => {
    const metrics = runLockedBenchmark();
    expect(metrics.detectionPrecision).toBeGreaterThanOrEqual(0.9);
    expect(metrics.detectionRecall).toBeGreaterThanOrEqual(0.9);
    expect(metrics.cohortF1).toBeGreaterThanOrEqual(0.85);
    expect(metrics.playbookAccuracy).toBeGreaterThanOrEqual(0.8);
    expect(metrics.policyViolations).toBe(0);
  });
});

describe("webhook safety", () => {
  it("validates HMAC signatures against the raw body", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const secret = "test_secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyRazorpaySignature(body, signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(body, "bad-signature", secret)).toBe(false);
  });

  it("suppresses duplicate webhook IDs", async () => {
    await resetDemo();
    const payload = { event: "untracked.demo", payload: {} };
    expect(processWebhookEvent("evt_same", payload).duplicate).toBe(false);
    expect(processWebhookEvent("evt_same", payload).duplicate).toBe(true);
    expect(getDashboard().processedWebhookIds).toEqual(["evt_same"]);
  });
});

describe("end-to-end replay state machine", () => {
  beforeEach(async () => {
    await resetDemo();
  });

  it("cannot run the canary before approval", async () => {
    const detected = await streamDemo();
    const analyzed = await analyzeIncident(detected.incident!.id);
    await expect(runCanary(analyzed.campaign!.id)).rejects.toThrow("Approve");
  });

  it("completes detect, analyze, approve, canary and promote", async () => {
    const detected = await streamDemo();
    const analyzed = await analyzeIncident(detected.incident!.id);
    await approveCampaign(analyzed.campaign!.id, true);
    const canary = await runCanary(analyzed.campaign!.id);
    expect(canary.campaign?.canary?.winnerId).toBe("alternate_link");
    const promoted = await promoteCampaign(analyzed.campaign!.id);
    expect(promoted.phase).toBe("promoted");
    expect(promoted.ledger.simulatedAmount).toBeGreaterThan(promoted.ledger.baselineAmount);
    expect(promoted.ledger.razorpayTestAmount).toBe(0);
  });
});
