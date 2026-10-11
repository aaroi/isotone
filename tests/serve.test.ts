/**
 * The standalone server, running for real. This is the plug-and-play path — a
 * host with no build integration gets the panel from `/iso-iterate.js` and
 * posts notes cross-origin — so the parts worth pinning are the bundle
 * actually carrying its mount call and the CORS rule that keeps a random
 * public page from writing into someone's repo.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { serveIteration, type ServedIteration } from '../src/serve/index';
import { NOTES_ENDPOINT } from '../src/store';
import { UPDATE_ENDPOINT } from '../src/update';

let served: ServedIteration;
let dir: string;
let file: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'iso-serve-'));
  file = join(dir, 'notes.json');
  served = await serveIteration({ file, port: 0, rule: { hidden: ['/login'] }, theme: 'light' });
});

afterAll(async () => {
  await served?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('the browser bundle', () => {
  it('is self-contained and carries the mount call with this server’s endpoint', async () => {
    const res = await fetch(served.bundleUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const js = await res.text();

    // Asserted as booleans on purpose: a `toContain` failure here would print
    // 400 KB of minified React into the test report.
    // React travels inside, so the page needs none of its own.
    expect(js.length).toBeGreaterThan(100_000);
    expect(/^\s*import\s/m.test(js), 'no bare imports').toBe(false);
    // The config comes from the server that owns the file, not the bundle.
    expect(js.includes('window.__isoIterate'), 'exposes the global').toBe(true);
    expect(
      js.includes(`${served.url}${NOTES_ENDPOINT}`),
      'bakes in the BOUND endpoint',
    ).toBe(true);
    expect(js.includes('"hidden":["/login"]'), 'passes the route rule').toBe(true);
    expect(js.includes('"theme":"light"'), 'passes the theme').toBe(true);
    expect(js.includes(`${served.url}${UPDATE_ENDPOINT}`), 'passes the update endpoint').toBe(true);
  });
});

describe('the update endpoint', () => {
  it('serves a private snapshot and never accepts an install action', async () => {
    const res = await fetch(`${served.url}${UPDATE_ENDPOINT}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'disabled', latestVersion: null, upgrade: null });
    expect((await fetch(`${served.url}${UPDATE_ENDPOINT}`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${served.url}${UPDATE_ENDPOINT}`, { headers: { origin: 'https://outside.example' } })).status).toBe(403);
  });
});

describe('the notes endpoint', () => {
  it('round-trips a note against the configured file', async () => {
    const created = await fetch(`${served.url}${NOTES_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        route: '/pricing',
        feedback: 'the figure should read $29/mo',
        element: { tag: 'span', text: '$29', selector: '#price-figure' },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const rows = (await (
      await fetch(`${served.url}${NOTES_ENDPOINT}?route=/pricing`)
    ).json()) as Array<{ id: string; element: { selector: string } | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].element?.selector).toBe('#price-figure');

    const gone = await fetch(`${served.url}${NOTES_ENDPOINT}?id=${id}`, {
      method: 'DELETE',
    });
    expect(gone.status).toBe(200);
    expect(
      ((await (await fetch(`${served.url}${NOTES_ENDPOINT}`)).json()) as unknown[]).length,
    ).toBe(0);
  });

  it('rejects a method it does not serve', async () => {
    const res = await fetch(`${served.url}${NOTES_ENDPOINT}`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

describe('CORS', () => {
  const ask = (origin: string) =>
    fetch(`${served.url}${NOTES_ENDPOINT}`, { headers: { origin } });

  it('lets any loopback dev origin through', async () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://localhost:8443',
    ]) {
      const res = await ask(origin);
      expect(
        res.headers.get('access-control-allow-origin'),
        `origin ${origin}`,
      ).toBe(origin);
    }
  });

  it('refuses a public origin, so a page you merely visit cannot write to the repo', async () => {
    for (const origin of [
      'https://evil.example.com',
      'http://notlocalhost.com',
      'null',
    ]) {
      const res = await ask(origin);
      expect(
        res.headers.get('access-control-allow-origin'),
        `origin ${origin}`,
      ).toBeNull();
    }
  });

  it('answers the preflight', async () => {
    const res = await fetch(`${served.url}${NOTES_ENDPOINT}`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('the setup page', () => {
  it('prints the script tag and a bookmarklet for pages you cannot edit', async () => {
    const html = await (await fetch(`${served.url}/`)).text();
    expect(html).toContain('&lt;script src=');
    expect(html).toContain(served.bundleUrl);
    expect(html).toContain('javascript:(function()');
    expect(html).toContain(file); // says where notes land
  });

  it('404s anything else', async () => {
    expect((await fetch(`${served.url}/nope`)).status).toBe(404);
  });
});


describe('bounded local requests', () => {
  it('rejects cross-site form writes, rebinding hosts and oversized JSON', async () => {
    const before = await (await fetch(`${served.url}${NOTES_ENDPOINT}`)).json();
    const post = await fetch(`${served.url}${NOTES_ENDPOINT}`, { method: 'POST', headers: { origin: 'https://outside.example', 'content-type': 'text/plain' }, body: JSON.stringify({ route: '/', feedback: 'unwanted' }) });
    expect(post.status).toBe(403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${served.url}${NOTES_ENDPOINT}`, { headers: { host: 'outside.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    expect(hostStatus).toBe(403);
    const large = await fetch(`${served.url}${NOTES_ENDPOINT}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feedback: 'x'.repeat(1024 * 1024) }) });
    expect(large.status).toBe(413);
    expect(await (await fetch(`${served.url}${NOTES_ENDPOINT}`)).json()).toEqual(before);
  });
  it('refuses to expose the local file server on every interface', () => {
    expect(() => serveIteration({ file, host: '0.0.0.0' })).toThrow('binds only');
  });
});
