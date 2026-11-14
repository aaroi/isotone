/**
 * The ways into the dock: what a reload brings back, what the pill reopens,
 * and the line by the pill for a link whose `?v=` was not applied.
 */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { unappliedLinkNotice } from '../../src/core/variants/overlay';
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
  const linked = () => {
    const source = createVariantsSource({ axes: AXES });
    // As the overlay source words it for a link it cannot apply.
    const notice = unappliedLinkNotice(
      {
        variants: [
          { id: 'bold', label: 'Bold', group: 'headline', groupLabel: 'Headline', createdAt: '', files: {}, stale: [], missing: [] },
        ],
        active: [],
      },
      [],
      '?v=headline:bold',
    );
    expect(notice).toContain('?v=');
    source.getNotice = () => notice;
    return source;
  };

  it('says so by the pill, and opens Variants, which explains it', async () => {
    await reload({ variants: linked() });
    expect(hint()?.textContent).toBe('This link’s variants aren’t shown');
    await click(hint());
    expect(open('variants')).toBe(true);
    expect(container.querySelector('.isotone-vars-notice')?.textContent).toContain('?v=');
    expect(hint()).toBeNull();
    // Once read, it stays away for the rest of the page's life.
    await click(byText('Close variants'));
    expect(hint()).toBeNull();
  });

  it('shows beside Feedback too, and not for a note without a link', async () => {
    await reload({ variants: linked() });
    await click(byText('Feedback'));
    expect(hint()).not.toBeNull();
    const other = createVariantsSource({ axes: AXES });
    other.getNotice = () => 'Something else the source wants said.';
    await reload({ variants: other });
    expect(hint()).toBeNull();
  });
});
