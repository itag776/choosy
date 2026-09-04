import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CATALOG } from "@/lib/catalog";
import { createCommerceAuditEvent, verifyCommerceAuditChain } from "@/lib/commerce-audit";
import { allQuestions, buildCart, emptyPreferenceProfile, isProfileComplete, nextQuestion, noMatchRecovery, rankProducts, recommendedAddons, resolveCoveredQuestions, validateCart } from "@/lib/commerce-policy";
import { createMachineCheckout, createMachineQuote, executeShoppingCommand, markSelectedItemUnavailable, merchantDashboard, processRazorpayWebhook, reconcileShoppingPayment, sendShoppingMessage } from "@/lib/commerce-service";
import { createOperatorToken, verifyAccessCode, verifyOperatorToken } from "@/lib/operator-auth";
import { quickChoicesForQuestion } from "@/lib/quick-choices";
import { checkoutIntent, createOrReconcileCheckout, stableReferenceId } from "@/lib/razorpay";
import { setCommerceRepositoryForTests } from "@/lib/repository";
import { classifyShoppingMessage, extractDeterministicPreferences, understandShoppingMessage } from "@/lib/shopping-agent";
import { verifyRazorpaySignature } from "@/lib/webhook";
import type { PreferenceProfile } from "@/lib/types";
import { completePhoneDiscovery, MemoryCommerceRepository, TEST_SESSION_ID } from "@/tests/helpers";

let repository: MemoryCommerceRepository;
const operator = { actorId:"operator_judge",role:"operator" as const,merchantId:"merchant_choosy_demo" };

