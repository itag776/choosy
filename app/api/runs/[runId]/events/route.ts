import { apiError, ok } from "@/lib/http";
import { getRunEvents } from "@/lib/run-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
    return ok(await getRunEvents(runId, Number.isFinite(after) ? after : 0));
  } catch (error) {
    return apiError(error, 500);
  }
}

