import { createClient } from "@supabase/supabase-js";
import type { DashboardState } from "@/lib/types";

export async function persistSnapshot(state: DashboardState): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.from("recoveros_snapshots").upsert({
    id: "demo",
    state,
    updated_at: new Date().toISOString(),
  });

  if (error) console.warn("RecoverOS snapshot persistence failed", error.message);
}
