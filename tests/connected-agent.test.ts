import { describe, expect, it } from "vitest";
import { emptyPreferenceProfile } from "@/lib/commerce-policy";
import { understandShoppingMessage } from "@/lib/shopping-agent";

if (!process.env.GEMINI_API_KEY) process.loadEnvFile(".env.local");

describe.skipIf(!process.env.GEMINI_API_KEY)("connected Gemini extraction", () => {
  it("keeps connected-agent p95 inside eight seconds on a sealed ambiguous set", async () => {
    const messages = ["I am open to any manufacturer", "Any maker is fine by me", "The brand is immaterial to me", "I have no loyalty to a manufacturer", "Who made it does not matter"];
    const durations: number[] = [];
    for (const message of messages) {
      const profile = emptyPreferenceProfile(); profile.category = "phones"; profile.confirmedKeys.push("category");
      const result = await understandShoppingMessage({ profile, message, activeQuestionKey: "brandPreference" });
      expect(result.confirmedKeys).toContain("brandPreference");
      expect(result.profilePatch.brandPreference).toBe("No preference");
      expect(result.toolEvents.some((item) => item.name === "readDiscoveryContext")).toBe(true);
      durations.push(result.durationMs);
    }
    const p95 = durations.toSorted((a, b) => a - b)[Math.ceil(durations.length * 0.95) - 1]!;
    expect(p95).toBeLessThanOrEqual(8_000);
  }, 50_000);
});
