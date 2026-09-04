import { createHash, randomUUID } from "node:crypto";
import { CATALOG_MARKET, CATALOG_PRICE_AS_OF, CATALOG_PRICE_NOTICE, CATALOG_VERSION, categoryProfile, productById, variantById } from "@/lib/catalog";
import { createCommerceAuditEvent } from "@/lib/commerce-audit";
import { allQuestions, buildCart, cartDigest, createQuote, GROWTH_POLICY, isProfileComplete, nextQuestion, QUOTE_TTL_MS, quoteDigest, rankProducts, recommendedAddons, resolveCoveredQuestions, validateCart } from "@/lib/commerce-policy";
import { createShoppingSession, DEFAULT_MERCHANT_ID, publicShoppingSession } from "@/lib/commerce-data";
import { checkoutIntent, createOrReconcileCheckout, fetchPaymentLink } from "@/lib/razorpay";
import { createAndStoreSession, getCommerceRepository, RepositoryConflictError } from "@/lib/repository";
import { applyStructuredAnswer, classifyShoppingMessage, discoveryInputDigest, mergeAgentPatch, ShoppingAgentUnavailableError, understandShoppingMessage, type ShoppingMessageBoundary } from "@/lib/shopping-agent";
import type { Cart, CartItem, ChatMessage, CommerceAuditEvent, MerchantDashboard, OperatorIdentity, OrderReceipt, Product, Quote, ShoppingCommandRequest, ShoppingPhase, ShoppingSessionSnapshot } from "@/lib/types";

export class CommerceServiceError extends Error { constructor(message: string, public status = 409) { super(message); } }
type EventInput = Omit<CommerceAuditEvent, "id" | "schemaVersion" | "sessionVersion" | "sequence" | "createdAt" | "previousHash" | "hash">;

function appendEvents(session: ShoppingSessionSnapshot, inputs: EventInput[]): CommerceAuditEvent[] { const events: CommerceAuditEvent[] = []; for (const input of inputs) { const event = createCommerceAuditEvent(session, input); session.audit.push(event); events.push(event); } return events; }
async function persist(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, phase: ShoppingPhase, inputs: EventInput[]): Promise<ShoppingSessionSnapshot> { next.phase = phase; next.version = current.version + 1; next.updatedAt = new Date().toISOString(); const events = appendEvents(next, inputs); return getCommerceRepository().replace(current, next, events); }
function message(role: ChatMessage["role"], text: string): ChatMessage { return { id: randomUUID(), role, text, createdAt: new Date().toISOString() }; }
function requireVersion(session: ShoppingSessionSnapshot, version: number): void { if (session.version !== version) throw new CommerceServiceError("The conversation changed. Refresh and try again.", 409); }
function structuredPreferenceChanges(before: ShoppingSessionSnapshot["profile"], after: ShoppingSessionSnapshot["profile"]): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves"] as const) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = after[key];
  for (const [key, value] of Object.entries(after.answers)) if (before.answers[key] !== value) changes[key] = value;
  return changes;
}
function clarificationForQuestion(key: string, choices: string[], previousAssistantText?: string): string {
  const prompts: Record<string, string> = {
    category: "I can help with phones, headphones, or running shoes—which should I focus on?",
    maxBudgetPaise: "Give me a maximum amount in rupees so every option stays within your limit.",
    useCase: "Choose the main situation: everyday, work, travel, fitness, gaming, or photography.",
    brandPreference: "Name a favourite brand, or choose “No preference” to keep the search open.",
    mustHaves: "Name any non-negotiable feature, or choose “No deal-breakers.”",
  };
  const clarification = prompts[key] ?? `To narrow this down, choose one: ${choices.join(", ")}.`;
  if (previousAssistantText !== clarification) return clarification;
  const labels: Record<string, string> = { category: "the product category", maxBudgetPaise: "your maximum budget", useCase: "the main use", brandPreference: "your brand preference", mustHaves: "any non-negotiable feature" };
  return `I saved the other detail. I still need ${labels[key] ?? "this preference"}; use one of the choices below.`;
}
function activeQuestionPrompt(session: ShoppingSessionSnapshot): string {
  return allQuestions(session.profile).find((question) => question.key === session.activeQuestionKey)?.prompt ?? "What would you like to choose?";
}
function boundaryResponse(boundary: Exclude<ShoppingMessageBoundary, { kind: "continue" }>, session: ShoppingSessionSnapshot, previousAssistantText?: string): string {
  const supported = "phones, headphones, or running shoes";
  const repeated = previousAssistantText?.includes("phones, headphones, or running shoes") ?? false;
  const currentCategory = session.profile.category === "running-shoes" ? "running shoes" : session.profile.category;
  if (boundary.kind === "sensitive_data") {
    const lead = previousAssistantText?.startsWith("Please don’t share") ? "I still can’t accept personal or payment details here." : "Please don’t share card numbers, contact details, addresses, passwords, OTPs, or other payment information here.";
    return `${lead} I removed that message from the conversation. ${activeQuestionPrompt(session)}`;
  }
  if (boundary.kind === "multiple_categories") {
    return repeated
      ? `Let’s take one category at a time. Choose ${supported} to begin.`
      : `I can compare one category at a time. Would you like to start with ${supported}?`;
  }
  if (boundary.kind === "unsupported_category") {
    if (session.profile.category && session.activeQuestionKey !== "category") {
      return previousAssistantText?.startsWith("I can’t search for")
        ? `I’m still limited to phones, headphones, and running shoes. Let’s finish choosing your ${currentCategory}: ${activeQuestionPrompt(session)}`
        : `I can’t search for ${boundary.requestedProduct ?? "that product"} yet. I can keep helping with ${currentCategory}. ${activeQuestionPrompt(session)}`;
    }
    return repeated
      ? `Those are still the three categories I can search today: ${supported}. Choose one below.`
      : `I can only help with ${supported} right now. Choose one below and I’ll narrow down the best options.`;
  }
  if (boundary.kind === "greeting") return repeated ? `Hi again! Pick ${supported} and we’ll get started.` : `Hi! I can help you compare ${supported}. What are you shopping for?`;
  return repeated
    ? `I’m focused on shopping for ${supported}. Choose one below to continue.`
    : `I can’t help with that topic, but I can help you choose ${supported}. Which one should we look at?`;
}
function unclearResponse(session: ShoppingSessionSnapshot, previousAssistantText?: string): string {
  if (session.activeQuestionKey === "category") return boundaryResponse({ kind: "unsupported_category" }, session, previousAssistantText);
  const prompt = activeQuestionPrompt(session);
  return previousAssistantText?.includes(prompt)
    ? "I still couldn’t connect that answer to the current question. Choose one of the options below."
    : `I couldn’t connect that answer to what I need next. ${prompt}`;
}

