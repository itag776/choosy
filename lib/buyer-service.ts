import { randomUUID } from "node:crypto";
import { approveExternalPurchase, planExternalPurchase, readExternalOrder } from "@/lib/buyer-agent";
import { commerceAgentApiKey } from "@/lib/commerce-auth";
import { getBuyerRepository } from "@/lib/buyer-repository";
import type { BuyerRun, BuyerTraceEvent } from "@/lib/types";

function trace(tool: BuyerTraceEvent["tool"], summary: string, status: BuyerTraceEvent["status"]): BuyerTraceEvent { return { id: randomUUID(), tool, summary, status, createdAt: new Date().toISOString() }; }
function sanitized(run: BuyerRun): BuyerRun { return structuredClone(run); }
const approvalLocks = new Map<string, Promise<BuyerRun>>();

export async function createBuyerRun(goal: string, baseUrl: string): Promise<BuyerRun> {
  const now = new Date().toISOString(); const repository = getBuyerRepository();
  const run: BuyerRun = { id: `buyer_${randomUUID().replaceAll("-", "").slice(0, 24)}`, goal, status: "planning", proposal: null, quote: null, trace: [], sessionId: null, checkout: null, createdAt: now, updatedAt: now };
  await repository.create(run);
  try { const planned = await planExternalPurchase(goal, baseUrl); run.proposal = planned.proposal; run.quote = planned.quote; run.trace = planned.trace; run.status = "awaiting_approval"; }
  catch (error) { run.status = "failed"; run.failureReason = error instanceof Error ? error.message : "The buyer could not prepare a safe proposal."; }
  run.updatedAt = new Date().toISOString(); await repository.save(run); return sanitized(run);
}

export async function getBuyerRun(id: string, baseUrl: string): Promise<BuyerRun> {
  const repository = getBuyerRepository(); const run = await repository.get(id);
  if (run.sessionId && (run.status === "checkout_ready" || run.status === "approved")) {
    try {
      const receipt = await readExternalOrder(baseUrl, run.sessionId, commerceAgentApiKey());
      const summary = `Read webhook-backed order state: ${receipt.status}.`;
      const lastOrderRead = [...run.trace].reverse().find((event) => event.tool === "read_order");
      const becamePaid = receipt.status === "paid";
      if (lastOrderRead?.summary !== summary || becamePaid) run.trace.push(trace("read_order", summary, "completed"));
      if (receipt.status === "paid") {
        run.status = "paid";
        if (run.checkout) run.checkout.status = "paid";
      }
      if (lastOrderRead?.summary !== summary || becamePaid) {
        run.updatedAt = new Date().toISOString();
        await repository.save(run);
      }
    }
    catch { /* A transient status read must not change payment state. */ }
  }
  return sanitized(run);
}

async function approveBuyerRunUnlocked(id: string, acceptedQuoteDigest: string, confirmation: true, baseUrl: string): Promise<BuyerRun> {
  const repository = getBuyerRepository(); const run = await repository.get(id);
  if (run.status === "checkout_ready" || run.status === "paid") return sanitized(run);
  if (run.status !== "awaiting_approval" && run.status !== "approved") throw Object.assign(new Error("This buyer run is not awaiting approval."), { status: 409 });
  if (!confirmation || !run.quote || acceptedQuoteDigest !== run.quote.digest) throw Object.assign(new Error("Approval does not match the displayed quote digest."), { status: 422 });
  const key = commerceAgentApiKey(); if (!key) throw Object.assign(new Error("The server-side commerce agent key is not configured."), { status: 503 });
  run.status = "approved"; run.updatedAt = new Date().toISOString(); await repository.save(run);
  try {
    const result = await approveExternalPurchase(baseUrl, run.quote, acceptedQuoteDigest, `buyer:${run.id}:checkout`, run.id, key);
    run.sessionId = result.sessionId; run.checkout = result.checkout; run.status = result.checkout.status === "paid" ? "paid" : result.checkout.shortUrl ? "checkout_ready" : "failed";
    if (run.status === "failed") run.failureReason = result.checkout.failureReason ?? "Razorpay did not return a checkout URL.";
    run.trace.push(trace("create_checkout", run.status === "failed" ? "No Razorpay checkout was created." : "Created one idempotent Razorpay Test Mode checkout after exact approval.", run.status === "failed" ? "failed" : "completed"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Checkout creation failed.";
    const blockedSessionId = typeof error === "object" && error && "sessionId" in error ? String(error.sessionId) : null;
    if (blockedSessionId && /^shop_[a-f0-9]{24}$/.test(blockedSessionId)) run.sessionId = blockedSessionId;
    run.failureReason = reason; run.status = /stock|price|unavailable|no longer matches/i.test(reason) ? "blocked" : "failed"; run.trace.push(trace("create_checkout", `No Razorpay action created: ${reason}`, run.status === "blocked" ? "blocked" : "failed"));
  }
  run.updatedAt = new Date().toISOString(); await repository.save(run); return sanitized(run);
}

export function approveBuyerRun(id: string, acceptedQuoteDigest: string, confirmation: true, baseUrl: string): Promise<BuyerRun> {
  const active = approvalLocks.get(id);
  if (active) return active;
  const operation = approveBuyerRunUnlocked(id, acceptedQuoteDigest, confirmation, baseUrl).finally(() => {
    if (approvalLocks.get(id) === operation) approvalLocks.delete(id);
  });
  approvalLocks.set(id, operation);
  return operation;
}
