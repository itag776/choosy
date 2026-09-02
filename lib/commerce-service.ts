import { createHash, randomUUID } from "node:crypto";
import { CATALOG_VERSION, categoryProfile, productById, variantById } from "@/lib/catalog";
import { createCommerceAuditEvent } from "@/lib/commerce-audit";
import { allQuestions, buildCart, cartDigest, createQuote, isProfileComplete, nextQuestion, quoteDigest, rankProducts, recommendedAddons, validateCart } from "@/lib/commerce-policy";
import { createShoppingSession, DEFAULT_MERCHANT_ID, publicShoppingSession } from "@/lib/commerce-data";
import { checkoutIntent, createOrReconcileCheckout } from "@/lib/razorpay";
import { createAndStoreSession, getCommerceRepository } from "@/lib/repository";
import { applyStructuredAnswer, discoveryInputDigest, mergeAgentPatch, ShoppingAgentUnavailableError, understandShoppingMessage } from "@/lib/shopping-agent";
import type { Cart, CartItem, ChatMessage, CommerceAuditEvent, MerchantDashboard, OperatorIdentity, Product, Quote, ShoppingCommandRequest, ShoppingPhase, ShoppingSessionSnapshot } from "@/lib/types";

export class CommerceServiceError extends Error { constructor(message: string, public status = 409) { super(message); } }
type EventInput = Omit<CommerceAuditEvent, "id" | "sequence" | "createdAt" | "previousHash" | "hash">;

function appendEvents(session: ShoppingSessionSnapshot, inputs: EventInput[]): CommerceAuditEvent[] { const events: CommerceAuditEvent[] = []; for (const input of inputs) { const event = createCommerceAuditEvent(session, input); session.audit.push(event); events.push(event); } return events; }
async function persist(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, phase: ShoppingPhase, inputs: EventInput[]): Promise<ShoppingSessionSnapshot> { next.phase = phase; next.version = current.version + 1; next.updatedAt = new Date().toISOString(); const events = appendEvents(next, inputs); return getCommerceRepository().replace(current, next, events); }
function message(role: ChatMessage["role"], text: string): ChatMessage { return { id: randomUUID(), role, text, createdAt: new Date().toISOString() }; }
function requireVersion(session: ShoppingSessionSnapshot, version: number): void { if (session.version !== version) throw new CommerceServiceError("The conversation changed. Refresh and try again.", 409); }

export async function startShoppingSession(): Promise<ShoppingSessionSnapshot> { return publicShoppingSession(await createAndStoreSession()); }
export async function getShoppingSession(sessionId: string): Promise<ShoppingSessionSnapshot> { return publicShoppingSession(await getCommerceRepository().get(sessionId)); }

