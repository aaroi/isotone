// @vitest-environment jsdom
/**
 * The variants surface: the view on its own, and the panel deciding between
 * a Variants / Notes tab bar, variants only, or nothing at all.
 */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VariantAction, VariantAxis } from '../../src/core/variants';
import { createVariantsSource, IsotonePanel, mountIsotone } from '../../src/react/index';
import { VariantsView } from '../../src/react/VariantsView';
import { PANEL_CSS } from '../../src/react/styles';

const AXES: VariantAxis[] = [
  {
    id: 'headline',
    label: 'Headline',
    options: [
      { id: 'a', label: 'Plain' },
      { id: 'b', label: 'Bold', hint: 'Heavier weight' },
    ],
    defaultOption: 'a',
  },
  {
    kind: 'range',
    id: 'haze',
    label: 'Haze',
    min: 0,
    max: 1,
    step: 0.1,
    defaultValue: 0.3,
    section: 'motion',
  },
  {
    id: 'tagline',
    label: 'Tagline',
    options: [
      { id: 'x', label: 'Short' },
      { id: 'y', label: 'Long' },
    ],
    defaultOption: 'x',
    showWhen: { axis: 'headline', equals: 'b' },
  },
];

let container: HTMLDivElement;
let root: Root | null = null;

/**
 * Node 25 ships its own `localStorage` global that is unusable without a
 * `--localstorage-file` flag, and vitest's jsdom environment leaves that one
 * in place, so the panel's guarded reads silently fail. A Map-backed Storage
 * lets the tab-memory test observe what the panel writes.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  vi.stubGlobal('localStorage', memoryStorage());
  // The panel lists notes on open; answer with an empty file so the notes
  // path stays quiet and the tests exercise only the variants wiring.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })),
  );
});

afterEach(async () => {
  if (root) {
    const r = root;
    root = null;
    await act(async () => r.unmount());
  }
  container.remove();
  document.body.style.backgroundColor = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(element: React.ReactElement) {
  root = createRoot(container);
  const r = root;
  await act(async () => r.render(element));
}

/** A long list renders a first screenful, then the rest a chunk per frame: wait for every chunk. */
async function renderRemaining() {
  for (let count = -1; count !== container.querySelectorAll('.isotone-axis').length; ) {
    count = container.querySelectorAll('.isotone-axis').length;
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  }
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A control by its own text (not an inline svg's `<title>`) or aria-label. */
function byText(text: string, selector = 'button'): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).find((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .trim();
    return own === text || el.textContent?.trim() === text || el.getAttribute('aria-label') === text;
  });
}

function labels(): string[] {
  return Array.from(container.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent ?? '');
}

