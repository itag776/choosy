import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { executeShoppingCommand } from "@/lib/commerce-service";
import { requireShopperSession } from "@/lib/shopper-session";

const Schema = z.object({ command: z.enum(["select_product", "set_addons", "confirm_cart", "create_checkout", "retry_payment", "reset_session", "revise_preference"]), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(8).max(120), payload: z.record(z.string(), z.unknown()).optional() });
export async function POST(request: Request, context: RouteContext<"/api/shopping/sessions/[sessionId]/commands">) {
  try { const { sessionId } = await context.params; await requireShopperSession(sessionId); return ok(await executeShoppingCommand(sessionId, Schema.parse(await request.json()))); }
  catch (error) { if (error instanceof z.ZodError) return apiError(new Error(`Invalid command: ${error.issues[0]?.message ?? "schema mismatch"}`), 422); return apiError(error); }
}
