"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, Check, Download, ExternalLink, LogOut, PackageX,
  RefreshCw, ShieldCheck, Sparkles, WalletCards,
} from "lucide-react";
import { DEMO_CATALOG } from "@/lib/catalog";
import type { GrowthBenchmarkReport, MerchantDashboard, OperatorIdentity } from "@/lib/types";

function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function inr(value: number): string { return `₹${Math.round(value / 100).toLocaleString("en-IN")}`; }
function productName(id: string | null): string { return DEMO_CATALOG.find((item) => item.id === id)?.name ?? "No product selected"; }
function actorLabel(actor: string): string { return ({ shopper: "Shopper", agent: "Choosy", buyer_agent: "AI purchase demo", system: "Choosy", merchant: "Merchant", razorpay: "Razorpay" } as Record<string, string>)[actor] ?? actor; }

export default function MerchantCockpit({ initialDashboard, operator, benchmark }: {
  initialDashboard: MerchantDashboard;
  operator: OperatorIdentity;
  benchmark: GrowthBenchmarkReport;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedId, setSelectedId] = useState(initialDashboard.sessions[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [showTechnical, setShowTechnical] = useState(false);
  const selected = useMemo(() => dashboard.sessions.find((item) => item.id === selectedId) ?? dashboard.sessions[0], [dashboard, selectedId]);
  const filteredAudit = useMemo(() => selected?.audit.filter((event) => (actionFilter === "all" || event.kind === actionFilter) && (outcomeFilter === "all" || event.status === outcomeFilter)) ?? [], [selected, actionFilter, outcomeFilter]);
  const integrity = selected ? dashboard.auditIntegrity[selected.id] : undefined;
  const integrityMessage = integrity?.verified
    ? integrity.source === "supabase_ledger"
      ? `${integrity.eventCount} events in the correct order. Nothing is missing or changed.`
      : `${integrity.eventCount} local events pass the integrity check. Durable append-only storage requires the production Supabase ledger.`
    : integrity?.issue ?? "The ledger could not be verified.";

  async function refresh() {
    setBusy(true);
    const response = await fetch("/api/merchant/dashboard");
    const result = await response.json() as MerchantDashboard & { error?: string };
    if (response.ok) setDashboard(result); else setError(result.error ?? "Refresh failed.");
    setBusy(false);
  }
  async function makeUnavailable() {
    if (!selected) return;
    setBusy(true); setError(null);
    const response = await fetch("/api/merchant/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: selected.id, action: "mark_selected_unavailable" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "Inventory action failed.");
    await refresh(); setBusy(false);
  }
  async function restoreInventory() {
    if (!selected) return;
    setBusy(true); setError(null);
    const response = await fetch("/api/merchant/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: selected.id, action: "restore_demo_inventory" }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "Inventory restore failed.");
    await refresh(); setBusy(false);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.reload(); }
  function downloadAudit() {
    if (!selected || !integrity?.verified) return;
    const blob = new Blob([JSON.stringify({ sessionId: selected.id, integrity, events: selected.audit }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `choosy-audit-${selected.id}.json`; link.click(); URL.revokeObjectURL(url);
  }
  const metrics = dashboard.metrics;

  return <main className="cockpit">
    <header className="cockpit-header"><div><a className="wordmark light" href="/">choosy</a><span>Merchant dashboard</span></div><nav><a href="/"><ArrowLeft size={14}/>Shop</a><span>{operator.actorId}</span><button onClick={logout}><LogOut size={14}/>Sign out</button></nav></header>
    <section className="cockpit-hero"><div><p className="eyebrow"><Sparkles size={14}/> Merchant dashboard</p><h1>See what happened,<br/><em>step by step.</em></h1><p>Review demo shopping sessions, payments, and the verified history behind every action.</p><p><a href="/agent-buyer">AI purchase demo</a> · <a href="/evidence">How we test</a></p></div><details className="system-status"><summary>System status</summary><div className="integration-row">{Object.entries(dashboard.integration).map(([key, value]) => <span key={key}><i className={value ? "on" : ""}/>{key}<b>{String(value).replace("_", " ")}</b></span>)}</div></details></section>
    <section className="benchmark-banner"><div><p className="eyebrow">Test results</p><strong>{benchmark.choosy.completedPurchases}/{benchmark.datasetSize} successful baskets</strong><span>Fixed scenarios, separate from live demo activity</span></div><a href="/evidence">See how we test <ExternalLink size={13}/></a><span className={dashboard.auditChainsValid ? "chain-ok" : "chain-bad"}>{dashboard.auditChainsValid ? <ShieldCheck size={14}/> : <AlertTriangle size={14}/>} {dashboard.auditChainsValid ? "All audits verified" : "Audit problem detected"}</span></section>
    <section className="metric-grid"><article><Activity/><span>Sessions</span><strong>{metrics.totalSessions}</strong><small>Demo shopping journeys</small></article><article><Sparkles/><span>Received matches</span><strong>{percent(metrics.recommendationRate)}</strong><small>Reached product suggestions</small></article><article><WalletCards/><span>Reached checkout</span><strong>{percent(metrics.checkoutRate)}</strong><small>Razorpay checkout created</small></article><article><Check/><span>Test payments</span><strong>{inr(metrics.paidTestModePaise)}</strong><small>Razorpay Test Mode only</small></article></section>
    <section className="cockpit-grid">
      <aside className="session-list"><header><div><p className="eyebrow">Recent activity</p><h2>Customer journeys</h2></div><button aria-label="Refresh sessions" onClick={refresh} disabled={busy}><RefreshCw className={busy ? "spin" : ""} size={15}/></button></header>{dashboard.sessions.length === 0 && <div className="empty-list">Start a shopping session to see its history here.</div>}{dashboard.sessions.map((session) => <button key={session.id} className={selected?.id === session.id ? "active" : ""} onClick={() => setSelectedId(session.id)}><span><i/>{session.phase.replaceAll("_", " ")}</span><strong>{productName(session.selectedProductId)}</strong><small>{session.profile.category?.replace("-", " ") ?? "Learning what they need"} · {session.audit.length} events</small></button>)}</aside>
      <div className="audit-panel">
        <header><div><p className="eyebrow">Complete history</p><h2>Audit trail</h2></div>{selected && <div className="audit-filter"><select aria-label="Filter by action type" value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}><option value="all">All actions</option><option value="session">Session</option><option value="shopper">Shopping choices</option><option value="agent">Choosy activity</option><option value="catalog">Product matches</option><option value="policy">Safeguards</option><option value="cart">Cart</option><option value="inventory">Price and stock</option><option value="razorpay">Payments</option><option value="webhook">Payment updates</option><option value="guardrail">Stopped actions</option></select><select aria-label="Filter by outcome" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value)}><option value="all">All outcomes</option><option value="info">Information</option><option value="success">Successful</option><option value="warning">Warning</option><option value="blocked">Blocked</option></select><button className={showTechnical ? "active" : ""} onClick={()=>setShowTechnical((value)=>!value)}>Technical details</button><button aria-label="Download verified audit" disabled={!integrity?.verified} onClick={downloadAudit}><Download size={14}/></button></div>}</header>
        {selected ? <>
          <div className={`audit-integrity ${integrity?.verified ? "verified" : "failed"}`}>{integrity?.verified ? <ShieldCheck size={18}/> : <AlertTriangle size={18}/>}<div><b>{integrity?.verified ? "Audit verified" : "Audit problem detected"}</b><span>{integrityMessage}</span></div></div>
          <div className="session-summary"><div><span>Phase</span><b>{selected.phase.replaceAll("_", " ")}</b></div><div><span>Origin</span><b>{(selected.origin ?? "shopper_ui").replaceAll("_", " ")}</b></div><div><span>Selected</span><b>{productName(selected.selectedProductId)}</b></div><div><span>Cart</span><b>{selected.cart ? inr(selected.cart.totalPaise) : "Not built"}</b></div></div>
          {selected.checkout && <section className="payment-proof"><header><span><ShieldCheck size={14}/>Payment summary</span><b>{selected.checkout.status}</b></header><dl><div><dt>Amount</dt><dd>{inr(selected.checkout.amountPaise)}</dd></div><div><dt>Razorpay ID</dt><dd>{selected.checkout.providerId ?? "Waiting for Razorpay"}</dd></div>{showTechnical&&<><div><dt>Reference</dt><dd>{selected.checkout.referenceId}</dd></div><div><dt>Cart fingerprint</dt><dd>{selected.checkout.cartDigest}</dd></div><div><dt>Quote fingerprint</dt><dd>{selected.checkout.quoteDigest}</dd></div>{selected.buyerRunId && <div><dt>Plan ID</dt><dd>{selected.buyerRunId}</dd></div>}</>}</dl></section>}
          <section className="demo-control"><div><PackageX/><span><b>Demo inventory controls</b><small>Test what happens when a selected item goes out of stock before checkout.</small></span></div><div><button disabled={busy || !selected.selectedVariantId || selected.phase === "paid"} onClick={makeUnavailable}>Mark unavailable</button><button disabled={busy} onClick={restoreInventory}>Restore stock</button></div></section>
          {error && <p className="form-error">{error}</p>}
          <div className="audit-list">{filteredAudit.map((event) => <details className="audit-event" key={event.id}><summary><span className={`audit-icon ${event.status}`}>{event.status === "blocked" ? <AlertTriangle size={15}/> : <ShieldCheck size={15}/>}</span><span className="audit-sequence">#{event.sequence}</span><span className="audit-title"><b>{event.title}</b><small>{actorLabel(event.actor)} · <span className={`audit-outcome ${event.status}`}>{event.status}</span></small></span><time>{new Date(event.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "long" })}</time></summary><div className="audit-body"><p>{event.detail}</p>{showTechnical&&<div className="audit-technical"><dl><div><dt>Event type</dt><dd>{event.kind}</dd></div><div><dt>Schema version</dt><dd>{event.schemaVersion ?? "Legacy event"}</dd></div><div><dt>Session version</dt><dd>{event.sessionVersion ?? "Legacy event"}</dd></div><div><dt>Previous hash</dt><dd>{event.previousHash}</dd></div><div><dt>Current hash</dt><dd>{event.hash}</dd></div></dl>{event.evidence&&<><b>Evidence</b><pre>{JSON.stringify(event.evidence,null,2)}</pre></>}</div>}</div></details>)}</div>
        </> : <div className="empty-audit"><ShieldCheck/><h3>No journey selected</h3><p>Choose a journey to see its full history.</p></div>}
      </div>
    </section>
    <footer className="cockpit-footer"><span>Choosy merchant dashboard</span><a href="/agent-api">For developers <ExternalLink size={13}/></a></footer>
  </main>;
}
