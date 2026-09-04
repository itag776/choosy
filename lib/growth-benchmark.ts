import { createHash } from "node:crypto";
import { DEMO_CATALOG } from "@/lib/catalog";
import { rankProducts, recommendedAddons } from "@/lib/commerce-policy";
import type { GrowthBenchmarkMetrics, GrowthBenchmarkReport, PreferenceProfile, Product, ProductCategory } from "@/lib/types";

interface BenchmarkArchetype {
  id: string;
  profile: PreferenceProfile;
  requiredTags: string[];
  addonNeed: string | null;
}

const profiles: BenchmarkArchetype[] = [
  phone("photo-android", 50_000, "Photography", ["camera"], { os: "Android", priority: "Camera", size: "Standard" }, ["android", "camera"], "protection"),
  phone("gaming-battery", 70_000, "Gaming", ["Long battery"], { os: "Android", priority: "Performance", size: "Large" }, ["gaming", "battery"], "charging"),
  phone("compact-daily", 35_000, "Everyday", ["Compact"], { os: "Android", priority: "Balanced", size: "Compact" }, ["compact"], "protection"),
  phone("ios-camera", 70_000, "Photography", [], { os: "iOS", priority: "Camera", size: "Compact" }, ["ios", "camera"], "protection"),
  phone("budget-battery", 30_000, "Everyday", ["Long battery"], { os: "Android", priority: "Battery", size: "Standard" }, ["battery"], "charging"),
  phone("large-performance", 55_000, "Gaming", [], { os: "Android", priority: "Performance", size: "Large" }, ["performance", "large"], "charging"),
  headphones("commute-anc", 20_000, "Travel", ["Noise cancellation"], { formFactor: "Over-ear", environment: "Commute", feature: "Noise cancellation", connectivity: "Wireless" }, ["commute", "noise cancellation"], "protection"),
  headphones("gaming-low-latency", 12_000, "Gaming", ["Low latency"], { formFactor: "Earbuds", environment: "Gaming", feature: "Low latency", connectivity: "Wireless" }, ["gaming", "low latency"], "earbuds"),
  headphones("gym-earbuds", 8_000, "Fitness", [], { formFactor: "Earbuds", environment: "Gym", feature: "Call quality", connectivity: "Wireless" }, ["gym", "earbuds"], "earbuds"),
  headphones("office-calls", 10_000, "Work", [], { formFactor: "Over-ear", environment: "Office", feature: "Call quality", connectivity: "Wired" }, ["office", "call quality"], "protection"),
  headphones("travel-value", 15_000, "Travel", ["Noise cancellation"], { formFactor: "Over-ear", environment: "Commute", feature: "Noise cancellation", connectivity: "Wireless" }, ["noise cancellation"], "protection"),
  headphones("wired-gaming", 6_000, "Gaming", ["Low latency"], { formFactor: "Earbuds", environment: "Gaming", feature: "Low latency", connectivity: "Wired" }, ["wired", "low latency"], "earbuds"),
  headphones("premium-office", 18_000, "Work", [], { formFactor: "Over-ear", environment: "Office", feature: "Call quality", connectivity: "Wireless" }, ["office", "call quality"], "protection"),
  shoes("soft-road", 10_000, ["Soft cushioning"], { size: "UK 9", terrain: "Road", distance: "10 km+", cushioning: "Soft" }, ["road", "soft"], "road"),
  shoes("trail-distance", 9_000, [], { size: "UK 8", terrain: "Trail", distance: "10 km+", cushioning: "Balanced" }, ["trail", "10 km+"], "trail"),
  shoes("mixed-daily", 8_000, [], { size: "UK 10", terrain: "Mixed", distance: "5–10 km", cushioning: "Balanced" }, ["mixed"], "safety"),
  shoes("road-tempo", 10_000, [], { size: "UK 7", terrain: "Road", distance: "10 km+", cushioning: "Responsive" }, ["responsive", "10 km+"], "road"),
  shoes("short-soft", 6_000, ["Soft cushioning"], { size: "UK 9", terrain: "Road", distance: "Under 5 km", cushioning: "Soft" }, ["soft", "under 5 km"], "road"),
  shoes("balanced-5k", 7_000, [], { size: "UK 8", terrain: "Road", distance: "5–10 km", cushioning: "Balanced" }, ["road", "balanced"], "safety"),
  shoes("trail-balanced", 8_500, [], { size: "UK 10", terrain: "Trail", distance: "5–10 km", cushioning: "Balanced" }, ["trail", "balanced"], "trail"),
];

