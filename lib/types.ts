export type ProductCategory = "phones" | "headphones" | "running-shoes";

export type ShoppingPhase =
  | "discovering"
  | "recommendations_ready"
  | "item_selected"
  | "cart_review"
  | "checkout_creating"
  | "checkout_ready"
  | "needs_reselection"
  | "payment_failed"
  | "paid"
  | "agent_failure";

export interface QuestionDefinition {
  key: string;
  prompt: string;
  choices: string[];
  required: boolean;
  weight: number;
}

export interface CategoryProfile {
  category: ProductCategory;
  label: string;
  description: string;
  version: string;
  questions: QuestionDefinition[];
}

export interface PreferenceProfile {
  category: ProductCategory | null;
  maxBudgetPaise: number | null;
  useCase: string | null;
  brandPreference: string | null;
  mustHaves: string[];
  answers: Record<string, string>;
  confirmedKeys: string[];
}

export interface ProductVariant {
  id: string;
  sku: string;
  label: string;
  pricePaise: number;
  stock: number;
  attributes: Record<string, string>;
}

export interface Product {
  id: string;
  sku: string;
  category: ProductCategory;
  kind: "primary" | "addon";
  brand: string;
  name: string;
  description: string;
  imageUrl: string;
  promoted: boolean;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
  variants: ProductVariant[];
}

export interface Recommendation {
  productId: string;
  variantId: string;
  label: "Best fit" | "Best value" | "Alternative";
  fitScore: number;
  matchedNeeds: string[];
  tradeoff: string;
  reason: string;
  promotionInfluencedTie: boolean;
}

export interface RankResult {
  recommendations: Recommendation[];
  brandFallback: boolean;
}

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: 1;
  unitPricePaise: number;
  kind: "primary" | "addon";
}

export interface Cart {
  id: string;
  items: CartItem[];
  totalPaise: number;
  digest: string;
  confirmedAt?: string;
}

export interface Quote {
  id: string;
  cart: Cart;
  catalogVersion: string;
  expiresAt: string;
  digest: string;
}

