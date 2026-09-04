"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Code2, LoaderCircle, LockKeyhole, MessageCircle, PartyPopper, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, Store, UsersRound } from "lucide-react";
import { DEMO_CATALOG } from "@/lib/catalog";
import { quickChoicesForQuestion } from "@/lib/quick-choices";
import type { Product, ShoppingCommand, ShoppingSessionSnapshot } from "@/lib/types";

function inr(value: number): string { return `₹${Math.round(value / 100).toLocaleString("en-IN")}`; }
function product(id: string | null): Product | undefined { return id ? DEMO_CATALOG.find((item) => item.id === id) : undefined; }
function productSource(item: Product): string | null { return typeof item.attributes.sourceUrl === "string" ? item.attributes.sourceUrl : null; }

type InitialSessionResult = { ok: boolean; session: ShoppingSessionSnapshot & { error?: string } };
let initialSessionRequest: Promise<InitialSessionResult> | null = null;

function loadInitialSession(): Promise<InitialSessionResult> {
  if (!initialSessionRequest) {
    initialSessionRequest = (async () => {
      const id = localStorage.getItem("choosy-session");
      let response = id ? await fetch(`/api/shopping/sessions/${id}`) : null;
      if (!response?.ok) response = await fetch("/api/shopping/sessions", { method: "POST" });
      return { ok: response.ok, session: await response.json() as ShoppingSessionSnapshot & { error?: string } };
    })().catch((error) => {
      initialSessionRequest = null;
      throw error;
    });
  }
  return initialSessionRequest;
}

