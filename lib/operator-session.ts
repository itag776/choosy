import "server-only";
import { cookies } from "next/headers";
import { OPERATOR_COOKIE, verifyOperatorToken } from "@/lib/operator-auth";
import type { OperatorIdentity } from "@/lib/types";

export async function getOperatorSession(): Promise<OperatorIdentity | null> {
  return verifyOperatorToken((await cookies()).get(OPERATOR_COOKIE)?.value);
}

export async function requireOperatorSession(runId?: string): Promise<OperatorIdentity> {
  const session = await getOperatorSession();
  if (!session) throw Object.assign(new Error("Operator authentication is required."), { status: 401 });
  if (runId && session.runId !== runId) throw Object.assign(new Error("This recovery run belongs to another operator session."), { status: 403 });
  return session;
}
