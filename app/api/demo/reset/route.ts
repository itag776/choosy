import { apiError, ok } from "@/lib/http";
import { resetDemo } from "@/lib/store";

export async function POST() {
  try {
    return ok(await resetDemo());
  } catch (error) {
    return apiError(error);
  }
}
