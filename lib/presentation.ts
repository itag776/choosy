import type { RecoveryRunSnapshot, RunPhase } from "@/lib/types";

export type PresentationTone = "blue" | "red" | "green";
export type ExplainerStatus = "complete" | "current" | "waiting";

export interface ExplainerStep {
  label: string;
  detail: string;
  value: string;
  status: ExplainerStatus;
}

export interface PhasePresentation {
  eyebrow: string;
  title: string;
  body: string;
  tone: PresentationTone;
  explanation: {
    title: string;
    summary: string;
    boundary: string;
    steps: [ExplainerStep, ExplainerStep, ExplainerStep];
  };
}

const labels: Record<RunPhase, string> = {
  idle: "Ready",
  incident_streaming: "Watching payments",
  incident_detected: "Incident detected",
  investigating: "Checking the cause",
  agent_failure: "AI decision unavailable",
  awaiting_canary_approval: "Options ready",
  canary_approved: "Test approved",
  canary_running: "Test running",
  canary_complete: "Test complete",
  evaluating_promotion: "Comparing results",
  awaiting_promotion_approval: "Decision ready",
  promoted: "Recovery approved",
  payment_link_creating: "Creating payment",
  payment_link_created: "Payment ready",
  test_payment_captured: "Payment captured",
  completed: "Recovery complete",
  rejected: "Test rejected",
  stopped: "Recovery stopped",
  escalated: "Human review required",
  integration_failure: "Provider needs attention",
};

function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function step(label: string, detail: string, value: string, status: ExplainerStatus): ExplainerStep {
  return { label, detail, value, status };
}

function playbookName(state: RecoveryRunSnapshot, id: string | undefined): string {
  return state.investigation?.rankedActions.find((playbook) => playbook.id === id)?.name ?? id?.replaceAll("_", " ") ?? "Recovery option";
}

function hasAudit(state: RecoveryRunSnapshot, pattern: RegExp): boolean {
  return state.audit.some((event) => pattern.test(`${event.title} ${event.detail}`));
}

function detectExplanation(state: RecoveryRunSnapshot): PhasePresentation["explanation"] {
  const incident = state.incident;
  const streaming = state.phase === "incident_streaming";
  const detected = Boolean(incident);

  return {
    title: "How Kept separates a real incident from noise",
    summary: "The detector groups comparable payment attempts and opens an incident only when the cohort is large enough and the success-rate drop crosses policy thresholds.",
    boundary: "A detection signal cannot contact a customer, retry a payment, or move money.",
    steps: [
      step(
        "Read verified attempts",
        "The locked replay keeps every demo run comparable.",
        `${state.dataset.totalAttempts} attempts`,
        streaming || detected ? "complete" : "current",
      ),
      step(
        "Compare payment paths",
        incident
          ? `${incident.cohort.issuer} · ${incident.cohort.method} · ${incident.cohort.errorStep}`
          : "Group by issuer, method, step, and failure reason.",
        incident ? `${percent(incident.observedSuccessRate)} vs ${percent(incident.baselineSuccessRate)}` : "Waiting for signal",
        detected ? "complete" : streaming ? "current" : "waiting",
      ),
      step(
        "Open a thresholded incident",
        incident
          ? `Requires at least ${incident.thresholds.minimumSample} attempts and a ${incident.thresholds.minimumDropPercentagePoints}-point drop.`
          : "No incident opens from one isolated failure.",
        incident ? `${incident.deltaPercentagePoints.toFixed(1)} points down` : "Threshold gated",
        detected ? "complete" : "waiting",
      ),
    ],
  };
}

