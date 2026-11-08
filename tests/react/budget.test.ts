// @vitest-environment jsdom
/**
 * Render budgets on long collections, as React commit counts rather than
 * wall-clock times, so they hold on any machine. The stress page
 * (`/?stress=1`) is where the same paths are timed by hand.
 */
import { act, createElement, memo, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVariantsSource, IterationPanel, type IterationNote, type VariantAxis } from '../../src/react/index';
import { useNotes } from '../../src/react/useNotes';

let host: HTMLDivElement;
let shadow: ShadowRoot;
let root: Root;
let commits = 0;
/** How many selectors each commit left in the panel. */
let axesPerCommit: number[] = [];
let notes: IterationNote[] = [];

const axes: VariantAxis[] = Array.from({ length: 500 }, (_, i) => ({
  id: `axis-${i}`,
  label: `Area ${Math.floor(i / 12)} > Selector ${i}`,
  defaultOption: 'a',
  options: [
    { id: 'a', label: 'Default' },
    { id: 'b', label: 'Alternative' },
  ],
}));
const manyNotes = (): IterationNote[] =>
  Array.from({ length: 500 }, (_, i) => ({
    id: `note-${i}`,
    route: '/',
    feedback: `Note ${i}`,
    element: null,
    done: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  commits = 0;
  axesPerCommit = [];
  notes = [];
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  // A fresh copy per response, as from the network: equal notes, new objects.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => structuredClone(notes) })),
  );
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
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
  vi.unstubAllGlobals();
});

async function render(withVariants = false) {
  const panel = createElement(IterationPanel, {
    route: '/',
    theme: 'light',
    store: { endpoint: '/notes' },
    ...(withVariants ? { variants: createVariantsSource({ axes }) } : {}),
  });
  await act(async () => {
    root.render(
      createElement(
        Profiler,
        {
          id: 'dock',
          onRender: () => {
            commits++;
            axesPerCommit.push(shadow.querySelectorAll('.isotone-axis').length);
          },
        },
        panel,
      ),
    );
  });
}

const $ = <T extends Element = HTMLElement>(selector: string) => {
  const found = shadow.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const click = (selector: string, detail = 1) =>
  act(async () => {
    $(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail }));
  });
/** Commits made by `run`, after its effects and pending tasks have settled. */
async function commitsDuring(run: () => Promise<void>): Promise<number> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const before = commits;
  await run();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return commits - before;
}

/** Let the Variants list finish rendering its chunks. */
async function settle() {
  for (let i = 0; i < 30 && shadow.querySelectorAll('.isotone-axis').length < 500; i++)
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

it('opens 500 selectors with a first screenful, then the rest in a few chunks, rendering each once', async () => {
  await render(true);
  await click('.isotone-fab');
  const before = axesPerCommit.length;
  await act(async () => $('.isotone-rail-button[aria-label="Variants"]').click());
  const first = shadow.querySelector('.isotone-axis');
  await settle();
  const opening = axesPerCommit.slice(before);
  // The commit that opens the panel renders only what fits on screen; each later one adds a chunk.
  expect(opening[0]).toBeLessThanOrEqual(16);
  expect(opening.at(-1)).toBe(500);
  expect(opening.length).toBeLessThanOrEqual(14);
  // Chunks append: the first selector is the same element, not a remount.
  expect(shadow.querySelector('.isotone-axis')).toBe(first);
});

it('commits once per keystroke with 500 notes and 500 selectors open', async () => {
  notes = manyNotes();
  await render(true);
  await click('.isotone-fab', 0);
  await act(async () => $('.isotone-rail-button[aria-label="Variants"]').click());
  await settle();
  const field = $<HTMLTextAreaElement>('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const typed = await commitsDuring(async () => {
    for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde'])
      await act(async () => {
        set?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
  });
  expect(typed).toBe(5);
});

it('commits nothing for pointer moves in select mode', async () => {
  const page = document.createElement('main');
  document.body.prepend(page);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => setTimeout(() => run(0), 0));
  document.elementFromPoint = () => page;
  await render();
  await click('.isotone-fab');
  expect($('[aria-label="Select elements"]').getAttribute('aria-pressed')).toBe('true');
  const moved = await commitsDuring(async () => {
    for (let i = 0; i < 100; i++)
      await act(async () => {
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: i, clientY: i, pointerType: 'mouse' }));
      });
  });
  expect(moved).toBe(0);
});

it('leaves 500 notes alone when a load returns them unchanged', async () => {
  notes = manyNotes();
  let rowRenders = 0;
  let shown: IterationNote[] = [];
  let load = () => {};
  // Stands in for the memoized note rows: it renders again only for a list that changed.
  const Rows = memo(function Rows({ list }: { list: IterationNote[] }) {
    rowRenders++;
    shown = list;
    return createElement('p', null, list.length);
  });
  function Probe() {
    const state = useNotes({ endpoint: '/notes' }, true);
    load = state.load;
    return createElement(Rows, { list: state.notes });
  }
  await act(async () => root.render(createElement(Probe)));
  await act(async () => load());
  const loaded = rowRenders;
  const before = shown;
  expect(shadow.querySelector('p')?.textContent).toBe('500');
  // A fresh copy of the same notes is not a change.
  await act(async () => load());
  await act(async () => load());
  expect(rowRenders).toBe(loaded);
  notes[0] = { ...notes[0], feedback: 'Changed' } as IterationNote;
  await act(async () => load());
  expect(rowRenders).toBe(loaded + 1);
  // Only the changed note is a new object, so every other row skips its render.
  expect(shown.filter((note, i) => note !== before[i]).map((note) => note.id)).toEqual(['note-0']);
});