export async function startShoppingSession(): Promise<ShoppingSessionSnapshot> { return publicShoppingSession(await createAndStoreSession()); }
export async function getShoppingSession(sessionId: string): Promise<ShoppingSessionSnapshot> { return publicShoppingSession(await getCommerceRepository().get(sessionId)); }

export async function reconcileShoppingPayment(sessionId: string): Promise<ShoppingSessionSnapshot> {
  const repository = getCommerceRepository();
  const current = await repository.get(sessionId);
  if (current.phase === "paid") return publicShoppingSession(current);
  const checkout = current.checkout;
  if (!checkout?.providerId || (current.phase !== "checkout_ready" && current.phase !== "payment_failed")) return publicShoppingSession(current);

  const provider = await fetchPaymentLink(checkout.providerId);
  const matchesCheckout = provider.id === checkout.providerId && provider.reference_id === checkout.referenceId && provider.amount === checkout.amountPaise;
  if (!matchesCheckout) throw new CommerceServiceError("Razorpay returned payment details that do not match this order.", 409);
  if (provider.status !== "paid") return publicShoppingSession(current);

  const next = structuredClone(current);
  next.checkout = { ...checkout, status: "paid", providerStatus: "paid", updatedAt: new Date().toISOString() };
  next.messages.push(message("assistant", "Payment confirmed — your order is placed! 🎉"));
  try {
    await repository.saveCheckout(next.checkout);
    return publicShoppingSession(await persist(current, next, "paid", [{
      kind: "razorpay",
      title: "Payment confirmed on checkout return",
      detail: `Razorpay verified the exact ₹${Math.round(checkout.amountPaise / 100).toLocaleString("en-IN")} order after the shopper returned from payment.`,
      actor: "razorpay",
      status: "success",
      evidence: { providerId: checkout.providerId, referenceId: checkout.referenceId, amountPaise: checkout.amountPaise, providerStatus: provider.status },
    }]));
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      const latest = await repository.get(sessionId);
      if (latest.phase === "paid") return publicShoppingSession(latest);
    }
    throw error;
  }
}

