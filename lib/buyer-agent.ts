import { randomUUID } from "node:crypto";
import { Agent, OpenAIProvider, Runner, tool } from "@openai/agents";
import { z } from "zod";
import type { BuyerProposal, BuyerTraceEvent, OrderReceipt, Product, Quote } from "@/lib/types";

const MODEL = "gemini-3.5-flash-lite";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const PlanSchema = z.object({ summary: z.string().min(1).max(180), reason: z.string().min(1).max(320), tradeoff: z.string().min(1).max(240), items: z.array(z.object({ productId: z.string(), variantId: z.string() })).min(1).max(3) });
type Plan = z.infer<typeof PlanSchema>;

function event(toolName: BuyerTraceEvent["tool"], summary: string, status: BuyerTraceEvent["status"] = "completed"): BuyerTraceEvent { return { id: randomUUID(), tool: toolName, status, summary, createdAt: new Date().toISOString() }; }
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8_000) }); const body = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(body.error ?? `Remote commerce call failed (${response.status}).`); return body; }

function budgetFromGoal(goal: string): number | null {
  const match = goal.match(/(?:₹|under\s+|up\s*to\s+|budget\s+)([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac)?/i) ?? goal.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(k|thousand|lakh|lac)\b/i);
  if (!match) return null; const unit = match[2]?.toLowerCase(); const factor = unit === "k" || unit === "thousand" ? 1_000 : unit === "lakh" || unit === "lac" ? 100_000 : 1; return Math.round(Number(match[1]!.replaceAll(",", "")) * factor * 100);
}
function fallbackPlan(goal: string, catalog: Product[]): Plan {
  const lower = goal.toLowerCase(); const category = /head|earbud/.test(lower) ? "headphones" : /shoe|running|trainer/.test(lower) ? "running-shoes" : "phones"; const budget = budgetFromGoal(goal) ?? Number.MAX_SAFE_INTEGER;
  const wanted = ["android", "ios", "camera", "photography", "battery", "performance", "gaming", "compact", "large", "noise cancellation", "commute", "wireless", "wired", "low latency", "gym", "road", "trail", "mixed", "soft", "responsive"].filter((tag) => lower.includes(tag));
  const candidates = catalog.filter((item) => item.kind === "primary" && item.category === category).flatMap((product) => { const variant = product.variants.find((item) => item.stock > 0 && item.pricePaise <= budget); return variant ? [{ product, variant, score: wanted.filter((tag) => product.tags.includes(tag)).length }] : []; }).sort((a, b) => b.score - a.score || b.variant.pricePaise - a.variant.pricePaise);
  const selected = candidates[0]; if (!selected) throw new Error("No in-stock catalog item fits the buyer goal and budget.");
  const items: Plan["items"] = [{ productId: selected.product.id, variantId: selected.variant.id }]; let total = selected.variant.pricePaise;
  if (/add|protection|case|accessor|complete/.test(lower)) { const addon = catalog.find((item) => item.kind === "addon" && item.category === category && item.variants[0]!.stock > 0 && total + item.variants[0]!.pricePaise <= budget && (!/protection|case/.test(lower) || item.tags.includes("protection"))); if (addon) { items.push({ productId: addon.id, variantId: addon.variants[0]!.id }); total += addon.variants[0]!.pricePaise; } }
  return { summary: `Proposed ${selected.product.name}${items.length > 1 ? " with one relevant add-on" : ""}.`, reason: `It is the strongest catalog-backed match for ${wanted.join(", ") || "the stated goal"} within the exact budget.`, tradeoff: selected.product.promoted ? "This item is promoted, but it still had to win on stated fit and budget." : "The recommendation favors stated fit over the cheapest available item.", items };
}