function understandExplanation(state: RecoveryRunSnapshot): PhasePresentation["explanation"] {
  const finished = Boolean(state.investigation);
  const policyReady = Boolean(state.policyDecision);
  const mode = state.investigation?.mode === "gemini_cache" ? "Validated Gemini cache" : "Live Gemini + typed tools";

  return {
    title: "How Gemini chooses the recovery test",
    summary: "Gemini reads the evidence, ranks all four bounded actions, chooses the two worth testing, and explains why the others do not fit.",
    boundary: "The model can recommend an option. It cannot approve a test or move money.",
    steps: [
      step(
        "Read incident evidence",
        "Use the isolated cohort, failure path, and rejected alternative causes.",
        state.incident ? `${percent(state.incident.incidentScore)} signal` : "Evidence required",
        "complete",
      ),
      step(
        "Challenge the likely cause",
        finished
          ? `${state.investigation!.supportingEvidence.length} supporting checks and ${state.investigation!.rejectedHypotheses.length} rejected alternatives.`
          : "Inspect policy, eligible cases, available actions, and competing explanations.",
        mode,
        finished ? "complete" : "current",
      ),
      step(
        "Validate—not choose",
        "Deterministic policy checks the model's choice without substituting its own strategy.",
        policyReady ? `${state.policyDecision!.checkedRules.length} rules checked` : "Waiting",
        policyReady ? "complete" : "waiting",
      ),
    ],
  };
}

function testExplanation(state: RecoveryRunSnapshot): PhasePresentation["explanation"] {
  if (state.phase === "rejected") {
    return {
      title: "How the approval boundary stopped the test",
      summary: "The proposed options passed policy, but policy still required an authenticated operator decision before any test could run.",
      boundary: "A rejected test executes no recovery cases and creates no payment action.",
      steps: [
        step("Request approval", "Show the bounded cohort and both recovery options.", "Required", "complete"),
        step("Record the decision", "Bind the rejection to this run and version.", "Rejected", "complete"),
        step("Stop execution", "Leave assignments, contacts, and ledgers unchanged.", "0 cases run", "complete"),
      ],
    };
  }

  const committed = state.canaryAssignments.length > 0;
  const measured = Boolean(state.canary);
  const result = state.canary?.results.map((item) => `${item.recovered}/${item.attempted}`).join(" vs ") ?? "Waiting";

  return {
    title: "How the 80-case test stays honest",
    summary: "Both Gemini-selected actions receive 40 comparable cases, and assignments are fixed before causal outcomes are generated.",
    boundary: "Only the 80 committed replay cases can run. Live customer payments remain untouched.",
    steps: [
      step(
        "Commit the split",
        "Seeded assignment prevents choosing favorable cases after the fact.",
        committed ? `${state.canaryAssignments.length} cases · 40 + 40` : "80 cases · 40 + 40",
        committed ? "complete" : "current",
      ),
      step(
        "Run both options",
        "Each option keeps the original amount and the same contact boundary.",
        state.phase === "canary_running" ? "Reading outcomes" : measured ? "Complete" : "Waiting",
        measured ? "complete" : state.phase === "canary_running" ? "current" : "waiting",
      ),
      step(
        "Compare recovery",
        "Measure recovery, value, absolute lift, and a 95% uncertainty interval.",
        result,
        measured ? "complete" : "waiting",
      ),
    ],
  };
}

function decideExplanation(state: RecoveryRunSnapshot): PhasePresentation["explanation"] {
  const canary = state.canary;
  const winner = canary?.results.find((item) => item.playbookId === canary.winnerId);
  const recommendationReady = Boolean(state.promotion);
  const approved = state.approvals.some((approval) => approval.type === "promotion");

  return {
    title: "How measured evidence becomes a recovery decision",
    summary: "A pre-registered statistical gate checks sample size, recovered value, material lift, and the 95% interval before approval is possible.",
    boundary: "A measured winner cannot scale until an authenticated operator approves it.",
    steps: [
      step(
        "Read the measured winner",
        winner ? `${playbookName(state, winner.playbookId)} recovered ${winner.recovered} of ${winner.attempted}.` : "Wait for the canary to finish.",
        canary ? `+${Math.round(canary.comparison.absoluteLift * 100)} points` : "Waiting",
        canary ? "complete" : "waiting",
      ),
      step(
        "Check stopping conditions",
        "Withhold expansion unless 40 × 40, value, 10-point lift, and the 95% interval all pass.",
        recommendationReady ? (state.promotion!.recommendation === "promote" ? "Gate passed" : "Withheld") : "Checking",
        recommendationReady ? "complete" : "current",
      ),
      step(
        "Require a human decision",
        "The approval receipt binds the operator, policy, cohort, run, and version.",
        approved ? "Approved" : "Approval required",
        approved ? "complete" : recommendationReady ? "current" : "waiting",
      ),
    ],
  };
}

