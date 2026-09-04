"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Code2, Globe, KeyRound, LoaderCircle, Lock, Server, ShieldCheck, Zap } from "lucide-react";

interface Endpoint { method: string; path: string }
interface Capabilities {
  name: string;
  version: string;
  mode: string;
  currency: string;
  categories: string[];
  catalogVersion: string;
  catalog: {
    mode: string;
    market: string;
    priceAsOf: string;
    priceNotice: string;
    externalRetailApi: boolean;
    runtimeCatalogCost: string;
  };
  quoteTtlSeconds: number;
  constraints: {
    objective: string;
    shopperFitItemBasketValue: boolean;
    promotionInfluenceThreshold: number;
    maximumAddons: number;
    requiresExplicitConfirmation: boolean;
    exactBudgetBoundary: boolean;
    revalidatesPriceAndStock: boolean;
    personalInformationInChat: boolean;
  };
  authentication: Record<string, string>;
  confirmation: { field: string; requiredValue: boolean; binds: string };
  endpoints: Record<string, Endpoint>;
}

function MethodBadge({ method }: { method: string }) {
  const color = method === "GET" ? "#65a96f" : method === "POST" ? "#2f6ea8" : "#a8842f";
  return <span className="api-method" style={{ background: `${color}18`, color, borderColor: `${color}40` }}>{method}</span>;
}

