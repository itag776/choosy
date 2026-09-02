"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, LoaderCircle, ShieldCheck } from "lucide-react";

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
    <div className="background-planes" aria-hidden="true"><i /><i /><i /></div>
    <section className="login-card">
      <div className="brand login-brand" aria-label="Kept"><b className="brand-word">kept</b><span className="brand-mark" /></div>
      <div className="login-icon"><LockKeyhole size={23}/></div>
      <span className="login-kicker">Revenue recovery, governed</span>
      <h1>Enter Kept.</h1>
      <p>Approvals stay bound to you, this recovery run, and the exact evidence you reviewed.</p>
      <form onSubmit={login}>
        <label>Operator ID<input name="actorId" defaultValue="operator_judge" pattern="operator_[a-z0-9_-]{2,32}" required autoComplete="username"/></label>
        <label>Access code<input name="accessCode" type="password" required autoComplete="current-password" placeholder={productionReady ? "Configured by deployment owner" : "Local code: kept-demo"}/></label>
        {error&&<p className="login-error">{error}</p>}
        <button disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>}<span>{busy?"Opening your run":"Continue"}</span><ArrowRight size={17}/></button>
      </form>
      <small>{productionReady?"Secure operator access is active":"Development access is active"}</small>
    </section>
  </main>;
}
