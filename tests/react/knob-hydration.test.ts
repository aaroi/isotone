/**
 * Knobs on a page whose `<html>` React hydrates (React Router framework mode,
 * Next.js). Regression: knob values landed in `<html style>` and select knobs'
 * `data-knob-*` on `<html>` whenever the panel loaded, and a load that beat
 * hydration logged React's "attributes of the server rendered HTML didn't
 * match" for `<html>`.
 */
import { createElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import {
  applyStoredKnobs,
  createOverlayVariantsSource,
  KNOBS_STORAGE_KEY,
  type KnobAxis,
  knobStyle,
} from '../../src/core/variants/overlay';

const knobs: KnobAxis[] = [
  { kind: 'range', id: 'page-pad', label: 'Page padding', min: 8, max: 48, step: 4, defaultValue: 24, unit: 'px' },
  {
    kind: 'select',
    id: 'title',
    label: 'Title',
    defaultOption: 'plain',
    options: [
      { id: 'plain', label: 'Plain' },
      { id: 'underlined', label: 'Underlined' },
    ],
  },
];
const stored = { 'page-pad': '40', title: 'underlined' };
const rows: [string, string, string, boolean][] = [
  ['page-pad', 'px', '24', false],
  ['title', '', 'plain', true],
];

const App = ({ text = 'Plans' }: { text?: string }) =>
  createElement(
    'html',
    { lang: 'en' },
    createElement('head', null, createElement('title', null, 'Pricing')),
    createElement('body', null, createElement('main', null, text)),
  );

type Win = { __isotoneHydrates?: boolean; __isotoneKnobs?: CSSStyleSheet };
let root: Root | null = null;
afterEach(() => {
  vi.useRealTimers();
  root?.unmount();
  root = null;
  // React leaves its markers behind on the document; the next test starts before any root.
  for (const node of [document, document.documentElement] as unknown as Record<string, unknown>[]) {
    for (const key of Object.keys(node)) if (/^_+react/.test(key)) delete node[key];
  }
  delete (window as Win).__isotoneHydrates;
  delete (window as Win).__isotoneKnobs;
  delete (document as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
  document.querySelector('style[data-isotone-knobs]')?.remove();
  document.documentElement.removeAttribute('data-knob-title');
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The server's document, as a framework that renders `<html>` sends it. */
function serverRender(): void {
  const html = renderToString(createElement(App));
  const parsed = new DOMParser().parseFromString(`<!doctype html>${html}`, 'text/html');
  for (const { name, value } of Array.from(parsed.documentElement.attributes)) document.documentElement.setAttribute(name, value);
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
}

function panel() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ variants: [], active: [], knobs })),
  );
  return createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', live: null });
}

const value = (name: string) => knobStyle(document, false)?.getPropertyValue(name) ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
const hydrationErrors = (errors: { mock: { calls: unknown[][] } }) =>
  errors.mock.calls.map((call) => String(call[0])).filter((message) => /hydrat|match/i.test(message));

// The Vite plugin's head script runs first; the panel's listing arrives once the framework has
// started hydrating, or, on a cold dev server, before its entry module has even loaded.
it.each([
  ['while React hydrates', true],
  ['before React starts', false],
])('puts knob values on the page %s without a mismatch, and the attributes after hydration', async (_, started) => {
  serverRender();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, true, knobStyle);
  expect(value('--knob-page-pad')).toBe('40px');

  if (started) root = hydrateRoot(document, createElement(App));
  const events: unknown[] = [];
  document.addEventListener('isotone:knob', (event) => events.push((event as CustomEvent).detail));
  await panel().refresh();
  // The panel announces the moved knobs on a full load, though the head script put them on first.
  expect(events).toEqual([
    { id: 'page-pad', value: '40px' },
    { id: 'title', value: 'underlined' },
  ]);
  expect(document.documentElement.hasAttribute('data-knob-title')).toBe(false);
  if (!started) {
    await settle();
    expect(document.documentElement.hasAttribute('data-knob-title')).toBe(false);
    root = hydrateRoot(document, createElement(App));
  }

  await settle();
  expect(hydrationErrors(errors)).toEqual([]);
  expect(document.documentElement.hasAttribute('style')).toBe(false);
  expect(value('--knob-page-pad')).toBe('40px');
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
  expect(document.body.textContent).toBe('Plans');
});

it('puts the attributes back when React falls back to rendering the page itself', async () => {
  serverRender();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, true, knobStyle);
  root = hydrateRoot(document, createElement(App, { text: 'Prices' }), { onRecoverableError: () => {} });
  await panel().refresh();
  await settle();
  // React cleared <html>'s attributes for its own render; the wait's end wrote them again.
  expect(document.body.textContent).toBe('Prices');
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
});

it('applies the attributes after a while when the expected hydration never shows', async () => {
  vi.useFakeTimers();
  serverRender();
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, true, knobStyle);
  await panel().refresh();
  await vi.advanceTimersByTimeAsync(4000);
  expect(document.documentElement.hasAttribute('data-knob-title')).toBe(false);
  await vi.advanceTimersByTimeAsync(1200);
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
});

it('writes the attributes again when React hydrates after that and renders the page itself', async () => {
  // Only the panel's timers are faked; React schedules its work on setImmediate here.
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  serverRender();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, true, knobStyle);
  await panel().refresh();
  await vi.advanceTimersByTimeAsync(5200);
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');

  root = hydrateRoot(document, createElement(App, { text: 'Prices' }), { onRecoverableError: () => {} });
  await vi.waitFor(() => expect(document.body.textContent).toBe('Prices'));
  await vi.advanceTimersByTimeAsync(100);
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
});

it('sets select attributes from the head script where React does not hydrate the page', () => {
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify({ ...stored, unknown: 'x' }));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, false, knobStyle);
  expect(value('--knob-page-pad')).toBe('40px');
  expect(value('--knob-title')).toBe('underlined');
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
  // One rule, reused, at the end of <head> where the document cannot adopt sheets (jsdom).
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, false, knobStyle);
  expect(document.querySelectorAll('style[data-isotone-knobs]')).toHaveLength(1);
  expect(document.head.lastElementChild?.matches('style[data-isotone-knobs]')).toBe(true);
});

it('keeps the rule in an adopted sheet: no node, made only for a moved knob, ahead of the host’s :root', () => {
  Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true });
  expect(knobStyle(document, false)).toBeNull();
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, false, knobStyle);
  // Nothing stored: nothing made.
  expect((window as Win).__isotoneKnobs).toBeUndefined();

  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, false, knobStyle);
  const sheet = (window as Win).__isotoneKnobs as CSSStyleSheet;
  expect(document.adoptedStyleSheets).toEqual([sheet]);
  expect(document.querySelector('style[data-isotone-knobs]')).toBeNull();
  expect(value('--knob-page-pad')).toBe('40px');
  expect((sheet.cssRules[0] as CSSStyleRule).style.getPropertyPriority('--knob-page-pad')).toBe('important');

  // An app that replaces the adopted list gets the sheet back on the next write.
  document.adoptedStyleSheets = [];
  knobStyle(document, true);
  expect(document.adoptedStyleSheets).toEqual([sheet]);
});

it('fails quietly where the page will not take the style', () => {
  const blocked = {
    defaultView: null,
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, sheet: null }),
    head: { appendChild() {} },
    documentElement: document.documentElement,
  } as unknown as Document;
  expect(knobStyle(blocked, true)).toBeNull();
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));
  expect(() => applyStoredKnobs(blocked, KNOBS_STORAGE_KEY, rows, true, knobStyle)).not.toThrow();
});
