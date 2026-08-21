"use client";

import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  BarChart3,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Command,
  Database,
  ExternalLink,
  FileCheck2,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Webhook,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEvent, DashboardState, DemoPhase } from "@/lib/types";

const phaseOrder: DemoPhase[] = ["idle", "incident_detected", "analyzed", "approved", "canary_complete", "promoted"];

const steps = [
  { phase: "incident_detected" as DemoPhase, label: "Incident isolated" },
  { phase: "analyzed" as DemoPhase, label: "Strategies proposed" },
  { phase: "approved" as DemoPhase, label: "Execution approved" },
  { phase: "canary_complete" as DemoPhase, label: "Canary measured" },
  { phase: "promoted" as DemoPhase, label: "Winner promoted" },
];

const navigation = [
  { label: "Incident room", icon: LayoutDashboard, active: true },
  { label: "Agent runs", icon: Bot },
  { label: "Experiments", icon: FlaskConical },
  { label: "Recovery ledger", icon: CircleDollarSign },
  { label: "Controls", icon: ShieldCheck },
];

function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function time(value: string) {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function actionFor(state: DashboardState) {
  switch (state.phase) {
    case "idle":
      return { label: "Start incident replay", path: "/api/demo/stream", icon: Play, hint: "Load the fixed-seed transaction stream" };
    case "incident_detected":
      return { label: "Run agent investigation", path: `/api/incidents/${state.incident?.id}/analyze`, icon: Bot, hint: "Inspect evidence, merchant policy and eligible cases" };
    case "analyzed":
      if (state.campaign?.status === "stopped") return null;
      return { label: "Approve 12-case canary", path: `/api/campaigns/${state.campaign?.id}/approve`, icon: LockKeyhole, hint: "Authorise a bounded 6 × 6 experiment" };
    case "approved":
      return { label: "Execute randomized canary", path: `/api/campaigns/${state.campaign?.id}/run-canary`, icon: FlaskConical, hint: "Run both strategies against immutable assignments" };
    case "canary_complete":
      return { label: "Promote winning strategy", path: `/api/campaigns/${state.campaign?.id}/promote`, icon: Zap, hint: "Expand only the measured winner" };
    case "promoted":
      return null;
  }
}

function Skeleton() {
  return <main className="loading-screen"><span className="wordmark-icon">R</span><LoaderCircle className="spin" size={18} /><span>Opening incident workspace</span></main>;
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastDemoEvent, setLastDemoEvent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.ok) setState((await response.json()) as DashboardState);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 1_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  const perform = useCallback(async (path: string, body?: object, label = "action") => {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = (await response.json()) as DashboardState & { error?: string; state?: DashboardState; eventId?: string };
      if (!response.ok) throw new Error(result.error || "The operation did not complete.");
      setState(result.state || result);
      if (result.eventId) setLastDemoEvent(result.eventId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setBusy(null);
    }
  }, []);

  const currentAction = state ? actionFor(state) : null;
  const phaseIndex = state ? phaseOrder.indexOf(state.phase) : 0;
  const uplift = state && state.ledger.baselineAmount ? (state.ledger.simulatedAmount - state.ledger.baselineAmount) / state.ledger.baselineAmount : 0;
  const eligibleCount = useMemo(
    () => state?.payments.filter((payment) => payment.status === "failed" && payment.consent && payment.contactsLast24h < 2).length || 0,
    [state?.payments],
  );

  if (!state) return <Skeleton />;

  const incidentCode = state.incident?.id?.toUpperCase() || "INC-STANDBY";
  const actionLabel = currentAction?.label || (state.campaign?.paymentLink?.status === "paid" ? "Test recovery captured" : "Create Test Mode recovery");
  const canaryWinner = state.campaign?.canary?.results.find((result) => result.playbookId === state.campaign?.canary?.winnerId);
  const canaryChallenger = state.campaign?.canary?.results.find((result) => result.playbookId !== state.campaign?.canary?.winnerId);
  const recoveryMultiple = canaryWinner && canaryChallenger && canaryChallenger.conversionRate > 0
    ? (canaryWinner.conversionRate / canaryChallenger.conversionRate).toFixed(1)
    : "—";

  return (
    <main className="cockpit">
      <aside className="nav-rail">
        <a href="#incident" className="wordmark-icon" aria-label="RecoverOS incident room"><span>R</span><small>OS</small></a>
        <nav aria-label="Primary navigation">
          {navigation.map(({ label, icon: Icon, active }) => (
            <a key={label} href={`#${active ? "incident" : label.toLowerCase().replaceAll(" ", "-")}`} className={active ? "active" : ""} aria-label={label} title={label}><Icon size={18} /></a>
          ))}
        </nav>
        <button className="rail-button" aria-label="Settings" title="Settings"><Settings2 size={18} /></button>
        <span className="operator-avatar">AK</span>
      </aside>

      <section className="app-surface">
        <header className="commandbar">
          <div className="command-title"><span>RecoverOS</span><ChevronRight size={13} /><b>Incident room</b></div>
          <div className="command-meta">
            <span className="environment"><FlaskConical size={12} /> REPLAY ENVIRONMENT</span>
            <span className="status-light"><i className={state.integration.razorpay ? "connected" : ""} />{state.integration.razorpay ? "Razorpay test connected" : "Local demo"}</span>
            <span className="command-key"><Command size={12} /> K</span>
          </div>
        </header>

        <div className="system-ticker" aria-hidden="true">
          <span>RECOVERY CONTROL LOOP</span><i />
          <span>DETERMINISTIC EVIDENCE</span><i />
          <span>AGENTIC DECISIONING</span><i />
          <span>HUMAN-GATED EXECUTION</span><i />
          <span>RAZORPAY TEST MODE</span>
        </div>

        <div className="workspace">
          <section className="incident-header" id="incident">
            <span className="hero-index" aria-hidden="true">02</span>
            <div className="incident-identity">
              <div className="severity-block"><span>SEV</span><strong>{state.incident ? "2" : "–"}</strong></div>
              <div>
                <div className="incident-meta"><span>{incidentCode}</span><i /> <span>SYNTHETIC ISSUER A</span><i /> <span>CARD AUTH</span></div>
                <h1>{state.incident ? "Issuer authentication degradation" : "Payment systems nominal"}</h1>
                <p>{state.incident ? `${state.incident.failedAttempts} failed payments isolated · ${formatInr(state.incident.revenueAtRisk)} exposure` : "Waiting for the fixed-seed incident stream."}</p>
              </div>
            </div>
            <div className="incident-signal">
              <div className="signal-top"><span>SUCCESS RATE / 15 MIN</span><b>{state.incident ? "0.0%" : "96.4%"}</b></div>
              <div className="spark-bars" aria-label="Payment success rate signal">{[78, 81, 76, 83, 80, 79, 34, 25, 18, 13, 10, 7].map((height, index) => <i key={index} style={{ height: state.incident ? `${height}%` : "72%" }} className={index > 5 && state.incident ? "drop" : ""} />)}</div>
              <div className="signal-foot"><span>BASELINE 96.4%</span><span>−96.4 PP</span></div>
            </div>
            <div className="incident-actions">
              <button className="icon-button" aria-label="Reset demo" title="Reset demo" disabled={Boolean(busy)} onClick={() => void perform("/api/demo/reset", undefined, "Resetting demo")}><RotateCcw size={16} /></button>
              <span className="incident-state"><Radio size={13} /> ACTIVE</span>
            </div>
          </section>

          {error && <div className="error-banner"><TriangleAlert size={15} />{error}</div>}

          <section className="workflow-bar" aria-label="Recovery workflow">
            {steps.map((step, index) => {
              const stepIndex = phaseOrder.indexOf(step.phase);
              const complete = phaseIndex >= stepIndex;
              const active = phaseIndex === stepIndex;
              return <div className={`workflow-step ${complete ? "complete" : ""} ${active ? "current" : ""}`} key={step.phase}><span>{complete ? <Check size={12} /> : String(index + 1).padStart(2, "0")}</span><b>{step.label}</b>{index < steps.length - 1 && <i />}</div>;
            })}
          </section>

          <section className="command-metrics">
            <CommandMetric label="Revenue exposure" value={state.incident ? formatInr(state.incident.revenueAtRisk) : "—"} delta="AT RISK" tone="danger" />
            <CommandMetric label="Affected cohort" value={state.incident ? `${state.incident.affectedAttempts}` : "—"} delta="PAYMENTS" />
            <CommandMetric label="Policy eligible" value={state.incident ? `${eligibleCount}` : "—"} delta={state.incident ? `${state.incident.affectedAttempts - eligibleCount} EXCLUDED` : "CASES"} tone="success" />
            <CommandMetric label="Detector confidence" value={state.incident ? percent(state.incident.confidence) : "—"} delta="DETERMINISTIC" />
            <CommandMetric label="Replay recovered" value={state.ledger.simulatedAmount ? formatInr(state.ledger.simulatedAmount) : "—"} delta="SYNTHETIC ONLY" tone="accent" />
          </section>

          {canaryWinner && canaryChallenger && <section className="proof-banner" aria-label="Measured canary result">
            <div className="proof-lead">
              <span className="proof-kicker"><Zap size={13} /> MEASURED RECOVERY ADVANTAGE</span>
              <strong>{recoveryMultiple}<sup>×</sup></strong>
              <p>Higher conversion than the generic retry baseline on the immutable canary cohort.</p>
            </div>
            <div className="proof-race">
              <div className="race-row challenger"><span>A</span><div><i style={{ width: `${canaryChallenger.conversionRate * 100}%` }} /></div><b>{percent(canaryChallenger.conversionRate)}</b></div>
              <div className="race-row winner"><span>B</span><div><i style={{ width: `${canaryWinner.conversionRate * 100}%` }} /></div><b>{percent(canaryWinner.conversionRate)}</b></div>
              <small>12-CASE RANDOMIZED CANARY · FIXED-SEED OUTCOME MATRIX</small>
            </div>
            <div className="proof-decision">
              <span>{state.phase === "promoted" ? "PROMOTED" : "RECOMMENDED ACTION"}</span>
              <h2>Expand strategy B</h2>
              <div><b>{canaryWinner.recovered}/{canaryWinner.attempted}</b><small>RECOVERED</small><b>{formatInr(canaryWinner.recoveredAmount)}</b><small>REPLAY VALUE</small></div>
              <em><ShieldCheck size={13} /> ZERO POLICY VIOLATIONS</em>
            </div>
          </section>}

          <section className="workspace-grid">
            <div className="primary-stack">
              <article className="module evidence-module">
                <ModuleHeader icon={BarChart3} eyebrow="INCIDENT EVIDENCE" title="Cohort isolation" badge={state.incident ? "MEASURED" : "WAITING"} />
                {state.incident ? <div className="evidence-body">
                  <div className="rate-visual">
                    <div className="rate-copy"><span>Observed success</span><strong>{percent(state.incident.observedSuccessRate)}</strong><small>versus {percent(state.incident.baselineSuccessRate)} trailing baseline</small></div>
                    <div className="rate-track"><i style={{ width: `${Math.max(1.5, state.incident.observedSuccessRate * 100)}%` }} /></div>
                    <div className="cohort-query"><span>COHORT FILTER</span><code>issuer = &quot;Issuer A&quot; AND method = &quot;card&quot; AND step = &quot;payment_authentication&quot;</code></div>
                  </div>
                  <div className="evidence-table">
                    <Fact label="Top failure reason" value="issuer_authentication_unavailable" mono />
                    <Fact label="Failure source" value="bank" />
                    <Fact label="Failure step" value="payment_authentication" mono />
                    <Fact label="Signal change" value={`−${state.incident.deltaPercentagePoints.toFixed(1)} pp`} danger />
                  </div>
                </div> : <EmptyState icon={Activity} text="Start the replay to isolate the affected cohort." />}
              </article>

              <article className="module agent-module" id="agent-runs">
                <ModuleHeader icon={Bot} eyebrow="AGENT RUN" title="Incident Commander" badge={state.campaign?.agentAnalysis.mode === "openai_agent" ? "OPENAI AGENT" : state.campaign ? "SAFE FALLBACK" : "NOT STARTED"} />
                {state.campaign ? <>
                  <div className="agent-brief"><div><span>WORKING HYPOTHESIS</span><p>{state.campaign.agentAnalysis.hypothesis}</p></div><div><span>RECOMMENDATION</span><p>{state.campaign.agentAnalysis.recommendation}</p></div></div>
                  <div className="tool-log"><span>TOOLS CALLED</span>{state.campaign.agentAnalysis.toolsUsed.map((tool, index) => <code key={tool}>{String(index + 1).padStart(2, "0")} / {tool}</code>)}</div>
                  <div className="strategy-grid">{state.campaign.agentAnalysis.playbooks.map((playbook, index) => {
                    const result = state.campaign?.canary?.results.find((item) => item.playbookId === playbook.id);
                    const winner = state.campaign?.canary?.winnerId === playbook.id;
                    return <div className={`strategy-card ${winner ? "winner" : ""}`} key={playbook.id}>
                      <div className="strategy-index"><span>STRATEGY {index === 0 ? "A" : "B"}</span>{winner && <b><BadgeCheck size={13} /> PROMOTE</b>}</div>
                      <h3>{playbook.name}</h3><p>{playbook.rationale}</p>
                      <div className="method-row">{playbook.enabledMethods.map((method) => <span key={method}>{method}</span>)}</div>
                      <div className="strategy-result">{result ? <><strong>{result.recovered}/{result.attempted}</strong><span>RECOVERED</span><b>{percent(result.conversionRate)}</b></> : <><strong>6</strong><span>ASSIGNED CASES</span><b>READY</b></>}</div>
                    </div>;
                  })}</div>
                  {state.campaign.canary && <div className="uncertainty"><TriangleAlert size={14} /><span>{state.campaign.canary.confidenceWarning}</span></div>}
                </> : <div className="agent-empty"><Bot size={21} /><div><b>No reasoning run yet</b><p>The agent must inspect evidence, policy and eligibility through typed tools before it can propose recovery strategies.</p></div><div className="planned-calls"><span><i /> getIncidentEvidence</span><span><i /> readMerchantRecoveryPolicy</span><span><i /> listEligibleCases</span></div></div>}
              </article>

              <article className="module ledger-module" id="recovery-ledger">
                <ModuleHeader icon={Database} eyebrow="EVIDENCE LEDGER" title="Recovery outcomes" badge="SEPARATED" />
                <div className="ledger-table">
                  <Ledger label="RecoverOS deterministic replay" amount={state.ledger.simulatedAmount} detail={`${state.ledger.simulatedCases} synthetic cases`} color="accent" />
                  <Ledger label="Generic retry baseline" amount={state.ledger.baselineAmount} detail="Fixed comparison policy" color="muted" />
                  <Ledger label="Razorpay Test Mode" amount={state.ledger.razorpayTestAmount} detail={`${state.ledger.testModeCases} sandbox captures`} color="blue" />
                </div>
                <div className="ledger-summary"><span>Replay uplift <b>{state.ledger.simulatedAmount ? `+${Math.round(uplift * 100)}%` : "PENDING"}</b></span><span>Contacts vs baseline <b>{state.metrics.recoverosContacts - state.metrics.baselineContacts}</b></span><span>Policy violations <b>0</b></span><span>Unsupported claims <b>0</b></span></div>
              </article>
            </div>

            <aside className="control-stack">
              <article className="action-console">
                <div className="action-console-top"><span><Radio size={12} /> OPERATOR QUEUE</span><b>1 ACTION</b></div>
                <h2>{actionLabel}</h2><p>{currentAction?.hint || "Create one real Test Mode artefact after promoting the replay winner."}</p>
                {currentAction ? <button className="execute-button" disabled={Boolean(busy)} onClick={() => void perform(currentAction.path, undefined, currentAction.label)}>{busy ? <LoaderCircle className="spin" size={16} /> : <currentAction.icon size={16} />}{busy || currentAction.label}<ArrowUpRight size={15} /></button> : <button className="execute-button" disabled={Boolean(busy) || state.campaign?.paymentLink?.status === "paid"} onClick={() => void perform(`/api/campaigns/${state.campaign?.id}/create-test-link`, undefined, "Preparing Test Mode link")}>{busy ? <LoaderCircle className="spin" size={16} /> : <CircleDollarSign size={16} />}{actionLabel}<ArrowUpRight size={15} /></button>}
                {state.campaign?.status === "awaiting_approval" && <button className="reject-button" disabled={Boolean(busy)} onClick={() => void perform(`/api/campaigns/${state.campaign?.id}/approve`, { approve: false }, "Rejecting campaign")}><Ban size={14} /> Reject campaign</button>}
                <div className="action-boundary"><LockKeyhole size={13} /><span>Execution remains policy-gated and fully auditable.</span></div>
              </article>

              <article className="module policy-module" id="controls">
                <ModuleHeader icon={ShieldCheck} eyebrow="POLICY ENGINE" title="Execution controls" />
                <div className="policy-list"><PolicyItem ok label="Amount integrity" detail="Immutable" /><PolicyItem ok label="Customer consent" detail={`${state.incident ? state.incident.affectedAttempts - eligibleCount : 0} excluded`} /><PolicyItem ok label="Contact frequency" detail="≤ 2 / 24h" /><PolicyItem ok label="Stop on capture" detail="Terminal" /><PolicyItem ok={state.campaign?.policy.outcome !== "reject"} label="Campaign threshold" detail="> ₹25,000" pending={state.campaign?.status === "awaiting_approval"} /></div>
                <div className={`policy-decision ${state.campaign?.policy.outcome || "standby"}`}><span>{state.campaign?.policy.outcome?.replace("_", " ") || "STANDBY"}</span><b>{state.campaign?.policy.checkedRules || 5} RULES</b></div>
              </article>

              <article className="module integration-module">
                <ModuleHeader icon={Webhook} eyebrow="LIVE VERIFICATION" title="Razorpay Test Mode" />
                <div className="integration-list"><Integration ok={state.integration.razorpay} label="API credentials" /><Integration ok={state.integration.webhookSecret} label="Signed webhooks" /><Integration ok={state.integration.openai} label="OpenAI agent" /><Integration ok={state.integration.persistence === "supabase"} label="Supabase persistence" optional /></div>
                {state.campaign?.paymentLink && <div className="payment-link-box">
                  <div><span className={`link-status ${state.campaign.paymentLink.status}`}>{state.campaign.paymentLink.status}</span><b>{formatInr(state.campaign.paymentLink.amount)}</b></div>
                  <small>{state.campaign.paymentLink.mode === "razorpay_test" ? "RAZORPAY TEST MODE" : "CONFIGURATION PREVIEW"}</small>
                  {state.campaign.paymentLink.shortUrl ? <a href={state.campaign.paymentLink.shortUrl} target="_blank" rel="noreferrer">Open payment link <ExternalLink size={13} /></a> : <p>Test credentials are absent. No external payment URL has been fabricated.</p>}
                  <div className="link-actions">{state.campaign.paymentLink.mode === "razorpay_test" && state.campaign.paymentLink.status !== "paid" && <button disabled={Boolean(busy)} onClick={() => void perform(`/api/campaigns/${state.campaign?.id}/sync-razorpay`, undefined, "Syncing Razorpay")}><RefreshCcw size={13} /> Sync</button>}<button disabled={Boolean(busy)} onClick={() => void perform("/api/demo/replay-webhook", lastDemoEvent ? { eventId: lastDemoEvent } : undefined, "Replaying webhook")}><Webhook size={13} /> {lastDemoEvent ? "Replay duplicate" : "Replay webhook"}</button></div>
                </div>}
              </article>

              <article className="module benchmark-module" id="experiments">
                <ModuleHeader icon={FileCheck2} eyebrow="LOCKED HOLDOUT" title="Evaluation integrity" />
                <div className="benchmark-grid"><Benchmark label="Precision" value={percent(state.metrics.detectionPrecision)} /><Benchmark label="Recall" value={percent(state.metrics.detectionRecall)} /><Benchmark label="Cohort F1" value={percent(state.metrics.cohortF1)} /><Benchmark label="Selection" value={percent(state.metrics.playbookAccuracy)} /></div>
                <div className="manifest"><span>MANIFEST SHA-256</span><code>{state.dataset.manifestHash}</code><small>{state.dataset.totalAttempts} attempts · {state.dataset.holdoutPercent}% holdout · seed {state.dataset.seed}</small></div>
              </article>
            </aside>
          </section>

          <section className="module audit-module" id="audit-trail"><ModuleHeader icon={Clock3} eyebrow="IMMUTABLE AUDIT" title="Decision trail" badge={`${state.audit.length} EVENTS`} /><div className="audit-list">{state.audit.slice(0, 10).map((item) => <AuditRow key={item.id} event={item} />)}</div></section>
          <footer><span>RECOVEROS / CANARY COMMANDER</span><p>Synthetic replay and Razorpay Test Mode ledgers remain strictly separated.</p><b>TRACK 03 · AI REVENUE RECOVERY</b></footer>
        </div>
      </section>
    </main>
  );
}

