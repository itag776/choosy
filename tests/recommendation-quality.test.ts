import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "@/lib/catalog";
import { emptyPreferenceProfile, rankProducts } from "@/lib/commerce-policy";
import { GROWTH_BENCHMARK_SCENARIOS } from "@/lib/growth-benchmark";
import { extractDeterministicPreferences } from "@/lib/shopping-agent";
import type { PreferenceProfile } from "@/lib/types";

describe("recommendation quality", () => {
  it("uses a high budget as a product-tier signal instead of recommending entry-level products", () => {
    const profile: PreferenceProfile = {
      category: "phones",
      maxBudgetPaise: 150_000_00,
      useCase: "Everyday",
      brandPreference: "No preference",
      mustHaves: [],
      answers: { os: "No preference", priority: "Balanced", size: "No preference" },
      confirmedKeys: ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves", "os", "priority", "size"],
    };

    const { recommendations } = rankProducts(profile, DEMO_CATALOG);
    const topProduct = DEMO_CATALOG.find((item) => item.id === recommendations[0]?.productId)!;
    const topVariant = topProduct.variants.find((item) => item.id === recommendations[0]?.variantId)!;

    expect(["premium", "flagship"]).toContain(topProduct.attributes.segment);
    expect(topVariant.pricePaise).toBeGreaterThanOrEqual(profile.maxBudgetPaise! * 0.4);
    expect(new Set(recommendations.map((item) => item.fitScore)).size).toBeGreaterThan(1);
  });

  it("understands common Indian lakh shorthand", () => {
    const result = extractDeterministicPreferences(emptyPreferenceProfile(), "I need a phone under 1.5L");
    expect(result.profile.maxBudgetPaise).toBe(150_000_00);
  });

  it("accepts a plain amount when the chatbot is asking for a budget", () => {
    const result = extractDeterministicPreferences(emptyPreferenceProfile(), "150000", "maxBudgetPaise");
    expect(result.profile.maxBudgetPaise).toBe(150_000_00);
  });

  it("keeps every stated hard requirement in the top recommendation", () => {
    const failures = GROWTH_BENCHMARK_SCENARIOS
      .filter((scenario) => scenario.id.endsWith("-1"))
      .flatMap((scenario) => {
        const top = rankProducts(scenario.profile, DEMO_CATALOG).recommendations[0];
        const product = DEMO_CATALOG.find((item) => item.id === top?.productId);
        const missing = scenario.requiredTags.filter((tag) => !product?.tags.includes(tag) && !product?.variants.some((variant) => variant.label.toLowerCase() === tag.toLowerCase()));
        return missing.length ? [{ scenario: scenario.id, product: product?.name, missing }] : [];
      });
    expect(failures).toEqual([]);
  });
});
