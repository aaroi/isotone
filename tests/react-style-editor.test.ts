// @vitest-environment jsdom
/** The experimental style editor inside the panel: opt-in, preview, send, revert. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IterationPanel } from '../src/react/index';

let container: HTMLDivElement;
let root: Root | null = null;
let card: HTMLElement;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })));
  const style = document.createElement('style');
  style.textContent = '.card { padding-top: 8px; }';
  document.head.append(style);
  card = document.createElement('section');
  card.id = 'card';
  card.className = 'card';
  card.innerHTML = '<h3 class="card-title">Title</h3><p>Body</p>';
  document.body.append(card);
  Object.defineProperty(document, 'elementFromPoint', { value: () => card, configurable: true });
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  if (root) {
    const r = root;
    root = null;
    await act(async () => r.unmount());
  }
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(styleEditor: boolean) {
  root = createRoot(container);
  const r = root;
  await act(async () => r.render(createElement(IterationPanel, {
    route: '/', store: { endpoint: '/notes' }, experimental: styleEditor ? { styleEditor: true } : undefined,
  })));
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  return act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
}
const byLabel = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const previewSheet = () => document.querySelector('[data-isotone-style-preview]');

async function setField(label: string, value: string) {
  const input = byLabel(label) as HTMLInputElement | null;
  if (!input) throw new Error(`missing ${label}`);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

async function openAndPin() {
  await click(container.querySelector('.isotone-fab'));
  // Opening the editor with nothing pinned starts select mode.
  await click(byLabel('Edit styles'));
  expect(byLabel('Select elements')?.getAttribute('aria-pressed')).toBe('true');
  await click(card);
  expect(container.querySelector('.isotone-crumb-current')?.textContent).toBe('section#card');
}

it('stays out of the panel unless enabled', async () => {
  await render(false);
  await click(container.querySelector('.isotone-fab'));
  expect(byLabel('Edit styles')).toBeNull();
  expect(container.querySelector('.isotone-style-panel')).toBeNull();
});

it('previews an edit with a scoped sheet, sends the diff with the note, then reverts', async () => {
  await render(true);
  await openAndPin();
  await setField('Padding top', '20');
  expect(previewSheet()?.textContent).toContain('padding-top: 20px !important');
  expect(card.hasAttribute('data-isotone-style')).toBe(true);
  expect(card.getAttribute('style')).toBeNull();
  expect(container.querySelector('.isotone-style-count')?.textContent).toBe('1 change');
  expect(Array.from(container.querySelectorAll('.isotone-context .isotone-chip')).map((chip) => chip.textContent)).toContain('1 style change');

  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'saved' }) }));
  vi.stubGlobal('fetch', fetchMock);
  await click(container.querySelector('.isotone-style-send'));
  const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST');
  const body = JSON.parse(String(call?.[1].body));
  expect(body.feedback).toMatch(/^Style: padding-top .* → 20px$/);
  expect(body.elements.map((el: { selector: string }) => el.selector)).toEqual(['#card']);
  expect(body.styleEdits).toEqual([expect.objectContaining({
    selector: '#card',
    classes: ['card'],
    changes: [expect.objectContaining({ property: 'padding-top', to: '20px', rule: '.card', declared: '8px' })],
  })]);
  expect(previewSheet()).toBeNull();
  expect(card.hasAttribute('data-isotone-style')).toBe(false);
});

it('reverts every previewed change when the editor closes', async () => {
  await render(true);
  await openAndPin();
  await setField('Corner radius', '12');
  await setField('Opacity', '0.5');
  expect(previewSheet()?.textContent).toContain('opacity: 0.5 !important');
  await click(byLabel('Undo style change'));
  expect(previewSheet()?.textContent).not.toContain('opacity');
  await click(byLabel('Close style editor'));
  expect(previewSheet()).toBeNull();
  expect(card.hasAttribute('data-isotone-style')).toBe(false);
});

it('steps number fields with the arrow keys and moves to the parent with Alt+↑', async () => {
  await render(true);
  await openAndPin();
  const field = byLabel('Margin left') as HTMLInputElement;
  const key = (init: KeyboardEventInit) => act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
  await act(async () => field.focus());
  await key({ key: 'ArrowUp' });
  await key({ key: 'ArrowUp', shiftKey: true });
  expect(previewSheet()?.textContent).toContain('margin-left: 11px !important');
  await key({ key: 'ArrowDown', altKey: true });
  expect(previewSheet()?.textContent).toContain('margin-left: 10.9px !important');
  // Alt+arrows step finely inside a field and move the selection elsewhere in the editor.
  expect(container.querySelector('.isotone-crumb-current')?.textContent).toBe('section#card');
  const parent = byLabel('Select parent (Alt+↑)') as HTMLElement;
  await act(async () => {
    parent.focus();
    parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('.isotone-crumb-current')?.textContent).toBe('body');
  // The edited section stays pinned, so its change still goes with the note.
  expect(Array.from(container.querySelectorAll('.isotone-context .isotone-chip'), (chip) => chip.textContent)).toEqual(['Title Body', expect.any(String), '1 style change']);
});

it('moves the selection to a child and back to the parent', async () => {
  await render(true);
  await openAndPin();
  await click(byLabel('Select a child (Alt+↓)'));
  await click(Array.from(container.querySelectorAll('.isotone-child')).find((el) => el.textContent?.startsWith('h3')));
  expect(container.querySelector('.isotone-crumb-current')?.textContent).toBe('h3.card-title');
  expect(container.querySelectorAll('.isotone-context .isotone-chip')).toHaveLength(1);
  await click(byLabel('Select parent (Alt+↑)'));
  expect(container.querySelector('.isotone-crumb-current')?.textContent).toBe('section#card');
});
