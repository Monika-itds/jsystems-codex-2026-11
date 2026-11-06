import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveConfig, type ConfigResult } from "./config";

// Only the isolated backend runtime calls this function; tests inject synthetic text into resolveConfig.
export function getRuntimeConfig(): ConfigResult {
  let source = "";
  try {
    source = readFileSync(
      resolve(process.cwd(), "../secrets/openrouter.env"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Server configuration unavailable");
  }
  try {
    return resolveConfig(process.env, source);
  } catch {
    throw new Error("Server configuration unavailable");
  }
}
