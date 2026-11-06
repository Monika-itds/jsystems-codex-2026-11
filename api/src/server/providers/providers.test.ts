import { describe, it, expect, vi } from "vitest";
import {
  createProviders,
  ProviderError,
  questions,
  answerPlanSchema,
} from "./index";
import type { ProviderConfig } from "../config/config";
const config: ProviderConfig = {
  apiKey: "synthetic-key",
  llmModel: "synthetic/text",
  visionModel: "synthetic/vision",
  decisionModel: "synthetic/decisions",
  decisionsUrl: "https://example.test/decisions",
  decisionsTimeoutMs: 1000,
  llmTimeoutMs: 1000,
  explanationTimeoutMs: 1000,
  timeZone: "Europe/Warsaw",
};
const image = {
  id: "00000000-0000-4000-8000-000000000001",
  mediaType: "image/jpeg" as const,
  width: 5,
  height: 5,
  byteLength: 1,
  hash: "a".repeat(64),
  warnings: [],
  bytes: Buffer.from([1]),
};
const intake = {
  caseType: "return" as const,
  category: "computers_laptops" as const,
  model: "Synthetic",
  purchaseDate: "2026-01-01",
  reason: "",
};
const initial = { image, intake, signal: new AbortController().signal };
const valid = () => ({
  model: config.decisionModel,
  answers: Object.fromEntries(
    questions.map((q) => [q.id, { type: "noul", noul: 0.9 }]),
  ),
  usage: {},
});
describe("provider boundaries", () => {
  it("posts only fixed Decisions questions and image state", async () => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(valid())),
    );
    const p = createProviders(config, { fetch: fetcher as typeof fetch });
    const out = await p.initial(initial);
    expect(Object.keys(out.probabilities)).toHaveLength(5);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(Object.keys(body.questions)).toEqual(questions.map((q) => q.id));
    expect(body.questions[questions[0].id]).toEqual({
      type: "noul",
      instructions: questions[0].instructions,
    });
    expect(body.state[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.messages).toBeUndefined();
  });
  it("retains valid partial probabilities on malformed output without leaking data", async () => {
    const v = valid();
    delete (v.answers as Record<string, unknown>)[questions[0].id];
    const p = createProviders(config, {
      fetch: vi.fn(async () => new Response(JSON.stringify(v))) as typeof fetch,
    });
    try {
      await p.initial(initial);
      throw Error("expected");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      const err = e as ProviderError;
      expect(err.kind).toBe("invalid_output");
      expect(Object.keys(err.partialProbabilities ?? {})).toHaveLength(4);
      expect(err.message).not.toContain("synthetic-key");
    }
  });
  it("rejects unknown plan fields", () =>
    expect(
      answerPlanSchema.safeParse({
        topics: [],
        observationIds: [],
        blockerCodes: [],
        acknowledgeNewInformation: false,
        action: "refund",
      }).success,
    ).toBe(false));
});

describe("failure and normalization", () => {
  const mockResponse = (body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body))) as typeof fetch;
  it("rejects malformed values, model mismatch, invalid JSON, oversized bodies and HTTP failures", async () => {
    const scenarios = [
      { ...valid(), model: "wrong" },
      {
        ...valid(),
        answers: {
          ...valid().answers,
          [questions[0].id]: { type: "noul", noul: 2 },
        },
      },
    ];
    for (const body of scenarios) {
      const p = createProviders(config, { fetch: mockResponse(body) });
      await expect(p.initial(initial)).rejects.toMatchObject({
        kind: "invalid_output",
      });
    }
    for (const response of [
      new Response("bad"),
      new Response("x".repeat(300000)),
      new Response("error", { status: 401 }),
    ]) {
      const p = createProviders(config, {
        fetch: vi.fn(async () => response) as typeof fetch,
      });
      await expect(p.initial(initial)).rejects.toBeInstanceOf(ProviderError);
    }
  });
  it("normalizes an unsupported resolution and passes image file with zero retries to the runner", async () => {
    const run = vi.fn(async (_input: unknown) => ({
      output: {
        findings: [
          {
            id: "scratch_visible",
            label: "absent",
            evidence: " ",
            limitations: [],
          },
        ],
        conflicts: false,
        unsupportedConditions: [],
        limitations: [],
      },
    }));
    const metadata = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { context_length: 100000 } })),
    ) as typeof fetch;
    const p = createProviders(config, { run, fetch: metadata });
    const result = await p.detailed({ ...initial, observations: [] });
    expect(result.analysis.findings[0].label).toBe("not_assessable");
    expect(run.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 2048,
      modelId: config.visionModel,
    });
  });
  it("enforces context metadata and rejects unknown plan output", async () => {
    const metadata = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              context_length: 10000,
              endpoints: [{ max_prompt_tokens: 9000 }],
            },
          }),
        ),
    ) as typeof fetch;
    const run = vi.fn(async () => ({
      output: {
        topics: [],
        observationIds: [],
        blockerCodes: [],
        acknowledgeNewInformation: false,
        action: "refund",
      },
    }));
    const p = createProviders(config, { fetch: metadata, run });
    expect(await p.contextLimit()).toBe(9000);
    await expect(
      p.plan({
        messages: [{ role: "user", content: "Hello" }],
        signal: initial.signal,
      }),
    ).rejects.toMatchObject({ kind: "invalid_output" });
    const unavailable = createProviders(config, {
      fetch: vi.fn(
        async () => new Response("", { status: 503 }),
      ) as typeof fetch,
      run,
    });
    await expect(
      unavailable.plan({ messages: [], signal: initial.signal }),
    ).rejects.toMatchObject({ kind: "configuration" });
  });
});

