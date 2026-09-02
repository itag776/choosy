export type RunPhase =
  | "idle" | "incident_streaming" | "incident_detected" | "investigating"
  | "agent_failure"
  | "awaiting_canary_approval" | "canary_approved" | "canary_running"
  | "canary_complete" | "evaluating_promotion" | "awaiting_promotion_approval"
  | "promoted" | "payment_link_creating" | "payment_link_created"
  | "test_payment_captured" | "completed" | "rejected" | "stopped"
  | "escalated" | "integration_failure";

export type PaymentMethod = "card" | "upi" | "netbanking" | "mandate";
export type PaymentStatus = "captured" | "failed" | "pending";
export type ActionId = "timed_retry" | "multi_rail_link" | "upi_only_link" | "observe_escalate";
export type PlaybookId = ActionId;

export interface PaymentAttempt {
  id: string;
  customerId: string;
  amountPaise: number;
  method: PaymentMethod;
  issuer: string;
  status: PaymentStatus;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  consent: boolean;
  contactsLast24h: number;
  createdAt: string;
}

export interface CompetingHypothesis {
  id: string;
  label: string;
  support: number;
  evidence: string;
  disposition: "supported" | "rejected";
}

export interface IncidentEvidence {
  id: string;
  title: string;
  cohort: { issuer: string; method: PaymentMethod; errorStep: string; errorReason: string };
  cohortQuery: string;
  affectedAttempts: number;
  failedAttempts: number;
  baselineSuccessRate: number;
  observedSuccessRate: number;
  deltaPercentagePoints: number;
  incidentScore: number;
  revenueAtRiskPaise: number;
  topError: string;
  detectedAt: string;
  thresholds: { minimumSample: number; minimumDropPercentagePoints: number };
  competingHypotheses: CompetingHypothesis[];
  source: "deterministic_detector";
}

export interface CandidatePlaybook {
  id: ActionId;
  name: string;
  action: "retry_original" | "payment_link" | "observe_escalate";
  timingMinutes: number;
  enabledMethods: Array<"card" | "upi" | "netbanking">;
  targetCohort: string;
  rationale: string;
  risks: string[];
  contactCount: number;
  amountPolicy: "preserve_original";
  channel: "email" | "none";
  rank: number;
  selected: boolean;
}

export interface PolicyDecision {
  outcome: "allow" | "require_approval" | "reject";
  reasons: string[];
  checkedRules: Array<{ id: string; label: string; outcome: "pass" | "approval" | "reject" }>;
  evaluatedAt: string;
}

export interface ToolEvidence {
  name: string;
  callId?: string;
  status: "completed" | "failed";
  summary: string;
}

export interface InvestigationResult {
  mode: "gemini_agent" | "gemini_cache";
  model: string;
  inputDigest: string;
  promptVersion: string;
  catalogVersion: string;
  decision: "test" | "hold" | "escalate";
  primaryHypothesis: string;
  supportingEvidence: string[];
  rejectedHypotheses: string[];
  uncertainty: string;
  eligibleCaseCount: number;
  playbooks: CandidatePlaybook[];
  rankedActions: CandidatePlaybook[];
  rejectedActionReasons: Array<{ actionId: ActionId; reason: string }>;
  toolEvents: ToolEvidence[];
  responseId?: string;
  semanticValidation: "passed" | "cache_validated";
}

export interface CanaryAssignment {
  caseId: string;
  playbookId: PlaybookId;
  ordinal: number;
  committed: true;
}

export interface PlaybookResult {
  playbookId: PlaybookId;
  attempted: number;
  recovered: number;
  recoveredAmountPaise: number;
  conversionRate: number;
  contacts: number;
}

export interface CanaryResult {
  seed: number;
  assignments: CanaryAssignment[];
  results: PlaybookResult[];
  winnerId: PlaybookId;
  liftMultiple: number;
  sampleWarning: string;
  comparison: {
    absoluteLift: number;
    recoveredValueDifferencePaise: number;
    confidenceLevel: 0.95;
    confidenceInterval: [number, number];
    minimumPerArm: 40;
    gate: "pass" | "extend" | "stop";
    gateReasons: string[];
  };
  completedAt: string;
}

export interface PromotionRecommendation {
  mode: "statistical_gate";
  model: string;
  recommendation: "promote" | "extend_canary" | "stop" | "escalate";
  playbookId: PlaybookId | null;
  evidence: string[];
  reason: string;
  uncertainty: string;
  stoppingConditions: string[];
  toolEvents: ToolEvidence[];
  responseId?: string;
  semanticValidation: "passed";
}

