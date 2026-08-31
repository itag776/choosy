import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OperatorIdentity } from "@/lib/types";

export const OPERATOR_COOKIE = "recoveros_operator";
const SESSION_SECONDS = 60 * 60 * 8;

interface OperatorSession extends OperatorIdentity {
  issuedAt: number;
  expiresAt: number;
}

export function authIsConfigured(): boolean {
  return Boolean(process.env.RECOVEROS_OPERATOR_ACCESS_CODE && process.env.RECOVEROS_OPERATOR_ACCESS_CODE.length >= 12 && process.env.RECOVEROS_SESSION_SECRET && process.env.RECOVEROS_SESSION_SECRET.length >= 32);
}

function accessCode(): string | null {
  if (process.env.RECOVEROS_OPERATOR_ACCESS_CODE) return process.env.RECOVEROS_OPERATOR_ACCESS_CODE.length >= 12 ? process.env.RECOVEROS_OPERATOR_ACCESS_CODE : null;
  return process.env.NODE_ENV === "production" ? null : "recoveros-demo";
}

function sessionSecret(): string | null {
  if (process.env.RECOVEROS_SESSION_SECRET) return process.env.RECOVEROS_SESSION_SECRET.length >= 32 ? process.env.RECOVEROS_SESSION_SECRET : null;
  return process.env.NODE_ENV === "production" ? null : "recoveros-local-development-session-secret-v1";
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function verifyAccessCode(candidate: string): boolean {
  const expected = accessCode();
  return Boolean(expected && safeEqual(candidate, expected));
}

export function createOperatorToken(actorId: string, now = Date.now()): { token: string; session: OperatorSession } {
  const secret = sessionSecret();
  if (!secret) throw new Error("Operator authentication is not configured.");
  const suffix = randomBytes(12).toString("hex");
  const session: OperatorSession = {
    actorId,
    role: "operator",
    runId: `run_${suffix}`,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { token: `${encoded}.${sign(encoded, secret)}`, session };
}

export function verifyOperatorToken(token: string | undefined, now = Date.now()): OperatorSession | null {
  const secret = sessionSecret();
  if (!token || !secret) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OperatorSession;
    if (parsed.role !== "operator" || !/^operator_[a-z0-9_-]{2,32}$/.test(parsed.actorId) || !/^run_[a-f0-9]{24}$/.test(parsed.runId)) return null;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const operatorCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
  priority: "high" as const,
};