export async function sendShoppingMessage(sessionId: string, input: { text: string; expectedVersion: number; idempotencyKey: string; answerKey?: string; answerValue?: string }): Promise<ShoppingSessionSnapshot> {
  const repository = getCommerceRepository(); const current = await repository.get(sessionId);
  if (current.commandReceipts.some((item) => item.idempotencyKey === input.idempotencyKey)) return publicShoppingSession(current);
  requireVersion(current, input.expectedVersion);
  if (current.phase !== "discovering" && current.phase !== "agent_failure") throw new CommerceServiceError("Edit your criteria by starting a new search.");
  const next = structuredClone(current); next.commandReceipts.push({ idempotencyKey: input.idempotencyKey, command: "send_message", version: current.version + 1, completedAt: new Date().toISOString() });
  const boundary = input.answerKey ? { kind: "continue" as const } : classifyShoppingMessage(current.profile, input.text, current.activeQuestionKey);
  next.messages.push(message("user", boundary.kind === "sensitive_data" ? "[Sensitive information removed]" : input.text));
  let profile = current.profile; let answerSource: "quick_choice" | "interpreted_answer" = "interpreted_answer"; const events: EventInput[] = [{ kind: "shopper", title: "Shopper message received", detail: "The message was handled without storing its raw text in the audit ledger.", actor: "shopper", status: "info", evidence: { activeQuestionKey: current.activeQuestionKey } }];
  if (boundary.kind !== "continue") {
    const previousAssistantText = [...current.messages].reverse().find((item) => item.role === "assistant")?.text;
    next.messages.push(message("assistant", boundaryResponse(boundary, current, previousAssistantText)));
    next.activeQuestionKey = current.activeQuestionKey;
    events.push({ kind: "guardrail", title: boundary.kind === "sensitive_data" ? "Sensitive information removed" : boundary.kind === "unsupported_category" ? "Unsupported product explained" : boundary.kind === "multiple_categories" ? "One category requested" : boundary.kind === "greeting" ? "Greeting answered" : "Conversation kept on topic", detail: "Choosy responded with its current shopping scope and kept the active question unchanged.", actor: "system", status: boundary.kind === "sensitive_data" ? "blocked" : "info", evidence: { responseType: boundary.kind, supportedCategories: ["phones", "headphones", "running-shoes"], ...(boundary.kind === "unsupported_category" && boundary.requestedProduct ? { requestedProduct: boundary.requestedProduct } : {}) } });
    return publicShoppingSession(await persist(current, next, "discovering", events));
  }
  if (input.answerKey && input.answerValue) {
    answerSource = "quick_choice";
    if (input.answerKey !== current.activeQuestionKey) throw new CommerceServiceError("That answer no longer matches the active question.", 409);
    const controlledQuestion=allQuestions(current.profile).find((item)=>item.key===input.answerKey);
    if(!controlledQuestion?.choices.includes(input.answerValue)) throw new CommerceServiceError("That quick choice is not valid for the active question.",422);
    profile = applyStructuredAnswer(current.profile, input.answerKey, input.answerValue);
    events.push({ kind: "agent", title: "Structured preference accepted", detail: `${input.answerKey} was mapped from a controlled shopper choice.`, actor: "system", status: "success" });
  } else {
    try {
      const digest = discoveryInputDigest(current.profile, input.text, current.activeQuestionKey);
      const cached = await repository.findAgentCache(digest);
      const result = await understandShoppingMessage({ profile: current.profile, message: input.text, activeQuestionKey: current.activeQuestionKey, cached });
      profile = mergeAgentPatch(current.profile, result); await repository.saveAgentRun(sessionId, result);
      events.push(...result.toolEvents.map((tool): EventInput => ({ kind: "agent", title: tool.name, detail: tool.summary, actor: "agent", status: tool.status === "completed" ? "success" : "blocked", evidence: { mode: result.mode, extractionSource: result.extractionSource, durationMs: result.durationMs, inputDigest: result.inputDigest } })));
    } catch (error) {
      if (!(error instanceof ShoppingAgentUnavailableError)) throw error;
      const previousAssistantText = [...current.messages].reverse().find((item) => item.role === "assistant")?.text;
      next.messages.push(message("assistant", unclearResponse(current, previousAssistantText))); next.activeQuestionKey = current.activeQuestionKey;
      return publicShoppingSession(await persist(current, next, "agent_failure", [...events, { kind: "guardrail", title: "Understanding stopped safely", detail: error.message, actor: "system", status: "blocked" }]));
    }
  }
  const explicitlyConfirmedKeys = new Set(profile.confirmedKeys);
  profile = resolveCoveredQuestions(profile);
  const coveredKeys = profile.confirmedKeys.filter((key) => !explicitlyConfirmedKeys.has(key));
  if (coveredKeys.length) events.push({ kind: "policy", title: "Redundant follow-ups skipped", detail: `${coveredKeys.join(", ")} was already answered by an equivalent confirmed preference.`, actor: "system", status: "success", evidence: { coveredKeys } });
  const preferenceChanges = structuredPreferenceChanges(current.profile, profile);
  if (Object.keys(preferenceChanges).length) events.push({ kind: "policy", title: "Shopping preferences updated", detail: "The structured preferences used for matching were updated.", actor: "system", status: "success", evidence: { source: answerSource, changes: preferenceChanges } });
  next.profile = profile;
  const pending = nextQuestion(profile);
  if (!pending && isProfileComplete(profile)) {
    const catalog = await repository.getCatalog(); const { recommendations, brandFallback } = rankProducts(profile, catalog);
    if (!recommendations.length) {
      next.profile.confirmedKeys = next.profile.confirmedKeys.filter((key) => key !== "maxBudgetPaise"); next.activeQuestionKey = "maxBudgetPaise";
      next.messages.push(message("assistant", "I couldn’t find a current match for everything you asked for. Would you like to try a different budget?"));
      events.push({ kind: "guardrail", title: "No compliant product found", detail: "Choosy refused to invent or stretch beyond the confirmed criteria.", actor: "system", status: "blocked" });
      return publicShoppingSession(await persist(current, next, "discovering", events));
    }
    next.recommendations = recommendations; next.activeQuestionKey = null;
    const brandNotice = brandFallback ? `I couldn’t find any ${profile.brandPreference} products that match your criteria, so here are the best alternatives from other brands. ` : "";
    const topRecommendation = recommendations[0]!;
    const topProduct = catalog.find((item) => item.id === topRecommendation.productId)!;
    const topVariant = topProduct.variants.find((item) => item.id === topRecommendation.variantId)!;
    const topReasons = topRecommendation.matchedNeeds.slice(0, 2).join(" and ").toLowerCase();
    next.messages.push(message("assistant", `${brandNotice}I found ${recommendations.length} available ${recommendations.length === 1 ? "match" : "matches"} within your budget. My top pick is ${topProduct.name} at ₹${Math.round(topVariant.pricePaise / 100).toLocaleString("en-IN")} because it fits ${topReasons}. I also included a value pick and a strong alternative so you can compare.`));
    events.push({ kind: "policy", title: "Enough preferences collected", detail: "Every required preference was answered directly or covered by an equivalent confirmed preference.", actor: "system", status: "success", evidence: { confirmedKeys: profile.confirmedKeys } }, { kind: "catalog", title: "Product matches created", detail: `${recommendations.length} available products met the shopper’s budget, preferences, and deal-breakers.`, actor: "system", status: "success", evidence: { productIds: recommendations.map((item) => item.productId), catalogVersion: CATALOG_VERSION, ...(brandFallback ? { brandFallback: true, requestedBrand: profile.brandPreference } : {}) } });
    return publicShoppingSession(await persist(current, next, "recommendations_ready", events));
  }
  next.activeQuestionKey = pending?.key ?? current.activeQuestionKey;
  if (pending) {
    const previousAssistantText = [...current.messages].reverse().find((item) => item.role === "assistant")?.text;
    next.messages.push(message("assistant", pending.key === current.activeQuestionKey ? clarificationForQuestion(pending.key, pending.choices, previousAssistantText) : pending.prompt));
  }
  events.push({ kind: "policy", title: "Waiting for more information", detail: `Choosy needs ${pending?.key ?? "more context"} before looking for products.`, actor: "system", status: "success", evidence: { nextQuestionKey: pending?.key } });
  return publicShoppingSession(await persist(current, next, "discovering", events));
}

