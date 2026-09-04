import { apiError, ok } from "@/lib/http";
import { reconcileShoppingPayment } from "@/lib/commerce-service";
import { requireShopperSession } from "@/lib/shopper-session";

export async function POST(_request: Request, context: RouteContext<"/api/shopping/sessions/[sessionId]/payment-status">) {
  try {
    const { sessionId } = await context.params;
    await requireShopperSession(sessionId);
    return ok(await reconcileShoppingPayment(sessionId));
  } catch (error) {
    return apiError(error);
  }
}
