import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runLockedBenchmark } from "@/lib/benchmark";
import { createInitialRun, DEFAULT_RUN_ID } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { fallbackInvestigation } from "@/lib/recovery-agent";
import { RepositoryConflictError, setRunRepositoryForTests, type RunRepository } from "@/lib/repository";
import { executeRunCommand, getRun, processRazorpayWebhook } from "@/lib/run-service";
import { createCanaryAssignments, evaluateCanary } from "@/lib/simulator";
import type { RunCommand, StoredRecoveryRun } from "@/lib/types";
import { verifyRazorpaySignature } from "@/lib/webhook";

class MemoryRepository implements RunRepository {
  run = createInitialRun(new Date("2026-08-20T12:00:00.000Z"));
  webhookIds = new Set<string>();

  async get(): Promise<StoredRecoveryRun> { return structuredClone(this.run); }
  async replace(current: StoredRecoveryRun, next: StoredRecoveryRun): Promise<StoredRecoveryRun> {
    if (current.version !== this.run.version) throw new RepositoryConflictError();
    this.run = structuredClone(next);
    return structuredClone(this.run);
  }
  async saveAgentRun(): Promise<void> {}
  async saveExternalAction(): Promise<void> {}
  async applyWebhook(current: StoredRecoveryRun, next: StoredRecoveryRun, eventId: string) {
    if (this.webhookIds.has(eventId)) return { duplicate: true, run: structuredClone(this.run) };
    if (current.version !== this.run.version) throw new RepositoryConflictError();
    this.webhookIds.add(eventId);
    this.run = structuredClone(next);
    return { duplicate: false, run: structuredClone(this.run) };
  }
}

let repository: MemoryRepository;

async function command(name: RunCommand) {
  const state = await getRun(DEFAULT_RUN_ID);
  return executeRunCommand(DEFAULT_RUN_ID, {
    command: name,
    expectedVersion: state.version,
    idempotencyKey: `${name}:test:${state.version}`,
  });
}

describe("immutable replay truth", () => {
  it("verifies committed hashes and loads all 240 attempts", () => {
    const fixture = loadReplayFixture();
    expect(fixture.payments).toHaveLength(240);
    expect(fixture.manifest.affectedAttempts).toBe(120);
    expect(fixture.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects the largest grouped degradation without an Issuer A rule", () => {
    const { payments } = loadReplayFixture();
    const incident = detectIncident(payments, new Date("2026-08-20T12:06:00.000Z"));
    expect(incident?.cohort.issuer).toBe("Issuer A");
    expect(incident?.failedAttempts).toBe(120);
    expect(incident?.revenueAtRiskPaise).toBe(48_000_000);
    expect(incident?.competingHypotheses.filter((item) => item.disposition === "rejected")).toHaveLength(2);
  });

  it("commits deterministic assignments before calculated outcomes", () => {
    const fixture = loadReplayFixture();
    const incident = detectIncident(fixture.payments)!;
    const eligible = eligibleCases(fixture.payments, incident);
    const first = createCanaryAssignments(eligible, fixture.manifest.seed);
    const second = createCanaryAssignments(eligible, fixture.manifest.seed);
    expect(first).toEqual(second);
    expect(first.every((assignment) => assignment.immutable)).toBe(true);
    const result = evaluateCanary(first, fixture.payments, fixture.outcomes, fixture.manifest.seed);
    expect(result.results.find((item) => item.playbookId === "wait_retry")?.recovered).toBe(2);
    expect(result.results.find((item) => item.playbookId === "alternate_link")?.recovered).toBe(5);
    expect(result.liftMultiple).toBe(2.5);
  });

  it("computes release metrics from the locked holdout", () => {
    const metrics = runLockedBenchmark();
    expect(metrics.detectionPrecision).toBeGreaterThanOrEqual(.9);
    expect(metrics.detectionRecall).toBeGreaterThanOrEqual(.9);
    expect(metrics.cohortF1).toBeGreaterThanOrEqual(.85);
    expect(metrics.playbookAccuracy).toBeGreaterThanOrEqual(.8);
  });
});

describe("policy boundary", () => {
  it("requires approval and rejects unsupported proposal sets", () => {
    const fixture = loadReplayFixture();
    const incident = detectIncident(fixture.payments)!;
    const eligible = eligibleCases(fixture.payments, incident);
    const fallback = fallbackInvestigation(incident, eligible.length);
    expect(evaluatePlaybooks(incident, fallback.playbooks, eligible).outcome).toBe("require_approval");
    expect(evaluatePlaybooks(incident, fallback.playbooks.slice(0, 1), eligible).outcome).toBe("reject");
  });
});

describe("versioned command state machine", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    repository = new MemoryRepository();
    setRunRepositoryForTests(repository);
  });

  it("rejects illegal and stale transitions", async () => {
    await expect(command("run_canary")).rejects.toMatchObject({ status: 409 });
    const initial = await getRun();
    await command("inject_incident");
    await expect(executeRunCommand(DEFAULT_RUN_ID, {
      command: "investigate",
      expectedVersion: initial.version,
      idempotencyKey: "investigate:stale",
    })).rejects.toMatchObject({ status: 409 });
  });

  it("runs the complete governed replay without hard-coded ledger totals", async () => {
    expect((await getRun()).phase).toBe("idle");
    expect((await command("inject_incident")).phase).toBe("incident_detected");
    expect((await command("investigate")).phase).toBe("awaiting_canary_approval");
    expect((await command("approve_canary")).phase).toBe("canary_approved");
    expect((await command("run_canary")).phase).toBe("canary_complete");
    expect((await command("evaluate_promotion")).phase).toBe("awaiting_promotion_approval");
    const promoted = await command("approve_promotion");
    expect(promoted.phase).toBe("promoted");
    expect(promoted.ledger.simulatedAmountPaise).toBeGreaterThan(promoted.ledger.baselineAmountPaise);
    expect(promoted.ledger.razorpayTestAmountPaise).toBe(0);
    expect(promoted.audit.some((event) => event.kind === "tool")).toBe(true);
  });

  it("returns the original result for a repeated command idempotency key", async () => {
    const initial = await getRun();
    const input = { command: "inject_incident" as const, expectedVersion: initial.version, idempotencyKey: "inject:stable-key" };
    const first = await executeRunCommand(DEFAULT_RUN_ID, input);
    const second = await executeRunCommand(DEFAULT_RUN_ID, input);
    expect(second.version).toBe(first.version);
    expect(second.phase).toBe("incident_detected");
  });
});

