import { readFileSync } from "node:fs";
import { join } from "node:path";

const documents = {
  return: {
    policy: "return-policy.md",
    prompt: "return-prompt.md",
    version: "DEMO-RETURN-1.0",
  },
  complaint: {
    policy: "complaint-policy.md",
    prompt: "complaint-prompt.md",
    version: "DEMO-COMPLAINT-1.0",
  },
} as const;

export function loadPolicyContent(
  caseType: "return" | "complaint",
): { version: string; text: string; prompt: string } | null {
  const files = documents[caseType];
  try {
    const text = readFileSync(
      join(process.cwd(), "content", files.policy),
      "utf8",
    );
    const prompt = readFileSync(
      join(process.cwd(), "content", files.prompt),
      "utf8",
    );
    if (
      !text
        .split(/\r?\n/)
        .some((line) => line.trim() === `**Version:** ${files.version}`) ||
      !prompt.trim()
    )
      return null;
    const rules = [...text.matchAll(/^(\d+)\.\s+\S.*$/gm)].map((match) =>
      Number(match[1]),
    );
    const expectedRules =
      caseType === "return" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    if (rules.join(",") !== expectedRules.join(",")) return null;
    return {
      version: files.version,
      text,
      prompt,
    };
  } catch {
    return null;
  }
}