export default function AgentApiPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedJson, setExpandedJson] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/commerce/capabilities")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to fetch capabilities");
        const data = await response.json() as Capabilities;
        if (!cancelled) setCaps(data);
      })
      .catch(() => { if (!cancelled) setError("Could not load the agent commerce capabilities."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="api-shell">
      <header className="shop-header">
        <Link className="wordmark" href="/">choosy</Link>
        <nav>
          <Link href="/"><ArrowLeft size={14}/>Shop</Link>
          <Link href="/agent-buyer">Let AI do the work</Link>
          <Link href="/evidence">How we test</Link>
          <Link className="merchant-link" href="/merchant"><Lock size={14}/> Merchant dashboard</Link>
        </nav>
      </header>

      <section className="api-hero">
        <p className="eyebrow"><Code2 size={14}/> For developers</p>
        <h1>Build with<br/><em>Choosy.</em></h1>
        <p>
          Use these endpoints to read the catalog, prepare a quote, request approval,
          and create a checkout. Payment always requires explicit approval.
        </p>
      </section>

      {!caps && !error && (
        <div className="api-loading">
          <LoaderCircle className="spin" size={24}/>
          <span>Fetching capabilities…</span>
        </div>
      )}

      {error && <p className="api-error">{error}</p>}

      {caps && (
        <section className="api-content">
          {/* Overview cards */}
          <div className="api-overview">
            <article className="api-card overview-card">
              <div className="api-card-icon"><Server size={18}/></div>
              <span className="api-card-label">Service</span>
              <strong>{caps.name}</strong>
              <small>v{caps.version}</small>
            </article>
            <article className="api-card overview-card">
              <div className="api-card-icon"><Zap size={18}/></div>
              <span className="api-card-label">Mode</span>
              <strong>{caps.mode.replace(/_/g, " ")}</strong>
              <small>{caps.currency}</small>
            </article>
            <article className="api-card overview-card">
              <div className="api-card-icon"><Globe size={18}/></div>
              <span className="api-card-label">Catalog</span>
              <strong>{caps.categories.length} categories</strong>
              <small>{caps.catalog.runtimeCatalogCost} · no retail API key</small>
            </article>
            <article className="api-card overview-card">
              <div className="api-card-icon"><ShieldCheck size={18}/></div>
              <span className="api-card-label">Quote TTL</span>
              <strong>{caps.quoteTtlSeconds}s</strong>
              <small>Revalidation enforced</small>
            </article>
          </div>

          <div className="catalog-truth" role="note">
            <ShieldCheck size={15}/>
            <span>
              Curated real-product snapshot for {caps.catalog.market}; frozen Test Mode prices dated {caps.catalog.priceAsOf} and simulated stock. No paid or trial retail API is used.
            </span>
          </div>

          {/* Endpoints */}
          <div className="api-section">
            <div className="api-section-header">
              <h2>Endpoints</h2>
              <p>Follow this request flow: catalog → quote → approval → checkout → order status.</p>
            </div>
            <div className="endpoint-grid">
              {Object.entries(caps.endpoints).map(([name, ep]) => (
                <article className="api-card endpoint-card" key={name}>
                  <header>
                    <MethodBadge method={ep.method}/>
                    <span className="endpoint-name">{name}</span>
                  </header>
                  <code>{ep.path}</code>
                  <div className="endpoint-auth">
                    <KeyRound size={12}/>
                    <span>{caps.authentication[name] === "public" ? "Public — no key required" : `Header: ${caps.authentication[name]}`}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          {/* Constraints */}
          <div className="api-section">
            <div className="api-section-header">
              <h2>Safety constraints</h2>
              <p>Rules the server enforces on every request.</p>
            </div>
            <div className="constraint-grid">
              {[
                { label: "Objective", value: caps.constraints.objective?.replace(/_/g, " ") ?? "—", icon: <Zap size={14}/> },
                { label: "Explicit confirmation", value: caps.constraints.requiresExplicitConfirmation ? "Required" : "Not required", icon: <ShieldCheck size={14}/> },
                { label: "Exact budget boundary", value: caps.constraints.exactBudgetBoundary ? "Enforced" : "Not enforced", icon: <Check size={14}/> },
                { label: "Revalidates price & stock", value: caps.constraints.revalidatesPriceAndStock ? "Yes — before checkout" : "No", icon: <Check size={14}/> },
                { label: "Personal info in chat", value: caps.constraints.personalInformationInChat ? "Allowed" : "Blocked", icon: <Lock size={14}/> },
                { label: "Shopper-fit item basket", value: caps.constraints.shopperFitItemBasketValue ? "Enabled" : "Disabled", icon: <Check size={14}/> },
                { label: "Promotion influence threshold", value: `${(caps.constraints.promotionInfluenceThreshold * 100).toFixed(0)}%`, icon: <Zap size={14}/> },
                { label: "Max add-ons", value: String(caps.constraints.maximumAddons), icon: <Server size={14}/> },
              ].map((c) => (
                <div className="constraint-row" key={c.label}>
                  <span className="constraint-icon">{c.icon}</span>
                  <span className="constraint-label">{c.label}</span>
                  <span className="constraint-value">{c.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Confirmation gate */}
          <div className="api-section">
            <div className="api-section-header">
              <h2>Approval requirement</h2>
              <p>A checkout cannot be created until the user approves the exact quote.</p>
            </div>
            <article className="api-card confirmation-card">
              <div className="confirmation-grid">
                <div>
                  <span className="api-card-label">Field</span>
                  <code>{caps.confirmation.field}</code>
                </div>
                <div>
                  <span className="api-card-label">Required value</span>
                  <code>{String(caps.confirmation.requiredValue)}</code>
                </div>
                <div>
                  <span className="api-card-label">Binds to</span>
                  <code>{caps.confirmation.binds}</code>
                </div>
              </div>
              <p className="confirmation-note">
                <ShieldCheck size={14}/>
                Send back the exact quote fingerprint. A mismatch rejects the checkout request.
              </p>
            </article>
          </div>

          {/* Raw JSON toggle */}
          <div className="api-section">
            <div className="api-section-header">
              <h2>Raw contract</h2>
              <button className="raw-toggle" onClick={() => setExpandedJson(!expandedJson)}>
                {expandedJson ? "Hide" : "Show"} JSON <ArrowRight size={12} style={{ transform: expandedJson ? "rotate(90deg)" : "none", transition: "transform .2s" }}/>
              </button>
            </div>
            {expandedJson && (
              <pre className="json-block"><code>{JSON.stringify(caps, null, 2)}</code></pre>
            )}
          </div>
        </section>
      )}

      <footer className="api-footer">
        <span>Choosy developer API · {caps?.version ?? "loading"}</span>
        <Link href="/agent-buyer">Let AI do the work <ArrowRight size={13}/></Link>
      </footer>
    </main>
  );
}
