import { cookies } from "next/headers";
import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { createOperatorToken, OPERATOR_COOKIE, operatorCookieOptions, verifyAccessCode } from "@/lib/operator-auth";

const LoginSchema = z.object({
  actorId: z.string().regex(/^operator_[a-z0-9_-]{2,32}$/),
  accessCode: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const input = LoginSchema.parse(await request.json());
    if (!verifyAccessCode(input.accessCode)) return apiError(Object.assign(new Error("Invalid operator credentials."), { status: 401 }));
    const { token, session } = createOperatorToken(input.actorId);
    (await cookies()).set(OPERATOR_COOKIE, token, operatorCookieOptions);
    return ok({ authenticated: true, actorId: session.actorId, runId: session.runId });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError(new Error("Use an operator ID such as operator_judge and a valid access code."), 422);
    return apiError(error);
  }
}
