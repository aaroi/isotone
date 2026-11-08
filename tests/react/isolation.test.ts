// @vitest-environment jsdom
/**
 * The panel inside a host page: its own events stay in the dock, the host's
 * stay with the host, and closing things puts focus somewhere sensible.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IterationNote } from '../../src/core';
import { createVariantsSource, IterationPanel } from '../../src/react/index';

let host: HTMLDivElement;
let shadow: ShadowRoot;
let root: Root;
let notes: IterationNote[] = [];

const source = () =>
  createVariantsSource({
    axes: [
      {
        id: 'spacing',
        label: 'Spacing',
        defaultOption: 'compact',
        options: [
          { id: 'compact', label: 'Compact' },
          { id: 'comfy', label: 'Comfy' },
          { id: 'roomy', label: 'Roomy' },
        ],
      },
    ],
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notes = [];
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => notes })),
  );
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  document.body.innerHTML = '<input id="host-input"><button id="host-button">Host</button>';
  host = document.createElement('div');
  host.setAttribute('data-isotone', 'root');
  document.body.append(host);
  shadow = host.attachShadow({ mode: 'open' });
  const target = document.createElement('div');
  shadow.append(target);
  root = createRoot(target);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  document.body.style.cursor = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(props: Partial<Parameters<typeof IterationPanel>[0]> = {}) {
  return act(async () => {
    root.render(createElement(IterationPanel, { route: '/', theme: 'light', store: { endpoint: '/notes' }, ...props }));
  });
}

const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = shadow.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const frame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

async function openFeedback() {
  await act(async () => {
    $('.isotone-fab').focus();
    $('.isotone-fab').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 0 }));
  });
  await frame();
}

it('keeps keys, input, focus and wheel events from the dock away from host handlers', async () => {
  await render();
  await openFeedback();
  const field = $<HTMLTextAreaElement>('textarea');
  const seen: string[] = [];
  const types = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'focusin', 'focusout', 'wheel'];
  for (const type of types) document.addEventListener(type, () => seen.push(type));
  await act(async () => {
    field.focus();
    for (const type of ['keydown', 'keypress', 'keyup'])
      field.dispatchEvent(new KeyboardEvent(type, { key: '/', bubbles: true, composed: true }));
    field.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true }));
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    field.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true }));
    field.blur();
  });
  expect(seen).toEqual([]);
  // The host's own events are untouched.
  document.getElementById('host-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
  expect(seen).toEqual(['keydown']);
});

it('leaves an Escape pressed in a host input to the host', async () => {
  await render();
  await openFeedback();
  const input = document.getElementById('host-input') as HTMLInputElement;
  input.focus();
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  });
  expect($('.isotone-notes-panel').dataset.open).toBe('true');
  expect(document.activeElement).toBe(input);
  // Escape in the dock still closes it.
  await act(async () => {
    $('textarea').focus();
    $('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  });
  expect($('.isotone-notes-panel').dataset.open).toBe('false');
});

it('swallows presses on the page while selecting, unless Shift is held', async () => {
  await render();
  await act(async () => {
    $('.isotone-fab').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
  });
  expect($('[aria-label="Select elements"]').getAttribute('aria-pressed')).toBe('true');
  const button = document.getElementById('host-button') as HTMLButtonElement;
  const presses: string[] = [];
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) button.addEventListener(type, () => presses.push(type));
  const press = (shiftKey: boolean) => {
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey });
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey });
    button.dispatchEvent(pointer);
    button.dispatchEvent(mouse);
    button.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    return [pointer.defaultPrevented, mouse.defaultPrevented];
  };
  expect(press(false)).toEqual([true, true]);
  expect(presses).toEqual([]);
  press(true);
  expect(presses).toEqual(['pointerdown', 'mousedown']);
  // Presses inside the dock are the dock's own.
  const pick = $('[aria-label="Select elements"]');
  const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true });
  pick.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(false);
});

it('returns focus to the rail or launcher when a panel closes from inside', async () => {
  await render({ variants: source() });
  await openFeedback();
  const close = $<HTMLButtonElement>('.isotone-notes-panel > .isotone-panel-close');
  close.focus();
  await act(async () => close.click());
  await frame();
  expect(shadow.activeElement).not.toBeNull();
  expect([$('.isotone-fab'), $('.isotone-rail-button[aria-label^="Feedback"]')]).toContain(shadow.activeElement);
});

it('never drops focus to the page body when Escape closes a panel opened from the launcher', async () => {
  await render();
  document.getElementById('host-button')?.focus();
  await openFeedback();
  await act(async () => {
    $('textarea').focus();
    $('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  });
  await frame();
  expect($('.isotone-notes-panel').dataset.open).toBe('false');
  expect(document.activeElement).toBe(host);
  expect([$('.isotone-fab'), $('.isotone-rail-button')]).toContain(shadow.activeElement);
});

it('treats a trailing slash or query as the same page, as the CLI does', async () => {
  notes = [
    { id: 'a', route: '/about/', feedback: 'Slash', element: null, done: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', route: '/about', feedback: 'Bare', element: null, done: false, createdAt: '2026-01-01T00:00:01.000Z' },
  ];
  await render({ route: '/about/?tab=2' });
  await openFeedback();
  expect(shadow.querySelectorAll('.isotone-note')).toHaveLength(2);
  expect(shadow.querySelector('.isotone-pages')).toBeNull();
});

it('names the note count on the launcher and the Feedback button', async () => {
  notes = [
    { id: 'a', route: '/', feedback: 'One', element: null, done: false, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'b', route: '/', feedback: 'Two', element: null, done: false, createdAt: '2026-01-01T00:00:01.000Z' },
  ];
  await render();
  await openFeedback();
  expect($('.isotone-fab').getAttribute('aria-label')).toBe('Isotone, 2 notes');
  expect($('.isotone-rail-button').getAttribute('aria-label')).toBe('Feedback, 2 notes');
});

it('keeps typing in the composer from touching the variants panel or its source', async () => {
  const variants = source();
  await render({ variants });
  await openFeedback();
  await act(async () => $<HTMLButtonElement>('.isotone-rail-button[aria-label="Variants"]').click());
  const changes: MutationRecord[] = [];
  const observer = new MutationObserver((records) => changes.push(...records));
  observer.observe($('.isotone-variants-panel'), { subtree: true, attributes: true, childList: true, characterData: true });
  const field = $<HTMLTextAreaElement>('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const reads = vi.spyOn(variants, 'getSelections');
  for (const value of ['a', 'ab', 'abc']) {
    await act(async () => {
      set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await act(async () => {});
  observer.disconnect();
  expect(field.value).toBe('abc');
  expect(changes).toEqual([]);
  // No selector walk per keystroke.
  expect(reads).not.toHaveBeenCalled();
});

it('renders no selectors while the variants panel is closed', async () => {
  await render({ variants: source() });
  await act(async () => $('.isotone-fab').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
  await act(async () => $<HTMLButtonElement>('.isotone-rail-button[aria-label="Variants"]').click());
  expect(shadow.querySelectorAll('.isotone-axis')).toHaveLength(1);
  await act(async () => $<HTMLButtonElement>('.isotone-rail-button[aria-label="Variants"]').click());
  await act(async () => {});
  expect(shadow.querySelectorAll('.isotone-axis')).toHaveLength(0);
});

it('makes single choices a radio group with one tab stop and keyboard actions', async () => {
  const variants = source();
  await render({ variants });
  await act(async () => $('.isotone-fab').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })));
  await act(async () => $<HTMLButtonElement>('.isotone-rail-button[aria-label="Variants"]').click());
  // Opening from the launcher focuses the composer a frame later; let that land before the keys.
  await frame();
  const group = $('[role="radiogroup"]');
  const radios = () => Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  expect(radios().map((r) => [r.getAttribute('aria-checked'), r.tabIndex])).toEqual([
    ['true', 0],
    ['false', -1],
    ['false', -1],
  ]);
  // Hidden chevrons take no tab stops.
  expect(Array.from(group.querySelectorAll<HTMLButtonElement>('.isotone-opt-more'), (b) => b.tabIndex)).toEqual([-1, -1, -1]);
  const key = (target: HTMLElement | undefined, init: KeyboardEventInit) =>
    act(async () => {
      if (!target) throw new Error('No such option');
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    });
  await key(radios()[0], { key: 'ArrowRight' });
  expect(variants.getSelections().spacing).toBe('comfy');
  expect(shadow.activeElement).toBe(radios()[1]);
  expect(radios()[1]?.tabIndex).toBe(0);
  await key(radios()[1], { key: 'End' });
  expect(variants.getSelections().spacing).toBe('roomy');
  await key(radios()[2], { key: 'ArrowRight' });
  expect(variants.getSelections().spacing).toBe('compact');
  // Shift+F10 opens the option's own actions, as a right click does.
  await key(radios()[1], { key: 'F10', shiftKey: true });
  expect($('.isotone-axis-menu').getAttribute('aria-label')).toBe('Comfy option actions');
  expect($('.isotone-axis-menu').dataset.open).toBe('true');
  // Closing it returns focus to the option, where the arrow keys still work, not to its off-tab-order chevron.
  await act(async () => {
    $('.isotone-axis-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await frame();
  await frame();
  expect($('.isotone-axis-menu').dataset.open).toBe('false');
  expect(shadow.activeElement).toBe(radios()[1]);
});
