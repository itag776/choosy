import { apiError, ok } from "@/lib/http";
import { getBuyerRun } from "@/lib/buyer-service";
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) { try { const { runId } = await context.params; return ok(await getBuyerRun(runId, new URL(request.url).origin)); } catch (error) { return apiError(error); } }
