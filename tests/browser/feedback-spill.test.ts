/**
 * Feedback stacks from the bottom, so a height cap below its own parts would push the page chips and the
 * composer out past its top edge, and the dock past the window. Neither a hold under a resting pointer
 * nor a height stored when the panel held less may do that, on any painted frame.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBundle } from '../../src/node/bundle';
import { type Chrome, findChrome, launchChrome } from '../helpers/chrome';

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
// Every open panel's edges, every option in Variants and Feedback's controls, as painted, after each frame.
// An option counts while it is in view, clear of the list's edges, where rows recede by design.
window.record = () => {
  const frames = [];
  let on = true;
  let eased = false;
  const sample = () => {
    if (!on) return;
    const f = { at: performance.now() };
    const r = root();
    eased ||= r.querySelector('.isotone-root').dataset.easing === 'true';
    for (const p of r.querySelectorAll('.isotone-panel[data-open="true"]:not(.isotone-exit)')) {
      const box = p.getBoundingClientRect();
      const name = p.classList.contains('isotone-notes-panel') ? 'feedback' : 'variants';
      // The top as seen: a panel revealed from its foot shows its top where its clip is.
      const clip = /^inset\\((-?[\\d.]+)px/.exec(getComputedStyle(p).clipPath);
      f[name + ' top'] = box.top + Math.max(0, clip ? Number(clip[1]) : 0);
      f[name + ' bottom'] = box.bottom;
    }
    const body = r.querySelector('.isotone-variants-panel[data-open="true"] .isotone-vars-body');
    if (body) {
      const view = body.getBoundingClientRect();
      for (const n of body.querySelectorAll('[role=radio], .isotone-section-toggle')) {
        const b = n.getBoundingClientRect();
        const name = (n.closest('.isotone-axis')?.dataset.motionKey ?? 'section') + ' ' + (n.getAttribute('aria-label') || n.textContent.trim());
        if (b.top > view.top + 48 && b.bottom < view.bottom - 48) f['option ' + name] = b.top;
      }
    }
    const list = r.querySelector('.isotone-notes-panel[data-open="true"] .isotone-list');
    if (list) {
      const view = list.getBoundingClientRect();
      for (const n of list.querySelectorAll('.isotone-note')) {
        const b = n.getBoundingClientRect();
        if (b.top > view.top + 10 && b.bottom < view.bottom - 10) f['note ' + n.dataset.motionKey] = b.top;
      }
    }
    for (const [key, selector] of [['send', '.isotone-notes-panel[data-open="true"] .isotone-send'], ['field', '.isotone-notes-panel[data-open="true"] textarea']]) {
      const n = r.querySelector(selector);
      if (n) f[key] = n.getBoundingClientRect().top;
    }
    frames.push(f);
    requestAnimationFrame(() => setTimeout(sample));
  };
  sample();
  window.stop = () => { on = false; return { frames, eased }; };
};
</script>`;

const binary = findChrome();
if (!binary && process.env.CI) throw new Error('CI needs Chrome for the layout tests: install it or set CHROME.');

// Notes on other pages only: the page chips show and this page's list is empty, so nothing can scroll.
const saved = [
  { id: 'a', route: '/computers', feedback: 'one', createdAt: '2026-01-01T00:00:00Z', done: false },
  { id: 'b', route: '/computers', feedback: 'two', createdAt: '2026-01-01T00:00:01Z', done: false },
  { id: 'c', route: '/projects', feedback: 'three', createdAt: '2026-01-01T00:00:02Z', done: false },
];
const LONG =
  'In this option, the header is overlapping with the content, the title sits under the toolbar and it keeps going for several lines';

/** Feedback's in-flow parts that reach past its edges, as `class top/bottom`. */
const SPILL = `(() => { const p = panel('notes'); const r = p.getBoundingClientRect(); const out = [];
  for (const c of p.children) { const s = getComputedStyle(c); if (s.display === 'none' || s.position === 'absolute') continue;
    const b = c.getBoundingClientRect(); if (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) out.push(c.className + ' ' + Math.round(b.top - r.top) + '/' + Math.round(r.bottom - b.bottom)); }
  return out; })()`;

describe.skipIf(!binary)('Feedback never spills past its edges (headless Chrome)', () => {
  let server: Server;
  let chrome: Chrome;
  let origin = '';
  beforeAll(async () => {
    const bundle = readBundle();
    server = createServer((req, res) => {
      if (req.url?.startsWith('/notes')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(saved));
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

  async function open(name: 'Variants' | 'Feedback') {
    const [px, py] = await chrome.eval<[number, number]>('pill()');
    await chrome.move(px, py);
    await chrome.eval('settle()');
    const [x, y] = await chrome.eval<[number, number]>(`face(${JSON.stringify(name)})`);
    await chrome.click(x, y);
    await chrome.eval('settle()');
  }

  it.each([
    ['typing under a resting pointer', null, false],
    ['typing with the pointer away', null, true],
    ['a height stored when the panel held one row', '{"notes":120}', false],
  ] as const)('%s', async (_, stored, away) => {
    await chrome.viewport(1024, 768);
    await chrome.goto(`${origin}/`);
    await chrome.eval(
      `sessionStorage.clear(); localStorage.clear(); ${stored ? `localStorage.setItem('isotone-feedback::dock', ${JSON.stringify(stored)})` : ''}`,
    );
    await chrome.goto(`${origin}/`);
    await chrome.eval('start(8)');
    await open('Variants');
    await open('Feedback');
    await chrome.key('Escape', 'Escape');
    await chrome.eval('settle()');
    const [fx, fy] = await chrome.eval<[number, number]>(`centre(panel('notes').querySelector('textarea'))`);
    await chrome.click(fx, fy);
    await chrome.eval('settle()');
    if (away) {
      await chrome.move(10, 300);
      await chrome.eval('settle()');
    }
    expect(await chrome.eval<string[]>(SPILL), 'before typing').toEqual([]);
    // The panel's top and any spill, on every painted frame while the composer grows.
    await chrome.eval(
      `window.__frames = []; (function f() { window.__frames.push([Math.round(panel('notes').getBoundingClientRect().top), ${SPILL}.length]); if (window.__frames.length < 40) requestAnimationFrame(f); })()`,
    );
    await chrome.insertText(LONG);
    await chrome.eval('new Promise((r) => setTimeout(r, 800)).then(settle)');
    const frames = await chrome.eval<[number, number][]>('window.__frames');
    expect(
      frames.filter(([top]) => top < 0),
      'frames with Feedback above the window',
    ).toEqual([]);
    expect(await chrome.eval<string[]>(SPILL), 'typed').toEqual([]);
    await chrome.move(10, 300);
    await chrome.eval('settle()');
    expect(await chrome.eval<string[]>(SPILL), 'pointer left').toEqual([]);
  });
});
