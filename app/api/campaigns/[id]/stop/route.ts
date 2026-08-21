import { apiError, ok } from "@/lib/http";
import { stopCampaign } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    return ok(await stopCampaign(id, body.reason));
  } catch (error) {
    return apiError(error);
  }
}