export async function executeShoppingCommand(sessionId: string, input: ShoppingCommandRequest, options: { paymentReturnUrl?: string } = {}): Promise<ShoppingSessionSnapshot> {
  const repository = getCommerceRepository(); const current = await repository.get(sessionId);
  if (current.commandReceipts.some((item) => item.idempotencyKey === input.idempotencyKey)) return publicShoppingSession(current);
  requireVersion(current, input.expectedVersion);
  const next = structuredClone(current); next.commandReceipts.push({ idempotencyKey: input.idempotencyKey, command: input.command, version: current.version + 1, completedAt: new Date().toISOString() }); const catalog = await repository.getCatalog(); const events: EventInput[] = [];
  if (input.command === "reset_session") {
    const fresh = createShoppingSession(new Date(), current.id); fresh.version = current.version; fresh.createdAt = current.createdAt; fresh.audit = [...current.audit]; fresh.commandReceipts = next.commandReceipts; fresh.processedWebhookIds = current.processedWebhookIds;
    return publicShoppingSession(await persist(current, fresh, "discovering", [{ kind: "session", title: "New search started", detail: "The product criteria were reset while the session's append-only decision trail was preserved.", actor: "shopper", status: "success" }]));
  }
  if (input.command === "revise_preference") {
    const key = String(input.payload?.key ?? ""); const question = allQuestions(current.profile).find((item) => item.key === key);
    if (!question || !current.profile.confirmedKeys.includes(key)) throw new CommerceServiceError("Only a completed preference can be revised.", 422);
    next.profile.confirmedKeys = next.profile.confirmedKeys.filter((item) => item !== key);
    if (key === "category") { next.profile.category = null; next.profile.answers = {}; next.profile.confirmedKeys = next.profile.confirmedKeys.filter((item) => ["maxBudgetPaise", "useCase", "brandPreference", "mustHaves"].includes(item)); }
    else if (key === "maxBudgetPaise") next.profile.maxBudgetPaise = null;
    else if (key === "useCase") next.profile.useCase = null;
    else if (key === "brandPreference") next.profile.brandPreference = null;
    else if (key === "mustHaves") next.profile.mustHaves = [];
    else delete next.profile.answers[key];
    next.activeQuestionKey = key; next.recommendations = []; next.selectedProductId = null; next.selectedVariantId = null; next.offeredAddonIds = []; next.cart = null; next.quote = null; next.checkout = null;
    next.messages.push(message("assistant", `Let’s revise that. ${question.prompt}`));
    events.push({ kind: "policy", title: "Preference reopened", detail: `${key} must be explicitly answered again before recommendations can return.`, actor: "shopper", status: "success", evidence: { key } });
    return publicShoppingSession(await persist(current, next, "discovering", events));
  }
  if (input.command === "select_product") {
    if (current.phase !== "recommendations_ready" && current.phase !== "needs_reselection") throw new CommerceServiceError("A product can only be selected from the current shortlist.");
    const productId = String(input.payload?.productId ?? ""); const recommendation = current.recommendations.find((item) => item.productId === productId); if (!recommendation) throw new CommerceServiceError("That product is not in the current shortlist.");
    const product = productById(productId, catalog); const selectedVariant = product && variantById(product, recommendation.variantId); if (!product || !selectedVariant || selectedVariant.stock < 1) throw new CommerceServiceError("That item is no longer available.");
    next.selectedProductId = product.id; next.selectedVariantId = selectedVariant.id; next.offeredAddonIds = recommendedAddons(next.profile, product, catalog).map((item) => item.id); next.cart = buildCart(product, selectedVariant, []); next.quote = null; next.checkout = null;
    next.messages.push(message("assistant", next.offeredAddonIds.length ? "Good choice. These optional extras still fit your budget, or you can skip them." : "Good choice. I’ll keep the cart to this item."));
    events.push({ kind: "cart", title: "Primary product selected", detail: `${product.name} was selected from the deterministic shortlist.`, actor: "shopper", status: "success", evidence: { productId, variantId: selectedVariant.id } });
    return publicShoppingSession(await persist(current, next, "item_selected", events));
  }
  if (input.command === "set_addons") {
    if (current.phase !== "item_selected") throw new CommerceServiceError("Choose a primary product first.");
    const addonIds = Array.isArray(input.payload?.addonIds) ? input.payload.addonIds.map(String) : []; if (addonIds.length > 2 || addonIds.some((id) => !current.offeredAddonIds.includes(id))) throw new CommerceServiceError("Only offered add-ons may be selected.");
    const product = current.selectedProductId ? productById(current.selectedProductId, catalog) : undefined; const selectedVariant = product && current.selectedVariantId ? variantById(product, current.selectedVariantId) : undefined; if (!product || !selectedVariant) throw new CommerceServiceError("The selected product is unavailable.");
    const addons = addonIds.map((id) => productById(id, catalog)).filter((item): item is Product => Boolean(item)); const cart = buildCart(product, selectedVariant, addons); if (next.profile.maxBudgetPaise && cart.totalPaise > next.profile.maxBudgetPaise) throw new CommerceServiceError("That bundle exceeds the confirmed budget.");
    next.cart = cart; next.messages.push(message("assistant", `Your cart comes to ₹${Math.round(cart.totalPaise / 100).toLocaleString("en-IN")}. Please review it before continuing.`));
    events.push({ kind: "cart", title: addonIds.length ? "Cart updated" : "Extras skipped", detail: addonIds.length ? `${addonIds.length} relevant extra${addonIds.length === 1 ? "" : "s"} kept the cart within budget.` : "The shopper kept only the main product.", actor: "shopper", status: "success", evidence: { addonIds, cartDigest: cart.digest, totalPaise: cart.totalPaise } });
    return publicShoppingSession(await persist(current, next, "cart_review", events));
  }
  if (input.command === "confirm_cart") {
    if ((current.phase !== "cart_review" && current.phase !== "needs_reselection") || !current.cart) throw new CommerceServiceError("There is no cart ready to confirm.");
    const validation = validateCart(current.cart, catalog);
    if (!validation.valid) {
      next.recommendations = rankProducts(next.profile, catalog).recommendations; next.selectedProductId = null; next.selectedVariantId = null; next.offeredAddonIds = []; next.cart = null; next.quote = null; next.checkout = null;
      next.messages.push(message("assistant", "That item just went out of stock, so I stopped checkout and refreshed your matches. Nothing was charged or substituted."));
      events.push({ kind: "inventory", title: "Unavailable item blocked at checkout", detail: "Fresh inventory did not match the confirmed cart, so no Razorpay intent was created.", actor: "system", status: "blocked", evidence: validation });
      return publicShoppingSession(await persist(current, next, "needs_reselection", events));
    }
    next.cart = { ...current.cart, confirmedAt: new Date().toISOString() }; next.quote = createQuote(next.cart); next.messages.push(message("assistant", "Price and stock are up to date. Your cart is ready for checkout when you are."));
    events.push({ kind: "inventory", title: "Price and stock checked", detail: "Every item and price still matched the reviewed cart.", actor: "system", status: "success", evidence: { cartDigest: next.cart.digest, totalPaise: next.cart.totalPaise } }, { kind: "policy", title: "Cart approved", detail: "The shopper confirmed the exact items and test amount.", actor: "shopper", status: "success", evidence: { quoteDigest: next.quote.digest } });
    return publicShoppingSession(await persist(current, next, "cart_review", events));
  }
  if (input.command === "create_checkout" || input.command === "retry_payment") {
    if (!current.cart?.confirmedAt || !current.quote) throw new CommerceServiceError("Confirm the current cart before checkout.");
    if (new Date(current.quote.expiresAt).getTime() <= Date.now()) throw new CommerceServiceError("The quote expired. Confirm the cart again.");
    const validation = validateCart(current.cart, catalog); if (!validation.valid) { next.recommendations = rankProducts(next.profile, catalog).recommendations; next.selectedProductId = null; next.selectedVariantId = null; next.cart = null; next.quote = null; next.checkout = null; next.messages.push(message("assistant", "Something changed before checkout, so I stopped and refreshed your matches. Nothing was charged.")); return publicShoppingSession(await persist(current, next, "needs_reselection", [{ kind: "inventory", title: "Checkout stopped before provider call", detail: "The cart failed final stock or price validation. No Razorpay action was created.", actor: "system", status: "blocked", evidence: validation }])); }
    const action = checkoutIntent(current.id, current.quote, input.idempotencyKey); await repository.saveCheckout(action);
    let external; try { external = await createOrReconcileCheckout(action, options.paymentReturnUrl); } catch (error) { external = { ...action, status: "failed" as const, failureReason: error instanceof Error ? error.message : "Razorpay checkout failed.", updatedAt: new Date().toISOString() }; }
    await repository.saveCheckout(external); next.checkout = external;
    if (external.status === "created" || external.status === "paid") {
      next.messages.push(message("assistant", external.status === "paid" ? "Razorpay has already confirmed this test payment." : "Your Razorpay checkout is ready."));
      events.push({ kind: "razorpay", title: external.status === "paid" ? "Existing payment reconciled" : "Razorpay checkout created", detail: "The provider action matches the confirmed cart digest, quote, reference and amount.", actor: "razorpay", status: "success", evidence: { providerId: external.providerId, referenceId: external.referenceId, amountPaise: external.amountPaise } });
      return publicShoppingSession(await persist(current, next, external.status === "paid" ? "paid" : "checkout_ready", events));
    }
    next.messages.push(message("assistant", external.failureReason ?? "Checkout is unavailable. Nothing was charged."));
    events.push({ kind: "guardrail", title: "Checkout unavailable", detail: external.failureReason ?? "No provider URL was returned.", actor: "system", status: "blocked" });
    return publicShoppingSession(await persist(current, next, "payment_failed", events));
  }
  throw new CommerceServiceError("Unsupported shopping command.", 422);
}

