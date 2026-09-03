import AgentBuyer from "@/app/agent-buyer/agent-buyer";

export default async function AgentBuyerPage({ searchParams }: { searchParams: Promise<{ run?: string | string[]; payment_return?: string | string[] }> }) {
  const params = await searchParams;
  const run = typeof params.run === "string" && /^buyer_[a-f0-9]{24}$/.test(params.run) ? params.run : undefined;
  return <AgentBuyer initialRunId={run} returnedFromPayment={params.payment_return === "1"}/>;
}
