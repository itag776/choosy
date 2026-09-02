import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function apiError(error: unknown, fallbackStatus = 400): NextResponse {
  const message = error instanceof Error ? error.message : "Unexpected Choosy error.";
  const declared = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : undefined;
  const status = declared && Number.isInteger(declared) ? declared : message.includes("not found") ? 404 : fallbackStatus;
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