export async function merchantDashboard(operator: OperatorIdentity): Promise<MerchantDashboard> {
  if (operator.merchantId !== DEFAULT_MERCHANT_ID) throw new CommerceServiceError("Merchant access denied.", 403); const repository = getCommerceRepository(); const storedSessions = await repository.list(); const trails = await Promise.all(storedSessions.map((session) => repository.getAuditTrail(session.id))); for (const [index, session] of storedSessions.entries()) { const latestVersion = trails[index]!.events.at(-1)?.sessionVersion; if (typeof latestVersion === "number" && latestVersion !== session.version) trails[index]!.integrity = { ...trails[index]!.integrity, verified: false, issue: "The ledger does not match the latest session version." }; } const sessions = storedSessions.map((session, index) => ({ ...session, audit: trails[index]!.events })); const auditIntegrity = Object.fromEntries(sessions.map((session, index) => [session.id, trails[index]!.integrity])); const total = sessions.length || 1;
  const recommended = sessions.filter((item) => item.recommendations.length > 0).length; const carts = sessions.filter((item) => item.cart).length; const checkouts = sessions.filter((item) => item.checkout).length; const paid = sessions.filter((item) => item.phase === "paid"); const attached = sessions.filter((item) => item.cart?.items.some((entry) => entry.kind === "addon")).length;
  return { sessions, metrics: { totalSessions: sessions.length, recommendationRate: recommended / total, cartRate: carts / total, checkoutRate: checkouts / total, paidTestModePaise: paid.reduce((sum, item) => sum + (item.checkout?.amountPaise ?? 0), 0), addonAttachRate: attached / total }, auditChainsValid: trails.every((trail) => trail.integrity.verified), auditIntegrity, integration: sessions[0]?.integration ?? createShoppingSession().integration };
}

