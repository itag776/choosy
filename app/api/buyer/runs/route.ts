import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { createBuyerRun } from "@/lib/buyer-service";

const Schema = z.object({ goal: z.string().trim().min(10).max(500) });
export async function POST(request: Request) { try { const { goal } = Schema.parse(await request.json()); return ok(await createBuyerRun(goal, new URL(request.url).origin), 201); } catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Describe a purchase goal in 10–500 characters."), 422); return apiError(error); } }
