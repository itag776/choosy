"use client";
/* eslint-disable @next/next/no-html-link-for-pages */
import { FormEvent, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";

export default function OperatorLogin({ productionReady }: { productionReady: boolean }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function login(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(null); const form = new FormData(event.currentTarget); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actorId: form.get("actorId"), accessCode: form.get("accessCode") }) }); const result = await response.json() as { error?: string }; if (!response.ok) { setError(result.error ?? "Sign-in failed."); setBusy(false); return; } window.location.reload(); }
  return <main className="merchant-login"><section className="login-card"><a className="wordmark" href="/">choosy</a><div className="login-icon"><LockKeyhole size={22}/></div><p className="eyebrow">Merchant cockpit</p><h1>See every decision.</h1><p>Growth signals, integration status, inventory controls, and a complete audit trail.</p><form onSubmit={login}><label>Operator ID<input name="actorId" defaultValue="operator_judge" pattern="operator_[a-z0-9_-]{2,32}" required autoComplete="username"/></label><label>Access code<input name="accessCode" type="password" required autoComplete="current-password" placeholder={productionReady ? "Configured by deployment owner" : "Local code: choosy-demo"}/></label>{error&&<p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ArrowRight size={17}/>} {busy?"Opening cockpit":"Continue"}</button></form><small>{productionReady?"Secure operator access is active":"Development access is active"}</small></section></main>;
}
