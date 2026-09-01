import { createHash, randomUUID } from "node:crypto";
import { createAuditEvent, createInitialRun, DEFAULT_RUN_ID, publicSnapshot } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { createOrReconcilePaymentLink, fetchPaymentLink, paymentLinkIntent } from "@/lib/razorpay";
import { evaluatePromotion, investigateIncident } from "@/lib/recovery-agent";
import { getRunRepository } from "@/lib/repository";
import { createCanaryAssignments, evaluateCanary, executeReplayCampaign } from "@/lib/simulator";
import type { ApprovalReceipt, AuditEvent, OperatorIdentity, RecoveryRunSnapshot, RunCommand, RunCommandRequest, RunPhase, StoredRecoveryRun } from "@/lib/types";

export class RunServiceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type EventInput = Omit<AuditEvent, "id" | "sequence" | "createdAt" | "previousHash" | "hash">;

function requirePhase(run: StoredRecoveryRun, allowed: RunPhase[]): void {
  if (!allowed.includes(run.phase)) {
    throw new RunServiceError(`Command is not valid while the run is ${run.phase}.`, 409);
  }
}

function appendEvents(run: StoredRecoveryRun, inputs: EventInput[]): AuditEvent[] {
  const created: AuditEvent[] = [];
  for (const input of inputs) {
    const event = createAuditEvent(run, input);
    run.audit.push(event);
    created.push(event);
  }
  return created;
}

async function transition(
  current: StoredRecoveryRun,
  phase: RunPhase,
  mutate: (next: StoredRecoveryRun) => void,
  eventInputs: EventInput[],
  receipt?: { command: RunCommand; idempotencyKey: string },
): Promise<StoredRecoveryRun> {
  const next = structuredClone(current);
  next.phase = phase;
  next.resumePhase = undefined;
  mutate(next);
  next.version = current.version + 1;
  next.updatedAt = new Date().toISOString();
  const events = appendEvents(next, eventInputs);
  if (receipt) {
    next.commandReceipts = [...next.commandReceipts, {
      command: receipt.command,
      idempotencyKey: receipt.idempotencyKey,
      version: next.version,
      completedAt: next.updatedAt,
    }].slice(-100);
  }
  return getRunRepository().replace(current, next, events);
}

