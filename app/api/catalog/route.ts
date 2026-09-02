import { ok, apiError } from "@/lib/http";
import { catalogSnapshot } from "@/lib/commerce-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const params = new URL(request.url).searchParams; const category = params.get("category"); const kind = params.get("kind"); const catalog = await catalogSnapshot(); return ok({ demoData: true, catalog: catalog.filter((item) => (!category || item.category === category) && (!kind || item.kind === kind)) }); }
  catch (error) { return apiError(error); }
}
