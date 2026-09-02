import { cookies } from "next/headers";
import { apiError, ok } from "@/lib/http";
import { startShoppingSession } from "@/lib/commerce-service";
import { createShopperToken, SHOPPER_COOKIE, shopperCookieOptions } from "@/lib/shopper-session";

export async function POST() {
  try { const session = await startShoppingSession(); (await cookies()).set(SHOPPER_COOKIE, createShopperToken(session.id), shopperCookieOptions); return ok(session, 201); }
  catch (error) { return apiError(error); }
}
