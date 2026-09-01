import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runLockedBenchmark } from "@/lib/benchmark";
import { createInitialRun, DEFAULT_RUN_ID, verifyAuditChain } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { fallbackInvestigation, fallbackPromotion, isDirectionallyPromotable } from "@/lib/recovery-agent";
import { RepositoryConflictError, setRunRepositoryForTests, type RunRepository } from "@/lib/repository";
import { parsePaymentLinkList } from "@/lib/razorpay";
import { executeRunCommand, getRun, processRazorpayWebhook } from "@/lib/run-service";
import { createCanaryAssignments, evaluateCanary } from "@/lib/simulator";
import { hasSupabaseConfig } from "@/lib/supabase";
import type { RunCommand, StoredRecoveryRun } from "@/lib/types";
import { verifyRazorpaySignature } from "@/lib/webhook";
import { createOperatorToken, verifyAccessCode, verifyOperatorToken } from "@/lib/operator-auth";

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
const operator = { actorId: "operator_test", role: "operator" as const, runId: DEFAULT_RUN_ID };

async function command(name: RunCommand) {
  const state = await getRun(DEFAULT_RUN_ID);
  return executeRunCommand(DEFAULT_RUN_ID, {
    command: name,
    expectedVersion: state.version,
    idempotencyKey: `${name}:test:${state.version}`,
    payload: name === "approve_canary" || name === "approve_promotion" ? { reason: "Test operator reviewed the bounded evidence." } : undefined,
  }, operator);
}

describe("verified replay truth", () => {
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
    expect(first.every((assignment) => assignment.committed)).toBe(true);
    const result = evaluateCanary(first, fixture.payments, fixture.outcomes, fixture.manifest.seed);
    expect(result.results.find((item) => item.playbookId === "wait_retry")?.recovered).toBe(2);
    expect(result.results.find((item) => item.playbookId === "alternate_link")?.recovered).toBe(5);
    expect(result.liftMultiple).toBe(2.5);
    expect(isDirectionallyPromotable(result)).toBe(true);
    expect(fallbackPromotion(result).recommendation).toBe("promote");
  });

  it("withholds expansion when the canary evidence is incomplete", () => {
    const fixture = loadReplayFixture();
    const incident = detectIncident(fixture.payments)!;
    const eligible = eligibleCases(fixture.payments, incident);
    const assignments = createCanaryAssignments(eligible, fixture.manifest.seed).slice(0, 10);
    const incomplete = evaluateCanary(assignments, fixture.payments, fixture.outcomes, fixture.manifest.seed);
    expect(isDirectionallyPromotable(incomplete)).toBe(false);
    expect(fallbackPromotion(incomplete).recommendation).toBe("extend_canary");
  });

  it("computes release metrics from the locked holdout", () => {
    const metrics = runLockedBenchmark();
    expect(metrics.detectionPrecision).toBeGreaterThanOrEqual(.9);
    expect(metrics.detectionRecall).toBeGreaterThanOrEqual(.9);
    expect(metrics.cohortF1).toBeGreaterThanOrEqual(.85);
    expect(metrics.playbookAccuracy).toBeGreaterThanOrEqual(.8);
    expect(metrics.evaluatedCases).toBe(160);
    expect(metrics.safetyCases).toBeGreaterThan(0);
    expect(metrics.truePositives + metrics.falseNegatives).toBeGreaterThan(0);
    expect(metrics.datasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(metrics.intervals.detectionRecall[0]).toBeLessThanOrEqual(metrics.detectionRecall);
    expect(metrics.intervals.detectionRecall[1]).toBeGreaterThanOrEqual(metrics.detectionRecall);
  });
});

