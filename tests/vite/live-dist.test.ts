/**
 * The live store and binder reach the page through `Function.prototype.toString`,
 * so they must survive the package build: a helper the bundler injects
 * (`keepNames`' `__name`, a minifier's renamed outer binding) would leave a
 * free name in the text and the page's script would throw. The other live
 * tests serialize the source functions; this one builds the Vite entry with
 * the package's own tsdown config and runs the virtual module it serves in a
 * jsdom window, as the page's own script.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// @ts-expect-error jsdom ships no types; this file only constructs a window.
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { build, type UserConfig } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import config from '../../tsdown.config';
import type { LiveBinder, LiveStore } from '../../src/vite/live';

const root = fileURLToPath(new URL('../..', import.meta.url));
// Inside the repository, so the built file resolves `vite` from its node_modules.
const out = join(root, 'node_modules/.cache/isotone-live-dist');
const project = mkdtempSync(join(tmpdir(), 'iso-live-dist-'));

interface LiveHooks {
  configResolved(config: unknown): void;
  resolveId(source: string, importer?: string): Promise<string | null>;
  load(id: string): { code: string } | null;
}

let code = '';

beforeAll(async () => {
  const library = (config as UserConfig[]).find((options) => options.format === 'esm');
  if (!library) throw new Error('tsdown.config.ts has no library (esm) build');
  await build({ ...library, entry: { vite: 'src/vite/index.ts' }, dts: false, config: false, logLevel: 'silent', outDir: out });
  const { isotone } = (await import(pathToFileURL(join(out, 'vite.js')).href)) as { isotone: (o: object) => unknown };
  const hooks = isotone({}) as LiveHooks;
  hooks.configResolved({ root: project, command: 'serve', assetsInclude: () => false, appType: 'spa', plugins: [] });
  const id = await hooks.resolveId('virtual:isotone/live');
  code = (id && hooks.load(id)?.code) || '';
}, 60_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

/** The serialized function in the live module between `start` and `call`. */
function serialized(start: string, call: string): string {
  const from = code.indexOf(start);
  const to = code.indexOf(call, from);
  if (from < 0 || to < 0) throw new Error(`no "${start}…${call}" in the live module`);
  return code.slice(from + start.length, to);
}

describe('the built live module', () => {
  it('runs the serialized store and binder with nothing but their arguments', () => {
    const { window } = new JSDOM('', { url: 'http://localhost/', runScripts: 'outside-only' });
    const page = window as unknown as Window & { eval: (code: string) => unknown; React?: unknown; __isotoneLive?: LiveStore };
    const cfg = { groups: [{ id: 'nav', members: ['picker-a', 'picker-b'] }], active: [], ssr: false, endpoint: '/api/isotone/variants' };
    const store = page.eval(`(${serialized('const store = (', ')(window, ')})(window, ${JSON.stringify(cfg)})`) as LiveStore;
    expect(page.__isotoneLive).toBe(store);
    store.register('src/Picker.tsx', [null, 'picker-a', 'picker-b'], false);
    expect(store.select(['picker-b'])).toBe(false);
    expect(store.active).toEqual(['picker-b']);
    expect(window.location.search).toBe('?v=nav:picker-b');

    page.React = React;
    const live = page.eval(`(${serialized('export const live = (', ')(React, store)')})(React, window.__isotoneLive)`) as LiveBinder;
    const versions = [null, 'picker-a', 'picker-b'].map((id) => ({ Picker: () => id }));
    expect(Object.keys(live.file('src/Picker.tsx', [null, 'picker-a', 'picker-b'], versions, ['Picker']))).toEqual(['Picker']);
    window.close();
  });
});
