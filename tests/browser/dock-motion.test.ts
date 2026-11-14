/**
 * No sudden movement in the dock, sampled after every painted frame in headless Chrome:
 *
 * - controls that should stay where they are (Variants' options while Feedback opens, saves or closes;
 *   the section toggle under the pointer; Feedback's send button; everything a reload restores) move by
 *   no more than a pixel at any frame;
 * - anything that does move (a panel's edges, a panel sliding over) never covers most of its way between
 *   two frames;
 * - a keyboard resize step lands exactly; a long list (over `MAX_ANIMATED_ITEMS`) never animates a size;
 * - a size held under a resting pointer lets go in one ease, and a finger never holds one.
 *
 * `ISOTONE_BUNDLE=<path>` runs the same transitions against another build, to compare; the measured
 * steps are logged as `motion:` lines either way.
 */
import { readFileSync, writeFileSync } from 'node:fs';
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

interface Motion {
  /** The largest step between two frames of anything that should have stayed put, and what moved. */
  still: number;
  moved?: string;
  /** Things that moved, each covering most of its way between two frames. */
  jumps: string[];
  /** Whether any height eased. */
  eased: boolean;
}

/** A gap between samples, in ms, past which a step says nothing about an ease of 180 ms. */
const SLOW_FRAME = 50;

/** Measure a recording: `stay` matches the keys that must not move; the rest may glide, never jump. */
function motion({ frames, eased }: { frames: Record<string, number>[]; eased: boolean }, stay: RegExp): Motion {
  const keys = new Set(frames.flatMap((f) => Object.keys(f)));
  keys.delete('at');
  let still = 0;
  let moved: string | undefined;
  const jumps: string[] = [];
  for (const key of keys) {
    let span = 0;
    let travel = 0;
    let first: number | undefined;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]?.[key];
      const b = frames[i]?.[key];
      first ??= a ?? b;
      if (a === undefined || b === undefined) continue;
      travel = Math.max(travel, Math.abs(b - (first as number)));
      // A step across a frame that took most of an ease (a loaded machine) shows nothing of how it moved:
      // only steps between frames a 60 Hz screen could have shown count toward a jump. What must stay
      // put counts at any speed.
      const slow = (frames[i]?.at ?? 0) - (frames[i - 1]?.at ?? 0) > SLOW_FRAME;
      if (!slow || stay.test(key)) span = Math.max(span, Math.abs(b - a));
    }
    if (stay.test(key) && Math.max(span, travel) > still) {
      still = Math.max(span, travel);
      moved = key;
      // Something that glides out of view has no end to judge its steps against.
    } else if (frames.at(-1)?.[key] !== undefined && travel > 4 && span > 4 && span > travel * 0.8)
      jumps.push(`${key} jumped ${Math.round(span)}px of ${Math.round(travel)}px`);
  }
  return { still: Math.round(still * 10) / 10, moved, jumps, eased };
}

/** How many separate movements `key` makes: one ease moves on every frame from its start to where it lands. */
function stages(frames: Record<string, number>[], key: string): number {
  const values = frames.map((f) => f[key]).filter((v): v is number => v !== undefined);
  let count = 0;
  let moving = false;
  for (let i = 1; i < values.length; i++) {
    const now = Math.abs((values[i] as number) - (values[i - 1] as number)) > 0.5;
    if (now && !moving) count++;
    moving = now;
  }
  return count;
}

/** The measured steps, logged, and written to `MOTION_REPORT` when it names a file. */
const report: string[] = [];
const note = (line: string) => {
  report.push(line);
  console.log(line);
};

