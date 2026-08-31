import { cookies } from "next/headers";
import { ok } from "@/lib/http";
import { OPERATOR_COOKIE } from "@/lib/operator-auth";

export async function POST() {
  (await cookies()).delete(OPERATOR_COOKIE);
  return ok({ authenticated: false });
}
