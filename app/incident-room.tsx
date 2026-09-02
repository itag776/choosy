"use client";

import {
  Activity, ArrowRight, BadgeCheck, Ban, Bot, Check, CircleDollarSign,
  Clock3, ExternalLink, FileCheck2, FlaskConical, LoaderCircle, LockKeyhole,
  LogOut, Play, RefreshCcw, RotateCcw, ShieldCheck, TriangleAlert, Webhook, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AuditEvent, CandidatePlaybook, OperatorIdentity, RecoveryRunSnapshot, RunCommand, RunPhase,
} from "@/lib/types";

const transitional = new Set<RunPhase>([
  "incident_streaming", "investigating", "canary_running", "evaluating_promotion", "payment_link_creating",
]);

const chapters: Array<{ label: string; phases: RunPhase[] }> = [
  { label: "Detect", phases: ["idle", "incident_streaming", "incident_detected"] },
  { label: "Understand", phases: ["investigating", "awaiting_canary_approval"] },
  { label: "Test", phases: ["canary_approved", "canary_running", "canary_complete", "rejected"] },
  { label: "Decide", phases: ["evaluating_promotion", "awaiting_promotion_approval", "promoted", "stopped", "escalated"] },
  { label: "Prove", phases: ["payment_link_creating", "payment_link_created", "test_payment_captured", "completed", "integration_failure"] },
];

