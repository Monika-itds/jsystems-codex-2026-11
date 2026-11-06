import { assessmentHandlers } from "../../../server/assessment/runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => assessmentHandlers.post(request);
