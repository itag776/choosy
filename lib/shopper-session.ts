import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { choosySessionSecret } from "@/lib/operator-auth";

export const SHOPPER_COOKIE = "choosy_shopper";
const SESSION_SECONDS = 60 * 60 * 24;

interface ShopperSession { sessionId: string; issuedAt: number; expiresAt: number; }

function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function sign(value: string, secret: string): string { return createHmac("sha256", secret).update(value).digest("base64url"); }

export function createShopperToken(sessionId: string, now = Date.now()): string {
  const secret = choosySessionSecret();
  if (!secret) throw new Error("Shopper sessions are not configured.");
  const payload: ShopperSession = { sessionId, issuedAt: now, expiresAt: now + SESSION_SECONDS * 1_000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyShopperToken(token: string | undefined, now = Date.now()): ShopperSession | null {
  const secret = choosySessionSecret();
  if (!secret || !token) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, secret))) return null;
  try { const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ShopperSession; if (!/^shop_[a-f0-9]{24}$/.test(session.sessionId) || session.expiresAt <= now) return null; return session; } catch { return null; }
}

export async function getShopperSessionId(): Promise<string | null> { return verifyShopperToken((await cookies()).get(SHOPPER_COOKIE)?.value)?.sessionId ?? null; }
export async function requireShopperSession(sessionId: string): Promise<void> { const owned = await getShopperSessionId(); if (!owned) throw Object.assign(new Error("Shopping session authentication is required."), { status: 401 }); if (owned !== sessionId) throw Object.assign(new Error("This shopping session belongs to another visitor."), { status: 403 }); }
export const shopperCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS, priority: "high" as const };