describe("additional protocol safeguards", () => {
  it("rejects wrong answer type and missing or unexpected IDs without fabricating values", async () => {
    for (const answers of [
      { ...valid().answers, [questions[0].id]: { type: "choice", noul: 0.5 } },
      { ...valid().answers, extra: { type: "noul", noul: 0.2 } },
      {},
    ]) {
      const p = createProviders(config, {
        fetch: vi.fn(
          async () => new Response(JSON.stringify({ ...valid(), answers })),
        ) as typeof fetch,
      });
      await expect(p.initial(initial)).rejects.toMatchObject({
        kind: "invalid_output",
      });
    }
  });
  it("stops immediately on abort and never retries an unavailable call", async () => {
    const fetcher = vi.fn(async () => {
      throw Error("synthetic sensitive diagnostic");
    });
    const p = createProviders(config, { fetch: fetcher as typeof fetch });
    await expect(p.initial(initial)).rejects.toMatchObject({
      kind: "unavailable",
      message: "The provider is unavailable.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const c = new AbortController();
    c.abort();
    await expect(
      p.initial({ ...initial, signal: c.signal }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accounts for binary image separately from text and rejects insufficient context", async () => {
    const run = vi.fn(async () => ({
      output: {
        findings: [],
        conflicts: false,
        unsupportedConditions: [],
        limitations: [],
      },
    }));
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { context_length: 100000 } })),
    ) as typeof fetch;
    const p = createProviders(config, { fetch: fetcher, run });
    const img = { ...image, bytes: Buffer.alloc(50 * 1024) };
    await expect(
      p.detailed({ ...initial, image: img, observations: [] }),
    ).resolves.toBeDefined();
    const q = createProviders(config, {
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { context_length: 1000 } })),
      ) as typeof fetch,
      run,
    });
    await expect(
      q.detailed({ ...initial, image: img, observations: [] }),
    ).rejects.toMatchObject({ kind: "context_limit" });
  });
});

describe("deadline and identity", () => {
  it("aborts at the configured Decisions deadline without retry", async () => {
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Error("private detail")),
            { once: true },
          );
        }),
    );
    const p = createProviders(
      { ...config, decisionsTimeoutMs: 15 },
      { fetch: fetcher as typeof fetch },
    );
    await expect(p.initial(initial)).rejects.toMatchObject({
      kind: "unavailable",
      message: "The provider is unavailable.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not invent usage or provider data when absent", async () => {
    const p = createProviders(config, {
      fetch: vi.fn(
        async () => new Response(JSON.stringify(valid())),
      ) as typeof fetch,
    });
    const result = await p.initial(initial);
    expect(result.identity.usage).toBeNull();
    expect(result.identity.provider).toBeNull();
  });
});

it("accepts valid typed answers without optional usage metadata", async () => {
  const body: Record<string, unknown> = valid();
  delete body.usage;
  const provider = createProviders(config, {
    fetch: vi.fn(
      async () => new Response(JSON.stringify(body)),
    ) as typeof fetch,
  });
  const result = await provider.initial(initial);
  expect(result.identity.usage).toBeNull();
});
it("classifies a response body transport failure as unavailable", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("synthetic transport disconnect"));
    },
  });
  const provider = createProviders(config, {
    fetch: vi.fn(async () => new Response(body)) as typeof fetch,
  });
  await expect(provider.initial(initial)).rejects.toMatchObject({
    kind: "unavailable",
  });
});

it("aborts a pending context metadata fetch with the caller and never starts generation", async () => {
  let metadataSignal: AbortSignal | null | undefined;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    metadataSignal = init?.signal;
    started();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("synthetic metadata abort")),
        { once: true },
      );
    });
  });
  const run = vi.fn(async () => ({
    output: {
      topics: [],
      observationIds: [],
      blockerCodes: [],
      acknowledgeNewInformation: false,
    },
  }));
  const provider = createProviders(
    { ...config, llmTimeoutMs: 50 },
    { fetch: fetcher as typeof fetch, run },
  );
  const controller = new AbortController();
  const pending = provider
    .plan({
      messages: [{ role: "user", content: "Why?" }],
      signal: controller.signal,
    })
    .catch((error) => error as ProviderError);
  await entered;
  controller.abort();
  expect(metadataSignal?.aborted).toBe(true);
  expect(await pending).toMatchObject({ kind: "unavailable" });
  expect(run).not.toHaveBeenCalled();
});
