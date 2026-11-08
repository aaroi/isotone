// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVariantsSource, IsotonePanel } from '../../src/react/index';
import { PANEL_CSS } from '../../src/react/styles/panel';

let container: HTMLDivElement;
let hostRoot: Root;
let panelRoot: Root;
let shadow: ShadowRoot;
const source = createVariantsSource({
  axes: [
    {
      id: 'spacing',
      label: 'Spacing',
      defaultOption: 'compact',
      options: [
        { id: 'compact', label: 'Compact' },
        { id: 'comfy', label: 'Comfy' },
      ],
    },
  ],
});

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  container = document.createElement('div');
  document.body.append(container);
  hostRoot = createRoot(container);
  await act(async () => {
    hostRoot.render(createElement('main', null, createElement('div', { id: 'panel-host' })));
  });
  shadow = element(container, '#panel-host').attachShadow({ mode: 'open' });
  const target = document.createElement('div');
  shadow.append(target);
  panelRoot = createRoot(target);
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  // Node's own localStorage global is unusable without a file path.
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  });
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  await render();
});

afterEach(async () => {
  await act(async () => {
    panelRoot.unmount();
    hostRoot.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(route = '/') {
  return act(async () => {
    panelRoot.render(createElement(IsotonePanel, { route, theme: 'light', variants: source, store: { endpoint: '/notes' } }));
  });
}

function element(parent: ParentNode, selector: string): HTMLElement {
  const found = parent.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const dock = () => element(shadow, '.isotone-root');
const panel = (name: 'variants' | 'notes') => element(dock(), `.isotone-${name}-panel`);
const handle = (name: string) => element(dock(), `[role="separator"][aria-label="${name}"]`);
const width = () => handle('Resize panel width');
const variantsTop = () => handle('Resize variants height');
const notesTop = () => handle('Resize feedback height');
const split = () => handle('Resize variants and feedback split');
const stored = () => JSON.parse(localStorage.getItem('isotone-feedback::dock') ?? 'null');
const cssVar = (name: string) => dock().style.getPropertyValue(name);

const CHROME = 100;

/** The panel is `height` tall now and would be `content` tall if nothing scrolled; CHROME px of it never scrolls. */
function size(name: 'variants' | 'notes', height: number, content = height) {
  const element_ = panel(name);
  Object.defineProperty(element_, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 860, right: 1184, top: 0, bottom: height, width: 324, height, x: 860, y: 0, toJSON() {} }),
  });
  const scroller = element(element_, '.isotone-vars-body, .isotone-list');
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height - CHROME });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: content - CHROME });
}

/** A handle reads the panel's content when it is about to be used: on focus or pointer entry. */
function measure() {
  return act(async () => {
    for (const separator of dock().querySelectorAll<HTMLElement>('[role="separator"]')) separator.focus();
  });
}

async function remount() {
  await act(async () => {
    panelRoot.unmount();
  });
  panelRoot = createRoot(shadow.firstElementChild as HTMLElement);
  await render();
}

const toggle = (name: 'Variants' | 'Feedback') =>
  act(async () => {
    element(dock(), `.isotone-rail-button[aria-label="${name}"]`).click();
  });

function pointer(target: Element, type: string, clientX = 0, clientY = 0) {
  const event = new PointerEvent(type, { clientX, clientY, button: 0, bubbles: true, pointerId: 1 });
  return act(async () => {
    target.dispatchEvent(event);
  });
}

async function drag(target: Element, from: number, to: number, axis: 'x' | 'y' = 'y') {
  const at = (v: number) => (axis === 'x' ? [v, 0] : [0, v]) as [number, number];
  await pointer(target, 'pointerdown', ...at(from));
  await pointer(target, 'pointermove', ...at(to));
  await pointer(target, 'pointerup', ...at(to));
}

function key(target: Element, name: string, shiftKey = false) {
  return act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true }));
  });
}

it('shows only the handles that apply to the open panels', async () => {
  expect(shadow.querySelector('[role="separator"]')).toBeNull();
  await toggle('Variants');
  expect(width().getAttribute('aria-orientation')).toBe('vertical');
  expect(width().getAttribute('aria-valuemin')).toBe('280');
  expect(width().getAttribute('aria-valuemax')).toBe('1168');
  expect(variantsTop().getAttribute('aria-orientation')).toBe('horizontal');
  expect(shadow.querySelectorAll('[role="separator"]')).toHaveLength(2);
  await toggle('Feedback');
  expect(shadow.querySelectorAll('[role="separator"]')).toHaveLength(3);
  expect(split().classList.contains('isotone-resize-split')).toBe(true);
  await toggle('Variants');
  expect(notesTop().classList.contains('isotone-resize-split')).toBe(false);
});

it('drags the top edge of the only open panel, both ways, and persists on release', async () => {
  await toggle('Variants');
  size('variants', 300, 500);
  const edge = variantsTop();
  await pointer(edge, 'pointerdown', 0, 400);
  await pointer(edge, 'pointermove', 0, 340);
  expect(dock().dataset.resizing).toBe('true');
  expect(cssVar('--iso-variants-height')).toBe('360px');
  expect(localStorage.getItem('isotone-feedback::dock')).toBeNull();
  await pointer(edge, 'pointermove', 0, 460);
  expect(cssVar('--iso-variants-height')).toBe('240px');
  await pointer(edge, 'pointerup', 0, 460);
  expect(dock().dataset.resizing).toBeUndefined();
  expect(stored()).toEqual({ variants: 240 });
});

