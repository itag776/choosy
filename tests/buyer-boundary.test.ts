import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CATALOG } from "@/lib/catalog";
import { approveExternalPurchase, planExternalPurchase } from "@/lib/buyer-agent";
import { buildCart, createQuote } from "@/lib/commerce-policy";

describe("external buyer boundary", () => {
  afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
  it("does not import internal catalog, policy, repository, or commerce service", async () => {
    const source = await readFile(new URL("../lib/buyer-agent.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/@\/lib\/(catalog|commerce-policy|repository|commerce-service)/);
    expect(source).not.toContain("createMachineCheckout");
  });

  it("stops at an exact quote and exposes no checkout tool", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const product = DEMO_CATALOG.find((item) => item.sku === "PH-GO-P9A")!; const addon = DEMO_CATALOG.find((item) => item.sku === "AC-P2")!;
    const quote = createQuote(buildCart(product, product.variants[0]!, [addon]), new Date("2026-09-03T00:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => { const url=String(input); if(url.endsWith("/api/catalog"))return new Response(JSON.stringify({catalog:DEMO_CATALOG}),{status:200});if(url.endsWith("/api/commerce/quotes"))return new Response(JSON.stringify(quote),{status:201});return new Response(JSON.stringify({name:"Choosy"}),{status:200}); }));
    const result = await planExternalPurchase("Buy the best Android camera phone under ₹50,000 and add protection", "https://merchant.example");
    expect(result.proposal.items.map((item)=>item.name)).toEqual(["Google Pixel 9a","Everyday protective case"]);
    expect(result.trace[0]?.tool).toBe("discover_capabilities");
    expect(result.trace.at(-1)?.tool).toBe("request_approval");
    expect(result.trace.some((item)=>item.tool==="create_checkout")).toBe(false);
  });

  it("sends server authority only after digest-bound approval", async () => {
    const product = DEMO_CATALOG[0]!;
    const quote = createQuote(buildCart(product, product.variants[0]!, []));
    const mocked = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ sessionId: "shop_aaaaaaaaaaaaaaaaaaaaaaaa", checkout: { status: "created" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", mocked);
    await approveExternalPurchase("https://merchant.example", quote, quote.digest, "buyer:stable:checkout", "buyer_run", "server-secret");
    const init = mocked.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-Commerce-Demo-Key")).toBe("server-secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ confirmation: true, acceptedQuoteDigest: quote.digest, idempotencyKey: "buyer:stable:checkout", buyerRunId: "buyer_run" });
  });

  it("keeps the commerce API key out of the client module", async () => {
    const source = await readFile(new URL("../app/agent-buyer/agent-buyer.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("COMMERCE_AGENT_API_KEY");
    expect(source).not.toContain("X-Commerce-Demo-Key");
    expect(source).not.toContain("process.env");
  });
});