describe('VariantsView', () => {
  it('names selector groups, announces formatted values, and surfaces activation errors', async () => {
    const base = createVariantsSource({ axes: AXES });
    let message: string | null = 'Could not activate this variant';
    const source = { ...base, getError: () => message };
    await render(createElement(VariantsView, { source }));
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Headline');
    expect(container.querySelector('input[type=range]')?.getAttribute('aria-valuetext')).toBe('30%');
    expect(container.querySelector('[role=alert]')?.textContent).toBe(message);
    message = null;
    await click(byText('Bold'));
    expect(container.querySelector('[role=alert]')).toBeNull();
  });

  it('opens an option-scoped dialog from the more button or a right click without changing the selection', async () => {
    const source = createVariantsSource({ axes: AXES });
    const onManage = vi.fn(async () => {});
    const onFeedback = vi.fn();
    await render(createElement(VariantsView, { source, onManage, onFeedback }));
    expect(source.getSelections().headline).toBe('a');
    await click(byText('Actions for Bold'));
    const dialog = () => container.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog().getAttribute('data-open')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Bold option actions');
    expect(dialog().querySelector('.isotone-menu-heading')?.textContent).toBe('BoldHeadline');
    expect(source.getSelections().headline).toBe('a');
    await click(byText('Close selector actions'));
    await act(async () => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      byText('Plain')?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
    expect(dialog().getAttribute('aria-label')).toBe('Plain option actions');
    // The default option cannot be removed, but it can be the one that is kept.
    expect(byText('Remove this option')?.hasAttribute('disabled')).toBe(true);
    expect(byText('Keep only this')?.hasAttribute('disabled')).toBe(false);
    await click(byText('Close selector actions'));
    await click(byText('Actions for Bold'));
    await click(byText('Feedback on this option'));
    expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ axisId: 'headline', optionId: 'b' }));
    await click(byText('Actions for Bold'));
    await click(byText('Keep only this'));
    expect(onManage).toHaveBeenCalledWith(
      { axisId: 'headline', action: 'keep-option', optionId: 'b' },
      expect.objectContaining({ axisId: 'headline', optionId: 'b', optionLabel: 'Bold' }),
    );
  });

  it('keeps the more button outside the option button', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    const more = byText('Actions for Bold');
    expect(more?.closest('button:not(.isotone-opt-more)')).toBeNull();
    expect(more?.parentElement?.classList.contains('isotone-opt')).toBe(true);
  });

  it('keep-option removes the selector and makes the option the pick, colours by swatch value', async () => {
    const colour: VariantAxis = {
      kind: 'color',
      id: 'accent',
      label: 'Accent',
      defaultColor: '#111111',
      swatches: [
        { id: 'ink', label: 'Ink', value: '#111111' },
        { id: 'sky', label: 'Sky', value: '#3b82f6' },
      ],
    };
    const source = createVariantsSource({ axes: [...AXES, colour] });
    await source.manage?.({ axisId: 'headline', action: 'keep-option', optionId: 'b' });
    await source.manage?.({ axisId: 'accent', action: 'keep-option', optionId: 'sky' });
    expect(source.getAxes().map((a) => a.id)).toEqual(['haze']);
    expect(source.getSelections()).toMatchObject({ headline: 'b', accent: '#3b82f6' });
    await expect(source.manage?.({ axisId: 'haze', action: 'keep-option', optionId: 'x' })).rejects.toThrow();
    const again = createVariantsSource({ axes: AXES });
    await expect(again.manage?.({ axisId: 'headline', action: 'keep-option', optionId: 'zzz' })).rejects.toThrow('no longer available');
  });

  it('updates an open menu when its source removes an option', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    await click(byText('Headline actions'));
    await act(async () => {
      await source.manage?.({ action: 'remove-axis', axisId: 'headline' });
    });
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.querySelector('.isotone-vars-body')?.hasAttribute('inert')).toBe(false);
  });

  // Rendering 500 selectors takes seconds in jsdom on a loaded or Windows
  // runner, so these two tests get more than the default 5 s.
  it('renders a large selector set without truncating the available choices', async () => {
    const axes: VariantAxis[] = Array.from({ length: 500 }, (_, i) => ({
      id: `axis-${i}`,
      label: `Selector ${i} ${'long label '.repeat(20)}`,
      defaultOption: 'a',
      options: [
        { id: 'a', label: 'Default' },
        { id: 'b', label: 'Alternative' },
      ],
    }));
    const source = createVariantsSource({ axes });
    await render(createElement(VariantsView, { source }));
    await renderRemaining();
    expect(container.querySelectorAll('.isotone-axis')).toHaveLength(500);
    const last = container.querySelectorAll<HTMLButtonElement>('.isotone-seg')[999];
    await click(last);
    expect(source.getSelections()['axis-499']).toBe('b');
    expect(last?.getAttribute('aria-checked')).toBe('true');
  }, 30_000);

  it('renders the visible axes and hides the conditional one at default', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));

    expect(labels()).toEqual(['Headline', 'Haze']);
    expect(container.querySelector('.isotone-hairline')).toBeNull();
    expect(container.querySelector('.isotone-range')).not.toBeNull();
    expect(container.querySelector('.isotone-axis-value')?.textContent).toBe('30%');
    expect(byText('Revert')).toBeUndefined();
    expect(byText('Bold')?.getAttribute('title')).toBeNull();
  });

  it('a segment reveals dependent controls and its own action menu resets it', async () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes: AXES, onChange });
    await render(createElement(VariantsView, { source }));

    await click(byText('Bold'));
    expect(source.getSelections().headline).toBe('b');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ headline: 'b' }));
    expect(byText('Bold')?.classList.contains('isotone-seg-on')).toBe(true);
    expect(labels()).toEqual(['Headline', 'Tagline', 'Haze']);

    await click(byText('Headline actions'));
    await click(byText('Reset to default'));
    expect(source.getSelections().headline).toBe('a');
    expect(labels()).toEqual(['Headline', 'Haze']);
    expect(byText('Revert')).toBeUndefined();
  });

  it('the range input writes back through the source', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));

    const range = container.querySelector<HTMLInputElement>('.isotone-range');
    if (!range) throw new Error('no range');
    // Through the prototype setter: React's value tracker wraps the instance
    // property, and a plain assignment would leave it thinking nothing changed.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      set?.call(range, '0.7');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(source.getSelections().haze).toBe('0.7');
    expect(container.querySelector('.isotone-axis-value')?.textContent).toBe('70%');
  });

  it('Make default hands the selections to the source and reports back', async () => {
    const saveDefaults = vi.fn(async () => {});
    const source = createVariantsSource({ axes: AXES, saveDefaults });
    await render(createElement(VariantsView, { source }));
    await click(byText('Bold'));

    await click(byText('Make default'));
    expect(saveDefaults).toHaveBeenCalledTimes(1);
    expect(saveDefaults).toHaveBeenCalledWith({ headline: 'b', haze: '0.3', tagline: 'x' });
    expect(container.querySelector('.isotone-save-count')?.textContent).toBe('Default request saved');
  });

  it('counts the changed picks beside Make default', async () => {
    const source = createVariantsSource({ axes: AXES, saveDefaults: async () => {} });
    await render(createElement(VariantsView, { source }));
    await click(byText('Bold'));
    expect(container.querySelector('.isotone-save-count')?.textContent).toBe('1 pick changed');
    await act(async () => source.setSelection('haze', '0.6'));
    expect(container.querySelector('.isotone-save-count')?.textContent).toBe('2 picks changed');
  });

  it('marks the source default where each choice is made', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    expect(byText('Plain')?.classList.contains('isotone-is-default')).toBe(true);
    expect(byText('Bold')?.classList.contains('isotone-is-default')).toBe(false);
    expect(container.querySelector<HTMLElement>('.isotone-range-wrap')?.style.getPropertyValue('--iso-default-at')).toBe('0.3');
    expect(container.querySelector('.isotone-range-tick')).toBeNull();
    await act(async () => source.setSelection('haze', '0.6'));
    expect(container.querySelector('.isotone-range-tick')).not.toBeNull();
  });

  it('shows Save only while visible choices differ from defaults', async () => {
    const source = createVariantsSource({ axes: AXES, saveDefaults: async () => {} });
    await render(createElement(VariantsView, { source }));
    expect(byText('Make default')).toBeUndefined();
    await click(byText('Bold'));
    expect(byText('Make default')).toBeDefined();
    await click(byText('Plain'));
    expect(byText('Make default')).toBeUndefined();
    await act(async () => source.setSelection('tagline', 'y'));
    expect(byText('Make default')).toBeUndefined();
  });

  it('a failed save says so', async () => {
    const source = createVariantsSource({
      axes: AXES,
      saveDefaults: async () => {
        throw new Error('nope');
      },
    });
    await render(createElement(VariantsView, { source }));
    await click(byText('Bold'));
    await click(byText('Make default'));
    expect(container.querySelector('.isotone-save-count')?.textContent).toBe('Could not save. Try again.');
  });

  it('omits the save row when the source cannot save', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(VariantsView, { source }));
    expect(byText('Make default')).toBeUndefined();
  });

  it('calls refresh() once on mount when the source has one', async () => {
    const refresh = vi.fn(async () => {});
    const source = Object.assign(createVariantsSource({ axes: AXES }), { refresh });
    await render(createElement(VariantsView, { source }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders a thumbnail grid when every option has an image', async () => {
    const source = createVariantsSource({
      axes: [
        {
          id: 'hero',
          label: 'Hero',
          options: [
            { id: 'a', label: 'Left', image: 'data:,a' },
            { id: 'b', label: 'Right', image: 'data:,b' },
          ],
          defaultOption: 'a',
        },
      ],
    });
    await render(createElement(VariantsView, { source }));
    expect(container.querySelectorAll('.isotone-grid .isotone-thumb')).toHaveLength(2);
    expect(container.querySelector('.isotone-thumb[aria-checked=true]')?.textContent).toBe('Left');
    expect(container.querySelector('.isotone-segs')).toBeNull();
  });

  it('moves a row at a time with Up and Down in a thumbnail grid', async () => {
    const options = ['One', 'Two', 'Three'].map((label, i) => ({ id: String(i), label, image: `data:,${i}` }));
    const source = createVariantsSource({ axes: [{ id: 'hero', label: 'Hero', options, defaultOption: '0' }] });
    await render(createElement(VariantsView, { source }));
    const press = (key: string) =>
      act(async () => {
        const checked = container.querySelector<HTMLElement>('.isotone-thumb[aria-checked=true]');
        checked?.focus();
        checked?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    const picks: (string | undefined)[] = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight']) {
      await press(key);
      picks.push(source.getSelections().hero);
    }
    // Down goes to the next row and stops at the last; Right goes along and wraps.
    expect(picks).toEqual(['2', '2', '0', '1', '2', '0']);
  });

  it('renders colour swatches and the custom picker', async () => {
    const source = createVariantsSource({
      axes: [
        {
          kind: 'color',
          id: 'accent',
          label: 'Accent',
          defaultColor: '#ea382e',
          swatches: [
            { id: 'red', label: 'Red', value: '#ea382e' },
            { id: 'blue', label: 'Blue', value: '#3b82f6' },
          ],
        },
      ],
    });
    await render(createElement(VariantsView, { source }));
    expect(container.querySelectorAll('.isotone-swatch')).toHaveLength(2);
    expect(container.querySelector('.isotone-swatch[aria-checked=true]')?.getAttribute('aria-label')).toBe('Red');
    expect(container.querySelector('input[type=color]')).toBeNull();
    expect(container.querySelector('.isotone-axis-value')?.textContent).toBe('#EA382E');

    await click(byText('Blue'));
    expect(source.getSelections().accent).toBe('#3b82f6');
    expect(container.querySelector('.isotone-swatch[aria-checked=true]')?.getAttribute('aria-label')).toBe('Blue');
  });

  it('picks a custom colour in the panel, not the native popup', async () => {
    const source = createVariantsSource({
      axes: [
        {
          kind: 'color',
          id: 'accent',
          label: 'Accent',
          defaultColor: '#ea382e',
          swatches: [
            { id: 'red', label: 'Red', value: '#ea382e' },
            { id: 'blue', label: 'Blue', value: '#3b82f6' },
          ],
        },
      ],
    });
    await render(createElement(VariantsView, { source }));
    const picker = container.querySelector<HTMLButtonElement>('.isotone-picker');
    await click(picker);
    expect(picker?.getAttribute('aria-expanded')).toBe('true');
    const hex = container.querySelector<HTMLInputElement>('.isotone-colour-hex');
    if (!hex) throw new Error('no hex field');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      set?.call(hex, '12ab34');
      hex.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(source.getSelections().accent).toBe('#12ab34');
    expect(picker?.getAttribute('data-custom')).toBe('true');
    const handle = container.querySelector<HTMLElement>('.isotone-colour-handle');
    await act(async () => {
      handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
    });
    expect(source.getSelections().accent).not.toBe('#12ab34');
    await act(async () => {
      handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('.isotone-colour')).toBeNull();
    expect(picker?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('IsotonePanel with variants', () => {
  const fab = () => container.querySelector<HTMLButtonElement>('.isotone-fab');
  const tabs = () => container.querySelectorAll('[role=tab]');

  it('without an endpoint it is variants only: no tabs, no composer', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    await click(fab());

    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.isotone-vars')).not.toBeNull();
    expect(container.querySelector('.isotone-textarea')).toBeNull();
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Variants');
  });

  it('opens both surfaces independently and keeps the draft while switching variants', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/api/isotone/notes' }, variants: source }));
    await click(fab());
    await click(byText('Variants'));
    expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
    expect(tabs()).toHaveLength(0);
    const textarea = container.querySelector('textarea');
    if (!textarea) throw new Error('missing composer');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(textarea, 'Try another direction');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Bold'));
    expect(textarea.value).toBe('Try another direction');
    await click(byText('Close variants'));
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
    expect(textarea.value).toBe('Try another direction');
  });

  it('grows the composer with text and shrinks after clearing it', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/api/isotone/notes' } }));
    await click(fab());
    const field = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!field) throw new Error('missing composer');
    expect(field.style.height).toBe('22px');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, get: () => field.value.split('\n').length * 20 + 2 });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const type = async (value: string) =>
      act(async () => {
        setter?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type('One\nTwo\nThree');
    expect(field.style.height).toBe('62px');
    await type('');
    expect(field.style.height).toBe('22px');
  });

  it('remeasures the scroll-through inset when context changes without changing the text', async () => {
    const feedback = 'One\nTwo';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: 'existing',
            feedback,
            route: '/',
            element: null,
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })),
    );
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(fab());
    const field = container.querySelector('textarea');
    if (!field) throw new Error('missing composer');
    Object.defineProperty(field, 'scrollHeight', {
      configurable: true,
      get: () => field.value.split('\n').length * 20 + (field.parentElement?.previousElementSibling?.childElementCount ? 12 : 14),
    });
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(field, feedback);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(field.style.height).toBe('54px');
    await click(container.querySelector('.isotone-note-hit'));
    expect(field.value).toBe(feedback);
    expect(field.style.height).toBe('52px');
  });

  it('keeps overflow labels hit-testable and adds titles only while truncated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: 'existing',
            feedback: 'Review this section',
            route: '/',
            done: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            element: {
              selector: '#section',
              tag: 'section',
              text: 'A long pinned section label',
              rect: { x: 0, y: 0, width: 100, height: 100 },
            },
          },
        ],
      })),
    );
    await render(
      createElement(IsotonePanel, { route: '/', variants: createVariantsSource({ axes: AXES }), store: { endpoint: '/notes' } }),
    );
    await click(fab());
    await click(byText('Variants'));
    const labels = Array.from(
      container.querySelectorAll<HTMLElement>('.isotone-axis-label > span, .isotone-seg > span, .isotone-meta .isotone-chip > span'),
    );
    expect(labels.length).toBeGreaterThan(3);
    expect(container.querySelector('.isotone-meta .isotone-chip > span')).not.toBeNull();
    for (const label of labels) {
      expect(getComputedStyle(label).pointerEvents).not.toBe('none');
      let availableWidth = 60;
      Object.defineProperties(label, {
        scrollWidth: { configurable: true, value: 120 },
        clientWidth: { configurable: true, get: () => availableWidth },
      });
      await act(async () => {
        label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      });
      expect(label.title).toBe(label.textContent?.trim());
      availableWidth = 160;
      await act(async () => {
        label.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
      });
      expect(label.hasAttribute('title')).toBe(false);
    }
  });

  it('with an endpoint but no axes it is the notes panel as before', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes' },
        variants: source,
      }),
    );
    await click(fab());
    expect(tabs()).toHaveLength(0);
    expect(container.querySelector('.isotone-textarea')).not.toBeNull();
    expect(container.querySelector('.isotone-variants-panel')?.getAttribute('data-open')).toBe('false');
  });

  it('with neither notes nor axes it renders nothing', async () => {
    const source = createVariantsSource({ axes: [] });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    expect(fab()).toBeNull();
  });

  it('refreshes remote axes on mount and reopen', async () => {
    // Like the overlay adapter: no axes until refresh() has listed them.
    const inner = createVariantsSource({ axes: [] });
    const refresh = vi.fn(async () => inner.setAxes(AXES));
    const source = Object.assign(inner, { refresh });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes' },
        variants: source,
      }),
    );
    // Once at mount, because the source had nothing to show yet.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(tabs()).toHaveLength(0);

    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.isotone-rail-button')).toHaveLength(2);

    await click(fab());
    await click(fab());
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('with no endpoint, a source that only has axes after refresh still gets a launcher', async () => {
    // `mountIsotone({ variants: 'overlay' })` with no notes endpoint: the
    // panel had nothing to render until the listing arrived, and nothing to
    // trigger the listing but an open, so the launcher never appeared.
    const inner = createVariantsSource({ axes: [] });
    let deliver: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((done) => {
          deliver = () => {
            inner.setAxes(AXES);
            done();
          };
        }),
    );
    const source = Object.assign(inner, { refresh });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fab()).toBeNull();

    await act(async () => deliver());
    expect(fab()).not.toBeNull();
    // Not asked again once it has something to show.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh at mount when the source already has axes', async () => {
    const refresh = vi.fn(async () => {});
    const source = Object.assign(createVariantsSource({ axes: AXES }), { refresh });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('panel refinements for variants-only hosts', () => {
  it('initially opens variants when requested, with feedback still available', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/api/isotone/notes', key: 'preview' },
        variants: source,
        defaultTab: 'variants',
      }),
    );
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelector('.isotone-vars')).not.toBeNull();
    expect(container.querySelector('.isotone-notes-panel')?.hasAttribute('inert')).toBe(true);
  });

  it('labels a variants-only launcher as Variants, with an icon', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    const button = container.querySelector('.isotone-fab');
    expect(button?.getAttribute('aria-label')).toBe('Variants');
    expect(button?.querySelector('svg')).not.toBeNull();
  });
});

