import { act, createElement as h, type MouseEvent, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IsotoneElement } from '../../src/core/types';
import { PickOverlay } from '../../src/react/dock/picking';
import { MAX_ANIMATED_ITEMS } from '../../src/react/motion';
import { Composer } from '../../src/react/notes/Composer';
import { useKeyFade } from '../../src/react/variants/keyFade';
import { useDockMotion } from '../../src/react/dock/useDockMotion';
import { useLayoutMotion } from '../../src/react/useLayoutMotion';

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
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
    return {
      x: 10,
      y: Number(this.dataset.top ?? 20),
      width: 320,
      height: 200,
      top: 20,
      left: 10,
      right: 330,
      bottom: 220,
      toJSON: () => ({}),
    };
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
  return h(
    'div',
    { ref, 'data-instant': instant },
    h('span', null, noise),
    ...Array.from({ length: count }, (_, i) => h('div', { key: i, 'data-motion-key': i, 'data-top': i * 24 + revision }, String(i))),
  );
}

function Dock({
  open = true,
  count = 3,
  noise = '',
  visible = true,
  instant = false,
  mounted = true,
  top = undefined as number | undefined,
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDockMotion(ref, visible);
  return h(
    'div',
    { ref, 'data-instant': instant },
    mounted &&
      h(
        'section',
        { className: 'isotone-panel', 'data-open': open, id: 'panel', 'data-top': top },
        h('span', null, noise),
        ...Array.from({ length: count }, (_, i) =>
          h('button', { type: 'button', key: i, id: `item-${i}`, 'data-motion-key': i }, String(i)),
        ),
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
    // The browser reports the list laid out; only then are its positions trusted for a reflow.
    await act(async () => resize());
    const first = [...animations];
    await act(async () => root.render(h(List, { revision: 12 })));
    expect(first.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    const current = animations.slice(3);
    expect(current).toHaveLength(3);
    await act(async () => root.render(h(List, { revision: 12, active: false })));
    expect(current.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it('does not animate from positions that went stale while the layout settled', async () => {
    const observers: { run: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        constructor(callback: () => void) {
          observers.push({ run: callback, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
    // How far the rows have drifted since they were rendered, with no change of contents.
    let drift = 0;
    offsets.mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.top ?? 0) + drift;
    });
    await act(async () => root.render(h(List, {})));
    expect(animate).toHaveBeenCalledTimes(3);
    // The panel settles after opening: thumbnails size, a row wraps, and every row ends 40px lower.
    drift = 40;
    observers.at(-1)?.run();
    // The first real change (a pick) leaves the rows where they are, so nothing reflows.
    await act(async () => root.render(h(List, { revision: 0.25 })));
    expect(animate).toHaveBeenCalledTimes(3);
    // A later change that does move rows still animates, from where they really were.
    await act(async () => root.render(h(List, { revision: 12 })));
    expect(animate).toHaveBeenCalledTimes(6);
    expect(animate.mock.calls.at(-1)?.[0]).toEqual([{ transform: 'translateY(-11.75px)' }, { transform: 'translateY(0)' }]);
    // Each measurement replaces its observer, and hiding the list lets go of the last.
    await act(async () => root.render(h(List, { revision: 12, active: false })));
    expect(observers.every((observer) => observer.disconnect.mock.calls.length >= 1)).toBe(true);
  });

  it('skips geometry under reduced motion and cancels running animations when it changes', async () => {
    media.matches = true;
    await act(async () => root.render(h(List, {})));
    expect(offsets).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    media.matches = false;
    await act(async () => root.render(h(List, { revision: 1 })));
    expect(animations).toHaveLength(3);
    await act(async () => {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
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
    await act(async () => resize());
    await act(async () => root.render(h(Dock, { open: false })));
    let ghost = host.querySelector<HTMLElement>('.isotone-exit');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.inert).toBe(true);
    expect(ghost?.querySelectorAll('[id]')).toHaveLength(0);
    expect(ghost?.id).toBe('');
    await act(async () => root.render(h(Dock, {})));
    expect(host.querySelector('.isotone-exit')).toBeNull();
    await act(async () => root.render(h(Dock, { open: false })));
    ghost = host.querySelector<HTMLElement>('.isotone-exit');
    expect(ghost).not.toBeNull();
    await act(async () => animations.at(-1)?.onfinish?.());
    expect(host.querySelector('.isotone-exit')).toBeNull();
    await act(async () => root.render(h(Dock, {})));
    await act(async () => root.render(h(Dock, { open: false })));
    await act(async () => root.render(h(Dock, { visible: false, open: false })));
    expect(host.querySelector('.isotone-exit')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });

  it('never clones large collections and removes animations for detached panels', async () => {
    const clone = vi.spyOn(HTMLElement.prototype, 'cloneNode');
    await act(async () => root.render(h(Dock, { count: MAX_ANIMATED_ITEMS + 1 })));
    await act(async () => resize());
    await act(async () => root.render(h(Dock, { count: MAX_ANIMATED_ITEMS + 1, open: false })));
    expect(clone).not.toHaveBeenCalled();
    expect(offsets).not.toHaveBeenCalled();
    await act(async () => root.render(h(Dock, {})));
    const animation = animations.at(-1);
    await act(async () => root.render(h(Dock, { mounted: false })));
    expect(animation?.cancel).toHaveBeenCalled();
  });

  it('shows a panel open at mount where it rests, even when the dock is styled after the first measure', async () => {
    // Before the theme's stylesheet lands the panel lies far below its place; the observer reports it styled.
    await act(async () => root.render(h(Dock, { top: 1000 })));
    await act(async () => root.render(h(Dock, { top: 20 })));
    await act(async () => resize());
    expect(animate).not.toHaveBeenCalled();
    // Once settled, a real move animates.
    await act(async () => root.render(h(Dock, { top: 60 })));
    await act(async () => resize());
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('honors instant mode and removes a running exit on reduced-motion changes', async () => {
    await act(async () => root.render(h(Dock, { instant: true })));
    await act(async () => resize());
    expect(animate).not.toHaveBeenCalled();
    await act(async () => root.render(h(Dock, { instant: false, open: false })));
    expect(host.querySelector('.isotone-exit')).not.toBeNull();
    await act(async () => {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
    expect(host.querySelector('.isotone-exit')).toBeNull();
    const calls = animate.mock.calls.length;
    await act(async () => root.render(h(Dock, {})));
    expect(animate).toHaveBeenCalledTimes(calls);
  });
});

const OPTIONS = ['a', 'b', 'c'];
let pickFromElsewhere: (value: string) => void = () => {};

/** A selector with options 100px apart in one row. */
function Selector({ initial = 'a', count = OPTIONS.length }: { initial?: string; count?: number }) {
  const [value, setValue] = useState(initial);
  pickFromElsewhere = setValue;
  const ref = useRef<HTMLDivElement>(null);
  const leave = useKeyFade(ref, value, count);
  return h(
    'div',
    { ref, className: 'isotone-segs' },
    ...OPTIONS.map((id, i) =>
      h(
        'div',
        { key: id, className: 'isotone-opt', 'data-x': i * 100 },
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': value === id,
            onClick: (e: MouseEvent) => {
              leave(e, id);
              setValue(id);
            },
          },
          id,
        ),
      ),
    ),
  );
}

describe('selection key', () => {
  let instant: HTMLDivElement;
  beforeEach(() => {
    instant = document.createElement('div');
    instant.dataset.instant = 'false';
    host.replaceWith(instant);
    instant.append(host);
    rects.mockImplementation(function (this: HTMLElement) {
      const x = Number(this.dataset.x ?? 0);
      return { x, y: 0, left: x, top: 0, width: 100, height: 28, right: x + 100, bottom: 28, toJSON: () => ({}) };
    });
  });
  afterEach(() => instant.remove());

  const option = (id: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === id) as HTMLButtonElement;
  const press = (id: string, detail = 1) =>
    act(async () => {
      option(id).dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    });
  const keys = () => host.querySelectorAll<HTMLElement>('.isotone-key');

  it('selects a pointer pick at once and fades the option it left out in place', async () => {
    await act(async () => root.render(h(Selector, {})));
    expect(animate).not.toHaveBeenCalled();
    await press('c');
    // The pick is selected in the same commit; nothing hides its face.
    expect(option('c').getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('.isotone-segs')?.hasAttribute('data-key')).toBe(false);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[0]).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    const [key] = keys();
    expect(key?.getAttribute('aria-hidden')).toBe('true');
    expect([key?.style.left, key?.style.width]).toEqual(['0px', '100px']);
    expect(host.querySelector('.isotone-segs')?.firstElementChild).toBe(key);
    await act(async () => animations[0]?.onfinish?.());
    expect(keys()).toHaveLength(0);
  });

  it('replaces a running fade, and a pick back onto the fading option clears it', async () => {
    await act(async () => root.render(h(Selector, {})));
    await press('b');
    await press('c');
    expect(animations[0]?.cancel).toHaveBeenCalled();
    expect(keys()).toHaveLength(1);
    expect(keys()[0]?.style.left).toBe('100px');
    await act(async () => animations[0]?.onfinish?.());
    expect(keys()).toHaveLength(1);
    await press('b');
    expect(animations[1]?.cancel).toHaveBeenCalled();
    expect([...keys()].map((key) => key.style.left)).toEqual(['200px']);
  });

  it('swaps at once for keys, keyboard mode, reduced motion and long lists', async () => {
    await act(async () => root.render(h(Selector, {})));
    await press('b', 0);
    instant.dataset.instant = 'true';
    await press('c');
    instant.dataset.instant = 'false';
    media.matches = true;
    await press('a');
    media.matches = false;
    await act(async () => root.render(h(Selector, { count: MAX_ANIMATED_ITEMS + 1 })));
    await press('b');
    expect(animate).not.toHaveBeenCalled();
    expect(keys()).toHaveLength(0);
  });

  it('does not animate a change from elsewhere, and one clears a fade', async () => {
    await act(async () => root.render(h(Selector, {})));
    await act(async () => pickFromElsewhere('c'));
    expect(animate).not.toHaveBeenCalled();
    await press('a');
    expect(keys()).toHaveLength(1);
    await act(async () => pickFromElsewhere('b'));
    expect(animations[0]?.cancel).toHaveBeenCalled();
    expect(keys()).toHaveLength(0);
  });
});

const pin = (selector: string) => ({ tag: 'div', text: selector, selector }) as IsotoneElement;

describe('arrivals', () => {
  beforeEach(() => {
    for (const id of ['one', 'two', 'three']) {
      const element = document.createElement('div');
      element.id = id;
      document.body.append(element);
    }
  });
  afterEach(() => {
    for (const id of ['one', 'two', 'three']) document.getElementById(id)?.remove();
  });
  const settled = () => animate.mock.contexts as HTMLElement[];

  it('settles in only a new pin, never the ones already drawn', async () => {
    const locate = (selector: string) => document.querySelector(selector);
    const overlay = (targets: IsotoneElement[]) => h(PickOverlay, { picking: true, targets, locate });
    await act(async () => root.render(overlay([pin('#one')])));
    expect(host.querySelectorAll('.isotone-selected')).toHaveLength(1);
    expect(animate).not.toHaveBeenCalled();
    await act(async () => root.render(overlay([pin('#one'), pin('#two')])));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(settled()[0]).toBe(host.querySelectorAll('.isotone-selected')[1]);
    expect(animate.mock.calls[0]?.[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    // A re-render, a scroll or a third pin leaves the earlier pins alone.
    await act(async () => root.render(overlay([pin('#one'), pin('#two')])));
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await new Promise((done) => requestAnimationFrame(() => done(null)));
    });
    expect(animate).toHaveBeenCalledTimes(1);
    await act(async () => root.render(overlay([pin('#one'), pin('#two'), pin('#three')])));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(settled()[1]).toBe(host.querySelectorAll('.isotone-selected')[2]);
    // The hover preview never animates.
    expect(settled()).not.toContain(host.querySelector('.isotone-hover:not(.isotone-selected)'));
  });

  it('settles in a chip added to the open composer, not chips it mounts with', async () => {
    const text = { subscribe: () => () => {}, get: () => '', set: () => {} };
    const composer = (targets: IsotoneElement[], active = true) =>
      h(Composer, {
        draft: { text, editing: null, variantTarget: null, targets, notice: '' },
        fieldRef: { current: null },
        active,
        picking: false,
        pickingWithPanel: false,
        floating: false,
        touch: false,
        shortcutLabel: '',
        onSend: () => {},
        onCancelEdit: () => {},
        onClearVariant: () => {},
        onUnpin: () => {},
        onFieldFocus: () => {},
        onFieldPointerDown: () => {},
        onTogglePicking: () => {},
        onDonePicking: () => {},
      } as unknown as Parameters<typeof Composer>[0]);
    await act(async () => root.render(composer([pin('#one'), pin('#two')])));
    expect(animate).not.toHaveBeenCalled();
    await act(async () => root.render(composer([pin('#one'), pin('#two'), pin('#three')])));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(settled()[0]?.textContent).toBe('#three');
    expect(animate.mock.calls[0]?.[0]).toEqual([
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'none' },
    ]);
    // Hidden, then opened with a new chip: the panel's own entrance is enough.
    await act(async () => root.render(composer([pin('#one')], false)));
    await act(async () => root.render(composer([pin('#one'), pin('#two')], true)));
    expect(animate).toHaveBeenCalledTimes(1);
    // Reduced motion keeps the fade alone.
    media.matches = true;
    await act(async () => root.render(composer([pin('#one'), pin('#two'), pin('#three')])));
    expect(animate.mock.calls[1]?.[0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });
});
