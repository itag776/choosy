import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase";
import type { BuyerRun } from "@/lib/types";

interface BuyerRepository { create(run: BuyerRun): Promise<BuyerRun>; get(id: string): Promise<BuyerRun>; save(run: BuyerRun): Promise<BuyerRun>; }
const root = path.join(tmpdir(), "choosy", "buyer-runs");
function assertId(id: string) { if (!/^buyer_[a-f0-9]{24}$/.test(id)) throw Object.assign(new Error("Buyer run not found."), { status: 404 }); }
function localPath(id: string) { assertId(id); return path.join(root, `${id}.json`); }
async function atomicWrite(file: string, value: unknown) { await mkdir(root, { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, file); }

class LocalBuyerRepository implements BuyerRepository {
  async create(run: BuyerRun) { await atomicWrite(localPath(run.id), run); return structuredClone(run); }
  async get(id: string) { try { return JSON.parse(await readFile(localPath(id), "utf8")) as BuyerRun; } catch { throw Object.assign(new Error("Buyer run not found."), { status: 404 }); } }
  async save(run: BuyerRun) { await atomicWrite(localPath(run.id), run); return structuredClone(run); }
}

class SupabaseBuyerRepository implements BuyerRepository {
  private client = getSupabaseAdmin();
  async create(run: BuyerRun) { const { error } = await this.client.from("commerce_buyer_runs").insert({ id: run.id, status: run.status, goal: run.goal, snapshot: run, session_id: run.sessionId }); if (error) throw new Error(`Buyer run create failed: ${error.message}`); return run; }
  async get(id: string) { assertId(id); const { data, error } = await this.client.from("commerce_buyer_runs").select("snapshot").eq("id", id).single(); if (error) throw Object.assign(new Error("Buyer run not found."), { status: 404 }); return data.snapshot as BuyerRun; }
  async save(run: BuyerRun) { const { error } = await this.client.from("commerce_buyer_runs").update({ status: run.status, snapshot: run, session_id: run.sessionId, updated_at: run.updatedAt }).eq("id", run.id); if (error) throw new Error(`Buyer run update failed: ${error.message}`); return run; }
}

let singleton: BuyerRepository | undefined;
export function getBuyerRepository(): BuyerRepository { const durable = hasSupabaseConfig() && (process.env.NODE_ENV === "production" || process.env.USE_SUPABASE_COMMERCE === "true"); return singleton ??= durable ? new SupabaseBuyerRepository() : new LocalBuyerRepository(); }
