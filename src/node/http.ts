import type { IncomingMessage, ServerResponse } from 'node:http';

import { MAX_BODY_BYTES } from '../core/limits';
import { LockBusyError } from './fs/lock';

/** The transport-agnostic result of a request — any runtime (Vite
 *  middleware, Next route handler, Bun serve, Vercel) can render it. */
export interface HandlerResponse {
  status: number;
  /** Response headers object (frameworks set them on their own res). */
  headers: Record<string, string>;
  /** The JSON payload to send. */
  body: unknown;
}

/** A request the pure handlers understand (framework-neutral). */
export interface HandlerRequest {
  method?: string;
  url?: string;
  body?: unknown;
}

/** A JSON answer that no cache keeps. */
export function jsonResponse(status: number, body: unknown): HandlerResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body,
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

export function checkOrigin(origin: string | null | undefined, host: string, loopbackOnly = false): void {
  if (!origin) return; // CLI and same-origin GET requests need no Origin header.
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && (loopbackOnly ? isLoopback(url.hostname) : url.host === host)) return;
  } catch {
    /* An invalid or opaque origin is not a local review page. */
  }
  throw new HttpError(403, 'origin not allowed');
}

export async function readNodeJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new HttpError(413, 'request body too large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, 'request aborted')));
  });
}

export async function readWebJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'request body too large');
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return undefined;
    }
  } finally {
    reader.releaseLock();
  }
}

export function httpFailure(error: unknown): HandlerResponse {
  // A busy store is temporary: 503 tells the panel to keep the note and retry.
  const known = error instanceof HttpError ? error : error instanceof LockBusyError ? new HttpError(503, error.message) : null;
  return {
    status: known ? known.status : 500,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: { error: known ? known.message : 'Could not read or write the local feedback store.' },
  };
}

export function sendFailure(res: ServerResponse, error: unknown): void {
  const failure = httpFailure(error);
  res.statusCode = failure.status;
  for (const [key, value] of Object.entries(failure.headers)) res.setHeader(key, value);
  res.end(JSON.stringify(failure.body));
}

/**
 * Write a handler response, or a 500 when the handler throws. A store that
 * cannot write (permissions, a read-only mount) must still answer, or the
 * panel's request hangs and the reviewer sees nothing; a 500 sends a note
 * to the localStorage fallback. Returns the response so the caller can act
 * on a success, `null` on a throw.
 */
export function writeResponse(res: ServerResponse, respond: () => HandlerResponse): { status: number; body: unknown } | null {
  try {
    const { status, headers, body } = respond();
    res.statusCode = status;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
    return { status, body };
  } catch (cause) {
    sendFailure(res, cause);
    return null;
  }
}
