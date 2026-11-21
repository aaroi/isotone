/**
 * No sudden movement in the dock, sampled after every painted frame in headless Chrome:
 *
 * - controls that should stay where they are (Variants' options while Feedback opens, saves or closes;
 *   the section toggle under the pointer; Feedback's send button; everything a reload restores) move by
 *   no more than a pixel at any frame;
 * - anything that does move (a panel's edges, a panel sliding over) never covers most of its way between
 *   two frames;
 * - a keyboard resize step lands exactly; a long list (over `MAX_ANIMATED_ITEMS`) never animates a size;
 * - a size changes at once, in one ease, wherever the pointer is: no panel is ever kept at a size its
 *   content no longer needs.
 *
 * Every step also checks what must hold whatever the transition was (`sound()`): a list never reaches
 * past its panel, on any frame; once settled no panel has spare room; and taking the pointer off the
 * dock then changes no panel's size, so nothing waited for it. A new transition gets these for free by
 * going through `step`.
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
  let spill = 0;
  const sample = () => {
    if (!on) return;
    const f = { at: performance.now() };
    const r = root();
    eased ||= r.querySelector('.isotone-root').dataset.easing === 'true';
    spill = Math.max(spill, spilled());
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
    const tabs = r.querySelector('.isotone-notes-panel[data-open="true"] .isotone-pages');
    if (tabs) f.tabs = tabs.getBoundingClientRect().top;
    for (const [key, selector] of [['send', '.isotone-notes-panel[data-open="true"] .isotone-send'], ['field', '.isotone-notes-panel[data-open="true"] textarea']]) {
      const n = r.querySelector(selector);
      if (n) f[key] = n.getBoundingClientRect().top;
    }
    frames.push(f);
    requestAnimationFrame(() => setTimeout(sample));
  };
  sample();
  window.stop = () => { on = false; return { frames, eased, spill }; };
};
// How far a list reaches past its own open panel, in px. A list is clipped to its panel, so what reaches
// past it (its foot, its bottom edge, the end of its scroll) cannot be seen or reached. Variants' list
// fills its panel edge to edge. The note list is measured inside its padding, which overlaps the panel's
// own inset: squeezed to that padding as its panel opens, it shows nothing yet.
window.spilled = () => {
  let worst = 0;
  for (const p of root().querySelectorAll('.isotone-panel[data-open="true"]:not(.isotone-exit)')) {
    const box = p.getBoundingClientRect();
    for (const list of p.querySelectorAll('.isotone-vars-body, .isotone-list')) {
      const b = list.getBoundingClientRect();
      const style = getComputedStyle(list);
      const padded = list.classList.contains('isotone-list');
      // Variants' content riding its card's top edge is cut at the card's foot meanwhile: what shows counts.
      const cut = /^inset\\(\\S+ \\S+ (-?[\\d.]+)px/.exec(getComputedStyle(list.parentElement).clipPath);
      const top = b.top + (padded ? parseFloat(style.paddingTop) : 0);
      const bottom = b.bottom - (padded ? parseFloat(style.paddingBottom) : cut ? Number(cut[1]) : 0);
      // An empty note list is not rendered.
      if (bottom - top < 1) continue;
      const d = Math.max(box.top - top, bottom - box.bottom);
      if (d > worst) {
        worst = d;
        window.spillAt = list.className + ' ' + [top, bottom].map(Math.round) + ' in a panel at ' + [box.top, box.bottom].map(Math.round);
      }
    }
  }
  return Math.round(worst * 10) / 10;
};
// Whether the newest saved note shows in full: inside its list's own view and inside the panel.
window.newestShows = () => {
  const p = panel('notes');
  const list = p.querySelector('.isotone-list');
  const note = [...list.querySelectorAll('.isotone-note')].at(-1);
  const [box, view, row] = [p, list, note].map((n) => n.getBoundingClientRect());
  return row.top >= Math.max(box.top, view.top) - 1 && row.bottom <= Math.min(box.bottom, view.bottom) + 1;
};
// Room a settled panel shows that its content does not need, in px, by panel: after Variants' list, and
// above Feedback's parts, which stack from its foot. A panel is as tall as its content needs, so none.
window.spare = () => {
  const out = {};
  const v = panel('variants');
  if (v?.dataset.open === 'true') {
    const body = v.querySelector('.isotone-vars-body');
    const tail = body.querySelector(':scope > .isotone-vars-tail');
    // Room an open dialog or colour picker asked for is room it needs.
    out.variants = body.parentElement.style.getPropertyValue('--iso-menu-need')
      ? 0
      : tail.style.height
      ? 'room left in the tail: ' + tail.style.height
      : body.scrollHeight > body.clientHeight + 1
        ? 0
        : Math.round((body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) - tail.getBoundingClientRect().bottom) * 10) / 10;
  }
  const n = panel('notes');
  if (n?.dataset.open === 'true') {
    const inner = n.getBoundingClientRect().top + parseFloat(getComputedStyle(n).paddingTop);
    const tops = [...n.children].flatMap((child) => {
      const style = getComputedStyle(child);
      const box = child.getBoundingClientRect();
      return style.position === 'absolute' || !box.height ? [] : [box.top - parseFloat(style.marginTop)];
    });
    out.feedback = Math.round((Math.min(...tops) - inner) * 10) / 10;
  }
  return out;
};
window.heights = () => Object.fromEntries([...root().querySelectorAll('.isotone-panel[data-open="true"]:not(.isotone-exit)')].map((p) => [p.classList.contains('isotone-notes-panel') ? 'feedback' : 'variants', Math.round(p.getBoundingClientRect().height)]));
</script>`;

interface Motion {
  /** The largest step between two frames of anything that should have stayed put, and what moved. */
  still: number;
  moved?: string;
  /** Things that moved, each covering most of its way between two frames. */
  jumps: string[];
  /** Whether any height eased. */
  eased: boolean;
  /** The furthest a list reached past its panel on any frame, in px. */
  spill: number;
}

