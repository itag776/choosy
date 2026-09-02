import { apiError, ok } from "@/lib/http";
import { getShoppingSession } from "@/lib/commerce-service";
import { requireShopperSession } from "@/lib/shopper-session";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: RouteContext<"/api/shopping/sessions/[sessionId]">) {
  try { const { sessionId } = await context.params; await requireShopperSession(sessionId); return ok(await getShoppingSession(sessionId)); }
  catch (error) { return apiError(error); }
}