function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function time(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

type PrimaryAction = { command: RunCommand; label: string; hint: string; icon: typeof Play };

function primaryAction(state: RecoveryRunSnapshot): PrimaryAction | null {
  switch (state.phase) {
    case "idle": return { command: "inject_incident", label: "Start incident", hint: "Run the verified payment replay", icon: Play };
    case "incident_detected": return { command: "investigate", label: "Find the cause", hint: "Let Kept read the evidence", icon: Bot };
    case "awaiting_canary_approval": return { command: "approve_canary", label: "Approve test", hint: "Allow a bounded 6 × 6 replay", icon: LockKeyhole };
    case "canary_approved": return { command: "run_canary", label: "Run 12-case test", hint: "Commit assignments before outcomes", icon: FlaskConical };
    case "canary_complete": return { command: "evaluate_promotion", label: "Review result", hint: "Evaluate the measured winner", icon: Bot };
    case "awaiting_promotion_approval": return { command: "approve_promotion", label: "Promote winner", hint: "Expand only the measured strategy", icon: Zap };
    case "promoted": return { command: "create_test_link", label: "Create test payment", hint: "Prove the provider boundary", icon: CircleDollarSign };
    case "payment_link_created": return { command: "sync_test_link", label: "Sync payment", hint: "Check Razorpay's current state", icon: RefreshCcw };
    case "test_payment_captured": return { command: "replay_demo_webhook", label: "Verify duplicate safety", hint: "Replay without counting money twice", icon: Webhook };
    case "integration_failure":
      return state.externalAction?.providerId
        ? { command: "sync_test_link", label: "Reconcile payment", hint: "Recover the persisted provider action", icon: RefreshCcw }
        : { command: "create_test_link", label: "Retry safely", hint: "Reconcile before creating anything new", icon: RefreshCcw };
    case "completed":
    case "rejected":
    case "stopped":
    case "escalated":
      return { command: "reset_replay", label: "New incident", hint: "Keep the proof and reset the replay", icon: RotateCcw };
    default: return null;
  }
}

export default function IncidentRoom({ initialState, operator }: { initialState: RecoveryRunSnapshot; operator: OperatorIdentity }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<RunCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/runs/${initialState.id}`, { cache: "no-store" });
    if (response.ok) setState(await response.json() as RecoveryRunSnapshot);
  }, [initialState.id]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(), transitional.has(state.phase) ? 750 : 2_000);
    return () => window.clearInterval(interval);
  }, [load, state.phase]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".scene")?.scrollTo({ top: 0 }));
    return () => window.cancelAnimationFrame(frame);
  }, [state.phase]);

  const perform = useCallback(async (command: RunCommand, payload?: Record<string, unknown>) => {
    setBusy(command);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${initialState.id}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          expectedVersion: state.version,
          idempotencyKey: `${command}:${crypto.randomUUID()}`,
          payload,
        }),
      });
      const result = await response.json() as RecoveryRunSnapshot & { error?: string };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(result.error ?? "The command did not complete.");
      }
      setState(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unexpected product error.");
    } finally {
      setBusy(null);
    }
  }, [initialState.id, load, state.version]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }, []);

  const action = primaryAction(state);
  const activeChapter = Math.max(0, chapters.findIndex((chapter) => chapter.phases.includes(state.phase)));
  const systems = [state.integration.gemini, state.integration.razorpay, state.integration.webhookSecret, state.integration.persistence === "supabase"];
  const allConnected = systems.every(Boolean);

  return (
    <main className="incident-room">
      <div className="background-planes" aria-hidden="true"><i /><i /><i /></div>
      <header className="topbar">
        <div className="brand" aria-label="Kept"><b className="brand-word">kept</b><span className="brand-mark" /></div>
        <div className="incident-context"><span>{state.incident?.id ?? "Ready"}</span><small>Run {state.id.slice(-6)}</small></div>
        <div className="header-actions">
          <span className="mode-pill"><FlaskConical size={14} />Test mode</span>
          <button className={allConnected ? "systems-pill connected" : "systems-pill"} onClick={() => setEvidenceOpen(true)}>
            <i />{allConnected ? "All systems connected" : `${systems.filter(Boolean).length}/4 systems connected`}
          </button>
          <button className="text-control" onClick={() => setEvidenceOpen(true)}><FileCheck2 size={15} />Evidence</button>
          {state.phase !== "idle" && <button className="icon-control" onClick={() => void perform("reset_replay")} disabled={busy !== null} aria-label="Reset replay"><RotateCcw size={16} /></button>}
          <button className="icon-control" onClick={() => void logout()} aria-label={`Log out ${operator.actorId}`}><LogOut size={16} /></button>
        </div>
      </header>

      <nav className="progress-shell" aria-label="Recovery progress">
        <ol className="progress-track">
          {chapters.map((chapter, index) => (
            <li key={chapter.label} className={index < activeChapter ? "done" : index === activeChapter ? "active" : ""}>
              <span>{index < activeChapter ? <Check size={13} /> : index + 1}</span><b>{chapter.label}</b>
            </li>
          ))}
        </ol>
      </nav>

      <div className="room-body">
        {error && <div className="error-banner"><TriangleAlert size={16} /><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
        <section className="focus-card" aria-live="polite">
          <Scene key={state.phase} state={state} />
          <ActionDock state={state} action={action} busy={busy} perform={perform} />
        </section>
      </div>

      {evidenceOpen && <EvidenceDrawer state={state} onClose={() => setEvidenceOpen(false)} />}
    </main>
  );
}

function Scene({ state }: { state: RecoveryRunSnapshot }) {
  switch (state.phase) {
    case "idle": return <ReadyScene state={state} />;
    case "incident_streaming": return <StreamingScene state={state} />;
    case "incident_detected": return <IncidentScene state={state} />;
    case "investigating": return <InvestigatingScene />;
    case "awaiting_canary_approval":
    case "rejected": return <StrategyScene state={state} />;
    case "canary_approved": return <CanaryScene state={state} running={false} />;
    case "canary_running": return <CanaryScene state={state} running />;
    case "canary_complete":
    case "evaluating_promotion":
    case "awaiting_promotion_approval": return <ResultScene state={state} />;
    case "promoted":
    case "payment_link_creating":
    case "payment_link_created":
    case "integration_failure": return <ProofScene state={state} />;
    case "test_payment_captured":
    case "completed": return <CompletedScene state={state} />;
    case "stopped":
    case "escalated": return <TerminalScene state={state} />;
  }
}

function SceneIntro({ eyebrow, title, body, tone = "blue" }: { eyebrow: string; title: string; body?: string; tone?: "blue" | "red" | "green" }) {
  return <div className="scene-intro"><span className={`eyebrow ${tone}`}><i />{eyebrow}</span><h1>{title}</h1>{body && <p>{body}</p>}</div>;
}

function ReadyScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene ready-scene">
    <div className="ready-copy">
      <SceneIntro eyebrow="Ready" title="Recover revenue. Prove every step." body="Kept detects payment loss, tests the safest response, and keeps every money action human-approved." />
      <div className="quiet-facts"><span><Check size={14} />{state.dataset.totalAttempts} verified payments</span><span><ShieldCheck size={14} />Zero live actions</span></div>
    </div>
    <div className="health-card">
      <div><span>Payment success</span><small>Last 15 minutes</small></div>
      <strong>96.4<sup>%</sup></strong>
      <div className="health-bars">{[58,64,61,69,66,74,71,79,75,82,78,84].map((height,index)=><i key={index} style={{height:`${height}%`}} />)}</div>
      <p><i />Healthy baseline</p>
    </div>
  </div>;
}

function StreamingScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene centered-scene">
    <div className="pulse-visual"><span /><span /><span /><Activity size={30} /></div>
    <SceneIntro eyebrow="Detecting" title="Reading 240 payment attempts." body="Grouping failures by issuer, method, step, and reason." />
    <div className="scan-line"><LoaderCircle className="spin" size={16} /><span>Verified fixture</span><code>{state.dataset.manifestHash.slice(0,12)}</code></div>
  </div>;
}

function IncidentScene({ state }: { state: RecoveryRunSnapshot }) {
  const incident=state.incident!;
  return <div className="scene incident-scene">
    <SceneIntro eyebrow="Incident detected" tone="red" title="A payment path is failing." body={`${incident.affectedAttempts} attempts share one issuer authentication failure.`} />
    <div className="primary-metrics">
      <Metric label="Revenue at risk" value={formatInr(incident.revenueAtRiskPaise)} detail="Synthetic replay" tone="red" />
      <Metric label="Affected payments" value={String(incident.affectedAttempts)} detail="Isolated cohort" />
      <Metric label="Observed success" value={percent(incident.observedSuccessRate)} detail={`Down ${incident.deltaPercentagePoints.toFixed(1)} points`} tone="red" />
    </div>
    <div className="cause-line"><span>Likely path</span><b>{incident.title}</b><em>{percent(incident.incidentScore)} signal</em></div>
  </div>;
}

function InvestigatingScene() {
  const tools = ["Read incident evidence", "Check merchant policy", "Find eligible cases", "Compare recovery options", "Challenge the leading cause"];
  return <div className="scene investigating-scene">
    <div className="agent-orb"><Bot size={27} /></div>
    <SceneIntro eyebrow="Kept is working" title="Finding the safest recovery." body="The agent can interpret evidence and recommend. It cannot approve or move money." />
    <div className="investigation-list">{tools.map((tool,index)=><div key={tool} style={{"--delay":`${index*110}ms`} as React.CSSProperties}><span>{index+1}</span><b>{tool}</b><LoaderCircle className="spin" size={15} /></div>)}</div>
  </div>;
}

function PlaybookCard({ playbook, index }: { playbook: CandidatePlaybook; index: number }) {
  return <article className="playbook-card"><header><span>Option {index+1}</span><b>{playbook.timingMinutes ? `${playbook.timingMinutes} min` : "Now"}</b></header><h3>{playbook.name}</h3><p>{playbook.rationale}</p><footer>{playbook.enabledMethods.map(method=><span key={method}>{method.replaceAll("_"," ")}</span>)}</footer></article>;
}

function StrategyScene({ state }: { state: RecoveryRunSnapshot }) {
  const result=state.investigation!;
  return <div className="scene strategy-scene">
    <SceneIntro eyebrow="Recommendation ready" title="Two safe options." body={result.primaryHypothesis} />
    <div className="playbook-grid">{result.playbooks.map((playbook,index)=><PlaybookCard key={playbook.id} playbook={playbook} index={index}/>)}</div>
    <div className="policy-strip"><ShieldCheck size={20}/><div><b>Human approval required</b><span>Policy—not the model—controls execution.</span></div><em>{state.policyDecision?.checkedRules.length} rules passed</em></div>
  </div>;
}

function CanaryScene({ state, running }: { state: RecoveryRunSnapshot; running: boolean }) {
  const assignments = state.canaryAssignments.length ? state.canaryAssignments : Array.from({length:12},(_,index)=>({ordinal:index+1,playbookId:index%2===0?"wait_retry":"alternate_link"}));
  return <div className="scene canary-scene">
    <SceneIntro eyebrow={running?"Test running":"Test approved"} title="Test before scale." body="Twelve replay cases. Two strategies. Assignments are committed before outcomes are read." />
    <div className="canary-board"><div className="canary-label"><span>12 cases</span><b>6 × 6 split</b></div><div className="case-dots">{assignments.map((assignment,index)=><i key={index} className={assignment.playbookId === "alternate_link" ? "option-b" : "option-a"}>{assignment.ordinal}</i>)}</div></div>
    <div className="canary-legend"><span><i className="option-a"/>Timed retry · 6</span><span><i className="option-b"/>Alternate link · 6</span>{running&&<em><LoaderCircle className="spin" size={14}/>Reading outcomes</em>}</div>
  </div>;
}

function ResultScene({ state }: { state: RecoveryRunSnapshot }) {
  const canary=state.canary!;
  const wait=canary.results.find(item=>item.playbookId==="wait_retry")!;
  const alternate=canary.results.find(item=>item.playbookId==="alternate_link")!;
  const evaluating=state.phase==="evaluating_promotion";
  return <div className="scene result-scene">
    <SceneIntro eyebrow={evaluating?"Reviewing result":"Measured result"} title="A winner, measured." body="The small canary is directional, so expansion still requires human approval." />
    <div className="result-card">
      <ResultLane label="Timed retry" result={wait.recovered} total={wait.attempted} rate={wait.conversionRate}/>
      <ResultLane label="Alternate link" result={alternate.recovered} total={alternate.attempted} rate={alternate.conversionRate} winner/>
    </div>
    <div className="recommendation-strip">{evaluating?<LoaderCircle className="spin" size={19}/>:<Bot size={19}/>}<div><span>Kept recommends</span><b>{state.promotion?.reason ?? "Reviewing the measured winner and stop conditions."}</b></div><em>{canary.liftMultiple.toFixed(1)}× lift</em></div>
  </div>;
}

function ResultLane({label,result,total,rate,winner=false}:{label:string;result:number;total:number;rate:number;winner?:boolean}) {
  return <div className={winner?"result-lane winner":"result-lane"}><header><span>{label}</span>{winner&&<b><BadgeCheck size={14}/>Winner</b>}</header><div><i style={{width:`${rate*100}%`}}/></div><footer><strong>{percent(rate)}</strong><span>{result}/{total} recovered</span></footer></div>;
}

function ProofScene({ state }: { state: RecoveryRunSnapshot }) {
  const action=state.externalAction;
  const creating=state.phase==="payment_link_creating";
  const failed=state.phase==="integration_failure";
  return <div className="scene proof-scene">
    <SceneIntro eyebrow={failed?"Provider needs attention":creating?"Creating payment":"Ready to prove"} tone={failed?"red":"blue"} title="Prove it with Razorpay." body="Replay results and provider money stay separate—always." />
    <div className="ledger-grid">
      <div><span>Recovered in replay</span><strong>{formatInr(state.ledger.simulatedAmountPaise)}</strong><small>{state.ledger.simulatedCases} synthetic cases</small></div>
      <div className="razorpay-ledger"><span>Razorpay Test Mode</span><strong>{formatInr(state.ledger.razorpayTestAmountPaise)}</strong><small>{state.ledger.testModeCases} sandbox captures</small></div>
    </div>
    {action?<div className={failed?"provider-card failed":"provider-card"}><div><span>Payment reference</span><code>{action.referenceId}</code></div><div><span>Amount</span><b>{formatInr(action.amountPaise)}</b></div><div><span>Status</span><b>{action.providerStatus??action.status}</b></div>{action.shortUrl&&<a href={action.shortUrl} target="_blank" rel="noreferrer">Open payment <ExternalLink size={15}/></a>}{action.failureReason&&<p><TriangleAlert size={15}/>{action.failureReason}</p>}</div>:<div className="provider-empty"><LockKeyhole size={17}/><span>The payment reference is persisted before Razorpay is contacted.</span></div>}
  </div>;
}

function CompletedScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene completed-scene">
    <div className="success-icon"><Check size={30}/></div>
    <SceneIntro eyebrow={state.phase==="completed"?"Proof complete":"Payment captured"} tone="green" title={`${formatInr(state.ledger.razorpayTestAmountPaise)} recovered in Razorpay Test Mode.`} body="One captured payment. Customer contact stopped. Synthetic and sandbox ledgers remain separate." />
    <div className="proof-checks">{["Fixture verified","Two human approvals","Signed webhook matched","Duplicate execution blocked"].map((item,index)=><span key={item} className={index===3&&state.phase!=="completed"?"pending":""}>{index===3&&state.phase!=="completed"?<Clock3 size={16}/>:<BadgeCheck size={16}/>}<b>{item}</b></span>)}</div>
  </div>;
}

function TerminalScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene centered-scene terminal-scene"><div className="terminal-icon"><Ban size={27}/></div><SceneIntro eyebrow="Safe state" tone="red" title={state.phase==="escalated"?"Incident escalated.":"Recovery stopped."} body="No further contact or payment action can occur. The evidence remains intact." /></div>;
}

function ActionDock({state,action,busy,perform}:{state:RecoveryRunSnapshot;action:PrimaryAction|null;busy:RunCommand|null;perform:(command:RunCommand,payload?:Record<string,unknown>)=>Promise<void>}) {
  const ActionIcon=action?.icon??Activity;
  return <footer className="action-dock">
    <div className="action-boundary"><ShieldCheck size={17}/><span><b>Human-controlled</b> Policy sets the boundary. You approve execution.</span></div>
    <div className="action-controls">
      {state.phase==="awaiting_canary_approval"&&<button className="secondary-command" disabled={Boolean(busy)} onClick={()=>void perform("reject_canary")}><Ban size={15}/>Reject</button>}
      {action&&<button className="primary-command" disabled={Boolean(busy)} onClick={()=>void perform(action.command, action.command==="approve_canary"||action.command==="approve_promotion"?{reason:"Authenticated operator reviewed the displayed evidence and authorized this bounded step."}:undefined)}>
        {busy?<LoaderCircle className="spin" size={18}/>:<ActionIcon size={18}/>}<span><b>{busy?"Working…":action.label}</b><small>{busy?"Persisting the next safe state":action.hint}</small></span><ArrowRight size={17}/>
      </button>}
      {!action&&<div className="processing-state"><LoaderCircle className="spin" size={17}/>No action needed</div>}
    </div>
  </footer>;
}

function EvidenceDrawer({state,onClose}:{state:RecoveryRunSnapshot;onClose:()=>void}) {
  const integrations = [
    ["Gemini agent", state.integration.gemini], ["Razorpay Test Mode", state.integration.razorpay],
    ["Signed webhook", state.integration.webhookSecret], ["Supabase", state.integration.persistence==="supabase"],
  ] as const;
  return <div className="drawer-layer" role="presentation">
    <button className="drawer-backdrop" onClick={onClose} aria-label="Close evidence" />
    <aside className="evidence-drawer" aria-label="Evidence and system status">
      <header><div><span>Evidence</span><h2>Proof behind every action.</h2></div><button onClick={onClose} aria-label="Close evidence"><X size={20}/></button></header>
      <section><div className="drawer-section-title"><span>Systems</span><b>{integrations.filter(([,active])=>active).length}/4 connected</b></div><div className="integration-grid">{integrations.map(([label,active])=><div key={label}><i className={active?"active":""}/><span>{label}</span><b>{active?"Connected":"Not configured"}</b></div>)}</div></section>
      <section><div className="drawer-section-title"><span>Evaluation</span><b>{state.metrics.evaluatedCases} windows</b></div><div className="evaluation-grid"><Metric label="Precision" value={percent(state.metrics.detectionPrecision)} detail="Pipeline"/><Metric label="Recall" value={percent(state.metrics.detectionRecall)} detail="Pipeline"/><Metric label="Cohort F1" value={percent(state.metrics.cohortF1)} detail="Segment"/><Metric label="Selection" value={percent(state.metrics.playbookAccuracy)} detail="Policy"/></div><p className="dataset-note"><FileCheck2 size={14}/>{state.metrics.safetyCases} adversarial cases · {state.metrics.datasetHash.slice(0,12)}</p></section>
      <section><div className="drawer-section-title"><span>Approvals</span><b>{state.approvals.length} receipts</b></div>{state.approvals.length?<div className="approval-list">{state.approvals.slice(-2).map(item=><div key={item.id}><BadgeCheck size={16}/><span><b>{item.type} approved</b><small>{item.actorId} · v{item.approvedVersion}</small></span><code>{item.receiptDigest.slice(0,10)}</code></div>)}</div>:<p className="empty-note">No approval has been requested yet.</p>}</section>
      <section className="audit-section"><div className="drawer-section-title"><span>Audit trail</span><b>{state.audit.length} events</b></div><div className="audit-stream">{state.audit.slice(-10).reverse().map(event=><AuditRow key={event.id} event={event}/>)}</div></section>
      <footer><LockKeyhole size={14}/><span>Hash {state.audit.at(-1)?.hash.slice(0,16)??state.dataset.manifestHash.slice(0,16)}</span><b>Version {state.version}</b></footer>
    </aside>
  </div>;
}

function AuditRow({event}:{event:AuditEvent}) {
  const icons={success:Check,warning:TriangleAlert,blocked:Ban,info:Activity};
  const Icon=icons[event.status];
  return <div className="audit-row"><span className={event.status}><Icon size={13}/></span><div><b>{event.title}</b><p>{event.detail}</p><small>{time(event.createdAt)} · {event.actor}</small></div></div>;
}

function Metric({label,value,detail,tone="blue"}:{label:string;value:string;detail:string;tone?:"blue"|"red"|"green"}) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
