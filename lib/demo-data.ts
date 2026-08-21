import { randomUUID } from "node:crypto";
import { runLockedBenchmark } from "@/lib/benchmark";
import { loadReplayFixture } from "@/lib/fixtures";
import type { AuditEvent, StoredRecoveryRun } from "@/lib/types";

export const DEFAULT_RUN_ID = "run_canary_commander";
export const DEFAULT_MERCHANT_ID = "merchant_demo";

export function createAuditEvent(run: Pick<StoredRecoveryRun, "audit">, input: Omit<AuditEvent, "id" | "sequence" | "createdAt">, now = new Date()): AuditEvent {
  return { ...input, id: randomUUID(), sequence: (run.audit.at(-1)?.sequence ?? 0) + 1, createdAt: now.toISOString() };
}

export function createInitialRun(now = new Date()): StoredRecoveryRun {
  const fixture = loadReplayFixture();
  const createdAt = now.toISOString();
  const base: StoredRecoveryRun = {
    id: DEFAULT_RUN_ID, merchantId: DEFAULT_MERCHANT_ID, phase: "idle", cycle: 1, version: 1,
    fixtureVersion: fixture.manifest.version, incident: null, investigation: null,
    policyDecision: null, canaryAssignments: [], canary: null, promotion: null, externalAction: null,
    ledger: { simulatedAmountPaise: 0, baselineAmountPaise: 0, razorpayTestAmountPaise: 0, simulatedCases: 0, baselineCases: 0, testModeCases: 0, simulatedContacts: 0, baselineContacts: 0 },
    metrics: runLockedBenchmark(), audit: [], commandReceipts: [], payments: [], processedWebhookIds: [],
    integration: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      persistence: process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "local_file",
    },
    dataset: { name: fixture.manifest.name, version: fixture.manifest.version, seed: fixture.manifest.seed, manifestHash: fixture.manifestHash, totalAttempts: fixture.manifest.totalAttempts, holdoutPercent: fixture.manifest.holdoutPercent },
    createdAt, updatedAt: createdAt,
  };
  base.audit.push(createAuditEvent(base, {
    kind: "demo", title: "Recovery control plane ready",
    detail: "Immutable replay fixture verified. Synthetic replay and Razorpay Test Mode ledgers are isolated.",
    actor: "system", status: "success",
    evidence: { manifestHash: base.dataset.manifestHash, fixtureVersion: base.fixtureVersion },
  }, now));
  return base;
}

export function publicSnapshot(run: StoredRecoveryRun): Omit<StoredRecoveryRun, "payments" | "processedWebhookIds"> {
  const snapshot = structuredClone(run);
  delete (snapshot as Partial<StoredRecoveryRun>).payments;
  delete (snapshot as Partial<StoredRecoveryRun>).processedWebhookIds;
  return snapshot;
}
