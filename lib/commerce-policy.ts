import { createHash, randomUUID } from "node:crypto";
import { categoryProfile, CATALOG_VERSION } from "@/lib/catalog";
import type { Cart, CartItem, PreferenceProfile, Product, ProductCategory, ProductVariant, QuestionDefinition, Quote, Recommendation } from "@/lib/types";

export interface NextQuestion extends QuestionDefinition { scope: "universal" | "category"; }

export const GROWTH_POLICY = {
  objective: "shopper_fit_then_basket_value",
  promotionTieThreshold: 5,
  maximumAddons: 2,
  requiresExplicitConfirmation: true,
  exactBudgetBoundary: true,
} as const;

export const QUOTE_TTL_MS = 10 * 60_000;

export function emptyPreferenceProfile(): PreferenceProfile {
  return { category: null, maxBudgetPaise: null, useCase: null, brandPreference: null, mustHaves: [], answers: {}, confirmedKeys: [] };
}

const universalQuestions: NextQuestion[] = [
  { key: "category", prompt: "What are you shopping for?", choices: ["Phone", "Headphones", "Running shoes"], required: true, weight: 0, scope: "universal" },
  { key: "maxBudgetPaise", prompt: "What’s your maximum budget?", choices: ["₹5,000", "₹10,000", "₹25,000", "₹50,000", "₹70,000", "₹1,00,000"], required: true, weight: 20, scope: "universal" },
  { key: "useCase", prompt: "What will you use it for most?", choices: ["Everyday", "Work", "Travel", "Fitness", "Gaming", "Photography"], required: true, weight: 18, scope: "universal" },
  { key: "brandPreference", prompt: "Do you have a preferred brand?", choices: ["No preference", "iQOO", "OnePlus", "Nothing", "Google", "Apple", "JBL", "Sony", "KIPRUN", "Nike", "adidas"], required: true, weight: 10, scope: "universal" },
  { key: "mustHaves", prompt: "Anything you definitely need—or want to avoid?", choices: ["No deal-breakers", "Long battery", "Noise cancellation", "Low latency", "Soft cushioning", "Compact"], required: true, weight: 20, scope: "universal" },
];

export function allQuestions(profile: PreferenceProfile): NextQuestion[] {
  if (!profile.category) return universalQuestions;
  return [...universalQuestions, ...categoryProfile(profile.category).questions.map((question) => ({ ...question, scope: "category" as const }))];
}

const coveredAnswers: Partial<Record<ProductCategory, Record<string, Record<string, string>>>> = {
  phones: {
    priority: {
      photography: "Camera",
      camera: "Camera",
      "long battery": "Battery",
      battery: "Battery",
    },
    size: { compact: "Compact" },
  },
  headphones: {
    environment: { gaming: "Gaming" },
    feature: {
      "noise cancellation": "Noise cancellation",
      "low latency": "Low latency",
      "call quality": "Call quality",
    },
  },
  "running-shoes": {
    cushioning: { "soft cushioning": "Soft" },
  },
};

/**
 * Records category answers that the shopper has already supplied through an
 * equivalent universal preference. This keeps the completeness gate strict
 * without asking the same thing twice in slightly different words.
 */
export function resolveCoveredQuestions(profile: PreferenceProfile): PreferenceProfile {
  if (!profile.category) return profile;
  const mappings = coveredAnswers[profile.category];
  if (!mappings) return profile;

  const next = structuredClone(profile);
  const supplied = [profile.useCase, ...profile.mustHaves].filter((value): value is string => Boolean(value)).map(normalized);
  for (const [key, aliases] of Object.entries(mappings)) {
    if (next.confirmedKeys.includes(key)) continue;
    const answer = supplied.map((value) => aliases[value]).find(Boolean);
    if (!answer) continue;
    next.answers[key] = answer;
    next.confirmedKeys.push(key);
  }
  return next;
}

export function nextQuestion(profile: PreferenceProfile): NextQuestion | null {
  return allQuestions(profile).find((question) => !profile.confirmedKeys.includes(question.key)) ?? null;
}