describe("operator authentication and isolation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("issues an expiring HMAC-authenticated session with a unique run", () => {
    vi.stubEnv("RECOVEROS_OPERATOR_ACCESS_CODE", "judge-access-code");
    vi.stubEnv("RECOVEROS_SESSION_SECRET", "test-session-secret-with-sufficient-entropy");
    expect(verifyAccessCode("judge-access-code")).toBe(true);
    expect(verifyAccessCode("wrong-code")).toBe(false);
    const { token, session } = createOperatorToken("operator_judge", 1_000);
    expect(session.runId).toMatch(/^run_[a-f0-9]{24}$/);
    expect(verifyOperatorToken(token, 1_001)?.actorId).toBe("operator_judge");
    expect(verifyOperatorToken(`${token}tampered`, 1_001)).toBeNull();
    expect(verifyOperatorToken(token, session.expiresAt)).toBeNull();
  });

  it("rejects commands for another operator's run", async () => {
    repository = new MemoryRepository();
    setRunRepositoryForTests(repository);
    await expect(executeRunCommand(DEFAULT_RUN_ID, {
      command: "inject_incident", expectedVersion: 1, idempotencyKey: "cross-run",
    }, { ...operator, runId: "run_aaaaaaaaaaaaaaaaaaaaaaaa" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("Supabase configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the current server-secret key format", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(hasSupabaseConfig()).toBe(true);
  });

  it("keeps the legacy service-role variable as a migration fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-test-key");
    expect(hasSupabaseConfig()).toBe(true);
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
    vi.stubEnv("GEMINI_API_KEY", "");
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
    }, operator)).rejects.toMatchObject({ status: 409 });
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
    expect(promoted.approvals).toHaveLength(2);
    expect(promoted.approvals.every((approval) => approval.actorId === operator.actorId && /^[a-f0-9]{64}$/.test(approval.receiptDigest))).toBe(true);
    expect(verifyAuditChain(promoted.audit)).toBe(true);
  });

  it("returns the original result for a repeated command idempotency key", async () => {
    const initial = await getRun();
    const input = { command: "inject_incident" as const, expectedVersion: initial.version, idempotencyKey: "inject:stable-key" };
    const first = await executeRunCommand(DEFAULT_RUN_ID, input, operator);
    const second = await executeRunCommand(DEFAULT_RUN_ID, input, operator);
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

  it("parses Razorpay's documented payment_links collection", () => {
    const links = parsePaymentLinkList({ payment_links: [{
      id: "plink_test", short_url: "https://rzp.io/i/test", reference_id: "rcv_test",
      amount: 40_000, status: "created",
    }] });
    expect(links).toHaveLength(1);
    expect(links[0]?.reference_id).toBe("rcv_test");
  });

  it("captures once, suppresses duplicates, and ignores a late failure", async () => {
    const run = repository.run;
    run.phase = "payment_link_created";
    run.externalAction = {
      id: "ext_test", runId: run.id, type: "razorpay_payment_link", idempotencyKey: "plink:test",
      referenceId: "rcv_test", caseId: "owned_test", amountPaise: 40_000,
      status: "created", providerId: "plink_test", shortUrl: "https://rzp.io/i/test",
      requestDigest: "digest", createdAt: run.createdAt, updatedAt: run.updatedAt,
    };
    repository.run = run;
    const payload = {
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: "plink_test", reference_id: "rcv_test", amount: 40_000, notes: { recoveros_run_id: run.id, recoveros_reference_id: "rcv_test" } } },
        payment: { entity: { amount: 40_000, status: "captured" } },
      },
    };
    const rawBody = JSON.stringify(payload);
    const first = await processRazorpayWebhook({ eventId: "evt_paid", eventType: "payment_link.paid", rawBody, payload, runId: run.id });
    expect(first.duplicate).toBe(false);
    expect(first.state.phase).toBe("test_payment_captured");
    expect(first.state.ledger.razorpayTestAmountPaise).toBe(40_000);

    const duplicate = await processRazorpayWebhook({ eventId: "evt_paid", eventType: "payment_link.paid", rawBody, payload, runId: run.id });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.ledger.razorpayTestAmountPaise).toBe(40_000);

    const failurePayload = { event: "payment.failed", payload: {} };
    const failure = await processRazorpayWebhook({
      eventId: "evt_late_failure", eventType: "payment.failed",
      rawBody: JSON.stringify(failurePayload), payload: failurePayload, runId: run.id,
    });
    expect(failure.ignored).toBe(true);
    expect(failure.state.phase).toBe("test_payment_captured");
  });

  it("does not capture a signed event for a different payment-link artifact", async () => {
    const run = repository.run;
    run.phase = "payment_link_created";
    run.externalAction = {
      id: "ext_test", runId: run.id, type: "razorpay_payment_link", idempotencyKey: "plink:test",
      referenceId: "rcv_test", caseId: "owned_test", amountPaise: 40_000,
      status: "created", providerId: "plink_owned", shortUrl: "https://rzp.io/i/test",
      requestDigest: "digest", createdAt: run.createdAt, updatedAt: run.updatedAt,
    };
    repository.run = run;
    const payload = {
      event: "payment_link.paid",
      payload: { payment_link: { entity: { id: "plink_other", reference_id: "rcv_other", amount: 40_000, notes: { recoveros_run_id: run.id } } } },
    };
    const result = await processRazorpayWebhook({
      eventId: "evt_other", eventType: "payment_link.paid", rawBody: JSON.stringify(payload), payload, runId: run.id,
    });
    expect(result.ignored).toBe(true);
    expect(result.state.phase).toBe("payment_link_created");
    expect(result.state.ledger.razorpayTestAmountPaise).toBe(0);
  });
});