export async function sendShoppingMessage(sessionId: string, input: { text: string; expectedVersion: number; idempotencyKey: string; answerKey?: string; answerValue?: string }): Promise<ShoppingSessionSnapshot> {
  const repository = getCommerceRepository(); const current = await repository.get(sessionId);
  if (current.commandReceipts.some((item) => item.idempotencyKey === input.idempotencyKey)) return publicShoppingSession(current);
  requireVersion(current, input.expectedVersion);
  if (current.phase !== "discovering" && current.phase !== "agent_failure") throw new CommerceServiceError("Edit your criteria by starting a new search.");
  const next = structuredClone(current); next.commandReceipts.push({ idempotencyKey: input.idempotencyKey, command: "send_message", version: current.version + 1, completedAt: new Date().toISOString() }); next.messages.push(message("user", input.text));
  let profile = current.profile; const events: EventInput[] = [{ kind: "shopper", title: "Shopper answered a discovery question", detail: "The answer was recorded without personal information.", actor: "shopper", status: "info", evidence: { activeQuestionKey: current.activeQuestionKey } }];
  if (input.answerKey && input.answerValue) {
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
      events.push(...result.toolEvents.map((tool): EventInput => ({ kind: "agent", title: tool.name, detail: tool.summary, actor: "agent", status: tool.status === "completed" ? "success" : "blocked", evidence: { mode: result.mode, inputDigest: result.inputDigest } })));
    } catch (error) {
      if (!(error instanceof ShoppingAgentUnavailableError)) throw error;
      next.messages.push(message("assistant", "I couldn’t interpret that safely. Please retry, or use one of the quick choices.")); next.activeQuestionKey = current.activeQuestionKey;
      return publicShoppingSession(await persist(current, next, "agent_failure", [...events, { kind: "guardrail", title: "Understanding stopped safely", detail: error.message, actor: "system", status: "blocked" }]));
    }
  }
  next.profile = profile;
  const pending = nextQuestion(profile);
  if (!pending && isProfileComplete(profile)) {
    const catalog = await repository.getCatalog(); const recommendations = rankProducts(profile, catalog);
    if (!recommendations.length) {
      next.profile.confirmedKeys = next.profile.confirmedKeys.filter((key) => key !== "maxBudgetPaise"); next.activeQuestionKey = "maxBudgetPaise";
      next.messages.push(message("assistant", "Nothing in this merchant’s current inventory satisfies every constraint. What budget would you like me to try instead?"));
      events.push({ kind: "guardrail", title: "No compliant product found", detail: "Choosy refused to invent or stretch beyond the confirmed criteria.", actor: "system", status: "blocked" });
      return publicShoppingSession(await persist(current, next, "discovering", events));
    }
    next.recommendations = recommendations; next.activeQuestionKey = null;
    next.messages.push(message("assistant", `I have enough context. I found ${recommendations.length} in-stock choices that stay within your budget.`));
    events.push({ kind: "policy", title: "Discovery completeness gate passed", detail: "Every required universal and category-specific preference was explicitly answered.", actor: "system", status: "success", evidence: { confirmedKeys: profile.confirmedKeys } }, { kind: "catalog", title: "Deterministic shortlist created", detail: `${recommendations.length} catalog-backed recommendations passed budget, stock, variant and deal-breaker checks.`, actor: "system", status: "success", evidence: { productIds: recommendations.map((item) => item.productId), catalogVersion: CATALOG_VERSION } });
    return publicShoppingSession(await persist(current, next, "recommendations_ready", events));
  }
  next.activeQuestionKey = pending?.key ?? current.activeQuestionKey; if (pending) next.messages.push(message("assistant", pending.prompt));
  events.push({ kind: "policy", title: "Recommendation withheld", detail: `Choosy needs ${pending?.key ?? "more context"} before searching the catalog.`, actor: "system", status: "success", evidence: { nextQuestionKey: pending?.key } });
  return publicShoppingSession(await persist(current, next, "discovering", events));
}