function complete(category: ProductCategory, budgetRupees: number, useCase: string, mustHaves: string[], answers: Record<string, string>): PreferenceProfile {
  return { category, maxBudgetPaise: budgetRupees * 100, useCase, brandPreference: "No preference", mustHaves, answers, confirmedKeys: ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves", ...Object.keys(answers)] };
}
function phone(id: string, budget: number, useCase: string, must: string[], answers: Record<string, string>, requiredTags: string[], addonNeed: string): BenchmarkArchetype { return { id, profile: complete("phones", budget, useCase, must, answers), requiredTags, addonNeed }; }
function headphones(id: string, budget: number, useCase: string, must: string[], answers: Record<string, string>, requiredTags: string[], addonNeed: string): BenchmarkArchetype { return { id, profile: complete("headphones", budget, useCase, must, answers), requiredTags, addonNeed }; }
function shoes(id: string, budget: number, must: string[], answers: Record<string, string>, requiredTags: string[], addonNeed: string): BenchmarkArchetype { return { id, profile: complete("running-shoes", budget, "Fitness", must, answers), requiredTags, addonNeed }; }

export const GROWTH_BENCHMARK_SCENARIOS = profiles.flatMap((scenario) => Array.from({ length: 5 }, (_, index) => ({ ...scenario, id: `${scenario.id}-${index + 1}` })));

function firstVariant(product: Product, profile: PreferenceProfile) {
  const requested = profile.answers.size;
  return product.variants.find((variant) => (!requested || variant.label === requested) && variant.stock > 0) ?? product.variants.find((variant) => variant.stock > 0);
}

function satisfies(product: Product | undefined, scenario: BenchmarkArchetype): boolean {
  if (!product || product.category !== scenario.profile.category) return false;
  const variant = firstVariant(product, scenario.profile);
  return Boolean(variant && variant.pricePaise <= scenario.profile.maxBudgetPaise! && scenario.requiredTags.every((tag) => product.tags.includes(tag) || variant.label.toLowerCase() === tag.toLowerCase()));
}

function finalize(completed: number, gmv: number, addons: number, violations: number, invalid: number): GrowthBenchmarkMetrics {
  return { completedPurchases: completed, simulatedGmvPaise: gmv, averageOrderValuePaise: completed ? Math.round(gmv / completed) : 0, relevantAddonAttachRate: completed ? addons / completed : 0, hardConstraintViolations: violations, invalidCheckoutAttempts: invalid };
}

function runArm(choosy: boolean): GrowthBenchmarkMetrics {
  let completed = 0; let gmv = 0; let addons = 0; let violations = 0; let invalid = 0;
  for (const scenario of GROWTH_BENCHMARK_SCENARIOS) {
    const primary = choosy
      ? DEMO_CATALOG.find((item) => item.id === rankProducts(scenario.profile, DEMO_CATALOG).recommendations[0]?.productId)
      : DEMO_CATALOG.find((item) => item.kind === "primary" && item.category === scenario.profile.category && Boolean(firstVariant(item, scenario.profile)) && firstVariant(item, scenario.profile)!.pricePaise <= scenario.profile.maxBudgetPaise!);
    if (!satisfies(primary, scenario)) { violations += 1; invalid += 1; continue; }
    const variant = firstVariant(primary!, scenario.profile)!;
    let total = variant.pricePaise;
    if (choosy && scenario.addonNeed) {
      const relevant = recommendedAddons(scenario.profile, primary!, DEMO_CATALOG).find((item) => item.tags.includes(scenario.addonNeed!));
      if (relevant && total + relevant.variants[0]!.pricePaise <= scenario.profile.maxBudgetPaise!) { total += relevant.variants[0]!.pricePaise; addons += 1; }
    }
    completed += 1; gmv += total;
  }
  return finalize(completed, gmv, addons, violations, invalid);
}

function percentDelta(current: number, baseline: number): number { return baseline ? Number((((current - baseline) / baseline) * 100).toFixed(1)) : 0; }

export function runGrowthBenchmark(now = new Date()): GrowthBenchmarkReport {
  const fixtureDigest = createHash("sha256").update(JSON.stringify(GROWTH_BENCHMARK_SCENARIOS)).digest("hex");
  const baseline = runArm(false); const choosy = runArm(true);
  const deltas = { completedPurchases: choosy.completedPurchases - baseline.completedPurchases, simulatedGmvPercent: percentDelta(choosy.simulatedGmvPaise, baseline.simulatedGmvPaise), averageOrderValuePercent: percentDelta(choosy.averageOrderValuePaise, baseline.averageOrderValuePaise), relevantAddonAttachPercentagePoints: Number(((choosy.relevantAddonAttachRate - baseline.relevantAddonAttachRate) * 100).toFixed(1)) };
  const gates = { atLeastTenPercentGmvUplift: deltas.simulatedGmvPercent >= 10, noPurchaseRegression: choosy.completedPurchases >= baseline.completedPurchases, zeroChoosyConstraintViolations: choosy.hardConstraintViolations === 0, passed: false };
  gates.passed = gates.atLeastTenPercentGmvUplift && gates.noPurchaseRegression && gates.zeroChoosyConstraintViolations;
  return { label: "Synthetic benchmark — not production conversion evidence", methodologyVersion: "choosy-growth-v1", fixtureDigest, generatedAt: now.toISOString(), datasetSize: GROWTH_BENCHMARK_SCENARIOS.length, baseline, choosy, deltas, gates };
}
