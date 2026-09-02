import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { createMachineCheckout } from "@/lib/commerce-service";

const CartItemSchema = z.object({ productId: z.string().min(1), variantId: z.string().min(1), quantity: z.literal(1), unitPricePaise: z.number().int().positive(), kind: z.enum(["primary", "addon"]) });
const CartSchema = z.object({ id: z.string().min(1), items: z.array(CartItemSchema).min(1).max(3), totalPaise: z.number().int().positive(), digest: z.string().length(64), confirmedAt: z.string().datetime().optional() });
const QuoteSchema = z.object({ id: z.string().min(1), cart: CartSchema, catalogVersion: z.string().min(1), expiresAt: z.string().datetime(), digest: z.string().length(64) });
const Schema = z.object({ quote: QuoteSchema, acceptedQuoteDigest: z.string().length(64), confirmation: z.literal(true), idempotencyKey: z.string().min(8).max(120) });
function validApiKey(candidate: string | null): boolean { const expected = process.env.COMMERCE_AGENT_API_KEY ?? (process.env.NODE_ENV === "production" ? "" : "choosy-agent-demo"); if (!candidate || !expected) return false; const left = Buffer.from(candidate); const right = Buffer.from(expected); return left.length === right.length && timingSafeEqual(left, right); }
export async function POST(request: Request) {
  try { if (!validApiKey(request.headers.get("x-commerce-demo-key"))) return apiError(new Error("Agent commerce authentication is required."), 401); const input = Schema.parse(await request.json()); return ok(await createMachineCheckout(input.quote, input.acceptedQuoteDigest, input.idempotencyKey), 201); }
  catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Invalid checkout request."), 422); return apiError(error); }
}
