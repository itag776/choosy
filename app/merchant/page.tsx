import MerchantCockpit from "@/app/merchant/merchant-cockpit";
import { merchantDashboard } from "@/lib/commerce-service";
import { DEMO_MERCHANT_OPERATOR } from "@/lib/commerce-data";
import { runGrowthBenchmark } from "@/lib/growth-benchmark";

export const dynamic = "force-dynamic";
export default async function MerchantPage() {
  return <MerchantCockpit initialDashboard={await merchantDashboard(DEMO_MERCHANT_OPERATOR)} benchmark={runGrowthBenchmark()}/>;
}
