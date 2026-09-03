import { apiError, ok } from "@/lib/http";
import { validCommerceApiKey } from "@/lib/commerce-auth";
import { machineOrderReceipt } from "@/lib/commerce-service";

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    if (!validCommerceApiKey(request.headers.get("x-commerce-demo-key"))) return apiError(new Error("Agent commerce authentication is required."), 401);
    const { sessionId } = await context.params;
    if (!/^shop_[a-f0-9]{24}$/.test(sessionId)) return apiError(new Error("Invalid order receipt ID."), 422);
    return ok(await machineOrderReceipt(sessionId));
  } catch (error) { return apiError(error); }
}