export default function Shopper() {
  const [session, setSession] = useState<ShoppingSessionSnapshot | null>(null); const [busy, setBusy] = useState(false); const [syncingPayment, setSyncingPayment] = useState(false); const [error, setError] = useState<string | null>(null); const [input, setInput] = useState(""); const [addons, setAddons] = useState<string[]>([]); const bottom = useRef<HTMLDivElement>(null); const paidCard = useRef<HTMLElement>(null); const paymentSyncInFlight = useRef(false);
  const sessionId = session?.id; const paymentPhase = session?.phase;
  useEffect(() => { let cancelled=false; async function restore(){ const { ok, session: result }=await loadInitialSession(); if(cancelled)return; if(!ok)setError(result.error??"Could not start shopping.");else{setSession(result);localStorage.setItem("choosy-session",result.id);} } void restore().catch(()=>{if(!cancelled)setError("Could not start shopping.");}); return()=>{cancelled=true;}; }, []);
  useEffect(() => { const container=bottom.current?.parentElement; if(container)container.scrollTop=container.scrollHeight; }, [session?.messages.length]);
  useEffect(() => {
    if (!sessionId || (paymentPhase !== "checkout_ready" && paymentPhase !== "payment_failed")) return;
    let cancelled = false;
    const returnedFromPayment = new URLSearchParams(window.location.search).get("payment_return") === "1";
    async function syncPayment() {
      if (paymentSyncInFlight.current) return;
      paymentSyncInFlight.current = true;
      if (returnedFromPayment) setSyncingPayment(true);
      try {
        const response = await fetch(`/api/shopping/sessions/${sessionId}/payment-status`, { method: "POST" });
        if (!response.ok || cancelled) return;
        const latest = await response.json() as ShoppingSessionSnapshot;
        setSession(latest);
        if (latest.phase === "paid") {
          const url = new URL(window.location.href);
          url.searchParams.delete("payment_return");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        }
      } finally {
        paymentSyncInFlight.current = false;
        if (!cancelled) setSyncingPayment(false);
      }
    }
    void syncPayment();
    const timer = window.setInterval(syncPayment, 3500);
    const onFocus = () => { void syncPayment(); };
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [sessionId, paymentPhase]);
  useEffect(() => { if (paymentPhase === "paid") paidCard.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [paymentPhase]);
  async function send(text: string, answerKey?: string, answerValue?: string) { if (!session || busy || !text.trim()) return; setBusy(true); setError(null); const response = await fetch(`/api/shopping/sessions/${session.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, answerKey, answerValue, expectedVersion: session.version, idempotencyKey: `msg:${crypto.randomUUID()}` }) }); const result = await response.json() as ShoppingSessionSnapshot & { error?: string }; if (!response.ok) setError(result.error ?? "That answer could not be processed."); else setSession(result); setInput(""); setBusy(false); }
  async function command(commandName: ShoppingCommand, payload?: Record<string, unknown>) {
    if (!session || busy) return;
    setBusy(true); setError(null);
    const idempotencyKey=`${commandName}:${crypto.randomUUID()}`;
    const submitCommand=(expectedVersion:number)=>fetch(`/api/shopping/sessions/${session.id}/commands`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:commandName,expectedVersion,idempotencyKey,payload})});
    let response=await submitCommand(session.version);
    if(response.status===409&&commandName==="confirm_cart"){
      const refreshed=await fetch(`/api/shopping/sessions/${session.id}`);
      if(refreshed.ok){const latest=await refreshed.json() as ShoppingSessionSnapshot;setSession(latest);response=await submitCommand(latest.version);}
    }
    const result=await response.json() as ShoppingSessionSnapshot&{error?:string};
    if(!response.ok)setError(result.error??"That action could not be completed.");
    else{setSession(result);if(commandName==="reset_session"){setAddons([]);setInput("");setSyncingPayment(false);}else if(commandName==="revise_preference")setAddons([]);if(commandName==="create_checkout"&&result.checkout?.shortUrl)window.location.assign(result.checkout.shortUrl);}
    setBusy(false);
  }
  function submit(event: FormEvent) { event.preventDefault(); void send(input); }
  const activeChoices = quickChoicesForQuestion(session?.activeQuestionKey ?? null, session?.profile.category ?? null);
  const selected = product(session?.selectedProductId ?? null);
  const questionKeys = session?.profile.category === "running-shoes"
    ? ["category", "maxBudgetPaise", "useCase", "size", "terrain", "support", "cushioning", "brandPreference"]
    : session?.profile.category === "phones"
      ? ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves", "os", "priority", "size"]
      : session?.profile.category === "headphones"
        ? ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves", "formFactor", "environment", "feature", "connectivity"]
        : ["category", "maxBudgetPaise", "useCase", "brandPreference", "mustHaves"];
  const questionTotal = questionKeys.length;
  const answeredCount = questionKeys.filter((key) => session?.profile.confirmedKeys.includes(key)).length;
  const completion = Math.round(answeredCount / questionTotal * 100);
  const recoveryExhausted = session?.audit.at(-1)?.evidence?.recoveryExhausted === true;
  const cartProducts = useMemo(() => session?.cart?.items.map((item) => ({ item, product: product(item.productId) })).filter((entry) => entry.product) ?? [], [session?.cart]);
  const preferenceChips = session ? [
    ...(session.profile.category ? [{ key: "category", value: session.profile.category.replace("-", " ") }] : []),
    ...(session.profile.maxBudgetPaise ? [{ key: "maxBudgetPaise", value: `Up to ${inr(session.profile.maxBudgetPaise)}` }] : []),
    ...(session.profile.useCase ? [{ key: "useCase", value: session.profile.useCase }] : []),
    ...(session.profile.brandPreference ? [{ key: "brandPreference", value: session.profile.brandPreference }] : []),
    ...(session.profile.mustHaves.length && session.profile.category !== "running-shoes" ? [{ key: "mustHaves", value: session.profile.mustHaves.join(", ") }] : []),
    ...Object.entries(session.profile.answers)
      .filter(([key]) => session.profile.category !== "running-shoes" || ["size", "terrain", "support", "cushioning"].includes(key))
      .map(([key, value]) => ({ key, value })),
  ] : [];

  return <main className="shop-shell"><header className="shop-header"><Link className="wordmark" href="/">choosy</Link><nav><Link href="/">Shop</Link><a href="#how">How it works</a><a href="#who">Who it’s for</a><Link href="/agent-buyer">Let AI do the work</Link><button className="reset-session-button" type="button" onClick={()=>command("reset_session")} disabled={!session||busy}><RotateCcw size={14}/> Reset session</button><Link className="merchant-link" href="/merchant"><LockKeyhole size={14}/> Merchant dashboard</Link></nav></header>
    <section className="shop-intro"><div><p className="eyebrow"><Sparkles size={14}/> Shopping made simpler</p><h1>Tell us what you need.<br/><em>We’ll narrow it down.</em></h1><p>Answer a few useful questions and Choosy will show products that fit your budget and priorities.</p></div><div className="trust-strip"><span><ShieldCheck size={17}/> Stays within budget</span><span><Check size={17}/> Checks price and stock</span><span><MessageCircle size={17}/> You approve before payment</span></div></section>
    <section className="experience-grid"><div className="conversation-panel"><header><div><span className="status-dot"/><b>Choosy</b></div><span>{session ? `${answeredCount} of ${questionTotal} details` : "Ready to help"}</span></header><div className="progress"><i style={{ width: `${completion}%` }}/></div><div className="messages">{!session&&<div className="loading-state"><LoaderCircle className="spin"/>Getting things ready…</div>}{session?.messages.map((item) => <div className={`message ${item.role}`} key={item.id}><span>{item.role === "assistant" ? "C" : "You"}</span><p>{item.text}</p></div>)}{session?.phase === "discovering" && session.messages.length === 1 && <div className="suggestions"><button onClick={()=>send("I need a phone under ₹50,000 for photography. No brand preference.")}>A camera phone under ₹50,000 <ChevronRight size={14}/></button><button onClick={()=>send("I need headphones for a noisy commute.")}>Headphones for commuting <ChevronRight size={14}/></button><button onClick={()=>send("Help me find running shoes.")}>Running shoes for daily training <ChevronRight size={14}/></button></div>}{activeChoices.length>0&&<div className="quick-choices">{activeChoices.map((choice)=><button key={choice} disabled={busy} onClick={()=>send(choice, session!.activeQuestionKey!, choice)}>{choice}</button>)}</div>}{recoveryExhausted&&<div className="suggestions"><button disabled={busy} onClick={()=>command("reset_session")}><span>Start a new search</span><RotateCcw size={14}/></button></div>}{busy&&<div className="message assistant"><span>C</span><p><LoaderCircle className="spin" size={16}/> Finding what fits…</p></div>}<div ref={bottom}/></div><form className="composer" onSubmit={submit}><input value={input} onChange={(event)=>setInput(event.target.value)} placeholder={recoveryExhausted?"Or tell me what you want to change…":"Type your answer…"} disabled={!session||busy||(session.phase!=="discovering"&&session.phase!=="agent_failure")}/><button aria-label="Send" disabled={!input.trim()||busy}><ArrowRight size={18}/></button></form>{error&&<p className="inline-error">{error}</p>}<footer><ShieldCheck size={14}/> Your choices guide the results. Price and stock are checked before checkout.</footer></div>
      <div className="decision-panel">{!session?.recommendations.length&&<div className="empty-decision"><div className="orb"><ShoppingBag size={28}/></div><h2>Your matches will appear here.</h2><p>Tell Choosy what matters to you. We’ll wait until we have enough information to show useful options.</p></div>}{session&&session.recommendations.length>0&&<><div className="decision-heading"><div><p className="eyebrow">Your matches</p><h2>{session.phase === "needs_reselection" ? "Here are your updated options." : `${session.recommendations.length} ranked ${session.recommendations.length === 1 ? "match" : "matches"} for you.`}</h2></div><button className="text-button" onClick={()=>command("reset_session")}><RotateCcw size={14}/> Start over</button></div><div className="preference-chips" aria-label="Editable preferences">{preferenceChips.map((chip)=><button key={chip.key} onClick={()=>command("revise_preference",{key:chip.key})} title={`Edit ${chip.value}`}>{chip.value}<span aria-hidden="true">×</span></button>)}</div><div className="catalog-truth">Ranked by fit, budget and stock · Prices checked 3 Sep 2026</div><div className="product-grid">{session.recommendations.map((recommendation)=>{const item=product(recommendation.productId)!; const variant=item.variants.find((entry)=>entry.id===recommendation.variantId)!; const isSelected=session.selectedProductId===item.id; const source=productSource(item); return <article className={`product-card ${isSelected?"selected":""}`} key={item.id}><div className="product-image"><img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(e) => { const target = e.currentTarget; const fallback = `/products/${item.category}.png`; if (target.src !== fallback) { target.src = fallback; } }}/><span>{recommendation.label}</span></div><div className="product-copy"><small>{item.brand}</small><h3>{item.name}</h3><div className="price-row"><strong>{inr(variant.pricePaise)}</strong><span>{recommendation.fitScore}% match</span></div><details className="match-details"><summary>Why this match?</summary><p>{recommendation.reason}</p><ul>{recommendation.matchedNeeds.slice(0,3).map((need)=><li key={need}><Check size={13}/>{need}</li>)}</ul><div className="tradeoff"><b>Worth knowing</b>{recommendation.tradeoff}</div>{recommendation.promotionInfluencedTie&&<small className="promotion-note">A promoted item won a close match. Fit and budget still came first.</small>}</details>{source&&<details className="product-details"><summary>Product details</summary><a className="product-source" href={source} target="_blank" rel="noreferrer">View the official product page ↗</a></details>}<button disabled={busy||isSelected} onClick={()=>command("select_product",{productId:item.id})}>{isSelected?"Selected":"Choose this"}<ArrowRight size={15}/></button></div></article>})}</div>{session.phase==="item_selected"&&selected&&<section className="addon-section"><div><p className="eyebrow">Optional extras</p><h3>Add something useful, or keep it simple.</h3></div><div className="addon-list">{session.offeredAddonIds.map((id)=>{const item=product(id)!; const checked=addons.includes(id); return <button className={checked?"active":""} key={id} onClick={()=>setAddons((current)=>checked?current.filter((entry)=>entry!==id):[...current,id].slice(0,2))}><span>{checked?<Check size={15}/>:<b>+</b>}</span><div><strong>{item.name}</strong><small>{inr(item.variants[0]!.pricePaise)}</small></div></button>})}</div><button className="primary-button" onClick={()=>command("set_addons",{addonIds:addons})}>Review {addons.length?"your cart":"this item"}<ArrowRight size={16}/></button></section>}{session.cart&&session.phase==="cart_review"&&<section className="cart-card"><header><div><p className="eyebrow">Your cart</p><h3>{session.quote?"Ready for checkout":"Review before payment"}</h3></div><ShoppingBag/></header>{cartProducts.map(({item,product:itemProduct})=><div className="cart-line" key={item.productId}><span>{itemProduct!.name}<small>{item.kind}</small></span><b>{inr(item.unitPricePaise)}</b></div>)}<div className="cart-total"><span>Test total</span><strong>{inr(session.cart.totalPaise)}</strong></div>{!session.quote?<button className="primary-button" onClick={()=>command("confirm_cart")}>Confirm this cart <ShieldCheck size={16}/></button>:<button className="razorpay-button" onClick={()=>command("create_checkout")}>Continue to Razorpay <ArrowRight size={17}/></button>}<small>No personal or payment details are collected in this chat.</small></section>}{session.phase==="checkout_ready"&&session.checkout?.shortUrl&&<section className="checkout-ready"><ShieldCheck/><div><p className="eyebrow">{syncingPayment?"Confirming payment":"Ready to pay"}</p><h3>{syncingPayment?"Checking with Razorpay…":"Your Razorpay checkout is ready."}</h3><p>{syncingPayment?"This usually takes just a moment.":"Review the final cart and amount before paying."}</p><a href={session.checkout.shortUrl} target="_blank" rel="noreferrer">Open checkout <ArrowRight size={16}/></a></div></section>}{session.phase==="payment_failed"&&<section className="checkout-ready failure"><ShieldCheck/><div><p className="eyebrow">Nothing was charged</p><h3>Razorpay is temporarily unavailable.</h3><p>Your cart is saved, so you can try again.</p><button className="primary-button" onClick={()=>command("retry_payment")}>Try again <ArrowRight size={16}/></button></div></section>}{session.phase==="paid"&&<section className="order-confirmed" ref={paidCard} aria-live="polite"><div className="confirmation-confetti" aria-hidden="true">{Array.from({length:18},(_,index)=><i key={index} style={{left:`${5+(index*17)%91}%`,animationDelay:`${(index%6)*.12}s`,background:["#2b6cf6","#6dd3a0","#ffca58","#ff7b8a"][index%4]}}/>)}</div><div className="confirmation-icon"><PartyPopper size={34}/></div><p className="eyebrow">Payment confirmed</p><h3>Your order is placed!</h3><p className="confirmation-copy">Razorpay confirmed your payment. We’ve saved the order and updated its status.</p><div className="confirmation-summary"><div><span>Order</span><strong>{selected?.name??"Choosy order"}</strong></div><div><span>Amount paid</span><strong>{session.checkout?inr(session.checkout.amountPaise):"Confirmed"}</strong></div><div><span>Reference</span><strong>{session.checkout?.referenceId??session.id}</strong></div></div><button className="primary-button" disabled={busy} onClick={()=>command("reset_session")}><RotateCcw size={15}/> Start another search</button></section>}</>}</div></section>
    <section id="who" className="audience-section">
      <div className="audience-panel">
        <header className="audience-intro">
          <div>
            <p>Built to travel</p>
            <h2>Who is Choosy for?</h2>
          </div>
          <p>For anyone who already helps people decide what to buy. Choosy turns that recommendation into a guided, trackable checkout.</p>
        </header>
        <div className="audience-grid">
          <article>
            <span><UsersRound size={17}/> Creators &amp; affiliates</span>
            <h3>Turn influence into a storefront.</h3>
            <p>Add a Choosy snippet or tracked link to a product page, link-in-bio or content site. Followers get a useful recommendation, not another ad.</p>
          </article>
          <article>
            <span><Store size={17}/> Brands &amp; merchants</span>
            <h3>Guide shoppers to the right product.</h3>
            <p>Use the same flow on a store, campaign or partner page to reduce choice overload and move qualified buyers to checkout.</p>
          </article>
          <article>
            <span><Code2 size={17}/> The platform model</span>
            <h3>One click, attributed through payment.</h3>
            <p>Choosy records the source, Razorpay completes the payment, and a commission can be shared on every attributed sale.</p>
          </article>
        </div>
        <div className="audience-flow" aria-label="Choosy affiliate flow"><span>Recommend</span><ArrowRight size={14}/><span>Attribute</span><ArrowRight size={14}/><span>Pay with Razorpay</span><ArrowRight size={14}/><span>Share commission</span></div>
      </div>
    </section>
    <section id="how" className="process-section">
      <div className="process-panel">
        <header className="process-intro">
          <p>How it works</p>
          <h2>From request<br/>to checkout.</h2>
        </header>
        <div className="process-steps" aria-label="How Choosy works">
          <article><span>01</span><h3>Ask</h3><p>Share your need and budget.</p></article>
          <article><span>02</span><h3>Compare</h3><p>See three ranked matches.</p></article>
          <article><span>03</span><h3>Approve</h3><p>Choose, then pay with Razorpay.</p></article>
        </div>
        <div className="process-proof"><ShieldCheck size={16}/><span>Fit first. Price and stock checked before payment.</span></div>
      </div>
    </section></main>;
}
