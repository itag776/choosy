import { timingSafeEqual } from "node:crypto";

export function commerceAgentApiKey(): string {
  return process.env.COMMERCE_AGENT_API_KEY ?? (process.env.NODE_ENV === "production" ? "" : "choosy-agent-demo");
}

export function validCommerceApiKey(candidate: string | null): boolean {
  const expected = commerceAgentApiKey();
  if (!candidate || !expected) return false;
  const left = Buffer.from(candidate); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
