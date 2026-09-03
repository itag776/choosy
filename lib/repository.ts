import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEMO_CATALOG } from "@/lib/catalog";
import { verifyCommerceAuditChain } from "@/lib/commerce-audit";
import { createShoppingSession, DEFAULT_MERCHANT_ID } from "@/lib/commerce-data";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase";
import type { AgentTurnResult, AuditIntegrity, CheckoutAction, CommerceAuditEvent, CommerceAuditTrail, Product, ShoppingSessionSnapshot } from "@/lib/types";

export class RepositoryConflictError extends Error { constructor() { super("The shopping session changed. Refresh and try again."); } }
export interface WebhookTransitionResult { duplicate: boolean; session: ShoppingSessionSnapshot; }

export interface CommerceRepository {
  create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot>;
  get(sessionId: string): Promise<ShoppingSessionSnapshot>;
  replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: CommerceAuditEvent[]): Promise<ShoppingSessionSnapshot>;
  list(): Promise<ShoppingSessionSnapshot[]>;
  getAuditTrail(sessionId: string): Promise<CommerceAuditTrail>;
  getCatalog(): Promise<Product[]>;
  setVariantStock(variantId: string, stock: number): Promise<void>;
  restoreDemoInventory(): Promise<void>;
  saveAgentRun(sessionId: string, result: AgentTurnResult): Promise<void>;
  findAgentCache(inputDigest: string): Promise<AgentTurnResult | null>;
  saveCheckout(action: CheckoutAction): Promise<void>;
  applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string, eventType: string, payloadDigest: string, auditEvent: CommerceAuditEvent): Promise<WebhookTransitionResult>;
}

function auditTrail(events: CommerceAuditEvent[], source: AuditIntegrity["source"]): CommerceAuditTrail {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const verified = ordered.length > 0 && verifyCommerceAuditChain(ordered);
  return { events: structuredClone(ordered), integrity: { verified, source, eventCount: ordered.length, firstEventAt: ordered[0]?.createdAt ?? null, lastEventAt: ordered.at(-1)?.createdAt ?? null, headHash: ordered.at(-1)?.hash ?? null, ...(!verified ? { issue: ordered.length ? "The event sequence or hash chain is invalid." : "No ledger events were found." } : {}) } };
}

const root = path.join(tmpdir(), "choosy");
const inventoryPath = path.join(root, "inventory.json");
const locks = new Map<string, Promise<void>>();
const localAgentCache = new Map<string, AgentTurnResult>();