export async function markSelectedItemUnavailable(sessionId: string, operator: OperatorIdentity): Promise<ShoppingSessionSnapshot> {
  if (operator.merchantId !== DEFAULT_MERCHANT_ID) throw new CommerceServiceError("Merchant access denied.", 403); const repository = getCommerceRepository(); const current = await repository.get(sessionId); if (!current.selectedVariantId) throw new CommerceServiceError("This session has no selected variant."); await repository.setVariantStock(current.selectedVariantId, 0); const catalog = await repository.getCatalog(); const selectedName = catalog.find((item) => item.id === current.selectedProductId)?.name ?? "Selected item";
  return publicShoppingSession(await persist(current, structuredClone(current), current.phase, [{ kind: "inventory", title: "Demo inventory change applied", detail: `${selectedName} was marked unavailable by the merchant demo control. Checkout must revalidate before any money action.`, actor: "merchant", status: "warning", evidence: { variantId: current.selectedVariantId, demoControl: true } }]));
}

export async function restoreDemoInventory(sessionId: string, operator: OperatorIdentity): Promise<ShoppingSessionSnapshot> {
  if (operator.merchantId !== DEFAULT_MERCHANT_ID) throw new CommerceServiceError("Merchant access denied.", 403); const repository = getCommerceRepository(); const current = await repository.get(sessionId); await repository.restoreDemoInventory();
  return publicShoppingSession(await persist(current, structuredClone(current), current.phase, [{ kind: "inventory", title: "Demo inventory restored", detail: "Simulated stock for the curated real-product catalog was restored to its seeded Test Mode quantities for another rehearsal.", actor: "merchant", status: "success", evidence: { demoControl: true } }]));
}

