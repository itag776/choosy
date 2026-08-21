export type DemoPhase =
  | "idle"
  | "incident_detected"
  | "analyzed"
  | "approved"
  | "canary_complete"
  | "promoted";

export type PaymentStatus = "captured" | "failed" | "pending";
export type CampaignStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "canary_running"
  | "canary_complete"
  | "promoted"
  | "stopped"
  | "escalated";

export interface PaymentAttempt {
  id: string;
  customerId: string;
  amount: number;
  method: "card" | "upi" | "netbanking" | "mandate";
  issuer: string;
  status: PaymentStatus;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  consent: boolean;
  contactsLast24h: number;
  createdAt: string;
}

export interface IncidentEvidence {
  id: string;
  title: string;
  affectedCohort: string;
  affectedAttempts: number;
  failedAttempts: number;
  baselineSuccessRate: number;
  observedSuccessRate: number;
  deltaPercentagePoints: number;
  confidence: number;
  revenueAtRisk: number;
  topError: string;
  detectedAt: string;
  source: "deterministic_detector";
}

export interface CandidatePlaybook {
  id: "wait_retry" | "alternate_link";
  name: string;
  action: "retry_original" | "payment_link";
  timingMinutes: number;
  enabledMethods: Array<"card" | "upi" | "netbanking">;
  targetCohort: string;
  rationale: string;
  risks: string[];
  contactCount: number;
}

export interface PolicyDecision {
  outcome: "allow" | "require_approval" | "reject";
  reasons: string[];
  checkedRules: number;
}

export interface CanaryAssignment {
  caseId: string;
  playbookId: CandidatePlaybook["id"];
  immutable: true;
}

export interface PlaybookResult {
  playbookId: CandidatePlaybook["id"];
  attempted: number;
  recovered: number;
  recoveredAmount: number;
  conversionRate: number;
}

export interface CanaryResult {
  assignments: CanaryAssignment[];
  results: PlaybookResult[];
  winnerId: CandidatePlaybook["id"];
  confidenceWarning: string;
}

export interface AgentAnalysis {
  mode: "openai_agent" | "deterministic_fallback";
  hypothesis: string;
  recommendation: string;
  uncertainty: string;
  playbooks: CandidatePlaybook[];
  toolsUsed: string[];
  traceId?: string;
}

export interface RecoveryCampaign {
  id: string;
  incidentId: string;
  status: CampaignStatus;
  agentAnalysis: AgentAnalysis;
  policy: PolicyDecision;
  canary?: CanaryResult;
  approvedAt?: string;
  promotedAt?: string;
  paymentLink?: {
    id: string;
    shortUrl: string;
    referenceId: string;
    amount: number;
    mode: "razorpay_test" | "demo_preview";
    status: "created" | "paid" | "failed";
  };
}

export interface RecoveryLedger {
  simulatedAmount: number;
  baselineAmount: number;
  razorpayTestAmount: number;
  simulatedCases: number;
  testModeCases: number;
}

export interface AuditEvent {
  id: string;
  kind:
    | "demo"
    | "detector"
    | "agent"
    | "policy"
    | "approval"
    | "canary"
    | "campaign"
    | "razorpay"
    | "webhook"
    | "guardrail";
  title: string;
  detail: string;
  actor: "system" | "agent" | "operator" | "razorpay";
  status: "info" | "success" | "warning" | "blocked";
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
  baselineContacts: number;
  recoverosContacts: number;
}

export interface DashboardState {
  phase: DemoPhase;
  payments: PaymentAttempt[];
  incident: IncidentEvidence | null;
  campaign: RecoveryCampaign | null;
  ledger: RecoveryLedger;
  metrics: BenchmarkMetrics;
  audit: AuditEvent[];
  processedWebhookIds: string[];
  integration: {
    openai: boolean;
    razorpay: boolean;
    webhookSecret: boolean;
    persistence: "memory" | "supabase";
  };
  dataset: {
    name: string;
    version: string;
    seed: number;
    manifestHash: string;
    totalAttempts: number;
    holdoutPercent: number;
  };
}
