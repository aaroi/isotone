// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IterationPanel } from '../src/react/index';

let container: HTMLDivElement;
let root: Root;
let values: Map<string, string>;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  values = new Map();
  storage = {
    getItem: key => values.get(key) ?? null,
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn(key => { values.delete(key); }),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
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
  await act(async () => { container.querySelector<HTMLButtonElement>('.isotone-fab')?.click(); });
  const field = container.querySelector('textarea');
  if (!field) throw new Error('Missing feedback composer');
  return field;
}

const oldKey = 'iso-iterate-feedback::draft::/project';
const newKey = 'isotone-feedback::draft::/project';

it('restores a legacy draft and its references without first clearing the migrated value', async () => {
  const draft = {
    text: 'Keep this offline draft',
    elements: [{ tag: 'button', text: 'Save', selector: '#save' }],
    variant: { axisId: 'layout', label: 'Layout', optionLabel: 'Grid' },
  };
  values.set(oldKey, JSON.stringify(draft));
  await render();
  const field = await open();
  expect(field.value).toBe(draft.text);
  expect(container.querySelector('.isotone-context')?.textContent).toContain('Layout / Grid');
  expect(container.querySelector('.isotone-context')?.textContent).toContain('Save');
  expect(JSON.parse(values.get(newKey) ?? '{}')).toEqual(draft);
  expect(values.has(oldKey)).toBe(false);
  expect(storage.removeItem).not.toHaveBeenCalledWith(newKey);
});

it('keeps the current draft when both namespaces have a draft for the route', async () => {
  values.set(oldKey, JSON.stringify({ text: 'Previous draft', elements: [] }));
  values.set(newKey, JSON.stringify({ text: 'Current draft', elements: [] }));
  await render();
  expect((await open()).value).toBe('Current draft');
  expect(values.has(oldKey)).toBe(false);
});

it('retains and restores the legacy draft when the new namespace cannot be written', async () => {
  values.set(oldKey, 'Legacy plain text draft');
  storage.setItem = vi.fn(() => { throw new Error('Storage full'); });
  await render();
  expect((await open()).value).toBe('Legacy plain text draft');
  expect(values.get(oldKey)).toBe('Legacy plain text draft');
  expect(values.has(newKey)).toBe(false);
});

it('leaves custom draft namespaces unchanged', async () => {
  values.set(oldKey, 'Unrelated draft');
  values.set('project-review::draft::/project', 'Custom namespace draft');
  await render('/project', 'project-review');
  expect((await open()).value).toBe('Custom namespace draft');
  expect(values.get(oldKey)).toBe('Unrelated draft');
  expect(values.has(newKey)).toBe(false);
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
