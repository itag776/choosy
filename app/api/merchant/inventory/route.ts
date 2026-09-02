import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { markSelectedItemUnavailable } from "@/lib/commerce-service";
import { requireOperatorSession } from "@/lib/operator-session";
const Schema = z.object({ sessionId: z.string().regex(/^shop_[a-f0-9]{24}$/), action: z.literal("mark_selected_unavailable") });
export async function POST(request: Request) { try { const input = Schema.parse(await request.json()); return ok(await markSelectedItemUnavailable(input.sessionId, await requireOperatorSession())); } catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Invalid inventory demo action."), 422); return apiError(error); } }
