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
  mode: "gemini_agent" | "gemini_cache";
  model: string;
  inputDigest: string;
  promptVersion: string;
  catalogVersion: string;
  profilePatch: Partial<PreferenceProfile>;
  confirmedKeys: string[];
  toolEvents: AgentEvidence[];
  responseId?: string;
  semanticValidation: "passed" | "cache_validated";
}

export interface CommerceAuditEvent {
  id: string;
  sequence: number;
  kind: "session" | "shopper" | "agent" | "catalog" | "policy" | "cart" | "inventory" | "razorpay" | "webhook" | "guardrail";
  title: string;
  detail: string;
  actor: "shopper" | "agent" | "system" | "merchant" | "razorpay";
  status: "info" | "success" | "warning" | "blocked";
  evidence?: Record<string, unknown>;
  previousHash: string;
  hash: string;
  createdAt: string;
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
  integration: ShoppingSessionSnapshot["integration"];
}