function payloadEntity(payload: Record<string, unknown>, name: "payment_link" | "payment"): Record<string, unknown> | undefined { return ((payload.payload as Record<string, unknown> | undefined)?.[name] as { entity?: Record<string, unknown> } | undefined)?.entity; }
function notes(entity: Record<string, unknown> | undefined): Record<string, unknown> { return entity?.notes && typeof entity.notes === "object" ? entity.notes as Record<string, unknown> : {}; }
export function resolveWebhookSessionId(payload: Record<string, unknown>): string | null { const link = payloadEntity(payload, "payment_link"); const payment = payloadEntity(payload, "payment"); const value = [notes(link).choosy_session_id, notes(payment).choosy_session_id].find((item) => typeof item === "string"); return typeof value === "string" && /^shop_[a-f0-9]{24}$/.test(value) ? value : null; }

export async function processRazorpayWebhook(input: { eventId: string; eventType: string; rawBody: string; payload: Record<string, unknown>; sessionId: string }): Promise<{ duplicate: boolean; ignored: boolean; state: ShoppingSessionSnapshot }> {
  const repository = getCommerceRepository(); const current = await repository.get(input.sessionId); const next = structuredClone(current); const digest = createHash("sha256").update(input.rawBody).digest("hex"); const link = payloadEntity(input.payload, "payment_link"); const payment = payloadEntity(input.payload, "payment"); const checkout = current.checkout;
  const remoteId = String(link?.id ?? payment?.payment_link_id ?? ""); const reference = String(link?.reference_id ?? notes(link).choosy_reference_id ?? notes(payment).choosy_reference_id ?? ""); const cartDigest = String(notes(link).choosy_cart_digest ?? notes(payment).choosy_cart_digest ?? ""); const exact = Boolean(checkout?.providerId && remoteId === checkout.providerId && reference === checkout.referenceId && cartDigest === checkout.cartDigest); const paid = input.eventType === "payment_link.paid" || input.eventType === "payment.captured"; let ignored = true; let eventInput: EventInput;
  if (paid && checkout && exact) {
    const amount = Number(payment?.amount ?? link?.amount); if (Number.isFinite(amount) && amount === checkout.amountPaise) { ignored = false; next.phase = "paid"; next.checkout = { ...checkout, status: "paid", providerStatus: "paid", updatedAt: new Date().toISOString() }; eventInput = { kind: "webhook", title: "Test Mode payment verified", detail: `Razorpay confirmed the exact ₹${Math.round(amount / 100).toLocaleString("en-IN")} order.`, actor: "razorpay", status: "success", evidence: { eventId: input.eventId, payloadDigest: digest } }; } else eventInput = { kind: "guardrail", title: "Webhook amount mismatch blocked", detail: "The signed event amount did not match the approved cart.", actor: "system", status: "blocked", evidence: { expectedPaise: checkout.amountPaise, receivedPaise: amount } };
  } else if (input.eventType === "payment.failed" && checkout && exact && current.phase !== "paid") { ignored = false; next.phase = "payment_failed"; next.checkout = { ...checkout, status: "failed", providerStatus: "failed", updatedAt: new Date().toISOString() }; eventInput = { kind: "webhook", title: "Payment unsuccessful", detail: "The exact Test Mode attempt failed. The order remains unpaid and can be retried safely.", actor: "razorpay", status: "warning", evidence: { eventId: input.eventId } };
  } else eventInput = { kind: "webhook", title: "Webhook recorded without state change", detail: "The signed event did not match the tracked Choosy checkout or could not regress a paid order.", actor: "razorpay", status: "info", evidence: { eventId: input.eventId } };
  next.version = current.version + 1; next.updatedAt = new Date().toISOString(); next.processedWebhookIds.push(input.eventId); const auditEvent = createCommerceAuditEvent(next, eventInput); next.audit.push(auditEvent); const result = await repository.applyWebhook(current, next, input.eventId, input.eventType, digest, auditEvent); return { duplicate: result.duplicate, ignored: result.duplicate ? true : ignored, state: publicShoppingSession(result.session) };
}

