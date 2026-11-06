import type { PublicError } from '../assessment.types';

/** Visible fallback text per documented public error code. */
const fallbackText: Record<PublicError['code'], string> = {
  validation: 'The request is invalid. Check the case fields and try again.',
  capacity: 'The request exceeds supported limits.',
  stale_revision: 'The request conflicts with the current revision.',
  inaccessible: 'Session or case is not available.',
  expired: 'Session has expired; start a new case.',
  origin: 'Request origin is not allowed.',
  context_limit:
    'The complete case and conversation exceed the supported context limit. Edit the form and reassess to continue; the current result remains unchanged.',
  unavailable: 'The service is unavailable right now.',
};

const codeByStatus: Readonly<Record<number, PublicError['code']>> = {
  403: 'origin',
  404: 'inaccessible',
  409: 'stale_revision',
  410: 'expired',
  413: 'capacity',
  422: 'validation',
  503: 'unavailable',
};

const knownCodes = new Set<string>(Object.keys(fallbackText));

/** Maps an HTTP error response to the documented public error with a visible message. */
export function publicErrorFromResponse(status: number, body: unknown): PublicError {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  const rawCode = record?.['code'];
  const code: PublicError['code'] =
    typeof rawCode === 'string' && knownCodes.has(rawCode)
      ? (rawCode as PublicError['code'])
      : codeByStatus[status] ?? 'unavailable';
  const rawMessage = record?.['message'];
  const message =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0
      ? rawMessage
      : fallbackText[code];
  return { code, message };
}

export function publicErrorText(error: PublicError): string {
  return error.message;
}
