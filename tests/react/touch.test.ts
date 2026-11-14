import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVariantsSource, IsotonePanel } from '../../src/react/index';
import { visibleBand } from '../../src/react/dock/viewport';

let container: HTMLDivElement;
let root: Root | null = null;
/** Which media queries match; everything else does not. */
let matching: string[] = [];
const source = createVariantsSource({
  axes: [
    {
      id: 'spacing',
      label: 'Spacing',
      defaultOption: 'compact',
      options: [
        { id: 'compact', label: 'Compact' },
        { id: 'comfy', label: 'Comfy' },
      ],
    },
  ],
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  matching = [];
  vi.stubGlobal('matchMedia', (query: string) => Object.assign(new EventTarget(), { matches: matching.includes(query) }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render() {
  root = createRoot(container);
  const mounted = root;
  await act(async () =>
    mounted.render(
      createElement(IsotonePanel, {
        route: '/',
        theme: 'light',
        variants: source,
        store: { endpoint: '/notes' },
        defaultTab: 'variants',
      }),
    ),
  );
}
function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function click(el: Element, detail = 0) {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  });
}
/** A press from a given kind of pointer, as the browser reports it before the click. */
function press(target: EventTarget, pointerType: string) {
  return act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, composed: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    target.dispatchEvent(event);
  });
}
const panelOpen = (name: 'variants' | 'notes') => container.querySelector<HTMLElement>(`.isotone-${name}-panel`)?.dataset.open === 'true';

describe('touch', () => {
  it('describes select mode in touch terms after a finger press, and in keyboard terms after a mouse press', async () => {
    await render();
    await click(container.querySelector('.isotone-fab') as Element);
    // Opening Feedback starts select mode.
    await click(button('Feedback'));
    const cover = () => container.querySelector('.isotone-picking')?.textContent ?? '';
    expect(cover()).toContain('Click elements on the page');
    expect(cover()).toContain('Hold ⇧');

    await press(document.body, 'touch');
    expect(cover()).toContain('Tap elements on the page');
    expect(cover()).toContain('Tap Done to use the page');
    expect(cover()).not.toContain('⇧');
    expect(container.querySelector('.isotone-picking kbd')).toBeNull();

    await press(document.body, 'mouse');
    expect(cover()).toContain('Hold ⇧');
    expect(container.querySelector('.isotone-picking kbd')?.textContent).toBe('↵');
  });

  it('starts with touch copy on a touch-only screen', async () => {
    matching = ['(hover: none) and (pointer: coarse)'];
    await render();
    await click(container.querySelector('.isotone-fab') as Element);
    // Opening Feedback starts select mode.
    await click(button('Feedback'));
    expect(container.querySelector('.isotone-picking')?.textContent).toContain('Tap elements on the page');
  });

  it('opens the composer under a tapped element instead of over it', async () => {
    await render();
    await click(container.querySelector('.isotone-fab') as Element);
    await click(button('Feedback'));
    const card = document.createElement('section');
    card.id = 'card';
    card.textContent = 'Card';
    document.body.append(card);
    card.getBoundingClientRect = () => new DOMRect(100, 200, 300, 80);
    Object.defineProperty(document, 'elementFromPoint', { value: () => card, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('isotone-float') ? 300 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('isotone-float') ? 100 : 0;
    });
    await press(card, 'touch');
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 250, clientY: 230 }));
    });
    const float = container.querySelector<HTMLElement>('.isotone-float');
    // Below the card's bottom edge (280 + 12), centred on the tap.
    expect(float?.style.top).toBe('292px');
    expect(float?.style.left).toBe('100px');
    expect(float?.querySelector('.isotone-float-hint')?.textContent).toContain('Tap to pin more');
    card.remove();
  });
});

describe('small screens', () => {
  it('keeps one panel open at a time on a compact viewport', async () => {
    matching = ['(max-width: 640px), (max-height: 500px)'];
    await render();
    await click(container.querySelector('.isotone-fab') as Element);
    expect(panelOpen('variants')).toBe(true);
    await click(button('Feedback'));
    expect(panelOpen('notes')).toBe(true);
    expect(panelOpen('variants')).toBe(false);
    await click(button('Variants'));
    expect(panelOpen('variants')).toBe(true);
    expect(panelOpen('notes')).toBe(false);
  });

  it('keeps both panels open together on a larger screen', async () => {
    await render();
    await click(container.querySelector('.isotone-fab') as Element);
    await click(button('Feedback'));
    expect(panelOpen('variants')).toBe(true);
    expect(panelOpen('notes')).toBe(true);
  });

  it('measures the rows above an on-screen keyboard, but ignores pinch zoom', () => {
    const viewport = { height: innerHeight - 300, offsetTop: 40, scale: 1 };
    vi.stubGlobal('visualViewport', viewport);
    expect(visibleBand()).toEqual({ top: 40, bottom: innerHeight - 260 });
    viewport.scale = 2;
    expect(visibleBand()).toEqual({ top: 0, bottom: innerHeight });
    viewport.scale = 1;
    viewport.height = innerHeight - 20;
    expect(visibleBand()).toEqual({ top: 0, bottom: innerHeight });
  });
});
