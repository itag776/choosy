import { ok } from "@/lib/http";
import { getDashboard } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(getDashboard());
}