/** A gap between samples, in ms, past which a step says nothing about an ease of 180 ms. */
const SLOW_FRAME = 50;

/** Measure a recording: `stay` matches the keys that must not move; the rest may glide, never jump. */
function motion({ frames, eased, spill = 0 }: { frames: Record<string, number>[]; eased: boolean; spill?: number }, stay: RegExp): Motion {
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
  return { still: Math.round(still * 10) / 10, moved, jumps, eased, spill };
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

// A loaded CI runner starves the page's main thread, and an ease there can still finish in one frame;
// `ISOTONE_CPU_THROTTLE=6` reproduces it. Until eases hold up under load, a test that hits it runs again.
describe.skipIf(!binary)('No sudden movement in the dock (headless Chrome)', { retry: 2 }, () => {
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
  /**
   * One transition: what should stay moves under a pixel, and nothing jumps. `follows` matches what
   * changes with its own content at once, as a field does with its text, and so is no jump.
   */
  async function step(label: string, act: () => Promise<void>, stay: RegExp, follows?: RegExp) {
    const result = await through(act, stay);
    note(
      `motion: ${label}: still ${result.still}px${result.moved ? ` (${result.moved})` : ''}, jumps ${JSON.stringify(result.jumps)}, eased ${result.eased}`,
    );
    expect.soft(result.still, `${label}: what should stay moved`).toBeLessThanOrEqual(1);
    expect
      .soft(
        result.jumps.filter((jump) => !follows?.test(jump)),
        `${label}: jumps`,
      )
      .toEqual([]);
    await sound(label, result);
    return result;
  }
  /**
   * What holds after any transition (docs/design.md, Invariants): lists stayed inside their panels, no
   * panel has room its content does not need, and no size was waiting for the pointer to leave the dock.
   */
  async function sound(label: string, result: Motion) {
    const where = result.spill > 1 ? await chrome.eval<string>('window.spillAt') : '';
    expect.soft(result.spill, `${label}: a list reached past its panel (${where})`).toBeLessThanOrEqual(1);
    for (const [name, room] of Object.entries(await chrome.eval<Record<string, number | string>>('spare()')))
      expect.soft(room, `${label}: room ${name} does not need`).toBeLessThanOrEqual(1);
    const resting = await chrome.eval<Record<string, number>>('heights()');
    await chrome.move(20, 300);
    await chrome.eval('settle()');
    expect.soft(await chrome.eval('heights()'), `${label}: a size changed once the pointer left the dock`).toEqual(resting);
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
        // The first note has no list to scroll into, so Feedback grows to show it, pointer or not. In a dock
        // with room it grows upward and the send button stays; a full dock gives it room from Variants' top.
        count > FITS_ALONE ? OPTIONS : /^(option |send$)/,
      );
      expect.soft(await chrome.eval('newestShows()'), `${list}: the saved note shows`).toBe(true);
      // A fold is the reviewer's own change: Variants takes the size its sections need at once, in one
      // ease, under the pointer too, and unfolding brings back the size it had.
      const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
      const height = () => chrome.eval<number>(`panel('variants').getBoundingClientRect().height`);
      const open = await height();
      const click = async () => {
        const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
        await chrome.click(x, y);
      };
      await step(`${list}: a section folds`, click, NONE);
      expect.soft(await chrome.eval<string>(`${toggle}.getAttribute('aria-expanded')`)).toBe('false');
      await step(`${list}: a section unfolds`, click, NONE);
      expect.soft(Math.abs((await height()) - open), `${list}: the height after unfolding`).toBeLessThanOrEqual(1);
      await step(`${list}: the pointer leaves after folding`, () => chrome.move(20, 300), NONE);
    });
  }

  it('a fold under a resting pointer resizes Variants at once, in one ease, and holds nothing', async () => {
    await fresh(FITS_ALONE);
    await tool('Variants');
    const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
    const height = () => chrome.eval<number>(`panel('variants').getBoundingClientRect().height`);
    const open = await height();
    for (const [label, taller] of [
      ['a fold under the pointer', false],
      ['an unfold under the pointer', true],
    ] as const) {
      const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
      await chrome.move(x, y);
      await chrome.eval('settle()');
      await chrome.eval('record()');
      await chrome.click(x, y);
      await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
      const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean; spill: number }>('stop()');
      const result = motion(recorded, NONE);
      const count = stages(recorded.frames, 'variants top');
      note(`motion: ${label}: ${count} stage(s), jumps ${JSON.stringify(result.jumps)}`);
      expect.soft(result.jumps, label).toEqual([]);
      expect.soft(count, `${label}: eases`).toBe(1);
      await sound(label, result);
      if (taller) expect.soft(Math.abs((await height()) - open), label).toBeLessThanOrEqual(1);
      else expect.soft(await height(), label).toBeLessThan(open - 20);
    }
  });

  it('a fold by key eases like one by pointer: the section after it stays where it is', async () => {
    await fresh(FITS_ALONE);
    await tool('Variants');
    await chrome.move(20, 300);
    const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
    const height = () => chrome.eval<number>(`panel('variants').getBoundingClientRect().height`);
    const open = await height();
    await chrome.eval(`${toggle}.focus()`);
    const enter = () => chrome.key('Enter', 'Enter', 0, '\r');
    // The panel hangs from its foot, so the sections after the fold keep their place on screen. Swapped at
    // once while the height eased, they were carried off by the panel's top edge and brought back.
    const AFTER = /^option section Part [12]/;
    const folded = await step('a fold by key', enter, AFTER);
    expect.soft(folded.moved, 'a section after the fold was sampled').toBeDefined();
    const least = await height();
    expect.soft(least).toBeLessThan(open - 20);
    await step('an unfold by key', enter, AFTER);
    expect.soft(Math.abs((await height()) - open)).toBeLessThanOrEqual(1);
    // Folded and unfolded again before the fold has landed: the panel turns round where it is, rather
    // than running on to the folded height with the open list inside it.
    await chrome.eval('record()');
    await enter();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await enter();
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
    const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean; spill: number }>('stop()');
    const tops = recorded.frames.map((f) => f['variants top']).filter((top): top is number => top !== undefined);
    const travelled = Math.max(...tops) - (tops[0] as number);
    note(`motion: a fold undone mid-ease: travelled ${Math.round(travelled)}px of ${Math.round(open - least)}px`);
    expect.soft(travelled).toBeLessThan((open - least) * 0.9);
    expect.soft(Math.abs((await height()) - open)).toBeLessThanOrEqual(1);
    await sound('a fold undone mid-ease', motion(recorded, NONE));
  });

  it('a page tab undone mid-ease turns Feedback round where it is', async () => {
    const on = (id: string, route = '/pricing') => ({
      id,
      route,
      feedback: `Note ${id}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      done: false,
    });
    // Tabs show once notes sit on more than one other page.
    await fresh(3, [...['a', 'b', 'c', 'd'].map((id) => on(id)), on('e', '/settings')]);
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    const height = () => chrome.eval<number>(`panel('notes').getBoundingClientRect().height`);
    const empty = await height();
    // The tab rides the panel's top edge, away from a pointer that pressed it: pressed here without one, so
    // the second press lands on it mid-ease.
    const tab = () => chrome.eval(`panel('notes').querySelectorAll('.isotone-page')[1].click()`);
    await tab();
    await chrome.eval('settle()');
    const full = await height();
    expect(full).toBeGreaterThan(empty + 80);
    await tab();
    await chrome.eval('settle()');
    // On, and off again 60ms later.
    await chrome.eval('record()');
    await tab();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await tab();
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
    const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean; spill: number }>('stop()');
    expect.soft(await chrome.eval(`panel('notes').querySelectorAll('.isotone-note').length`)).toBe(0);
    const tops = recorded.frames.map((f) => f['feedback top']).filter((top): top is number => top !== undefined);
    const travelled = (tops[0] as number) - Math.min(...tops);
    note(`motion: a tab undone mid-ease: travelled ${Math.round(travelled)}px of ${Math.round(full - empty)}px`);
    expect.soft(travelled).toBeLessThan((full - empty) * 0.9);
    expect.soft(Math.abs((await height()) - empty)).toBeLessThanOrEqual(1);
    await sound('a tab undone mid-ease', motion(recorded, NONE));
  });

  it('a note sent with a click on Send, the pointer left there, glides the rows above it and shows at once', async () => {
    const saved = Array.from({ length: 2 }, (_, i) => ({
      id: `n${i}`,
      route: '/',
      feedback: `Saved note ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      done: false,
    }));
    await fresh(3, saved);
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    await chrome.insertText('A third note');
    const [x, y] = await chrome.eval<[number, number]>(`centre(panel('notes').querySelector('.isotone-send'))`);
    // Feedback grows upward from its foot: Send stays under the pointer, and the rows ride its top edge
    // rather than hopping a row up to make room.
    await step(
      'a note sent by click',
      async () => {
        await chrome.click(x, y);
        await chrome.eval(
          `(async () => { for (let i = 0; i < 50 && root().querySelectorAll('.isotone-note').length < 3; i++) await new Promise((r) => setTimeout(r, 20)); })()`,
        );
      },
      /^send$/,
    );
    expect.soft(await chrome.eval('newestShows()')).toBe(true);
  });

  it('a note removed keeps the rows to the edge that stays: gliding in a dock with room, still in a full one', async () => {
    const saved = Array.from({ length: 3 }, (_, i) => ({
      id: `n${i}`,
      route: '/',
      feedback: `Saved note ${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      done: false,
    }));
    const remove = async () => {
      const row = `[...panel('notes').querySelectorAll('.isotone-note')].at(-1)`;
      const [rx, ry] = await chrome.eval<[number, number]>(`centre(${row})`);
      await chrome.move(rx, ry);
      await chrome.eval('settle()');
      const [x, y] = await chrome.eval<[number, number]>(`centre(${row}.querySelector('.isotone-x'))`);
      await chrome.click(x, y);
    };
    // With room, Feedback's foot stays: the rows left ride down with its top edge, and none jumps.
    await fresh(
      3,
      saved.map((n) => ({ ...n })),
    );
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    await step('the newest note is removed, in a dock with room', remove, /^send$/);
    // In a full dock its top stays, and Variants takes the room at its foot: no row moves at all.
    await fresh(
      12,
      saved.map((n) => ({ ...n })),
    );
    await tool('Variants');
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    await step('the newest note is removed, in a full dock', remove, /^(note |option )/);
  });

  it("a selector's dialog opening and closing in a short panel keeps the selectors and itself on the panel's top edge", async () => {
    // One selector: a panel shorter than its dialog.
    await fresh(1);
    await tool('Variants');
    const height = () => chrome.eval<number>(`panel('variants').getBoundingClientRect().height`);
    const short = await height();
    // After every frame: how far the first selector strays from its place under the panel's top edge, how
    // far the dialog shows outside the card (it is cut by its container's box, which ends at the card's
    // foot), and whether anything that has to stay with the card's edge is moved by a transform. The
    // card's height is laid out on the main thread and a transform runs on the compositor's clock: in a
    // real browser the two drift apart mid-ease, which no frame sampled here can show.
    await chrome.eval(`window.ride = () => {
      const p = panel('variants');
      const head = p.querySelector('.isotone-axis');
      const offset = () => head.getBoundingClientRect().top - p.getBoundingClientRect().top;
      const base = offset();
      const worst = { strayed: 0, outside: 0, transformed: [] };
      let on = true;
      const sample = () => {
        if (!on) return;
        worst.strayed = Math.max(worst.strayed, Math.abs(offset() - base));
        const card = p.getBoundingClientRect();
        const menu = p.querySelector('.isotone-axis-menu');
        if (menu && getComputedStyle(menu).opacity > 0.05) {
          const box = menu.getBoundingClientRect();
          const clip = menu.parentElement.getBoundingClientRect();
          worst.outside = Math.max(worst.outside, card.top - Math.max(box.top, clip.top), Math.min(box.bottom, clip.bottom) - card.bottom);
        }
        if (p.getAnimations().some((a) => a.playState === 'running'))
          for (const a of p.getAnimations({ subtree: true }))
            if (!(a instanceof CSSTransition) && a.effect.target.closest('.isotone-vars') && a.effect.getKeyframes().some((k) => 'transform' in k || 'translate' in k) && !a.effect.target.closest('.isotone-axis-menu, .isotone-section-body, [data-motion-key]'))
              worst.transformed.push(a.effect.target.className);
        requestAnimationFrame(() => setTimeout(sample));
      };
      sample();
      window.rode = () => { on = false; return worst; };
    }`);
    const check = async (label: string) => {
      const rode = await chrome.eval<{ strayed: number; outside: number; transformed: string[] }>('rode()');
      note(`motion: ${label}: selectors strayed ${rode.strayed.toFixed(1)}px, dialog outside the panel ${rode.outside.toFixed(1)}px`);
      expect.soft(rode.strayed, `${label}: the selectors left the top edge`).toBeLessThanOrEqual(1);
      expect.soft(rode.outside, `${label}: the dialog showed outside the panel`).toBeLessThanOrEqual(1);
      expect.soft(rode.transformed, `${label}: moved with the card's edge by transform`).toEqual([]);
    };
    const opener = `panel('variants').querySelector('.isotone-axis-head button')`;
    const [x, y] = await chrome.eval<[number, number]>(`centre(${opener})`);
    await chrome.eval('ride()');
    const opened = await step('a dialog opens in a short panel', () => chrome.click(x, y), NONE);
    expect.soft(opened.eased, 'the panel eased taller').toBe(true);
    const tall = await height();
    expect.soft(tall).toBeGreaterThan(short + 40);
    await check('a dialog opens in a short panel');
    // Placed by where its opener rests, under it, not where the opener was passing mid-ease.
    expect
      .soft(
        await chrome.eval<boolean>(
          `panel('variants').querySelector('.isotone-axis-menu').getBoundingClientRect().top >= ${opener}.getBoundingClientRect().bottom - 1`,
        ),
        'the dialog sits under its opener',
      )
      .toBe(true);
    const close = `panel('variants').querySelector('.isotone-axis-menu [aria-label="Close selector actions"]')`;
    const [cx, cy] = await chrome.eval<[number, number]>(`centre(${close})`);
    await chrome.move(cx, cy);
    await chrome.eval('settle()');
    await chrome.eval('ride()');
    // The panel starts back as the dialog fades, rather than standing tall and empty until the fade ends.
    await chrome.eval('record()');
    await chrome.click(cx, cy);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const during = await height();
    expect.soft(during, 'the panel is on its way back while the dialog fades').toBeLessThan(tall - 20);
    await chrome.eval('settle().then(() => new Promise((r) => setTimeout(r, 300)))');
    const recorded = await chrome.eval<{ frames: Record<string, number>[]; eased: boolean; spill: number }>('stop()');
    expect.soft(stages(recorded.frames, 'variants top'), 'the panel closes in one ease').toBe(1);
    expect.soft(Math.abs((await height()) - short)).toBeLessThanOrEqual(1);
    note(`motion: a dialog closes in a short panel: ${Math.round(during)}px tall 80ms in, of ${Math.round(short)}px`);
    await check('a dialog closes in a short panel');
    await sound('a dialog closes in a short panel', motion(recorded, NONE));
  });

  it('a fold that takes out more than a short panel is tall keeps the list inside it', async () => {
    await fresh(12);
    // A short window: the list scrolls, and each of its three sections is taller than the panel.
    await chrome.viewport(1024, 420);
    await chrome.eval('settle()');
    await tool('Variants');
    const toggle = `panel('variants').querySelector('.isotone-section-toggle')`;
    for (const label of ['a tall section folds in a short panel', 'and unfolds']) {
      const [x, y] = await chrome.eval<[number, number]>(`centre(${toggle})`);
      await step(label, () => chrome.click(x, y), NONE);
    }
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

  it('a saved note opened for editing, and put back, with the pointer resting moves no row and holds no size', async () => {
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
    // The dock is full, so Feedback grows downward into room Variants gives from its top: every row and
    // every option stays, and the card's foot glides. The field and Send follow the field's text at once.
    const RESTING = /^(note |option )/;
    const COMPOSER = /^(send|field) /;
    await step('a note opens for editing', () => chrome.click(x, y), RESTING, COMPOSER);
    expect(await chrome.eval<string>('panel("notes").querySelector("textarea").value')).toBe('Saved note 11');
    await step('the note is put back', pressEscape, RESTING, COMPOSER);
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
    expect(folded).toBeLessThan(open - 20);
    const [ux, uy] = await chrome.eval<[number, number]>(`centre(${toggle})`);
    await step('a finger unfolds it', () => chrome.tap(ux, uy), NONE);
    expect(Math.abs((await height()) - open)).toBeLessThanOrEqual(1);
  });

  it("a saved note's tag is as wide as its label, and only a long one keeps a floor when squeezed", async () => {
    const pinned = (id: string, text: string, feedback: string) => ({
      id,
      route: '/',
      feedback,
      element: { selector: `#${id}`, tag: 'th', text },
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      done: false,
    });
    await fresh(3, [
      pinned('a', 'Due', 'Short'),
      pinned('b', 'All connected', 'Short'),
      pinned('c', 'A long heading pinned on the page', 'A note long enough to squeeze its tag, and then some more words after that'),
    ]);
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    // Each tag's width, and the width its label and padding need.
    const tags = await chrome.eval<
      [string, number, number][]
    >(`[...panel('notes').querySelectorAll('.isotone-meta .isotone-chip')].map((chip) => {
      const label = chip.firstElementChild;
      const style = getComputedStyle(chip);
      return [label.textContent, chip.getBoundingClientRect().width, label.scrollWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)];
    })`);
    expect(tags.map(([label]) => label)).toEqual(['Due', 'All connected', 'A long heading pinned on the page']);
    // A short label was padded out to the floor a squeezed one keeps.
    for (const [label, width, needs] of tags.slice(0, 2)) expect(width, label).toBeLessThanOrEqual(needs + 1);
    const [, squeezed, needs] = tags[2] as [string, number, number];
    expect(squeezed).toBeLessThan(needs);
    expect(squeezed).toBeGreaterThanOrEqual(52);
  });

  it('page tabs in Feedback, with the pointer resting on them, size the panel each time, down to no notes', async () => {
    const on = (id: string, route: string) => ({
      id,
      route,
      feedback: `A note on ${route}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      done: false,
    });
    await fresh(3, [on('a', '/pricing'), on('b', '/pricing'), on('c', '/settings')]);
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    const height = () => chrome.eval<number>(`panel('notes').getBoundingClientRect().height`);
    const empty = await height();
    const tab = (index: number) => async () => {
      const [x, y] = await chrome.eval<[number, number]>(`centre(panel('notes').querySelectorAll('.isotone-page')[${index}])`);
      await chrome.click(x, y);
    };
    // Each tab adds or takes away a page's notes. The pointer stays on the tabs throughout: `step` checks
    // no size waits for it to leave. Rows are swapped at once; the card around them eases.
    const ROWS = /^note /;
    await step('a page with two notes is added', tab(1), NONE, ROWS);
    expect.soft(await height()).toBeGreaterThan(empty + 40);
    await step('a page with one note is added', tab(2), NONE, ROWS);
    await step('the first is taken away', tab(1), NONE, ROWS);
    await step('the second too, leaving this page, which has none', tab(2), NONE, ROWS);
    expect.soft(await chrome.eval(`panel('notes').querySelectorAll('.isotone-note').length`)).toBe(0);
    expect.soft(Math.abs((await height()) - empty)).toBeLessThanOrEqual(1);
  });

  it("a resize handle's cursor promises only what a drag can do", async () => {
    await fresh(3);
    await tool('Variants');
    const cursor = (label: string) =>
      chrome.eval<string>(`getComputedStyle(root().querySelector('[role=separator][aria-label^="${label}"]')).cursor`);
    // All of a short list shows: its top edge can come down, and has nowhere to go up to.
    expect(await cursor('Resize variants height')).toBe('s-resize');
    expect(await cursor('Resize panel width')).toBe('ew-resize');
    await tool('Feedback');
    await pressEscape();
    await chrome.eval('settle()');
    // Feedback with no notes shows all it has and has nothing to give up: its edge does not move, and says so.
    expect(await cursor('Resize feedback height')).toBe('default');
    // Measured once the opening ease landed, with no pointer on a handle to ask for it.
    expect(
      await chrome.eval(`root().querySelector('[role=separator][aria-label^="Resize feedback height"]').getAttribute('aria-valuenow')`),
    ).toBe(String(await chrome.eval<number>(`Math.round(panel('notes').getBoundingClientRect().height)`)));
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
