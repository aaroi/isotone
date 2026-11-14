/**
 * Which checkout an `isotone serve` port belongs to.
 *
 * The port is machine-wide, but the loader tag that names it lives in the
 * project's source, so every checkout of a project (Git worktrees, parallel
 * agent sessions) points its pages at the same port. The first `serve` to start
 * wins it, and the other checkouts' panels then save into the winner's notes
 * file. The server says whose it is at {@link SERVER_ENDPOINT}, so `serve` can
 * name the checkout holding a port and the notes CLI can warn when the server
 * its pages reach belongs to another checkout.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get } from 'node:http';
import { join, resolve } from 'node:path';

import { version } from '../../package.json';
import { DEFAULT_PORT } from '../core/tag';
import { canonicalPath, realPath } from './fs/paths';

export const SERVER_ENDPOINT = '/api/isotone/server';

/** What `GET /api/isotone/server` answers. */
export interface ServerOwner {
  isotone: string;
  /** The project `serve` runs in. Absolute. */
  root: string;
  /** The notes file it saves to. Absolute. */
  file: string;
}

export function serverOwner(root: string, file: string): ServerOwner {
  return { isotone: version, root, file };
}

/** A loopback host as it goes in a URL: `::1` needs brackets. */
export function urlHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/**
 * Ask the server on `port` whose it is. Null when nothing listens there, it is
 * not an `isotone serve` (or one from before this endpoint), or it does not answer in time.
 */
export function probeOwner(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<ServerOwner | null> {
  return new Promise((done) => {
    // Its own connection, destroyed on every outcome: a port held by
    // something that never answers must not keep this process alive.
    const req = get({ host: host.replace(/^\[|\]$/g, ''), port, path: SERVER_ENDPOINT, agent: false, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 64 * 1024) finish(null);
      });
      res.on('end', () => finish(res.statusCode === 200 ? ownerOf(body) : null));
      res.on('error', () => finish(null));
    });
    const finish = (owner: ServerOwner | null) => {
      req.destroy();
      done(owner);
    };
    req.on('timeout', () => finish(null));
    req.on('error', () => finish(null));
  });
}

function ownerOf(text: string): ServerOwner | null {
  try {
    const body = JSON.parse(text) as Partial<ServerOwner>;
    return typeof body.isotone === 'string' && typeof body.root === 'string' && typeof body.file === 'string'
      ? { isotone: body.isotone, root: body.root, file: body.file }
      : null;
  } catch {
    return null;
  }
}

export function samePath(a: string, b: string): boolean {
  const canonical = (p: string) => {
    try {
      return canonicalPath(p);
    } catch {
      return resolve(p);
    }
  };
  return canonical(a) === canonical(b);
}

/** A directory's work tree and the Git directory its worktrees share. */
function gitPlace(dir: string): { top: string; common: string } | null {
  try {
    const [top, common] = execFileSync('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .trim()
      .split('\n');
    return top && common ? { top: realPath(top), common: realPath(common) } : null;
  } catch {
    return null;
  }
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vite.config.cts', 'vite.config.cjs'];

/**
 * The ports this project's panel loads from. A package.json script that hands
 * `isotone serve` a literal port names it. A script whose port is computed in
 * the shell (`--port $((PORT + 20000))`) is per checkout already, and a Vite
 * plugin serves the panel from the dev server itself, so neither shares a
 * port with another checkout. Otherwise it is the default.
 */
function projectServePorts(dir: string): number[] {
  const { ports, computed } = scriptServePorts(dir);
  if (ports.length) return ports.slice(0, 4);
  if (computed || usesVitePlugin(dir)) return [];
  return [DEFAULT_PORT];
}

/** The literal ports package.json scripts hand `isotone serve`, and whether one computes its port in the shell. */
export function scriptServePorts(dir: string): { ports: number[]; computed: boolean } {
  const ports = new Set<number>();
  let computed = false;
  try {
    const scripts = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts;
    for (const script of Object.values(scripts ?? {})) {
      if (typeof script !== 'string') continue;
      for (const match of script.matchAll(/isotone serve\b[^&|;]*?--port[= ](\S+)/g)) {
        const port = Number(match[1]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
        else computed = true;
      }
    }
  } catch {
    /* No package.json, or not JSON. */
  }
  return { ports: [...ports], computed };
}

function usesVitePlugin(dir: string): boolean {
  return VITE_CONFIGS.some((name) => {
    try {
      return readFileSync(join(dir, name), 'utf8').includes('isotone/vite');
    } catch {
      return false;
    }
  });
}

/** A server on this project's port that saves to another notes file. */
export interface ForeignServer extends ServerOwner {
  port: number;
  /** In another worktree, rather than this checkout with another `--file`. */
  otherCheckout: boolean;
}

/**
 * The servers on this project's ports that save to a notes file other than
 * `file`, in this work tree or another worktree of its repository. Pages that
 * load the panel from one of those ports save their notes there.
 *
 * Only 127.0.0.1 is asked: a `serve --host ::1` is not found, and can share a
 * port number with one on 127.0.0.1 without either failing to start.
 */
export async function foreignServers(dir: string, file: string): Promise<ForeignServer[]> {
  const found = await Promise.all(
    projectServePorts(dir).map(async (port) => {
      const owner = await probeOwner(port);
      if (!owner || samePath(owner.file, file)) return null;
      const here = gitPlace(dir);
      const there = gitPlace(owner.root);
      if (!here || !there || here.common !== there.common) return null;
      const sameCheckout = here.top === there.top;
      return { ...owner, port, otherCheckout: !sameCheckout };
    }),
  );
  return found.filter((owner): owner is ForeignServer => owner !== null);
}
