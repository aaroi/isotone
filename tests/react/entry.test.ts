/**
 * The ways into the dock: what a reload brings back, what the pill reopens,
 * and the line by the pill for a link whose `?v=` was not applied.
 */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { combineVariantsSources, createOverlayVariantsSource } from '../../src/core/variants';
import { createVariantsSource, IsotonePanel } from '../../src/react/index';
import { AXES, byText, click, container, render, setUpPanelFixture, unmount } from '../helpers/panel';

setUpPanelFixture();

const open = (name: 'variants' | 'notes') => container.querySelector(`.isotone-${name}-panel`)?.getAttribute('data-open') === 'true';
const hint = () => container.querySelector<HTMLButtonElement>('.isotone-link-hint');
const reload = async (props: Record<string, unknown>) => {
  await unmount();
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, ...props }));
};

describe('after a reload', () => {
  it('reopens the panels that were open in this tab, never selecting', async () => {
    const props = { variants: createVariantsSource({ axes: AXES }) };
    await reload(props);
    await click(byText('Variants'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    expect(byText('Select elements')?.getAttribute('aria-pressed')).toBe('true');
    await reload(props);
    expect(open('variants')).toBe(true);
    expect(open('notes')).toBe(true);
    expect(byText('Select elements')?.getAttribute('aria-pressed')).toBe('false');
    // Closing them is remembered too.
    await click(byText('Close variants'));
    await click(byText('Close feedback'));
    await reload(props);
    expect(open('variants')).toBe(false);
    expect(open('notes')).toBe(false);
  });

  it('reopens only the panel used last where panels take turns', async () => {
    const props = { variants: createVariantsSource({ axes: AXES }) };
    await reload(props);
    await click(byText('Feedback'));
    await click(byText('Variants'));
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 640px'),
      addEventListener() {},
      removeEventListener() {},
    }));
    await reload(props);
    expect(open('variants')).toBe(true);
    expect(open('notes')).toBe(false);
  });

  it('leaves out a panel the page no longer has', async () => {
    await reload({ variants: createVariantsSource({ axes: AXES }) });
    await click(byText('Variants'));
    await reload({});
    expect(container.querySelector('.isotone-variants-panel')).toBeNull();
    expect(open('notes')).toBe(false);
  });
});

describe('the pill', () => {
  it('reopens the tool used last, else the host default', async () => {
    const props = { variants: createVariantsSource({ axes: AXES }) };
    await reload(props);
    await click(container.querySelector('.isotone-fab'));
    expect(open('notes')).toBe(true);
    await click(byText('Variants'));
    await click(byText('Close variants'));
    await click(byText('Close feedback'));
    await click(container.querySelector('.isotone-fab'));
    expect(open('variants')).toBe(true);
    expect(open('notes')).toBe(false);
  });
});

describe('a link whose ?v= was not applied', () => {
  /** The app's own selectors beside the overlay's file variants, on a link asking for one it does not show. */
  const linked = async (search = '?v=headline:bold') => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).includes('variants')
            ? {
                variants: [
                  {
                    id: 'bold',
                    label: 'Bold',
                    group: 'headline',
                    groupLabel: 'Headline',
                    createdAt: '',
                    files: {},
                    stale: [],
                    missing: [],
                  },
                ],
                active: [],
              }
            : [],
      })),
    );
    const overlay = createOverlayVariantsSource({
      endpoint: '/variants',
      getRoute: () => '/',
      storage: null,
      live: null,
      getSearch: () => search,
    });
    await overlay.refresh();
    return combineVariantsSources(createVariantsSource({ axes: AXES }), overlay);
  };

  it('says so by the pill, and opens Variants with focus on its face, which explains it', async () => {
    await reload({ variants: await linked() });
    expect(hint()?.textContent).toBe('This link’s variants aren’t shown');
    await act(async () => {
      hint()?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(open('variants')).toBe(true);
    expect(document.activeElement).toBe(byText('Variants'));
    expect(container.querySelector('.isotone-vars-notice')?.textContent).toContain('?v=');
    expect(hint()).toBeNull();
    // Once read, it stays away: closing Variants, or reloading with the same link.
    await click(byText('Close variants'));
    expect(hint()).toBeNull();
    await reload({ variants: await linked() });
    expect(hint()).toBeNull();
  });

  it('shows beside Feedback too, and not for a link the source applies or a notice about something else', async () => {
    await reload({ variants: await linked() });
    await click(byText('Feedback'));
    expect(hint()).not.toBeNull();
    sessionStorage.clear();
    await reload({ variants: await linked('?v=headline:default') });
    expect(hint()).toBeNull();
    const other = createVariantsSource({ axes: AXES });
    other.getNotice = () => 'This note mentions ?v= but no link was ignored.';
    await reload({ variants: other });
    expect(hint()).toBeNull();
  });
});

describe('a new visit, then a reload', () => {
  it("restores this visit's panels, not an earlier document's, and marks no link read", async () => {
    // An earlier page in the tab left Variants open, read about its link and then navigated here.
    sessionStorage.setItem(
      'isotone-feedback::panels',
      JSON.stringify({ variants: true, notes: false, last: 'variants', route: '/', doc: -1, link: '?v=old' }),
    );
    const props = { variants: createVariantsSource({ axes: AXES }) };
    await reload(props);
    expect(open('variants')).toBe(false);
    const written = JSON.parse(sessionStorage.getItem('isotone-feedback::panels') ?? '{}');
    expect(written).toMatchObject({ variants: false, notes: false, last: 'variants', link: '?v=old', route: '/' });
    expect(written.doc).not.toBe(-1);
    // Reloading this visit brings back what it had open: nothing.
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry]);
    written.doc = -2;
    sessionStorage.setItem('isotone-feedback::panels', JSON.stringify(written));
    await reload(props);
    expect(open('variants')).toBe(false);
  });
});

describe('a remount in the same tab', () => {
  it('keeps the panels on the same page, and starts folded on another', async () => {
    const props = { variants: createVariantsSource({ axes: AXES }) };
    await reload(props);
    await click(byText('Variants'));
    await reload(props);
    expect(open('variants')).toBe(true);
    await unmount();
    await render(createElement(IsotonePanel, { route: '/pricing', store: { endpoint: '/notes' }, ...props }));
    expect(open('variants')).toBe(false);
  });
});

describe('the field under the select-mode cover', () => {
  it('ends selecting on a key that would edit it unseen, and leaves arrows on the page alone', async () => {
    await reload({});
    const shortcut = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true }));
      });
    const selecting = () => byText('Select elements')?.getAttribute('aria-pressed');
    const field = container.querySelector('textarea') as HTMLTextAreaElement;
    for (const key of ['Backspace', 'ArrowLeft', 'Delete', 'End', 'PageDown', 'select all']) {
      await shortcut();
      expect(selecting()).toBe('true');
      expect(document.activeElement).toBe(field);
      const init = key === 'select all' ? { key: 'a', ctrlKey: true } : { key };
      await act(async () => {
        field.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, composed: true }));
      });
      expect(selecting(), key).toBe('false');
    }
    // On the page, an arrow scrolls it; selecting stays on.
    await shortcut();
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(selecting()).toBe('true');
  });
});
