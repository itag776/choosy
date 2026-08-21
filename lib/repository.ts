import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInitialRun, DEFAULT_MERCHANT_ID } from "@/lib/demo-data";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase";
import type { AuditEvent, ExternalAction, InvestigationResult, PromotionRecommendation, StoredRecoveryRun } from "@/lib/types";

export class RepositoryConflictError extends Error {
  status = 409;
  constructor(message = "The run changed while this command was executing. Refresh and retry.") {
    super(message);
  }
}

export interface WebhookTransitionResult {
  duplicate: boolean;
  run: StoredRecoveryRun;
}

export interface RunRepository {
  get(runId: string): Promise<StoredRecoveryRun>;
  replace(current: StoredRecoveryRun, next: StoredRecoveryRun, events: AuditEvent[]): Promise<StoredRecoveryRun>;
  saveAgentRun(runId: string, purpose: "investigation" | "promotion", result: InvestigationResult | PromotionRecommendation): Promise<void>;
  saveExternalAction(runId: string, action: ExternalAction): Promise<void>;
  applyWebhook(current: StoredRecoveryRun, next: StoredRecoveryRun, eventId: string, eventType: string, payloadDigest: string, auditEvent: AuditEvent): Promise<WebhookTransitionResult>;
}

const localPath = join(tmpdir(), "recoveros-canary-commander", "state.json");
let localQueue: Promise<void> = Promise.resolve();

async function readLocal(runId: string): Promise<StoredRecoveryRun> {
  try {
    const parsed = JSON.parse(await readFile(localPath, "utf8")) as StoredRecoveryRun;
    if (parsed.id !== runId || !parsed.canaryAssignments || !parsed.fixtureVersion || !parsed.cycle) throw new Error("Incompatible local state.");
    return parsed;
  } catch {
    const seeded = createInitialRun();
    await writeLocal(seeded);
    return seeded;
  }
}

