import { createHash, randomUUID } from "node:crypto";
import { categoryProfile, CATALOG_VERSION } from "@/lib/catalog";
import type { Cart, CartItem, PreferenceProfile, Product, ProductCategory, ProductVariant, QuestionDefinition, Quote, Recommendation, RankResult } from "@/lib/types";

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
  { key: "maxBudgetPaise", prompt: "What’s your maximum budget?", choices: ["₹5,000", "₹10,000", "₹25,000", "₹50,000", "₹70,000", "₹1,00,000", "₹1,50,000"], required: true, weight: 20, scope: "universal" },
  { key: "useCase", prompt: "What will you use it for most?", choices: ["Everyday", "Work", "Travel", "Fitness", "Gaming", "Photography"], required: true, weight: 18, scope: "universal" },
  { key: "brandPreference", prompt: "Do you have a preferred brand?", choices: ["No preference", "iQOO", "OnePlus", "Nothing", "Google", "Apple", "Samsung", "Xiaomi", "Poco", "Realme", "Vivo", "Motorola", "JBL", "Sony", "boAt", "Bose", "Sennheiser", "KIPRUN", "Nike", "adidas", "Skechers", "Puma", "ASICS", "New Balance", "Brooks", "Hoka", "Salomon"], required: true, weight: 10, scope: "universal" },
  { key: "mustHaves", prompt: "Any features you definitely need?", choices: ["No deal-breakers", "Long battery", "Noise cancellation", "Low latency", "Soft cushioning", "Compact"], required: true, weight: 20, scope: "universal" },
];

const runningShoeUseCaseQuestion: NextQuestion = {
  key: "useCase",
  prompt: "What should these shoes be best at?",
  choices: ["Daily training", "Long runs", "Speed / race day", "Walking / casual"],
  required: true,
  weight: 24,
  scope: "universal",
};

export function allQuestions(profile: PreferenceProfile): NextQuestion[] {
  if (!profile.category) return universalQuestions;
  const categoryQuestions = categoryProfile(profile.category).questions.map((question) => ({ ...question, scope: "category" as const }));
  if (profile.category === "running-shoes") {
    const universalByKey = new Map(universalQuestions.map((question) => [question.key, question]));
    return [
      universalByKey.get("category")!,
      universalByKey.get("maxBudgetPaise")!,
      runningShoeUseCaseQuestion,
      ...categoryQuestions,
      universalByKey.get("brandPreference")!,
    ];
  }
  return [...universalQuestions, ...categoryQuestions];
}