export interface CheckoutAction {
  id: string;
  sessionId: string;
  cartId: string;
  cartDigest: string;
  quoteDigest: string;
  idempotencyKey: string;
  referenceId: string;
  amountPaise: number;
  status: "intent_recorded" | "preview" | "created" | "paid" | "failed";
  providerId?: string;
  shortUrl?: string;
  providerStatus?: string;
  requestDigest: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface AgentEvidence {
  name: string;
  status: "completed" | "failed";
  summary: string;
  callId?: string;
}

export interface AgentTurnResult {
  mode: "deterministic" | "hybrid_agent" | "gemini_agent" | "gemini_cache";
  model: string;
  inputDigest: string;
  promptVersion: string;
  catalogVersion: string;
  profilePatch: Partial<PreferenceProfile>;
  confirmedKeys: string[];
  toolEvents: AgentEvidence[];
  responseId?: string;
  semanticValidation: "passed" | "cache_validated";
  extractionSource: "deterministic" | "hybrid" | "gemini" | "cache";
  durationMs: number;
}

export interface CommerceAuditEvent {
  id: string;
  schemaVersion: 1;
  sessionVersion: number;
  sequence: number;
  kind: "session" | "shopper" | "agent" | "catalog" | "policy" | "cart" | "inventory" | "razorpay" | "webhook" | "guardrail";
  title: string;
  detail: string;
  actor: "shopper" | "agent" | "buyer_agent" | "system" | "merchant" | "razorpay";
  status: "info" | "success" | "warning" | "blocked";
  evidence?: Record<string, unknown>;
  previousHash: string;
  hash: string;
  createdAt: string;
}

export interface AuditIntegrity {
  verified: boolean;
  source: "supabase_ledger" | "local_ledger" | "memory_ledger";
  eventCount: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  headHash: string | null;
  issue?: string;
}

export interface CommerceAuditTrail {
  events: CommerceAuditEvent[];
  integrity: AuditIntegrity;
}

export interface CommandReceipt {
  idempotencyKey: string;
  command: ShoppingCommand | "send_message";
  version: number;
  completedAt: string;
}

export interface ShoppingSessionSnapshot {
  id: string;
  merchantId: string;
  origin: "shopper_ui" | "external_agent";
  buyerRunId?: string;
  phase: ShoppingPhase;
  version: number;
  profile: PreferenceProfile;
  activeQuestionKey: string | null;
  messages: ChatMessage[];
  recommendations: Recommendation[];
  selectedProductId: string | null;
  selectedVariantId: string | null;
  offeredAddonIds: string[];
  cart: Cart | null;
  quote: Quote | null;
  checkout: CheckoutAction | null;
  audit: CommerceAuditEvent[];
  commandReceipts: CommandReceipt[];
  processedWebhookIds: string[];
  catalogVersion: string;
  integration: {
    gemini: boolean;
    razorpay: boolean;
    webhookSecret: boolean;
    persistence: "supabase" | "local_file";
  };
  createdAt: string;
  updatedAt: string;
}

export type BuyerRunStatus = "planning" | "awaiting_approval" | "approved" | "checkout_ready" | "paid" | "blocked" | "failed";

export interface BuyerTraceEvent {
  id: string;
  tool: "discover_capabilities" | "read_catalog" | "create_quote" | "request_approval" | "create_checkout" | "read_order";
  status: "completed" | "blocked" | "failed";
  summary: string;
  createdAt: string;
}

export interface BuyerProposal {
  summary: string;
  reason: string;
  tradeoff: string;
  items: Array<{ productId: string; variantId: string; name: string; kind: "primary" | "addon"; unitPricePaise: number }>;
  totalPaise: number;
}

export interface BuyerRun {
  id: string;
  goal: string;
  status: BuyerRunStatus;
  proposal: BuyerProposal | null;
  quote: Quote | null;
  trace: BuyerTraceEvent[];
  sessionId: string | null;
  checkout: Pick<CheckoutAction, "status" | "providerId" | "shortUrl" | "referenceId" | "amountPaise" | "cartDigest" | "quoteDigest" | "failureReason"> | null;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderReceipt {
  sessionId: string;
  status: ShoppingPhase;
  amountPaise: number | null;
  referenceId: string | null;
  providerId: string | null;
  origin: ShoppingSessionSnapshot["origin"];
  buyerRunId: string | null;
  updatedAt: string;
}

export interface GrowthBenchmarkMetrics {
  completedPurchases: number;
  simulatedGmvPaise: number;
  averageOrderValuePaise: number;
  relevantAddonAttachRate: number;
  hardConstraintViolations: number;
  invalidCheckoutAttempts: number;
}

export interface GrowthBenchmarkReport {
  label: "Synthetic benchmark — not production conversion evidence";
  methodologyVersion: string;
  fixtureDigest: string;
  generatedAt: string;
  datasetSize: number;
  baseline: GrowthBenchmarkMetrics;
  choosy: GrowthBenchmarkMetrics;
  deltas: { completedPurchases: number; simulatedGmvPercent: number; averageOrderValuePercent: number; relevantAddonAttachPercentagePoints: number };
  gates: { atLeastTenPercentGmvUplift: boolean; noPurchaseRegression: boolean; zeroChoosyConstraintViolations: boolean; passed: boolean };
}

export type ShoppingCommand = "select_product" | "set_addons" | "confirm_cart" | "create_checkout" | "retry_payment" | "reset_session" | "revise_preference";

export interface ShoppingCommandRequest {
  command: ShoppingCommand;
  expectedVersion: number;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}

export interface OperatorIdentity {
  actorId: string;
  role: "operator";
  merchantId: string;
}

export interface MerchantDashboard {
  sessions: ShoppingSessionSnapshot[];
  metrics: {
    totalSessions: number;
    recommendationRate: number;
    cartRate: number;
    checkoutRate: number;
    paidTestModePaise: number;
    addonAttachRate: number;
  };
  auditChainsValid: boolean;
  auditIntegrity: Record<string, AuditIntegrity>;
  integration: ShoppingSessionSnapshot["integration"];
}
