import { assessmentHandlers } from "../../../../server/assessment/runtime";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  return assessmentHandlers.remove(request, (await params).caseId);
}
