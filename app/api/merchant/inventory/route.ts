import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { markSelectedItemUnavailable, restoreDemoInventory } from "@/lib/commerce-service";
import { requireOperatorSession } from "@/lib/operator-session";
const Schema = z.object({ sessionId: z.string().regex(/^shop_[a-f0-9]{24}$/), action: z.enum(["mark_selected_unavailable","restore_demo_inventory"]) });
export async function POST(request: Request) { try { const input = Schema.parse(await request.json()); const operator = await requireOperatorSession(); return ok(input.action === "restore_demo_inventory" ? await restoreDemoInventory(input.sessionId, operator) : await markSelectedItemUnavailable(input.sessionId, operator)); } catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Invalid inventory demo action."), 422); return apiError(error); } }
