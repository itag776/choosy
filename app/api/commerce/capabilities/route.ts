import { ok } from "@/lib/http";
import { commerceCapabilities } from "@/lib/commerce-service";
export function GET() { return ok(commerceCapabilities()); }
