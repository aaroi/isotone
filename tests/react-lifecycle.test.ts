// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IterationPanel, mountIteration, type IterationNote, type IterationTheme } from '../src/react/index';

let container: HTMLDivElement;
let root: Root;
let media: EventTarget & { matches: boolean };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  vi.stubGlobal('fetch', vi.fn(async () => response([])));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.backgroundColor = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function response(value: unknown) {
  return { ok: true, status: 200, json: async () => value };
}

function render(theme: IterationTheme = 'light') {
  return act(async () => {
    root.render(createElement(IterationPanel, { route: '/', theme, store: { endpoint: '/notes' } }));
  });
}

async function click(selector: string) {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target?.click());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const note: IterationNote = {
  id: 'existing', route: '/', feedback: 'Original note', element: null,
  done: false, createdAt: '2026-01-01T12:00:00.000Z',
};

it('applies theme prop changes and follows system changes while mounted', async () => {
  document.body.style.backgroundColor = 'black';
  await render('auto');
  const panel = container.querySelector<HTMLElement>('.iso-iter-root');
  expect(panel?.dataset.theme).toBe('dark');
  await render('light');
  expect(panel?.dataset.theme).toBe('light');
  await render('dark');
  expect(panel?.dataset.theme).toBe('dark');
  await render('system');
  expect(panel?.dataset.theme).toBe('light');
  await act(async () => {
    media.matches = true;
    media.dispatchEvent(new Event('change'));
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(panel?.dataset.theme).toBe('dark');
});

it('passes an explicit theme through the standalone React mount', async () => {
  document.body.style.backgroundColor = 'black';
  const off = mountIteration({ endpoint: '/notes', theme: 'light' });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const host = document.querySelector('[data-iso-iterate="root"]');
  expect(host?.shadowRoot?.querySelector('.iso-iter-root')?.getAttribute('data-theme')).toBe('light');
  await act(async () => {
    off();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(host?.isConnected).toBe(false);
});

it('does not restore a deleted note when an older refresh finishes', async () => {
  const refresh = deferred<ReturnType<typeof response>>();
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Promise.resolve(response({ ok: true }));
    return ++reads === 1 ? Promise.resolve(response([note])) : refresh.promise;
  }));
  await render();
  await click('.iso-iter-fab');
  expect(container.querySelector('.iso-iter-note-hit')?.textContent).toContain('Original note');
  await click('[aria-label="Delete note"]');
  expect(container.querySelectorAll('.iso-iter-note')).toHaveLength(0);
  await act(async () => refresh.resolve(response([note])));
  expect(container.querySelectorAll('.iso-iter-note')).toHaveLength(0);
});

it('does not replace an edited note with a stale refresh', async () => {
  const refresh = deferred<ReturnType<typeof response>>();
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(response({ id: note.id }));
    return ++reads === 1 ? Promise.resolve(response([note])) : refresh.promise;
  }));
  await render();
  await click('.iso-iter-fab');
  await click('.iso-iter-note-hit');
  const textarea = container.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Edited note');
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('[aria-label="Save edit"]');
  await act(async () => refresh.resolve(response([note])));
  expect(container.querySelector('.iso-iter-note-hit')?.textContent).toContain('Edited note');
});

it('accepts only the newest refresh when requests finish out of order', async () => {
  const first = deferred<ReturnType<typeof response>>();
  const second = deferred<ReturnType<typeof response>>();
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(() => ++reads === 1 ? first.promise : second.promise));
  await render();
  await click('.iso-iter-fab');
  await act(async () => second.resolve(response([{ ...note, feedback: 'Newer note' }])));
  await act(async () => first.resolve(response([note])));
  expect(container.querySelector('.iso-iter-note-hit')?.textContent).toContain('Newer note');
});
