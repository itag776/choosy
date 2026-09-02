"use client";

import {
  Activity, ArrowRight, BadgeCheck, Ban, Bot, Check, CircleDollarSign,
  Clock3, ExternalLink, FileCheck2, FlaskConical, Info, LoaderCircle, LockKeyhole,
  LogOut, Play, RefreshCcw, RotateCcw, ShieldCheck, TriangleAlert, Webhook, X, Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { presentationFor } from "@/lib/presentation";
import { inconclusiveEvidenceExample } from "@/lib/statistics";
import type {
  ActionId, AuditEvent, CandidatePlaybook, OperatorIdentity, RecoveryRunSnapshot, RunCommand, RunPhase,
} from "@/lib/types";

const transitional = new Set<RunPhase>([
  "incident_streaming", "investigating", "canary_running", "evaluating_promotion", "payment_link_creating",
]);

const chapters: Array<{ label: string; phases: RunPhase[] }> = [
  { label: "Detect", phases: ["idle", "incident_streaming", "incident_detected"] },
  { label: "Understand", phases: ["investigating", "agent_failure", "awaiting_canary_approval"] },
  { label: "Test", phases: ["canary_approved", "canary_running", "canary_complete", "rejected"] },
  { label: "Decide", phases: ["evaluating_promotion", "awaiting_promotion_approval", "stopped", "escalated"] },
  { label: "Prove", phases: ["promoted", "payment_link_creating", "payment_link_created", "test_payment_captured", "completed", "integration_failure"] },
];

function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function time(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

type PrimaryAction = { command: RunCommand; label: string; hint: string; icon: typeof Play };
type DrawerName = "evidence" | "explanation";

function primaryAction(state: RecoveryRunSnapshot): PrimaryAction | null {
  switch (state.phase) {
    case "idle": return { command: "inject_incident", label: "Start incident", hint: "Check the verified payment replay", icon: Play };
    case "incident_detected":
    case "agent_failure": return { command: "investigate", label: state.phase === "agent_failure" ? "Retry Gemini" : "Let Gemini decide", hint: "Rank four bounded recovery actions", icon: Bot };
    case "awaiting_canary_approval": return { command: "approve_canary", label: "Approve 80-case test", hint: "Commit the selected 40 × 40 comparison", icon: LockKeyhole };
    case "canary_approved": return { command: "run_canary", label: "Run the test", hint: "Measure both actions on 40 cases", icon: FlaskConical };
    case "canary_complete": return { command: "evaluate_promotion", label: "Compare results", hint: "Check the winner and stopping rules", icon: Bot };
    case "awaiting_promotion_approval": return { command: "approve_promotion", label: "Approve the winner", hint: "Authorize only the measured option", icon: Zap };
    case "promoted": return { command: "create_test_link", label: "Create ₹400 test payment", hint: "Verify the Razorpay provider path", icon: CircleDollarSign };
    case "payment_link_created": return { command: "sync_test_link", label: "Check payment status", hint: "Read Razorpay's current state", icon: RefreshCcw };
    case "test_payment_captured": return { command: "replay_demo_webhook", label: "Replay signed webhook", hint: "Confirm it cannot count ₹400 twice", icon: Webhook };
    case "integration_failure":
      return state.externalAction?.providerId
        ? { command: "sync_test_link", label: "Reconcile payment", hint: "Check the stored Razorpay action", icon: RefreshCcw }
        : { command: "create_test_link", label: "Retry safely", hint: "Reuse the stored reference first", icon: RefreshCcw };
    case "completed":
    case "rejected":
    case "stopped":
    case "escalated":
      return { command: "reset_replay", label: "Start a new incident", hint: "Keep the audit trail and reset the replay", icon: RotateCcw };
    default: return null;
  }
}

export default function IncidentRoom({ initialState, operator }: { initialState: RecoveryRunSnapshot; operator: OperatorIdentity }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<RunCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<DrawerName | null>(null);
  const drawerTrigger = useRef<HTMLButtonElement | null>(null);
  const drawerLayer = useRef<HTMLDivElement | null>(null);

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

  const openDrawer = useCallback((name: DrawerName, trigger?: HTMLButtonElement) => {
    if (trigger) drawerTrigger.current = trigger;
    setActiveDrawer(name);
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null);
    window.requestAnimationFrame(() => drawerTrigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!activeDrawer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      drawerLayer.current?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(drawerLayer.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeDrawer, closeDrawer]);

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
          <button className={allConnected ? "systems-pill connected" : "systems-pill"} onClick={(event) => openDrawer("evidence", event.currentTarget)} aria-expanded={activeDrawer === "evidence"} aria-controls="evidence-drawer">
            <i />{allConnected ? "All systems connected" : `${systems.filter(Boolean).length}/4 systems connected`}
          </button>
          <button className="text-control" onClick={(event) => openDrawer("evidence", event.currentTarget)} aria-expanded={activeDrawer === "evidence"} aria-controls="evidence-drawer"><FileCheck2 size={15} />Evidence</button>
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
          <ActionDock state={state} action={action} busy={busy} perform={perform} onExplain={(trigger) => openDrawer("explanation", trigger)} explanationOpen={activeDrawer === "explanation"} />
        </section>
      </div>

      {activeDrawer && <div ref={drawerLayer}>
        {activeDrawer === "explanation"
          ? <ExplanationDrawer state={state} onClose={closeDrawer} onViewEvidence={() => setActiveDrawer("evidence")} />
          : <EvidenceDrawer state={state} onClose={closeDrawer} />}
      </div>}
    </main>
  );
}

function Scene({ state }: { state: RecoveryRunSnapshot }) {
  switch (state.phase) {
    case "idle": return <ReadyScene state={state} />;
    case "incident_streaming": return <StreamingScene state={state} />;
    case "incident_detected": return <IncidentScene state={state} />;
    case "investigating": return <InvestigatingScene state={state} />;
    case "agent_failure": return <AgentFailureScene state={state} />;
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

function StateIntro({ state }: { state: RecoveryRunSnapshot }) {
  const copy = presentationFor(state);
  return <SceneIntro eyebrow={copy.eyebrow} title={copy.title} body={copy.body} tone={copy.tone} />;
}

function ReadyScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene ready-scene">
    <div className="ready-copy">
      <StateIntro state={state} />
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
    <StateIntro state={state} />
    <div className="scan-line"><LoaderCircle className="spin" size={16} /><span>Verified fixture</span><code>{state.dataset.manifestHash.slice(0,12)}</code></div>
  </div>;
}

function IncidentScene({ state }: { state: RecoveryRunSnapshot }) {
  const incident=state.incident!;
  return <div className="scene incident-scene">
    <StateIntro state={state} />
    <div className="primary-metrics">
      <Metric label="Revenue at risk" value={formatInr(incident.revenueAtRiskPaise)} detail="Synthetic replay" tone="red" />
      <Metric label="Affected payments" value={String(incident.affectedAttempts)} detail="Isolated cohort" />
      <Metric label="Observed success" value={percent(incident.observedSuccessRate)} detail={`Down ${incident.deltaPercentagePoints.toFixed(1)} points`} tone="red" />
    </div>
    <div className="cause-line"><span>Likely path</span><b>{incident.title}</b><em>{percent(incident.incidentScore)} signal</em></div>
  </div>;
}

function InvestigatingScene({ state }: { state: RecoveryRunSnapshot }) {
  const tools = ["Read incident evidence", "Check merchant policy", "Find eligible cases", "Rank four recovery actions", "Challenge the leading cause"];
  return <div className="scene investigating-scene">
    <div className="agent-orb"><Bot size={27} /></div>
    <StateIntro state={state} />
    <div className="investigation-list">{tools.map((tool,index)=><div key={tool} style={{"--delay":`${index*110}ms`} as React.CSSProperties}><span>{index+1}</span><b>{tool}</b><LoaderCircle className="spin" size={15} /></div>)}</div>
  </div>;
}

function AgentFailureScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene centered-scene terminal-scene"><div className="terminal-icon"><Bot size={27}/></div><StateIntro state={state}/><div className="agent-fail-note"><ShieldCheck size={16}/><span>No rules-based choice was substituted.</span></div></div>;
}

function PlaybookCard({ playbook }: { playbook: CandidatePlaybook }) {
  return <article className={playbook.selected?"playbook-card selected":"playbook-card"}><header><span>#{playbook.rank}{playbook.selected?" · Selected":""}</span><b>{playbook.timingMinutes ? `${playbook.timingMinutes} min` : "Now"}</b></header><h3>{playbook.name}</h3><p>{playbook.rationale}</p><footer>{playbook.channel==="none"?<span>No contact</span>:playbook.enabledMethods.map(method=><span key={method}>{method.replaceAll("_"," ")}</span>)}</footer></article>;
}

function StrategyScene({ state }: { state: RecoveryRunSnapshot }) {
  const result=state.investigation!;
  return <div className="scene strategy-scene">
    <StateIntro state={state} />
    <div className="decision-source"><Bot size={16}/><b>{result.mode==="gemini_cache"?"Validated Gemini cache":"Live Gemini"}</b><span>ranked the complete action catalogue</span></div>
    <div className="playbook-grid ranked">{result.rankedActions.map((playbook)=><PlaybookCard key={playbook.id} playbook={playbook}/>)}</div>
    <div className="policy-strip compact"><ShieldCheck size={18}/><div><b>Bounded by policy</b><span>Amount, consent, methods and contact limits passed.</span></div><em>{state.policyDecision?.checkedRules.length} checks</em></div>
  </div>;
}

function CanaryScene({ state, running }: { state: RecoveryRunSnapshot; running: boolean }) {
  const selected = state.investigation?.playbooks.map((action)=>action.id) as [ActionId,ActionId] | undefined;
  const assignments = state.canaryAssignments.length ? state.canaryAssignments : Array.from({length:80},(_,index)=>({ordinal:index+1,playbookId:selected?.[index<40?0:1]??(index<40?"timed_retry":"multi_rail_link")}));
  const first=selected?.[0]??assignments[0]!.playbookId;
  const second=selected?.[1]??assignments[40]!.playbookId;
  return <div className="scene canary-scene">
    <StateIntro state={state} />
    <div className="canary-board"><div className="canary-label"><span>80 committed cases</span><b>40 × 40</b></div><div className="case-dots large">{assignments.map((assignment,index)=><i key={index} className={assignment.playbookId === second ? "option-b" : "option-a"} aria-label={`Case ${assignment.ordinal}`}/>)}</div></div>
    <div className="canary-legend"><span><i className="option-a"/>{actionName(state,first)} · 40</span><span><i className="option-b"/>{actionName(state,second)} · 40</span>{running&&<em><LoaderCircle className="spin" size={14}/>Generating sealed outcomes</em>}</div>
  </div>;
}

function ResultScene({ state }: { state: RecoveryRunSnapshot }) {
  const canary=state.canary!;
  const [first,second]=canary.results;
  const winner=canary.results.find(item=>item.playbookId===canary.winnerId)!;
  const evaluating=state.phase==="evaluating_promotion";
  return <div className="scene result-scene">
    <StateIntro state={state} />
    <div className="result-card">
      <ResultLane label={actionName(state,first.playbookId)} result={first.recovered} total={first.attempted} rate={first.conversionRate} winner={canary.winnerId===first.playbookId}/>
      <ResultLane label={actionName(state,second.playbookId)} result={second.recovered} total={second.attempted} rate={second.conversionRate} winner={canary.winnerId===second.playbookId}/>
    </div>
    <div className="evidence-gate"><div><span>Incremental recovery</span><strong>{formatInr(canary.comparison.recoveredValueDifferencePaise)}</strong></div><div><span>Absolute lift</span><strong>+{Math.round(canary.comparison.absoluteLift*100)} pts</strong></div><div><span>95% interval</span><strong>{signedPoints(canary.comparison.confidenceInterval[0])} to {signedPoints(canary.comparison.confidenceInterval[1])}</strong></div></div>
    <div className="recommendation-strip">{evaluating?<LoaderCircle className="spin" size={19}/>:<BadgeCheck size={19}/>}<div><span>{canary.comparison.gate==="pass"?"Evidence gate passed":"Expansion withheld"}</span><b>{state.promotion?.reason ?? `${actionName(state,winner.playbookId)} leads on payments, value and uncertainty.`}</b></div><em>{canary.liftMultiple.toFixed(1)}× lift</em></div>
  </div>;
}

function actionName(state:RecoveryRunSnapshot,id:ActionId):string { return state.investigation?.rankedActions.find(action=>action.id===id)?.name??id.replaceAll("_"," "); }
function signedPoints(value:number):string { return `${value>=0?"+":""}${(value*100).toFixed(1)} pts`; }

function ResultLane({label,result,total,rate,winner=false}:{label:string;result:number;total:number;rate:number;winner?:boolean}) {
  return <div className={winner?"result-lane winner":"result-lane"}><header><span>{label}</span>{winner&&<b><BadgeCheck size={14}/>Winner</b>}</header><div><i style={{width:`${rate*100}%`}}/></div><footer><strong>{percent(rate)}</strong><span>{result}/{total} recovered</span></footer></div>;
}

function ProofScene({ state }: { state: RecoveryRunSnapshot }) {
  const action=state.externalAction;
  const failed=state.phase==="integration_failure";
  return <div className="scene proof-scene">
    <StateIntro state={state} />
    <div className="ledger-grid">
      <div><span>Recovered in replay</span><strong>{formatInr(state.ledger.simulatedAmountPaise)}</strong><small>{state.ledger.simulatedCases} synthetic cases</small></div>
      <div className="razorpay-ledger"><span>Razorpay Test Mode</span><strong>{formatInr(state.ledger.razorpayTestAmountPaise)}</strong><small>{state.ledger.testModeCases} sandbox captures</small></div>
    </div>
    {action?<><div className="provider-flow"><span className={action.providerId?"done":"current"}><Check size={13}/>Link created</span><span className={action.notificationStatus==="accepted"||action.notificationStatus==="stopped"?"done":"current"}><Check size={13}/>Email accepted</span><span className={action.status==="paid"?"done":""}><Check size={13}/>Payment captured</span><span className={action.notificationStatus==="stopped"?"done":""}><Check size={13}/>Contact stopped</span></div><div className={failed?"provider-card failed":"provider-card"}><div><span>Payment reference</span><code>{action.referenceId}</code></div><div><span>Recipient</span><b>{action.maskedRecipient??"Pending"}</b></div><div><span>Provider status</span><b>{action.providerStatus??action.status}</b></div>{action.shortUrl&&<a href={action.shortUrl} target="_blank" rel="noreferrer">Open payment <ExternalLink size={15}/></a>}{action.failureReason&&<p><TriangleAlert size={15}/>{action.failureReason}</p>}</div></>:<div className="provider-empty"><LockKeyhole size={17}/><span>The payment reference is persisted before Razorpay is contacted.</span></div>}
  </div>;
}

function CompletedScene({ state }: { state: RecoveryRunSnapshot }) {
  const signedWebhook = state.audit.some((event) => event.kind === "webhook" && /captured|HMAC-verified/i.test(`${event.title} ${event.detail}`));
  const checks = [
    { label: "Fixture verified", complete: true },
    { label: "Razorpay email accepted", complete: state.externalAction?.notificationStatus === "stopped" },
    { label: "Signed webhook matched", complete: signedWebhook },
    { label: "Duplicate execution blocked", complete: state.phase === "completed" },
  ];
  return <div className="scene completed-scene">
    <div className="success-icon"><Check size={30}/></div>
    <StateIntro state={state} />
    <div className="proof-checks">{checks.map((item)=><span key={item.label} className={item.complete?"":"pending"}>{item.complete?<BadgeCheck size={16}/>:<Clock3 size={16}/>}<b>{item.label}</b></span>)}</div>
  </div>;
}

function TerminalScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene centered-scene terminal-scene"><div className="terminal-icon"><Ban size={27}/></div><StateIntro state={state} /></div>;
}

function ActionDock({state,action,busy,perform,onExplain,explanationOpen}:{state:RecoveryRunSnapshot;action:PrimaryAction|null;busy:RunCommand|null;perform:(command:RunCommand,payload?:Record<string,unknown>)=>Promise<void>;onExplain:(trigger:HTMLButtonElement)=>void;explanationOpen:boolean}) {
  const ActionIcon=action?.icon??Activity;
  return <footer className="action-dock">
    <div className="action-guidance"><div className="action-boundary"><ShieldCheck size={17}/><span><b>Bounded by policy</b> Amount, consent and contact limits stay fixed.</span></div><button className="explain-control" onClick={(event)=>onExplain(event.currentTarget)} aria-expanded={explanationOpen} aria-controls="explanation-drawer"><Info size={15}/>How this works</button></div>
    <div className="action-controls">
      {state.phase==="awaiting_canary_approval"&&<button className="secondary-command" disabled={Boolean(busy)} onClick={()=>void perform("reject_canary")}><Ban size={15}/>Reject</button>}
      {action&&<button className="primary-command" disabled={Boolean(busy)} onClick={()=>void perform(action.command, action.command==="approve_canary"||action.command==="approve_promotion"?{reason:"Authenticated operator reviewed the displayed evidence and authorized this bounded step."}:undefined)}>
        {busy?<LoaderCircle className="spin" size={18}/>:<ActionIcon size={18}/>}<span><b>{busy?"Working…":action.label}</b><small>{busy?"Persisting the next safe state":action.hint}</small></span><ArrowRight size={17}/>
      </button>}
      {!action&&<div className="processing-state"><LoaderCircle className="spin" size={17}/>No action needed</div>}
    </div>
  </footer>;
}

function ExplanationDrawer({state,onClose,onViewEvidence}:{state:RecoveryRunSnapshot;onClose:()=>void;onViewEvidence:()=>void}) {
  const copy = presentationFor(state);
  return <div className="drawer-layer" role="presentation">
    <button className="drawer-backdrop" tabIndex={-1} onClick={onClose} aria-label="Close explanation" />
    <aside id="explanation-drawer" className="explanation-drawer" role="dialog" aria-modal="true" aria-labelledby="explanation-title">
      <header><div><span>Current step</span><h2 id="explanation-title">{copy.explanation.title}</h2></div><button data-drawer-close onClick={onClose} aria-label="Close explanation"><X size={20}/></button></header>
      <div className="explanation-body">
        <p className="explanation-summary">{copy.explanation.summary}</p>
        <ol className="explanation-flow">{copy.explanation.steps.map((item,index)=><li key={item.label} className={item.status}>
          <div className="flow-marker">{item.status==="complete"?<Check size={15}/>:index+1}</div>
          <div className="flow-copy"><span>{item.label}</span><b>{item.value}</b><p>{item.detail}</p></div>
        </li>)}</ol>
        <div className="explanation-boundary"><ShieldCheck size={19}/><div><span>What Kept cannot do</span><p>{copy.explanation.boundary}</p></div></div>
      </div>
      <footer><button onClick={onViewEvidence}><FileCheck2 size={15}/>View technical evidence<ArrowRight size={14}/></button><span>Live run · version {state.version}</span></footer>
    </aside>
  </div>;
}

function EvidenceDrawer({state,onClose}:{state:RecoveryRunSnapshot;onClose:()=>void}) {
  const [showWeakEvidence,setShowWeakEvidence]=useState(false);
  const weak=inconclusiveEvidenceExample();
  const integrations = [
    ["Gemini agent", state.integration.gemini], ["Razorpay Test Mode", state.integration.razorpay],
    ["Signed webhook", state.integration.webhookSecret], ["Supabase", state.integration.persistence==="supabase"],
  ] as const;
  return <div className="drawer-layer" role="presentation">
    <button className="drawer-backdrop" tabIndex={-1} onClick={onClose} aria-label="Close evidence" />
    <aside id="evidence-drawer" className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <header><div><span>Evidence</span><h2 id="evidence-title">The record behind each action.</h2></div><button data-drawer-close onClick={onClose} aria-label="Close evidence"><X size={20}/></button></header>
      <section><div className="drawer-section-title"><span>Systems</span><b>{integrations.filter(([,active])=>active).length}/4 connected</b></div><div className="integration-grid">{integrations.map(([label,active])=><div key={label}><i className={active?"active":""}/><span>{label}</span><b>{active?"Connected":"Not configured"}</b></div>)}</div></section>
      <section><div className="drawer-section-title"><span>Evaluation</span><b>{state.metrics.evaluatedCases} windows</b></div><div className="evaluation-grid"><Metric label="Precision" value={percent(state.metrics.detectionPrecision)} detail="Pipeline"/><Metric label="Recall" value={percent(state.metrics.detectionRecall)} detail="Pipeline"/><Metric label="Cohort F1" value={percent(state.metrics.cohortF1)} detail="Segment"/><Metric label="Rules baseline" value={percent(state.metrics.playbookAccuracy)} detail="Comparison"/></div><p className="dataset-note"><FileCheck2 size={14}/>{state.metrics.safetyCases} adversarial cases · {state.metrics.datasetHash.slice(0,12)}</p><button className="weak-evidence-toggle" onClick={()=>setShowWeakEvidence(value=>!value)} aria-expanded={showWeakEvidence}>{showWeakEvidence?"Hide inconclusive result":"See an inconclusive result"}<ArrowRight size={14}/></button>{showWeakEvidence&&<div className="weak-evidence-card"><header><span>40 × 40 guardrail case</span><b>Do not promote</b></header><strong>52.5% vs 47.5%</strong><p>95% interval {signedPoints(weak.confidenceInterval[0])} to {signedPoints(weak.confidenceInterval[1])}. Because it crosses zero and lift is below 10 points, Kept collects more evidence instead of scaling.</p></div>}</section>
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