function CommandMetric({ label, value, delta, tone = "" }: { label: string; value: string; delta: string; tone?: string }) { return <div className={`command-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{delta}</small></div>; }
function ModuleHeader({ icon: Icon, eyebrow, title, badge }: { icon: typeof Activity; eyebrow: string; title: string; badge?: string }) { return <div className="module-header"><span className="module-icon"><Icon size={15} /></span><div><span>{eyebrow}</span><h2>{title}</h2></div>{badge && <b>{badge}</b>}</div>; }
function Fact({ label, value, mono = false, danger = false }: { label: string; value: string; mono?: boolean; danger?: boolean }) { return <div className={`fact ${danger ? "danger" : ""}`}><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function EmptyState({ icon: Icon, text }: { icon: typeof Activity; text: string }) { return <div className="empty-state"><Icon size={20} /><p>{text}</p></div>; }
function PolicyItem({ ok, label, detail, pending = false }: { ok: boolean; label: string; detail: string; pending?: boolean }) { return <div className="policy-item"><span className={pending ? "pending" : ok ? "ok" : "blocked"}>{pending ? <Clock3 size={12} /> : ok ? <Check size={12} /> : <Ban size={12} />}</span><div><b>{label}</b><small>{detail}</small></div></div>; }
function Integration({ ok, label, optional = false }: { ok: boolean; label: string; optional?: boolean }) { return <div className="integration-row"><span className={ok ? "connected" : "disconnected"} /><b>{label}</b><small>{ok ? "CONNECTED" : optional ? "OPTIONAL" : "NOT CONFIGURED"}</small></div>; }
function Ledger({ label, amount, detail, color }: { label: string; amount: number; detail: string; color: string }) { return <div className={`ledger ${color}`}><div><span>{label}</span><small>{detail}</small></div><strong>{formatInr(amount)}</strong></div>; }
function Benchmark({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }
function AuditRow({ event }: { event: AuditEvent }) { const icons = { success: Check, warning: TriangleAlert, blocked: Ban, info: Activity }; const Icon = icons[event.status]; return <div className="audit-row"><time>{time(event.createdAt)}</time><span className={`audit-icon ${event.status}`}><Icon size={12} /></span><div><b>{event.title}</b><p>{event.detail}</p></div><code>{event.actor}</code></div>; }