beforeEach(()=>{ repository=new MemoryCommerceRepository(); setCommerceRepositoryForTests(repository); });
afterEach(()=>{ setCommerceRepositoryForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("discovery and ranking boundary",()=>{
  it.each(["I need a laptop", "Show me a television", "Recommend an electric toothbrush", "I want formal shoes"])('recognizes the unsupported shopping request "%s"',(text)=>{const profile=emptyPreferenceProfile();expect(classifyShoppingMessage(profile,text,"category").kind).toBe("unsupported_category");});
  it("asks shoppers to choose when they name multiple supported categories",()=>{const result=classifyShoppingMessage(emptyPreferenceProfile(),"I need either a phone or headphones","category");expect(result).toEqual({kind:"multiple_categories",categories:["phones","headphones"]});});
  it("understands that headphones for a phone is one category, not two",()=>{expect(classifyShoppingMessage(emptyPreferenceProfile(),"I need headphones for my phone","category")).toEqual({kind:"continue"});});
  it("handles greetings and unrelated requests without a model call",()=>{const profile=emptyPreferenceProfile();expect(classifyShoppingMessage(profile,"Hello!","category").kind).toBe("greeting");expect(classifyShoppingMessage(profile,"Tell me a joke","category").kind).toBe("off_topic");});
  it.each(["My card number is 4242 4242 4242 4242", "Email me at shopper@example.com", "My OTP is 123456"])('detects sensitive input "%s"',(text)=>{expect(classifyShoppingMessage(emptyPreferenceProfile(),text,"category").kind).toBe("sensitive_data");});
  it("extracts the golden multi-field intent without repeating known questions",()=>{const result=extractDeterministicPreferences(emptyPreferenceProfile(),"I need a phone under ₹50,000 for photography. No brand preference.");expect(result.profile.category).toBe("phones");expect(result.profile.maxBudgetPaise).toBe(50_000_00);expect(result.profile.useCase).toBe("Photography");expect(result.profile.brandPreference).toBe("No preference");expect(result.confirmedKeys).toEqual(expect.arrayContaining(["category","maxBudgetPaise","useCase","brandPreference"]));});
  it("completes the golden deterministic turn within the two-second target",async()=>{const result=await understandShoppingMessage({profile:emptyPreferenceProfile(),message:"I need a phone under ₹50,000 for photography. No brand preference.",activeQuestionKey:"category"});expect(result.mode).toBe("deterministic");expect(result.durationMs).toBeLessThan(2_000);});
  it.each([["50k",50_000_00],["50 thousand",50_000_00],["0.5 lakh",50_000_00],["₹50,000",50_000_00]])("normalizes the %s budget",(amount,expected)=>{const result=extractDeterministicPreferences(emptyPreferenceProfile(),`Phone budget ${amount}`);expect(result.profile.maxBudgetPaise).toBe(expected);});
  it("understands a common Hinglish shopping request",()=>{const result=extractDeterministicPreferences(emptyPreferenceProfile(),"Mujhe photography ke liye mobile chahiye, budget 50k, koi brand preference nahi hai");expect(result.profile.category).toBe("phones");expect(result.profile.maxBudgetPaise).toBe(50_000_00);expect(result.profile.useCase).toBe("Photography");expect(result.profile.brandPreference).toBe("No preference");});
  it("fails safely when an ambiguous answer needs Gemini but Gemini is unavailable",async()=>{vi.stubEnv("GEMINI_API_KEY","");await expect(understandShoppingMessage({profile:emptyPreferenceProfile(),message:"Something delightful please",activeQuestionKey:"category"})).rejects.toThrow("Gemini is not configured");});
  it("keeps category-specific quick choices isolated",()=>{
    expect(quickChoicesForQuestion("size","phones")).toEqual(["Compact","Standard","Large","No preference"]);
    expect(quickChoicesForQuestion("size","phones")).not.toContain("UK 7");
    expect(quickChoicesForQuestion("size","running-shoes")).toEqual(["UK 5","UK 5.5","UK 6","UK 6.5","UK 7","UK 7.5","UK 8","UK 8.5","UK 9","UK 9.5","UK 10","UK 10.5","UK 11","UK 11.5","UK 12"]);
    expect(quickChoicesForQuestion("useCase","running-shoes")).toEqual(["Daily training","Long runs","Speed / race day","Walking / casual"]);
    expect(quickChoicesForQuestion("support","running-shoes")).toEqual(["Neutral","Extra stability","Not sure"]);
    expect(quickChoicesForQuestion("brandPreference","phones")).toEqual(["No preference","iQOO","OnePlus","Nothing","Google","Apple","Xiaomi","Samsung","Motorola","Poco","Realme","Vivo"]);
  });
  it("asks distinct shoe questions without overlapping activity and distance",()=>{
    const profile:PreferenceProfile={...emptyPreferenceProfile(),category:"running-shoes",confirmedKeys:["category"]};
    const questions=allQuestions(profile);
    expect(questions.map((question)=>question.key)).toEqual(["category","maxBudgetPaise","useCase","size","terrain","support","cushioning","brandPreference"]);
    expect(questions.map((question)=>question.key)).not.toContain("distance");
    expect(questions.find((question)=>question.key==="useCase")?.prompt).toBe("What should these shoes be best at?");
  });
  it("extracts several shoe needs at once so the chat does not ask them again",()=>{
    const result=extractDeterministicPreferences(emptyPreferenceProfile(),"I need neutral trail running shoes in UK 11.5 for long runs with responsive cushioning");
    expect(result.profile.category).toBe("running-shoes");
    expect(result.profile.useCase).toBe("Long runs");
    expect(result.profile.answers).toMatchObject({size:"UK 11.5",terrain:"Trail",support:"Neutral",cushioning:"Responsive"});
    expect(result.confirmedKeys).toEqual(expect.arrayContaining(["category","useCase","size","terrain","support","cushioning"]));
  });
  it("does not ask a category question already answered by an equivalent preference",()=>{
    const profile:PreferenceProfile={category:"phones",maxBudgetPaise:50_000_00,useCase:"Photography",brandPreference:"No preference",mustHaves:[],answers:{},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves"]};
    const resolved=resolveCoveredQuestions(profile);
    expect(resolved.answers.priority).toBe("Camera");
    expect(resolved.confirmedKeys).toContain("priority");
    expect(nextQuestion(resolved)?.key).toBe("os");
  });
  it("infers the phone platform from a specific brand instead of asking a redundant OS question",()=>{
    const apple:PreferenceProfile={category:"phones",maxBudgetPaise:100_000_00,useCase:"Everyday",brandPreference:"Apple",mustHaves:[],answers:{},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves"]};
    const resolvedApple=resolveCoveredQuestions(apple);
    expect(resolvedApple.answers.os).toBe("iOS");
    expect(resolvedApple.confirmedKeys).toContain("os");
    expect(nextQuestion(resolvedApple)?.key).not.toBe("os");

    const samsung=resolveCoveredQuestions({...apple,brandPreference:"Samsung"});
    expect(samsung.answers.os).toBe("Android");

    const iosFirst=resolveCoveredQuestions({...apple,brandPreference:null,answers:{os:"iOS"},confirmedKeys:apple.confirmedKeys.filter((key)=>key!=="brandPreference").concat("os")});
    expect(iosFirst.brandPreference).toBe("Apple");
    expect(iosFirst.confirmedKeys).toContain("brandPreference");
  });
  it("reuses a headphone use case as the equivalent environment answer",()=>{
    const profile:PreferenceProfile={category:"headphones",maxBudgetPaise:15_000_00,useCase:"Travel",brandPreference:"No preference",mustHaves:[],answers:{},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves"]};
    const resolved=resolveCoveredQuestions(profile);
    expect(resolved.answers.environment).toBe("Commute");
    expect(resolved.confirmedKeys).toContain("environment");
  });
  it("extracts an iPhone request as phone, Apple, and iOS without model help",()=>{
    const extracted=extractDeterministicPreferences(emptyPreferenceProfile(),"I want an iPhone under ₹1 lakh for photography");
    const resolved=resolveCoveredQuestions(extracted.profile);
    expect(resolved.category).toBe("phones");
    expect(resolved.brandPreference).toBe("Apple");
    expect(resolved.answers.os).toBe("iOS");
    expect(resolved.answers.priority).toBe("Camera");
  });
  it("remembers a brand stated before the product category",()=>{const result=extractDeterministicPreferences(emptyPreferenceProfile(),"I want Apple");expect(result.profile.category).toBeNull();expect(result.profile.brandPreference).toBe("Apple");expect(result.confirmedKeys).toContain("brandPreference");});
  it("drops stale category answers when the shopper naturally switches products",()=>{
    const phone:PreferenceProfile={category:"phones",maxBudgetPaise:50_000_00,useCase:"Gaming",brandPreference:"No preference",mustHaves:[],answers:{os:"Android",priority:"Performance",size:"Large"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]};
    const result=extractDeterministicPreferences(phone,"Actually, switch to headphones for travel");
    expect(result.profile.category).toBe("headphones");
    expect(result.profile.answers.os).toBeUndefined();
    expect(result.profile.answers.size).toBeUndefined();
    expect(result.profile.useCase).toBe("Travel");
  });
  it("drops universal preferences that become irrelevant after a category switch",()=>{
    const shoes:PreferenceProfile={category:"running-shoes",maxBudgetPaise:20_000_00,useCase:"Fitness",brandPreference:"Nike",mustHaves:["Soft cushioning"],answers:{size:"UK 9",terrain:"Road",distance:"10 km+",cushioning:"Soft"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","size","terrain","distance","cushioning"]};
    const result=extractDeterministicPreferences(shoes,"Actually, switch to phones");
    expect(result.profile.category).toBe("phones");
    expect(result.profile.brandPreference).toBeNull();
    expect(result.profile.useCase).toBeNull();
    expect(result.profile.mustHaves).toEqual([]);
    expect(result.profile.confirmedKeys).not.toEqual(expect.arrayContaining(["brandPreference","useCase","mustHaves","terrain","distance","cushioning"]));
  });
  it("skips an overlapping feature question but keeps distinct questions",()=>{
    const profile:PreferenceProfile={category:"headphones",maxBudgetPaise:15_000_00,useCase:"Travel",brandPreference:"No preference",mustHaves:["Noise cancellation"],answers:{},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves"]};
    const resolved=resolveCoveredQuestions(profile);
    expect(resolved.answers.feature).toBe("Noise cancellation");
    expect(resolved.confirmedKeys).toContain("feature");
    expect(resolved.confirmedKeys).not.toContain("formFactor");
  });
  it("withholds recommendations until every required answer is explicit",()=>{ const profile=emptyPreferenceProfile(); expect(isProfileComplete(profile)).toBe(false); expect(nextQuestion(profile)?.key).toBe("category"); expect(rankProducts(profile,DEMO_CATALOG)).toEqual({recommendations:[],brandFallback:false}); });
  it("returns only in-stock products within budget and matching hard must-haves",()=>{ const profile:PreferenceProfile={category:"phones",maxBudgetPaise:50_000_00,useCase:"Photography",brandPreference:"No preference",mustHaves:["camera"],answers:{os:"Android",priority:"Camera",size:"Standard"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]}; const {recommendations:results}=rankProducts(profile,DEMO_CATALOG); expect(results.length).toBeGreaterThan(0); expect(results.length).toBeLessThanOrEqual(3); for(const result of results){const product=DEMO_CATALOG.find((item)=>item.id===result.productId)!;const variant=product.variants.find((item)=>item.id===result.variantId)!;expect(product.tags).toContain("camera");expect(variant.pricePaise).toBeLessThanOrEqual(profile.maxBudgetPaise!);expect(variant.stock).toBeGreaterThan(0);} });
  it("never recommends a product with the wrong exclusive platform",()=>{const profile:PreferenceProfile={category:"phones",maxBudgetPaise:150_000_00,useCase:"Everyday",brandPreference:"No preference",mustHaves:[],answers:{os:"iOS",priority:"Balanced",size:"No preference"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]};const {recommendations}=rankProducts(profile,DEMO_CATALOG);expect(recommendations.length).toBeGreaterThan(0);for(const recommendation of recommendations){const product=DEMO_CATALOG.find((item)=>item.id===recommendation.productId)!;expect(product.tags).toContain("ios");}});
  it("treats shoe surface and support as real fit constraints",()=>{
    const road:PreferenceProfile={category:"running-shoes",maxBudgetPaise:20_000_00,useCase:"Long runs",brandPreference:"No preference",mustHaves:[],answers:{size:"UK 9",terrain:"Road",support:"Neutral",cushioning:"Soft"},confirmedKeys:["category","maxBudgetPaise","useCase","size","terrain","support","cushioning","brandPreference"]};
    const roadMatches=rankProducts(road,DEMO_CATALOG).recommendations;
    expect(roadMatches.length).toBeGreaterThan(1);
    for(const recommendation of roadMatches){const product=DEMO_CATALOG.find((item)=>item.id===recommendation.productId)!;expect(product.tags).toContain("road");expect(product.tags).toContain("neutral");expect(recommendation.reason).toContain("road use");expect(recommendation.reason).toContain("UK 9");}
    const stability={...road,answers:{...road.answers,support:"Extra stability"}};
    const stabilityMatches=rankProducts(stability,DEMO_CATALOG).recommendations;
    expect(stabilityMatches.length).toBeGreaterThanOrEqual(2);
    for(const recommendation of stabilityMatches){const product=DEMO_CATALOG.find((item)=>item.id===recommendation.productId)!;expect(product.tags).toContain("extra stability");}
  });
  it("offers running shoes across distinct price points",()=>{
    const shoes=DEMO_CATALOG.filter((item)=>item.kind==="primary"&&item.category==="running-shoes");
    const newSkus=["SH-NI-RD","SH-NI-RS3","SH-NI-JT3","SH-PM-EN4","SH-NI-STR26","SH-PM-FR3","SH-KI-KS9S","SH-AD-SOL3","SH-SK-GRP2","SH-NB-860","SH-PM-FRN2","SH-BR-AD23","SH-HK-AR8","SH-SL-DRXG","SH-NI-DS13","SH-AD-GX7","SH-PM-SCPH","SH-KI-KS9L","SH-KL-JF190"];
    expect(shoes.length).toBeGreaterThanOrEqual(39);
    expect(shoes.map((item)=>item.sku)).toEqual(expect.arrayContaining(newSkus));
    const prices=shoes.map((shoe)=>shoe.variants[0]!.pricePaise/100);
    expect(Math.min(...prices)).toBeLessThanOrEqual(3_299);
    expect(Math.max(...prices)).toBeGreaterThanOrEqual(23_999);
    expect(new Set(prices).size).toBeGreaterThanOrEqual(15);
  });
  it("adds five distinct current options below ₹10,000",()=>{
    const budgetSkus=["SH-NI-DS13","SH-AD-GX7","SH-PM-SCPH","SH-KI-KS9L","SH-KL-JF190"];
    const shoes=DEMO_CATALOG.filter((item)=>budgetSkus.includes(item.sku));
    expect(shoes).toHaveLength(5);
    expect(shoes.every((shoe)=>shoe.variants[0]!.pricePaise<=10_000_00)).toBe(true);
  });
  it("backs every displayed shoe brand with a stability option",()=>{
    const brands=["KIPRUN","Nike","adidas","Skechers","ASICS","New Balance","Puma","Brooks","Salomon","Hoka"];
    const shoes=DEMO_CATALOG.filter((item)=>item.kind==="primary"&&item.category==="running-shoes");
    for(const brand of brands){
      expect(shoes.some((shoe)=>shoe.brand===brand)).toBe(true);
      expect(shoes.some((shoe)=>shoe.brand===brand&&shoe.tags.includes("extra stability"))).toBe(true);
    }
  });
  it("stocks every running shoe from UK 5 through UK 12",()=>{
    const expected=["UK 5","UK 5.5","UK 6","UK 6.5","UK 7","UK 7.5","UK 8","UK 8.5","UK 9","UK 9.5","UK 10","UK 10.5","UK 11","UK 11.5","UK 12"];
    for(const shoe of DEMO_CATALOG.filter((item)=>item.kind==="primary"&&item.category==="running-shoes")) expect(shoe.variants.map((item)=>item.label)).toEqual(expected);
  });
  it("does not repeat unchanged no-match recovery questions",()=>{
    const withoutMixedStability=DEMO_CATALOG.filter((item)=>item.sku!=="SH-SL-DRXG");
    const profile:PreferenceProfile={category:"running-shoes",maxBudgetPaise:25_000_00,useCase:"Daily training",brandPreference:"Hoka",mustHaves:[],answers:{size:"UK 10",terrain:"Trail",support:"Extra stability",cushioning:"No preference"},confirmedKeys:["category","maxBudgetPaise","useCase","size","terrain","support","cushioning","brandPreference"]};
    expect(noMatchRecovery(profile,withoutMixedStability).key).toBe("support");
    expect(noMatchRecovery(profile,withoutMixedStability,new Set(["support"])).key).toBe("terrain");
    expect(noMatchRecovery(profile,withoutMixedStability,new Set(["support","terrain"])).key).toBeNull();
  });
  it("ends cleanly when no recovery can restore out-of-stock inventory",()=>{
    const unavailable=structuredClone(DEMO_CATALOG);for(const product of unavailable)for(const item of product.variants)item.stock=0;
    const profile:PreferenceProfile={category:"phones",maxBudgetPaise:50_000_00,useCase:"Everyday",brandPreference:"No preference",mustHaves:[],answers:{os:"Android",priority:"Balanced",size:"Standard"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]};
    expect(noMatchRecovery(profile,unavailable).key).toBeNull();
  });
  it("reopens the actual blocking preference when no product can match",()=>{const base:PreferenceProfile={category:"phones",maxBudgetPaise:150_000_00,useCase:"Everyday",brandPreference:"No preference",mustHaves:["Noise cancellation"],answers:{os:"Android",priority:"Balanced",size:"No preference"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]};expect(noMatchRecovery(base,DEMO_CATALOG).key).toBe("mustHaves");const affordableApple={...base,maxBudgetPaise:50_000_00,brandPreference:"Apple",mustHaves:[],answers:{...base.answers,os:"iOS"}};expect(noMatchRecovery(affordableApple,DEMO_CATALOG).key).toBe("maxBudgetPaise");});
  it("breaks the shoe budget loop by reopening the conflicting fit answer",()=>{
    const withoutMixedStability=DEMO_CATALOG.filter((item)=>item.sku!=="SH-SL-DRXG");
    const profile:PreferenceProfile={category:"running-shoes",maxBudgetPaise:150_000_00,useCase:"Long runs",brandPreference:"No preference",mustHaves:[],answers:{size:"UK 9",terrain:"Trail",support:"Extra stability",cushioning:"Soft"},confirmedKeys:["category","maxBudgetPaise","useCase","size","terrain","support","cushioning","brandPreference"]};
    const recovery=noMatchRecovery(profile,withoutMixedStability);
    expect(["support","terrain","cushioning"]).toContain(recovery.key);
    expect(recovery.prompt).not.toMatch(/budget|amount|rupees/i);
  });
  it("offers no more than two category-relevant budget-safe add-ons",()=>{ const profile:PreferenceProfile={category:"phones",maxBudgetPaise:50_000_00,useCase:"Everyday",brandPreference:"No preference",mustHaves:[],answers:{os:"Android",priority:"Balanced",size:"Standard"},confirmedKeys:["category","maxBudgetPaise","useCase","brandPreference","mustHaves","os","priority","size"]}; const primary=DEMO_CATALOG.find((item)=>item.sku==="PH-OP-CE4L")!; const addons=recommendedAddons(profile,primary,DEMO_CATALOG); expect(addons).toHaveLength(2); expect(addons.every((item)=>item.kind==="addon"&&item.category==="phones")).toBe(true); });
  it("uses sourced real primary products with frozen Test Mode prices",()=>{const primaries=DEMO_CATALOG.filter((item)=>item.kind==="primary");expect(primaries.filter((item)=>item.category==="phones").length).toBeGreaterThanOrEqual(8);expect(primaries.filter((item)=>item.category==="headphones").length).toBeGreaterThanOrEqual(8);expect(primaries.filter((item)=>item.category==="running-shoes").length).toBeGreaterThanOrEqual(8);for(const product of primaries){expect(product.attributes.realProduct).toBe(true);expect(product.attributes.catalogMode).toBe("curated_snapshot");expect(product.attributes.stockMode).toBe("simulated");expect(product.attributes.priceAsOf).toBe("2026-09-03");expect(String(product.attributes.sourceUrl)).toMatch(/^https:\/\//);}expect(JSON.stringify(primaries)).not.toMatch(/Aster|Northstar|Luma 16|Orbit Quiet|Pulse Play|Serein|Vela Daily|Ridge Trail|Kite Tempo/);});
});

describe("versioned shopping flow",()=>{
  it("creates versioned, contiguous audit events",()=>{const session=repository.sessions.get(TEST_SESSION_ID)!;const first=session.audit[0]!;expect(first.schemaVersion).toBe(1);expect(first.sessionVersion).toBe(1);expect(first.sequence).toBe(1);expect(first.previousHash).toBe("GENESIS");expect(verifyCommerceAuditChain(session.audit)).toBe(true);});
  it("rejects a reordered or renumbered audit chain",()=>{const session=repository.sessions.get(TEST_SESSION_ID)!;const invalid=structuredClone(session.audit);invalid[0]!.sequence=2;expect(verifyCommerceAuditChain(invalid)).toBe(false);});
  it("records structured preference changes without raw chat text",async()=>{const initial=await repository.get(TEST_SESSION_ID);const session=await sendShoppingMessage(TEST_SESSION_ID,{text:"Phone",answerKey:"category",answerValue:"Phone",expectedVersion:initial.version,idempotencyKey:"msg:audit:preference"});const event=session.audit.find((item)=>item.title==="Shopping preferences updated");expect(event?.evidence).toEqual({source:"quick_choice",changes:{category:"phones"}});expect(JSON.stringify(event)).not.toContain("rawText");});
  it("uses the ledger rather than a mutable snapshot for the merchant audit",async()=>{await completePhoneDiscovery(repository);const stored=repository.sessions.get(TEST_SESSION_ID)!;stored.audit=[];repository.sessions.set(TEST_SESSION_ID,stored);const dashboard=await merchantDashboard(operator);expect(dashboard.sessions[0]!.audit.length).toBeGreaterThan(0);expect(dashboard.auditIntegrity[TEST_SESSION_ID]?.verified).toBe(true);});
  it("rejects an invalid ledger transition",async()=>{const current=await repository.get(TEST_SESSION_ID);const next=structuredClone(current);next.version=current.version+1;const event=createCommerceAuditEvent(next,{kind:"policy",title:"Invalid sequence",detail:"Test event",actor:"system",status:"blocked"});event.sequence+=1;next.audit.push(event);await expect(repository.replace(current,next,[event])).rejects.toThrow("audit conflict");});
  it("moves past an overlapping controlled question instead of asking it again",async()=>{let session=await repository.get(TEST_SESSION_ID);for(const [key,value] of [["category","Phone"],["maxBudgetPaise","₹50,000"],["useCase","Photography"]] as const)session=await sendShoppingMessage(TEST_SESSION_ID,{text:value,answerKey:key,answerValue:value,expectedVersion:session.version,idempotencyKey:`msg:dedupe:${key}`});expect(session.profile.answers.priority).toBe("Camera");expect(session.profile.confirmedKeys).toContain("priority");expect(session.activeQuestionKey).toBe("brandPreference");expect(session.messages.at(-1)?.text).not.toMatch(/camera|matters most/i);expect(session.audit.some((event)=>event.title==="Redundant follow-ups skipped")).toBe(true);});
  it("completes the former mixed-terrain stability loop with a real match",async()=>{
    let session=await repository.get(TEST_SESSION_ID);
    const answers=[["category","Running shoes"],["maxBudgetPaise","₹25,000"],["useCase","Daily training"],["size","UK 10"],["terrain","Mixed"],["support","Extra stability"],["cushioning","No preference"],["brandPreference","Hoka"]] as const;
    for(const [key,value] of answers) session=await sendShoppingMessage(TEST_SESSION_ID,{text:value,answerKey:key,answerValue:value,expectedVersion:session.version,idempotencyKey:`msg:mixed-stability:${key}`});
    expect(session.phase).toBe("recommendations_ready");
    expect(session.recommendations.length).toBeGreaterThan(0);
    expect(session.activeQuestionKey).toBeNull();
    expect(session.messages.at(-1)?.text).toContain("alternatives from other brands");
    for(const recommendation of session.recommendations){
      const product=DEMO_CATALOG.find((item)=>item.id===recommendation.productId)!;
      expect(product.tags).toEqual(expect.arrayContaining(["mixed","extra stability"]));
    }
    expect(session.audit.filter((event)=>event.title==="No exact match found")).toHaveLength(0);
  });
  it("skips the OS follow-up in the real conversation after Apple is selected",async()=>{let session=await repository.get(TEST_SESSION_ID);for(const [key,value] of [["category","Phone"],["maxBudgetPaise","₹1,00,000"],["useCase","Everyday"],["brandPreference","Apple"]] as const)session=await sendShoppingMessage(TEST_SESSION_ID,{text:value,answerKey:key,answerValue:value,expectedVersion:session.version,idempotencyKey:`msg:apple:${key}`});expect(session.profile.answers.os).toBe("iOS");expect(session.profile.confirmedKeys).toContain("os");expect(session.activeQuestionKey).toBe("mustHaves");expect(session.messages.at(-1)?.text).toContain("skipped that question");expect(session.messages.at(-1)?.text).not.toContain("Android");});
  it("remembers Apple even when it is stated before the category",async()=>{let session=await repository.get(TEST_SESSION_ID);session=await sendShoppingMessage(TEST_SESSION_ID,{text:"I want Apple",expectedVersion:session.version,idempotencyKey:"msg:apple:first"});expect(session.profile.brandPreference).toBe("Apple");expect(session.activeQuestionKey).toBe("category");session=await sendShoppingMessage(TEST_SESSION_ID,{text:"Phone",answerKey:"category",answerValue:"Phone",expectedVersion:session.version,idempotencyKey:"msg:apple:phone"});expect(session.profile.answers.os).toBe("iOS");expect(session.activeQuestionKey).toBe("maxBudgetPaise");});
  it("clarifies an unresolved question without repeating the same prompt",async()=>{vi.stubEnv("GEMINI_API_KEY","");let session=await repository.get(TEST_SESSION_ID);session=await sendShoppingMessage(TEST_SESSION_ID,{text:"Budget under ₹50,000",expectedVersion:session.version,idempotencyKey:"msg:clarify:budget"});const first=session.messages.at(-1)?.text;session=await sendShoppingMessage(TEST_SESSION_ID,{text:"No brand preference",expectedVersion:session.version,idempotencyKey:"msg:clarify:brand"});const second=session.messages.at(-1)?.text;expect(session.activeQuestionKey).toBe("category");expect(first).toBe("I can help with phones, headphones, or running shoes—which should I focus on?");expect(second).not.toBe(first);expect(second).toContain("I saved the other detail");expect(session.messages.filter((item)=>item.role==="assistant"&&item.text===first)).toHaveLength(1);});
  it("explains the supported catalog and does not repeat the same unsupported response",async()=>{let session=await repository.get(TEST_SESSION_ID);session=await sendShoppingMessage(TEST_SESSION_ID,{text:"I need a laptop",expectedVersion:session.version,idempotencyKey:"msg:unsupported:laptop"});const first=session.messages.at(-1)?.text;expect(first).toContain("only help with phones, headphones, or running shoes");expect(session.activeQuestionKey).toBe("category");session=await sendShoppingMessage(TEST_SESSION_ID,{text:"What about a tablet?",expectedVersion:session.version,idempotencyKey:"msg:unsupported:tablet"});const second=session.messages.at(-1)?.text;expect(second).toContain("three categories");expect(second).not.toBe(first);expect(session.profile.category).toBeNull();});
  it("asks for one category when a shopper requests several",async()=>{const current=await repository.get(TEST_SESSION_ID);const session=await sendShoppingMessage(TEST_SESSION_ID,{text:"Compare phones and running shoes",expectedVersion:current.version,idempotencyKey:"msg:multiple:categories"});expect(session.messages.at(-1)?.text).toContain("one category at a time");expect(session.activeQuestionKey).toBe("category");expect(session.profile.category).toBeNull();});
  it("answers a greeting without treating it as a failed model turn",async()=>{const current=await repository.get(TEST_SESSION_ID);const session=await sendShoppingMessage(TEST_SESSION_ID,{text:"Hello!",expectedVersion:current.version,idempotencyKey:"msg:greeting"});expect(session.phase).toBe("discovering");expect(session.messages.at(-1)?.text).toContain("phones, headphones, or running shoes");expect(session.audit.at(-1)?.title).toBe("Greeting answered");});
  it("redacts likely personal or payment information before persistence",async()=>{const current=await repository.get(TEST_SESSION_ID);const raw="My card number is 4242 4242 4242 4242";const session=await sendShoppingMessage(TEST_SESSION_ID,{text:raw,expectedVersion:current.version,idempotencyKey:"msg:sensitive"});expect(session.messages.some((item)=>item.text===raw)).toBe(false);expect(session.messages.at(-2)?.text).toBe("[Sensitive information removed]");expect(session.messages.at(-1)?.text).toContain("don’t share card numbers");expect(JSON.stringify(session.audit)).not.toContain("4242");});
  it("completes discovery, creates a shortlist, and records a valid audit chain",async()=>{ const session=await completePhoneDiscovery(repository); expect(session.phase).toBe("recommendations_ready"); expect(session.recommendations).toHaveLength(3); expect(verifyCommerceAuditChain(session.audit)).toBe(true); expect(session.audit.some((event)=>event.title==="Enough preferences collected")).toBe(true); });
  it("blocks an unavailable item before any Razorpay intent",async()=>{ let session=await completePhoneDiscovery(repository); session=await executeShoppingCommand(TEST_SESSION_ID,{command:"select_product",expectedVersion:session.version,idempotencyKey:"select:test",payload:{productId:session.recommendations[0]!.productId}}); session=await executeShoppingCommand(TEST_SESSION_ID,{command:"set_addons",expectedVersion:session.version,idempotencyKey:"addons:test",payload:{addonIds:[]}}); await markSelectedItemUnavailable(TEST_SESSION_ID,operator); session=await repository.get(TEST_SESSION_ID); session=await executeShoppingCommand(TEST_SESSION_ID,{command:"confirm_cart",expectedVersion:session.version,idempotencyKey:"confirm:test"}); expect(session.phase).toBe("needs_reselection"); expect(session.checkout).toBeNull(); expect(repository.checkouts).toHaveLength(0); expect(session.messages.at(-1)?.text).toContain("Nothing was charged or substituted"); });
  it("rejects checkout before explicit cart confirmation",async()=>{ const session=await completePhoneDiscovery(repository); await expect(executeShoppingCommand(TEST_SESSION_ID,{command:"create_checkout",expectedVersion:session.version,idempotencyKey:"checkout:early"})).rejects.toThrow("Confirm the current cart"); });
  it("returns the original state for a repeated command idempotency key",async()=>{ const session=await completePhoneDiscovery(repository); const input={command:"select_product" as const,expectedVersion:session.version,idempotencyKey:"select:same",payload:{productId:session.recommendations[0]!.productId}}; const first=await executeShoppingCommand(TEST_SESSION_ID,input); const second=await executeShoppingCommand(TEST_SESSION_ID,{...input,expectedVersion:first.version}); expect(second.version).toBe(first.version); });
  it("receipts repeated messages before applying version checks",async()=>{const initial=await repository.get(TEST_SESSION_ID);const input={text:"Phone",answerKey:"category",answerValue:"Phone",expectedVersion:initial.version,idempotencyKey:"msg:repeat:test"};const first=await sendShoppingMessage(TEST_SESSION_ID,input);const second=await sendShoppingMessage(TEST_SESSION_ID,input);expect(second.version).toBe(first.version);expect(second.messages.filter((item)=>item.text==="Phone")).toHaveLength(1);});
  it("rejects unsupported controlled categories",async()=>{const initial=await repository.get(TEST_SESSION_ID);await expect(sendShoppingMessage(TEST_SESSION_ID,{text:"Laptop",answerKey:"category",answerValue:"Laptop",expectedVersion:initial.version,idempotencyKey:"msg:unsupported"})).rejects.toThrow("not valid");});
  it("reopens an edited preference and removes the stale shortlist",async()=>{const session=await completePhoneDiscovery(repository);const revised=await executeShoppingCommand(TEST_SESSION_ID,{command:"revise_preference",expectedVersion:session.version,idempotencyKey:"revise:budget",payload:{key:"maxBudgetPaise"}});expect(revised.phase).toBe("discovering");expect(revised.activeQuestionKey).toBe("maxBudgetPaise");expect(revised.recommendations).toEqual([]);expect(revised.profile.confirmedKeys).not.toContain("maxBudgetPaise");});
  it("detects cart digest, total, and structural tampering",()=>{const primary=DEMO_CATALOG[0]!;const cart=buildCart(primary,primary.variants[0]!,[]);cart.totalPaise+=100;cart.items[0]!.kind="addon";const result=validateCart(cart,DEMO_CATALOG);expect(result.valid).toBe(false);expect(result.changed).toContain("cart_total");});
  it("rejects a machine quote whose signed fields were altered",async()=>{const primary=DEMO_CATALOG[0]!;const quote=await createMachineQuote([{productId:primary.id,variantId:primary.variants[0]!.id}]);quote.expiresAt=new Date(Date.now()+300000).toISOString();await expect(createMachineCheckout(quote,quote.digest,"machine:tamper")).rejects.toThrow("integrity");});
  it("persists a linked blocked audit when stock changes after an external quote",async()=>{const primary=DEMO_CATALOG[0]!;const quote=await createMachineQuote([{productId:primary.id,variantId:primary.variants[0]!.id}]);await repository.setVariantStock(primary.variants[0]!.id,0);await expect(createMachineCheckout(quote,quote.digest,"buyer:blocked:checkout","buyer_aaaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow("No Razorpay action");const blocked=(await repository.list()).find((item)=>item.buyerRunId==="buyer_aaaaaaaaaaaaaaaaaaaaaaaa");expect(blocked?.origin).toBe("external_agent");expect(blocked?.phase).toBe("needs_reselection");expect(blocked?.checkout).toBeNull();expect(blocked?.audit.at(-1)?.title).toBe("Checkout stopped");expect(verifyCommerceAuditChain(blocked!.audit)).toBe(true);});
});

describe("identity and payment safety",()=>{
  it("supports Choosy auth variables and rejects tampered operator tokens",()=>{ vi.stubEnv("CHOOSY_OPERATOR_ACCESS_CODE","admin");vi.stubEnv("CHOOSY_SESSION_SECRET","choosy-test-session-secret-with-entropy");expect(verifyAccessCode("admin")).toBe(true);expect(verifyAccessCode("wrong")).toBe(false);const {token,session}=createOperatorToken("operator_judge",1000);expect(session.merchantId).toBe("merchant_choosy_demo");expect(verifyOperatorToken(token,1001)?.actorId).toBe("operator_judge");expect(verifyOperatorToken(`${token}x`,1001)).toBeNull(); });
  it("creates stable cart-bound references without shopper PII",()=>{ const primary=DEMO_CATALOG[0]!;const cart=buildCart(primary,primary.variants[0]!,[]);const quote={id:"quote_x",cart,catalogVersion:"v1",expiresAt:new Date(Date.now()+60000).toISOString(),digest:"a".repeat(64)};const action=checkoutIntent(TEST_SESSION_ID,quote,"checkout:test");expect(action.referenceId).toBe(stableReferenceId(TEST_SESSION_ID,cart.digest));expect(JSON.stringify(action)).not.toMatch(/email|phone|customer/i); });
  it("creates Razorpay links with a GET callback to the exact buyer run",async()=>{const primary=DEMO_CATALOG[0]!;const cart=buildCart(primary,primary.variants[0]!,[]);const quote={id:"quote_x",cart,catalogVersion:"v1",expiresAt:new Date(Date.now()+60000).toISOString(),digest:"a".repeat(64)};const action=checkoutIntent(TEST_SESSION_ID,quote,"checkout:callback");vi.stubEnv("RAZORPAY_KEY_ID","rzp_test_id");vi.stubEnv("RAZORPAY_KEY_SECRET","rzp_test_secret");const mocked=vi.fn(async(...args:Parameters<typeof fetch>)=>String(args[0]).includes("reference_id=")?new Response(JSON.stringify({payment_links:[]})):new Response(JSON.stringify({id:"plink_callback",short_url:"https://rzp.io/i/callback",reference_id:action.referenceId,amount:action.amountPaise,status:"created",callback_url:"https://trychoosy.vercel.app/agent-buyer?run=buyer_aaaaaaaaaaaaaaaaaaaaaaaa&payment_return=1",callback_method:"get"})));vi.stubGlobal("fetch",mocked);await createOrReconcileCheckout(action,"https://trychoosy.vercel.app/agent-buyer?run=buyer_aaaaaaaaaaaaaaaaaaaaaaaa&payment_return=1");const request=mocked.mock.calls[1]![1] as RequestInit;const body=JSON.parse(String(request.body));expect(body.callback_url).toBe("https://trychoosy.vercel.app/agent-buyer?run=buyer_aaaaaaaaaaaaaaaaaaaaaaaa&payment_return=1");expect(body.callback_method).toBe("get");});
  it("verifies Razorpay signatures over the untouched body",()=>{ const body=JSON.stringify({event:"payment.captured"});const signature=createHmac("sha256","secret").update(body).digest("hex");expect(verifyRazorpaySignature(body,signature,"secret")).toBe(true);expect(verifyRazorpaySignature(body,"bad","secret")).toBe(false); });
  it("accepts one exactly correlated paid webhook and ignores its duplicate",async()=>{ const stored=await repository.get(TEST_SESSION_ID);stored.phase="checkout_ready";stored.checkout={id:"checkout_test",sessionId:stored.id,cartId:"cart_test",cartDigest:"b".repeat(64),quoteDigest:"c".repeat(64),idempotencyKey:"checkout:test",referenceId:"chy_test",amountPaise:40000,status:"created",providerId:"plink_test",shortUrl:"https://rzp.io/i/test",requestDigest:"d".repeat(64),createdAt:stored.createdAt,updatedAt:stored.updatedAt};repository.sessions.set(stored.id,stored);const payload={event:"payment_link.paid",payload:{payment_link:{entity:{id:"plink_test",reference_id:"chy_test",amount:40000,notes:{choosy_session_id:stored.id,choosy_cart_digest:"b".repeat(64),choosy_reference_id:"chy_test"}}}}};const rawBody=JSON.stringify(payload);const first=await processRazorpayWebhook({eventId:"evt_paid",eventType:"payment_link.paid",rawBody,payload,sessionId:stored.id});expect(first.state.phase).toBe("paid");const duplicate=await processRazorpayWebhook({eventId:"evt_paid",eventType:"payment_link.paid",rawBody,payload,sessionId:stored.id});expect(duplicate.duplicate).toBe(true);expect(duplicate.state.phase).toBe("paid"); });
  it("reconciles a paid Razorpay link when the shopper returns before the webhook",async()=>{const stored=await repository.get(TEST_SESSION_ID);stored.phase="checkout_ready";stored.checkout={id:"checkout_chy_1234567890abcdef1234",sessionId:stored.id,cartId:"cart_return",cartDigest:"b".repeat(64),quoteDigest:"c".repeat(64),idempotencyKey:"checkout:return",referenceId:"chy_return",amountPaise:649900,status:"created",providerId:"plink_return",shortUrl:"https://rzp.io/i/return",requestDigest:"d".repeat(64),createdAt:stored.createdAt,updatedAt:stored.updatedAt};repository.sessions.set(stored.id,stored);vi.stubEnv("RAZORPAY_KEY_ID","rzp_test_id");vi.stubEnv("RAZORPAY_KEY_SECRET","rzp_test_secret");const mocked=vi.fn(async()=>new Response(JSON.stringify({id:"plink_return",short_url:"https://rzp.io/i/return",reference_id:"chy_return",amount:649900,status:"paid"})));vi.stubGlobal("fetch",mocked);const paid=await reconcileShoppingPayment(TEST_SESSION_ID);expect(paid.phase).toBe("paid");expect(paid.checkout?.status).toBe("paid");expect(paid.messages.at(-1)?.text).toContain("order is placed");expect(paid.audit.at(-1)?.title).toBe("Payment confirmed on checkout return");expect(verifyCommerceAuditChain(paid.audit)).toBe(true);const repeated=await reconcileShoppingPayment(TEST_SESSION_ID);expect(repeated.version).toBe(paid.version);expect(mocked).toHaveBeenCalledTimes(1);});
  it("records but cannot capture a mismatched webhook amount",async()=>{const stored=await repository.get(TEST_SESSION_ID);stored.phase="checkout_ready";stored.checkout={id:"checkout_amount",sessionId:stored.id,cartId:"cart_amount",cartDigest:"e".repeat(64),quoteDigest:"f".repeat(64),idempotencyKey:"checkout:amount",referenceId:"chy_amount",amountPaise:50000,status:"created",providerId:"plink_amount",requestDigest:"a".repeat(64),createdAt:stored.createdAt,updatedAt:stored.updatedAt};repository.sessions.set(stored.id,stored);const payload={event:"payment_link.paid",payload:{payment_link:{entity:{id:"plink_amount",reference_id:"chy_amount",amount:49999,notes:{choosy_session_id:stored.id,choosy_cart_digest:"e".repeat(64),choosy_reference_id:"chy_amount"}}}}};const result=await processRazorpayWebhook({eventId:"evt_amount",eventType:"payment_link.paid",rawBody:JSON.stringify(payload),payload,sessionId:stored.id});expect(result.ignored).toBe(true);expect(result.state.phase).toBe("checkout_ready");expect(result.state.audit.at(-1)?.title).toContain("amount mismatch");});
});
