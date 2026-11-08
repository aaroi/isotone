// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IterationPanel } from '../../src/react/index';

let container: HTMLDivElement;
let root: Root;
let values: Map<string, string>;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn((key, value) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key) => {
      values.delete(key);
    }),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(route = '/project', key?: string) {
  return act(async () => {
    root.render(createElement(IterationPanel, { route, theme: 'light', store: { endpoint: '/notes', key } }));
  });
}

async function open() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.isotone-fab')?.click();
  });
  const field = container.querySelector('textarea');
  if (!field) throw new Error('Missing feedback composer');
  return field;
}

const newKey = 'isotone-feedback::draft::/project';

it('restores a saved draft and its references', async () => {
  const draft = {
    text: 'Keep this offline draft',
    elements: [{ tag: 'button', text: 'Save', selector: '#save' }],
    variant: { axisId: 'layout', label: 'Layout', optionLabel: 'Grid' },
  };
  values.set(newKey, JSON.stringify(draft));
  await render();
  expect((await open()).value).toBe(draft.text);
});

it('reads drafts from a custom namespace', async () => {
  values.set(newKey, JSON.stringify({ text: 'Default namespace draft', elements: [] }));
  values.set('project-review::draft::/project', JSON.stringify({ text: 'Custom namespace draft', elements: [] }));
  await render('/project', 'project-review');
  expect((await open()).value).toBe('Custom namespace draft');
});

it('does not briefly overwrite the destination draft while changing routes', async () => {
  values.set(newKey, JSON.stringify({ text: 'Project draft', elements: [] }));
  const destination = 'isotone-feedback::draft::/other';
  values.set(destination, JSON.stringify({ text: 'Other draft', elements: [] }));
  await render();
  const field = await open();
  expect(field.value).toBe('Project draft');
  vi.mocked(storage.setItem).mockClear();
  await render('/other');
  expect(field.value).toBe('Other draft');
  for (const [key, raw] of vi.mocked(storage.setItem).mock.calls) {
    if (key === destination) expect(JSON.parse(raw).text).toBe('Other draft');
  }
  expect(JSON.parse(values.get(newKey) ?? '{}').text).toBe('Project draft');
});

it('saves the last keystrokes when the page is hidden or unloaded before the save settles', async () => {
  await render();
  const field = await open();
  const type = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await type('Before a reload');
  expect(values.has(newKey)).toBe(false);
  window.dispatchEvent(new Event('pagehide'));
  expect(JSON.parse(values.get(newKey) ?? '{}').text).toBe('Before a reload');
  await type('Before switching tabs');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  Reflect.deleteProperty(document, 'visibilityState');
  expect(JSON.parse(values.get(newKey) ?? '{}').text).toBe('Before switching tabs');
});