describe('mountIsotone variants options', () => {
  beforeEach(() => vi.useFakeTimers());

  it('mounts nothing without an endpoint or a source', () => {
    const off = mountIsotone({});
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts nothing for a variants-only source with no axes and no refresh', () => {
    const off = mountIsotone({ variants: createVariantsSource({ axes: [] }) });
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
    off();
    vi.runAllTimers();
  });

  it('mounts with only a variants source', () => {
    const off = mountIsotone({ variants: createVariantsSource({ axes: AXES }) });
    expect(document.querySelector('[data-isotone="root"]')).not.toBeNull();
    off();
    vi.runAllTimers();
    expect(document.querySelector('[data-isotone="root"]')).toBeNull();
  });

  it("'overlay' lists from the variants endpoint on open", async () => {
    vi.useRealTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/isotone/variants')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: [
              {
                id: 'bolder',
                label: 'Bolder',
                createdAt: '2026-09-01T00:00:00.000Z',
                files: {},
                stale: [],
                missing: [],
              },
            ],
            active: [],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);

    const off = mountIsotone({ endpoint: '/api/isotone/notes', variants: 'overlay' });
    // The mount renders one macrotask later.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    await act(async () => {
      shadow.querySelector('.isotone-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Let the listing resolve and the panel re-render with the new axis.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/isotone/variants');
    expect(shadow.querySelectorAll('.isotone-rail-button')).toHaveLength(2);

    // An untouched overlay has nothing to promote; the save action stays hidden.
    await act(async () => {
      shadow.querySelector('.isotone-rail-button[aria-label=Variants]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(shadow.querySelector('.isotone-save')).toBeNull();

    off();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("'overlay' renders one selector per group and posts the whole active set", async () => {
    vi.useRealTimers();
    // Two decisions on this route: a table style (two variants over one file,
    // grouped by that overlap) and a settings layout (grouped by name), plus
    // one made for another route that must not show.
    const at = '2026-09-01T00:00:00.000Z';
    let active: string[] = ['table-dense'];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/isotone/variants/active' && init?.method === 'POST') {
        active = JSON.parse(String(init.body)).active;
        return { ok: true, status: 200, json: async () => ({ active }) };
      }
      if (url.startsWith('/api/isotone/variants')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: [
              {
                id: 'table-dense',
                label: 'Dense rows',
                route: '/projects',
                element: { tag: 'table', text: '', selector: 'table' },
                createdAt: at,
                files: { 'src/table.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'table-striped',
                label: 'Striped',
                route: '/projects',
                createdAt: at,
                files: { 'src/table.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'settings-tabs',
                label: 'Tabs',
                group: 'settings',
                groupLabel: 'Settings',
                section: 'Account',
                createdAt: at,
                files: { 'src/Settings.tsx': { base: null } },
                stale: [],
                missing: [],
              },
              {
                id: 'home-hero',
                label: 'Hero',
                route: '/',
                createdAt: at,
                files: { 'src/Hero.tsx': { base: null } },
                stale: [],
                missing: [],
              },
            ],
            active,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal('fetch', fetchMock);

    const off = mountIsotone({
      endpoint: '/api/isotone/notes',
      variants: 'overlay',
      getRoute: () => '/projects',
    });
    const tick = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    await tick();
    const shadow = document.querySelector('[data-isotone="root"]')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const clickIn = (el: Element | null | undefined) =>
      act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
      });
    const button = (text: string) => Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);

    await clickIn(shadow.querySelector('.isotone-fab'));
    await tick();
    await clickIn(shadow.querySelector('.isotone-rail-button[aria-label=Variants]'));
    const axisLabels = () => Array.from(shadow.querySelectorAll('.isotone-axis-label')).map((el) => el.textContent);
    expect(axisLabels()).toEqual(['table.tsx', 'Settings']);
    // A member's section puts the group's selector under that header.
    expect(Array.from(shadow.querySelectorAll('.isotone-section-toggle span')).map((el) => el.textContent)).toEqual(['Account']);
    expect(button('Dense rows')?.classList.contains('isotone-seg-on')).toBe(true);
    expect(button('Hero')).toBeUndefined();

    // Picking in one selector keeps the other's pick and posts both.
    await clickIn(button('Tabs'));
    const posts = () =>
      (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])
        .filter((c) => String(c[0]) === '/api/isotone/variants/active')
        .map((c) => JSON.parse(String(c[1]?.body)));
    expect(posts().at(-1)).toEqual({ active: ['table-dense', 'settings-tabs'] });
    await tick();
    expect(button('Tabs')?.classList.contains('isotone-seg-on')).toBe(true);
    expect(button('Dense rows')?.classList.contains('isotone-seg-on')).toBe(true);

    // A sibling replaces only its own group's member.
    await clickIn(button('Striped'));
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs', 'table-striped'] });

    // Make default names every pick, in panel order, and pins the first.
    await clickIn(button('Make default'));
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    const note = calls.find((c) => String(c[0]) === '/api/isotone/notes' && c[1]?.method === 'POST');
    const body = JSON.parse(String(note?.[1]?.body));
    expect(body.feedback).toBe(
      '[set-defaults] Make the default: "table.tsx: Striped" (table-striped); "Account › Settings: Tabs" (settings-tabs).',
    );
    expect(body.payload).toEqual({ variants: 'table-striped, settings-tabs' });
    expect(body.route).toBe('/projects');

    // Default in one selector drops that group and leaves the other.
    const defaults = Array.from(shadow.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Default');
    await clickIn(defaults[0]);
    expect(posts().at(-1)).toEqual({ active: ['settings-tabs'] });

    off();
    await tick();
  });
});

describe('review dock interactions', () => {
  it.each(['mouse', 'pen'])('expands on %s hover, stays open across the pill and collapses on exit', async (pointerType) => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    await render(
      createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: createVariantsSource({ axes: AXES }) }),
    );
    const dock = container.querySelector('.isotone-root');
    const launcher = container.querySelector('.isotone-fab');
    const track = container.querySelector('.isotone-rail-track');
    const feedback = container.querySelector('.isotone-rail-button[aria-label="Feedback"]');
    async function pointer(type: string, target: Element | null, relatedTarget: EventTarget | null, device = pointerType) {
      const event = new MouseEvent(type, { bubbles: true, relatedTarget });
      Object.defineProperty(event, 'pointerType', { value: device });
      await act(async () => {
        target?.dispatchEvent(event);
      });
    }
    await pointer('pointerenter', dock, null, 'touch');
    expect(dock?.getAttribute('data-expanded')).toBe('false');
    await pointer('pointerleave', dock, document.body, 'touch');
    await pointer('pointerenter', dock, null);
    expect(dock?.getAttribute('data-expanded')).toBe('true');
    expect(dock?.getAttribute('data-open')).toBe('false');
    expect(launcher?.getAttribute('aria-hidden')).toBe('true');
    // Moving through the rim/gap to an icon must not collapse the hover target.
    await pointer('pointerout', launcher, track);
    await pointer('pointerover', track, launcher);
    await pointer('pointerout', track, feedback);
    await pointer('pointerover', feedback, track);
    expect(dock?.getAttribute('data-expanded')).toBe('true');
    await pointer('pointerleave', dock, document.body);
    expect(dock?.getAttribute('data-expanded')).toBe('false');
    // Touch/click remains usable without hover capability.
    await click(launcher);
    expect(dock?.getAttribute('data-open')).toBe('true');
  });

  it('replaces the launcher with two tools and collapses after both surfaces close', async () => {
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/notes' },
        variants: createVariantsSource({ axes: AXES }),
        defaultTab: 'variants',
      }),
    );
    const rail = container.querySelector('.isotone-rail');
    const launcher = container.querySelector('.isotone-fab');
    expect(rail?.getAttribute('data-expanded')).toBe('false');
    await click(launcher);
    await click(byText('Feedback'));
    expect(launcher?.getAttribute('aria-hidden')).toBe('true');
    expect(launcher?.getAttribute('tabindex')).toBe('-1');
    expect(rail?.getAttribute('data-tools')).toBe('2');
    await click(byText('Close variants'));
    await click(byText('Close feedback'));
    expect(rail?.getAttribute('data-expanded')).toBe('false');
    expect(launcher?.getAttribute('aria-hidden')).toBe('false');
  });

  it('keeps selectors usable while removal requests are read, edited and cancelled', async () => {
    let saved: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = [{ ...JSON.parse(String(init.body)), id: 'removal', done: false, createdAt: new Date().toISOString() }];
        return { ok: true, json: async () => ({ id: 'removal' }) };
      }
      if (init?.method === 'DELETE') saved = [];
      return { ok: true, json: async () => saved };
    });
    vi.stubGlobal('fetch', fetchMock);
    const source = createVariantsSource({ axes: AXES });
    source.setSelection('headline', 'b');
    const manage = vi.spyOn(source, 'manage');
    const props = { route: '/', store: { endpoint: '/notes' }, variants: source, defaultTab: 'variants' as const };
    await render(createElement(IsotonePanel, props));
    await click(container.querySelector('.isotone-fab'));
    await click(byText('Headline actions'));
    await click(byText('Remove Bold'));
    expect(saved[0]?.variantAction).toEqual({ axisId: 'headline', action: 'remove-option', optionId: 'b' });
    expect(manage).not.toHaveBeenCalled();
    expect(labels()).toEqual(['Headline', 'Tagline', 'Haze']);
    expect(byText('Cancel removal: Remove “Bold” from Headline.')).toBeDefined();
    await click(container.querySelector('.isotone-note-hit'));
    expect(container.querySelector('textarea')?.value).toContain('Remove “Bold”');
    await typeFeedback('Remove this option after checking the alternative layout.');
    await click(byText('Save edit'));
    expect(saved[0]?.variantAction).toEqual({ axisId: 'headline', action: 'remove-option', optionId: 'b' });
    expect(saved[0]?.variant).toMatchObject({ axisId: 'headline', optionId: 'b' });
    expect(saved[0]?.feedback).toBe('Remove this option after checking the alternative layout.');
    await click(byText('Headline actions'));
    expect(byText('Remove Bold')?.hasAttribute('disabled')).toBe(true);
    await click(byText('Close selector actions'));
    // Persisted requests never hide or mutate the source controls, even on remount.
    await act(async () => root?.unmount());
    root = null;
    await render(createElement(IsotonePanel, props));
    await click(container.querySelector('.isotone-fab'));
    expect(labels()).toEqual(['Headline', 'Tagline', 'Haze']);
    // The rail button's name carries the count the badge shows.
    await click(byText('Feedback, 1 note'));
    await click(container.querySelector('[title="Cancel removal"]'));
    expect(labels()).toEqual(['Headline', 'Tagline', 'Haze']);
    expect(source.getSelections().headline).toBe('b');
    expect(source.getAxes()).toHaveLength(3);
  });

  it('saves a keep-only request from any option row, keeping the default action for the default', async () => {
    const saved: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') {
          saved.push({ ...JSON.parse(String(init.body)), id: `keep-${saved.length}`, done: false, createdAt: new Date().toISOString() });
          return { ok: true, json: async () => ({ id: `keep-${saved.length - 1}` }) };
        }
        return { ok: true, json: async () => saved };
      }),
    );
    const source = createVariantsSource({ axes: AXES });
    await render(
      createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: source, defaultTab: 'variants' as const }),
    );
    await click(container.querySelector('.isotone-fab'));
    await click(byText('Headline actions'));
    expect(byText('Keep default only')).toBeDefined();
    await click(byText('Keep only Bold'));
    expect(saved[0]?.variantAction).toEqual({ axisId: 'headline', action: 'keep-option', optionId: 'b' });
    expect(saved[0]?.feedback).toContain('Keep only “Bold” for Headline; make it the default');
    await click(byText('Headline actions'));
    expect(byText('Keep only Bold')?.hasAttribute('disabled')).toBe(true);
    const defaultRow = [...container.querySelectorAll('.isotone-option-row')].find((row) => row.querySelector('small'));
    await click(defaultRow?.querySelector('[aria-label^="Keep only"]') ?? null);
    expect(saved[1]?.variantAction).toEqual({ axisId: 'headline', action: 'keep-default' });
    expect(source.getAxes()).toHaveLength(3);
  });

  async function typeFeedback(text: string) {
    const input = container.querySelector('textarea');
    if (!input) throw new Error('no composer');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  it.each(['dark', 'light'] as const)('focuses the full %s composer without hijacking its controls', async (theme) => {
    document.body.style.backgroundColor = theme === 'dark' ? 'black' : 'white';
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const field = container.querySelector('textarea');
    expect(container.querySelector('.isotone-root')?.getAttribute('data-theme')).toBe(theme);
    if (!field) throw new Error('no composer');
    for (const selector of ['.isotone-input', '.isotone-toolbar']) {
      await act(async () => field.blur());
      await click(container.querySelector(selector));
      expect(document.activeElement).toBe(field);
    }
    await typeFeedback('Keep the selection');
    field.setSelectionRange(2, 6);
    const focus = vi.spyOn(field, 'focus');
    await click(field);
    expect(focus).not.toHaveBeenCalled();
    expect([field.selectionStart, field.selectionEnd]).toEqual([2, 6]);
    const picker = byText('Select elements');
    await act(async () => picker?.focus());
    await click(picker);
    expect(picker?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(picker);
    expect(focus).not.toHaveBeenCalled();
  });
  it('switches theme without replacing controls or losing review state', async () => {
    const source = createVariantsSource({ axes: AXES, saveDefaults: async () => {} });
    const props = { route: '/', store: { endpoint: '/notes' }, variants: source };
    await render(createElement(IsotonePanel, props));
    await click(container.querySelector('.isotone-fab'));
    await click(byText('Variants'));
    await click(byText('Bold'));
    await typeFeedback('Keep this draft while changing the theme');
    const input = container.querySelector('textarea');
    const variants = container.querySelector('.isotone-variants-panel');
    const rail = container.querySelector('.isotone-rail-track');
    for (const theme of ['light', 'dark'] as const) {
      await act(async () => {
        document.body.style.backgroundColor = theme === 'dark' ? 'black' : 'white';
        root?.render(createElement(IsotonePanel, props));
      });
      // Page mutations are sampled at most every 200ms: wait for the sample, not for a guess at its timing.
      await vi.waitFor(
        async () => {
          await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
          expect(container.querySelector('.isotone-root')?.getAttribute('data-theme')).toBe(theme);
        },
        { timeout: 5000, interval: 20 },
      );
      expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
      expect(container.querySelector('textarea')).toBe(input);
      expect(input?.value).toBe('Keep this draft while changing the theme');
      expect(container.querySelector('.isotone-variants-panel')).toBe(variants);
      expect(container.querySelector('.isotone-rail-track')).toBe(rail);
      expect(source.getSelections().headline).toBe('b');
      expect(byText('Make default')).toBeDefined();
      await click(byText('Headline actions'));
      expect(container.querySelector('.isotone-axis-menu')?.getAttribute('data-open')).toBe('true');
      expect(byText('Remove Plain')?.hasAttribute('disabled')).toBe(true);
      // Escape dismisses only the action sheet, preserving both surfaces and draft.
      await act(async () =>
        container
          .querySelector('.isotone-axis-menu button')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
      );
      expect(container.querySelector('.isotone-axis-menu')?.getAttribute('data-open')).not.toBe('true');
      expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
    }
  });
  it('captures the shortcut inside an input, starts selecting, preserves variants, and disables keyboard motion', async () => {
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/notes' },
        variants: createVariantsSource({ axes: AXES }),
        defaultTab: 'variants',
      }),
    );
    await click(container.querySelector('.isotone-fab'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Select elements"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('.isotone-root')?.getAttribute('data-instant')).toBe('true');
    input.remove();
  });
  it('moves between selecting and the field with the shortcut', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    const press = () =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
        );
        await new Promise((r) => requestAnimationFrame(r));
      });
    const selecting = () => container.querySelector('[aria-label="Select elements"]')?.getAttribute('aria-pressed');
    await press();
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
    expect(selecting()).toBe('true');
    await press();
    expect(selecting()).toBe('false');
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    await press();
    expect(selecting()).toBe('true');
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
  });
  it('attaches an option reference and keeps variants visible while writing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    await render(
      createElement(IsotonePanel, {
        route: '/',
        store: { endpoint: '/notes' },
        variants: createVariantsSource({ axes: AXES }),
        defaultTab: 'variants',
      }),
    );
    await click(container.querySelector('.isotone-fab'));
    await click(byText('Headline actions'));
    await click(byText('Feedback on Bold'));
    expect(container.querySelectorAll('.isotone-panel[data-open=true]')).toHaveLength(2);
    expect(container.querySelector('.isotone-chip')?.textContent).toContain('Headline / Bold');
    await typeFeedback('A little less heavy');
    vi.stubGlobal('fetch', fetchMock);
    await click(byText('Send note'));
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(call?.[1].body)).variant).toEqual({
      axisId: 'headline',
      label: 'Headline',
      optionId: 'b',
      optionLabel: 'Bold',
      value: 'a',
    });
  });
  it('pins several elements in one session, toggles a duplicate off, and saves every target', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    const a = document.createElement('button');
    a.id = 'one';
    a.textContent = 'One';
    const b = document.createElement('button');
    b.id = 'two';
    b.textContent = 'Two';
    document.body.append(a, b);
    const hit = vi.fn(() => a);
    Object.defineProperty(document, 'elementFromPoint', { value: hit, configurable: true });
    await click(byText('Select elements'));
    await click(a);
    hit.mockReturnValue(b);
    await click(b);
    expect(container.querySelectorAll('.isotone-chip')).toHaveLength(2);
    await click(b);
    expect(container.querySelectorAll('.isotone-chip')).toHaveLength(1);
    await click(b);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await typeFeedback('Align these two');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await click(byText('Send note'));
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(call?.[1].body));
    expect(body.elements.map((el: { selector: string }) => el.selector)).toEqual(['#one', '#two']);
    expect(body.element.selector).toBe('#one');
    a.remove();
    b.remove();
  });
  it('covers the composer while selecting, and Enter, Escape, Done or typing finishes', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    if (!textarea) throw new Error('missing composer');
    const press = (key: string, target: EventTarget = document.body) =>
      act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
      });
    const overlay = () => container.querySelector('.isotone-picking');

    await click(byText('Select elements'));
    expect(overlay()?.textContent).toContain('Click elements on the page');
    await press('Enter');
    expect(overlay()).toBeNull();

    await click(byText('Select elements'));
    await press('Escape');
    expect(overlay()).toBeNull();

    await click(byText('Select elements'));
    await click(byText('Done'));
    expect(overlay()).toBeNull();

    await click(byText('Select elements'));
    await press('m');
    expect(overlay()).toBeNull();
    expect((textarea.getRootNode() as ShadowRoot | Document).activeElement).toBe(textarea);

    // A focused composer with text is covered too, so Enter finishes instead of sending.
    await typeFeedback('More room');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await click(byText('Select elements'));
    await press('Enter', textarea);
    expect(overlay()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
  });
  it('starts selecting when feedback is opened with a pointer, and not from the keyboard', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    // A real pointer over the dock hits the panel, which select mode ignores.
    Object.defineProperty(document, 'elementFromPoint', { value: () => container.querySelector('.isotone-root'), configurable: true });
    const pointer = (el: Element | null | undefined) =>
      act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      });
    await pointer(container.querySelector('.isotone-fab'));
    // It opens already covered, so the field never shows through the fade.
    expect(container.querySelector('.isotone-picking')?.getAttribute('data-still')).toBe('true');
    expect(byText('Select elements')?.getAttribute('aria-pressed')).toBe('true');
    await pointer(byText('Feedback'));
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('.isotone-picking')).toBeNull();
    await click(byText('Feedback'));
    expect(container.querySelector('.isotone-picking')).toBeNull();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    await click(byText('Feedback'));
    await pointer(byText('Feedback'));
    expect(container.querySelector('.isotone-picking')).not.toBeNull();
  });
  it('floats the composer next to a pinned element and brings it back to the dock', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    const card = document.createElement('section');
    card.id = 'card';
    card.textContent = 'Card';
    document.body.append(card);
    card.getBoundingClientRect = () => new DOMRect(100, 200, 300, 80);
    Object.defineProperty(document, 'elementFromPoint', { value: () => card, configurable: true });
    const float = () => container.querySelector<HTMLElement>('.isotone-float');
    const away = () => container.querySelector('.isotone-away');
    const frame = () =>
      act(async () => {
        await new Promise((r) => requestAnimationFrame(r));
      });
    const size = (name: 'offsetWidth' | 'offsetHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('isotone-float') ? value : 0;
      });
    size('offsetWidth', 300);
    size('offsetHeight', 100);
    const pin = () =>
      act(async () => {
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 150, clientY: 230 }));
      });

    await click(byText('Select elements'));
    await pin();
    await frame();
    // The composer is now beside the click, focused, still selecting; the dock says where it went.
    expect(float()?.querySelector('.isotone-chip')?.textContent).toContain('Card');
    expect(float()?.style.left).toBe('162px');
    expect(float()?.style.top).toBe('242px');
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.activeElement).toBe(float()?.querySelector('textarea'));
    expect(byText('Select elements')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.isotone-picking')).toBeNull();
    expect(away()?.textContent).toContain('Writing on the page');
    expect(away()?.textContent).toContain('Next to Card');
    expect(container.querySelectorAll('.isotone-selected')).toHaveLength(1);

    await typeFeedback('Give this more room');
    // The draft is written in one place only.
    expect(away()?.textContent).not.toContain('Give this more room');
    // Enter finishes selecting and keeps the pin; the element keeps its outline.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(byText('Select elements')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.isotone-selected')).toHaveLength(1);
    // Escape after selecting puts it back in the dock with the draft and the pin.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(float()).toBeNull();
    expect(container.querySelectorAll('.isotone-selected')).toHaveLength(0);
    expect(container.querySelector('.isotone-notes-panel textarea')?.textContent).toBe('Give this more room');
    expect(container.querySelector('.isotone-notes-panel .isotone-chip')?.textContent).toContain('Card');

    // Pinning near the viewport's corner keeps the composer on screen.
    card.getBoundingClientRect = () => new DOMRect(innerWidth - 40, innerHeight - 40, 30, 30);
    await click(byText('Select elements'));
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: innerWidth - 20, clientY: innerHeight - 20 }));
    });
    expect(float()).toBeNull(); // Unpinned: the card was already pinned.
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: innerWidth - 20, clientY: innerHeight - 20 }));
    });
    const box = float();
    if (!box) throw new Error('composer did not float');
    // Too close to the right and bottom edges, so it opens to the left and above.
    expect(box.style.left).toBe(`${innerWidth - 20 - 12 - 300}px`);
    expect(box.style.top).toBe('auto');
    expect(box.style.bottom).toBe('32px');

    // Enter in the floating composer sends, and the composer returns to the dock.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      box.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST' }));
    expect(float()).toBeNull();
    expect(away()).toBeNull();
    card.remove();
  });
  it('cancels the selection on Escape, so selecting again starts fresh', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    const card = document.createElement('section');
    card.id = 'card';
    card.textContent = 'Card';
    document.body.append(card);
    Object.defineProperty(document, 'elementFromPoint', { value: () => card, configurable: true });
    const pressEscape = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

    await click(byText('Select elements'));
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
    });
    await typeFeedback('Keep this text');
    expect(container.querySelector('.isotone-float')).not.toBeNull();
    await pressEscape();
    expect(container.querySelector('.isotone-float')).toBeNull();
    expect(container.querySelectorAll('.isotone-chip')).toHaveLength(0);
    expect(container.querySelector('textarea')?.value).toBe('Keep this text');
    // Selecting again starts with nothing pinned.
    await click(byText('Select elements'));
    expect(container.querySelector('.isotone-picking')?.textContent).toContain('Click elements on the page');
    card.remove();
  });
  it('surfaces a failed removal request without losing options', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(
      createElement(VariantsView, {
        source,
        onManage: async () => {
          throw new Error('Disk unavailable');
        },
      }),
    );
    await click(byText('Headline actions'));
    await click(byText('Remove Bold'));
    expect(source.getAxes()).toHaveLength(3);
    expect(container.textContent).toContain('Disk unavailable');
    expect(source.getAxes()).toHaveLength(3);
    // The dialog stays open and the same option can be tried again.
    expect(container.querySelector('.isotone-axis-menu')?.getAttribute('data-open')).toBe('true');
    expect(document.activeElement).toBe(byText('Remove Bold'));
  });
  describe('sections', () => {
    const SECTIONED: VariantAxis[] = [
      { id: 'logo', label: 'Header > Logo size', kind: 'range', min: 16, max: 48, step: 2, defaultValue: 24, unit: 'px' },
      {
        id: 'layout',
        label: 'Layout',
        defaultOption: 'row',
        options: [
          { id: 'row', label: 'Row' },
          { id: 'grid', label: 'Grid' },
        ],
      },
      {
        id: 'ink',
        label: 'Ink',
        kind: 'color',
        defaultColor: '#111111',
        section: 'Header',
        swatches: [
          { id: 'black', label: 'Black', value: '#111111' },
          { id: 'blue', label: 'Blue', value: '#2255ff' },
        ],
      },
      {
        id: 'links',
        label: 'Footer > Links',
        defaultOption: 'a',
        options: [
          { id: 'a', label: 'Plain' },
          { id: 'b', label: 'Bold' },
        ],
      },
      {
        id: 'theme',
        label: 'Before > After',
        section: '',
        defaultOption: 'l',
        options: [
          { id: 'l', label: 'Light' },
          { id: 'd', label: 'Dark' },
        ],
      },
    ];
    const headers = () => Array.from(container.querySelectorAll('.isotone-section-toggle span')).map((el) => el.textContent);

    it('renders loose selectors first, then a sticky header per section with its count', async () => {
      await render(createElement(VariantsView, { source: createVariantsSource({ axes: SECTIONED }) }));
      expect(labels()).toEqual(['Layout', 'Before > After', 'Logo size', 'Ink', 'Links']);
      expect(headers()).toEqual(['Header', 'Footer']);
      const body = container.querySelector('.isotone-vars-body');
      expect(Array.from(body?.children ?? []).map((el) => el.className)).toEqual([
        'isotone-axis',
        'isotone-axis',
        'isotone-section',
        'isotone-section',
      ]);
      const header = container.querySelector('.isotone-section');
      expect(header?.querySelector('.isotone-section-toggle small')?.textContent).toBe('2');
      expect(header?.querySelector('h3 > button')?.getAttribute('aria-label')).toBe('Header, 2 selectors');
      // Controls keep their full name for assistive technology.
      expect(container.querySelector('input[type=range]')?.getAttribute('aria-label')).toBe('Header › Logo size');
      expect(byText('Header › Ink actions')).toBeDefined();
      expect(container.querySelector('.isotone-swatches[role="radiogroup"]')?.getAttribute('aria-label')).toBe('Header › Ink');
      expect(byText('Before > After actions')).toBeDefined();
    });

    it('shows no headers when nothing is sectioned', async () => {
      await render(createElement(VariantsView, { source: createVariantsSource({ axes: AXES.filter((axis) => !axis.section) }) }));
      expect(container.querySelector('.isotone-section')).toBeNull();
    });

    it('folds a section away and back, and keeps selections while folded', async () => {
      const source = createVariantsSource({ axes: SECTIONED });
      await render(createElement(VariantsView, { source }));
      await click(byText('Bold'));
      const toggle = byText('Footer, 1 selector');
      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      const body = document.getElementById(toggle?.getAttribute('aria-controls') ?? '');
      await click(toggle);
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');
      expect(body?.hidden).toBe(true);
      expect(labels()).not.toContain('Links');
      expect(toggle?.closest('.isotone-section')?.getAttribute('data-collapsed')).toBe('true');
      await click(toggle);
      expect(labels()).toContain('Links');
      expect(source.getSelections().links).toBe('b');
      expect(byText('Bold')?.getAttribute('aria-checked')).toBe('true');
    });

    it('titles the dialog with the short name and references the full one', async () => {
      const onFeedback = vi.fn();
      const onManage = vi.fn(async () => {});
      await render(createElement(VariantsView, { source: createVariantsSource({ axes: SECTIONED }), onFeedback, onManage }));
      await click(byText('Footer › Links actions'));
      const dialog = container.querySelector('.isotone-axis-menu');
      expect(dialog?.getAttribute('aria-label')).toBe('Footer › Links actions');
      expect(dialog?.querySelector('.isotone-menu-title strong')?.textContent).toBe('Links');
      await click(byText('Remove Bold'));
      expect(onManage).toHaveBeenCalledWith(
        { axisId: 'links', action: 'remove-option', optionId: 'b' },
        expect.objectContaining({ label: 'Footer › Links', optionLabel: 'Bold' }),
      );
      await click(byText('Feedback on this selector'));
      expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ axisId: 'links', label: 'Footer › Links' }));
      await click(byText('Header › Ink actions'));
      await click(byText('Feedback on Blue'));
      expect(onFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Header › Ink', optionLabel: 'Blue' }));
    });

    it('renders 500 sectioned selectors with every choice available', async () => {
      const axes: VariantAxis[] = Array.from({ length: 500 }, (_, i) => ({
        id: `axis-${i}`,
        label: `Area ${Math.floor(i / 12)} > Selector ${i} ${'long label '.repeat(i % 50 === 0 ? 20 : 0)}`,
        defaultOption: 'a',
        options: [
          { id: 'a', label: 'Default' },
          { id: 'b', label: 'Alternative' },
        ],
      }));
      const source = createVariantsSource({ axes });
      await render(createElement(VariantsView, { source }));
      await renderRemaining();
      expect(container.querySelectorAll('.isotone-axis')).toHaveLength(500);
      expect(container.querySelectorAll('.isotone-section')).toHaveLength(42);
      const last = container.querySelectorAll<HTMLButtonElement>('.isotone-seg')[999];
      await click(last);
      expect(source.getSelections()['axis-499']).toBe('b');
    }, 30_000);
  });
  describe('selector action dialog', () => {
    const SIZES: VariantAxis[] = [
      {
        id: 'size',
        label: 'Size',
        defaultOption: 's',
        options: ['s', 'm', 'l', 'xl'].map((id) => ({ id, label: id.toUpperCase() })),
      },
    ];
    /** A host that records requests the way the panel does: as pending actions. */
    function Host({ onFeedback = () => {}, axes = SIZES }: { onFeedback?: () => void; axes?: VariantAxis[] }) {
      const [source] = useState(() => createVariantsSource({ axes }));
      const [pending, setPending] = useState<VariantAction[]>([]);
      return createElement(VariantsView, {
        source,
        pendingActions: pending,
        onFeedback,
        onManage: async (action: VariantAction) => {
          setPending((list) => [...list, action]);
        },
      });
    }
    const dialog = () => container.querySelector('.isotone-axis-menu');
    const row = (id: string) => container.querySelector(`.isotone-option-row[data-option-id="${id}"]`);

    it('stays open while options are removed one after another, moving focus on', async () => {
      await render(createElement(Host));
      await click(byText('Size actions'));
      await click(byText('Remove M'));
      expect(dialog()?.getAttribute('data-open')).toBe('true');
      expect(row('m')?.textContent).toContain('Removal requested');
      expect(row('m')?.hasAttribute('data-requested')).toBe(true);
      expect(byText('Remove M')?.hasAttribute('disabled')).toBe(true);
      expect(document.activeElement).toBe(byText('Remove L'));
      await click(byText('Remove L'));
      expect(document.activeElement).toBe(byText('Remove XL'));
      // The last one has nothing below it and nothing removable above it.
      await click(byText('Remove XL'));
      expect(dialog()?.getAttribute('data-open')).toBe('true');
      expect(document.activeElement).toBe(byText('Reset to default'));
      expect(['m', 'l', 'xl'].every((id) => row(id)?.textContent?.includes('Removal requested'))).toBe(true);
      expect(row('s')?.textContent).not.toContain('Removal requested');
    });

    it('truncates only a long option label, never its Default or Removal requested tag', async () => {
      const long = 'An option label long enough to fill the whole dialog width and then some more';
      const axes: VariantAxis[] = [
        {
          id: 'size',
          label: 'Size',
          defaultOption: 's',
          options: [
            { id: 's', label: long },
            { id: 'm', label: long },
          ],
        },
      ];
      const style = document.createElement('style');
      style.textContent = PANEL_CSS;
      document.head.append(style);
      try {
        await render(createElement(Host, { axes }));
        await click(byText('Size actions'));
        await click(container.querySelector(`[aria-label="Remove ${long}"]:not(:disabled)`));
        for (const [id, tag] of [
          ['s', 'Default'],
          ['m', 'Removal requested'],
        ] as const) {
          const label = row(id)?.querySelector<HTMLElement>('.isotone-option-label');
          const tags = row(id)?.querySelector<HTMLElement>('.isotone-option-tags');
          // The ellipsized element holds the label alone; the tag is its sibling.
          expect(label?.textContent).toBe(long);
          expect(getComputedStyle(label as HTMLElement).textOverflow).toBe('ellipsis');
          expect(tags?.textContent).toBe(tag);
          expect(label?.contains(tags as Node)).toBe(false);
          expect(tags?.parentElement).toBe(label?.parentElement);
          expect(getComputedStyle(tags as HTMLElement).flexShrink).toBe('0');
        }
      } finally {
        style.remove();
      }
    });

    it('moves focus back up the list after removing the last removable option', async () => {
      await render(createElement(Host));
      await click(byText('Size actions'));
      await click(byText('Remove XL'));
      expect(document.activeElement).toBe(byText('Remove L'));
    });

    it('closes for decisions about the whole selector and for writing feedback', async () => {
      const onFeedback = vi.fn();
      await render(createElement(Host, { onFeedback }));
      const trigger = byText('Size actions');
      await click(trigger);
      await click(byText('Keep only L'));
      expect(dialog()?.getAttribute('data-open')).toBe('false');
      await click(trigger);
      expect(byText('Keep only L')?.hasAttribute('disabled')).toBe(true);
      await click(byText('Remove selector & options'));
      expect(dialog()?.getAttribute('data-open')).toBe('false');
      await click(trigger);
      await click(byText('Reset to default'));
      expect(dialog()?.getAttribute('data-open')).toBe('false');
      await click(trigger);
      await click(byText('Feedback on L'));
      expect(dialog()?.getAttribute('data-open')).toBe('false');
      expect(onFeedback).toHaveBeenCalledWith(expect.objectContaining({ axisId: 'size', optionId: 'l' }));
    });
  });
  it('does not expose destructive source actions without a feedback handler', async () => {
    const mutate = vi.fn();
    const source = createVariantsSource({ axes: AXES, onManage: mutate });
    source.setSelection('headline', 'b');
    await render(createElement(VariantsView, { source }));
    await click(byText('Headline actions'));
    expect(byText('Remove Bold')).toBeUndefined();
    expect(source.getSelections().headline).toBe('b');
    expect(source.getAxes()).toHaveLength(3);
    expect(mutate).not.toHaveBeenCalled();
  });
  it('saves edits to their original route and retains the original host payload', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === 'POST'
          ? { id: 'old' }
          : [
              {
                id: 'old',
                route: '/other',
                feedback: 'Old note',
                element: null,
                done: false,
                createdAt: new Date().toISOString(),
                payload: { old: true },
              },
              { id: 'here', route: '/', feedback: 'Note here', element: null, done: false, createdAt: new Date().toISOString() },
            ],
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, getPayload: () => ({ new: true }) }));
    await click(container.querySelector('.isotone-fab'));
    await click(container.querySelector('.isotone-page[title="/other"]'));
    await click(Array.from(container.querySelectorAll('.isotone-note-hit')).find((hit) => hit.textContent?.includes('Old note')) ?? null);
    await typeFeedback('Updated note');
    await click(byText('Save edit'));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.route).toBe('/other');
    expect(body.payload).toBeUndefined();
  });
});