async function writeLocal(run: StoredRecoveryRun): Promise<void> {
  await mkdir(join(tmpdir(), "recoveros-canary-commander"), { recursive: true });
  const temporary = `${localPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(run), "utf8");
  await rename(temporary, localPath);
}

class LocalFileRepository implements RunRepository {
  async get(runId: string): Promise<StoredRecoveryRun> {
    const run = await readLocal(runId);
    run.integration = {
      openai: Boolean(process.env.OPENAI_API_KEY),
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
      persistence: "local_file",
    };
    return structuredClone(run);
  }

  async replace(current: StoredRecoveryRun, next: StoredRecoveryRun): Promise<StoredRecoveryRun> {
    let saved!: StoredRecoveryRun;
    const operation = localQueue.then(async () => {
      const actual = await readLocal(current.id);
      if (actual.version !== current.version) throw new RepositoryConflictError();
      await writeLocal(next);
      saved = structuredClone(next);
    });
    localQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return saved;
  }

  async saveAgentRun(): Promise<void> {}
  async saveExternalAction(): Promise<void> {}

  async applyWebhook(current: StoredRecoveryRun, next: StoredRecoveryRun, eventId: string): Promise<WebhookTransitionResult> {
    let result!: WebhookTransitionResult;
    const operation = localQueue.then(async () => {
      const actual = await readLocal(current.id);
      if (actual.processedWebhookIds.includes(eventId)) {
        result = { duplicate: true, run: actual };
        return;
      }
      if (actual.version !== current.version) throw new RepositoryConflictError();
      await writeLocal(next);
      result = { duplicate: false, run: structuredClone(next) };
    });
    localQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }
}

class SupabaseRunRepository implements RunRepository {
  private client = getSupabaseAdmin();

  async get(runId: string): Promise<StoredRecoveryRun> {
    const { data, error } = await this.client.from("recovery_runs").select("snapshot").eq("id", runId).maybeSingle();
    if (error) throw new Error(`Supabase run read failed: ${error.message}`);
    if (!data) {
      const run = createInitialRun();
      const { error: merchantError } = await this.client.from("merchants").upsert({ id: DEFAULT_MERCHANT_ID, name: "Northstar Commerce", environment: "replay" });
      if (merchantError) throw new Error(`Supabase merchant seed failed: ${merchantError.message}`);
      const { error: policyError } = await this.client.from("merchant_policies").upsert({ merchant_id: DEFAULT_MERCHANT_ID, source_text: "RecoverOS governed recovery policy v1", compiled_rules: { amountImmutable: true, maximumContacts24h: 2, approvalThresholdPaise: 2_500_000, stopOnCapture: true } });
      if (policyError) throw new Error(`Supabase policy seed failed: ${policyError.message}`);
      const { error: runError } = await this.client.from("recovery_runs").insert({ id: run.id, merchant_id: run.merchantId, phase: run.phase, version: run.version, fixture_version: run.fixtureVersion, snapshot: run });
      if (runError && runError.code !== "23505") throw new Error(`Supabase run seed failed: ${runError.message}`);
      if (runError?.code === "23505") return this.get(runId);
      return run;
    }
    const run = data.snapshot as StoredRecoveryRun;
    run.integration = { openai: Boolean(process.env.OPENAI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: "supabase" };
    return run;
  }

  async replace(current: StoredRecoveryRun, next: StoredRecoveryRun, events: AuditEvent[]): Promise<StoredRecoveryRun> {
    const { data, error } = await this.client.rpc("apply_run_transition", {
      p_run_id: current.id, p_expected_version: current.version, p_next_phase: next.phase,
      p_state_patch: next, p_events: events,
    });
    if (error?.message.includes("stale_run_version")) throw new RepositoryConflictError();
    if (error) throw new Error(`Supabase transition failed: ${error.message}`);
    if (next.payments.length) {
      const rows = next.payments.map((payment) => ({
        id: payment.id, run_id: next.id, customer_id: payment.customerId, amount_paise: payment.amountPaise,
        method: payment.method, issuer: payment.issuer, status: payment.status, error_reason: payment.errorReason,
        error_source: payment.errorSource, error_step: payment.errorStep, consent: payment.consent,
        contacts_last_24h: payment.contactsLast24h, created_at: payment.createdAt,
      }));
      const { error: paymentsError } = await this.client.from("payment_attempts").upsert(rows);
      if (paymentsError) throw new Error(`Supabase payment seed failed: ${paymentsError.message}`);
    }
    return (data as { snapshot: StoredRecoveryRun }).snapshot;
  }

  async saveAgentRun(runId: string, purpose: "investigation" | "promotion", result: InvestigationResult | PromotionRecommendation): Promise<void> {
    const { error } = await this.client.from("agent_runs").insert({
      run_id: runId, purpose, model: result.model, mode: result.mode, status: "completed",
      response_id: result.responseId ?? null, tool_events: result.toolEvents, output: result,
    });
    if (error) throw new Error(`Supabase agent audit failed: ${error.message}`);
  }

  async saveExternalAction(runId: string, action: ExternalAction): Promise<void> {
    const { error } = await this.client.from("external_actions").upsert({
      id: action.id, run_id: runId, type: action.type, idempotency_key: action.idempotencyKey,
      reference_id: action.referenceId, provider_id: action.providerId ?? null, status: action.status,
      amount_paise: action.amountPaise, request_digest: action.requestDigest, response: action,
      updated_at: action.updatedAt,
    });
    if (error) throw new Error(`Supabase external action audit failed: ${error.message}`);
  }

  async applyWebhook(current: StoredRecoveryRun, next: StoredRecoveryRun, eventId: string, eventType: string, payloadDigest: string, auditEvent: AuditEvent): Promise<WebhookTransitionResult> {
    const { data, error } = await this.client.rpc("process_razorpay_webhook", {
      p_run_id: current.id, p_expected_version: current.version, p_event_id: eventId,
      p_event_type: eventType, p_payload_digest: payloadDigest, p_state_patch: next, p_event: auditEvent,
    });
    if (error?.message.includes("stale_run_version")) throw new RepositoryConflictError();
    if (error) throw new Error(`Supabase webhook transition failed: ${error.message}`);
    const result = data as { duplicate: boolean; snapshot: StoredRecoveryRun };
    return { duplicate: result.duplicate, run: result.snapshot };
  }
}

let repository: RunRepository | undefined;

export function getRunRepository(): RunRepository {
  repository ??= hasSupabaseConfig() ? new SupabaseRunRepository() : new LocalFileRepository();
  return repository;
}

export function setRunRepositoryForTests(value?: RunRepository): void {
  repository = value;
}
