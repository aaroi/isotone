/**
 * The panel tests' shared fixture: a container per test, a Map-backed
 * `localStorage`, a quiet notes endpoint, and the helpers that render the
 * panel and find its controls.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import type { VariantAxis } from '../../src/core/variants';

export const AXES: VariantAxis[] = [
  {
    id: 'headline',
    label: 'Headline',
    options: [
      { id: 'a', label: 'Plain' },
      { id: 'b', label: 'Bold', hint: 'Heavier weight' },
    ],
    defaultOption: 'a',
  },
  {
    kind: 'range',
    id: 'haze',
    label: 'Haze',
    min: 0,
    max: 1,
    step: 0.1,
    defaultValue: 0.3,
    section: 'motion',
  },
  {
    id: 'tagline',
    label: 'Tagline',
    options: [
      { id: 'x', label: 'Short' },
      { id: 'y', label: 'Long' },
    ],
    defaultOption: 'x',
    showWhen: { axis: 'headline', equals: 'b' },
  },
];

/** The current test's container; a new one for every test. */
export let container: HTMLDivElement;
let root: Root | null = null;

/**
 * Node 25 ships its own `localStorage` global that is unusable without a
 * `--localstorage-file` flag, and vitest's jsdom environment leaves that one
 * in place, so the panel's guarded reads silently fail. A Map-backed Storage
 * lets the tab-memory test observe what the panel writes.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** Registers the fixture's hooks in the calling test file. */
export function setUpPanelFixture() {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal('localStorage', memoryStorage());
    // The panel lists notes on open; answer with an empty file so the notes
    // path stays quiet and the tests exercise only the variants wiring.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
    );
  });

  afterEach(async () => {
    await unmount();
    container.remove();
    document.body.style.backgroundColor = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

/** Unmounts what `render` mounted, if anything. */
export async function unmount() {
  if (root) {
    const r = root;
    root = null;
    await act(async () => r.unmount());
  }
}

/** Renders into the mounted root again, inside the caller's `act`. */
export function rerender(element: React.ReactElement) {
  root?.render(element);
}

export async function render(element: React.ReactElement) {
  root = createRoot(container);
  const r = root;
  await act(async () => r.render(element));
}

/** A long list renders a first screenful, then the rest a chunk per frame: wait for every chunk. */
export async function renderRemaining() {
  for (let count = -1; count !== container.querySelectorAll('.isotone-axis').length; ) {
    count = container.querySelectorAll('.isotone-axis').length;
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  }
}

export function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A control by its own text (not an inline svg's `<title>`) or aria-label. */
export function byText(text: string, selector = 'button'): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).find((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .trim();
    return own === text || el.textContent?.trim() === text || el.getAttribute('aria-label') === text;
  });
}

export function labels(): string[] {
  return Array.from(container.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent ?? '');
}
