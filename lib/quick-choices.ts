import { CATEGORY_PROFILES, DEMO_CATALOG } from "@/lib/catalog";
import type { ProductCategory } from "@/lib/types";

const universalChoices: Record<string, string[]> = {
  category: ["Phone", "Headphones", "Running shoes"],
  maxBudgetPaise: ["₹5,000", "₹10,000", "₹25,000", "₹50,000", "₹70,000"],
  useCase: ["Everyday", "Work", "Travel", "Fitness", "Gaming", "Photography"],
  brandPreference: ["No preference"],
  mustHaves: ["No deal-breakers"],
};

const categoryChoices: Record<ProductCategory, Record<string, string[]>> = {
  phones: {
    useCase: ["Everyday", "Work", "Gaming", "Photography"],
    mustHaves: ["No deal-breakers", "Long battery", "Compact"],
  },
  headphones: {
    useCase: ["Everyday", "Work", "Travel", "Fitness", "Gaming"],
    mustHaves: ["No deal-breakers", "Noise cancellation", "Low latency"],
  },
  "running-shoes": {
    useCase: ["Everyday", "Fitness"],
    mustHaves: ["No deal-breakers", "Soft cushioning"],
  },
};

export function quickChoicesForQuestion(key: string | null, category: ProductCategory | null): string[] {
  if (!key) return [];

  const profileQuestion = category
    ? CATEGORY_PROFILES.find((profile) => profile.category === category)?.questions.find((question) => question.key === key)
    : undefined;
  if (profileQuestion) return profileQuestion.choices;

  if (key === "brandPreference" && category) {
    const brands = DEMO_CATALOG
      .filter((product) => product.category === category && product.kind === "primary")
      .map((product) => product.brand);
    return ["No preference", ...new Set(brands)];
  }

  return category ? categoryChoices[category][key] ?? universalChoices[key] ?? [] : universalChoices[key] ?? [];
}
