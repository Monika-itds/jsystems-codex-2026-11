import { parseEnv } from "node:util";

export interface ProviderConfig {
  apiKey: string;
  llmModel: string;
  visionModel: string;
  decisionModel: string;
  decisionsUrl: string;
  decisionsTimeoutMs: number;
  llmTimeoutMs: number;
  explanationTimeoutMs: number;
  timeZone: string;
}
export type ConfigResult =
  | { available: true; config: ProviderConfig }
  | { available: false; missing: string[] };

export function resolveConfig(
  env: Record<string, string | undefined>,
  customSource: string,
): ConfigResult {
  const values = {
    ...parseEnv(customSource),
    ...Object.fromEntries(
      Object.entries(env).filter(([, v]) => v !== undefined),
    ),
  };
  const missing = ["OPENROUTER_API_KEY", "LLM_MODEL", "DECISION_MODEL"].filter(
    (key) => !values[key]?.trim(),
  );
  if (missing.length) return { available: false, missing };
  const timeout = (key: string, fallback: number) => {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 130_000)
      throw new Error("Invalid server configuration");
    return value;
  };
  const decisionsUrl =
    values["OPENROUTER_DECISIONS_URL"] ||
    "https://openrouter.ai/api/alpha/decisions";
  try {
    const url = new URL(decisionsUrl);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
    new Intl.DateTimeFormat("en", {
      timeZone: values["ASSESSMENT_TIME_ZONE"] || "Europe/Warsaw",
    });
  } catch {
    throw new Error("Invalid server configuration");
  }
  return {
    available: true,
    config: {
      apiKey: values["OPENROUTER_API_KEY"]!.trim(),
      llmModel: values["LLM_MODEL"]!.trim(),
      visionModel:
        values["VISION_MODEL"]?.trim() || values["LLM_MODEL"]!.trim(),
      decisionModel: values["DECISION_MODEL"]!.trim(),
      decisionsUrl,
      decisionsTimeoutMs: timeout("DECISIONS_TIMEOUT_MS", 30_000),
      llmTimeoutMs: timeout("LLM_TIMEOUT_MS", 60_000),
      explanationTimeoutMs: timeout("EXPLANATION_TIMEOUT_MS", 30_000),
      timeZone: values["ASSESSMENT_TIME_ZONE"] || "Europe/Warsaw",
    },
  };
}
