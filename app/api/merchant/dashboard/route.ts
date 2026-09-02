import { apiError, ok } from "@/lib/http";
import { merchantDashboard } from "@/lib/commerce-service";
import { requireOperatorSession } from "@/lib/operator-session";
export const dynamic = "force-dynamic";
export async function GET() { try { return ok(await merchantDashboard(await requireOperatorSession())); } catch (error) { return apiError(error); } }