describe('live notes', () => {
  const note = (id: string, extra: object = {}) => ({
    id,
    route: '/',
    feedback: `Note ${id}`,
    element: null,
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  type Answer = { rev: string; unchanged?: true; notes?: object[] } | 'down';
  function server(answers: Answer[]) {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const next = answers.length > 1 ? (answers.shift() as Answer) : answers[0];
        if (next === 'down') throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => next };
      }),
    );
    return urls;
  }
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));

  it('drops a note the agent closed, without a reload', async () => {
    // A server with real revisions: unchanged polls get no rows.
    let state = { rev: 'a', notes: [note('one'), note('two')] };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const asked = new URL(String(url), 'http://x').searchParams.get('rev');
        return { ok: true, status: 200, json: async () => (asked === state.rev ? { rev: state.rev, unchanged: true } : state) };
      }),
    );
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    await click(container.querySelector('.isotone-fab'));
    await flush();
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(2);
    state = { rev: 'b', notes: [note('two')] };
    await advance(2600);
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(1);
    // The next poll asks for the open backlog with the revision it last saw.
    await advance(2600);
    expect(urls.at(-1)).toBe('/notes?rev=b');
    expect(urls.some((url) => url.includes('all=1'))).toBe(false);
  });

  it('keeps the same list when the server says nothing changed', async () => {
    server([
      { rev: 'a', notes: [note('one')] },
      { rev: 'a', unchanged: true },
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    await click(container.querySelector('.isotone-fab'));
    await flush();
    const row = container.querySelector('.isotone-note');
    await advance(2600);
    expect(container.querySelector('.isotone-note')).toBe(row);
  });

  it('backs off while the server is down and recovers', async () => {
    const urls = server(['down']);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    const start = urls.length;
    await advance(60_000);
    // 2.5s doubling to the 30s cap: far fewer than one request every 2.5s.
    expect(urls.length - start).toBeLessThanOrEqual(6);
  });

  it('does not poll a hidden tab, and catches up when it is shown', async () => {
    const urls = server([
      { rev: 'a', notes: [] },
      { rev: 'a', unchanged: true },
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(2600);
    const asleep = urls.length;
    await advance(30_000);
    expect(urls.length).toBe(asleep);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(urls.length).toBe(asleep + 1);
    Reflect.deleteProperty(document, 'hidden');
  });
});

describe('page scope and agent progress', () => {
  const note = (id: string, route: string, extra: object = {}) => ({
    id,
    route,
    feedback: `Note ${id}`,
    element: null,
    done: false,
    createdAt: new Date().toISOString(),
    ...extra,
  });
  const serve = (notes: object[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => notes })),
    );

  it('lists this page first and reveals other pages from a row of chips', async () => {
    serve([note('a', '/'), note('b', '/pricing'), note('c', '/pricing')]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(1);
    const chips = Array.from(container.querySelectorAll('.isotone-page'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['This page1', '/pricing2']);
    await click(chips[1]);
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(3);
    // Another page's note names its page.
    expect(container.textContent).toContain('/pricing');
  });

  it('shows no page chips while every note is on this page', async () => {
    serve([note('a', '/')]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelector('.isotone-pages')).toBeNull();
  });

  it('marks notes an agent started recently, and ignores a stale claim', async () => {
    serve([
      note('a', '/', { workingAt: new Date().toISOString() }),
      note('b', '/', { workingAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelectorAll('.isotone-working')).toHaveLength(1);
    expect(container.querySelector('.isotone-root')?.getAttribute('data-working')).toBe('true');
  });
});

it('pins a focused host control with Space without activating it', async () => {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  await click(byText('Select elements'));
  const target = document.createElement('button');
  target.id = 'keyboard-target';
  target.textContent = 'Project actions';
  document.body.append(target);
  target.focus();
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(container.querySelector('.isotone-chip')?.textContent).toContain('Project actions');
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }));
  });
  expect(container.querySelectorAll('.isotone-chip')).toHaveLength(1);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(container.querySelector('textarea')).toBe(document.activeElement);
  target.remove();
});

it('fades the composer top only after its text has scrolled', async () => {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  const field = container.querySelector('textarea');
  if (!field) throw new Error('Missing composer');
  expect(field.dataset.scrolled).toBe('false');
  await act(async () => {
    field.scrollTop = 36;
    field.dispatchEvent(new Event('scroll'));
  });
  expect(field.dataset.scrolled).toBe('true');
  await act(async () => {
    field.scrollTop = 0;
    field.dispatchEvent(new Event('scroll'));
  });
  expect(field.dataset.scrolled).toBe('false');
});