export interface ExternalAction {
  id: string;
  runId: string;
  type: "razorpay_payment_link";
  idempotencyKey: string;
  referenceId: string;
  caseId: string;
  amountPaise: number;
  status: "intent_recorded" | "creating" | "created" | "paid" | "failed" | "preview";
  providerId?: string;
  shortUrl?: string;
  providerStatus?: string;
  notificationMedium: "email" | "none";
  notificationStatus: "not_requested" | "pending" | "accepted" | "failed" | "stopped";
  maskedRecipient?: string;
  notificationAcceptedAt?: string;
  requestDigest: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryLedger {
  simulatedAmountPaise: number;
  baselineAmountPaise: number;
  razorpayTestAmountPaise: number;
  simulatedCases: number;
  baselineCases: number;
  testModeCases: number;
  simulatedContacts: number;
  baselineContacts: number;
}

export interface ReplayCampaignEvent {
  id: string;
  sequence: number;
  caseId: string;
  playbookId: PlaybookId | "baseline_generic";
  kind: "intervention_dispatched" | "recovery_captured" | "contact_stopped";
  amountPaise: number;
  createdAt: string;
}

export interface BenchmarkMetrics {
  detectionPrecision: number;
  detectionRecall: number;
  cohortF1: number;
  playbookAccuracy: number;
  policyViolations: number;
  duplicateExecutions: number;
  postRecoveryContacts: number;
  evaluatedCases: number;
  safetyCases: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  datasetHash: string;
  confidenceLevel: 0.95;
  intervals: {
    detectionPrecision: [number, number];
    detectionRecall: [number, number];
    playbookAccuracy: [number, number];
  };
  generatedAt: string;
}

export interface ApprovalReceipt {
  id: string;
  type: "canary" | "promotion";
  actorId: string;
  actorRole: "operator";
  reason: string;
  runId: string;
  approvedVersion: number;
  policyDigest: string;
  cohortDigest: string;
  receiptDigest: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  sequence: number;
  kind: "demo" | "detector" | "agent" | "tool" | "policy" | "approval" | "canary" | "campaign" | "razorpay" | "webhook" | "guardrail";
  title: string;
  detail: string;
  actor: "system" | "agent" | "operator" | "razorpay";
  status: "info" | "success" | "warning" | "blocked";
  evidence?: Record<string, unknown>;
  previousHash: string;
  hash: string;
  createdAt: string;
}

export interface CommandReceipt {
  idempotencyKey: string;
  command: RunCommand;
  version: number;
  completedAt: string;
}

export interface RecoveryRunSnapshot {
  id: string;
  merchantId: string;
  phase: RunPhase;
  cycle: number;
  resumePhase?: RunPhase;
  version: number;
  fixtureVersion: string;
  incident: IncidentEvidence | null;
  investigation: InvestigationResult | null;
  policyDecision: PolicyDecision | null;
  canaryAssignments: CanaryAssignment[];
  canary: CanaryResult | null;
  promotion: PromotionRecommendation | null;
  externalAction: ExternalAction | null;
  ledger: RecoveryLedger;
  campaignEvents: ReplayCampaignEvent[];
  metrics: BenchmarkMetrics;
  audit: AuditEvent[];
  approvals: ApprovalReceipt[];
  commandReceipts: CommandReceipt[];
  integration: {
    gemini: boolean;
    razorpay: boolean;
    webhookSecret: boolean;
    persistence: "supabase" | "local_file";
  };
  dataset: {
    name: string;
    version: string;
    seed: number;
    manifestHash: string;
    totalAttempts: number;
    holdoutPercent: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StoredRecoveryRun extends RecoveryRunSnapshot {
  payments: PaymentAttempt[];
  processedWebhookIds: string[];
}

export type RunCommand =
  | "reset_replay" | "inject_incident" | "investigate" | "approve_canary"
  | "reject_canary" | "run_canary" | "evaluate_promotion"
  | "approve_promotion" | "stop" | "escalate" | "create_test_link"
  | "sync_test_link" | "replay_demo_webhook";

export interface RunCommandRequest {
  command: RunCommand;
  expectedVersion: number;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export interface OperatorIdentity {
  actorId: string;
  role: "operator";
  runId: string;
}

export interface InterventionOutcome {
  caseId: string;
  outcomes: Record<ActionId | "baseline_generic", boolean>;
}

export interface ReplayManifest {
  name: string;
  version: string;
  seed: number;
  totalAttempts: number;
  affectedAttempts: number;
  holdoutPercent: number;
  generatedAt: string;
  hashes: { payments: string; causalModel: string; holdout: string };
}
