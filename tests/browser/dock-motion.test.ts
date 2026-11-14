/**
 * No panel ever jumps: every change to a panel's size or position eases, frame by frame. This samples the
 * edges of every open panel after each painted frame through the dock's transitions in headless Chrome,
 * and fails on any edge that covers most of its way between two frames.
 *
 * `ISOTONE_BUNDLE=<path>` runs the same transitions against another build, to compare.
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBundle } from '../../src/node/bundle';
import { type Chrome, findChrome, launchChrome } from '../helpers/chrome';

const binary = findChrome();
if (!binary && process.env.CI) throw new Error('CI needs Chrome for the layout tests: install it or set CHROME.');

const PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0;height:100vh;background:#f4f4f5">
<script src="/isotone.js"></script>
<script>
window.start = async (count) => {
  const axes = Array.from({ length: count }, (_, i) => ({
    id: 'axis' + i,
    label: 'Part ' + (i % 3) + ' > Selector ' + i,
    defaultOption: 'a',
    options: [{ id: 'a', label: 'Plain' }, { id: 'b', label: 'Bold' }, { id: 'c', label: 'Wide' }],
  }));
  let selections = {};
  const listeners = new Set();
  const source = {
    getAxes: () => axes,
    getSelections: () => selections,
    setSelection(id, value) { selections = { ...selections, [id]: value }; listeners.forEach((l) => l()); },
    reset() { selections = {}; listeners.forEach((l) => l()); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    saveDefaults() {},
  };
  window.__isotone.mount({ variants: source, endpoint: '/notes', theme: 'light', compareShortcut: false });
  for (let tries = 0; !root()?.querySelector('.isotone-rail-track') && tries < 100; tries++) await frame();
  await settle();
};
const root = () => document.querySelector('[data-isotone="root"]')?.shadowRoot;
window.root = root;
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
window.settle = async () => {
  await frame();
  for (let tries = 0; tries < 50; tries++) {
    const running = root().getAnimations().filter((a) => a.timeline === document.timeline && a.playState === 'running');
    if (!running.length) break;
    await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1000))]);
  }
  await frame();
  await frame();
};
window.centre = (node) => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
window.pill = () => centre(root().querySelector('.isotone-rail-track'));
window.face = (name) => centre(root().querySelector('.isotone-rail-button[aria-label^="' + name + '"]'));
window.panel = (name) => root().querySelector('.isotone-' + name + '-panel');
// Every open panel's top and bottom edge as painted, sampled after each frame until stopped.
window.record = () => {
  const frames = [];
  let on = true;
  const sample = () => {
    if (!on) return;
    const edges = {};
    for (const p of root().querySelectorAll('.isotone-panel[data-open="true"]:not(.isotone-exit)')) {
      const r = p.getBoundingClientRect();
      const name = p.classList.contains('isotone-notes-panel') ? 'feedback' : 'variants';
      edges[name + ' top'] = r.top;
      edges[name + ' bottom'] = r.bottom;
    }
    frames.push(edges);
    requestAnimationFrame(() => setTimeout(sample));
  };
  sample();
  window.stop = () => { on = false; return frames; };
};
</script>`;

/** Edges that moved more than 4px and covered over 80% of the way between two painted frames. */
function jumps(frames: Record<string, number>[]): string[] {
  const found: string[] = [];
  const keys = new Set(frames.flatMap((f) => Object.keys(f)));
  for (const key of keys) {
    const series = frames.map((f) => f[key]).filter((v): v is number => v !== undefined);
    if (series.length < 2) continue;
    const total = Math.abs((series.at(-1) as number) - (series[0] as number));
    let span = 0;
    for (let i = 1; i < series.length; i++) span = Math.max(span, Math.abs((series[i] as number) - (series[i - 1] as number)));
    const travel = Math.max(total, Math.max(...series) - Math.min(...series));
    if (travel > 4 && span > 4 && span > travel * 0.8) found.push(`${key} jumped ${Math.round(span)}px of ${Math.round(travel)}px`);
  }
  return found;
}

