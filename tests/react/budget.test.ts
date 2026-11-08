/**
 * Render budgets on long collections, as React commit counts rather than
 * wall-clock times, so they hold on any machine. Timers and frames are fake:
 * a test moves the clock itself, so a loaded machine changes how long it
 * takes, never what it sees. The stress page (`/?stress=1`) is where the same
 * paths are timed by hand.
 */
import { act, createElement, memo, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { IsotoneNote } from '../../src/core';
import { createVariantsSource, IsotonePanel, type VariantAxis } from '../../src/react/index';
import { useNotes } from '../../src/react/notes/useNotes';

let host: HTMLDivElement;
let shadow: ShadowRoot;
/** Live, so counting them on every commit does not search the whole panel. */
let axisNodes: HTMLCollection;
let noteNodes: HTMLCollection;
let root: Root;
let commits = 0;
/** How many selectors each commit left in the panel. */
let axesPerCommit: number[] = [];
let notes: IsotoneNote[] = [];

const axes: VariantAxis[] = Array.from({ length: 500 }, (_, i) => ({
  id: `axis-${i}`,
  label: `Area ${Math.floor(i / 12)} > Selector ${i}`,
  defaultOption: 'a',
  options: [
    { id: 'a', label: 'Default' },
    { id: 'b', label: 'Alternative' },
  ],
}));
const manyNotes = (): IsotoneNote[] =>
  Array.from({ length: 500 }, (_, i) => ({
    id: `note-${i}`,
    route: '/',
    feedback: `Note ${i}`,
    element: null,
    done: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));

const elementFromPoint = document.elementFromPoint;
/** Rendering hundreds of rows in jsdom takes seconds of CPU, and more on a loaded machine; nothing here waits on time. */
const HEAVY = { timeout: 60_000 };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
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
  axisNodes = target.getElementsByClassName('isotone-axis');
  noteNodes = target.getElementsByClassName('isotone-note');
  root = createRoot(target);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  document.elementFromPoint = elementFromPoint;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(withVariants = false) {
  const panel = createElement(IsotonePanel, {
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
            axesPerCommit.push(axisNodes.length);
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
/** Run one frame and the tasks it schedules. */
const frame = (ms = 16) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });
/** Commits made by `run`, after the panel has settled and until its frames have run. */
async function commitsDuring(run: () => Promise<void>): Promise<number> {
  await frame(1000);
  const before = commits;
  await run();
  await frame();
  return commits - before;
}

/** Let the long lists finish rendering their chunks, a frame at a time. */
async function settle() {
  const done = () => axisNodes.length >= 500 && noteNodes.length >= notes.length;
  for (let i = 0; i < 40 && !done(); i++) await frame();
}

it('opens 500 selectors with a first screenful, then the rest in a few chunks, rendering each once', HEAVY, async () => {
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
  // Count the chunks, not commits: React may add an extra commit for the same count under load.
  expect(new Set(opening).size).toBeLessThanOrEqual(12);
  // Chunks append: the first selector is the same element, not a remount.
  expect(shadow.querySelector('.isotone-axis')).toBe(first);
});

it('commits once per keystroke with 500 notes and 500 selectors open', HEAVY, async () => {
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
  let shown: IsotoneNote[] = [];
  let load = () => {};
  // Stands in for the memoized note rows: it renders again only for a list that changed.
  const Rows = memo(function Rows({ list }: { list: IsotoneNote[] }) {
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
  notes[0] = { ...notes[0], feedback: 'Changed' } as IsotoneNote;
  await act(async () => load());
  expect(rowRenders).toBe(loaded + 1);
  // Only the changed note is a new object, so every other row skips its render.
  expect(shown.filter((note, i) => note !== before[i]).map((note) => note.id)).toEqual(['note-0']);
});

it('renders no notes while Feedback is closed, then the newest first in chunks', HEAVY, async () => {
  notes = manyNotes();
  await render();
  await frame(1000);
  expect(noteNodes).toHaveLength(0);
  await click('.isotone-fab', 0);
  // The opening commit renders a screenful of the newest notes; older ones follow above them.
  expect(noteNodes.length).toBeGreaterThan(0);
  expect(noteNodes.length).toBeLessThanOrEqual(40);
  expect(noteNodes[noteNodes.length - 1]?.textContent).toContain('Note 499');
  await settle();
  expect(noteNodes).toHaveLength(500);
  expect(noteNodes[0]?.textContent).toContain('Note 0');
});

it('goes back to the newest note when the list reappears, and keeps a reader scrolled up where they were', async () => {
  const observers: ((entries: unknown[]) => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: unknown[]) => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  notes = manyNotes().slice(0, 10);
  await render();
  await click('.isotone-fab', 0);
  await frame();
  // Ten 20px rows in a 100px list; hidden (as during select mode on a phone), everything reads 0.
  const list = $('.isotone-list');
  let shown = true;
  let top = 0;
  Object.defineProperties(list, {
    clientHeight: { get: () => (shown ? 100 : 0) },
    scrollHeight: { get: () => (shown ? 200 : 0) },
    scrollTop: { get: () => (shown ? top : 0), set: (value: number) => (top = Math.max(0, Math.min(value, 100))) },
  });
  const resized = () =>
    act(async () => {
      for (const run of observers) run([]);
    });
  await resized();
  expect(list.scrollTop).toBe(100);
  shown = false;
  list.dispatchEvent(new Event('scroll'));
  shown = true;
  top = 0;
  await resized();
  expect(list.scrollTop).toBe(100);
  // A reader 60px up from the newest note stays there when the panel changes size.
  list.scrollTop = 40;
  list.dispatchEvent(new Event('scroll'));
  await resized();
  expect(list.scrollTop).toBe(40);
});
