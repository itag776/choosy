"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, Check, ExternalLink, LoaderCircle, ShieldCheck } from "lucide-react";
import type { BuyerRun } from "@/lib/types";

const DEMO_GOAL = "Buy the best Android camera phone under ₹50,000 and add protection if the total remains within budget.";
function inr(value: number) { return `₹${Math.round(value / 100).toLocaleString("en-IN")}`; }

export default function AgentBuyer({ initialRunId, returnedFromPayment = false }: { initialRunId?: string; returnedFromPayment?: boolean }) {
  const [goal, setGoal] = useState(DEMO_GOAL);
  const [run, setRun] = useState<BuyerRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(initialRunId));
  const [error, setError] = useState<string | null>(null);
  const runId = run?.id;
  const runStatus = run?.status;

  useEffect(() => {
    if (!initialRunId) return;
    let cancelled = false;
    void fetch(`/api/buyer/runs/${initialRunId}`).then(async (response) => {
      const result = await response.json() as BuyerRun & { error?: string };
      if (cancelled) return;
      if (response.ok) setRun(result); else setError(result.error ?? "The returned buyer run could not be restored.");
    }).catch(() => { if (!cancelled) setError("The returned buyer run could not be restored."); }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [initialRunId]);

  useEffect(() => {
    if (!runId || !["approved", "checkout_ready"].includes(runStatus ?? "")) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/buyer/runs/${runId}`);
      if (response.ok) setRun(await response.json() as BuyerRun);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  async function plan(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null); setRun(null);
    const response = await fetch("/api/buyer/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
    const result = await response.json() as BuyerRun & { error?: string };
    if (response.ok) setRun(result); else setError(result.error ?? "Choosy could not plan this purchase.");
    setBusy(false);
  }
  async function approve() {
    if (!run?.quote || busy) return; setBusy(true); setError(null);
    const response = await fetch(`/api/buyer/runs/${run.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: true, acceptedQuoteDigest: run.quote.digest }) });
    const result = await response.json() as BuyerRun & { error?: string };
    if (response.ok) setRun(result); else setError(result.error ?? "The exact quote could not be approved.");
    setBusy(false);
  }

  return <main className="buyer-shell">
    <header className="buyer-header"><Link className="wordmark" href="/">choosy</Link><nav><Link href="/"><ArrowLeft size={14}/>Shop</Link><Link href="/evidence">How we test</Link><Link href="/merchant">Merchant dashboard</Link></nav></header>
    <section className="buyer-hero"><p className="eyebrow"><Bot size={14}/> AI purchase demo</p><h1>Set the goal.<br/><em>Approve the purchase.</em></h1><p>Choosy can compare products and prepare a cart. It cannot check out until you approve the exact items and total.</p></section>
    <section className="buyer-layout">
      <article className="buyer-panel"><p className="eyebrow">Your request</p><h2>What should Choosy look for?</h2><form onSubmit={plan}><textarea value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={500}/><div className="demo-goal">Example: find one camera phone and a protective case for less than ₹50,000.</div><button disabled={busy || goal.trim().length < 10}>{busy ? <LoaderCircle className="spin" size={16}/> : <Bot size={16}/>} {busy ? "Comparing options…" : "Find the best option"}</button></form>{error && <p className="buyer-error">{error}</p>}</article>
      <article className="buyer-proof">
        {!run && !busy && !restoring && <div className="buyer-empty"><div><Bot size={32}/><h2>Your plan will appear here.</h2><p>Choosy will show the suggested items and total before asking for approval.</p></div></div>}
        {restoring && <div className="buyer-empty"><div><LoaderCircle className="spin" size={32}/><h2>Checking your payment…</h2><p>Waiting for confirmation from Razorpay.</p></div></div>}
        {busy && !run && <div className="buyer-empty"><div><LoaderCircle className="spin" size={32}/><h2>Choosy is comparing options…</h2></div></div>}
        {run && <>
          <header><p className="eyebrow">Your plan</p><span className="buyer-status">{run.status.replaceAll("_", " ")}</span></header>
          {run.proposal && run.quote && <section className="proposal-card"><header><div><p className="eyebrow">Best match</p><h2>{run.proposal.summary}</h2><p>{run.proposal.reason}</p></div><ShieldCheck/></header>{run.proposal.items.map((item) => <div className="proposal-line" key={item.productId}><span><b>{item.name}</b><small>{item.kind}</small></span><b>{inr(item.unitPricePaise)}</b></div>)}<div className="proposal-total"><span>Total</span><strong>{inr(run.proposal.totalPaise)}</strong></div><p><b>Worth knowing:</b> {run.proposal.tradeoff}</p></section>}
          {run.status === "awaiting_approval" && run.quote && <section className="approval-card"><p className="eyebrow">Your approval is required</p><h2>Nothing will be purchased yet.</h2><p>Confirm these items and the total. Price and stock will be checked once more before checkout.</p><button onClick={approve} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <ShieldCheck size={16}/>} Approve this cart</button></section>}
          {run.status === "checkout_ready" && run.checkout?.shortUrl && <section className="paid-proof">{returnedFromPayment ? <LoaderCircle className="spin"/> : <Check/>}<h2>{returnedFromPayment ? "Checking your payment…" : "Your checkout is ready."}</h2><p>{returnedFromPayment ? "This page will update when Razorpay confirms the payment." : "Review the final items and total on Razorpay before paying."}</p><a href={run.checkout.shortUrl}>Open Razorpay <ExternalLink size={15}/></a></section>}
          {run.status === "paid" && <section className="paid-proof"><Check/><h2>Payment confirmed.</h2><p>Razorpay confirmed this test payment.</p><Link href="/merchant">View the audit trail <ArrowRight size={14}/></Link></section>}
          {(run.status === "blocked" || run.status === "failed") && <section className="blocked-proof"><h2>{run.status === "blocked" ? "Checkout was not created." : "Choosy could not finish this plan."}</h2><p>{run.failureReason}</p><button onClick={() => setRun(null)}>Start again</button></section>}
          <details className="technical-details"><summary>Technical details</summary><div className="trace-list">{run.trace.map((item, index) => <div className="trace-item" key={item.id}><span>{index + 1}</span><div><b>{item.tool.replaceAll("_", " ")}</b><p>{item.summary}</p></div><time>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>)}</div>{run.quote&&<dl><div><dt>Plan ID</dt><dd>{run.id}</dd></div><div><dt>Quote fingerprint</dt><dd>{run.quote.digest}</dd></div>{run.sessionId&&<div><dt>Session ID</dt><dd>{run.sessionId}</dd></div>}</dl>}</details>
        </>}
      </article>
    </section>
    <p className="buyer-disclaimer">Demo only: current product names, saved test prices, simulated stock, and Razorpay Test Mode. No personal or payment details are shared with Choosy.</p>
  </main>;
}