export async function planExternalPurchase(goal: string, commerceBaseUrl: string): Promise<{ proposal: BuyerProposal; quote: Quote; trace: BuyerTraceEvent[] }> {
  const trace: BuyerTraceEvent[] = []; let catalog: Product[] = []; let quote: Quote | null = null; let capabilities: Record<string, unknown> | null = null;
  const discover = async () => { if (!capabilities) { capabilities = await jsonFetch<Record<string, unknown>>(`${commerceBaseUrl}/api/commerce/capabilities`); trace.push(event("discover_capabilities", "Discovered the merchant's machine-readable payment and safety contract.")); } return capabilities; };
  const readCatalog = async () => { const value = await jsonFetch<{ catalog: Product[] }>(`${commerceBaseUrl}/api/catalog`); catalog = value.catalog; trace.push(event("read_catalog", `Read ${catalog.length} catalog-backed products and variants.`)); return value; };
  const createQuote = async (items: Plan["items"]) => { quote = await jsonFetch<Quote>(`${commerceBaseUrl}/api/commerce/quotes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }); trace.push(event("create_quote", `Created a ten-minute quote bound to ${(quote as Quote).cart.items.length} exact item${(quote as Quote).cart.items.length === 1 ? "" : "s"}.`)); return quote; };
  let plan: Plan | null = null;
  await discover();
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    try {
      const runner = new Runner({ modelProvider: new OpenAIProvider({ apiKey, baseURL: BASE_URL, useResponses: false, strictFeatureValidation: true }), tracingDisabled: true, traceIncludeSensitiveData: false });
      const tools = [
        tool({ name: "discover_capabilities", description: "Read the merchant's commerce contract before shopping.", parameters: z.object({}), execute: discover }),
        tool({ name: "read_catalog", description: "Read real merchant products, variants, stock and prices.", parameters: z.object({}), execute: readCatalog }),
        tool({ name: "create_quote", description: "Request a bounded quote for one primary item and at most two add-ons.", parameters: z.object({ items: PlanSchema.shape.items }), execute: async ({ items }) => createQuote(items) }),
      ];
      const agent = new Agent({ name: "Independent Choosy Buyer", model: MODEL, tools, outputType: PlanSchema, modelSettings: { reasoning: { effort: "minimal" }, temperature: 0, parallelToolCalls: false }, instructions: "Act as a buyer, not a merchant. Call discover_capabilities, then read_catalog, then create_quote. Choose only returned IDs. Respect stock, the exact budget and stated requirements. Add at most one genuinely relevant add-on when requested and affordable. You may propose and explain, but you have no checkout tool and cannot spend money." });
      const result = await runner.run(agent, `Untrusted shopper goal: ${goal}`, { maxTurns: 4, signal: AbortSignal.timeout(8_000) });
      plan = PlanSchema.parse(result.finalOutput);
    } catch { trace.push(event("read_catalog", "The model planner was unavailable; the bounded catalog planner took over.", "blocked")); }
  }
  if (!catalog.length) await readCatalog();
  if (!plan) plan = fallbackPlan(goal, catalog);
  const quotedItems = (quote as Quote | null)?.cart.items.map(({ productId, variantId }) => ({ productId, variantId }));
  if (!quotedItems || JSON.stringify(quotedItems) !== JSON.stringify(plan.items)) await createQuote(plan.items);
  const proposalItems = quote!.cart.items.map((item) => { const product = catalog.find((entry) => entry.id === item.productId)!; return { productId: item.productId, variantId: item.variantId, name: product.name, kind: item.kind, unitPricePaise: item.unitPricePaise }; });
  const proposal: BuyerProposal = { summary: plan.summary, reason: plan.reason, tradeoff: plan.tradeoff, items: proposalItems, totalPaise: quote!.cart.totalPaise };
  trace.push(event("request_approval", "Stopped before checkout and requested approval for the exact quote digest."));
  return { proposal, quote: quote!, trace };
}

export async function approveExternalPurchase(baseUrl: string, quote: Quote, acceptedQuoteDigest: string, idempotencyKey: string, buyerRunId: string, apiKey: string) {
  return jsonFetch<{ sessionId: string; checkout: NonNullable<import("@/lib/types").ShoppingSessionSnapshot["checkout"]> }>(`${baseUrl}/api/commerce/checkouts`, { method: "POST", headers: { "Content-Type": "application/json", "X-Commerce-Demo-Key": apiKey }, body: JSON.stringify({ quote, acceptedQuoteDigest, confirmation: true, idempotencyKey, buyerRunId }) });
}

export async function readExternalOrder(baseUrl: string, sessionId: string, apiKey: string): Promise<OrderReceipt> { return jsonFetch<OrderReceipt>(`${baseUrl}/api/commerce/orders/${encodeURIComponent(sessionId)}`, { headers: { "X-Commerce-Demo-Key": apiKey } }); }