describe("Razorpay safety", () => {
  beforeEach(() => {
    repository = new MemoryRepository();
    setRunRepositoryForTests(repository);
  });

  it("validates signatures against the untouched raw body", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyRazorpaySignature(body, signature, "secret")).toBe(true);
    expect(verifyRazorpaySignature(body, "bad", "secret")).toBe(false);
  });

  it("captures once, suppresses duplicates, and ignores a late failure", async () => {
    const run = repository.run;
    run.phase = "payment_link_created";
    run.externalAction = {
      id: "ext_test", type: "razorpay_payment_link", idempotencyKey: "plink:test",
      referenceId: "rcv_test", caseId: "owned_test", amountPaise: 40_000,
      status: "created", providerId: "plink_test", shortUrl: "https://rzp.io/i/test",
      requestDigest: "digest", createdAt: run.createdAt, updatedAt: run.updatedAt,
    };
    repository.run = run;
    const payload = {
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: "plink_test", amount: 40_000 } },
        payment: { entity: { amount: 40_000, status: "captured" } },
      },
    };
    const rawBody = JSON.stringify(payload);
    const first = await processRazorpayWebhook({ eventId: "evt_paid", eventType: "payment_link.paid", rawBody, payload });
    expect(first.duplicate).toBe(false);
    expect(first.state.phase).toBe("test_payment_captured");
    expect(first.state.ledger.razorpayTestAmountPaise).toBe(40_000);

    const duplicate = await processRazorpayWebhook({ eventId: "evt_paid", eventType: "payment_link.paid", rawBody, payload });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.ledger.razorpayTestAmountPaise).toBe(40_000);

    const failurePayload = { event: "payment.failed", payload: {} };
    const failure = await processRazorpayWebhook({
      eventId: "evt_late_failure", eventType: "payment.failed",
      rawBody: JSON.stringify(failurePayload), payload: failurePayload,
    });
    expect(failure.ignored).toBe(true);
    expect(failure.state.phase).toBe("test_payment_captured");
  });
});
