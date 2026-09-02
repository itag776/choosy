import { z } from "zod";
import { apiError, ok } from "@/lib/http";
import { createMachineQuote } from "@/lib/commerce-service";

const Schema = z.object({ items: z.array(z.object({ productId: z.string().min(1), variantId: z.string().min(1) })).min(1).max(3) });
export async function POST(request: Request) { try { return ok(await createMachineQuote(Schema.parse(await request.json()).items), 201); } catch (error) { if (error instanceof z.ZodError) return apiError(new Error("Invalid quote request."), 422); return apiError(error); } }