export function isProfileComplete(profile: PreferenceProfile): boolean {
  return Boolean(profile.category && profile.maxBudgetPaise && profile.maxBudgetPaise > 0 && profile.useCase && profile.brandPreference && nextQuestion(profile) === null);
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

function tagMatches(tags: string[], value: string): boolean {
  const target = normalized(value);
  if (["no preference", "either", "balanced", "no deal-breakers", "none"].includes(target)) return true;
  return tags.some((tag) => normalized(tag).includes(target) || target.includes(normalized(tag)));
}

function chooseVariant(product: Product, profile: PreferenceProfile): ProductVariant | null {
  const requestedSize = profile.answers.size;
  const matching = requestedSize ? product.variants.find((item) => normalized(item.label) === normalized(requestedSize) && item.stock > 0) : undefined;
  return matching ?? product.variants.find((item) => item.stock > 0) ?? null;
}

interface ScoredProduct { product: Product; variant: ProductVariant; score: number; valueScore: number; matched: string[]; }

export function rankProducts(profile: PreferenceProfile, catalog: Product[]): Recommendation[] {
  if (!isProfileComplete(profile) || !profile.category || !profile.maxBudgetPaise) return [];
  const categoryWeights = new Map(categoryProfile(profile.category).questions.map((item) => [item.key, item.weight]));
  const mustHaves = profile.mustHaves.filter((item) => !["none", "no deal-breakers"].includes(normalized(item)));
  const scored: ScoredProduct[] = catalog.filter((product) => product.kind === "primary" && product.category === profile.category).flatMap((product) => {
    const variant = chooseVariant(product, profile);
    if (!variant || variant.pricePaise > profile.maxBudgetPaise!) return [];
    if (mustHaves.some((need) => !tagMatches(product.tags, need))) return [];
    const matched: string[] = [];
    let score = 25;
    if (profile.useCase && tagMatches(product.tags, profile.useCase)) { score += 18; matched.push(profile.useCase); }
    if (profile.brandPreference && normalized(profile.brandPreference) !== "no preference" && normalized(product.brand) === normalized(profile.brandPreference)) { score += 10; matched.push(`${product.brand} preference`); }
    for (const [key, value] of Object.entries(profile.answers)) {
      if (tagMatches(product.tags, value) || normalized(variant.label) === normalized(value)) { score += categoryWeights.get(key) ?? 8; matched.push(value); }
    }
    if (mustHaves.length) { score += 20; matched.push(...mustHaves); }
    const valueScore = Math.round((1 - variant.pricePaise / profile.maxBudgetPaise!) * 25 + score);
    return [{ product, variant, score: Math.min(100, score), valueScore, matched: [...new Set(matched)].slice(0, 4) }];
  });
  scored.sort((a, b) => {
    const gap = b.score - a.score;
    if (Math.abs(gap) <= GROWTH_POLICY.promotionTieThreshold && a.product.promoted !== b.product.promoted) return a.product.promoted ? -1 : 1;
    return gap || a.variant.pricePaise - b.variant.pricePaise;
  });
  if (!scored.length) return [];
  const best = scored[0]!;
  const remaining = scored.slice(1);
  const value = [...remaining].sort((a, b) => b.valueScore - a.valueScore || b.score - a.score)[0];
  const alternative = remaining.find((item) => item !== value);
  const selected = [best, value, alternative].filter((item): item is ScoredProduct => Boolean(item));
  const labels: Recommendation["label"][] = ["Best fit", "Best value", "Alternative"];
  return selected.map((item, index) => ({
    productId: item.product.id, variantId: item.variant.id, label: labels[index]!, fitScore: item.score,
    matchedNeeds: item.matched.length ? item.matched : ["Within budget", "Available now"],
    tradeoff: item.score >= 75 ? "Costs more than the lowest-priced match." : "Trades one preference for stronger overall value.",
    reason: `${item.product.name} matches ${item.matched.slice(0, 2).join(" and ") || "your budget and core use"}.`,
    promotionInfluencedTie: item.product.promoted && Math.abs(best.score - item.score) <= GROWTH_POLICY.promotionTieThreshold,
  }));
}

export function recommendedAddons(profile: PreferenceProfile, primary: Product, catalog: Product[]): Product[] {
  if (!profile.maxBudgetPaise) return [];
  const primaryVariant = chooseVariant(primary, profile);
  if (!primaryVariant) return [];
  const remaining = profile.maxBudgetPaise - primaryVariant.pricePaise;
  return catalog.filter((item) => item.kind === "addon" && item.category === primary.category && item.variants.some((variant) => variant.stock > 0 && variant.pricePaise <= remaining)).sort((a, b) => {
    const aMatch = a.tags.filter((tag) => primary.tags.includes(tag)).length;
    const bMatch = b.tags.filter((tag) => primary.tags.includes(tag)).length;
    return bMatch - aMatch || a.variants[0]!.pricePaise - b.variants[0]!.pricePaise;
  }).slice(0, GROWTH_POLICY.maximumAddons);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function cartDigest(items: CartItem[]): string {
  return createHash("sha256").update(stableJson(items)).digest("hex");
}

export function buildCart(primary: Product, primaryVariant: ProductVariant, addons: Product[]): Cart {
  const items: CartItem[] = [
    { productId: primary.id, variantId: primaryVariant.id, quantity: 1, unitPricePaise: primaryVariant.pricePaise, kind: "primary" },
    ...addons.slice(0, 2).map((product): CartItem => ({ productId: product.id, variantId: product.variants[0]!.id, quantity: 1, unitPricePaise: product.variants[0]!.pricePaise, kind: "addon" })),
  ];
  return { id: `cart_${randomUUID().replaceAll("-", "").slice(0, 20)}`, items, totalPaise: items.reduce((sum, item) => sum + item.unitPricePaise, 0), digest: cartDigest(items) };
}

export function validateCart(cart: Cart, catalog: Product[]): { valid: boolean; unavailable: string[]; changed: string[]; currentTotalPaise: number } {
  const unavailable: string[] = [];
  const changed: string[] = [];
  let currentTotalPaise = 0;
  const primaryProduct = catalog.find((entry) => entry.id === cart.items.find((item) => item.kind === "primary")?.productId);
  for (const item of cart.items) {
    const product = catalog.find((entry) => entry.id === item.productId);
    const variant = product?.variants.find((entry) => entry.id === item.variantId);
    if (!product || !variant || variant.stock < item.quantity) { unavailable.push(item.productId); continue; }
    if (item.kind !== product.kind || item.quantity !== 1) changed.push(`${item.productId}_shape`);
    if (item.kind === "addon" && primaryProduct && product.category !== primaryProduct.category) changed.push(`${item.productId}_category`);
    currentTotalPaise += variant.pricePaise;
    if (variant.pricePaise !== item.unitPricePaise) changed.push(item.productId);
  }
  const structurallyValid = cart.items.length >= 1 && cart.items.length <= 3 && cart.items.filter((item) => item.kind === "primary").length === 1 && cart.items.filter((item) => item.kind === "addon").length <= 2;
  const digestValid = cart.digest === cartDigest(cart.items);
  const totalValid = cart.totalPaise === currentTotalPaise;
  if (!digestValid) changed.push("cart_digest");
  if (!totalValid) changed.push("cart_total");
  return { valid: structurallyValid && unavailable.length === 0 && changed.length === 0, unavailable, changed, currentTotalPaise };
}

export function createQuote(cart: Cart, now = new Date()): Quote {
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
  const digest = quoteDigest(cart.digest, CATALOG_VERSION, expiresAt);
  return { id: `quote_${digest.slice(0, 20)}`, cart, catalogVersion: CATALOG_VERSION, expiresAt, digest };
}

export function quoteDigest(cartDigestValue: string, catalogVersion: string, expiresAt: string): string {
  return createHash("sha256").update(stableJson({ cartDigest: cartDigestValue, catalogVersion, expiresAt })).digest("hex");
}
