import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(error: unknown, fallbackStatus = 400): NextResponse {
  const message = error instanceof Error ? error.message : "Unexpected RecoverOS error.";
  const status = message.includes("not found") ? 404 : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
}
