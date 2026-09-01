"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, LoaderCircle, ShieldCheck } from "lucide-react";

export default function OperatorLogin({ productionReady }: { productionReady: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: form.get("actorId"), accessCode: form.get("accessCode") }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Operator sign-in failed.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return <main className="login-shell">
    <section className="login-card">
      <div className="brand login-brand" aria-label="Kept"><b className="brand-word">kept</b><span className="brand-dot" /></div>
      <div className="login-icon"><LockKeyhole size={28}/></div>
      <span className="login-kicker">AUTHENTICATED CONTROL PLANE</span>
      <h1>Operator clearance required.</h1>
      <p>Every approval is bound to an authenticated operator, an isolated recovery run, and the exact evidence version reviewed.</p>
      <form onSubmit={login}>
        <label>Operator ID<input name="actorId" defaultValue="operator_judge" pattern="operator_[a-z0-9_-]{2,32}" required autoComplete="username"/></label>
        <label>Access code<input name="accessCode" type="password" required autoComplete="current-password" placeholder={productionReady ? "Configured by deployment owner" : "Local code: kept-demo"}/></label>
        {error&&<p className="login-error">{error}</p>}
        <button disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>} {busy?"Opening isolated run":"Enter incident room"}</button>
      </form>
      <small>{productionReady?"Production operator secrets configured":"Development-only shared code active · production fails closed"}</small>
    </section>
  </main>;
}
