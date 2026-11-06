import "server-only";
import { getRuntimeConfig } from "../config/runtime";
import { loadPolicyContent } from "../policy/content";
import { sessionStore } from "../sessions";
import { createAssessmentHandlers } from "./index";
export const assessmentHandlers = createAssessmentHandlers({
  store: sessionStore,
  config: getRuntimeConfig,
  content: loadPolicyContent,
});
