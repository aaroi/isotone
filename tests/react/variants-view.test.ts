/**
 * The variants view on its own: selectors, sections, ranges, colours and
 * the long-list rendering.
 */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { VariantAxis } from '../../src/core/variants';
import { createVariantsSource } from '../../src/react/index';
import { VariantsView } from '../../src/react/variants/VariantsView';
import { AXES, byText, click, container, labels, render, renderRemaining, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

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
