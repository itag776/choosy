"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, Info, Package, RefreshCw, ShieldCheck, ShoppingBag, WalletCards, XCircle } from "lucide-react";
import { DEMO_CATALOG } from "@/lib/catalog";
import type { CommerceAuditEvent, GrowthBenchmarkReport, MerchantDashboard, ShoppingPhase } from "@/lib/types";
import styles from "./merchant.module.css";

function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function inr(value: number): string { return `₹${Math.round(value / 100).toLocaleString("en-IN")}`; }
function productName(id: string | null): string { return DEMO_CATALOG.find((item) => item.id === id)?.name ?? "No product selected"; }
function actorLabel(actor: string): string { return ({ shopper: "Shopper", agent: "Choosy", buyer_agent: "AI buyer", system: "Choosy", merchant: "Merchant", razorpay: "Razorpay" } as Record<string, string>)[actor] ?? actor; }
function humanize(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

type PhaseTone = "info" | "progress" | "pending" | "success" | "danger";
const PHASE_PRESENTATION: Record<ShoppingPhase, { label: string; detail: string; tone: PhaseTone; closed: boolean }> = {
  discovering: { label: "In progress", detail: "Collecting preferences", tone: "info", closed: false },
  recommendations_ready: { label: "Ready to choose", detail: "Recommendations ready", tone: "progress", closed: false },
  item_selected: { label: "In progress", detail: "Item selected", tone: "progress", closed: false },
  cart_review: { label: "Awaiting confirmation", detail: "Cart review", tone: "pending", closed: false },
  checkout_creating: { label: "Processing", detail: "Creating checkout", tone: "pending", closed: false },
  checkout_ready: { label: "Payment pending", detail: "Checkout ready", tone: "pending", closed: false },
  needs_reselection: { label: "Action required", detail: "New selection needed", tone: "danger", closed: false },
  payment_failed: { label: "Action required", detail: "Payment failed", tone: "danger", closed: false },
  paid: { label: "Session closed", detail: "Paid", tone: "success", closed: true },
  agent_failure: { label: "Action required", detail: "Agent failure", tone: "danger", closed: false },
};

function phaseToneClass(tone: PhaseTone): string {
  return ({ info: styles.phaseInfo, progress: styles.phaseProgress, pending: styles.phasePending, success: styles.phaseSuccess, danger: styles.phaseDanger })[tone];
}

function auditToneClass(status: CommerceAuditEvent["status"]): string {
  return ({ info: styles.eventInfo, success: styles.eventSuccess, warning: styles.eventWarning, blocked: styles.eventBlocked })[status];
}

function auditIcon(status: CommerceAuditEvent["status"]) {
  if (status === "blocked") return <XCircle size={15}/>;
  if (status === "warning") return <AlertTriangle size={15}/>;
  if (status === "info") return <Info size={15}/>;
  return <CheckCircle2 size={15}/>;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function journeyName(session: MerchantDashboard["sessions"][number]): string {
  if (session.selectedProductId) return productName(session.selectedProductId);
  if (session.phase === "needs_reselection") return "New selection needed";
  if (session.phase === "payment_failed") return "Payment was not completed";
  if (session.phase === "agent_failure") return "Session needs attention";
  if (session.recommendations.length) return `${session.recommendations.length} recommendations ready`;
  return "Preferences in progress";
}

export default function MerchantCockpit({ initialDashboard, benchmark }: { initialDashboard: MerchantDashboard; benchmark: GrowthBenchmarkReport; }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [selectedId, setSelectedId] = useState(initialDashboard.sessions[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [showTechnical, setShowTechnical] = useState(false);
  const selected = useMemo(() => dashboard.sessions.find((item) => item.id === selectedId) ?? dashboard.sessions[0], [dashboard, selectedId]);
  const filteredAudit = useMemo(() => selected?.audit.filter((event) => outcomeFilter === "all" || event.status === outcomeFilter) ?? [], [selected, outcomeFilter]);
  const integrity = selected ? dashboard.auditIntegrity[selected.id] : undefined;
  const metrics = dashboard.metrics;

  async function refresh() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/merchant/dashboard");
      const result = await response.json() as MerchantDashboard & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Refresh failed.");
      setDashboard(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Refresh failed."); }
    finally { setBusy(false); }
  }

  async function updateInventory(action: "mark_selected_unavailable" | "restore_demo_inventory") {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/merchant/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: selected.id, action }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Inventory update failed.");
      const dashboardResponse = await fetch("/api/merchant/dashboard");
      const nextDashboard = await dashboardResponse.json() as MerchantDashboard & { error?: string };
      if (!dashboardResponse.ok) throw new Error(nextDashboard.error ?? "Refresh failed.");
      setDashboard(nextDashboard);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Inventory update failed."); }
    finally { setBusy(false); }
  }

  function downloadAudit() {
    if (!selected || !integrity?.verified) return;
    const blob = new Blob([JSON.stringify({ sessionId: selected.id, integrity, events: selected.audit }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `choosy-audit-${selected.id}.json`; link.click(); URL.revokeObjectURL(url);
  }

  return <main className={styles.dashboard}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="Choosy home">choosy</Link>
      <div className={styles.topbarActions}><Link className={styles.textLink} href="/"><ArrowLeft size={16}/> Store</Link></div>
    </header>

    <div className={styles.page}>
      <section className={styles.pageHeader}><div><p className={styles.kicker}>Merchant dashboard</p><h1>Good to see you.</h1><p>Here&apos;s what&apos;s happening with your store today.</p></div><button className={styles.primaryButton} onClick={refresh} disabled={busy}><RefreshCw className={busy ? styles.spin : ""} size={16}/> Refresh</button></section>
      {error && <div className={styles.error}><AlertTriangle size={17}/>{error}</div>}

      <section className={styles.metrics} aria-label="Store summary">
        <article><span className={styles.metricIcon}><ShoppingBag size={19}/></span><div><p>Shopping sessions</p><strong>{metrics.totalSessions}</strong><small>Customer journeys</small></div></article>
        <article><span className={styles.metricIcon}><CheckCircle2 size={19}/></span><div><p>Found a match</p><strong>{percent(metrics.recommendationRate)}</strong><small>Reached recommendations</small></div></article>
        <article><span className={styles.metricIcon}><WalletCards size={19}/></span><div><p>Reached checkout</p><strong>{percent(metrics.checkoutRate)}</strong><small>Checkout created</small></div></article>
        <article><span className={styles.metricIcon}><ShieldCheck size={19}/></span><div><p>Test payments</p><strong>{inr(metrics.paidTestModePaise)}</strong><small>Razorpay test mode</small></div></article>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.journeys}>
          <div className={styles.sectionHeading}><div><p className={styles.kicker}>Recent activity</p><h2>Customer journeys</h2></div><span>{dashboard.sessions.length}</span></div>
          <div className={styles.journeyList}>
            {dashboard.sessions.length === 0 && <p className={styles.empty}>New shopping sessions will appear here.</p>}
            {dashboard.sessions.map((session) => {
              const presentation = PHASE_PRESENTATION[session.phase];
              return <button key={session.id} className={selected?.id === session.id ? styles.selectedJourney : ""} onClick={() => setSelectedId(session.id)}>
                <span className={`${styles.journeyTopline} ${phaseToneClass(presentation.tone)}`}>
                  <span className={styles.statusDot}/>{presentation.label}
                </span>
                <strong>{journeyName(session)}</strong>
                <small>{presentation.detail} · {session.profile.category?.replace("-", " ") ?? "No category yet"}</small>
              </button>;
            })}
          </div>
        </aside>

        <section className={styles.detail}>
          {!selected ? <div className={styles.emptyDetail}><ShoppingBag size={24}/><h2>No journey selected</h2><p>Choose a customer journey to view it.</p></div> : <>
            <header className={styles.detailHeader}>
              <div><p className={styles.kicker}>Selected journey</p><h2>{journeyName(selected)}</h2></div>
              <span className={`${styles.phaseBadge} ${phaseToneClass(PHASE_PRESENTATION[selected.phase].tone)}`}>
                <span className={styles.statusDot}/>{PHASE_PRESENTATION[selected.phase].label}
              </span>
            </header>
            <div className={styles.summaryRow}>
              <div><span>Cart value</span><strong>{selected.cart ? inr(selected.cart.totalPaise) : "Not created"}</strong></div>
              <div><span>Started from</span><strong>{humanize(selected.origin ?? "shopper_ui")}</strong></div>
              <div><span>Audit trail</span><strong>{selected.audit.length} records</strong></div>
              <div><span>Demo checks</span><strong>{benchmark.choosy.completedPurchases}/{benchmark.datasetSize} passed</strong></div>
            </div>
            {PHASE_PRESENTATION[selected.phase].closed && <div className={`${styles.sessionNotice} ${phaseToneClass("success")}`}>
              <CheckCircle2 size={18}/><div><strong>Session closed</strong><span>Payment was confirmed and this customer journey is complete.</span></div>
            </div>}
            {PHASE_PRESENTATION[selected.phase].tone === "danger" && <div className={`${styles.sessionNotice} ${phaseToneClass("danger")}`}>
              <AlertTriangle size={18}/><div><strong>Session needs attention</strong><span>{PHASE_PRESENTATION[selected.phase].detail}. Review the latest blocked or warning record below.</span></div>
            </div>}
            <div className={integrity?.verified ? styles.integrity : styles.integrityWarning}>{integrity?.verified ? <ShieldCheck size={18}/> : <AlertTriangle size={18}/>}<div><strong>{integrity?.verified ? "Activity verified" : "Activity needs attention"}</strong><span>{integrity?.verified ? `${integrity.eventCount} events are complete and in order.` : integrity?.issue ?? "The activity history could not be verified."}</span></div></div>
            {selected.checkout && <section className={styles.paymentCard}><span className={styles.paymentIcon}><WalletCards size={20}/></span><div><span>Payment</span><strong>{inr(selected.checkout.amountPaise)}</strong><small>{selected.checkout.providerId ?? "Waiting for Razorpay"}</small></div><span className={`${styles.paymentStatus} ${phaseToneClass(selected.checkout.status === "paid" ? "success" : selected.checkout.status === "failed" ? "danger" : "pending")}`}>{humanize(selected.checkout.status)}</span></section>}

            <section className={styles.activitySection}>
              <div className={styles.activityHeader}>
                <div><p className={styles.kicker}>Verified history</p><h3>Audit trail</h3><p className={styles.auditIntro}>Chronological, append-only records for session <span>{selected.id}</span>.</p></div>
                <div className={styles.filters}><label><span className={styles.srOnly}>Filter audit records</span><select value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value)}><option value="all">All records</option><option value="success">Successful</option><option value="warning">Warnings</option><option value="blocked">Blocked</option><option value="info">Information</option></select><ChevronDown size={14}/></label><button className={styles.secondaryButton} onClick={() => setShowTechnical((value) => !value)}>{showTechnical ? "Hide technical data" : "Show technical data"}</button><button className={styles.iconButtonLight} onClick={downloadAudit} disabled={!integrity?.verified} aria-label="Download verified audit trail"><Download size={16}/></button></div>
              </div>
              <div className={styles.timeline}>
                {filteredAudit.map((event) => <details className={styles.event} key={event.id}>
                  <summary>
                    <span className={`${styles.eventIcon} ${auditToneClass(event.status)}`}>{auditIcon(event.status)}</span>
                    <span className={styles.eventCopy}>
                      <strong>{event.title}</strong>
                      <small><span className={`${styles.eventStatus} ${auditToneClass(event.status)}`}>{humanize(event.status)}</span><span>{actorLabel(event.actor)}</span><span>Record #{event.sequence}</span></small>
                    </span>
                    <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time>
                    <ChevronDown className={styles.chevron} size={16}/>
                  </summary>
                  <div className={styles.eventBody}>
                    <p>{event.detail}</p>
                    {showTechnical && <div className={styles.technicalPanel}>
                      <dl className={styles.technical}>
                        <div><dt>Record type</dt><dd>{humanize(event.kind)}</dd></div>
                        <div><dt>Actor</dt><dd>{actorLabel(event.actor)}</dd></div>
                        <div><dt>Status</dt><dd>{humanize(event.status)}</dd></div>
                        <div><dt>Recorded at</dt><dd>{formatTimestamp(event.createdAt)}</dd></div>
                        <div><dt>Session version</dt><dd>{event.sessionVersion}</dd></div>
                        <div><dt>Sequence</dt><dd>#{event.sequence}</dd></div>
                        <div><dt>Previous hash</dt><dd className={styles.monospace}>{event.previousHash}</dd></div>
                        <div><dt>Record hash</dt><dd className={styles.monospace}>{event.hash}</dd></div>
                      </dl>
                      {event.evidence && <div className={styles.evidence}><span>Evidence</span><pre>{JSON.stringify(event.evidence, null, 2)}</pre></div>}
                    </div>}
                  </div>
                </details>)}
                {filteredAudit.length === 0 && <p className={styles.empty}>No audit records match this filter.</p>}
              </div>
            </section>

            <details className={styles.inventoryTools}><summary><span><Package size={17}/> Demo inventory tools</span><ChevronDown size={16}/></summary><div><p>Test what happens when an item goes out of stock before checkout.</p><span><button disabled={busy || !selected.selectedVariantId || selected.phase === "paid"} onClick={() => updateInventory("mark_selected_unavailable")}>Mark unavailable</button><button disabled={busy} onClick={() => updateInventory("restore_demo_inventory")}>Restore stock</button></span></div></details>
          </>}
        </section>
      </section>
    </div>
  </main>;
}
