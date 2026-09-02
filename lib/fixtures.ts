import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { causalModelDigest, generateCausalOutcomes } from "@/lib/causal-replay";
import type { InterventionOutcome, PaymentAttempt, ReplayManifest } from "@/lib/types";

export interface HoldoutWindow {
  id: string;
  issuer: string;
  method: PaymentAttempt["method"];
  errorStep: string;
  errorReason: string;
  sampleSize: number;
  baselineSuccessRate: number;
  observedSuccessRate: number;
  actualIncident: boolean;
  actualAffected: number;
  predictedAffected: number;
  overlapAffected: number;
  expectedPlaybook: "timed_retry" | "multi_rail_link" | "upi_only_link" | "observe_escalate";
}

export interface ReplayFixture {
  manifest: ReplayManifest;
  manifestHash: string;
  payments: PaymentAttempt[];
  outcomes: Map<string, InterventionOutcome>;
  holdout: HoldoutWindow[];
}

let cached: ReplayFixture | undefined;

function fixturePath(file: string): string {
  return join(process.cwd(), "fixtures", "replay-v1", file);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonLines<T>(value: string): T[] {
  return value.split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

export function loadReplayFixture(): ReplayFixture {
  if (cached) return cached;
  const manifestText = readFileSync(fixturePath("manifest.json"), "utf8");
  const paymentsText = readFileSync(fixturePath("payments.jsonl"), "utf8");
  const holdoutText = readFileSync(fixturePath("holdout.jsonl"), "utf8");
  const manifest = JSON.parse(manifestText) as ReplayManifest;
  const actual = { payments: digest(paymentsText), causalModel: causalModelDigest(), holdout: digest(holdoutText) };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (actual[key] !== manifest.hashes[key]) throw new Error(`Replay fixture integrity check failed for ${key}.`);
  }
  const payments = readJsonLines<PaymentAttempt>(paymentsText);
  cached = {
    manifest,
    manifestHash: digest(manifestText),
    payments,
    outcomes: generateCausalOutcomes(payments, manifest.seed),
    holdout: readJsonLines<HoldoutWindow>(holdoutText),
  };
  return cached;
}

export function clearFixtureCacheForTests(): void {
  cached = undefined;
}
