import { DEMO_CATALOG } from "@/lib/catalog";
import { createShoppingSession } from "@/lib/commerce-data";
import { verifyCommerceAuditChain } from "@/lib/commerce-audit";
import type { AgentTurnResult, CheckoutAction, Product, ShoppingSessionSnapshot } from "@/lib/types";
import type { CommerceRepository, WebhookTransitionResult } from "@/lib/repository";

export const TEST_SESSION_ID = "shop_aaaaaaaaaaaaaaaaaaaaaaaa";

export class MemoryCommerceRepository implements CommerceRepository {
  sessions = new Map<string, ShoppingSessionSnapshot>();
  ledgers = new Map<string, ShoppingSessionSnapshot["audit"]>();
  catalog: Product[] = structuredClone(DEMO_CATALOG);
  cache = new Map<string, AgentTurnResult>();
  checkouts: CheckoutAction[] = [];
  webhooks = new Set<string>();
  constructor() { const session = createShoppingSession(new Date("2026-09-03T10:00:00.000Z"), TEST_SESSION_ID); this.sessions.set(session.id, session); this.ledgers.set(session.id, structuredClone(session.audit)); }
  async create(session: ShoppingSessionSnapshot) { this.sessions.set(session.id, structuredClone(session)); this.ledgers.set(session.id, structuredClone(session.audit)); return structuredClone(session); }
  async get(sessionId: string) { const session = this.sessions.get(sessionId); if (!session) throw new Error("Session not found."); return structuredClone(session); }
  async replace(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, events: ShoppingSessionSnapshot["audit"]) { const stored = this.sessions.get(current.id); if (!stored || stored.version !== current.version) throw new Error("conflict"); const ledger=this.ledgers.get(current.id)??[];const combined=[...ledger,...events];if(!verifyCommerceAuditChain(combined)||combined.at(-1)?.hash!==next.audit.at(-1)?.hash)throw new Error("audit conflict");this.ledgers.set(next.id,structuredClone(combined));this.sessions.set(next.id, structuredClone(next)); return structuredClone(next); }
  async list() { return [...this.sessions.values()].map((item) => structuredClone(item)); }
  async getAuditTrail(sessionId: string) { const events=structuredClone(this.ledgers.get(sessionId)??[]);return {events,integrity:{verified:events.length>0&&verifyCommerceAuditChain(events),source:"memory_ledger" as const,eventCount:events.length,firstEventAt:events[0]?.createdAt??null,lastEventAt:events.at(-1)?.createdAt??null,headHash:events.at(-1)?.hash??null,...(!events.length?{issue:"No ledger events were found."}:{})}}; }
  async getCatalog() { return structuredClone(this.catalog); }
  async setVariantStock(variantId: string, stock: number) { for (const product of this.catalog) { const variant = product.variants.find((item) => item.id === variantId); if (variant) variant.stock = stock; } }
  async restoreDemoInventory() { this.catalog = structuredClone(DEMO_CATALOG); }
  async saveAgentRun(_sessionId: string, result: AgentTurnResult) { this.cache.set(result.inputDigest, result); }
  async findAgentCache(inputDigest: string) { return this.cache.get(inputDigest) ?? null; }
  async saveCheckout(action: CheckoutAction) { this.checkouts.push(structuredClone(action)); }
  async applyWebhook(current: ShoppingSessionSnapshot, next: ShoppingSessionSnapshot, eventId: string, _eventType: string, _payloadDigest: string, auditEvent: ShoppingSessionSnapshot["audit"][number]): Promise<WebhookTransitionResult> { if (this.webhooks.has(eventId)) return { duplicate: true, session: current }; this.webhooks.add(eventId); const session=await this.replace(current,next,[auditEvent]); return { duplicate: false, session }; }
}

export async function completePhoneDiscovery(repository: MemoryCommerceRepository) {
  const { sendShoppingMessage } = await import("@/lib/commerce-service");
  let session = await repository.get(TEST_SESSION_ID);
  const answers = [["category","Phone"],["maxBudgetPaise","₹50,000"],["useCase","Photography"],["brandPreference","No preference"],["mustHaves","No deal-breakers"],["os","Android"],["size","Standard"]] as const;
  for (const [key,value] of answers) session = await sendShoppingMessage(TEST_SESSION_ID,{ text:value,answerKey:key,answerValue:value,expectedVersion:session.version,idempotencyKey:`msg:${key}:test` });
  return session;
}
