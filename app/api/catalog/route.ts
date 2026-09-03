import { ok, apiError } from "@/lib/http";
import { catalogSnapshot } from "@/lib/commerce-service";
import { CATALOG_MARKET, CATALOG_PRICE_AS_OF, CATALOG_PRICE_NOTICE, CATALOG_VERSION } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const params = new URL(request.url).searchParams; const category = params.get("category"); const kind = params.get("kind"); const catalog = await catalogSnapshot(); return ok({ catalogMode: "curated_real_products", version: CATALOG_VERSION, market: CATALOG_MARKET, priceAsOf: CATALOG_PRICE_AS_OF, priceNotice: CATALOG_PRICE_NOTICE, catalog: catalog.filter((item) => (!category || item.category === category) && (!kind || item.kind === kind)) }); }
  catch (error) { return apiError(error); }
}