export async function catalogSnapshot(): Promise<Product[]> { return getCommerceRepository().getCatalog(); }
export function commerceCapabilities() { return { name: "Choosy", version: "2026-09-v2", mode: "razorpay_test", currency: "INR", categories: ["phones", "headphones", "running-shoes"], catalogVersion: CATALOG_VERSION, catalog: { mode: "curated_snapshot", market: CATALOG_MARKET, priceAsOf: CATALOG_PRICE_AS_OF, priceNotice: CATALOG_PRICE_NOTICE, externalRetailApi: false, runtimeCatalogCost: "free" }, quoteTtlSeconds: QUOTE_TTL_MS / 1000, constraints: { ...GROWTH_POLICY, revalidatesPriceAndStock: true, personalInformationInChat: false }, authentication: { catalog: "public", quote: "public", checkout: "X-Commerce-Demo-Key", order: "X-Commerce-Demo-Key" }, confirmation: { field: "confirmation", requiredValue: true, binds: "acceptedQuoteDigest" }, endpoints: { catalog: { method: "GET", path: "/api/catalog" }, quote: { method: "POST", path: "/api/commerce/quotes" }, checkout: { method: "POST", path: "/api/commerce/checkouts" }, order: { method: "GET", path: "/api/commerce/orders/{sessionId}" } } }; }
export function questionForSession(session: ShoppingSessionSnapshot) { const question = nextQuestion(session.profile); return question ? { key: question.key, prompt: question.prompt, choices: question.choices } : null; }
export function categorySummary(session: ShoppingSessionSnapshot): string | null { return session.profile.category ? categoryProfile(session.profile.category).label : null; }

export async function createMachineQuote(requested: Array<{ productId: string; variantId: string }>): Promise<Quote> {
  if (requested.length < 1 || requested.length > 3) throw new CommerceServiceError("A quote needs one primary item and at most two add-ons.", 422);
  const catalog = await getCommerceRepository().getCatalog(); const items: CartItem[] = requested.map((requestedItem) => {
    const product = productById(requestedItem.productId, catalog); const variant = product && variantById(product, requestedItem.variantId);
    if (!product || !variant || variant.stock < 1) throw new CommerceServiceError("A requested catalog item is unavailable.", 409);
    return { productId: product.id, variantId: variant.id, quantity: 1, unitPricePaise: variant.pricePaise, kind: product.kind };
  });
  if (items.filter((item) => item.kind === "primary").length !== 1 || items.filter((item) => item.kind === "addon").length > 2) throw new CommerceServiceError("The cart shape is outside Choosy commerce policy.", 422);
  const cart: Cart = { id: `cart_${randomUUID().replaceAll("-", "").slice(0, 20)}`, items, totalPaise: items.reduce((sum, item) => sum + item.unitPricePaise, 0), digest: cartDigest(items) };
  return createQuote(cart);
}

export async function createMachineCheckout(quote: Quote, acceptedQuoteDigest: string, idempotencyKey: string, buyerRunId?: string, paymentReturnUrl?: string): Promise<{ sessionId: string; checkout: ShoppingSessionSnapshot["checkout"] }> {
  if (quote.digest !== acceptedQuoteDigest) throw new CommerceServiceError("The accepted quote digest does not match.", 422);
  if (quote.catalogVersion !== CATALOG_VERSION || quote.digest !== quoteDigest(quote.cart.digest, quote.catalogVersion, quote.expiresAt)) throw new CommerceServiceError("The quote integrity check failed.", 422);
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new CommerceServiceError("The accepted quote expired.", 409);
  const fresh = await createAndStoreSession(); const catalog = await getCommerceRepository().getCatalog(); const validation = validateCart(quote.cart, catalog);
  if (!validation.valid) {
    const blocked = structuredClone(fresh); blocked.origin = "external_agent"; blocked.buyerRunId = buyerRunId; blocked.cart = quote.cart; blocked.quote = quote;
    await persist(fresh, blocked, "needs_reselection", [{ kind: "inventory", title: "Checkout stopped", detail: "Stock or price changed after the cart was prepared. No Razorpay action was created and no item was substituted.", actor: "system", status: "blocked", evidence: { buyerRunId, quoteDigest: quote.digest, validation } }]);
    throw Object.assign(new CommerceServiceError("The accepted quote no longer matches stock or price. No Razorpay action was created; request a fresh quote.", 409), { sessionId: fresh.id });
  }
  const staged = structuredClone(fresh); staged.origin = "external_agent"; staged.buyerRunId = buyerRunId; staged.cart = { ...quote.cart, confirmedAt: new Date().toISOString() }; staged.quote = quote;
  const ready = await persist(fresh, staged, "cart_review", [{ kind: "policy", title: "Agent buyer quote accepted", detail: "An authenticated agent buyer received explicit approval for the exact quote digest.", actor: "buyer_agent", status: "success", evidence: { quoteDigest: quote.digest, buyerRunId } }]);
  const completed = await executeShoppingCommand(ready.id, { command: "create_checkout", expectedVersion: ready.version, idempotencyKey }, { paymentReturnUrl });
  return { sessionId: completed.id, checkout: completed.checkout };
}

export async function machineOrderReceipt(sessionId: string): Promise<OrderReceipt> {
  const session = await getCommerceRepository().get(sessionId);
  return { sessionId: session.id, status: session.phase, amountPaise: session.checkout?.amountPaise ?? null, referenceId: session.checkout?.referenceId ?? null, providerId: session.checkout?.providerId ?? null, origin: session.origin ?? "shopper_ui", buyerRunId: session.buyerRunId ?? null, updatedAt: session.updatedAt };
}