export async function executeShoppingCommand(sessionId: string, input: ShoppingCommandRequest): Promise<ShoppingSessionSnapshot> {
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
    next.messages.push(message("assistant", next.offeredAddonIds.length ? "Good choice. I found two relevant extras that still fit your approved budget—you can add either or skip both." : "Good choice. No useful add-on fits the remaining budget, so I’ll keep the cart focused."));
    events.push({ kind: "cart", title: "Primary product selected", detail: `${product.name} was selected from the deterministic shortlist.`, actor: "shopper", status: "success", evidence: { productId, variantId: selectedVariant.id } });
    return publicShoppingSession(await persist(current, next, "item_selected", events));
  }
  if (input.command === "set_addons") {
    if (current.phase !== "item_selected") throw new CommerceServiceError("Choose a primary product first.");
    const addonIds = Array.isArray(input.payload?.addonIds) ? input.payload.addonIds.map(String) : []; if (addonIds.length > 2 || addonIds.some((id) => !current.offeredAddonIds.includes(id))) throw new CommerceServiceError("Only offered add-ons may be selected.");
    const product = current.selectedProductId ? productById(current.selectedProductId, catalog) : undefined; const selectedVariant = product && current.selectedVariantId ? variantById(product, current.selectedVariantId) : undefined; if (!product || !selectedVariant) throw new CommerceServiceError("The selected product is unavailable.");
    const addons = addonIds.map((id) => productById(id, catalog)).filter((item): item is Product => Boolean(item)); const cart = buildCart(product, selectedVariant, addons); if (next.profile.maxBudgetPaise && cart.totalPaise > next.profile.maxBudgetPaise) throw new CommerceServiceError("That bundle exceeds the confirmed budget.");
    next.cart = cart; next.messages.push(message("assistant", `Your cart is ready at ₹${Math.round(cart.totalPaise / 100).toLocaleString("en-IN")}. Review it before I create any payment action.`));
    events.push({ kind: "cart", title: addonIds.length ? "Budget-safe bundle assembled" : "Add-ons skipped", detail: addonIds.length ? `${addonIds.length} relevant add-on${addonIds.length === 1 ? "" : "s"} kept the cart within budget.` : "The shopper kept only the primary product.", actor: "shopper", status: "success", evidence: { addonIds, cartDigest: cart.digest, totalPaise: cart.totalPaise } });
    return publicShoppingSession(await persist(current, next, "cart_review", events));
  }
  if (input.command === "confirm_cart") {
    if ((current.phase !== "cart_review" && current.phase !== "needs_reselection") || !current.cart) throw new CommerceServiceError("There is no cart ready to confirm.");
    const validation = validateCart(current.cart, catalog);
    if (!validation.valid) {
      next.recommendations = rankProducts(next.profile, catalog); next.selectedProductId = null; next.selectedVariantId = null; next.offeredAddonIds = []; next.cart = null; next.quote = null; next.checkout = null;
      next.messages.push(message("assistant", "That item became unavailable before checkout. I stopped the payment action and refreshed your shortlist—nothing was silently substituted."));
      events.push({ kind: "inventory", title: "Unavailable item blocked at checkout", detail: "Fresh inventory did not match the confirmed cart, so no Razorpay intent was created.", actor: "system", status: "blocked", evidence: validation });
      return publicShoppingSession(await persist(current, next, "needs_reselection", events));
    }
    next.cart = { ...current.cart, confirmedAt: new Date().toISOString() }; next.quote = createQuote(next.cart); next.messages.push(message("assistant", "Stock and price are current. Your exact cart is now confirmed; payment still requires your next click."));
    events.push({ kind: "inventory", title: "Cart revalidated", detail: "Every variant and price matched the confirmed cart.", actor: "system", status: "success", evidence: { cartDigest: next.cart.digest, totalPaise: next.cart.totalPaise } }, { kind: "policy", title: "Explicit cart approval recorded", detail: "The shopper confirmed the exact items and Test Mode amount.", actor: "shopper", status: "success", evidence: { quoteDigest: next.quote.digest } });
    return publicShoppingSession(await persist(current, next, "cart_review", events));
  }
  if (input.command === "create_checkout" || input.command === "retry_payment") {
    if (!current.cart?.confirmedAt || !current.quote) throw new CommerceServiceError("Confirm the current cart before checkout.");
    if (new Date(current.quote.expiresAt).getTime() <= Date.now()) throw new CommerceServiceError("The quote expired. Confirm the cart again.");
    const validation = validateCart(current.cart, catalog); if (!validation.valid) { next.recommendations = rankProducts(next.profile, catalog); next.selectedProductId = null; next.selectedVariantId = null; next.cart = null; next.quote = null; next.checkout = null; next.messages.push(message("assistant", "Inventory changed before checkout. I stopped and refreshed your valid options.")); return publicShoppingSession(await persist(current, next, "needs_reselection", [{ kind: "inventory", title: "Checkout stopped before provider call", detail: "The cart failed final stock or price validation.", actor: "system", status: "blocked", evidence: validation }])); }
    const action = checkoutIntent(current.id, current.quote, input.idempotencyKey); await repository.saveCheckout(action);
    let external; try { external = await createOrReconcileCheckout(action); } catch (error) { external = { ...action, status: "failed" as const, failureReason: error instanceof Error ? error.message : "Razorpay checkout failed.", updatedAt: new Date().toISOString() }; }
    await repository.saveCheckout(external); next.checkout = external;
    if (external.status === "created" || external.status === "paid") {
      next.messages.push(message("assistant", external.status === "paid" ? "Razorpay already confirms this exact Test Mode order as paid." : "Your secure Razorpay Test Mode checkout is ready."));
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
  if (operator.merchantId !== DEFAULT_MERCHANT_ID) throw new CommerceServiceError("Merchant access denied.", 403); const sessions = await getCommerceRepository().list(); const total = sessions.length || 1;
  const recommended = sessions.filter((item) => item.recommendations.length > 0).length; const carts = sessions.filter((item) => item.cart).length; const checkouts = sessions.filter((item) => item.checkout).length; const paid = sessions.filter((item) => item.phase === "paid"); const attached = sessions.filter((item) => item.cart?.items.some((entry) => entry.kind === "addon")).length;
  return { sessions, metrics: { totalSessions: sessions.length, recommendationRate: recommended / total, cartRate: carts / total, checkoutRate: checkouts / total, paidTestModePaise: paid.reduce((sum, item) => sum + (item.checkout?.amountPaise ?? 0), 0), addonAttachRate: attached / total }, integration: sessions[0]?.integration ?? createShoppingSession().integration };
}

export async function markSelectedItemUnavailable(sessionId: string, operator: OperatorIdentity): Promise<ShoppingSessionSnapshot> {
  if (operator.merchantId !== DEFAULT_MERCHANT_ID) throw new CommerceServiceError("Merchant access denied.", 403); const repository = getCommerceRepository(); const current = await repository.get(sessionId); if (!current.selectedVariantId) throw new CommerceServiceError("This session has no selected variant."); await repository.setVariantStock(current.selectedVariantId, 0); const catalog = await repository.getCatalog(); const selectedName = catalog.find((item) => item.id === current.selectedProductId)?.name ?? "Selected item";
  return publicShoppingSession(await persist(current, structuredClone(current), current.phase, [{ kind: "inventory", title: "Demo inventory change applied", detail: `${selectedName} was marked unavailable by the merchant demo control. Checkout must revalidate before any money action.`, actor: "merchant", status: "warning", evidence: { variantId: current.selectedVariantId, demoControl: true } }]));
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
export function commerceCapabilities() { return { name: "Choosy", version: "2026-09-v1", mode: "razorpay_test", currency: "INR", categories: ["phones", "headphones", "running-shoes"], catalogVersion: CATALOG_VERSION, constraints: { requiresExplicitConfirmation: true, revalidatesPriceAndStock: true, maximumAddons: 2, personalInformationInChat: false }, endpoints: { catalog: "/api/catalog", quote: "/api/commerce/quotes", checkout: "/api/commerce/checkouts" } }; }
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

export async function createMachineCheckout(quote: Quote, acceptedQuoteDigest: string, idempotencyKey: string): Promise<{ sessionId: string; checkout: ShoppingSessionSnapshot["checkout"] }> {
  if (quote.digest !== acceptedQuoteDigest) throw new CommerceServiceError("The accepted quote digest does not match.", 422);
  if (quote.catalogVersion !== CATALOG_VERSION || quote.digest !== quoteDigest(quote.cart.digest, quote.catalogVersion, quote.expiresAt)) throw new CommerceServiceError("The quote integrity check failed.", 422);
  if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new CommerceServiceError("The accepted quote expired.", 409);
  const fresh = await createAndStoreSession(); const catalog = await getCommerceRepository().getCatalog(); const validation = validateCart(quote.cart, catalog);
  if (!validation.valid) throw new CommerceServiceError("The accepted quote no longer matches stock or price.", 409);
  const staged = structuredClone(fresh); staged.cart = { ...quote.cart, confirmedAt: new Date().toISOString() }; staged.quote = quote;
  const ready = await persist(fresh, staged, "cart_review", [{ kind: "policy", title: "Agent buyer quote accepted", detail: "An authenticated agent buyer explicitly accepted the exact quote digest.", actor: "shopper", status: "success", evidence: { quoteDigest: quote.digest } }]);
  const completed = await executeShoppingCommand(ready.id, { command: "create_checkout", expectedVersion: ready.version, idempotencyKey });
  return { sessionId: completed.id, checkout: completed.checkout };
}
