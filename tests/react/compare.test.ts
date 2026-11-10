/**
 * Hold to compare in the panel: the Compare button in the defaults bar and
 * the page-wide key, how a hold ends, and what the panel shows meanwhile.
 */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { VariantAxis } from '../../src/core/variants';
import { createVariantsSource, IsotonePanel } from '../../src/react/index';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

const AXES: VariantAxis[] = [
  {
    id: 'layout',
    label: 'Layout',
    options: [
      { id: 'grid', label: 'Grid' },
      { id: 'list', label: 'List' },
    ],
    defaultOption: 'grid',
  },
  { kind: 'range', id: 'radius', label: 'Radius', min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px' },
];

async function panel(selections: Record<string, string> = { layout: 'list' }, props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const saveDefaults = vi.fn(async () => {});
  const source = createVariantsSource({ axes: AXES, selections, onChange, saveDefaults });
  await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source, ...props }));
  await click(container.querySelector('.isotone-fab'));
  return { source, onChange, saveDefaults };
}

const compareButton = () => byText('Compare') as HTMLButtonElement | undefined;
const count = () => container.querySelector('.isotone-save-count')?.textContent;
const checked = (label: string) => byText(label)?.getAttribute('aria-checked');

function pointer(type: string, target: Element, init: { button?: number; pointerId?: number } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0 });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  return act(async () => {
    target.dispatchEvent(event);
  });
}

async function key(type: 'keydown' | 'keyup', init: KeyboardEventInit & { target?: EventTarget } = {}) {
  const { target = document.body, ...rest } = init;
  const event = new KeyboardEvent(type, { code: 'Backquote', key: '`', bubbles: true, cancelable: true, composed: true, ...rest });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('hold to compare', () => {
  it('shows the defaults while the button is held and the picks again on release', async () => {
    const { source, onChange, saveDefaults } = await panel({ layout: 'list', radius: '20' });
    const before = { ...source.getSelections() };
    const button = compareButton();
    if (!button) throw new Error('no Compare button');
    expect(count()).toBe('2 picks changed');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Hold to show the defaults');

    await pointer('pointerdown', button);
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'grid', radius: '11' }, { preview: true });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBe('Showing defaults');
    // The panel shows what the page shows.
    expect(checked('Grid')).toBe('true');
    expect(checked('List')).toBe('false');
    expect(container.querySelector<HTMLInputElement>('input[type=range]')?.value).toBe('11');
    expect(container.querySelector('.isotone-vars')?.getAttribute('data-comparing')).toBe('true');
    // Controls take no picks, and Make default asks nothing, while held.
    await click(byText('List'));
    await click(byText('Make default'));
    expect(saveDefaults).not.toHaveBeenCalled();
    expect(source.getSelections()).toEqual(before);

    await pointer('pointerup', button);
    expect(onChange).toHaveBeenLastCalledWith(before, { preview: false });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(count()).toBe('2 picks changed');
    expect(checked('List')).toBe('true');
    expect(source.getSelections()).toEqual(before);
  });

  it('ends on lost capture, a cancelled pointer, a release elsewhere and the panel closing; ignores other buttons', async () => {
    const { onChange } = await panel();
    const held = () => compareButton()?.getAttribute('aria-pressed') === 'true';
    const button = compareButton() as HTMLButtonElement;

    await pointer('pointerdown', button, { button: 2 });
    expect(held()).toBe(false);

    await pointer('pointerdown', button);
    await act(async () => {
      button.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
    });
    expect(held()).toBe(false);

    await pointer('pointerdown', button);
    await pointer('pointercancel', button);
    expect(held()).toBe(false);

    await pointer('pointerdown', button, { pointerId: 7 });
    await pointer('pointerup', document.body, { pointerId: 7 });
    expect(held()).toBe(false);

    await pointer('pointerdown', button);
    expect(held()).toBe(true);
    await click(byText('Close variants'));
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'list', radius: '11' }, { preview: false });
  });

  it('holds with Space or Enter on the focused button', async () => {
    const { onChange } = await panel();
    const button = compareButton() as HTMLButtonElement;
    for (const name of [' ', 'Enter']) {
      await act(async () => {
        button.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
      });
      expect(button.getAttribute('aria-pressed')).toBe('true');
      await act(async () => {
        button.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
      });
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('holds with the key, panel open or closed, and swallows it only while acting', async () => {
    const { onChange } = await panel();
    const down = await key('keydown');
    expect(down.defaultPrevented).toBe(true);
    expect(compareButton()?.getAttribute('aria-pressed')).toBe('true');
    // Repeats change nothing and type nothing.
    const repeat = await key('keydown', { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    const up = await key('keyup');
    expect(up.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'list', radius: '11' }, { preview: false });

    await click(byText('Close variants'));
    await key('keydown');
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'grid', radius: '11' }, { preview: true });
    await key('keyup');
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'list', radius: '11' }, { preview: false });
    // Not acting: the key is the page's.
    const stray = await key('keyup');
    expect(stray.defaultPrevented).toBe(false);
  });

  it('ignores the key while typing, with a modifier, on a repeat it did not start, or when disabled', async () => {
    const { onChange } = await panel();
    const field = document.createElement('input');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(field, editable);
    for (const target of [field, editable]) {
      const event = await key('keydown', { target });
      expect(event.defaultPrevented).toBe(false);
    }
    for (const modifier of ['shiftKey', 'altKey', 'metaKey', 'ctrlKey']) {
      const event = await key('keydown', { [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
    }
    expect((await key('keydown', { repeat: true })).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    field.remove();
    editable.remove();
  });

  it('can be turned off', async () => {
    const { onChange } = await panel({ layout: 'list' }, { compareShortcut: false });
    expect((await key('keydown')).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores on window blur and when the tab hides', async () => {
    const { onChange } = await panel();
    await key('keydown');
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(compareButton()?.getAttribute('aria-pressed')).toBe('false');
    // The key's own release later does nothing more.
    expect((await key('keyup')).defaultPrevented).toBe(false);

    await pointer('pointerdown', compareButton() as HTMLButtonElement);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Reflect.deleteProperty(document, 'visibilityState');
    expect(compareButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('takes a new press after a pointer hold ended by blur', async () => {
    await panel();
    const button = compareButton() as HTMLButtonElement;
    await pointer('pointerdown', button);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await pointer('pointerdown', button, { pointerId: 2 });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    await pointer('pointerup', button, { pointerId: 2 });
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('offers nothing when no pick differs', async () => {
    const { onChange } = await panel({});
    expect(container.querySelector('.isotone-panel-head')?.getAttribute('data-shown')).toBe('false');
    expect(compareButton()).toBeUndefined();
    expect((await key('keydown')).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says so when it can compare only some picks, and hides when it can compare none', async () => {
    const base = createVariantsSource({ axes: AXES, selections: { layout: 'list', radius: '20' }, saveDefaults: async () => {} });
    let cheap = (id: string): boolean => id === 'radius';
    const source = Object.assign(base, { canPreview: (id: string) => cheap(id) });
    await render(createElement(IsotonePanel, { route: '/', store: {}, variants: source }));
    await click(container.querySelector('.isotone-fab'));
    expect(compareButton()?.title).toBe('Hold to show the defaults. Compares what can switch instantly.');
    await pointer('pointerdown', compareButton() as HTMLButtonElement);
    expect(checked('List')).toBe('true');
    expect(container.querySelector<HTMLInputElement>('input[type=range]')?.value).toBe('11');
    await pointer('pointerup', compareButton() as HTMLButtonElement);
    cheap = () => false;
    await click(byText('Grid'));
    expect(compareButton()).toBeUndefined();
  });
});
