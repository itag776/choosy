import IncidentRoom from "@/app/incident-room";
import { DEFAULT_RUN_ID } from "@/lib/demo-data";
import { getRun } from "@/lib/run-service";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialState = await getRun(DEFAULT_RUN_ID);
  return <IncidentRoom initialState={initialState} />;
}
