import { apiError, ok } from "@/lib/http";
import { approveCampaign } from "@/lib/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({ approve: true }))) as { approve?: boolean };
    return ok(await approveCampaign(id, body.approve !== false));
  } catch (error) {
    return apiError(error);
  }
}
