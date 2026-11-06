import { chatHandlers } from "../../../server/chat/runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => chatHandlers.post(request);