describe.skipIf(!binary)('No panel jumps (headless Chrome)', () => {
  let server: Server;
  let origin = '';
  let chrome: Chrome;
  let notes: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const bundle = process.env.ISOTONE_BUNDLE ? readFileSync(process.env.ISOTONE_BUNDLE, 'utf8') : readBundle();
    server = createServer((req, res) => {
      if (req.url?.startsWith('/notes')) {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            const id = `n${notes.length + 1}`;
            notes.push({ ...JSON.parse(body), id, done: false });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id }));
          });
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(notes));
        return;
      }
      const script = req.url === '/isotone.js';
      res.writeHead(200, { 'content-type': `${script ? 'text/javascript' : 'text/html'}; charset=utf-8` });
      res.end(script ? bundle : PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    chrome = await launchChrome(binary as string);
  });

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  async function fresh(count: number, width = 1024, height = 768) {
    notes = [];
    await chrome.viewport(width, height);
    await chrome.goto(`${origin}/`);
    await chrome.eval('sessionStorage.clear(); localStorage.clear()');
    await chrome.goto(`${origin}/`);
    await chrome.eval(`start(${count})`);
  }
  /** Hover the pill so it unfolds, then click a tool's face, as a mouse would. */
  async function tool(name: 'Variants' | 'Feedback') {
    const [px, py] = await chrome.eval<[number, number]>('pill()');
    await chrome.move(px, py);
    await chrome.eval('settle()');
    const [x, y] = await chrome.eval<[number, number]>(`face(${JSON.stringify(name)})`);
    await chrome.click(x, y);
    await chrome.eval('settle()');
  }
  /** The edges' frames through `act`, until every animation has settled and a little after. */
  async function through(act: () => Promise<void>) {
    await chrome.eval('record()');
    await act();
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 250)))');
    return jumps(await chrome.eval<Record<string, number>[]>('stop()'));
  }
  const pressEscape = () => chrome.key('Escape', 'Escape');

  /** One transition: no edge of an open panel may jump through it. */
  const step = async (label: string, act: () => Promise<void>) => expect.soft(await through(act), label).toEqual([]);

  for (const [count, list] of [
    [3, 'a short list'],
    [12, 'a long list'],
  ] as const) {
    it(`Feedback opening and closing above Variants, with ${list}`, async () => {
      await fresh(count);
      await tool('Variants');
      await step('Feedback opens', () => tool('Feedback'));
      await pressEscape(); // select mode
      await step('Feedback closes', () => tool('Feedback'));
      await step('the pointer leaves the dock', () => chrome.move(20, 300));
    });

    it(`Variants opening and closing under Feedback, with ${list}`, async () => {
      await fresh(count);
      await tool('Feedback');
      await pressEscape();
      await step('Variants opens', () => tool('Variants'));
      await step('Variants closes', () => tool('Variants'));
    });

    it(`a note saved with both open, and a section folded, with ${list}`, async () => {
      await fresh(count);
      await tool('Variants');
      await tool('Feedback');
      await step('a note is saved', async () => {
        await chrome.insertText('A note that is saved');
        await chrome.key('Enter', 'Enter', 0, '\r');
        await chrome.eval(
          `(async () => { for (let i = 0; i < 50 && !root().querySelector('.isotone-note'); i++) await new Promise((r) => setTimeout(r, 20)); })()`,
        );
      });
      const [x, y] = await chrome.eval<[number, number]>(`centre(panel('variants').querySelector('.isotone-section-toggle'))`);
      await step('a section folds', () => chrome.click(x, y));
      await step('a section unfolds', () => chrome.click(x, y));
    });
  }

  it('the defaults bar appearing and leaving', async () => {
    await fresh(3);
    await tool('Variants');
    const option = `centre([...panel('variants').querySelectorAll('[role=radio]')].find((n) => n.textContent.trim() === 'Bold'))`;
    const [x, y] = await chrome.eval<[number, number]>(option);
    await step('the bar appears', () => chrome.click(x, y));
    const [px, py] = await chrome.eval<[number, number]>(option.replace('Bold', 'Plain'));
    await step('the bar leaves', () => chrome.click(px, py));
  });
});
