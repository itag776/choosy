import { createHmac, timingSafeEqual } from "node:crypto";
import { DEFAULT_MERCHANT_ID } from "@/lib/commerce-data";
import type { OperatorIdentity } from "@/lib/types";

export const OPERATOR_COOKIE = "choosy_operator";
const SESSION_SECONDS = 60 * 60 * 8;
const MIN_ACCESS_CODE_LENGTH = 5;

interface OperatorSession extends OperatorIdentity {
  issuedAt: number;
  expiresAt: number;
}

export function authIsConfigured(): boolean {
  const code = process.env.CHOOSY_OPERATOR_ACCESS_CODE;
  const secret = process.env.CHOOSY_SESSION_SECRET;
  return Boolean(code && code.length >= MIN_ACCESS_CODE_LENGTH && secret && secret.length >= 32);
}

function accessCode(): string | null {
  const configured = process.env.CHOOSY_OPERATOR_ACCESS_CODE;
  if (configured) return configured.length >= MIN_ACCESS_CODE_LENGTH ? configured : null;
  return process.env.NODE_ENV === "production" ? null : "admin";
}

export function choosySessionSecret(): string | null {
  const configured = process.env.CHOOSY_SESSION_SECRET;
  if (configured) return configured.length >= 32 ? configured : null;
  return process.env.NODE_ENV === "production" ? null : "choosy-local-development-session-secret-v1";
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
  const secret = choosySessionSecret();
  if (!secret) throw new Error("Operator authentication is not configured.");
  const session: OperatorSession = {
    actorId,
    role: "operator",
    merchantId: DEFAULT_MERCHANT_ID,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS * 1_000,
  };
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { token: `${encoded}.${sign(encoded, secret)}`, session };
}

export function verifyOperatorToken(token: string | undefined, now = Date.now()): OperatorSession | null {
  const secret = choosySessionSecret();
  if (!token || !secret) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OperatorSession;
    if (parsed.role !== "operator" || !/^operator_[a-z0-9_-]{2,32}$/.test(parsed.actorId) || parsed.merchantId !== DEFAULT_MERCHANT_ID) return null;
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
