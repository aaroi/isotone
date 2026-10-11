// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVariantsSource, IterationPanel } from '../src/react/index';

let container: HTMLDivElement;
let hostRoot: Root;
let panelRoot: Root;
let shadow: ShadowRoot;
let hostContent: HTMLElement;
const source = createVariantsSource({ axes: [{
  id: 'spacing', label: 'Spacing', defaultOption: 'compact',
  options: [{ id: 'compact', label: 'Compact' }, { id: 'comfy', label: 'Comfy' }],
}] });

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  container = document.createElement('div');
  document.body.append(container);
  hostRoot = createRoot(container);
  await act(async () => {
    hostRoot.render(createElement('main', null,
      createElement('button', { id: 'host-content', type: 'button' }, 'Host content'),
      createElement('div', { id: 'panel-host' }),
    ));
  });
  hostContent = element(container, '#host-content');
  shadow = element(container, '#panel-host').attachShadow({ mode: 'open' });
  const target = document.createElement('div');
  shadow.append(target);
  panelRoot = createRoot(target);
  await render();
});

afterEach(async () => {
  await act(async () => { panelRoot.unmount(); hostRoot.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(route = '/') {
  return act(async () => {
    panelRoot.render(createElement(IterationPanel, {
      route, theme: 'light', variants: source, store: { endpoint: '/notes' },
    }));
  });
}

function element(parent: ParentNode, selector: string): HTMLElement {
  const found = parent.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

function dock() { return element(shadow, '.isotone-root'); }

function pointer(target: Element, type: string, relatedTarget: Element | null, pointerType = 'mouse', buttons = 0) {
  const boundary = type === 'pointerenter' || type === 'pointerleave';
  const event = new MouseEvent(type, { relatedTarget, buttons, bubbles: !boundary, composed: !boundary });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

it.each(['mouse', 'pen'])('expands on native %s entry from another React tree across a shadow boundary', async pointerType => {
  const root = dock();
  const launcher = element(root, '.isotone-fab');
  const outerLeave = vi.fn();
  hostContent.addEventListener('pointerout', outerLeave);
  await act(async () => {
    // The outer tree sees the shadow host as the destination. Its synthetic
    // leave cannot deliver entry to the inner React tree.
    pointer(hostContent, 'pointerout', launcher, pointerType);
    pointer(launcher, 'pointerover', hostContent, pointerType);
    pointer(root, 'pointerenter', hostContent, pointerType);
  });
  expect(outerLeave.mock.calls[0][0].relatedTarget).toBe(shadow.host);
  expect(root.dataset.expanded).toBe('true');
  expect(root.dataset.open).toBe('false');
  expect(launcher.getAttribute('aria-hidden')).toBe('true');
  const track = element(root, '.isotone-rail-track');
  const feedback = element(root, '.isotone-rail-button[aria-label="Feedback"]');
  await act(async () => {
    pointer(launcher, 'pointerout', track, pointerType);
    pointer(track, 'pointerover', launcher, pointerType);
    pointer(track, 'pointerout', feedback, pointerType);
    pointer(feedback, 'pointerover', track, pointerType);
  });
  expect(root.dataset.expanded).toBe('true');
  await act(async () => { pointer(root, 'pointerleave', hostContent, pointerType); });
  expect(root.dataset.expanded).toBe('false');
});

it.each([['touch', 0], ['mouse', 1], ['pen', 1]] as const)('ignores %s entry with buttons=%i', async (pointerType, buttons) => {
  const root = dock();
  await act(async () => { pointer(root, 'pointerenter', hostContent, pointerType, buttons); });
  expect(root.dataset.expanded).toBe('false');
  await act(async () => { element(root, '.isotone-fab').click(); });
  expect(root.dataset.open).toBe('true');
});

it('removes native boundary listeners on hidden routes and reattaches on return', async () => {
  const previous = dock();
  const remove = vi.spyOn(previous, 'removeEventListener');
  await act(async () => { pointer(previous, 'pointerenter', hostContent); });
  expect(previous.dataset.expanded).toBe('true');
  await render('/login');
  expect(shadow.querySelector('.isotone-root')).toBeNull();
  expect(remove).toHaveBeenCalledWith('pointerenter', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  // Detached nodes must not change the state of a later visible dock.
  await act(async () => { pointer(previous, 'pointerenter', hostContent); });
  await render();
  const next = dock();
  expect(next.dataset.expanded).toBe('false');
  await act(async () => { pointer(next, 'pointerenter', hostContent); });
  expect(next.dataset.expanded).toBe('true');
});