function proveExplanation(state: RecoveryRunSnapshot): PhasePresentation["explanation"] {
  const intentPersisted = Boolean(state.externalAction);
  const providerCreated = Boolean(state.externalAction?.providerId);
  const notificationAccepted = state.externalAction?.notificationStatus === "accepted" || state.externalAction?.notificationStatus === "stopped";
  const signedWebhook = hasAudit(state, /HMAC-verified|signed webhook/i);
  const duplicateBlocked = state.phase === "completed" || hasAudit(state, /Duplicate webhook ignored|Idempotency proof complete/i);

  return {
    title: "How Kept proves the provider boundary",
    summary: "Kept creates one owned Test Mode link, asks Razorpay to email it, waits for capture, and stops further contact. Synthetic and provider money stay separate.",
    boundary: duplicateBlocked
      ? "A repeated webhook cannot add money or trigger another customer contact."
      : "Kept cannot count provider money without a matching paid Razorpay artifact.",
    steps: [
      step(
        "Persist the payment intent",
        "Save a stable reference, locked ₹400 amount, and request digest before contacting Razorpay.",
        intentPersisted ? state.externalAction!.referenceId : "Not created",
        intentPersisted ? "complete" : "current",
      ),
      step(
        "Send through Razorpay",
        notificationAccepted ? `Razorpay accepted one email for ${state.externalAction!.maskedRecipient ?? "the configured recipient"}; this does not claim inbox delivery.` : "Create the link, then call Razorpay's email notification endpoint.",
        notificationAccepted ? "Email accepted" : providerCreated ? "Link created" : "Waiting",
        notificationAccepted ? "complete" : providerCreated ? "current" : "waiting",
      ),
      step(
        "Verify the event boundary",
        signedWebhook
          ? "Match the signed event to the stored provider ID, reference, and amount."
          : "A signed webhook must match the stored provider ID, reference, and amount.",
        duplicateBlocked ? "Duplicate blocked" : signedWebhook ? "Signature matched" : "Waiting for webhook",
        duplicateBlocked ? "complete" : signedWebhook ? "current" : "waiting",
      ),
    ],
  };
}

