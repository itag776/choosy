import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEMO_CATALOG } from "@/lib/catalog";
import { verifyCommerceAuditChain } from "@/lib/commerce-audit";
import { createShoppingSession, DEFAULT_MERCHANT_ID } from "@/lib/commerce-data";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase";
import type { AgentTurnResult, CheckoutAction, CommerceAuditEvent, Product, ShoppingSessionSnapshot } from "@/lib/types";

export class RepositoryConflictError extends Error { constructor() { super("The shopping session changed. Refresh and try again."); } }
export interface WebhookTransitionResult { duplicate: boolean; session: ShoppingSessionSnapshot; }

export interface CommerceRepository {
  create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot>;
  get(sessionId: string): Promise<ShoppingSessionSnapshot>;
  replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: CommerceAuditEvent[]): Promise<ShoppingSessionSnapshot>;
  list(): Promise<ShoppingSessionSnapshot[]>;
  getCatalog(): Promise<Product[]>;
  setVariantStock(variantId: string, stock: number): Promise<void>;
  saveAgentRun(sessionId: string, result: AgentTurnResult): Promise<void>;
  findAgentCache(inputDigest: string): Promise<AgentTurnResult | null>;
  saveCheckout(action: CheckoutAction): Promise<void>;
  applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string, eventType: string, payloadDigest: string, auditEvent: CommerceAuditEvent): Promise<WebhookTransitionResult>;
}

const root = path.join(tmpdir(), "choosy");
const inventoryPath = path.join(root, "inventory.json");
const locks = new Map<string, Promise<void>>();
const localAgentCache = new Map<string, AgentTurnResult>();

function sessionPath(sessionId: string): string { if (!/^shop_[a-f0-9]{24}$/.test(sessionId)) throw new Error("Invalid shopping session ID."); return path.join(root, `${sessionId}.json`); }
async function atomicWrite(file: string, value: unknown): Promise<void> { await mkdir(root, { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file); }
async function inventoryOverrides(): Promise<Record<string, number>> { try { return JSON.parse(await readFile(inventoryPath, "utf8")) as Record<string, number>; } catch { return {}; } }
function applyOverrides(catalog: Product[], overrides: Record<string, number>): Product[] { return catalog.map((product) => ({ ...structuredClone(product), variants: product.variants.map((variant) => ({ ...variant, stock: overrides[variant.id] ?? variant.stock })) })); }

export class LocalCommerceRepository implements CommerceRepository {
  async create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot> { await atomicWrite(sessionPath(session.id), session); return structuredClone(session); }
  async get(sessionId: string): Promise<ShoppingSessionSnapshot> {
    const parsed = JSON.parse(await readFile(sessionPath(sessionId), "utf8")) as ShoppingSessionSnapshot;
    if (!verifyCommerceAuditChain(parsed.audit)) throw new Error("Commerce audit chain verification failed.");
    parsed.integration = { gemini: Boolean(process.env.GEMINI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: "local_file" };
    return parsed;
  }
  async replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot> {
    const prior = locks.get(current.id) ?? Promise.resolve(); let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); locks.set(current.id, prior.then(() => gate)); await prior;
    try { const stored = await this.get(current.id); if (stored.version !== current.version) throw new RepositoryConflictError(); await atomicWrite(sessionPath(current.id), next); return structuredClone(next); }
    finally { release(); }
  }
  async list(): Promise<ShoppingSessionSnapshot[]> { try { const files = (await readdir(root)).filter((file) => /^shop_[a-f0-9]{24}\.json$/.test(file)); const sessions = await Promise.all(files.map((file) => this.get(file.replace(".json", "")))); return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30); } catch { return []; } }
  async getCatalog(): Promise<Product[]> { return applyOverrides(DEMO_CATALOG, await inventoryOverrides()); }
  async setVariantStock(variantId: string, stock: number): Promise<void> { const values = await inventoryOverrides(); values[variantId] = stock; await atomicWrite(inventoryPath, values); }
  async saveAgentRun(_sessionId: string, result: AgentTurnResult): Promise<void> { localAgentCache.set(result.inputDigest, structuredClone(result)); }
  async findAgentCache(inputDigest: string): Promise<AgentTurnResult | null> { return structuredClone(localAgentCache.get(inputDigest) ?? null); }
  async saveCheckout(action: CheckoutAction): Promise<void> { if (!/^checkout_chy_[a-f0-9]{20}$/.test(action.id)) throw new Error("Invalid checkout action ID."); await atomicWrite(path.join(root, `${action.id}.json`), action); }
  async applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string): Promise<WebhookTransitionResult> { if (current.processedWebhookIds.includes(eventId)) return { duplicate: true, session: current }; return { duplicate: false, session: await this.replace(current, next) }; }
}

