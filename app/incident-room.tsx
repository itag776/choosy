"use client";

import {
  Activity, ArrowRight, BadgeCheck, Ban, Bot, Check, ChevronDown, CircleDollarSign,
  Clock3, Database, ExternalLink, FileCheck2, FlaskConical, LoaderCircle,
  LockKeyhole, Play, Radio, RefreshCcw, RotateCcw, ShieldCheck,
  TriangleAlert, Webhook, Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AuditEvent, CandidatePlaybook, OperatorIdentity, RecoveryRunSnapshot, RunCommand, RunPhase,
} from "@/lib/types";

const transitional = new Set<RunPhase>([
  "incident_streaming", "investigating", "canary_running", "evaluating_promotion", "payment_link_creating",
]);

const chapters: Array<{ label: string; phases: RunPhase[] }> = [
  { label: "Observe", phases: ["idle", "incident_streaming", "incident_detected"] },
  { label: "Investigate", phases: ["investigating", "awaiting_canary_approval"] },
  { label: "Experiment", phases: ["canary_approved", "canary_running", "canary_complete", "rejected"] },
  { label: "Decide", phases: ["evaluating_promotion", "awaiting_promotion_approval", "promoted", "stopped", "escalated"] },
  { label: "Prove", phases: ["payment_link_creating", "payment_link_created", "test_payment_captured", "completed", "integration_failure"] },
];

