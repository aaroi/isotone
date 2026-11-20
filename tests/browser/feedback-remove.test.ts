/**
 * Removing notes with the pointer resting on Feedback, in headless Chrome: the panel takes its new height
 * at once, so no blank is left where a note was, the next note's remove button comes under the pointer,
 * and no row overshoots the place it settles in.
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

describe.skipIf(!binary)('Removing notes under a resting pointer (headless Chrome)', () => {
  let server: Server;
  let chrome: Chrome;
  let origin = '';
  let notes: Record<string, unknown>[] = [];
  beforeAll(async () => {
    const bundle = readBundle();
    server = createServer((req, res) => {
      if (req.url?.startsWith('/notes')) {
        if (req.method === 'DELETE') {
          const id = new URL(req.url, 'http://local').searchParams.get('id');
          notes = notes.filter((note) => note.id !== id);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.method === 'DELETE' ? '{}' : JSON.stringify(notes));
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

  it('leaves no blank, and the next remove button comes under the pointer', async () => {
    notes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      route: '/',
      feedback: `note ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      done: false,
    }));
    await chrome.viewport(1024, 768);
    await chrome.goto(`${origin}/`);
    await chrome.eval('sessionStorage.clear(); localStorage.clear()');
    await chrome.goto(`${origin}/`);
    await chrome.eval('start(3)');
    const [px, py] = await chrome.eval<[number, number]>('pill()');
    await chrome.move(px, py);
    await chrome.eval('settle()');
    const [fx, fy] = await chrome.eval<[number, number]>('face("Feedback")');
    await chrome.click(fx, fy);
    await chrome.eval('settle()');
    await chrome.key('Escape', 'Escape');
    await chrome.eval('settle()');
    const lastRemove = `[...panel('notes').querySelectorAll('.isotone-note > .isotone-x')].at(-1)`;
    // The space between the last note and the composer.
    const blank = `(() => { const p = panel('notes'); const last = [...p.querySelectorAll('.isotone-note')].at(-1).getBoundingClientRect();
      return Math.round(p.querySelector('.isotone-input').getBoundingClientRect().top - last.bottom); })()`;
    const resting = await chrome.eval<number>(blank);
    const [x, y] = await chrome.eval<[number, number]>(`centre(${lastRemove})`);
    await chrome.move(x - 40, y);
    await chrome.move(x, y);
    await chrome.eval('settle()');
    for (let removed = 1; removed <= 3; removed++) {
      // Every remove button's top on every painted frame while the note goes.
      await chrome.eval(`window.__frames = []; (function f() {
        window.__frames.push([...panel('notes').querySelectorAll('.isotone-note > .isotone-x')].map((b) => Math.round(b.getBoundingClientRect().top)));
        if (window.__frames.length < 30) requestAnimationFrame(f); })()`);
      await chrome.click(x, y);
      await chrome.eval('new Promise((r) => setTimeout(r, 700)).then(settle)');
      expect(await chrome.eval<number>(`panel('notes').querySelectorAll('.isotone-note').length`)).toBe(6 - removed);
      expect(await chrome.eval<number>(blank), `blank after removing ${removed}`).toBe(resting);
      expect(
        await chrome.eval<boolean>(`Boolean(root().elementFromPoint(${x}, ${y})?.closest('.isotone-x'))`),
        'next remove under the pointer',
      ).toBe(true);
      const frames = await chrome.eval<number[][]>('window.__frames');
      const settled = frames.at(-1) as number[];
      const overshoots = frames.flatMap((tops) =>
        tops.length === settled.length ? tops.filter((top, i) => top > (settled[i] ?? top) + 1) : [],
      );
      expect(overshoots, `rows past their place after removing ${removed}`).toEqual([]);
    }
  });
});
