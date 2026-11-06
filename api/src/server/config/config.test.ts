import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config";

const file =
  "OPENROUTER_API_KEY=synthetic-file-key\nLLM_MODEL=synthetic/text\nDECISION_MODEL=synthetic/decisions";
describe("server configuration", () => {
  it("uses process values ahead of the custom source without changing selected models", () => {
    const result = resolveConfig(
      {
        OPENROUTER_API_KEY: "synthetic-process-key",
        LLM_MODEL: "synthetic/process",
      },
      file,
    );
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("Synthetic configuration missing");
    expect(result.config.apiKey).toBe("synthetic-process-key");
    expect(result.config.llmModel).toBe("synthetic/process");
    expect(result.config.decisionModel).toBe("synthetic/decisions");
    expect(result.config.visionModel).toBe("synthetic/process");
  });
  it("reports missing configuration without inventing a provider", () => {
    expect(resolveConfig({}, "")).toEqual({
      available: false,
      missing: ["OPENROUTER_API_KEY", "LLM_MODEL", "DECISION_MODEL"],
    });
  });
  it("does not replace an explicit blank process value with a file value", () => {
    expect(resolveConfig({ LLM_MODEL: "" }, file)).toEqual({
      available: false,
      missing: ["LLM_MODEL"],
    });
  });
  it("rejects invalid timeouts and endpoint protocols without including supplied values", () => {
    expect(() => resolveConfig({ LLM_TIMEOUT_MS: "-1" }, file)).toThrow(
      "Invalid server configuration",
    );
    expect(() =>
      resolveConfig({ OPENROUTER_DECISIONS_URL: "http://invalid.test" }, file),
    ).toThrow("Invalid server configuration");
  });
});
