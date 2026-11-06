import { signal } from '@angular/core';
import { Chat } from '@ai-sdk/angular';
import { DefaultChatTransport } from 'ai';
import type { ChatStatus, UIMessage } from 'ai';
import type { AssistantMessage } from '../assessment.types';
import { publicErrorFromResponse } from '../assessment-client/public-error';

export type TurnState = 'idle' | 'active' | 'completed' | 'interrupted' | 'failed';

export interface RevisionChatOptions {
  caseId: string;
  revision: number;
  firstMessage: AssistantMessage;
  /** Test seam; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

/**
 * One @ai-sdk/angular Chat bound to one assessment revision.
 *
 * The request body is rebuilt in `prepareSendMessagesRequest` so it contains
 * exactly the server envelope: the chatInputSchema fields (caseId, revision,
 * messageId, text) plus the tolerated SDK envelope keys (id, messages, trigger).
 * The SDK would otherwise clobber a custom `messageId` body field with its own
 * envelope value, which the server requires as the idempotency key.
 */
export class RevisionChat {
  readonly caseId: string;
  readonly revision: number;

  private readonly chat: Chat;
  private readonly turnState = signal<TurnState>('idle');
  private readonly errorState = signal<string | null>(null);
  private lastTurn: { messageId: string; text: string } | null = null;
  private pendingError: string | null = null;

  constructor(options: RevisionChatOptions) {
    this.caseId = options.caseId;
    this.revision = options.revision;
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.chat = new Chat({
      messages: [toUIMessage(options.firstMessage)],
      transport: new DefaultChatTransport({
        api: '/api/chat',
        fetch: (input, init) => this.intercept(fetchFn, input, init),
        prepareSendMessagesRequest: ({ id, messages, trigger, body }) => ({
          body: {
            caseId: this.caseId,
            revision: this.revision,
            messageId: this.stringField(body, 'messageId'),
            text: this.stringField(body, 'text'),
            id,
            messages,
            trigger,
          },
        }),
      }),
      onError: (error) => {
        this.errorState.set(this.pendingError ?? error.message);
      },
      onFinish: ({ isAbort, isError }) => {
        this.turnState.set(isAbort ? 'interrupted' : isError ? 'failed' : 'completed');
      },
    });
  }

  get messages(): UIMessage[] {
    return this.chat.messages;
  }

  get status(): ChatStatus {
    return this.chat.status;
  }

  get busy(): boolean {
    return this.chat.status === 'submitted' || this.chat.status === 'streaming';
  }

  get turn(): TurnState {
    return this.turnState();
  }

  get retryable(): boolean {
    return (
      !this.busy &&
      (this.turnState() === 'interrupted' || this.turnState() === 'failed')
    );
  }

  get errorMessage(): string | null {
    return this.errorState();
  }

  /** Starts a new turn with a fresh user message id. */
  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) {
      return;
    }
    const messageId = newMessageId();
    this.lastTurn = { messageId, text: trimmed };
    this.beginTurn();
    await this.chat.sendMessage(
      { id: messageId, role: 'user', parts: [{ type: 'text', text: trimmed }] },
      {
        body: {
          caseId: this.caseId,
          revision: this.revision,
          messageId,
          text: trimmed,
        },
      },
    );
  }

  /** Reuses the same user message id and text for an interrupted or failed turn. */
  async retry(): Promise<void> {
    const last = this.lastTurn;
    if (!last || this.busy || !this.retryable) {
      return;
    }
    if (!this.chat.messages.some((message) => message.id === last.messageId)) {
      return;
    }
    this.beginTurn();
    await this.chat.sendMessage(
      { text: last.text, messageId: last.messageId },
      {
        body: {
          caseId: this.caseId,
          revision: this.revision,
          messageId: last.messageId,
          text: last.text,
        },
      },
    );
  }

  async stop(): Promise<void> {
    await this.chat.stop();
  }

  /** Aborts in-flight work; called when a new revision replaces this chat. */
  async dispose(): Promise<void> {
    await this.chat.dispose();
  }

  private beginTurn(): void {
    this.turnState.set('active');
    this.errorState.set(null);
    this.pendingError = null;
  }

  private async intercept(
    fetchFn: typeof globalThis.fetch,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetchFn(input, init);
    this.pendingError = null;
    if (!response.ok) {
      try {
        const body: unknown = await response.clone().json();
        this.pendingError = publicErrorFromResponse(response.status, body).message;
      } catch {
        /* Keep the generic transport error text. */
      }
    }
    return response;
  }

  private stringField(body: Record<string, unknown> | undefined, key: string): string {
    const value = body?.[key];
    return typeof value === 'string' ? value : '';
  }
}

function toUIMessage(message: AssistantMessage): UIMessage {
  return { id: message.id, role: 'assistant', parts: [...message.parts] };
}

function newMessageId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `m-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
