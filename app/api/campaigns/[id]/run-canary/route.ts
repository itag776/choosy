import { apiError, ok } from "@/lib/http";
import { runCanary } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await runCanary(id));
  } catch (error) {
    return apiError(error);
  }
}
