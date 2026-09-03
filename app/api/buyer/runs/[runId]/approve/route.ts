import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { approveBuyerRun } from "@/lib/buyer-service";
const Schema = z.object({ confirmation: z.literal(true), acceptedQuoteDigest: z.string().length(64) });
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) { try { const { runId } = await context.params; const input = Schema.parse(await request.json()); return ok(await approveBuyerRun(runId, input.acceptedQuoteDigest, input.confirmation, new URL(request.url).origin)); } catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Exact quote approval is required."), 422); return apiError(error); } }
