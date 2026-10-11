import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
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
    if ((url.protocol === 'http:' || url.protocol === 'https:') &&
      (loopbackOnly ? isLoopback(url.hostname) : url.host === host)) return;
  } catch { /* An invalid or opaque origin is not a local review page. */ }
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
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(undefined); }
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
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return undefined; }
  } finally { reader.releaseLock(); }
}

export function httpFailure(error: unknown): { status: number; headers: Record<string, string>; body: unknown } {
  return {
    status: error instanceof HttpError ? error.status : 500,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: { error: error instanceof HttpError ? error.message : 'Could not read or write the local feedback store.' },
  };
}

export function sendFailure(res: ServerResponse, error: unknown): void {
  const failure = httpFailure(error);
  res.statusCode = failure.status;
  for (const [key, value] of Object.entries(failure.headers)) res.setHeader(key, value);
  res.end(JSON.stringify(failure.body));
}
