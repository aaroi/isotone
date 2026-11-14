/**
 * The Variants panel's controls stay put while the defaults bar comes and goes.
 *
 * The panel is anchored to the bottom of the viewport, so anything that changes
 * its height moves every selector. The bar used to grow a short list by its own
 * height on the first pick and shrink it on the return to Default, and reviewers
 * clicked the selector that had just moved under the pointer. jsdom has no
 * layout, so this measures the built panel in headless Chrome.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBundle } from '../../src/node/bundle';
import { type Chrome, findChrome, launchChrome } from '../helpers/chrome';

const binary = findChrome();
if (!binary && process.env.CI) throw new Error('CI needs Chrome for the layout tests: install it or set CHROME.');

// A page with `count` three-option selectors, each in its own section so the
// list has section headers like a real one; `open()` mounts and opens Variants.
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
  const emit = () => listeners.forEach((listener) => listener());
  const source = {
    getAxes: () => axes,
    getSelections: () => selections,
    setSelection(id, value) { selections = { ...selections, [id]: value }; emit(); },
    reset() { selections = {}; emit(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    saveDefaults() { window.saves++; },
  };
  window.saves = 0;
  window.__isotone.mount({ variants: source, theme: 'light', compareShortcut: false });
  let button;
  for (let tries = 0; !button && tries < 100; tries++) {
    await frame();
    button = root()?.querySelector('button[aria-label="Variants"]');
  }
  button.click();
  await settle();
};
const root = () => document.querySelector('[data-isotone="root"]')?.shadowRoot;
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
// Wait out every transition and clock-driven animation (scroll-driven ones never finish), then a frame more.
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
window.panel = () => root().querySelector('.isotone-variants-panel');
window.body = () => root().querySelector('.isotone-vars-body');
// Where every control in the panel sits, to the tenth of a pixel.
window.layout = () =>
  [panel(), ...panel().querySelectorAll('[role=radio], .isotone-section-toggle')].map((node) => {
    const rect = node.getBoundingClientRect();
    return [Math.round(rect.left * 10) / 10, Math.round(rect.top * 10) / 10];
  });
// The centre of an option, by selector index and option label.
window.option = (index, label) => {
  const axis = panel().querySelectorAll('.isotone-axis')[index];
  const radio = [...axis.querySelectorAll('[role=radio]')].find((node) => node.textContent.trim() === label);
  const rect = radio.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
};
window.barShown = () => root().querySelector('.isotone-vars > .isotone-panel-head').dataset.shown === 'true';
</script>`;

describe.skipIf(!binary)('Variants controls stay put (headless Chrome)', () => {
  let server: Server;
  let origin = '';
  let chrome: Chrome;

  beforeAll(async () => {
    const bundle = readBundle();
    server = createServer((req, res) => {
      const script = req.url === '/isotone.js';
      res.writeHead(200, { 'content-type': script ? 'text/javascript' : 'text/html' });
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

  async function open(width: number, height: number, count: number, mobile = false) {
    await chrome.viewport(width, height, mobile);
    await chrome.goto(`${origin}/`);
    await chrome.eval(`start(${count})`);
  }
  const layout = () => chrome.eval<number[][]>('layout()');
  async function pick(index: number, label: string) {
    const [x, y] = await chrome.eval<[number, number]>(`option(${index}, ${JSON.stringify(label)})`);
    await chrome.click(x, y);
    await chrome.eval('settle()');
  }

  // The first pick shows the bar and the return to Default hides it: nothing in the panel moves either way.
  async function expectSteady(index: number) {
    const before = await layout();
    await pick(index, 'Bold');
    expect(await chrome.eval('barShown()')).toBe(true);
    expect(await layout()).toEqual(before);
    await pick(index, 'Plain');
    expect(await chrome.eval('barShown()')).toBe(false);
    expect(await layout()).toEqual(before);
  }

  it('a short list keeps its height as the bar appears and leaves, on a desktop', async () => {
    await open(1024, 768, 3);
    expect(await chrome.eval('body().scrollHeight <= body().clientHeight')).toBe(true);
    await expectSteady(0);
    await expectSteady(2);
  });

  it('a short list keeps its height on a phone', async () => {
    await open(375, 812, 3, true);
    await expectSteady(1);
  });

  it('a list scrolled to its end stays put when the last pick returns to Default', async () => {
    await open(1024, 768, 12);
    await chrome.eval('body().scrollTop = body().scrollHeight');
    await chrome.eval('settle()');
    expect(await chrome.eval('body().scrollHeight > body().clientHeight')).toBe(true);
    await expectSteady(11);
  });

  it('with the bar hidden, the bottom band rests in the inset, so no control at rest is blurred', async () => {
    await open(1024, 768, 12);
    // At the end of the list the band is at rest; elsewhere it reaches further, over content passing under it.
    await chrome.eval('body().scrollTop = body().scrollHeight');
    await chrome.eval('settle()');
    const rest = () => chrome.eval<string>(`getComputedStyle(body().querySelector('.isotone-edge-bottom')).backgroundSize`);
    expect(await rest()).toBe('100% 14px');
    await pick(11, 'Bold');
    expect(await rest()).not.toBe('100% 14px');
    await pick(11, 'Plain');
    expect(await rest()).toBe('100% 14px');
  });

  it('a pick the bar would cover, in a list that scrolls, comes clear of it, and a second click there files nothing', async () => {
    await open(1024, 768, 12);
    // Scroll so the options of the 9th selector, below the fold, sit 30px above the list's foot, where the bar will rise.
    const [x, y] = await chrome.eval<[number, number]>(`(async () => {
      body().scrollTop += option(8, 'Wide')[1] - (body().getBoundingClientRect().bottom - 30);
      await settle();
      return option(8, 'Wide');
    })()`);
    const foot = await chrome.eval<number>('panel().querySelector(".isotone-vars").getBoundingClientRect().bottom');
    const bar = await chrome.eval<number>('panel().querySelector(".isotone-panel-head").offsetHeight');
    expect(y).toBeGreaterThan(foot - bar);
    await chrome.click(x, y);
    await chrome.eval('settle()');
    expect(await chrome.eval('barShown()')).toBe(true);
    const bottom = await chrome.eval<number>('panel().querySelectorAll(".isotone-axis")[8].getBoundingClientRect().bottom');
    expect(bottom).toBeLessThanOrEqual(foot - bar + 0.5);
    // The pointer has not moved, and is now over the bar: pressing again is meant for the list, not Make default.
    await chrome.click(x, y);
    await chrome.eval('settle()');
    expect(await chrome.eval('saves')).toBe(0);
  });

  it('hovering the panel, which shows its close button, moves nothing', async () => {
    await open(1024, 768, 3);
    await chrome.move(5, 5);
    await chrome.eval('settle()');
    const before = await layout();
    const [x, y] = await chrome.eval<[number, number]>('option(1, "Wide")');
    await chrome.move(x, y);
    await chrome.eval('settle()');
    expect(await chrome.eval(`getComputedStyle(panel().querySelector('.isotone-panel-close')).opacity`)).toBe('1');
    expect(await layout()).toEqual(before);
  });
});
