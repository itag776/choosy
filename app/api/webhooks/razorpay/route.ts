import { apiError, ok } from "@/lib/http";
import { processRazorpayWebhook } from "@/lib/run-service";
import { verifyRazorpaySignature } from "@/lib/webhook";

export async function POST(request: Request) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return apiError(new Error("Razorpay webhook secret is not configured."), 503);
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    if (!verifyRazorpaySignature(rawBody, signature, secret)) return apiError(new Error("Invalid Razorpay webhook signature."), 401);
    const eventId = request.headers.get("x-razorpay-event-id");
    if (!eventId) return apiError(new Error("Missing x-razorpay-event-id header."), 400);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const eventType = String(payload.event ?? "unknown");
    const result = await processRazorpayWebhook({ eventId, eventType, rawBody, payload });
    return ok({ accepted: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
