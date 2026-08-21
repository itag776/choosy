import { apiError, ok } from "@/lib/http";
import { createCampaignTestLink } from "@/lib/store";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return ok(await createCampaignTestLink(id));
  } catch (error) {
    return apiError(error, 502);
  }
}
