import { createHash, randomUUID } from "node:crypto";
import type { CommerceAuditEvent, ShoppingSessionSnapshot } from "@/lib/types";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function createCommerceAuditEvent(
  session: Pick<ShoppingSessionSnapshot, "audit" | "version">,
  input: Omit<CommerceAuditEvent, "id" | "schemaVersion" | "sessionVersion" | "sequence" | "createdAt" | "previousHash" | "hash">,
  now = new Date(),
): CommerceAuditEvent {
  const unsigned = { ...input, id: randomUUID(), schemaVersion: 1 as const, sessionVersion: session.version, sequence: (session.audit.at(-1)?.sequence ?? 0) + 1, previousHash: session.audit.at(-1)?.hash ?? "GENESIS", createdAt: now.toISOString() };
  return { ...unsigned, hash: createHash("sha256").update(stableJson(unsigned)).digest("hex") };
}

export function verifyCommerceAuditChain(events: CommerceAuditEvent[]): boolean {
  return events.every((event, index) => {
    const { hash, ...unsigned } = event;
    const previousHash = index === 0 ? "GENESIS" : events[index - 1]!.hash;
    return event.sequence === index + 1 && event.previousHash === previousHash && createHash("sha256").update(stableJson(unsigned)).digest("hex") === hash;
  });
}
