import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

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

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A host to bind or a page hostname that is this machine. */
export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** A name or address only this machine answers: localhost, `*.localhost`,
 *  `*.test`, 127.0.0.0/8 or ::1 (brackets and a port allowed). */
function isLoopbackName(name: string): boolean {
  return name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.test') || isLoopbackAddress(name);
}

/**
 * Whether a Host header names this machine the way a local browser would: a
 * loopback name ({@link isLoopbackName}), one the dev server was told to
 * allow (Vite's `server.allowedHosts`; a leading dot allows subdomains), or,
 * with `anyAddress`, any IP literal (a LAN address the server listens on). A
 * DNS-rebinding page sends its own public domain, which fails.
 */
function isLocalHostHeader(host: string | null | undefined, allowed: readonly string[], anyAddress: boolean): boolean {
  if (!host) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (isLoopbackName(name) || (anyAddress && isIP(name))) return true;
  return allowed.some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('.') ? name === rule.slice(1) || name.endsWith(rule) : name === rule;
  });
}

/** A socket address on this machine (IPv4, IPv6, or IPv4-mapped IPv6). */
function isLoopbackAddress(address: string | null | undefined): boolean {
  return !!address && (address === '::1' || /^(::ffff:)?127\./.test(address));
}

/**
 * The client addresses a proxy or tunnel recorded in `X-Forwarded-For` or
 * `Forwarded`. A local tunnel (ngrok, cloudflared) connects from loopback,
 * so these are what show that the request really came from elsewhere.
 */
function forwardedAddresses(forwardedFor: string | null | undefined, forwarded: string | null | undefined): string[] {
  const listed = (forwardedFor ?? '').split(',');
  for (const match of (forwarded ?? '').matchAll(/for=("?)\[?([^\]";,]+)/gi)) listed.push(match[2] ?? '');
  return listed.map((entry) => entry.trim()).filter(Boolean);
}

/** What {@link checkRequest} reads from a request. */
export interface RequestFacts {
  origin?: string | null;
  host?: string | null;
  /** The peer address; omitted where the runtime does not expose it. */
  remoteAddress?: string | null;
  /** `X-Forwarded-For` and `Forwarded`, as received. */
  forwardedFor?: string | null;
  forwarded?: string | null;
}

/** The facts of a Node request, its peer address included. */
export function nodeRequestFacts(req: IncomingMessage): RequestFacts {
  const header = (name: string) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.join(',') : (value ?? null);
  };
  return {
    origin: header('origin'),
    host: header('host'),
    remoteAddress: req.socket?.remoteAddress ?? null,
    forwardedFor: header('x-forwarded-for'),
    forwarded: header('forwarded'),
  };
}

/** Whether the request comes from this machine: every address it names (the
 *  peer, when known, and any a proxy forwarded for) is loopback. */
export function isFromThisMachine(request: RequestFacts): boolean {
  const addresses = forwardedAddresses(request.forwardedFor, request.forwarded);
  if (request.remoteAddress !== undefined) addresses.push(request.remoteAddress ?? '');
  return addresses.every(isLoopbackAddress);
}

/**
 * Every endpoint's gate. Unless `network` is set, the request must come from
 * this machine ({@link isFromThisMachine}). The Host must be local
 * ({@link isLocalHostHeader}; an IP literal counts only when the peer was
 * checked or `network` is set, since without a peer address a LAN client
 * shows up as nothing but the server's LAN IP), and a page's Origin must
 * match it (or be any loopback page with `loopbackOrigins`). `network` is for
 * a caller that has let the request in some other way: the Vite plugin's
 * access cookie, or a Request adapter's explicit `allowNetwork`.
 */
export function checkRequest(
  request: RequestFacts & { allowedHosts?: readonly string[]; loopbackOrigins?: boolean; network?: boolean },
): void {
  if (!request.network && !isFromThisMachine(request)) {
    throw new HttpError(403, 'isotone answers only requests from this machine');
  }
  const anyAddress = request.network === true || request.remoteAddress !== undefined;
  if (!isLocalHostHeader(request.host, request.allowedHosts ?? [], anyAddress)) throw new HttpError(403, 'host not allowed');
  checkOrigin(request.origin, request.host ?? '', request.loopbackOrigins);
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

/** A JSON body needs a JSON content type: a cross-site form post cannot send
 *  one without a preflight, which these endpoints never grant. Only the media
 *  type counts (`application/json` or `application/*+json`), not a parameter:
 *  `text/plain; x=application/json` is still a form's type. */
function requireJson(type: string | null | undefined): void {
  const media = (type ?? '').replace(/;.*$/s, '').trim().toLowerCase();
  if (media !== 'application/json' && !/^application\/[^/]+\+json$/.test(media)) {
    throw new HttpError(415, 'content-type must be application/json');
  }
}

export async function readNodeJson(req: IncomingMessage): Promise<unknown> {
  requireJson(req.headers['content-type']);
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
  requireJson(request.headers.get('content-type'));
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
