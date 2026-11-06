import { assessmentHandlers } from "../../../../server/assessment/runtime";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  return assessmentHandlers.get(request, (await params).caseId);
}
