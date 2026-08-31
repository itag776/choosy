import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { executeRunCommand } from "@/lib/run-service";
import { requireOperatorSession } from "@/lib/operator-session";

const CommandSchema = z.object({
  command: z.enum([
    "reset_replay", "inject_incident", "investigate", "approve_canary", "reject_canary",
    "run_canary", "evaluate_promotion", "approve_promotion", "stop", "escalate",
    "create_test_link", "sync_test_link", "replay_demo_webhook",
  ]),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(120),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const operator = await requireOperatorSession(runId);
    const command = CommandSchema.parse(await request.json());
    return ok(await executeRunCommand(runId, command, operator));
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new Error(`Invalid command: ${error.issues[0]?.message ?? "schema mismatch"}`), 422);
    return apiError(error);
  }
}