function receipt(input: RunCommandRequest): { command: RunCommand; idempotencyKey: string } {
  return { command: input.command, idempotencyKey: input.idempotencyKey };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createApprovalReceipt(run: StoredRecoveryRun, input: RunCommandRequest, operator: OperatorIdentity, type: ApprovalReceipt["type"]): ApprovalReceipt {
  if (operator.runId !== run.id) throw new RunServiceError("The operator is not authorized for this recovery run.", 403);
  const reason = typeof input.payload?.reason === "string" ? input.payload.reason.trim() : "";
  if (reason.length < 12 || reason.length > 240) throw new RunServiceError("Approval requires a concise operator reason.", 422);
  const unsigned = {
    id: `approval_${randomUUID()}`,
    type,
    actorId: operator.actorId,
    actorRole: operator.role,
    reason,
    runId: run.id,
    approvedVersion: run.version,
    policyDigest: digest(run.policyDecision),
    cohortDigest: digest({ incident: run.incident, assignments: run.canaryAssignments, canary: run.canary }),
    createdAt: new Date().toISOString(),
  };
  return { ...unsigned, receiptDigest: digest(unsigned) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getRun(runId = DEFAULT_RUN_ID): Promise<RecoveryRunSnapshot> {
  return publicSnapshot(await getRunRepository().get(runId));
}

export async function getRunEvents(runId: string, after = 0): Promise<{ version: number; events: AuditEvent[] }> {
  const run = await getRunRepository().get(runId);
  return { version: run.version, events: run.audit.filter((event) => event.sequence > after) };
}

export async function executeRunCommand(runId: string, input: RunCommandRequest, operator: OperatorIdentity): Promise<RecoveryRunSnapshot> {
  if (operator.runId !== runId) throw new RunServiceError("The operator is not authorized for this recovery run.", 403);
  let run = await getRunRepository().get(runId);
  const previous = run.commandReceipts.find((item) => item.idempotencyKey === input.idempotencyKey);
  if (previous) return publicSnapshot(run);
  if (run.version !== input.expectedVersion) throw new RunServiceError("The incident changed in another session. Refresh and retry.", 409);

  switch (input.command) {
    case "reset_replay": {
      const seeded = createInitialRun(new Date(), run.id);
      run = await transition(run, "idle", (next) => {
        next.cycle = run.cycle + 1;
        next.fixtureVersion = seeded.fixtureVersion;
        next.incident = null;
        next.investigation = null;
        next.policyDecision = null;
        next.canaryAssignments = [];
        next.canary = null;
        next.promotion = null;
        next.externalAction = null;
        next.ledger = seeded.ledger;
        next.campaignEvents = [];
        next.metrics = seeded.metrics;
        next.payments = [];
      }, [{
        kind: "demo", title: "Incident room reset",
        detail: "The next replay will use the same hash-verified fixture and a fresh recovery cycle. Earlier external receipts remain retained in their provider systems.",
        actor: "operator", status: "success", evidence: { cycle: run.cycle + 1 },
      }], receipt(input));
      break;
    }

    case "inject_incident": {
      requirePhase(run, ["idle"]);
      run = await transition(run, "incident_streaming", (next) => {
        next.payments = loadReplayFixture().payments;
      }, [{
        kind: "demo", title: "Replay stream opened",
        detail: "240 hash-verified fixture records are entering the detection window.",
        actor: "operator", status: "info", evidence: { fixture: run.fixtureVersion, attempts: 240 },
      }]);
      await delay(450);
      const incident = detectIncident(run.payments, new Date("2026-08-20T12:06:00.000Z"));
      if (!incident) throw new RunServiceError("The verified fixture did not cross the incident threshold.", 500);
      run = await transition(run, "incident_detected", (next) => { next.incident = incident; }, [{
        kind: "detector", title: incident.title,
        detail: `${incident.failedAttempts} failures isolated; ₹${Math.round(incident.revenueAtRiskPaise / 100).toLocaleString("en-IN")} is at risk in deterministic replay.`,
        actor: "system", status: "warning",
        evidence: { cohortQuery: incident.cohortQuery, threshold: incident.thresholds, incidentScore: incident.incidentScore },
      }], receipt(input));
      break;
    }

    case "investigate": {
      requirePhase(run, ["incident_detected"]);
      if (!run.incident) throw new RunServiceError("Incident evidence is missing.", 409);
      const incident = run.incident;
      run = await transition(run, "investigating", () => undefined, [{
        kind: "agent", title: "Kept started its investigation",
        detail: "The agent must investigate through five typed read tools before proposing any action.",
        actor: "agent", status: "info",
      }]);
      const eligible = eligibleCases(run.payments, incident);
      const investigation = await investigateIncident({ incident, eligible });
      const policyDecision = evaluatePlaybooks(incident, investigation.playbooks, eligible);
      await getRunRepository().saveAgentRun(run.id, "investigation", investigation);
      const toolEvents: EventInput[] = investigation.toolEvents.map((toolEvent) => ({
        kind: "tool", title: toolEvent.name, detail: toolEvent.summary, actor: "agent",
        status: toolEvent.status === "completed" ? "success" : "blocked",
        evidence: { callId: toolEvent.callId ?? null, mode: investigation.mode },
      }));
      const nextPhase: RunPhase = policyDecision.outcome === "reject" ? "rejected" :
        policyDecision.outcome === "require_approval" ? "awaiting_canary_approval" : "canary_approved";
      run = await transition(run, nextPhase, (next) => {
        next.investigation = investigation;
        next.policyDecision = policyDecision;
      }, [...toolEvents, {
        kind: "agent", title: "Two bounded recovery strategies proposed",
        detail: investigation.primaryHypothesis,
        actor: "agent", status: investigation.mode === "gemini_agent" ? "success" : "warning",
        evidence: { model: investigation.model, responseId: investigation.responseId ?? null, semanticValidation: investigation.semanticValidation },
      }, {
        kind: "policy", title: policyDecision.outcome === "require_approval" ? "Human approval required" : "Policy decision recorded",
        detail: policyDecision.reasons.join(" ") || "Every deterministic rule passed.",
        actor: "system", status: policyDecision.outcome === "reject" ? "blocked" : "warning",
        evidence: { checkedRules: policyDecision.checkedRules },
      }], receipt(input));
      break;
    }

    case "approve_canary":
    case "reject_canary": {
      requirePhase(run, ["awaiting_canary_approval"]);
      const approve = input.command === "approve_canary";
      const approval = approve ? createApprovalReceipt(run, input, operator, "canary") : null;
      run = await transition(run, approve ? "canary_approved" : "rejected", (next) => {
        if (approval) next.approvals.push(approval);
      }, [{
        kind: "approval", title: approve ? "Canary approved" : "Canary rejected",
        detail: approve ? `${operator.actorId} approved a replay-only twelve-case experiment. No live payment action was initiated.` : `${operator.actorId} rejected the campaign before execution.`,
        actor: "operator", status: approve ? "success" : "blocked",
        evidence: approval ? { approvalId: approval.id, receiptDigest: approval.receiptDigest, approvedVersion: approval.approvedVersion } : { actorId: operator.actorId },
      }], receipt(input));
      break;
    }

    case "run_canary": {
      requirePhase(run, ["canary_approved"]);
      if (!run.incident) throw new RunServiceError("Incident evidence is missing.", 409);
      const eligible = eligibleCases(run.payments, run.incident);
      const assignments = createCanaryAssignments(eligible, run.dataset.seed, 12);
      run = await transition(run, "canary_running", (next) => { next.canaryAssignments = assignments; }, [{
        kind: "canary", title: "Canary assignment persisted before outcome lookup",
        detail: "Twelve eligible cases were randomized 6 × 6 before intervention outcomes were read.",
        actor: "system", status: "info",
        evidence: { seed: run.dataset.seed, assignments },
      }]);
      await delay(700);
      const canary = evaluateCanary(run.canaryAssignments, run.payments, loadReplayFixture().outcomes, run.dataset.seed);
      const winner = canary.results.find((result) => result.playbookId === canary.winnerId)!;
      const challenger = canary.results.find((result) => result.playbookId !== canary.winnerId)!;
      run = await transition(run, "canary_complete", (next) => { next.canary = canary; }, [{
        kind: "canary", title: "Canary measurement complete",
        detail: `${winner.playbookId} recovered ${winner.recovered}/${winner.attempted} versus ${challenger.recovered}/${challenger.attempted}. This result is directional.`,
        actor: "system", status: "success", evidence: { results: canary.results, seed: canary.seed },
      }], receipt(input));
      break;
    }

    case "evaluate_promotion": {
      requirePhase(run, ["canary_complete"]);
      if (!run.canary) throw new RunServiceError("Canary evidence is missing.", 409);
      const canaryEvidence = run.canary;
      run = await transition(run, "evaluating_promotion", () => undefined, [{
        kind: "agent", title: "Promotion evaluation started",
        detail: "Kept is reading persisted canary results and stop conditions.",
        actor: "agent", status: "info",
      }]);
      const promotion = await evaluatePromotion(canaryEvidence);
      await getRunRepository().saveAgentRun(run.id, "promotion", promotion);
      run = await transition(run, "awaiting_promotion_approval", (next) => { next.promotion = promotion; }, [{
        kind: "agent", title: promotion.recommendation === "promote" ? "Measured winner recommended for expansion" : "Expansion withheld",
        detail: promotion.reason, actor: "agent",
        status: promotion.recommendation === "promote" ? "success" : "warning",
        evidence: { model: promotion.model, responseId: promotion.responseId ?? null, recommendation: promotion.recommendation },
      }, {
        kind: "policy", title: "Second human gate enforced",
        detail: "Canary evidence can inform a recommendation; only the operator can authorize expansion.",
        actor: "system", status: "warning",
      }], receipt(input));
      break;
    }

    case "approve_promotion": {
      requirePhase(run, ["awaiting_promotion_approval"]);
      if (run.promotion?.recommendation !== "promote" || !run.incident) throw new RunServiceError("There is no promotable recommendation.", 422);
      const campaign = executeReplayCampaign(eligibleCases(run.payments, run.incident), run.promotion.playbookId!);
      const ledger = campaign.ledger;
      const approval = createApprovalReceipt(run, input, operator, "promotion");
      run = await transition(run, "promoted", (next) => { next.ledger = ledger; next.campaignEvents = campaign.events; next.approvals.push(approval); }, [{
        kind: "approval", title: "Winning playbook promoted",
        detail: `${operator.actorId} authorized expansion: ₹${Math.round(ledger.simulatedAmountPaise / 100).toLocaleString("en-IN")} recovered in deterministic replay versus ₹${Math.round(ledger.baselineAmountPaise / 100).toLocaleString("en-IN")} for the baseline.`,
        actor: "operator", status: "success",
        evidence: { syntheticReplay: ledger.simulatedAmountPaise, baseline: ledger.baselineAmountPaise, replayEvents: campaign.events.length, realRevenueClaimed: false, approvalId: approval.id, receiptDigest: approval.receiptDigest },
      }], receipt(input));
      break;
    }

    case "create_test_link": {
      requirePhase(run, ["promoted", "integration_failure"]);
      if (run.externalAction?.status === "paid") throw new RunServiceError("The Test Mode recovery is already captured.", 409);
      const action = run.externalAction ?? paymentLinkIntent(run.id, `test_owned_${run.cycle}`, 40_000);
      action.status = "creating";
      action.updatedAt = new Date().toISOString();
      await getRunRepository().saveExternalAction(run.id, action);
      run = await transition(run, "payment_link_creating", (next) => { next.externalAction = action; }, [{
        kind: "razorpay", title: "Payment Link intent persisted",
        detail: "A stable reference ID and policy-locked ₹400 amount were recorded before contacting Razorpay.",
        actor: "system", status: "info", evidence: { referenceId: action.referenceId, requestDigest: action.requestDigest },
      }]);
      try {
        const external = await createOrReconcilePaymentLink(action);
        await getRunRepository().saveExternalAction(run.id, external);
        if (external.status === "preview") {
          run = await transition(run, "integration_failure", (next) => {
            next.externalAction = external;
            next.resumePhase = "promoted";
          }, [{
            kind: "guardrail", title: "Razorpay action stopped safely",
            detail: external.failureReason ?? "Test Mode configuration is unavailable.",
            actor: "system", status: "blocked",
          }], receipt(input));
        } else {
          const phase = external.status === "paid" ? "test_payment_captured" : "payment_link_created";
          run = await transition(run, phase, (next) => {
            next.externalAction = external;
            if (external.status === "paid" && next.ledger.testModeCases === 0) {
              next.ledger.razorpayTestAmountPaise = external.amountPaise;
              next.ledger.testModeCases = 1;
            }
          }, [{
            kind: "razorpay", title: external.status === "paid" ? "Existing Test Mode recovery reconciled" : "Razorpay Test Mode link created",
            detail: external.status === "paid" ? "The stable reference ID resolved to an already-paid Test Mode link." : "The provider returned a real Test Mode URL. Synthetic totals remain separate.",
            actor: "razorpay", status: "success", evidence: { providerId: external.providerId, referenceId: external.referenceId },
          }], receipt(input));
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown Razorpay failure.";
        run = await transition(run, "integration_failure", (next) => {
          if (next.externalAction) { next.externalAction.status = "failed"; next.externalAction.failureReason = reason; }
          next.resumePhase = "promoted";
        }, [{
          kind: "guardrail", title: "Payment Link creation failed safely",
          detail: `${reason} No success event was fabricated; retry will reconcile by reference ID first.`,
          actor: "system", status: "blocked",
        }], receipt(input));
      }
      break;
    }

    case "sync_test_link": {
      requirePhase(run, ["payment_link_created", "integration_failure"]);
      const action = run.externalAction;
      if (!action?.providerId) throw new RunServiceError("No real Razorpay Payment Link exists to synchronize.", 422);
      const remote = await fetchPaymentLink(action.providerId);
      const paid = remote.status === "paid";
      run = await transition(run, paid ? "test_payment_captured" : "payment_link_created", (next) => {
        if (!next.externalAction) return;
        next.externalAction.providerStatus = remote.status;
        next.externalAction.status = paid ? "paid" : "created";
        next.externalAction.updatedAt = new Date().toISOString();
        if (paid && next.ledger.testModeCases === 0) {
          next.ledger.razorpayTestAmountPaise = next.externalAction.amountPaise;
          next.ledger.testModeCases = 1;
        }
      }, [{
        kind: "razorpay", title: paid ? "Test Mode capture reconciled" : "Razorpay state synchronized",
        detail: `Authoritative Payment Link status: ${remote.status}.`,
        actor: "razorpay", status: paid ? "success" : "info",
      }], receipt(input));
      break;
    }

    case "replay_demo_webhook": {
      requirePhase(run, ["test_payment_captured"]);
      const eventId = run.processedWebhookIds.at(-1);
      if (!eventId) throw new RunServiceError("No real signed webhook has been processed yet.", 422);
      const audit = createAuditEvent(run, {
        kind: "webhook", title: "Duplicate webhook ignored",
        detail: `${eventId} was already processed; money, contact and payment state remained unchanged.`,
        actor: "razorpay", status: "success", evidence: { eventId, idempotent: true },
      });
      const duplicate = await getRunRepository().applyWebhook(run, run, eventId, "duplicate_replay", "existing", audit);
      if (!duplicate.duplicate) throw new RunServiceError("Expected the event receipt to exist.", 500);
      run = await transition(duplicate.run, "completed", () => undefined, [{
        kind: "webhook", title: "Idempotency proof complete",
        detail: "The duplicated event produced no second execution and the incident is closed.",
        actor: "system", status: "success", evidence: { duplicateExecutions: 0 },
      }], receipt(input));
      break;
    }

    case "stop":
    case "escalate": {
      requirePhase(run, ["incident_detected", "awaiting_canary_approval", "canary_approved", "canary_complete", "awaiting_promotion_approval", "promoted", "integration_failure"]);
      const escalated = input.command === "escalate";
      run = await transition(run, escalated ? "escalated" : "stopped", () => undefined, [{
        kind: "campaign", title: escalated ? "Incident escalated" : "Recovery stopped",
        detail: String(input.payload?.reason ?? (escalated ? "Evidence requires human finance-operations review." : "Operator stopped the workflow.")),
        actor: "operator", status: escalated ? "warning" : "blocked",
      }], receipt(input));
      break;
    }
  }

  return publicSnapshot(run);
}

function payloadEntity(payload: Record<string, unknown>, name: "payment_link" | "payment"): Record<string, unknown> | undefined {
  return ((payload.payload as Record<string, unknown> | undefined)?.[name] as { entity?: Record<string, unknown> } | undefined)?.entity;
}

export async function processRazorpayWebhook(input: {
  eventId: string;
  eventType: string;
  rawBody: string;
  payload: Record<string, unknown>;
  runId: string;
}): Promise<{ duplicate: boolean; ignored: boolean; state: RecoveryRunSnapshot }> {
  const repository = getRunRepository();
  let run = await repository.get(input.runId);
  const digest = createHash("sha256").update(input.rawBody).digest("hex");
  const paymentLink = payloadEntity(input.payload, "payment_link");
  const payment = payloadEntity(input.payload, "payment");
  const paid = input.eventType === "payment_link.paid" || input.eventType === "payment.captured";
  const paymentNotes = payment?.notes as Record<string, unknown> | undefined;
  const linkNotes = paymentLink?.notes as Record<string, unknown> | undefined;
  const remoteId = String(paymentLink?.id ?? payment?.payment_link_id ?? paymentNotes?.recoveros_payment_link_id ?? "");
  const referenceId = String(paymentLink?.reference_id ?? linkNotes?.recoveros_reference_id ?? paymentNotes?.recoveros_reference_id ?? "");
  const tracked = run.externalAction;
  let ignored = true;
  let event: AuditEvent;
  const next = structuredClone(run);

  const exactArtifact = Boolean(tracked?.providerId && remoteId === tracked.providerId && referenceId === tracked.referenceId);
  if (paid && tracked && exactArtifact) {
    const rawAmount = payment?.amount ?? paymentLink?.amount;
    const amountPaise = Number(rawAmount);
    if (rawAmount !== undefined && Number.isFinite(amountPaise) && amountPaise === tracked.amountPaise) {
      ignored = false;
      next.phase = "test_payment_captured";
      next.externalAction = { ...tracked, status: "paid", providerStatus: "paid", updatedAt: new Date().toISOString() };
      if (next.ledger.testModeCases === 0) {
        next.ledger.razorpayTestAmountPaise = amountPaise;
        next.ledger.testModeCases = 1;
      }
      event = createAuditEvent(next, {
        kind: "webhook", title: "Razorpay Test Mode recovery captured",
        detail: `₹${Math.round(amountPaise / 100).toLocaleString("en-IN")} captured from an HMAC-verified ${input.eventType} event.`,
        actor: "razorpay", status: "success", evidence: { eventId: input.eventId, payloadDigest: digest },
      });
    } else {
      event = createAuditEvent(next, {
        kind: "guardrail", title: "Webhook amount mismatch blocked",
        detail: "The HMAC-verified event did not contain the policy-locked recovery amount.",
        actor: "system", status: "blocked", evidence: { expectedPaise: tracked.amountPaise, receivedPaise: amountPaise },
      });
    }
  } else if (input.eventType === "payment.failed" && exactArtifact && (run.phase === "test_payment_captured" || tracked?.status === "paid")) {
    event = createAuditEvent(next, {
      kind: "webhook", title: "Late failure ignored",
      detail: "A terminal paid state already exists, so this out-of-order failure cannot regress it.",
      actor: "razorpay", status: "success", evidence: { eventId: input.eventId },
    });
  } else {
    event = createAuditEvent(next, {
      kind: "webhook", title: "Webhook recorded without state change",
      detail: `${input.eventType} does not match the tracked recovery action.`,
      actor: "razorpay", status: "info", evidence: { eventId: input.eventId },
    });
  }

  next.version = run.version + 1;
  next.updatedAt = new Date().toISOString();
  next.processedWebhookIds = [...next.processedWebhookIds, input.eventId];
  next.audit.push(event);
  const result = await repository.applyWebhook(run, next, input.eventId, input.eventType, digest, event);
  if (result.duplicate) {
    run = result.run;
    const duplicateEvent: EventInput = {
      kind: "webhook", title: "Duplicate webhook ignored",
      detail: `${input.eventId} was already processed; no state or money changed.`,
      actor: "razorpay", status: "success", evidence: { eventId: input.eventId, idempotent: true },
    };
    run = await transition(run, run.phase, () => undefined, [duplicateEvent]);
    return { duplicate: true, ignored: true, state: publicSnapshot(run) };
  }
  return { duplicate: false, ignored, state: publicSnapshot(result.run) };
}

function webhookNotes(entity: Record<string, unknown> | undefined): Record<string, unknown> {
  return entity?.notes && typeof entity.notes === "object" ? entity.notes as Record<string, unknown> : {};
}

export function resolveWebhookRunId(payload: Record<string, unknown>): string | null {
  const paymentLink = payloadEntity(payload, "payment_link");
  const payment = payloadEntity(payload, "payment");
  const candidates = [webhookNotes(paymentLink).recoveros_run_id, webhookNotes(payment).recoveros_run_id];
  const runId = candidates.find((value) => typeof value === "string");
  return typeof runId === "string" && /^run_[a-f0-9]{24}$/.test(runId) ? runId : null;
}
