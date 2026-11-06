import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadPolicyContent } from "./content";

vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
const readFile = vi.mocked(readFileSync);

describe("policy content availability", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns unavailable for a missing policy or prompt file", () => {
    readFile.mockImplementation(() => {
      throw Object.assign(new Error("synthetic missing file"), {
        code: "ENOENT",
      });
    });
    expect(loadPolicyContent("return")).toBeNull();
  });

  it("returns unavailable for empty policy or prompt content", () => {
    readFile
      .mockReturnValueOnce("   " as never)
      .mockReturnValueOnce("Synthetic prompt" as never);
    expect(loadPolicyContent("complaint")).toBeNull();
    readFile.mockReset();
    readFile
      .mockReturnValueOnce("Synthetic policy" as never)
      .mockReturnValueOnce("\n\t" as never);
    expect(loadPolicyContent("complaint")).toBeNull();
  });

  it("returns unavailable when a policy file version does not match its contract", () => {
    readFile
      .mockReturnValueOnce("**Version:** DEMO-RETURN-OLD" as never)
      .mockReturnValueOnce("Synthetic prompt" as never);
    expect(loadPolicyContent("return")).toBeNull();
  });

  it("sanitizes other file read failures into unavailable content", () => {
    readFile.mockImplementation(() => {
      throw new Error("synthetic read failure");
    });
    expect(loadPolicyContent("complaint")).toBeNull();
  });
});

it("rejects a policy version with an unapproved suffix", () => {
  readFile.mockReset();
  readFile
    .mockReturnValueOnce("**Version:** DEMO-RETURN-1.0-invalid" as never)
    .mockReturnValueOnce("Synthetic prompt" as never);
  expect(loadPolicyContent("return")).toBeNull();
});

it("rejects a policy truncated to its version header", () => {
  readFile.mockReset();
  readFile
    .mockReturnValueOnce(
      "# Fictional policy\n**Version:** DEMO-RETURN-1.0" as never,
    )
    .mockReturnValueOnce("Synthetic prompt" as never);
  expect(loadPolicyContent("return")).toBeNull();
});
