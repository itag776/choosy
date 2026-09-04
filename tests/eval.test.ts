import { describe, expect, it } from "vitest";
import { DEMO_CATALOG } from "@/lib/catalog";
import { isProfileComplete, rankProducts } from "@/lib/commerce-policy";
import type { PreferenceProfile } from "@/lib/types";

const cases: PreferenceProfile[]=[
  {category:"phones",maxBudgetPaise:50_000_00,useCase:"Photography",brandPreference:"No preference",mustHaves:["camera"],answers:{os:"Android",priority:"Camera",size:"Standard"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]},
  {category:"headphones",maxBudgetPaise:15_000_00,useCase:"Travel",brandPreference:"No preference",mustHaves:["noise cancellation"],answers:{formFactor:"Over-ear",environment:"Commute",feature:"Noise cancellation",connectivity:"Wireless"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","formFactor","environment","feature","connectivity"]},
  {category:"running-shoes",maxBudgetPaise:9_000_00,useCase:"Daily training",brandPreference:"No preference",mustHaves:[],answers:{size:"UK 9",terrain:"Road",support:"Neutral",cushioning:"Soft"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","size","terrain","support","cushioning"]},
];

describe("Choosy release gates",()=>{
  it("blocks every incomplete scenario",()=>{ for(const complete of cases){const partial={...complete,confirmedKeys:complete.confirmedKeys.filter((key)=>key!=="brandPreference")};expect(isProfileComplete(partial)).toBe(false);expect(rankProducts(partial,DEMO_CATALOG)).toEqual({recommendations:[],brandFallback:false});} });
  it("keeps every recommendation in catalog, in stock, and within budget",()=>{ for(const profile of cases){const {recommendations:results}=rankProducts(profile,DEMO_CATALOG);expect(results.length).toBeGreaterThan(0);for(const result of results){const product=DEMO_CATALOG.find((item)=>item.id===result.productId);expect(product).toBeDefined();const variant=product!.variants.find((item)=>item.id===result.variantId);expect(variant?.stock).toBeGreaterThan(0);expect(variant!.pricePaise).toBeLessThanOrEqual(profile.maxBudgetPaise!);}} });
  it("never returns an unavailable variant",()=>{const catalog=structuredClone(DEMO_CATALOG);for(const product of catalog)for(const variant of product.variants)variant.stock=0;for(const profile of cases)expect(rankProducts(profile,catalog)).toEqual({recommendations:[],brandFallback:false});});
});