describe.skipIf(!binary)('No sudden movement in the dock (headless Chrome)', () => {
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
    if (process.env.MOTION_REPORT) writeFileSync(process.env.MOTION_REPORT, `${report.join('\n')}\n`);
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  async function fresh(count: number, saved: Record<string, unknown>[] = [], touch = false) {
    notes = saved;
    await chrome.viewport(touch ? 390 : 1024, touch ? 844 : 768, touch);
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
  /** Record through `act` until every animation has settled and a little after. */
  async function through(act: () => Promise<void>, stay: RegExp): Promise<Motion> {
    await chrome.eval('record()');
    await act();
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
    return motion(await chrome.eval('stop()'), stay);
  }
  /** One transition: what should stay moves under a pixel, and nothing jumps. */
  async function step(label: string, act: () => Promise<void>, stay: RegExp) {
    const result = await through(act, stay);
    note(
      `motion: ${label}: still ${result.still}px${result.moved ? ` (${result.moved})` : ''}, jumps ${JSON.stringify(result.jumps)}, eased ${result.eased}`,
    );
    expect.soft(result.still, `${label}: what should stay moved`).toBeLessThanOrEqual(1);
    expect.soft(result.jumps, `${label}: jumps`).toEqual([]);
    return result;
  }
  const pressEscape = () => chrome.key('Escape', 'Escape');
  const NONE = /^$/;
  const OPTIONS = /^option /;
  /** Selectors that fit in Variants alone, and scroll once Feedback opens beside it. */
  const FITS_ALONE = 6;

  for (const [count, list] of [
    [3, 'a short list'],
    [12, 'a long list'],
  ] as const) {
    it(`Feedback opening and closing above Variants, with ${list}`, async () => {
      await fresh(count);
      await tool('Variants');
      await step(`${list}: Feedback opens`, () => tool('Feedback'), OPTIONS);
      await pressEscape(); // select mode
      await step(`${list}: Feedback closes`, () => tool('Feedback'), OPTIONS);
      await step(`${list}: the pointer leaves`, () => chrome.move(20, 300), NONE);
    });

    it(`Variants opening and closing under Feedback, with ${list}`, async () => {
      await fresh(count);
      await tool('Feedback');
      await pressEscape();
      await step(`${list}: Variants opens`, () => tool('Variants'), NONE);
      await step(`${list}: Variants closes`, () => tool('Variants'), NONE);
    });

    it(`a note saved, and a section folded and unfolded, with both open, with ${list}`, async () => {
      await fresh(count);
      await tool('Variants');
      await tool('Feedback');
      await step(
        `${list}: a note is saved`,
        async () => {
          await chrome.insertText('A note that is saved');
          await chrome.key('Enter', 'Enter', 0, '\r');
          await chrome.eval(
            `(async () => { for (let i = 0; i < 50 && !root().querySelector('.isotone-note'); i++) await new Promise((r) => setTimeout(r, 20)); })()`,
          );
        },
        /^(option |send$)/,
      );
      const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
      const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
      // The toggle under the pointer stays where it is through both clicks.
      await chrome.eval(`${toggle}.dataset.probe = 'toggle'`);
      const under = async () => chrome.eval<number>(`${toggle}.getBoundingClientRect().top`);
      const before = await under();
      await step(`${list}: a section folds`, () => chrome.click(x, y), NONE);
      expect.soft(Math.abs((await under()) - before), `${list}: the toggle moved on folding`).toBeLessThanOrEqual(1);
      await step(`${list}: a section unfolds`, () => chrome.click(x, y), NONE);
      expect.soft(Math.abs((await under()) - before), `${list}: the toggle moved on unfolding`).toBeLessThanOrEqual(1);
      await step(`${list}: the pointer leaves after folding`, () => chrome.move(20, 300), NONE);
    });
  }

  it('a fold held under the pointer lets go in one ease once it leaves', async () => {
    await fresh(FITS_ALONE);
    await tool('Variants');
    const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
    const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
    await chrome.move(x, y);
    await chrome.eval('settle()');
    await step('fold under the pointer', () => chrome.click(x, y), NONE);
    await chrome.eval('record()');
    await chrome.move(20, 300);
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
    const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean }>('stop()');
    const result = motion(recorded, NONE);
    const count = stages(recorded.frames, 'variants top');
    note(`motion: fold let go: ${count} stage(s), jumps ${JSON.stringify(result.jumps)}`);
    expect.soft(result.jumps).toEqual([]);
    expect(count).toBe(1);
  });

  it('Feedback closing over a list that fits alone but scrolls beside it keeps the list in place', async () => {
    await fresh(FITS_ALONE);
    await tool('Variants');
    const body = `panel('variants').querySelector('.isotone-vars-body')`;
    expect(await chrome.eval<boolean>(`${body}.scrollHeight <= ${body}.clientHeight`), 'fits alone').toBe(true);
    await tool('Feedback');
    await pressEscape();
    expect(await chrome.eval<boolean>(`${body}.scrollHeight > ${body}.clientHeight + 40`), 'scrolls beside Feedback').toBe(true);
    await chrome.eval(`${body}.scrollTop = ${body}.scrollHeight`);
    const [x, y] = await chrome.eval<[number, number]>('face("Feedback")');
    await chrome.move(x, y);
    await chrome.eval('settle()');
    await step('scrolled to its end: Feedback closes', () => chrome.click(x, y), OPTIONS);
    await step('scrolled to its end: the pointer leaves', () => chrome.move(20, 300), OPTIONS);
  });

  it('a saved note opened for editing, and put back, with the pointer resting moves no row', async () => {
    const saved = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      route: '/',
      feedback: `Saved note ${i}${i % 3 ? '' : ', long enough to wrap onto a second line in the list and then some more'}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      done: false,
    }));
    await fresh(12, saved);
    await tool('Variants');
    await tool('Feedback');
    await pressEscape();
    const row = `[...panel('notes').querySelectorAll('.isotone-note-hit')].at(-1)`;
    const [x, y] = await chrome.eval<[number, number]>(`centre(${row})`);
    await chrome.move(x, y);
    await chrome.eval('settle()');
    const RESTING = /^(note |send$|option )/;
    await step('a note opens for editing', () => chrome.click(x, y), RESTING);
    expect(await chrome.eval<string>('panel("notes").querySelector("textarea").value')).toBe('Saved note 11');
    await step('the note is put back', pressEscape, RESTING);
    await step('the pointer leaves after editing', () => chrome.move(20, 300), NONE);
  });

  it('a finger folding a section is never held: the panel takes its new size in the same ease', async () => {
    await fresh(3, [], true);
    const [px, py] = await chrome.eval<[number, number]>('pill()');
    await chrome.tap(px, py);
    await chrome.eval('settle()');
    if (!(await chrome.eval<boolean>(`panel('variants')?.dataset.open === 'true'`))) {
      const [vx, vy] = await chrome.eval<[number, number]>('face("Variants")');
      await chrome.tap(vx, vy);
      await chrome.eval('settle()');
    }
    const height = () => chrome.eval<number>(`panel('variants').getBoundingClientRect().height`);
    const open = await height();
    const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
    const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
    await step('a finger folds a section', () => chrome.tap(x, y), NONE);
    const folded = await height();
    expect(await chrome.eval<string>(`panel('variants').style.getPropertyValue('--iso-variants-hold')`)).toBe('');
    expect(folded).toBeLessThan(open - 20);
    const [ux, uy] = await chrome.eval<[number, number]>(`centre(${toggle})`);
    await step('a finger unfolds it', () => chrome.tap(ux, uy), NONE);
    expect(Math.abs((await height()) - open)).toBeLessThanOrEqual(1);
  });

  it('a keyboard resize lands each step exactly', async () => {
    await fresh(12);
    await tool('Variants');
    await chrome.move(20, 300);
    const handle = `panel('variants').querySelector('[role=separator][aria-label^="Resize variants"]')`;
    await chrome.eval(`${handle}.focus()`);
    await chrome.key('ArrowDown', 'ArrowDown', 8); // shrink 64px first, so there is room to grow
    await chrome.eval('settle()');
    const heights = [await chrome.eval<number>(`panel('variants').getBoundingClientRect().height`)];
    for (let i = 0; i < 4; i++) {
      await chrome.key('ArrowUp', 'ArrowUp');
      heights.push(
        await chrome.eval<number>(`new Promise((r) => requestAnimationFrame(() => r(panel('variants').getBoundingClientRect().height)))`),
      );
    }
    const steps = heights.slice(1).map((h, i) => Math.round(h - (heights[i] as number)));
    note(`motion: keyboard resize steps ${JSON.stringify(steps)}`);
    expect(steps).toEqual([16, 16, 16, 16]);
  });

  it('panels restored by a reload, and what is in them, are at rest from the first frame', async () => {
    await fresh(12, [{ id: 'n1', route: '/', feedback: 'A saved note', createdAt: new Date().toISOString(), done: false }]);
    await tool('Variants');
    await tool('Feedback');
    await pressEscape();
    await chrome.move(20, 300);
    await chrome.goto('');
    const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean }>(`(async () => {
      await start(12);
      record();
      await new Promise((r) => setTimeout(r, 700));
      return stop();
    })()`);
    const result = motion(recorded, /./);
    note(`motion: restore: still ${result.still}px, eased ${result.eased}`);
    expect(recorded.frames.some((f) => 'feedback top' in f && 'variants top' in f)).toBe(true);
    expect(result.still).toBeLessThanOrEqual(1);
    expect(result.eased).toBe(false);
  });

  it('a long list never animates a size, and its options stay put as Feedback opens and closes', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `n${i}`,
      route: '/',
      feedback: `Note ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      done: false,
    }));
    await fresh(500, many);
    await tool('Variants');
    const opens = await through(() => tool('Feedback'), OPTIONS);
    note(`motion: 500 selectors: Feedback opens: still ${opens.still}px (${opens.moved}), eased ${opens.eased}`);
    expect(opens.eased).toBe(false);
    expect(opens.still).toBeLessThanOrEqual(1);
    await pressEscape();
    const closes = await through(() => tool('Feedback'), OPTIONS);
    note(`motion: 500 selectors: Feedback closes: still ${closes.still}px, eased ${closes.eased}`);
    expect(closes.eased).toBe(false);
    expect(closes.still).toBeLessThanOrEqual(1);
  });
});
