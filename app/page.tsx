import IncidentRoom from "@/app/incident-room";
import OperatorLogin from "@/app/operator-login";
import { getRun } from "@/lib/run-service";
import { authIsConfigured } from "@/lib/operator-auth";
import { getOperatorSession } from "@/lib/operator-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const operator = await getOperatorSession();
  if (!operator) return <OperatorLogin productionReady={authIsConfigured()} />;
  const initialState = await getRun(operator.runId);
  return <IncidentRoom initialState={initialState} operator={operator} />;
}
