import MerchantCockpit from "@/app/merchant/merchant-cockpit";
import OperatorLogin from "@/app/operator-login";
import { merchantDashboard } from "@/lib/commerce-service";
import { runGrowthBenchmark } from "@/lib/growth-benchmark";
import { authIsConfigured } from "@/lib/operator-auth";
import { getOperatorSession } from "@/lib/operator-session";

export const dynamic = "force-dynamic";
export default async function MerchantPage() { const operator = await getOperatorSession(); if (!operator) return <OperatorLogin productionReady={authIsConfigured()}/>; return <MerchantCockpit initialDashboard={await merchantDashboard(operator)} operator={operator} benchmark={runGrowthBenchmark()}/>; }
