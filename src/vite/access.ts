/**
 * Other devices on the network, for a dev server exposed with `--host`.
 *
 * The endpoints answer this machine. Another device gets in with the access
 * link printed when the server starts: `?isotone-key=<key>` on any page sets
 * a cookie and redirects to the same page without the key, and from then on
 * that browser gets the panel and its requests are let through. The key
 * comes only from the terminal, never from a page, since anyone on the
 * network can load a page; a cookie needs nothing from the panel, whose
 * requests are same-origin and carry it.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';

import { isFromThisMachine, isLoopback, nodeRequestFacts } from '../node/http';

const PARAM = 'isotone-key';
const COOKIE = 'isotone-key';
/** Easy to type on a phone: lowercase letters and digits without 0/o, 1/l. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** One key per process, so a dev server that restarts after a config edit
 *  keeps the devices already let in. 12 characters: 60 bits. */
let processKey: string | undefined;
function accessKey(): string {
  processKey ??= [...randomBytes(12)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return processKey;
}

function sameKey(given: string | undefined, key: string): boolean {
  if (!given || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

function cookieKey(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** What the dev server was told to accept: the names in `server.allowedHosts`,
 *  and whether it listens beyond loopback (`server.host`, `vite --host`). */
export interface HostPolicy {
  names: readonly string[];
  network: boolean;
}

export function hostPolicy(server: { host?: string | boolean; allowedHosts?: string[] | true } | undefined): HostPolicy {
  const { allowedHosts: hosts, host } = server ?? {};
  return {
    names: Array.isArray(hosts) ? hosts : [],
    network: host === true || (typeof host === 'string' && !isLoopback(host)),
  };
}

export type NetworkAccess = ReturnType<typeof networkAccess>;

export function networkAccess() {
  const key = accessKey();
  /** Whether the request carries this server's access cookie. */
  const admitted = (req: IncomingMessage): boolean => sameKey(cookieKey(req), key);
  return {
    admitted,
    /** Whether the request may have the panel: this machine, or a device let in. */
    allows: (req: IncomingMessage): boolean => isFromThisMachine(nodeRequestFacts(req)) || admitted(req),

    /**
     * A navigation carrying the key: set the cookie and redirect to the same
     * URL without it, so the app never sees the key. True when it answered.
     */
    admit(req: IncomingMessage, res: ServerResponse): boolean {
      if (req.method !== 'GET' || !req.url?.includes(`${PARAM}=`)) return false;
      const url = new URL(req.url, 'http://x');
      if (!sameKey(url.searchParams.get(PARAM) ?? undefined, key)) return false;
      url.searchParams.delete(PARAM);
      res.statusCode = 302;
      // Lax, not Strict: the link is often opened from another app, and a
      // Strict cookie would be held back from that first navigation.
      res.setHeader('set-cookie', `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Lax`);
      res.setHeader('location', `${url.pathname}${url.search}${url.hash}`);
      res.setHeader('cache-control', 'no-store');
      res.end();
      return true;
    },

    /** The access links to print: one per LAN address, or a hint. */
    links(listening: { protocol: string; host: string | boolean | undefined; port: number; base: string }): string[] {
      const query = `?${PARAM}=${key}`;
      const hosts =
        typeof listening.host === 'string' && listening.host !== '0.0.0.0' && listening.host !== '::'
          ? [listening.host]
          : Object.values(networkInterfaces())
              .flat()
              .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
              .map((entry) => entry?.address ?? '');
      if (hosts.length === 0) return [`any page of this server with ${query}`];
      return hosts.map((host) => `${listening.protocol}://${host}:${listening.port}${listening.base}${query}`);
    },
  };
}