class SupabaseCommerceRepository implements CommerceRepository {
  private client = getSupabaseAdmin();
  async create(session: ShoppingSessionSnapshot): Promise<ShoppingSessionSnapshot> { await this.client.from("merchants").upsert({ id: DEFAULT_MERCHANT_ID, name: "Choosy Demo Store", environment: "test_mode" }); const { error } = await this.client.from("commerce_sessions").insert({ id: session.id, merchant_id: session.merchantId, phase: session.phase, version: session.version, snapshot: session }); if (error) throw new Error(`Supabase session create failed: ${error.message}`); return session; }
  async get(sessionId: string): Promise<ShoppingSessionSnapshot> { const { data, error } = await this.client.from("commerce_sessions").select("snapshot").eq("id", sessionId).single(); if (error) throw new Error(`Supabase session read failed: ${error.message}`); const session = data.snapshot as ShoppingSessionSnapshot; if (!verifyCommerceAuditChain(session.audit)) throw new Error("Commerce audit chain verification failed."); session.integration = { gemini: Boolean(process.env.GEMINI_API_KEY), razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), webhookSecret: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET), persistence: "supabase" }; return session; }
  async replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: CommerceAuditEvent[]): Promise<ShoppingSessionSnapshot> { const { data, error } = await this.client.rpc("apply_commerce_transition", { p_session_id: current.id, p_expected_version: current.version, p_next_phase: next.phase, p_snapshot: next, p_events: events }); if (error) { if (error.message.includes("stale_session_version")) throw new RepositoryConflictError(); throw new Error(`Supabase transition failed: ${error.message}`); } return (data as { snapshot: ShoppingSessionSnapshot }).snapshot; }
  async list(): Promise<ShoppingSessionSnapshot[]> { const { data, error } = await this.client.from("commerce_sessions").select("snapshot").order("updated_at", { ascending: false }).limit(30); if (error) throw new Error(error.message); return data.map((row) => row.snapshot as ShoppingSessionSnapshot); }
  async getCatalog(): Promise<Product[]> {
    const { data, error } = await this.client.from("catalog_products").select("id,sku,category,kind,brand,name,description,image_url,promoted,tags,attributes,catalog_variants(id,sku,label,price_paise,stock,attributes)").eq("active", true);
    if (error) throw new Error(`Supabase catalog read failed: ${error.message}`);
    return data.map((row) => ({ id: row.id, sku: row.sku, category: row.category, kind: row.kind, brand: row.brand, name: row.name, description: row.description, imageUrl: row.image_url, promoted: row.promoted, tags: row.tags, attributes: row.attributes, variants: row.catalog_variants.map((item: Record<string, unknown>) => ({ id: item.id, sku: item.sku, label: item.label, pricePaise: item.price_paise, stock: item.stock, attributes: item.attributes })) })) as Product[];
  }
  async setVariantStock(variantId: string, stock: number): Promise<void> { const { error } = await this.client.from("catalog_variants").update({ stock, updated_at: new Date().toISOString() }).eq("id", variantId); if (error) throw new Error(error.message); }
  async saveAgentRun(sessionId: string, result: AgentTurnResult): Promise<void> { const { error } = await this.client.from("commerce_agent_runs").insert({ session_id: sessionId, model: result.model, mode: result.mode, input_digest: result.inputDigest, prompt_version: result.promptVersion, catalog_version: result.catalogVersion, output: result }); if (error) throw new Error(error.message); }
  async findAgentCache(inputDigest: string): Promise<AgentTurnResult | null> { const { data, error } = await this.client.from("commerce_agent_runs").select("output").eq("input_digest", inputDigest).eq("mode", "gemini_agent").order("created_at", { ascending: false }).limit(1).maybeSingle(); if (error) throw new Error(error.message); return data?.output as AgentTurnResult | null; }
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
