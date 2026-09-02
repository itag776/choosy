import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { sendShoppingMessage } from "@/lib/commerce-service";
import { requireShopperSession } from "@/lib/shopper-session";

const Schema = z.object({ text: z.string().trim().min(1).max(800), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().min(8).max(120), answerKey: z.string().max(60).optional(), answerValue: z.string().max(120).optional() });
export async function POST(request: Request, context: RouteContext<"/api/shopping/sessions/[sessionId]/messages">) {
  try { const { sessionId } = await context.params; await requireShopperSession(sessionId); return ok(await sendShoppingMessage(sessionId, Schema.parse(await request.json()))); }
  catch (error) { if (error instanceof z.ZodError) return apiError(new Error(`Invalid message: ${error.issues[0]?.message ?? "schema mismatch"}`), 422); return apiError(error); }
}
