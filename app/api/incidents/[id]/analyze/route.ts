import { apiError, ok } from "@/lib/http";
import { analyzeIncident } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await analyzeIncident(id));
  } catch (error) {
    return apiError(error);
  }
}