it('does not store a bigger value than the content, so ArrowUp is announced truthfully', async () => {
  await toggle('Variants');
  size('variants', 300, 320);
  await drag(variantsTop(), 400, 0);
  expect(stored()).toEqual({ variants: 320 });
  size('variants', 320);
  await measure();
  expect(variantsTop().getAttribute('aria-valuenow')).toBe('320');
  expect(variantsTop().getAttribute('aria-valuemax')).toBe('320');
  await key(variantsTop(), 'ArrowUp');
  expect(stored()).toEqual({ variants: 320 });
});

it('grows a panel when its content is taller than its size', async () => {
  await toggle('Variants');
  size('variants', 300, 600);
  await measure();
  expect(variantsTop().getAttribute('aria-valuemax')).toBe('600');
  await drag(variantsTop(), 400, 300);
  expect(stored()).toEqual({ variants: 400 });
  await key(variantsTop(), 'ArrowUp', true);
  expect(stored()).toEqual({ variants: 364 });
});

it('gives each panel its own minimum', async () => {
  await toggle('Variants');
  await toggle('Feedback');
  size('variants', 300, 600);
  size('notes', 250, 400);
  await measure();
  expect(split().getAttribute('aria-valuemin')).toBe('172');
  await drag(split(), 400, 2000);
  expect(stored()).toEqual({ notes: 172, variants: 378 });
  await drag(split(), 400, -2000);
  expect(stored()).toEqual({ notes: 400, variants: 212 });
});

it('moves the split: one panel grows as the other shrinks', async () => {
  await toggle('Variants');
  await toggle('Feedback');
  size('variants', 300, 600);
  size('notes', 250, 400);
  await pointer(split(), 'pointerdown', 0, 400);
  await pointer(split(), 'pointermove', 0, 370);
  expect(cssVar('--iso-notes-height')).toBe('280px');
  expect(cssVar('--iso-variants-height')).toBe('270px');
  await pointer(split(), 'pointerup', 0, 370);
  expect(stored()).toEqual({ notes: 280, variants: 270 });
  await key(split(), 'ArrowDown');
  expect(stored()).toEqual({ notes: 234, variants: 316 });
});

it('keeps the top edge of the feedback panel for itself when it is alone', async () => {
  await toggle('Feedback');
  size('notes', 250, 400);
  await drag(notesTop(), 400, 350);
  expect(stored()).toEqual({ notes: 300 });
});

it('clears the resizing state when the panel closes mid-drag', async () => {
  await toggle('Variants');
  size('variants', 300, 500);
  await pointer(variantsTop(), 'pointerdown', 0, 400);
  await pointer(variantsTop(), 'pointermove', 0, 380);
  expect(dock().dataset.resizing).toBe('true');
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(dock().dataset.open).toBe('false');
  expect(dock().dataset.resizing).toBeUndefined();
  expect(stored()).toEqual({ variants: 320 });
});

it('clears the resizing state when the pointer capture is lost', async () => {
  await toggle('Variants');
  size('variants', 300, 500);
  await pointer(variantsTop(), 'pointerdown', 0, 400);
  expect(dock().dataset.resizing).toBe('true');
  await act(async () => {
    variantsTop().dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  });
  expect(dock().dataset.resizing).toBeUndefined();
});

it('drags the left edge and clamps to the minimum width', async () => {
  await toggle('Variants');
  Object.defineProperty(dock(), 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 860, right: 1184, top: 0, bottom: 784, width: 324, height: 784, x: 860, y: 0, toJSON() {} }),
  });
  await pointer(width(), 'pointerdown', 860);
  await pointer(width(), 'pointermove', 784);
  expect(cssVar('--iso-width')).toBe('min(400px, calc(100vw - 32px))');
  await pointer(width(), 'pointerup', 784);
  expect(stored()).toEqual({ width: 400 });
  await drag(width(), 860, 1180, 'x');
  expect(stored()).toEqual({ width: 280 });
});

it('resizes by keyboard and resets with Home or a double-click', async () => {
  await toggle('Variants');
  await key(width(), 'ArrowLeft');
  expect(stored()).toEqual({ width: 356 });
  await key(width(), 'ArrowLeft', true);
  expect(stored()).toEqual({ width: 420 });
  await key(width(), 'ArrowRight');
  expect(stored()).toEqual({ width: 404 });
  await key(width(), 'Home');
  expect(cssVar('--iso-width')).toBe('');
  expect(stored()).toEqual({});
  size('variants', 300, 500);
  await key(variantsTop(), 'ArrowUp');
  await key(variantsTop(), 'ArrowDown');
  expect(stored()).toEqual({ variants: 284 });
  await act(async () => {
    variantsTop().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  expect(stored()).toEqual({});
});

it('restores stored sizes and ignores the former dock-wide height', async () => {
  localStorage.setItem('isotone-feedback::dock', JSON.stringify({ width: 500, height: 600, variants: 280 }));
  await remount();
  expect(cssVar('--iso-width')).toBe('min(500px, calc(100vw - 32px))');
  expect(cssVar('--iso-variants-height')).toBe('280px');
  expect(cssVar('--iso-dock-height')).toBe('');
  await toggle('Variants');
  expect(width().getAttribute('aria-valuenow')).toBe('500');
});

it('ignores a malformed stored value', async () => {
  for (const raw of ['{nope', '"x"', '{"width":"wide","variants":-3}']) {
    localStorage.setItem('isotone-feedback::dock', raw);
    await remount();
    expect(cssVar('--iso-width')).toBe('');
    expect(cssVar('--iso-variants-height')).toBe('');
  }
});

it('hides the handles and ignores stored sizes where panels take turns', () => {
  expect(PANEL_CSS).toContain('@media (max-width: 640px), (max-height: 500px) { .isotone-resize { display: none; } }');
  expect(PANEL_CSS).toMatch(/@media \(min-width: 641px\) and \(min-height: 501px\) \{[^@]*--iso-variants-height/);
  expect(PANEL_CSS).not.toMatch(/resize[^{]*:hover/);
});
