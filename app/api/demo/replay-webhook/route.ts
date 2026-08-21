import { randomUUID } from "node:crypto";
import { apiError, ok } from "@/lib/http";
import { demoWebhookPayload, getDashboard, processWebhookEvent } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { eventId?: string };
    const eventId = body.eventId || `evt_demo_${randomUUID()}`;
    const result = processWebhookEvent(eventId, demoWebhookPayload());
    return ok({ eventId, result, state: getDashboard() });
  } catch (error) {
    return apiError(error);
  }
}
