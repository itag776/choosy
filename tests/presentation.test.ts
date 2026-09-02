import { describe, expect, it } from "vitest";
import { createAuditEvent, createInitialRun } from "@/lib/demo-data";
import { detectIncident } from "@/lib/detector";
import { loadReplayFixture } from "@/lib/fixtures";
import { presentationFor } from "@/lib/presentation";
import { eligibleCases, evaluatePlaybooks } from "@/lib/policy";
import { fallbackPromotion } from "@/lib/recovery-agent";
import { createCanaryAssignments, evaluateCanary } from "@/lib/simulator";
import type { ApprovalReceipt, RunPhase, StoredRecoveryRun } from "@/lib/types";
import { testInvestigation } from "@/tests/helpers";

function approval(type: ApprovalReceipt["type"], index: number): ApprovalReceipt {
  return {
    id: `approval_${index}`,
    type,
    actorId: "operator_judge",
    actorRole: "operator",
    reason: "Reviewed the bounded evidence.",
    runId: "run_presentation",
    approvedVersion: index + 4,
    policyDigest: "a".repeat(64),
    cohortDigest: "b".repeat(64),
    receiptDigest: "c".repeat(64),
    createdAt: "2026-09-02T06:00:00.000Z",
  };
}

function richState(): StoredRecoveryRun {
  const state = createInitialRun(new Date("2026-09-02T06:00:00.000Z"), "run_presentation");
  const fixture = loadReplayFixture();
  const incident = detectIncident(fixture.payments)!;
  const eligible = eligibleCases(fixture.payments, incident);
  const investigation = testInvestigation(incident, eligible);
  const assignments = createCanaryAssignments(eligible, ["timed_retry", "multi_rail_link"], fixture.manifest.seed);
  const canary = evaluateCanary(assignments, fixture.payments, fixture.outcomes, fixture.manifest.seed);

  state.incident = incident;
  state.investigation = investigation;
  state.policyDecision = evaluatePlaybooks(incident, investigation.playbooks, eligible, investigation.rankedActions);
  state.canaryAssignments = assignments;
  state.canary = canary;
  state.promotion = fallbackPromotion(canary);
  state.approvals = [approval("canary", 1), approval("promotion", 2)];
  state.ledger = {
    ...state.ledger,
    simulatedAmountPaise: 1_000_000,
    baselineAmountPaise: 400_000,
    razorpayTestAmountPaise: 40_000,
    simulatedCases: 5,
    baselineCases: 2,
    testModeCases: 1,
  };
  state.externalAction = {
    id: "external_1",
    runId: state.id,
    type: "razorpay_payment_link",
    idempotencyKey: "payment:1",
    referenceId: "rcv_presentation",
    caseId: "case_1",
    amountPaise: 40_000,
    status: "paid",
    providerId: "plink_presentation",
    providerStatus: "paid",
    notificationMedium: "email",
    notificationStatus: "stopped",
    maskedRecipient: "ju••••@example.com",
    requestDigest: "d".repeat(64),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
  return state;
}

describe("phase presentation", () => {
  it("provides concrete copy and three explanation steps for every phase", () => {
    const phases: RunPhase[] = [
      "idle", "incident_streaming", "incident_detected", "investigating", "agent_failure",
      "awaiting_canary_approval", "canary_approved", "canary_running",
      "canary_complete", "evaluating_promotion", "awaiting_promotion_approval",
      "promoted", "payment_link_creating", "payment_link_created",
      "test_payment_captured", "completed", "rejected", "stopped",
      "escalated", "integration_failure",
    ];

    for (const phase of phases) {
      const state = richState();
      state.phase = phase;
      const presentation = presentationFor(state);
      expect(presentation.title, phase).not.toBe("");
      expect(presentation.body, phase).not.toBe("");
      expect(presentation.explanation.boundary, phase).not.toBe("");
      expect(presentation.explanation.steps, phase).toHaveLength(3);
      expect(presentation.explanation.steps.every((item) => item.label && item.detail && item.value), phase).toBe(true);
    }
  });

  it("uses direct judge-facing outcome copy", () => {
    const state = richState();
    state.phase = "idle";
    expect(presentationFor(state).title).toBe("Recover failed payments. Safely.");

    state.phase = "incident_detected";
    expect(presentationFor(state).title).toContain("Issuer A card payments are failing.");
    expect(presentationFor(state).body).toContain("120 affected attempts");

    state.phase = "awaiting_promotion_approval";
    expect(presentationFor(state).title).toContain("recovered");
    expect(presentationFor(state).title).toContain("of 40");
    expect(presentationFor(state).body).toContain("of 40");

    state.phase = "canary_complete";
    expect(presentationFor(state).explanation.title).toBe("How the 80-case test stays honest");
    state.phase = "evaluating_promotion";
    expect(presentationFor(state).explanation.title).toBe("How measured evidence becomes a recovery decision");
  });

  it("does not claim a signed webhook or duplicate block before the audit proves them", () => {
    const state = richState();
    state.phase = "test_payment_captured";
    const captured = presentationFor(state);
    expect(captured.body).toContain("waiting for the signed webhook");
    expect(captured.explanation.steps[2].value).toBe("Waiting for webhook");

    state.audit.push(createAuditEvent(state, {
      kind: "webhook",
      title: "Razorpay Test Mode recovery captured",
      detail: "₹400 captured from an HMAC-verified payment_link.paid event.",
      actor: "razorpay",
      status: "success",
    }));
    state.phase = "completed";
    state.audit.push(createAuditEvent(state, {
      kind: "webhook",
      title: "Duplicate webhook ignored",
      detail: "The repeated event produced no second execution.",
      actor: "razorpay",
      status: "success",
    }));

    const completed = presentationFor(state);
    expect(completed.title).toBe("₹400 recovered. Counted once.");
    expect(completed.explanation.steps[2].value).toBe("Duplicate blocked");
  });
});
