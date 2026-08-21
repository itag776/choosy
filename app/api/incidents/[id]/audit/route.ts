import { apiError, ok } from "@/lib/http";
import { getDashboard } from "@/lib/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const state = getDashboard();
    if (!state.incident || state.incident.id !== id) throw new Error("Incident not found.");
    return ok({ incidentId: id, events: state.audit });
  } catch (error) {
    return apiError(error);
  }
}
