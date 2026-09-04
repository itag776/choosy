import { apiError, ok } from "@/lib/http";
import { merchantDashboard } from "@/lib/commerce-service";
import { DEMO_MERCHANT_OPERATOR } from "@/lib/commerce-data";
export const dynamic = "force-dynamic";
export async function GET() { try { return ok(await merchantDashboard(DEMO_MERCHANT_OPERATOR)); } catch (error) { return apiError(error); } }
