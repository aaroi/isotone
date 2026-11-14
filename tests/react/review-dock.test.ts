/**
 * The review dock with variants: feedback on a selector or option, its
 * sections, and the selector action dialog.
 */
import { act, createElement, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { combineVariantsSources, createOverlayVariantsSource, type VariantAction, type VariantAxis } from '../../src/core/variants';
import { createVariantsSource, IsotonePanel } from '../../src/react/index';
import { VariantsView } from '../../src/react/variants/VariantsView';
import { PANEL_CSS } from '../../src/react/styles/panel';
import { isShortcutKey } from '../../src/react/dock/useDockEvents';
import { AXES, byText, click, container, labels, render, renderRemaining, rerender, unmount, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

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
    // Persisted requests never hide or mutate the source controls, even on remount, which in the same tab
    // (a reload) comes back with Variants open.
    await unmount();
    await render(createElement(IsotonePanel, props));
    expect(labels()).toEqual(['Headline', 'Tagline', 'Haze']);
    // Feedback came back open too; its rail button's name carries the count the badge shows.
    expect(byText('Feedback, 1 note')?.getAttribute('aria-expanded')).toBe('true');
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
        rerender(createElement(IsotonePanel, props));
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
    // The caret waits in the note field under the select-mode cover, so what is typed next is kept.
    expect(document.activeElement).toBe(container.querySelector('textarea'));
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
  it('takes the shortcut from an automated key event that carries only the key', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    // What browser automation dispatches for ⌘⇧.: a key, no code.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', code: '', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
  });
  it('reads a key event without a code as a US layout types it, and a code first when there is one', () => {
    const is = (init: KeyboardEventInit, code: string | string[]) => isShortcutKey(new KeyboardEvent('keydown', init), { code });
    expect(is({ key: '>' }, 'Period')).toBe(true);
    expect(is({ key: '!' }, 'Digit1')).toBe(true);
    expect(is({ key: 'k' }, 'KeyK')).toBe(true);
    expect(is({ key: 'F2' }, 'F2')).toBe(true);
    expect(is({ key: '§' }, ['Backquote', 'IntlBackslash'])).toBe(true);
    // A real keyboard's code wins over the character its layout typed.
    expect(is({ key: '.', code: 'KeyE' }, 'Period')).toBe(false);
    expect(is({ key: 'Unidentified' }, 'Period')).toBe(false);
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
  it('records the knobs moved on this route with a new note, and leaves its selections alone on an edit', async () => {
    const range = { kind: 'range' as const, min: 0, max: 40, step: 1, unit: 'px' };
    const knobs = [
      { ...range, id: 'card-radius', label: 'Card radius', defaultValue: 12 },
      { ...range, id: 'gap', label: 'Gap', defaultValue: 8 },
      { ...range, id: 'other-page', label: 'Elsewhere', defaultValue: 4, route: '/settings' },
    ];
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).startsWith('/variants')) return { ok: true, json: async () => ({ variants: [], active: [], knobs }) };
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({ id: 'saved' }) };
        }
        return { ok: true, json: async () => [] };
      }),
    );
    // The gap sits at its default and the other knob belongs to another page.
    const stored = JSON.stringify({ 'card-radius': '24', gap: '8', 'other-page': '30' });
    const storage = { getItem: () => stored, setItem() {}, removeItem() {} };
    const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot: null, live: null });
    await source.refresh();
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: source }));
    await click(container.querySelector('.isotone-fab'));
    await typeFeedback('Rounder still');
    await click(byText('Send note'));
    expect(posts[0]?.selections).toEqual({ 'card-radius': '24' });
    const tag = container.querySelector('.isotone-note-hit [title]');
    expect(tag?.firstElementChild?.textContent).toBe('1 pick');
    expect(tag?.textContent).toBe('1 pick: card-radius: 24');
    expect(tag?.getAttribute('title')).toBe('card-radius: 24');
    await click(container.querySelector('.isotone-note-hit'));
    await typeFeedback('Rounder still, and softer');
    await click(byText('Save edit'));
    expect(posts[1]).not.toHaveProperty('selections');
  });
  it("records a host source's moved selectors that are shown, as one tag that lists them", async () => {
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)));
        return { ok: true, json: async () => (init?.method === 'POST' ? { id: 'saved' } : []) };
      }),
    );
    const range = (id: string, label: string) => ({
      kind: 'range' as const,
      id,
      label,
      min: 0,
      max: 40,
      step: 1,
      defaultValue: 0,
      unit: 'px',
    });
    const axes: VariantAxis[] = [...AXES, range('pad', 'Cards > Padding'), range('gap', 'Gap'), range('radius', 'Radius')];
    // The tagline only shows with the bold headline.
    const source = createVariantsSource({
      axes,
      selections: { headline: 'a', tagline: 'y', haze: '0.3', pad: '24', gap: '8', radius: '12' },
    });
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: source }));
    await click(container.querySelector('.isotone-fab'));
    await typeFeedback('Tighter');
    await click(byText('Send note'));
    // The headline and haze sit at their defaults, and the tagline is hidden.
    expect(posts[0]?.selections).toEqual({ pad: '24', gap: '8', radius: '12' });
    const tags = [...(container.querySelector('.isotone-note-hit .isotone-meta')?.children ?? [])];
    expect(tags.map((tag) => tag.firstElementChild?.textContent)).toEqual(['3 picks']);
    expect(tags[0]?.getAttribute('title')).toBe('pad: 24\ngap: 8\nradius: 12');
  });
  // #69's selections from #64's combined source, as mountIsotone composes it: the host's picks and the
  // overlay's, less the knobs #62 (a file group's id) and 14be786 (a host selector's id) leave out, and
  // only the knobs of this route (#60). With #61's live store, the tab's own picks, not active.json.
  async function noteSelections(live: { active: string[] } | null, active: string[]) {
    const range = { kind: 'range' as const, min: 0, max: 40, step: 1, unit: 'px' };
    const knobs = [
      { ...range, id: 'card-radius', label: 'Card radius', defaultValue: 12 },
      { ...range, id: 'cta', label: 'CTA size', defaultValue: 0 },
      { ...range, id: 'hero', label: 'Hero size', defaultValue: 0 },
      { ...range, id: 'other-page', label: 'Elsewhere', defaultValue: 4, route: '/settings' },
    ];
    const variants = [{ id: 'hero-left', label: 'Left', group: 'hero', files: {}, createdAt: '', stale: [], missing: [] }];
    const posts: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: RequestInit) => {
        if (String(url).startsWith('/variants')) return { ok: true, json: async () => ({ variants, active, knobs }) };
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)));
          return { ok: true, json: async () => ({ id: 'saved' }) };
        }
        return { ok: true, json: async () => [] };
      }),
    );
    const stored = JSON.stringify({ 'card-radius': '24', cta: '30', hero: '5', 'other-page': '30' });
    const storage = { getItem: () => stored, setItem() {}, removeItem() {} };
    const host = createVariantsSource({
      axes: [
        {
          id: 'cta',
          label: 'Call to action',
          defaultOption: 'join',
          options: [
            { id: 'join', label: 'Join' },
            { id: 'start', label: 'Start' },
          ],
        },
      ],
      selections: { cta: 'start' },
    });
    const store = live && { ...live, select: () => false, subscribe: () => () => {}, reload() {} };
    const overlay = createOverlayVariantsSource({
      endpoint: '/variants',
      getRoute: () => '/',
      storage,
      knobRoot: null,
      live: store,
      takenIds: () => host.getAxes().map((axis) => axis.id),
    });
    await overlay.refresh();
    await render(
      createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: combineVariantsSources(host, overlay) }),
    );
    await click(container.querySelector('.isotone-fab'));
    await typeFeedback('Bigger');
    await click(byText('Send note'));
    return posts[0]?.selections;
  }
  it("records a host source's picks beside the overlay's, less the knobs the panel leaves out", async () => {
    expect(await noteSelections(null, ['hero-left'])).toEqual({ cta: 'start', hero: 'hero-left', 'card-radius': '24' });
  });
  it("records this tab's own variant picks, not .isotone/active.json's", async () => {
    // Another tab picked Left; this one kept Default.
    expect(await noteSelections({ active: [] }, ['hero-left'])).toEqual({ cta: 'start', 'card-radius': '24' });
    await unmount();
    // This tab picked Left; active.json has Default.
    expect(await noteSelections({ active: ['hero-left'] }, [])).toEqual({ cta: 'start', hero: 'hero-left', 'card-radius': '24' });
  });
  it('shows one pin by its text and several as a count, beside the picks', async () => {
    const note = (id: string, texts: string[]) => ({
      id,
      route: '/',
      feedback: `Note ${id}`,
      element: null,
      elements: texts.map((text, i) => ({ tag: 'button', text, selector: `#${id}-${i}` })),
      selections: { pad: '24', gap: '8' },
      done: false,
      createdAt: new Date().toISOString(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [note('one', ['Start free trial']), note('three', ['Free', 'Pro', 'Team'])] })),
    );
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    const rows = [...container.querySelectorAll('.isotone-note-hit .isotone-meta')].map((meta) =>
      [...meta.children].map((tag) => [tag.textContent, tag.getAttribute('title')]),
    );
    expect(rows).toEqual([
      [
        ['Start free trial', null],
        ['2 picks: pad: 24, gap: 8', 'pad: 24\ngap: 8'],
      ],
      [
        ['3 pins: Free, Pro, Team', 'Free\nPro\nTeam'],
        ['2 picks: pad: 24, gap: 8', 'pad: 24\ngap: 8'],
      ],
    ]);
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
    // Opening Feedback started select mode.
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

    // Opening Feedback started select mode.
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
  it('starts selecting however Feedback opens, by pointer or key, with the caret waiting in the field', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    // A real pointer over the dock hits the panel, which select mode ignores.
    Object.defineProperty(document, 'elementFromPoint', { value: () => container.querySelector('.isotone-root'), configurable: true });
    const pointer = (el: Element | null | undefined) =>
      act(async () => {
        el?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      });
    const field = () => container.querySelector('textarea');
    const selecting = () => byText('Select elements')?.getAttribute('aria-pressed');
    await pointer(container.querySelector('.isotone-fab'));
    // It opens already covered, so the field never shows through the fade; the caret waits under the cover.
    expect(container.querySelector('.isotone-picking')?.getAttribute('data-still')).toBe('true');
    expect(selecting()).toBe('true');
    expect(document.activeElement).toBe(field());
    await pointer(byText('Feedback'));
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('.isotone-picking')).toBeNull();
    // Enter or Space on the face (a click with no pointer detail) does the same.
    await click(byText('Feedback'));
    expect(selecting()).toBe('true');
    expect(document.activeElement).toBe(field());
  });
  it('keeps the caret in the field while the shortcut selects, so text typed at once lands there', async () => {
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    const field = () => container.querySelector('textarea') as HTMLTextAreaElement;
    // The panel opens covered, so the field never shows through the fade; the caret is already in it.
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector('.isotone-picking')?.getAttribute('data-still')).toBe('true');
    expect(document.activeElement).toBe(field());
    // Text inserted without a key event (dictation, paste, browser automation) ends selecting too.
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      set?.call(field(), 'Bigger');
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelector('.isotone-picking')).toBeNull();
    expect(field().value).toBe('Bigger');
  });
  it('ends selecting when Variants opens or takes a press, keeping the pins', async () => {
    const source = createVariantsSource({ axes: AXES });
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, variants: source }));
    const shortcut = () =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Period', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
        );
      });
    const selecting = () => byText('Select elements')?.getAttribute('aria-pressed');
    await shortcut();
    expect(selecting()).toBe('true');
    await click(byText('Variants'));
    expect(container.querySelector('.isotone-variants-panel')?.getAttribute('data-open')).toBe('true');
    expect(selecting()).toBe('false');
    // Selecting again with Variants open, then a press in Variants: the next page click is the page's.
    await shortcut();
    expect(selecting()).toBe('true');
    await act(async () => {
      container.querySelector('.isotone-variants-panel [role=radio]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(selecting()).toBe('false');
    // A press in the feedback panel itself leaves it on.
    await click(byText('Select elements'));
    await act(async () => {
      container.querySelector('.isotone-notes-panel .isotone-compose')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(selecting()).toBe('true');
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

    // Opening Feedback started select mode.
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

    // Written first: text arriving while selecting ends it, as typing does.
    await typeFeedback('Keep this text');
    await click(byText('Select elements'));
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
    });
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
      // The scroll edge layers close the list; they are decoration, not selectors.
      expect(Array.from(body?.querySelectorAll(':scope > :not(.isotone-edge)') ?? []).map((el) => el.className)).toEqual([
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