function sessionPath(sessionId: string): string { if (!/^shop_[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid shopping session ID."); return path.join(root, `${sessionId}.json`); }
function auditPath(sessionId: string): string { if (!/^shop_[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid shopping session ID."); return path.join(root, `${sessionId}.audit.json`); }
async function atomicWrite(file: string, value: unknown): Promise<void> { await mkdir(root, { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file); }
async function inventoryOverrides(): Promise<Record<string, number>> { try { return JSON.parse(await readFile(inventoryPath, "utf8")) as Record<string, number>; } catch { return {}; } }
function applyOverrides(catalog: Product[], overrides: Record<string, number>): Product[] { return catalog.map((product) => ({ ...structuredClone(product), variants: product.variants.map((variant) => ({ ...variant, stock: overrides[variant.id] ?? variant.stock })) })); }

export class LocalCommerceRepository implements CommerceRepository {
  async create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot> { await atomicWrite(auditPath(session.id), session.audit); await atomicWrite(sessionPath(session.id), session); return structuredClone(session); }
  async get(sessionId: string): Promise<ShoppingSessionSnapshot> {
    const parsed = JSON.parse(await readFile(sessionPath(sessionId), "utf8")) as ShoppingSessionSnapshot;
    parsed.origin ??= "shopper_ui";
    if (!verifyCommerceAuditChain(parsed.audit)) throw new Error("Commerce audit chain verification failed.");
    parsed.integration = { gemini: Boolean(process.env.GEMINI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: "local_file" };
    return parsed;
  }
  async replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: CommerceAuditEvent[]): Promise<ShoppingSessionSnapshot> {
    const prior = locks.get(current.id) ?? Promise.resolve(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); locks.set(current.id, prior.then(() => gate)); await prior;
    try { const stored = await this.get(current.id); if (stored.version !== current.version) throw new RepositoryConflictError(); const trail = await this.getAuditTrail(current.id); if (!trail.integrity.verified) throw new Error("Commerce audit ledger verification failed."); const combined = [...trail.events, ...events]; if (!verifyCommerceAuditChain(combined) || combined.at(-1)?.hash !== next.audit.at(-1)?.hash) throw new Error("Commerce audit ledger transition is invalid."); await atomicWrite(auditPath(current.id), combined); await atomicWrite(sessionPath(current.id), next); return structuredClone(next); }
    finally { release(); }
  }
  async list(): Promise<ShoppingSessionSnapshot[]> { try { const files = (await readdir(root)).filter((file) => /^shop_[a-f0-9]{24}\.json$/.test(file)); const sessions = await Promise.all(files.map((file) => this.get(file.replace(".json", "")))); return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30); } catch { return []; } }
  async getAuditTrail(sessionId: string): Promise<CommerceAuditTrail> { try { const events = JSON.parse(await readFile(auditPath(sessionId), "utf8")) as CommerceAuditEvent[]; return auditTrail(events, "local_ledger"); } catch { try { const session = JSON.parse(await readFile(sessionPath(sessionId), "utf8")) as ShoppingSessionSnapshot; if (!verifyCommerceAuditChain(session.audit)) throw new Error("Invalid legacy audit"); await atomicWrite(auditPath(sessionId), session.audit); return auditTrail(session.audit, "local_ledger"); } catch { return { events: [], integrity: { verified: false, source: "local_ledger", eventCount: 0, firstEventAt: null, lastEventAt: null, headHash: null, issue: "No valid local audit ledger was found for this session." } }; } } }
  async getCatalog(): Promise<Product[]> { return applyOverrides(DEMO_CATALOG, await inventoryOverrides()); }
  async setVariantStock(variantId: string, stock: number): Promise<void> { const values = await inventoryOverrides(); values[variantId] = stock; await atomicWrite(inventoryPath, values); }
  async restoreDemoInventory(): Promise<void> { await atomicWrite(inventoryPath, {}); }
  async saveAgentRun(_sessionId: string, result: AgentTurnResult): Promise<void> { localAgentCache.set(result.inputDigest, structuredClone(result)); }
  async findAgentCache(inputDigest: string): Promise<AgentTurnResult | null> { return structuredClone(localAgentCache.get(inputDigest) ?? null); }
  async saveCheckout(action: CheckoutAction): Promise<void> { if (!/^checkout_chy_[a-f0-9]{20}$/.test(action.id)) throw new Error("Invalid checkout action ID."); await atomicWrite(path.join(root, `${action.id}.json`), action); }
  async applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string, _eventType: string, _payloadDigest: string, auditEvent: CommerceAuditEvent): Promise<WebhookTransitionResult> { if (current.processedWebhookIds.includes(eventId)) return { duplicate: true, session: current }; return { duplicate: false, session: await this.replace(current, next, [auditEvent]) }; }
}

class SupabaseCommerceRepository implements CommerceRepository {
  private client = getSupabaseAdmin();
  private async syncCatalog(resetStock: boolean): Promise<void> {
    const timestamp = new Date().toISOString();
    const productRows = DEMO_CATALOG.map((product) => ({
      id: product.id,
      merchant_id: DEFAULT_MERCHANT_ID,
      sku: product.sku,
      category: product.category,
      kind: product.kind,
      brand: product.brand,
      name: product.name,
      description: product.description,
      image_url: product.imageUrl,
      promoted: product.promoted,
      active: true,
      tags: product.tags,
      attributes: product.attributes,
      updated_at: timestamp,
    }));
    const { error: productError } = await this.client.from("catalog_products").upsert(productRows, { onConflict: "id" });
    if (productError) throw new Error(`Supabase catalog product sync failed: ${productError.message}`);

    const canonicalVariants = DEMO_CATALOG.flatMap((product) => product.variants.map((item) => ({ product, item })));
    const variantIds = canonicalVariants.map(({ item }) => item.id);
    const { data: existingVariants, error: existingError } = await this.client.from("catalog_variants").select("id,stock").in("id", variantIds);
    if (existingError) throw new Error(`Supabase catalog stock read failed: ${existingError.message}`);
    const existingStock = new Map(existingVariants.map((item) => [item.id, item.stock]));
    const variantRows = canonicalVariants.map(({ product, item }) => ({
      id: item.id,
      product_id: product.id,
      sku: item.sku,
      label: item.label,
      price_paise: item.pricePaise,
      stock: resetStock ? item.stock : existingStock.get(item.id) ?? item.stock,
      attributes: item.attributes,
      updated_at: timestamp,
    }));
    const { error: variantError } = await this.client.from("catalog_variants").upsert(variantRows, { onConflict: "id" });
    if (variantError) throw new Error(`Supabase catalog variant sync failed: ${variantError.message}`);

    const { data: merchantProducts, error: staleReadError } = await this.client.from("catalog_products").select("id").eq("merchant_id", DEFAULT_MERCHANT_ID).eq("active", true);
    if (staleReadError) throw new Error(`Supabase stale catalog read failed: ${staleReadError.message}`);
    const canonicalIds = new Set(DEMO_CATALOG.map((product) => product.id));
    const staleIds = merchantProducts.map((item) => item.id).filter((id) => !canonicalIds.has(id));
    if (staleIds.length) {
      const { error: staleError } = await this.client.from("catalog_products").update({ active: false, updated_at: timestamp }).in("id", staleIds);
      if (staleError) throw new Error(`Supabase stale catalog deactivation failed: ${staleError.message}`);
    }
  }

  private async readCatalog(): Promise<Product[]> {
    const { data, error } = await this.client.from("catalog_products").select("id,sku,category,kind,brand,name,description,image_url,promoted,tags,attributes,catalog_variants(id,sku,label,price_paise,stock,attributes)").eq("active", true);
    if (error) throw new Error(`Supabase catalog read failed: ${error.message}`);
    return data.map((row) => ({ id: row.id, sku: row.sku, category: row.category, kind: row.kind, brand: row.brand, name: row.name, description: row.description, imageUrl: row.image_url, promoted: row.promoted, tags: row.tags, attributes: row.attributes, variants: row.catalog_variants.map((item: Record<string, unknown>) => ({ id: item.id, sku: item.sku, label: item.label, pricePaise: item.price_paise, stock: item.stock, attributes: item.attributes })) })) as Product[];
  }

  async create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot> { await this.client.from("merchants").upsert({ id: DEFAULT_MERCHANT_ID, name: "Choosy Demo Store", environment: "test_mode" }); const { error } = await this.client.rpc("create_commerce_session", { p_session_id: session.id, p_merchant_id: session.merchantId, p_phase: session.phase, p_version: session.version, p_origin: session.origin, p_buyer_run_id: session.buyerRunId ?? null, p_snapshot: session, p_initial_event: session.audit[0] }); if (error) throw new Error(`Supabase session create failed: ${error.message}`); return session; }
  async get(sessionId: string): Promise<ShoppingSessionSnapshot> { const { data, error } = await this.client.from("commerce_sessions").select("snapshot").eq("id", sessionId).single(); if (error) throw new Error(`Supabase session read failed: ${error.message}`); const session = data.snapshot as ShoppingSessionSnapshot; session.origin ??= "shopper_ui"; if (!verifyCommerceAuditChain(session.audit)) throw new Error("Commerce audit chain verification failed."); session.integration = { gemini: Boolean(process.env.GEMINI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: "supabase" }; return session; }
  async replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: CommerceAuditEvent[]): Promise<ShoppingSessionSnapshot> { const { data, error } = await this.client.rpc("apply_commerce_transition", { p_session_id: current.id, p_expected_version: current.version, p_next_phase: next.phase, p_snapshot: next, p_events: events }); if (error) { if (error.message.includes("stale_session_version")) throw new RepositoryConflictError(); throw new Error(`Supabase transition failed: ${error.message}`); } return (data as { snapshot: ShoppingSessionSnapshot }).snapshot; }
  async list(): Promise<ShoppingSessionSnapshot[]> { const { data, error } = await this.client.from("commerce_sessions").select("snapshot").order("updated_at", { ascending: false }).limit(30); if (error) throw new Error(error.message); return data.map((row) => { const session=row.snapshot as ShoppingSessionSnapshot; session.origin??="shopper_ui"; return session; }); }
  async getAuditTrail(sessionId: string): Promise<CommerceAuditTrail> { const { data, error } = await this.client.from("commerce_audit_events").select("event").eq("session_id", sessionId).order("sequence", { ascending: true }); if (error) return { events: [], integrity: { verified: false, source: "supabase_ledger", eventCount: 0, firstEventAt: null, lastEventAt: null, headHash: null, issue: `The audit ledger could not be read: ${error.message}` } }; return auditTrail(data.map((row) => row.event as CommerceAuditEvent), "supabase_ledger"); }
  async getCatalog(): Promise<Product[]> {
    let catalog = await this.readCatalog();
    const canonicalIds = new Set(DEMO_CATALOG.map((product) => product.id));
    const canonicalVariantCounts = new Map(DEMO_CATALOG.map((product) => [product.id, product.variants.length]));
    const incomplete = catalog.some((product) => product.variants.length !== canonicalVariantCounts.get(product.id));
    if (catalog.length !== canonicalIds.size || catalog.some((product) => !canonicalIds.has(product.id)) || incomplete) {
      await this.syncCatalog(false);
      catalog = await this.readCatalog();
    }
    return catalog;
  }
  async setVariantStock(variantId: string, stock: number): Promise<void> { const { error } = await this.client.from("catalog_variants").update({ stock, updated_at: new Date().toISOString() }).eq("id", variantId); if (error) throw new Error(error.message); }
  async restoreDemoInventory(): Promise<void> { await this.syncCatalog(true); }
  async saveAgentRun(sessionId: string, result: AgentTurnResult): Promise<void> { const { error } = await this.client.from("commerce_agent_runs").insert({ session_id: sessionId, model: result.model, mode: result.mode, input_digest: result.inputDigest, prompt_version: result.promptVersion, catalog_version: result.catalogVersion, output: result }); if (error) throw new Error(error.message); }
  async findAgentCache(inputDigest: string): Promise<AgentTurnResult | null> { const { data, error } = await this.client.from("commerce_agent_runs").select("output").eq("input_digest", inputDigest).in("mode", ["gemini_agent","hybrid_agent"]).order("created_at", { ascending: false }).limit(1).maybeSingle(); if (error) throw new Error(error.message); return data?.output as AgentTurnResult | null; }
  async saveCheckout(action: CheckoutAction): Promise<void> { const { error } = await this.client.from("commerce_checkout_actions").upsert({ id: action.id, session_id: action.sessionId, cart_id: action.cartId, cart_digest: action.cartDigest, quote_digest: action.quoteDigest, idempotency_key: action.idempotencyKey, reference_id: action.referenceId, amount_paise: action.amountPaise, provider_id: action.providerId ?? null, status: action.status, request_digest: action.requestDigest, response: action, updated_at: action.updatedAt }); if (error) throw new Error(error.message); }
  async applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string, eventType: string, payloadDigest: string, auditEvent: CommerceAuditEvent): Promise<WebhookTransitionResult> { const { data, error } = await this.client.rpc("process_commerce_webhook", { p_session_id: current.id, p_expected_version: current.version, p_event_id: eventId, p_event_type: eventType, p_payload_digest: payloadDigest, p_snapshot: next, p_event: auditEvent }); if (error) throw new Error(`Supabase webhook transition failed: ${error.message}`); const result = data as { duplicate: boolean; snapshot: ShoppingSessionSnapshot }; return { duplicate: result.duplicate, session: result.snapshot }; }
}

let repositoryOverride: CommerceRepository | undefined;
let singleton: CommerceRepository | undefined;
export function getCommerceRepository(): CommerceRepository {
  const durable = hasSupabaseConfig() && (process.env.NODE_ENV === "production" || process.env.USE_SUPABASE_COMMERCE === "true");
  return repositoryOverride ?? (singleton ??= durable ? new SupabaseCommerceRepository() : new LocalCommerceRepository());
}
export function setCommerceRepositoryForTests(value?: CommerceRepository): void { repositoryOverride = value; singleton = undefined; }
export async function createAndStoreSession(): Promise<ShoppingSessionSnapshot> {
  const session = createShoppingSession();
  const selectedRepository = getCommerceRepository();
  try { return await selectedRepository.create(session); }
  catch (error) {
    if (process.env.NODE_ENV === "production" || !(selectedRepository instanceof SupabaseCommerceRepository)) throw error;
    console.warn("Choosy commerce schema is not available; using the local development repository.");
    singleton = singleton instanceof LocalCommerceRepository ? singleton : new LocalCommerceRepository();
    session.integration.persistence = "local_file";
    return singleton.create(session);
  }
}