export function presentationFor(state: RecoveryRunSnapshot): PhasePresentation {
  const base = { eyebrow: labels[state.phase], tone: "blue" as PresentationTone };

  switch (state.phase) {
    case "idle":
      return {
        ...base,
        title: "Recover failed payments. Safely.",
        body: "Kept spots payment drops, finds the cause, tests recovery options, and asks you before acting.",
        explanation: detectExplanation(state),
      };
    case "incident_streaming":
      return {
        ...base,
        title: `Checking ${state.dataset.totalAttempts} payment attempts.`,
        body: "Kept is grouping comparable payments to separate a real pattern from isolated failures.",
        explanation: detectExplanation(state),
      };
    case "incident_detected": {
      const incident = state.incident!;
      return {
        ...base,
        tone: "red",
        title: `${incident.cohort.issuer} ${incident.cohort.method} payments are failing.`,
        body: `${incident.affectedAttempts} affected attempts put ${formatInr(incident.revenueAtRiskPaise)} at risk in the verified replay.`,
        explanation: detectExplanation(state),
      };
    }
    case "investigating":
      return {
        ...base,
        title: "Finding the cause—not guessing.",
        body: "Kept checks the incident, merchant policy, eligible cases, available actions, and competing explanations.",
        explanation: understandExplanation(state),
      };
    case "agent_failure":
      return {
        ...base,
        tone: "red",
        title: "Gemini did not make a decision.",
        body: "Kept stopped instead of substituting a rules-based recovery choice. Retry Gemini to continue.",
        explanation: understandExplanation(state),
      };
    case "awaiting_canary_approval":
      return {
        ...base,
        title: "Gemini selected 2 of 4 actions.",
        body: "The chosen actions passed deterministic bounds. You decide whether to commit the 40 × 40 test.",
        explanation: understandExplanation(state),
      };
    case "rejected":
      return {
        ...base,
        tone: "red",
        title: "Test rejected. Nothing ran.",
        body: "No recovery case, customer contact, or payment action was executed.",
        explanation: testExplanation(state),
      };
    case "canary_approved":
      return {
        ...base,
        title: "Testing 80 cases before scaling.",
        body: "Each selected action receives 40 cases. Assignments are fixed before causal outcomes are generated.",
        explanation: testExplanation(state),
      };
    case "canary_running":
      return {
        ...base,
        title: "Testing 80 cases before scaling.",
        body: "The committed 40 × 40 replay is running. Live customer payments remain untouched.",
        explanation: testExplanation(state),
      };
    case "canary_complete": {
      const winner = state.canary?.results.find((item) => item.playbookId === state.canary?.winnerId);
      const loser = state.canary?.results.find((item) => item.playbookId !== state.canary?.winnerId);
      return {
        ...base,
        title: winner ? `${playbookName(state, winner.playbookId)} recovered ${winner.recovered} of ${winner.attempted}.` : "The 80-case test is complete.",
        body: winner && loser
          ? `${playbookName(state, loser.playbookId)} recovered ${loser.recovered} of ${loser.attempted}. Review the comparison before deciding.`
          : "Both recovery options were measured on their committed cases.",
        explanation: testExplanation(state),
      };
    }
    case "evaluating_promotion":
    case "awaiting_promotion_approval": {
      const winner = state.canary?.results.find((item) => item.playbookId === state.canary?.winnerId);
      const loser = state.canary?.results.find((item) => item.playbookId !== state.canary?.winnerId);
      return {
        ...base,
        title: winner ? `${playbookName(state, winner.playbookId)} recovered ${winner.recovered} of ${winner.attempted}.` : "Comparing the measured result.",
        body: winner && loser
          ? `${playbookName(state, loser.playbookId)} recovered ${loser.recovered} of ${loser.attempted}. Expansion still requires your approval.`
          : "Kept is checking the winner against policy and stopping conditions.",
        explanation: decideExplanation(state),
      };
    }
    case "promoted":
      return {
        ...base,
        title: "Separate simulation from Razorpay money.",
        body: "The batch result is measured. Now verify one ₹400 recovery through Razorpay Test Mode.",
        explanation: proveExplanation(state),
      };
    case "payment_link_creating":
      return {
        ...base,
        title: "Creating one tracked test payment.",
        body: "Kept saved the reference and locked amount before contacting Razorpay.",
        explanation: proveExplanation(state),
      };
    case "payment_link_created":
      return {
        ...base,
        title: "Razorpay accepted the recovery email.",
        body: "Open the owned Test Mode link, complete ₹400, then return here to confirm the signed provider event.",
        explanation: proveExplanation(state),
      };
    case "integration_failure":
      return {
        ...base,
        tone: "red",
        title: "Razorpay needs attention.",
        body: state.externalAction?.failureReason
          ? `${state.externalAction.failureReason} No recovery was fabricated or counted.`
          : "The provider action stopped safely. Retry will reconcile the stored reference before creating anything new.",
        explanation: proveExplanation(state),
      };
    case "test_payment_captured": {
      const signedWebhook = hasAudit(state, /HMAC-verified|signed webhook/i);
      return {
        ...base,
        tone: "green",
        title: `${formatInr(state.ledger.razorpayTestAmountPaise)} captured in Razorpay Test Mode.`,
        body: signedWebhook
          ? "The tracked payment is counted once. Replay its signed webhook to verify a duplicate cannot change the ledger."
          : "Razorpay reports the tracked payment as paid. Kept is waiting for the signed webhook before testing duplicate safety.",
        explanation: proveExplanation(state),
      };
    }
    case "completed":
      return {
        ...base,
        tone: "green",
        title: `${formatInr(state.ledger.razorpayTestAmountPaise)} recovered. Counted once.`,
        body: "Razorpay confirmed the payment, customer contact stopped, and the duplicate webhook changed nothing.",
        explanation: proveExplanation(state),
      };
    case "stopped":
      return {
        ...base,
        tone: "red",
        title: "Recovery stopped. Nothing else will run.",
        body: "No further customer contact or payment action can occur. The recorded evidence remains available.",
        explanation: decideExplanation(state),
      };
    case "escalated":
      return {
        ...base,
        tone: "red",
        title: "Human review required.",
        body: "Kept stopped execution and preserved the evidence for a finance-operations decision.",
        explanation: decideExplanation(state),
      };
  }
}
