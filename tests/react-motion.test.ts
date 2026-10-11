// @vitest-environment jsdom
import { act, createElement as h, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ANIMATED_ITEMS } from '../src/react/motion';
import { useDockMotion } from '../src/react/useDockMotion';
import { useLayoutMotion } from '../src/react/useLayoutMotion';

let host: HTMLDivElement;
let root: Root;
let media: EventTarget & { matches: boolean };
let animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[];
let animate: ReturnType<typeof vi.fn>;
let offsets: ReturnType<typeof vi.spyOn>;
let rects: ReturnType<typeof vi.spyOn>;
let resize: () => void;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  animations = [];
  animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: null };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  offsets = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return Number(this.dataset.top ?? 0);
  });
  rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { x: 10, y: Number(this.dataset.top ?? 20), width: 320, height: 200, top: 20, left: 10, right: 330, bottom: 220, toJSON: () => ({}) };
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function List({ count = 3, revision = 0, noise = '', active = true, instant = false }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutMotion(ref, revision, active);
  return h('div', { ref, 'data-instant': instant },
    h('span', null, noise),
    ...Array.from({ length: count }, (_, i) => h('div', { key: i, 'data-motion-key': i, 'data-top': i * 24 + revision }, String(i))),
  );
}

function Dock({ open = true, count = 3, noise = '', visible = true, instant = false, mounted = true }) {
  const ref = useRef<HTMLDivElement>(null);
  useDockMotion(ref, visible);
  return h('div', { ref, 'data-instant': instant },
    mounted && h('section', { className: 'iso-iter-panel', 'data-open': open, id: 'panel' },
      h('span', null, noise),
      ...Array.from({ length: count }, (_, i) => h('button', { type: 'button', key: i, id: `item-${i}`, 'data-motion-key': i }, String(i))),
    ),
  );
}

describe('list motion', () => {
  it('does no per-item geometry or animation for large collections', async () => {
    await act(async () => root.render(h(List, { count: MAX_ANIMATED_ITEMS + 1 })));
    expect(offsets).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it('ignores unrelated renders, cancels interrupted reflows and cleans up when hidden', async () => {
    await act(async () => root.render(h(List, {})));
    expect(offsets).toHaveBeenCalledTimes(3);
    expect(animate).toHaveBeenCalledTimes(3);
    await act(async () => root.render(h(List, { noise: 'Typing elsewhere' })));
    expect(offsets).toHaveBeenCalledTimes(3);
    const first = [...animations];
    await act(async () => root.render(h(List, { revision: 12 })));
    expect(first.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    const current = animations.slice(3);
    expect(current).toHaveLength(3);
    await act(async () => root.render(h(List, { revision: 12, active: false })));
    expect(current.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it('skips geometry under reduced motion and cancels running animations when it changes', async () => {
    media.matches = true;
    await act(async () => root.render(h(List, {})));
    expect(offsets).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    media.matches = false;
    await act(async () => root.render(h(List, { revision: 1 })));
    expect(animations).toHaveLength(3);
    await act(async () => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });
});

describe('dock motion', () => {
  it('does not remeasure unrelated renders and responds to resize', async () => {
    await act(async () => root.render(h(Dock, {})));
    const measured = rects.mock.calls.length;
    await act(async () => root.render(h(Dock, { noise: 'Typing' })));
    expect(rects).toHaveBeenCalledTimes(measured);
    await act(async () => resize());
    expect(rects).toHaveBeenCalledTimes(measured + 1);
  });

  it('cleans exit snapshots on rapid reopening, animation completion and unmount', async () => {
    await act(async () => root.render(h(Dock, {})));
    await act(async () => root.render(h(Dock, { open: false })));
    let ghost = host.querySelector<HTMLElement>('.iso-iter-exit');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.inert).toBe(true);
    expect(ghost?.querySelectorAll('[id]')).toHaveLength(0);
    expect(ghost?.id).toBe('');
    await act(async () => root.render(h(Dock, {})));
    expect(host.querySelector('.iso-iter-exit')).toBeNull();
    await act(async () => root.render(h(Dock, { open: false })));
    ghost = host.querySelector<HTMLElement>('.iso-iter-exit');
    expect(ghost).not.toBeNull();
    await act(async () => animations.at(-1)?.onfinish?.());
    expect(host.querySelector('.iso-iter-exit')).toBeNull();
    await act(async () => root.render(h(Dock, {})));
    await act(async () => root.render(h(Dock, { open: false })));
    await act(async () => root.render(h(Dock, { visible: false, open: false })));
    expect(host.querySelector('.iso-iter-exit')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it('never clones large collections and removes animations for detached panels', async () => {
    const clone = vi.spyOn(HTMLElement.prototype, 'cloneNode');
    await act(async () => root.render(h(Dock, { count: MAX_ANIMATED_ITEMS + 1 })));
    await act(async () => root.render(h(Dock, { count: MAX_ANIMATED_ITEMS + 1, open: false })));
    expect(clone).not.toHaveBeenCalled();
    expect(offsets).not.toHaveBeenCalled();
    await act(async () => root.render(h(Dock, {})));
    const animation = animations.at(-1);
    await act(async () => root.render(h(Dock, { mounted: false })));
    expect(animation?.cancel).toHaveBeenCalled();
  });

  it('honors instant mode and removes a running exit on reduced-motion changes', async () => {
    await act(async () => root.render(h(Dock, { instant: true })));
    expect(animate).not.toHaveBeenCalled();
    await act(async () => root.render(h(Dock, { instant: false, open: false })));
    expect(host.querySelector('.iso-iter-exit')).not.toBeNull();
    await act(async () => { media.matches = true; media.dispatchEvent(new Event('change')); });
    expect(host.querySelector('.iso-iter-exit')).toBeNull();
    const calls = animate.mock.calls.length;
    await act(async () => root.render(h(Dock, {})));
    expect(animate).toHaveBeenCalledTimes(calls);
  });
});
