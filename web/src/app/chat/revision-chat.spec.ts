import type { AssistantMessage } from '../assessment.types';
import type { UIMessage } from 'ai';
import { RevisionChat } from './revision-chat';

const CASE_ID = '00000000-0000-4000-8000-000000000001';

const FIRST_MESSAGE: AssistantMessage = {
  id: 'first',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Synthetic explanation.' }],
};

interface FakeStream {
  response: Response;
  push: (chunk: unknown) => void;
  close: () => void;
  cancelled: () => boolean;
}

function fakeSseStream(): FakeStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = false;
  const fake: FakeStream = {
    cancelled: () => cancelled,
    push: (chunk) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
    close: () => controller?.close(),
    response: undefined as unknown as Response,
  };
  fake.response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  return fake;
}

function instantSse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function completion(text: string, assistantId = 'assistant-1'): unknown[] {
  return [
    { type: 'start', messageId: assistantId, messageMetadata: { state: 'completed' } },
    { type: 'text-start', id: `${assistantId}-text` },
    { type: 'text-delta', id: `${assistantId}-text`, delta: text },
    { type: 'text-end', id: `${assistantId}-text` },
    { type: 'finish', messageMetadata: { state: 'completed' } },
  ];
}

function plainText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createChat(fetchImpl: typeof globalThis.fetch): RevisionChat {
  return new RevisionChat({ caseId: CASE_ID, revision: 3, firstMessage: FIRST_MESSAGE, fetch: fetchImpl });
}

describe('RevisionChat', () => {
  it('sends only the server envelope fields with caseId, revision, messageId and text', async () => {
    const calls: Array<{ init: RequestInit | undefined }> = [];
    const chat = createChat(async (_input, init) => {
      calls.push({ init });
      return instantSse(completion('Hi'));
    });

    await chat.send('Hello there');

    expect(calls.length).toBe(1);
    const body = bodyOf(calls[0].init);
    expect(Object.keys(body).sort()).toEqual(
      ['caseId', 'id', 'messageId', 'messages', 'revision', 'text', 'trigger'],
    );
    expect(body['caseId']).toBe(CASE_ID);
    expect(body['revision']).toBe(3);
    expect(body['text']).toBe('Hello there');
    expect(body['trigger']).toBe('submit-message');
    expect(typeof body['id']).toBe('string');
    expect(Array.isArray(body['messages'])).toBe(true);
    const messageId = String(body['messageId']);
    expect(messageId.length).toBeGreaterThan(0);
    expect(messageId.length).toBeLessThanOrEqual(200);
  });

  it('seeds the transcript with the trusted first message and streams one assistant reply per turn', async () => {
    const stream = fakeSseStream();
    const chat = createChat(async () => stream.response);

    expect(chat.messages.length).toBe(1);
    expect(chat.messages[0].id).toBe('first');
    expect(plainText(chat.messages[0])).toBe('Synthetic explanation.');

    const send = chat.send('question one');
    await settle();
    expect(chat.busy).toBe(true);
    stream.push({ type: 'start', messageId: 'a1' });
    stream.push({ type: 'text-start', id: 'p1' });
    stream.push({ type: 'text-delta', id: 'p1', delta: 'Hello' });
    await settle();
    expect(chat.messages.length).toBe(3);
    stream.push({ type: 'text-end', id: 'p1' });
    stream.push({ type: 'finish', messageMetadata: { state: 'completed' } });
    stream.close();
    await send;

    expect(chat.busy).toBe(false);
    expect(chat.turn).toBe('completed');
    expect(chat.messages.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(plainText(chat.messages[1])).toBe('question one');
    expect(plainText(chat.messages[2])).toBe('Hello');
  });

  it('stop interrupts the turn and retry reuses the same user message id and text without duplicating it', async () => {
    const streams = [fakeSseStream(), fakeSseStream()];
    const calls: Array<{ init: RequestInit | undefined }> = [];
    const chat = createChat(async (_input, init) => {
      calls.push({ init });
      return streams[calls.length - 1].response;
    });

    const send = chat.send('question one');
    await settle();
    streams[0].push({ type: 'start', messageId: 'a1' });
    streams[0].push({ type: 'text-start', id: 'p1' });
    streams[0].push({ type: 'text-delta', id: 'p1', delta: 'partial' });
    await settle();
    expect(chat.busy).toBe(true);

    await chat.stop();
    await send;
    expect(chat.turn).toBe('interrupted');
    expect(chat.retryable).toBe(true);
    expect(chat.messages.filter((message) => message.role === 'user').length).toBe(1);

    const retry = chat.retry();
    await settle();
    streams[1].push({ type: 'start', messageId: 'a2' });
    streams[1].push({ type: 'text-start', id: 'p2' });
    streams[1].push({ type: 'text-delta', id: 'p2', delta: 'complete answer' });
    streams[1].push({ type: 'text-end', id: 'p2' });
    streams[1].push({ type: 'finish', messageMetadata: { state: 'completed' } });
    streams[1].close();
    await retry;

    expect(calls.length).toBe(2);
    const firstBody = bodyOf(calls[0].init);
    const secondBody = bodyOf(calls[1].init);
    expect(secondBody['messageId']).toBe(firstBody['messageId']);
    expect(secondBody['text']).toBe('question one');
    const users = chat.messages.filter((message) => message.role === 'user');
    expect(users.length).toBe(1);
    expect(users[0].id).toBe(firstBody['messageId']);
    expect(chat.turn).toBe('completed');
    expect(chat.retryable).toBe(false);
  });

  it('maps a chat error code to a visible message and keeps the turn retryable', async () => {
    const chat = createChat(async () => new Response(
      JSON.stringify({ code: 'stale_revision', message: 'The request conflicts with the current revision.' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));

    await chat.send('question one');

    expect(chat.errorMessage).toBe('The request conflicts with the current revision.');
    expect(chat.turn).toBe('failed');
    expect(chat.retryable).toBe(true);
  });

  it('dispose aborts an in-flight request and stops the stream', async () => {
    const stream = fakeSseStream();
    const calls: Array<{ init: RequestInit | undefined }> = [];
    const chat = createChat(async (_input, init) => {
      calls.push({ init });
      return stream.response;
    });
    const send = chat.send('question one');
    await settle();

    await chat.dispose();
    await send;
    await settle();

    expect(calls[0].init?.signal?.aborted).toBe(true);
    expect(stream.cancelled()).toBe(true);
  });
});