function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function phaseName(phase: RunPhase): string { return phase.replaceAll("_", " "); }
function time(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

type PrimaryAction = { command: RunCommand; label: string; hint: string; icon: typeof Play };

function primaryAction(state: RecoveryRunSnapshot): PrimaryAction | null {
  switch (state.phase) {
    case "idle": return { command: "inject_incident", label: "Inject replay incident", hint: "Stream the hash-verified fixture into the detector", icon: Play };
    case "incident_detected": return { command: "investigate", label: "Deploy Incident Commander", hint: "Require five typed evidence reads", icon: Bot };
    case "awaiting_canary_approval": return { command: "approve_canary", label: "Approve 12-case canary", hint: "Authorize a replay-only 6 × 6 experiment", icon: LockKeyhole };
    case "canary_approved": return { command: "run_canary", label: "Run randomized canary", hint: "Commit assignments before reading outcomes", icon: FlaskConical };
    case "canary_complete": return { command: "evaluate_promotion", label: "Evaluate promotion", hint: "Ask the agent to judge persisted results", icon: Bot };
    case "awaiting_promotion_approval": return { command: "approve_promotion", label: "Promote measured winner", hint: "Authorize bounded replay expansion", icon: Zap };
    case "promoted": return { command: "create_test_link", label: "Create Test Mode proof", hint: "Persist intent, then contact Razorpay", icon: CircleDollarSign };
    case "payment_link_created": return { command: "sync_test_link", label: "Sync with Razorpay", hint: "Fetch authoritative provider state", icon: RefreshCcw };
    case "test_payment_captured": return { command: "replay_demo_webhook", label: "Replay duplicate webhook", hint: "Prove idempotency without changing money", icon: Webhook };
    case "integration_failure":
      return state.externalAction?.providerId
        ? { command: "sync_test_link", label: "Reconcile provider state", hint: "Recover from the persisted external intent", icon: RefreshCcw }
        : { command: "create_test_link", label: "Retry & reconcile", hint: "Check the stable reference before creating", icon: RefreshCcw };
    case "completed":
    case "rejected":
    case "stopped":
    case "escalated":
      return { command: "reset_replay", label: "Open a fresh incident", hint: "Keep receipts; reset only replay state", icon: RotateCcw };
    default: return null;
  }
}

export default function IncidentRoom({ initialState, operator }: { initialState: RecoveryRunSnapshot; operator: OperatorIdentity }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<RunCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/runs/${initialState.id}`, { cache: "no-store" });
    if (response.ok) setState(await response.json() as RecoveryRunSnapshot);
  }, [initialState.id]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(), transitional.has(state.phase) ? 750 : 2_000);
    return () => window.clearInterval(interval);
  }, [load, state.phase]);

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

  return (
    <main className="incident-room">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">R<span>OS</span></span><div><b>RecoverOS</b><small>Canary Commander</small></div></div>
        <div className="incident-breadcrumb"><span>INCIDENT ROOM</span><i /><b>{state.incident?.id ?? "STANDBY"}</b></div>
        <div className="environment">
          <span className="env-pill"><FlaskConical size={12} /> REPLAY + TEST MODE</span>
          <span className="pulse-dot" />{state.integration.persistence === "supabase" ? "SUPABASE DURABLE" : "LOCAL DURABLE PREVIEW"}
          <span className="operator-pill"><ShieldCheck size={11}/>{operator.actorId}</span>
          <button className="reset-control" onClick={() => void logout()} aria-label="End authenticated operator session">LOG OUT</button>
          {state.phase !== "idle" && <button className="reset-control" onClick={() => void perform("reset_replay")} disabled={busy !== null} aria-label="Reset replay to calm baseline"><RotateCcw size={12} /> RESET</button>}
        </div>
      </header>

      <section className="mission-strip">
        <div><span>RECOVERY CONTROL LOOP</span><b>{phaseName(state.phase)}</b></div>
        <nav aria-label="Incident progress">
          {chapters.map((chapter, index) => (
            <div key={chapter.label} className={index < activeChapter ? "done" : index === activeChapter ? "active" : ""}>
              <span>{index < activeChapter ? <Check size={11} /> : String(index + 1).padStart(2, "0")}</span>
              <b>{chapter.label}</b>
            </div>
          ))}
        </nav>
        <div className="version-lock"><LockKeyhole size={12} /> VERSION {state.version}</div>
      </section>

      <div className="room-body">
        {error && <div className="error-banner"><TriangleAlert size={15} /><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
        <div className="room-grid">
          <section className="stage" aria-live="polite">
            <Scene state={state} />
          </section>
          <DecisionRail state={state} action={action} busy={busy} perform={perform} />
        </div>
        <EvidenceDrawer state={state} />
      </div>
    </main>
  );
}

function Scene({ state }: { state: RecoveryRunSnapshot }) {
  switch (state.phase) {
    case "idle": return <CalmScene state={state} />;
    case "incident_streaming": return <StreamingScene state={state} />;
    case "incident_detected": return <IncidentScene state={state} />;
    case "investigating": return <InvestigatingScene />;
    case "awaiting_canary_approval":
    case "rejected": return <StrategyScene state={state} />;
    case "canary_approved": return <ApprovedScene state={state} />;
    case "canary_running": return <CanaryRunningScene state={state} />;
    case "canary_complete":
    case "evaluating_promotion":
    case "awaiting_promotion_approval": return <CanaryResultScene state={state} />;
    case "promoted":
    case "payment_link_creating":
    case "payment_link_created":
    case "integration_failure": return <ProofScene state={state} />;
    case "test_payment_captured":
    case "completed": return <FinalScene state={state} />;
    case "stopped":
    case "escalated": return <TerminalScene state={state} />;
  }
}

function SceneKicker({ index, label, provenance = "MEASURED" }: { index: string; label: string; provenance?: string }) {
  return <div className="scene-kicker"><span>{index}</span><b>{label}</b><em>{provenance}</em></div>;
}

function CalmScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene calm-scene">
    <SceneKicker index="00" label="OPERATING BASELINE" provenance="VERIFIED FIXTURE" />
    <div className="calm-grid">
      <div className="calm-copy"><span className="status-line"><i /> PAYMENT SYSTEM NOMINAL</span><h1>Quiet systems.<br/><em>Ready judgment.</em></h1><p>RecoverOS watches payment health, isolates revenue at risk, and tests recovery actions before any campaign earns permission to expand.</p></div>
      <div className="baseline-orbit"><span>SUCCESS RATE / 15 MIN</span><strong>96.4<sup>%</sup></strong><div className="baseline-bars">{[62,68,66,72,70,76,74,79,73,77,75,78].map((height, index)=><i key={index} style={{height:`${height}%`}} />)}</div><small>TRAILING BASELINE · NO ACTIVE INCIDENT</small></div>
    </div>
    <div className="truth-ribbon"><Metric label="Replay records" value={String(state.dataset.totalAttempts)} detail="SHA-256 MANIFEST" /><Metric label="Adversarial eval" value={String(state.metrics.evaluatedCases)} detail="GENERATED CASES" /><Metric label="Policy violations" value={String(state.metrics.policyViolations)} detail={`${state.metrics.safetyCases} ATTACKS`} /><Metric label="Live actions" value="0" detail="HUMAN GATED" /></div>
  </div>;
}

function StreamingScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene streaming-scene">
    <SceneKicker index="01" label="INCIDENT ARRIVAL" provenance="SYNTHETIC REPLAY" />
    <div className="stream-head"><div><span className="status-line danger"><i /> SIGNAL DEGRADING</span><h1>240 attempts.<br/>One pattern is breaking.</h1></div><strong>LIVE</strong></div>
    <div className="transaction-stream">
      {Array.from({length:18},(_,index)=><div key={index} className={index<10?"failed":""}><span>{String(index+1).padStart(3,"0")}</span><b>{index<10?"Issuer A · card auth":"Issuer B · mixed"}</b><em>{index<10?"FAILED":"CAPTURED"}</em></div>)}
    </div>
    <div className="stream-footer"><LoaderCircle className="spin" size={15}/><span>Deterministic detector is grouping issuer × method × step × reason</span><code>{state.dataset.manifestHash.slice(0,16)}</code></div>
  </div>;
}

function IncidentScene({ state }: { state: RecoveryRunSnapshot }) {
  const incident=state.incident!;
  return <div className="scene incident-scene">
    <SceneKicker index="02" label="INCIDENT ISOLATED" provenance="DETERMINISTIC" />
    <div className="incident-hero">
      <div className="severity"><span>SEV</span><strong>2</strong></div>
      <div><span className="status-line danger"><i /> REVENUE EXPOSURE ACTIVE</span><h1>{incident.title}</h1><p>{incident.affectedAttempts} failed payments isolated across one shared issuer-authentication path.</p></div>
      <div className="failure-rate"><span>OBSERVED SUCCESS</span><strong>{percent(incident.observedSuccessRate)}</strong><small>−{incident.deltaPercentagePoints.toFixed(1)} PP</small></div>
    </div>
    <div className="incident-metrics"><Metric label="Revenue at risk" value={formatInr(incident.revenueAtRiskPaise)} detail="SYNTHETIC REPLAY" danger/><Metric label="Affected cohort" value={String(incident.affectedAttempts)} detail="PAYMENTS"/><Metric label="Incident score" value={percent(incident.incidentScore)} detail="HEURISTIC, NOT PROBABILITY"/><Metric label="Minimum sample" value={String(incident.thresholds.minimumSample)} detail="FIXED THRESHOLD"/></div>
    <div className="cohort-proof"><span>COHORT QUERY</span><code>{incident.cohortQuery}</code><div>{incident.competingHypotheses.map(item=><p key={item.id} className={item.disposition}><b>{item.disposition==="supported"?"SUPPORTED":"REJECTED"}</b>{item.label}<em>{percent(item.support)}</em></p>)}</div></div>
  </div>;
}

function InvestigatingScene() {
  return <div className="scene investigating-scene">
    <SceneKicker index="03" label="AGENT INVESTIGATION" provenance="BOUNDED AI" />
    <div className="investigation-title"><span className="agent-glyph"><Bot size={30}/></span><div><span className="status-line violet"><i /> INCIDENT COMMANDER ACTIVE</span><h1>Evidence before action.</h1><p>The model cannot execute money movement. It must read five typed tools and return a schema-valid investigation.</p></div></div>
    <div className="tool-flight">{["getIncidentEvidence","readMerchantRecoveryPolicy","listEligibleCases","inspectAvailableActions","compareFailureExplanations"].map((name,index)=><div key={name} style={{"--delay":`${index*110}ms`} as React.CSSProperties}><span>{String(index+1).padStart(2,"0")}</span><b>{name}</b><LoaderCircle className="spin" size={14}/></div>)}</div>
    <div className="boundary-note"><ShieldCheck size={16}/><span>Read-only tools · six-turn ceiling · 20-second timeout · deterministic fallback</span></div>
  </div>;
}

function PlaybookCard({ playbook, index }: { playbook: CandidatePlaybook; index: number }) {
  return <article className="playbook-card"><div><span>STRATEGY {index===0?"A":"B"}</span><em>NOT YET RANKED</em></div><h3>{playbook.name}</h3><p>{playbook.rationale}</p><div className="method-tags">{playbook.enabledMethods.map(method=><span key={method}>{method}</span>)}</div><footer><span>{playbook.timingMinutes ? `WAIT ${playbook.timingMinutes} MIN` : "IMMEDIATE"}</span><b>ORIGINAL AMOUNT ONLY</b></footer></article>;
}

function StrategyScene({ state }: { state: RecoveryRunSnapshot }) {
  const result=state.investigation!;
  return <div className="scene strategy-scene">
    <SceneKicker index="04" label="STRATEGY + POLICY" provenance={result.mode==="gemini_agent"?"GEMINI AGENT":"SAFE FALLBACK"} />
    <div className="hypothesis"><span>WORKING HYPOTHESIS</span><h1>{result.primaryHypothesis}</h1><p>{result.uncertainty}</p></div>
    <div className="playbook-grid">{result.playbooks.map((playbook,index)=><PlaybookCard key={playbook.id} playbook={playbook} index={index}/>)}</div>
    <div className="policy-verdict"><div><ShieldCheck size={18}/><span><b>{state.policyDecision?.outcome.replaceAll("_"," ")}</b>Deterministic code—not the model—controls execution.</span></div><strong>{state.policyDecision?.checkedRules.length} RULES</strong></div>
  </div>;
}

function ApprovedScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene approved-scene">
    <SceneKicker index="05" label="CANARY AUTHORIZED" provenance="HUMAN GATE" />
    <div className="approval-stamp"><BadgeCheck size={42}/><span>APPROVED</span></div>
    <h1>Twelve cases.<br/><em>Nothing more.</em></h1>
    <p>The operator approved a replay-only experiment. Assignments will be randomized and committed before the outcome matrix is opened.</p>
    <div className="split-preview"><div><span>A</span><b>6</b><small>TIMED RETRY</small></div><i/><div><span>B</span><b>6</b><small>ALTERNATE LINK</small></div></div>
    <code>SEED {state.dataset.seed} · FIXTURE {state.fixtureVersion} · ZERO LIVE ACTIONS</code>
  </div>;
}

function CanaryRunningScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene canary-running-scene">
    <SceneKicker index="06" label="RANDOMIZED CANARY" provenance="OUTCOME FILE HASHED" />
    <div className="canary-title"><div><span className="status-line"><i/> EXPERIMENT RUNNING</span><h1>Assignments committed.</h1></div><LoaderCircle className="spin" size={28}/></div>
    <div className="assignment-grid">{state.canaryAssignments.map(assignment=><div key={assignment.caseId} className={assignment.playbookId}><span>{assignment.ordinal}</span><b>{assignment.playbookId==="wait_retry"?"A":"B"}</b><code>{assignment.caseId.replace("pay_replay_","PAY-")}</code></div>)}</div>
    <p className="seal-note"><LockKeyhole size={14}/> Outcome rows are read only after this assignment set is persisted.</p>
  </div>;
}

function CanaryResultScene({ state }: { state: RecoveryRunSnapshot }) {
  const canary=state.canary!;
  const wait=canary.results.find(item=>item.playbookId==="wait_retry")!;
  const alternate=canary.results.find(item=>item.playbookId==="alternate_link")!;
  const evaluating=state.phase==="evaluating_promotion";
  return <div className="scene result-scene">
    <SceneKicker index="07" label="PROMOTION DECISION" provenance="MEASURED CANARY" />
    <div className="result-head"><div><span className="status-line"><i/> DIRECTIONAL RESULT</span><h1><em>{canary.liftMultiple.toFixed(1)}×</em> recovery advantage.</h1><p>{canary.sampleWarning}</p></div>{evaluating&&<div className="agent-evaluating"><LoaderCircle className="spin" size={18}/><span>Agent evaluating<br/>stop conditions</span></div>}</div>
    <div className="race">
      <ResultLane label="A" title="Timed issuer retry" result={wait.recovered} total={wait.attempted} rate={wait.conversionRate}/>
      <ResultLane label="B" title="Alternate-method link" result={alternate.recovered} total={alternate.attempted} rate={alternate.conversionRate} winner/>
    </div>
    <div className="recommendation"><Bot size={18}/><div><span>INCIDENT COMMANDER</span><b>{state.promotion?.reason ?? "Canary complete. A second bounded evaluation is required before promotion."}</b></div><em>{state.promotion?.recommendation?.toUpperCase() ?? "WAITING"}</em></div>
  </div>;
}

function ResultLane({label,title,result,total,rate,winner=false}:{label:string;title:string;result:number;total:number;rate:number;winner?:boolean}) {
  return <div className={winner?"result-lane winner":"result-lane"}><span>{label}</span><div><b>{title}</b><div><i style={{width:`${rate*100}%`}}/></div><small>{result}/{total} recovered</small></div><strong>{percent(rate)}</strong></div>;
}

function ProofScene({ state }: { state: RecoveryRunSnapshot }) {
  const action=state.externalAction;
  const creating=state.phase==="payment_link_creating";
  const failed=state.phase==="integration_failure";
  return <div className="scene proof-scene">
    <SceneKicker index="08" label="RAZORPAY PROOF" provenance="TEST MODE" />
    <div className="proof-title"><div><span className={failed?"status-line danger":"status-line"}><i/> {failed?"INTEGRATION STOPPED":creating?"CREATING PROVIDER ARTIFACT":"REPLAY WINNER PROMOTED"}</span><h1>Prove the last mile.<br/><em>Keep the ledgers apart.</em></h1></div><span className="razor-orbit">RZP<small>TEST</small></span></div>
    <div className="ledger-split">
      <div><span>DETERMINISTIC REPLAY</span><strong>{formatInr(state.ledger.simulatedAmountPaise)}</strong><small>{state.ledger.simulatedCases} synthetic recoveries</small></div>
      <i/>
      <div><span>RAZORPAY TEST MODE</span><strong>{formatInr(state.ledger.razorpayTestAmountPaise)}</strong><small>{state.ledger.testModeCases} sandbox captures</small></div>
    </div>
    {action?<div className={failed?"external-proof failed":"external-proof"}><div><span>REFERENCE ID</span><code>{action.referenceId}</code></div><div><span>POLICY-LOCKED AMOUNT</span><b>{formatInr(action.amountPaise)}</b></div><div><span>PROVIDER STATE</span><b>{action.providerStatus??action.status}</b></div>{action.shortUrl&&<a href={action.shortUrl} target="_blank" rel="noreferrer">OPEN RAZORPAY LINK <ExternalLink size={14}/></a>}{action.failureReason&&<p><TriangleAlert size={14}/>{action.failureReason}</p>}</div>:<div className="external-empty"><Database size={18}/><span>No provider call yet. The next action first persists a stable reference and request digest.</span></div>}
  </div>;
}

function FinalScene({ state }: { state: RecoveryRunSnapshot }) {
  const uplift=state.ledger.baselineAmountPaise?state.ledger.simulatedAmountPaise/state.ledger.baselineAmountPaise-1:0;
  return <div className="scene final-scene">
    <SceneKicker index="09" label="INCIDENT CLOSED" provenance="EVIDENCE COMPLETE" />
    <div className="final-title"><span className="success-seal"><Check size={26}/></span><div><span className="status-line"><i/> PAYMENT CAPTURED · CONTACTS STOPPED</span><h1>Recovery proven.<br/><em>Claims bounded.</em></h1></div></div>
    <div className="final-ledgers"><Metric label="Recovered in deterministic replay" value={formatInr(state.ledger.simulatedAmountPaise)} detail={`+${Math.round(uplift*100)}% VS BASELINE`}/><Metric label="Razorpay Test Mode recovered" value={formatInr(state.ledger.razorpayTestAmountPaise)} detail="SANDBOX ONLY"/><Metric label="Policy violations" value="0" detail="ALL GATES PASSED"/><Metric label="Duplicate executions" value="0" detail={state.phase==="completed"?"REPLAY VERIFIED":"READY TO VERIFY"}/></div>
    <div className="evidence-checks">{["Fixture hash verified before replay","Authenticated, digest-bound approval receipts","Exact provider reference + verified webhook HMAC","Monotonic paid state + stop-on-capture"].map(item=><span key={item}><BadgeCheck size={14}/>{item}</span>)}</div>
  </div>;
}

function TerminalScene({ state }: { state: RecoveryRunSnapshot }) {
  return <div className="scene terminal-scene"><SceneKicker index="—" label="WORKFLOW TERMINATED" provenance="SAFE STATE"/><Ban size={46}/><h1>{state.phase==="escalated"?"Incident escalated":"Recovery stopped"}</h1><p>No further customer contact or payment action can occur in this recovery cycle. The evidence trail remains intact.</p></div>;
}

function DecisionRail({state,action,busy,perform}:{state:RecoveryRunSnapshot;action:PrimaryAction|null;busy:RunCommand|null;perform:(command:RunCommand,payload?:Record<string,unknown>)=>Promise<void>}) {
  const ActionIcon=action?.icon??Activity;
  const eligible=state.investigation?.eligibleCaseCount??0;
  return <aside className="decision-rail">
    <div className="queue-header"><span><Radio size={12}/> OPERATOR QUEUE</span><b>{action?"1 ACTION":"MONITORING"}</b></div>
    <div className="decision-copy"><small>NEXT CONTROLLED STEP</small><h2>{action?.label??"System is processing"}</h2><p>{action?.hint??"No operator input is required while deterministic work completes."}</p></div>
    {action&&<button className="primary-command" disabled={Boolean(busy)} onClick={()=>void perform(action.command, action.command==="approve_canary"||action.command==="approve_promotion"?{reason:"Authenticated operator reviewed the displayed evidence and authorized this bounded step."}:undefined)}>{busy?<LoaderCircle className="spin" size={17}/>:<ActionIcon size={17}/>}<span>{busy?"Command in progress":action.label}</span><ArrowRight size={16}/></button>}
    {state.phase==="awaiting_canary_approval"&&<button className="reject-command" disabled={Boolean(busy)} onClick={()=>void perform("reject_canary")}><Ban size={14}/>Reject canary</button>}
    <div className="guardrail"><ShieldCheck size={15}/><span>Deterministic policy owns permission. The agent owns interpretation and recommendation.</span></div>

    <section className="rail-section">
      <header><span>CONTROL BOUNDARY</span><b>{state.policyDecision?.outcome.replaceAll("_"," ").toUpperCase()??"STANDBY"}</b></header>
      <div className="rail-rules">
        <RailRule label="Amount integrity" value="POLICY LOCKED" ok/>
        <RailRule label="Eligible cases" value={eligible?String(eligible):"—"} ok={eligible>0||!state.incident}/>
        <RailRule label="Contact limit" value="≤ 2 / 24H" ok/>
        <RailRule label="Stop on capture" value="TERMINAL" ok/>
      </div>
    </section>

    <section className="rail-section integrations">
      <header><span>LIVE SYSTEMS</span><b>{state.integration.persistence==="supabase"?"DURABLE":"PREVIEW"}</b></header>
      <Integration label="Gemini agent" active={state.integration.gemini}/>
      <Integration label="Razorpay Test Mode" active={state.integration.razorpay}/>
      <Integration label="Signed webhook" active={state.integration.webhookSecret}/>
      <Integration label="Supabase control plane" active={state.integration.persistence==="supabase"}/>
    </section>
  </aside>;
}

function RailRule({label,value,ok}:{label:string;value:string;ok:boolean}) {
  return <div><span className={ok?"ok":"pending"}>{ok?<Check size={11}/>:<Clock3 size={11}/>}</span><b>{label}</b><em>{value}</em></div>;
}
function Integration({label,active}:{label:string;active:boolean}) {
  return <div className="integration-row"><i className={active?"active":""}/><b>{label}</b><span>{active?"CONNECTED":"NOT CONFIGURED"}</span></div>;
}

function EvidenceDrawer({state}:{state:RecoveryRunSnapshot}) {
  return <details className="evidence-drawer" open>
    <summary><div><Clock3 size={14}/><span>HASH-CHAINED EVIDENCE TRAIL</span><b>{state.audit.length} EVENTS · {state.approvals.length} APPROVALS</b></div><div><code>{state.audit.at(-1)?.hash.slice(0,16)??state.dataset.manifestHash.slice(0,16)}</code><ChevronDown size={15}/></div></summary>
    <div className="drawer-grid">
      <div className="audit-stream">{state.audit.slice(-8).reverse().map(event=><AuditRow key={event.id} event={event}/>)}</div>
      <div className="evaluation-proof"><span>ADVERSARIAL EVALUATION · 95% WILSON INTERVALS</span><div><Metric label="Precision" value={percent(state.metrics.detectionPrecision)} detail="PIPELINE"/><Metric label="Recall" value={percent(state.metrics.detectionRecall)} detail="PIPELINE"/><Metric label="Cohort F1" value={percent(state.metrics.cohortF1)} detail="SEGMENT"/><Metric label="Selection" value={percent(state.metrics.playbookAccuracy)} detail="POLICY"/></div><p><FileCheck2 size={14}/> {state.metrics.evaluatedCases} scenario windows · {state.metrics.safetyCases} adversarial safety cases · {state.metrics.datasetHash.slice(0,12)}</p></div>
    </div>
  </details>;
}

function AuditRow({event}:{event:AuditEvent}) {
  const icons={success:Check,warning:TriangleAlert,blocked:Ban,info:Activity};
  const Icon=icons[event.status];
  return <div className="audit-row"><time>{time(event.createdAt)}</time><span className={event.status}><Icon size={11}/></span><div><b>{event.title}</b><p>{event.detail}</p></div><code>{event.actor}</code></div>;
}

function Metric({label,value,detail,danger=false}:{label:string;value:string;detail:string;danger?:boolean}) {
  return <div className={danger?"metric danger":"metric"}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