const coveredAnswers: Partial<Record<ProductCategory, Record<string, Record<string, string>>>> = {
  phones: {
    os: {
      apple: "iOS",
      iqoo: "Android",
      oneplus: "Android",
      nothing: "Android",
      google: "Android",
      samsung: "Android",
      xiaomi: "Android",
      poco: "Android",
      realme: "Android",
      vivo: "Android",
      motorola: "Android",
    },
    priority: {
      photography: "Camera",
      camera: "Camera",
      gaming: "Performance",
      "long battery": "Battery",
      battery: "Battery",
    },
    size: { compact: "Compact" },
  },
  headphones: {
    environment: {
      travel: "Commute",
      commute: "Commute",
      work: "Office",
      office: "Office",
      fitness: "Gym",
      gym: "Gym",
      gaming: "Gaming",
    },
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
  if (profile.category === "phones" && !next.confirmedKeys.includes("brandPreference") && normalized(profile.answers.os ?? "") === "ios") {
    next.brandPreference = "Apple";
    next.confirmedKeys.push("brandPreference");
  }
  const supplied = [profile.brandPreference, profile.useCase, ...profile.mustHaves].filter((value): value is string => Boolean(value)).map(normalized);
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

function isNeutralPreference(value: string): boolean {
  return ["no preference", "either", "no deal-breakers", "none", "not sure"].includes(normalized(value));
}

function tagMatches(tags: string[], value: string): boolean {
  const target = normalized(value);
  if (isNeutralPreference(target)) return true;
  return tags.some((tag) => normalized(tag).includes(target) || target.includes(normalized(tag)));
}

const runningShoeUseCaseTags: Record<string, string[]> = {
  "daily training": ["everyday", "5-10 km", "balanced"],
  fitness: ["everyday", "5-10 km", "10 km+", "performance"],
  "long runs": ["10 km+"],
  "speed / race day": ["race", "performance"],
  "walking / casual": ["walking / casual"],
};

function preferenceMatches(product: Product, profile: PreferenceProfile, key: string, value: string): boolean {
  if (profile.category === "running-shoes" && key === "useCase") {
    const aliases = runningShoeUseCaseTags[normalized(value)];
    return aliases?.some((alias) => tagMatches(product.tags, alias)) ?? tagMatches(product.tags, value);
  }
  return tagMatches(product.tags, value);
}

function satisfiesRunningShoeFit(product: Product, profile: PreferenceProfile): boolean {
  if (profile.category !== "running-shoes") return true;
  const terrain = normalized(profile.answers.terrain ?? "");
  if (terrain === "road" && !tagMatches(product.tags, "road")) return false;
  if (terrain === "trail" && !tagMatches(product.tags, "trail")) return false;
  if (terrain === "mixed" && !tagMatches(product.tags, "mixed")) return false;
  const support = normalized(profile.answers.support ?? "");
  if (support === "neutral" && !tagMatches(product.tags, "neutral")) return false;
  if (support === "extra stability" && !tagMatches(product.tags, "extra stability")) return false;
  return true;
}

function chooseVariant(product: Product, profile: PreferenceProfile): ProductVariant | null {
  const requestedSize = profile.answers.size;
  const hasSpecificVariant = requestedSize && /^uk\s+\d+(?:\.5)?$/i.test(requestedSize);
  const matching = requestedSize ? product.variants.find((item) => normalized(item.label) === normalized(requestedSize) && item.stock > 0) : undefined;
  if (hasSpecificVariant) return matching ?? null;
  return matching ?? product.variants.find((item) => item.stock > 0) ?? null;
}

const exclusiveAnswerKeys = ["os", "formFactor", "connectivity"] as const;

function satisfiesExclusiveAnswers(product: Product, profile: PreferenceProfile): boolean {
  return exclusiveAnswerKeys.every((key) => {
    const answer = profile.answers[key];
    return !answer || isNeutralPreference(answer) || tagMatches(product.tags, answer);
  });
}

interface ScoredProduct { product: Product; variant: ProductVariant; score: number; rankingScore: number; valueScore: number; matched: string[]; }

function budgetTierScore(pricePaise: number, maxBudgetPaise: number): number {
  const ratio = pricePaise / maxBudgetPaise;
  // A maximum budget is still a quality signal. The strongest overall match
  // should normally sit in the useful middle-to-upper part of the range,
  // without forcing the shopper to spend the entire ceiling.
  return Math.max(0, Math.round(18 - Math.abs(ratio - 0.72) * 28));
}

function valueTierScore(pricePaise: number, maxBudgetPaise: number): number {
  const ratio = pricePaise / maxBudgetPaise;
  return Math.max(0, Math.round(18 - Math.abs(ratio - 0.35) * 30));
}

export function rankProducts(profile: PreferenceProfile, catalog: Product[]): RankResult {
  if (!isProfileComplete(profile) || !profile.category || !profile.maxBudgetPaise) return { recommendations: [], brandFallback: false };
  const categoryWeights = new Map(categoryProfile(profile.category).questions.map((item) => [item.key, item.weight]));
  const mustHaves = profile.mustHaves.filter((item) => !["none", "no deal-breakers"].includes(normalized(item)));
  const hasBrandPreference = Boolean(profile.brandPreference && normalized(profile.brandPreference) !== "no preference");

  const scoreProducts = (candidates: Product[]): ScoredProduct[] => candidates.filter((product) => product.kind === "primary" && product.category === profile.category && satisfiesExclusiveAnswers(product, profile) && satisfiesRunningShoeFit(product, profile)).flatMap((product) => {
    const variant = chooseVariant(product, profile);
    if (!variant || variant.pricePaise > profile.maxBudgetPaise!) return [];
    if (mustHaves.some((need) => !tagMatches(product.tags, need))) return [];
    const matched: string[] = [];
    let score = 25;
    if (profile.useCase && !isNeutralPreference(profile.useCase) && preferenceMatches(product, profile, "useCase", profile.useCase)) { score += profile.category === "running-shoes" ? 24 : 18; matched.push(profile.useCase); }
    if (hasBrandPreference && normalized(product.brand) === normalized(profile.brandPreference!)) { score += 10; matched.push(`${product.brand} preference`); }
    for (const [key, value] of Object.entries(profile.answers)) {
      if (isNeutralPreference(value)) continue;
      if (preferenceMatches(product, profile, key, value) || normalized(variant.label) === normalized(value)) { score += categoryWeights.get(key) ?? 8; matched.push(value); }
    }
    if (mustHaves.length) { score += 20; matched.push(...mustHaves); }
    const tierScore = budgetTierScore(variant.pricePaise, profile.maxBudgetPaise!);
    // Preference matches dominate. Budget tier only breaks ties between
    // products that satisfy the shopper equally well.
    const rankingScore = score * 100 + tierScore;
    const valueScore = score * 100 + valueTierScore(variant.pricePaise, profile.maxBudgetPaise!);
    return [{ product, variant, score: Math.min(100, score + tierScore), rankingScore, valueScore, matched: [...new Set(matched)].slice(0, 4) }];
  });

  // When a specific brand is selected, only consider that brand's products.
  // Fall back to all brands if no products from the preferred brand pass filters.
  let scored: ScoredProduct[];
  let brandFallback = false;
  if (hasBrandPreference) {
    const brandOnly = catalog.filter((product) => normalized(product.brand) === normalized(profile.brandPreference!));
    scored = scoreProducts(brandOnly);
    if (!scored.length) {
      scored = scoreProducts(catalog);
      brandFallback = scored.length > 0;
    }
  } else {
    scored = scoreProducts(catalog);
  }

  scored.sort((a, b) => {
    const gap = b.rankingScore - a.rankingScore;
    if (gap === 0 && a.product.promoted !== b.product.promoted) return a.product.promoted ? -1 : 1;
    return gap || b.variant.pricePaise - a.variant.pricePaise;
  });
  if (!scored.length) return { recommendations: [], brandFallback: false };
  const best = scored[0]!;
  const remaining = scored.slice(1);
  const shoeValueCandidates = remaining.filter((item) => item.score >= best.score - 12);
  const value = profile.category === "running-shoes"
    ? [...(shoeValueCandidates.length ? shoeValueCandidates : remaining)].sort((a, b) => a.variant.pricePaise - b.variant.pricePaise || b.score - a.score)[0]
    : [...remaining].sort((a, b) => b.valueScore - a.valueScore || b.score - a.score)[0];
  const alternative = remaining.find((item) => item !== value);
  const selected = [best, value, alternative].filter((item): item is ScoredProduct => Boolean(item));
  const labels: Recommendation["label"][] = ["Best fit", "Best value", "Best alternative"];
  const recommendations = selected.map((item, index) => ({
    productId: item.product.id, variantId: item.variant.id, label: labels[index]!, fitScore: item.score,
    matchedNeeds: item.matched.length ? item.matched : ["Within budget", "Available now"],
    tradeoff: index === 0
      ? profile.category === "running-shoes"
        ? "Best overall fit for your surface, support need and preferred ride."
        : "Prioritizes your strongest preferences without using the full budget by default."
      : index === 1
        ? `Leaves ₹${Math.round((profile.maxBudgetPaise! - item.variant.pricePaise) / 100).toLocaleString("en-IN")} in your budget while keeping a strong match.`
        : profile.category === "running-shoes"
          ? "A different training feel that still matches your surface and support needs."
          : "Offers a different balance of price and preferences.",
    reason: profile.category === "running-shoes"
      ? `${item.product.name} matches your ${profile.answers.terrain?.toLowerCase() ?? "running"} use, ${profile.useCase?.toLowerCase() ?? "training goal"}, and ${profile.answers.cushioning?.toLowerCase() ?? "preferred"} ride in ${item.variant.label}.`
      : `${item.product.name} matches ${item.matched.slice(0, 2).join(" and ") || "your budget and core use"}.`,
    promotionInfluencedTie: item.product.promoted && best.rankingScore === item.rankingScore,
  }));
  return { recommendations, brandFallback };
}

export interface NoMatchRecovery { key: string | null; prompt: string; }

/** Finds the smallest confirmed constraint whose relaxation restores results. */
export function noMatchRecovery(profile: PreferenceProfile, catalog: Product[], excludedKeys: ReadonlySet<string> = new Set()): NoMatchRecovery {
  const hasResults = (candidate: PreferenceProfile) => rankProducts(candidate, catalog).recommendations.length > 0;
  if (!excludedKeys.has("maxBudgetPaise") && profile.maxBudgetPaise && profile.maxBudgetPaise < 50_000_000) {
    const relaxed = structuredClone(profile);
    relaxed.maxBudgetPaise = 50_000_000;
    if (hasResults(relaxed)) return { key: "maxBudgetPaise", prompt: "I couldn’t find an exact match within that budget. What’s the highest amount you’d be comfortable with?" };
  }
  if (!excludedKeys.has("mustHaves") && profile.mustHaves.length) {
    const relaxed = structuredClone(profile);
    relaxed.mustHaves = [];
    if (hasResults(relaxed)) return { key: "mustHaves", prompt: "Your non-negotiables rule out every current option. Which requirement could you relax, or choose “No deal-breakers”?" };
  }
  if (profile.category === "running-shoes") {
    const shoeRelaxations = [
      { key: "support", neutralValue: "Not sure", prompt: "That support choice conflicts with your other shoe needs. Do neutral shoes work, or should I keep looking for extra stability?" },
      { key: "terrain", neutralValue: null, prompt: "I don’t have a shoe that combines that surface with your other needs. Which surface should I prioritise instead?" },
      { key: "cushioning", neutralValue: "No preference", prompt: "That ride feel rules out the remaining shoes. Which cushioning feel could you also consider?" },
    ] as const;
    for (const { key, neutralValue, prompt } of shoeRelaxations) {
      if (excludedKeys.has(key)) continue;
      const answer = profile.answers[key];
      if (!answer || isNeutralPreference(answer)) continue;
      const relaxed = structuredClone(profile);
      if (neutralValue) relaxed.answers[key] = neutralValue;
      else delete relaxed.answers[key];
      if (hasResults(relaxed)) return { key, prompt };
    }
  }
  for (const key of exclusiveAnswerKeys) {
    if (excludedKeys.has(key)) continue;
    const answer = profile.answers[key];
    if (!answer || isNeutralPreference(answer)) continue;
    const relaxed = structuredClone(profile);
    relaxed.answers[key] = key === "connectivity" ? "Either" : "No preference";
    if (hasResults(relaxed)) {
      const question = allQuestions(profile).find((item) => item.key === key);
      return { key, prompt: `Your ${answer} choice rules out every current option. ${question?.prompt ?? "What would you like to change?"}` };
    }
  }
  if (!excludedKeys.has("size") && profile.category === "running-shoes" && profile.answers.size) {
    const relaxed = structuredClone(profile);
    delete relaxed.answers.size;
    if (hasResults(relaxed)) return { key: "size", prompt: `I don’t have an in-stock match in ${profile.answers.size}. What other size should I check?` };
  }
  return {
    key: null,
    prompt: "I don’t have an exact match for that combination, and we’ve already checked the preferences most likely to unblock it. Start a new search, or tell me which preference you want to change.",
  };
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
