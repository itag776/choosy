import { apiError, ok } from "@/lib/http";
import { getRun } from "@/lib/run-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    return ok(await getRun(runId));
  } catch (error) {
    return apiError(error, 500);
  }
}

