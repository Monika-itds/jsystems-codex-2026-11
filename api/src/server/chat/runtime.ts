import "server-only";
import { getRuntimeConfig } from "../config/runtime";
import { loadPolicyContent } from "../policy/content";
import { sessionStore } from "../sessions";
import { createChatHandler } from "./index";

export const chatHandlers = createChatHandler({
  store: sessionStore,
  config: getRuntimeConfig,
  content: loadPolicyContent,
});
