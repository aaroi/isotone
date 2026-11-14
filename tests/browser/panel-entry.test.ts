/**
 * Getting into the panel, in headless Chrome: what the reviewer types right
 * after opening is kept, the panels come back after a reload, and opening,
 * writing in and closing Feedback never moves a Variants control. jsdom has no
 * layout, focus timing or text insertion without key events, so these drive
 * the built panel with real input.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBundle } from '../../src/node/bundle';
import { type Chrome, findChrome, launchChrome } from '../helpers/chrome';

const binary = findChrome();
if (!binary && process.env.CI) throw new Error('CI needs Chrome for the layout tests: install it or set CHROME.');

// `start(count, { notice, theme })` mounts the panel with `count` selectors and a notes endpoint;
// `notice` gives the source the note a source leaves for a ?v= it did not apply.
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0;height:100vh;background:#f4f4f5">
<a id="link" href="#elsewhere" style="position:absolute;left:40px;top:40px">A link on the page</a>
<script src="/isotone.js"></script>
<script>
window.start = async (count, { notice = false, theme = 'light' } = {}) => {
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
    ...(notice ? { getNotice: () => ({ text: 'Link picks aren’t applied here', detail: 'This link asks for Part 0 › Selector 0: Bold. Here every tab shows the same picks, so a link can’t choose them. Pick it below instead.' }) } : {}),
  };
  window.__isotone.mount({ variants: source, endpoint: '/notes', theme, compareShortcut: false });
  for (let tries = 0; !root()?.querySelector('.isotone-rail-track') && tries < 100; tries++) await frame();
  await settle();
};
const root = () => document.querySelector('[data-isotone="root"]')?.shadowRoot;
window.root = root;
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
window.settle = async () => {
  await frame();
  for (let tries = 0; tries < 50; tries++) {
    const running = root().getAnimations().filter((animation) => animation.timeline === document.timeline && animation.playState === 'running');
    if (!running.length) break;
    await Promise.race([Promise.all(running.map((animation) => animation.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
  await frame();
  await frame();
};
window.dock = () => root().querySelector('.isotone-root');
window.panel = (name) => root().querySelector('.isotone-' + name + '-panel');
window.isOpen = (name) => panel(name).dataset.open === 'true';
window.selecting = () => root().querySelector('[aria-label="Select elements"]').getAttribute('aria-pressed') === 'true';
window.field = () => root().querySelector('textarea');
window.centre = (node) => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
window.pill = () => centre(root().querySelector('.isotone-rail-track'));
// A tool's face on the pill, once the pointer over the pill has unfolded it.
window.face = (name) => centre(root().querySelector('.isotone-rail-button[aria-label^="' + name + '"]'));
// Where each Variants option sits on screen, by index, leaving out those within reach of the list's
// scroll edges, where rows recede and dissolve by design as they pass under them.
window.controls = () => {
  const view = panel('variants').querySelector('.isotone-vars-body').getBoundingClientRect();
  return Object.fromEntries([...panel('variants').querySelectorAll('[role=radio]')].flatMap((node, i) => {
    const r = node.getBoundingClientRect();
    return r.top > view.top + 48 && r.bottom < view.bottom - 48 ? [[i, [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10]]] : [];
  }));
};
// The options in view before and after, where they were before; and how many.
window.kept = (before) => {
  const now = controls();
  const both = Object.keys(before).filter((i) => i in now);
  return { count: both.length, moved: both.filter((i) => before[i].join() !== now[i].join()).map((i) => [i, before[i], now[i]]) };
};
// The furthest any Variants option in view strays from where it was, sampled after every frame's paint
// until unwatched. (Read inside the frame, before the panel's resize observer has run, it would see a
// layout no frame paints.)
window.watch = () => {
  const base = controls();
  let worst = 0;
  let on = true;
  const sample = () => {
    if (!on) return;
    const now = controls();
    for (const i of Object.keys(base)) if (i in now) worst = Math.max(worst, Math.abs(now[i][1] - base[i][1]));
    requestAnimationFrame(() => setTimeout(sample));
  };
  requestAnimationFrame(() => setTimeout(sample));
  window.unwatch = () => { on = false; return worst; };
};
</script>`;

// Its motion checks share dock-motion's limit: a starved CI runner can finish an ease in one frame
// (`ISOTONE_CPU_THROTTLE=6` reproduces it), so a test that hits it runs again.
describe.skipIf(!binary)('Getting into the panel (headless Chrome)', { retry: 2 }, () => {
  let server: Server;
  let origin = '';
  let chrome: Chrome;
  let notes: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const bundle = readBundle();
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

  /** Hover the pill so it unfolds, then click a tool's face, as a mouse would. */
  async function tool(name: 'Variants' | 'Feedback') {
    const [px, py] = await chrome.eval<[number, number]>('pill()');
    await chrome.move(px, py);
    await chrome.eval('settle()');
    const [x, y] = await chrome.eval<[number, number]>(`face(${JSON.stringify(name)})`);
    await chrome.click(x, y);
    await chrome.eval('settle()');
  }
  async function start(count: number, options: Record<string, unknown> = {}) {
    await chrome.eval(`start(${count}, ${JSON.stringify(options)})`);
  }
  /** A fresh tab's worth of state: no notes, nothing remembered. */
  async function fresh(width: number, height: number, mobile = false) {
    notes = [];
    await chrome.viewport(width, height, mobile);
    await chrome.goto(`${origin}/`);
    await chrome.eval('sessionStorage.clear(); localStorage.clear()');
    await chrome.goto(`${origin}/`);
  }
  const SHORTCUT = { key: '.', code: 'Period', modifiers: process.platform === 'darwin' ? 4 | 8 : 2 | 8 };
  const shortcut = () => chrome.key(SHORTCUT.key, SHORTCUT.code, SHORTCUT.modifiers);

  it('keeps text inserted right after the shortcut, and ends selecting with it', async () => {
    await fresh(1024, 768);
    await start(3);
    await shortcut();
    // No wait: text arriving during the panel's entrance has to land too.
    await chrome.insertText('Bigger');
    expect(await chrome.eval('field().value')).toBe('Bigger');
    expect(await chrome.eval('selecting()')).toBe(false);
    expect(await chrome.eval('isOpen("notes")')).toBe(true);
  });

  it('keeps keys typed right after the shortcut', async () => {
    await fresh(1024, 768);
    await start(3);
    await shortcut();
    for (const letter of 'Gap') await chrome.key(letter, `Key${letter.toUpperCase()}`, 0, letter);
    expect(await chrome.eval('field().value')).toBe('Gap');
    expect(await chrome.eval('selecting()')).toBe(false);
  });

  it('opens Feedback from its face in select mode, with the caret waiting for what is typed', async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Feedback');
    expect(await chrome.eval('isOpen("notes")')).toBe(true);
    expect(await chrome.eval('selecting()')).toBe(true);
    await chrome.insertText('Tighter');
    expect(await chrome.eval('field().value')).toBe('Tighter');
    expect(await chrome.eval('selecting()')).toBe(false);
  });

  it('leaves no ring on a face after Escape closes a dock opened by pointer, and returns focus after a key', async () => {
    await fresh(1024, 768);
    await start(3);
    const ringed = `Boolean(root().querySelector(':focus-visible'))`;
    await tool('Feedback');
    await chrome.key('Escape', 'Escape');
    await chrome.key('Escape', 'Escape');
    await chrome.eval('settle()');
    expect(await chrome.eval('isOpen("notes")')).toBe(false);
    expect(await chrome.eval(ringed)).toBe(false);
    expect(await chrome.eval(`root().querySelector('.isotone-root').dataset.expanded`)).toBe('false');
    await chrome.move(20, 300);
    await shortcut();
    await chrome.key('Escape', 'Escape');
    await chrome.key('Escape', 'Escape');
    await chrome.eval('settle()');
    expect(await chrome.eval(`root().activeElement?.matches('.isotone-fab, .isotone-rail-button')`)).toBe(true);
  });

  it('ends selecting on a pick in Variants, so the next page click follows the link', async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Variants');
    await shortcut();
    expect(await chrome.eval('selecting()')).toBe(true);
    const [x, y] = await chrome.eval<[number, number]>(`centre([...panel('variants').querySelectorAll('[role=radio]')][1])`);
    await chrome.click(x, y);
    await chrome.eval('settle()');
    expect(await chrome.eval('selecting()')).toBe(false);
    const [lx, ly] = await chrome.eval<[number, number]>(`centre(document.getElementById('link'))`);
    await chrome.click(lx, ly);
    expect(await chrome.eval('location.hash')).toBe('#elsewhere');
  });

  it('keeps selecting while Shift+Tab takes focus from the field to the page, where Space pins', async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Variants');
    await shortcut();
    expect(await chrome.eval('selecting()')).toBe(true);
    for (let i = 0; i < 30 && !(await chrome.eval<boolean>(`document.activeElement?.id === 'link'`)); i++)
      await chrome.key('Tab', 'Tab', 8);
    expect(await chrome.eval(`document.activeElement?.id`)).toBe('link');
    expect(await chrome.eval('selecting()')).toBe(true);
    await chrome.key(' ', 'Space', 0, ' ');
    await chrome.eval('settle()');
    expect(await chrome.eval(`root().querySelectorAll('.isotone-chip').length`)).toBe(1);
    expect(await chrome.eval('selecting()')).toBe(true);
  });

  it('comes back after a reload with the panels that were open, in place and where the list was, not selecting', async () => {
    await fresh(1024, 768);
    await start(12);
    await tool('Variants');
    await shortcut();
    const body = `panel('variants').querySelector('.isotone-vars-body')`;
    await chrome.eval(`${body}.scrollTop = 150; settle()`);
    const at = `panel('variants').querySelectorAll('[role=radio]')[18].getBoundingClientRect().top`;
    const before = await chrome.eval<number>(at);
    await chrome.goto('');
    await start(12);
    expect(await chrome.eval('isOpen("variants")')).toBe(true);
    expect(await chrome.eval('isOpen("notes")')).toBe(true);
    expect(await chrome.eval('selecting()')).toBe(false);
    // The selector that was under the pointer is where it was.
    expect(await chrome.eval<number>(at)).toBeCloseTo(before, 0);
    // A new visit to the page, rather than a reload, starts folded.
    await chrome.goto(`${origin}/`);
    await start(12);
    expect(await chrome.eval('isOpen("variants")')).toBe(false);
  });

  it('shows panels restored by a reload, and what is in them, at rest, with no entrance', async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Feedback');
    await chrome.insertText('A saved note');
    await chrome.key('Enter', 'Enter', 0, '\r');
    await chrome.eval('settle()');
    await tool('Variants');
    await chrome.goto('');
    // Every clock-driven animation in the dock, sampled each frame while it mounts and its notes load.
    const moving = await chrome.eval<string[]>(`(async () => {
      const seen = new Set();
      let on = true;
      const sample = () => {
        if (!on || !root()) return requestAnimationFrame(sample);
        for (const a of root().getAnimations()) if (a.timeline === document.timeline && a.effect?.target) seen.add(a.effect.target.className || a.effect.target.tagName);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      await start(3);
      await new Promise((r) => setTimeout(r, 600));
      on = false;
      return [root().querySelectorAll('.isotone-note').length, ...seen];
    })()`);
    expect(moving).toEqual([1]);
  });

  // Opening Feedback, sending a note (the list grows by a row) and closing it again.
  async function expectVariantsSteady() {
    const before = await chrome.eval<object>('controls()');
    const kept = async () => {
      const result = await chrome.eval<{ count: number; moved: unknown[] }>(`kept(${JSON.stringify(before)})`);
      expect(result.count).toBeGreaterThan(2);
      expect(result.moved).toEqual([]);
    };
    await chrome.eval('watch()');
    await tool('Feedback');
    await kept();
    await chrome.insertText('Make the gap smaller');
    await chrome.key('Enter', 'Enter', 0, '\r');
    await chrome.eval('settle()');
    await chrome.eval(
      `(async () => { for (let i = 0; i < 50 && !root().querySelector('.isotone-note'); i++) await new Promise((r) => setTimeout(r, 20)); await settle(); })()`,
    );
    expect(await chrome.eval('root().querySelectorAll(".isotone-note").length')).toBe(1);
    await kept();
    await tool('Feedback');
    expect(await chrome.eval('isOpen("notes")')).toBe(false);
    await kept();
    expect(await chrome.eval<number>('unwatch()')).toBeLessThanOrEqual(0.5);
  }

  it('moves no Variants control as Feedback opens, grows with a note and closes, in a short list', async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Variants');
    await expectVariantsSteady();
  });

  it('moves no Variants control in a long list that gives Feedback room from its top', async () => {
    await fresh(1024, 768);
    await start(12);
    await tool('Variants');
    // Scrolled a little, so giving room back can scroll back rather than move anything.
    await chrome.eval('panel("variants").querySelector(".isotone-vars-body").scrollTop = 60; settle()');
    expect(await chrome.eval('panel("variants").querySelector(".isotone-vars-body").scrollHeight > 700')).toBe(true);
    await expectVariantsSteady();
  });

  it('moves no Variants control when Feedback, open before it, closes over a list at its top', async () => {
    await fresh(1024, 768);
    await start(12);
    await tool('Feedback');
    await tool('Variants');
    expect(await chrome.eval('panel("variants").querySelector(".isotone-vars-body").scrollTop')).toBe(0);
    const before = await chrome.eval<object>('controls()');
    await chrome.eval('watch()');
    await tool('Feedback');
    expect(await chrome.eval('isOpen("notes")')).toBe(false);
    const result = await chrome.eval<{ count: number; moved: unknown[] }>(`kept(${JSON.stringify(before)})`);
    expect(result.count).toBeGreaterThan(2);
    expect(result.moved).toEqual([]);
    expect(await chrome.eval<number>('unwatch()')).toBeLessThanOrEqual(0.5);
    // With the pointer gone from the dock, the list takes the room back.
    const height = await chrome.eval<number>('panel("variants").offsetHeight');
    await chrome.move(20, 300);
    await chrome.eval('settle()');
    expect(await chrome.eval<number>('panel("variants").offsetHeight')).toBeGreaterThan(height);
  });

  it('lets a keyboard close and a keyboard resize size Variants, with no height held', async () => {
    await fresh(1024, 768);
    await start(12);
    await tool('Feedback');
    await tool('Variants');
    const hold = `panel('variants').style.getPropertyValue('--iso-variants-hold')`;
    // Closed by pointer, the height is held; taking up the resize handle by key lets it go.
    await tool('Feedback');
    expect(await chrome.eval(hold)).not.toBe('');
    await chrome.eval(`panel('variants').querySelector('[role=separator][aria-label^="Resize variants"]').focus()`);
    expect(await chrome.eval(hold)).toBe('');
    // Closed from the keyboard, with the pointer away, nothing is held, and arrows resize.
    await tool('Feedback');
    await chrome.key('Escape', 'Escape'); // select mode
    await chrome.move(20, 300);
    await chrome.eval(`root().querySelector('.isotone-rail-button[aria-label^="Feedback"]').focus()`);
    await chrome.key('Enter', 'Enter', 0, '\r');
    await chrome.eval('settle()');
    expect(await chrome.eval('isOpen("notes")')).toBe(false);
    expect(await chrome.eval(hold)).toBe('');
    const height = await chrome.eval<number>('panel("variants").offsetHeight');
    await chrome.eval(`panel('variants').querySelector('[role=separator][aria-label^="Resize variants"]').focus()`);
    await chrome.key('ArrowDown', 'ArrowDown');
    await chrome.eval('settle()');
    expect(await chrome.eval<number>('panel("variants").offsetHeight')).toBeLessThan(height);
  });

  it("brings back a new visit's own panels on reload, not an earlier page's", async () => {
    await fresh(1024, 768);
    await start(3);
    await tool('Variants');
    await chrome.goto(`${origin}/?v=selector0:b`);
    await start(3, { notice: true });
    expect(await chrome.eval('isOpen("variants")')).toBe(false);
    await chrome.goto('');
    await start(3, { notice: true });
    expect(await chrome.eval('isOpen("variants")')).toBe(false);
  });

  it.each([
    [1024, 768, false],
    [375, 812, true],
  ])('explains a notice over the selectors on hover and focus at %ipx, moving none of them', async (width, height, mobile) => {
    await fresh(width, height, mobile);
    await start(3, { notice: true });
    await tool('Variants');
    const line = `panel('variants').querySelector('.isotone-notice-line')`;
    const detail = `panel('variants').querySelector('.isotone-notice-detail')`;
    const shown = () => chrome.eval<string>(`getComputedStyle(${detail}).visibility`);
    // One quiet line, whole, nothing else by the pill.
    expect(await chrome.eval(`${line}.textContent`)).toBe('Link picks aren’t applied here');
    expect(await chrome.eval(`${line}.getBoundingClientRect().height < 24 && ${line}.scrollWidth <= ${line}.clientWidth`)).toBe(true);
    expect(await chrome.eval(`root().querySelector('.isotone-notices').textContent`)).toBe('');
    expect(await shown()).toBe('hidden');
    const before = await chrome.eval<object>('controls()');
    // Hover reveals it over the selectors.
    const [x, y] = await chrome.eval<[number, number]>(`centre(${line})`);
    await chrome.move(x, y);
    await chrome.eval('settle()');
    expect(await shown()).toBe('visible');
    const result = await chrome.eval<{ count: number; moved: unknown[] }>(`kept(${JSON.stringify(before)})`);
    expect(result.moved).toEqual([]);
    const fits = await chrome.eval<boolean>(
      `(() => { const r = ${detail}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`,
    );
    expect(fits).toBe(true);
    // Away it goes; keyboard focus brings it back.
    await chrome.move(20, 300);
    await chrome.eval('settle()');
    expect(await shown()).toBe('hidden');
    await chrome.eval(`${line}.focus()`);
    await chrome.eval('settle()');
    expect(await shown()).toBe('visible');
  });
});
