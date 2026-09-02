import { apiError, ok } from "@/lib/http";
import { catalogSnapshot } from "@/lib/commerce-service";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: RouteContext<"/api/catalog/[sku]">) {
  try { const { sku } = await context.params; const product = (await catalogSnapshot()).find((item) => item.sku.toLowerCase() === sku.toLowerCase()); if (!product) return apiError(new Error("Catalog product not found."), 404); return ok({ demoData: true, product }); }
  catch (error) { return apiError(error); }
}
