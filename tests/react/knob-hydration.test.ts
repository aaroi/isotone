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

const App = () =>
  createElement(
    'html',
    { lang: 'en' },
    createElement('head', null, createElement('title', null, 'Pricing')),
    createElement('body', null, createElement('main', null, 'Plans')),
  );

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

it('puts knob values on the page during hydration without a mismatch, and the attributes after it', async () => {
  serverRender();
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ variants: [], active: [], knobs })),
  );
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(stored));

  // The framework has started hydrating when the panel's listing arrives.
  root = hydrateRoot(document, createElement(App));
  const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', live: null });
  await source.refresh();
  expect(knobStyle(document).getPropertyValue('--knob-page-pad')).toBe('40px');
  expect(document.documentElement.hasAttribute('data-knob-title')).toBe(false);

  await settle();
  expect(errors.mock.calls.map((call) => String(call[0])).filter((message) => /hydrat|match/i.test(message))).toEqual([]);
  expect(document.documentElement.hasAttribute('style')).toBe(false);
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
  expect(document.body.textContent).toBe('Plans');
});

it('applies stored values from the head script, and leaves attributes to the panel on a server render', () => {
  localStorage.setItem(KNOBS_STORAGE_KEY, JSON.stringify({ ...stored, unknown: 'x' }));
  const rows: [string, string, string, boolean][] = [
    ['page-pad', 'px', '24', false],
    ['title', '', 'plain', true],
  ];
  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, false, knobStyle);
  expect(knobStyle(document).getPropertyValue('--knob-page-pad')).toBe('40px');
  expect(knobStyle(document).getPropertyValue('--knob-title')).toBe('underlined');
  expect(document.documentElement.hasAttribute('data-knob-title')).toBe(false);

  applyStoredKnobs(document, KNOBS_STORAGE_KEY, rows, true, knobStyle);
  expect(document.documentElement.getAttribute('data-knob-title')).toBe('underlined');
  // One rule, reused.
  expect(document.querySelectorAll('style[data-isotone-knobs]')).toHaveLength(1);
});
