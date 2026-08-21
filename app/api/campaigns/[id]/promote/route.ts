import { apiError, ok } from "@/lib/http";
import { promoteCampaign } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await promoteCampaign(id));
  } catch (error) {
    return apiError(error);
  }
}
