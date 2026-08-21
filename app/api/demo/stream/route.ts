import { apiError, ok } from "@/lib/http";
import { streamDemo } from "@/lib/store";

export async function POST() {
  try {
    return ok(await streamDemo());
  } catch (error) {
    return apiError(error);
  }
}
