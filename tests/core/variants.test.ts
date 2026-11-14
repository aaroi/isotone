import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OVERLAY_DEFAULT_OPTION,
  createOverlayVariantsSource,
  createVariantsSource,
  KNOBS_STORAGE_KEY,
  type OverlayVariantsList,
  type OverlayVariantStatus,
  overlayAxes,
  overlayGroups,
  applyKnobValues,
  knobCssValue,
  knobDelta,
  knobsFor,
  knobVar,
  type KnobAxis,
  parseVariantParam,
  sectionAxes,
  serializeVariantParam,
  splitSectionLabel,
  type VariantAxis,
} from '../../src/core/variants';

function variant(id: string, extra: Partial<Omit<OverlayVariantStatus, 'files'>> & { files?: string[] } = {}): OverlayVariantStatus {
  const { files, ...rest } = extra;
  return {
    id,
    label: id,
    createdAt: '2026-09-01T00:00:00.000Z',
    files: Object.fromEntries((files ?? []).map((f) => [f, { base: null }])),
    stale: [],
    missing: [],
    ...rest,
  };
}

describe('overlayGroups', () => {
  it('puts variants with the same explicit group together, labelled by any member', () => {
    const groups = overlayGroups([
      variant('settings-tabs', { group: 'settings', files: ['src/Tabs.tsx'] }),
      variant('table-dense', { files: ['src/table.tsx'] }),
      variant('settings-accordion', {
        group: 'settings',
        groupLabel: 'Settings layout',
        files: ['src/Accordion.tsx'],
      }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['settings', 'table-dense']);
    expect(groups[0]?.label).toBe('Settings layout');
    expect(groups[0]?.members.map((m) => m.id)).toEqual(['settings-tabs', 'settings-accordion']);
  });

  it('joins ungrouped variants that override the same file, transitively', () => {
    // a and c share nothing, but both share a file with b: two copies of one
    // file can never both be active, so the three are one decision.
    const groups = overlayGroups([
      variant('a', { files: ['src/x.tsx'] }),
      variant('b', { files: ['src/x.tsx', 'src/y.tsx'] }),
      variant('c', { files: ['src/y.tsx'] }),
      variant('d', { files: ['src/z.tsx'] }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['a+b+c', 'd']);
    expect(groups[0]?.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('labels an inferred group by the file every member shares, else the lone label', () => {
    const [table, hero, bare] = overlayGroups([
      variant('table-dense', { files: ['src/ui/table.tsx', 'src/ui/row.tsx'] }),
      variant('table-striped', { files: ['src/ui/table.tsx'] }),
      variant('hero-b', { label: 'Bold hero', files: ['src/Hero.tsx'] }),
      variant('empty', { label: 'Nothing yet' }),
    ]);
    expect(table?.id).toBe('table-dense+table-striped');
    expect(table?.label).toBe('table.tsx');
    // A lone variant still names its selector after its file.
    expect(hero?.label).toBe('Hero.tsx');
    expect(bare?.label).toBe('Nothing yet');
  });

  it('lets an explicit group override file overlap, and falls back to the group id', () => {
    // Same file, but the author said these are two different decisions.
    const groups = overlayGroups([
      variant('a', { group: 'one', files: ['src/x.tsx'] }),
      variant('b', { group: 'two', files: ['src/x.tsx'] }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['one', 'two']);
    expect(groups.map((g) => g.label)).toEqual(['x.tsx', 'x.tsx']);
    // Explicit members on different files with no label: the id is the label.
    const [mixed] = overlayGroups([
      variant('p', { group: 'layout', files: ['src/p.tsx'] }),
      variant('q', { group: 'layout', files: ['src/q.tsx'] }),
    ]);
    expect(mixed?.label).toBe('layout');
  });

  it('keeps the id stable whatever order the members arrive in', () => {
    const forward = overlayGroups([variant('b', { files: ['src/x.tsx'] }), variant('a', { files: ['src/x.tsx'] })]);
    const reverse = overlayGroups([variant('a', { files: ['src/x.tsx'] }), variant('b', { files: ['src/x.tsx'] })]);
    expect(forward[0]?.id).toBe('a+b');
    expect(reverse[0]?.id).toBe('a+b');
  });

  it('returns nothing for no variants', () => {
    expect(overlayGroups([])).toEqual([]);
  });
});

describe('overlayAxes', () => {
  it('makes one axis per group on the route, Default first', () => {
    const axes = overlayAxes(
      {
        variants: [
          variant('table-dense', { route: '/projects', files: ['src/table.tsx'] }),
          variant('table-striped', { route: '/projects', files: ['src/table.tsx'] }),
          variant('settings-tabs', { route: '/settings', group: 'settings' }),
          variant('any'),
        ],
        active: [],
      },
      '/projects',
    );
    expect(axes.map((a) => a.id)).toEqual(['table-dense+table-striped', 'any']);
    expect(axes[0]?.label).toBe('table.tsx');
    expect(axes[0]?.options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'table-dense', 'table-striped']);
    expect(axes[0]?.defaultOption).toBe(OVERLAY_DEFAULT_OPTION);
  });

  it('keeps a selector on its own route even while its variant is active elsewhere', () => {
    // The file swap applies to every page, but the place to switch it back
    // is the page the variant was made for; other pages show nothing.
    const list = {
      variants: [variant('pricing-b', { route: '/pricing' })],
      active: ['pricing-b'],
    };
    expect(overlayAxes(list, '/about')).toEqual([]);
    expect(overlayAxes(list, '/pricing')[0]?.options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'pricing-b']);
  });

  it('shows only the members that belong to the route', () => {
    const [axis] = overlayAxes(
      {
        variants: [variant('a', { group: 'g', route: '/here' }), variant('b', { group: 'g', route: '/there' })],
        active: [],
      },
      '/here',
    );
    expect(axis?.options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'a']);
  });
});

describe('knobs', () => {
  const fade: KnobAxis = {
    kind: 'range',
    id: 'fade-from',
    label: 'Fade starts',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    unit: '%',
    route: ['/computers/*', '/databases/*'],
  };
  const dots: KnobAxis = {
    kind: 'range',
    id: 'dot-alpha',
    label: 'Dot brightness',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.1,
  };
  const ink: KnobAxis = {
    kind: 'color',
    id: 'ink',
    label: 'Ink',
    defaultColor: '#ffffff',
    swatches: [],
    route: '/settings',
  };

  it('belongs on the routes it names, and everywhere when it names none', () => {
    expect(knobsFor([fade, dots, ink], '/computers/cmp_1').map((k) => k.id)).toEqual(['fade-from', 'dot-alpha']);
    expect(knobsFor([fade, dots, ink], '/settings').map((k) => k.id)).toEqual(['dot-alpha', 'ink']);
    expect(knobsFor(undefined, '/')).toEqual([]);
  });

  it('writes the value with its unit as --knob-<id>, and clears it at the default', () => {
    const set = new Map<string, string>();
    const root = {
      style: {
        setProperty: (n: string, v: string) => void set.set(n, v),
        removeProperty: (n: string) => void set.delete(n),
      },
    };
    applyKnobValues([fade, dots, ink], { 'fade-from': '40', 'dot-alpha': '0.1', ink: '#ff0000' }, root);
    expect(set.get(knobVar('fade-from'))).toBe('40%');
    expect(set.has(knobVar('dot-alpha'))).toBe(false);
    expect(set.get(knobVar('ink'))).toBe('#ff0000');
    expect(knobCssValue(dots, '0.25')).toBe('0.25');
  });

  it('reports only the knobs off their default, as the panel showed them', () => {
    const moved = knobDelta([fade, dots], { 'fade-from': '40', 'dot-alpha': '0.1' });
    expect(moved.map((m) => [m.axis.id, m.value, m.shown])).toEqual([['fade-from', '40', '40%']]);
  });
});

describe('overlay knobs and the route', () => {
  // Regression: a knob scoped to /pricing showed its slider only there, but its value
  // stayed on <html> everywhere, where the panel had no control to reset it.
  const border: KnobAxis = {
    kind: 'color',
    id: 'header-border',
    label: 'Header > Border',
    defaultColor: '#e5e5e5',
    swatches: [],
    route: '/pricing',
  };
  const density: KnobAxis = {
    kind: 'select',
    id: 'density',
    label: 'Density',
    defaultOption: 'cozy',
    options: [
      { id: 'cozy', label: 'Cozy' },
      { id: 'compact', label: 'Compact' },
    ],
    route: '/pricing',
  };
  const gap: KnobAxis = { kind: 'range', id: 'gap', label: 'Gap', min: 0, max: 40, step: 1, defaultValue: 16, unit: 'px' };

  function fixture(route: string, stored: Record<string, string>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ variants: [], active: [], knobs: [border, density, gap] })),
    );
    const values = new Map([[KNOBS_STORAGE_KEY, JSON.stringify(stored)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
      removeItem: vi.fn((key: string) => void values.delete(key)),
    };
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const events: unknown[] = [];
    const knobRoot = {
      style: {
        setProperty: (name: string, value: string) => void props.set(name, value),
        removeProperty: (name: string) => void props.delete(name),
        getPropertyValue: (name: string) => props.get(name) ?? '',
      },
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
      dispatchEvent: (event: Event) => events.push((event as CustomEvent).detail) > 0,
    };
    const page = { route };
    const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => page.route, storage, knobRoot, live: null });
    return { source, page, props, attrs, events, values, storage };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a stored value only on the knob’s own route, on a full load', async () => {
    const stored = { 'header-border': '#f59e0b', density: 'compact', gap: '24' };
    const home = fixture('/', stored);
    await home.source.refresh();
    expect(home.props.has(knobVar('header-border'))).toBe(false);
    expect(home.attrs.has('data-knob-density')).toBe(false);
    // A knob without a route belongs everywhere.
    expect(home.props.get(knobVar('gap'))).toBe('24px');
    expect(home.source.getAxes().map((a) => a.id)).toEqual(['gap']);
    expect(home.source.knobs.values).toEqual(stored);

    const pricing = fixture('/pricing', stored);
    await pricing.source.refresh();
    expect(pricing.props.get(knobVar('header-border'))).toBe('#f59e0b');
    expect(pricing.attrs.get('data-knob-density')).toBe('compact');
  });

  it('takes the knob off on client-side navigation and restores it on the way back, keeping storage', async () => {
    const { source, page, props, attrs, events, values, storage } = fixture('/pricing', {});
    await source.refresh();
    source.setSelection('header-border', '#f59e0b');
    source.setSelection('density', 'compact');
    expect(props.get(knobVar('header-border'))).toBe('#f59e0b');
    const stored = values.get(KNOBS_STORAGE_KEY);
    storage.setItem.mockClear();
    const notified = vi.fn();
    source.subscribe(notified);
    events.length = 0;

    page.route = '/';
    source.routeChanged();
    expect(props.has(knobVar('header-border'))).toBe(false);
    expect(attrs.has('data-knob-density')).toBe(false);
    expect(events).toEqual([
      { id: 'header-border', value: null },
      { id: 'density', value: null },
    ]);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(source.getSelections()).toEqual({ gap: '16' });
    expect(values.get(KNOBS_STORAGE_KEY)).toBe(stored);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();

    // The same route again (a replaceState for a query string) changes nothing.
    source.routeChanged();
    expect(notified).toHaveBeenCalledTimes(1);

    page.route = '/pricing';
    source.routeChanged();
    expect(props.get(knobVar('header-border'))).toBe('#f59e0b');
    expect(attrs.get('data-knob-density')).toBe('compact');
    expect(source.getSelections()).toMatchObject({ 'header-border': '#f59e0b', density: 'compact' });
  });

  it('keeps a held compare off other routes’ knobs', async () => {
    const { source, page, props } = fixture('/', { 'header-border': '#f59e0b' });
    await source.refresh();
    source.preview?.({ 'header-border': '#000000' });
    expect(props.has(knobVar('header-border'))).toBe(false);
    source.preview?.(null);
    page.route = '/pricing';
    source.routeChanged();
    expect(props.get(knobVar('header-border'))).toBe('#f59e0b');
  });
});

describe('createVariantsSource manage', () => {
  it('keeps one chosen option as the selection and removes its selector', async () => {
    const onManage = vi.fn();
    const source = createVariantsSource({
      axes: [
        {
          id: 'layout',
          label: 'Layout',
          options: [
            { id: 'grid', label: 'Grid' },
            { id: 'stack', label: 'Stack' },
          ],
          defaultOption: 'grid',
        },
        {
          kind: 'color',
          id: 'accent',
          label: 'Accent',
          swatches: [
            { id: 'blue', label: 'Blue', value: '#0000ff' },
            { id: 'red', label: 'Red', value: '#ff0000' },
          ],
          defaultColor: '#0000ff',
        },
      ],
      onManage,
    });
    await source.manage?.({ axisId: 'layout', action: 'keep-option', optionId: 'stack' });
    await source.manage?.({ axisId: 'accent', action: 'keep-option', optionId: 'red' });
    expect(source.getAxes()).toEqual([]);
    expect(source.getSelections()).toEqual({ layout: 'stack', accent: '#ff0000' });
    await expect(
      createVariantsSource({ axes: [{ id: 'x', label: 'X', options: [{ id: 'a', label: 'A' }], defaultOption: 'a' }] }).manage?.({
        axisId: 'x',
        action: 'keep-option',
        optionId: 'gone',
      }),
    ).rejects.toThrow('no longer available');
  });
});

describe('colour picker maths', async () => {
  const { hexToHsv, hsvToHex, normalizeHex } = await import('../../src/react/variants/ColorPicker');
  it('round-trips hex through hsv and normalises short forms', () => {
    for (const hex of ['#000000', '#ffffff', '#ea382e', '#3b82f6', '#6687ff', '#808080']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#12345')).toBeNull();
  });
});

describe('sections', () => {
  it('reads a spaced > (or ›) as the section separator, and nothing else', () => {
    expect(splitSectionLabel('Header > Logo size')).toEqual({ section: 'Header', label: 'Logo size', fullLabel: 'Header › Logo size' });
    expect(splitSectionLabel('  Header   ›   Logo  size ')).toEqual({
      section: 'Header',
      label: 'Logo size',
      fullLabel: 'Header › Logo size',
    });
    // Only the first separator splits; the rest belongs to the name.
    expect(splitSectionLabel('Header > Nav > Gap')).toMatchObject({ section: 'Header', label: 'Nav > Gap' });
    // A slash never makes a section: binary selectors are named this way.
    for (const label of ['Light / Dark', 'Grid / List', 'Light/Dark', 'Aspect 16 / 9', 'a>b', '> Logo', 'Header >', 'A >B', 'Logo size']) {
      expect(splitSectionLabel(label), label).toMatchObject({ section: null, label: label.replace(/\s+/g, ' ').trim() });
    }
    expect(splitSectionLabel('Header\t>\nLogo')).toMatchObject({ section: 'Header', label: 'Logo' });
  });

  it('lets an explicit section override the prefix', () => {
    expect(splitSectionLabel('Light / Dark', 'Theme')).toEqual({
      section: 'Theme',
      label: 'Light / Dark',
      fullLabel: 'Theme › Light / Dark',
    });
    // A prefix that repeats the section is not printed twice.
    expect(splitSectionLabel('header > Logo', 'Header')).toMatchObject({ section: 'Header', label: 'Logo' });
    // An empty section opts out of the prefix entirely.
    expect(splitSectionLabel('Before > After', '')).toEqual({ section: null, label: 'Before > After', fullLabel: 'Before > After' });
    expect(splitSectionLabel('Logo', '  ')).toMatchObject({ section: null, label: 'Logo' });
  });

  const select = (id: string, label: string, extra: Partial<VariantAxis> = {}): VariantAxis =>
    ({
      id,
      label,
      defaultOption: 'a',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      ...extra,
    }) as VariantAxis;

  it('puts loose selectors first, then sections in order of first appearance', () => {
    const sections = sectionAxes([
      select('logo', 'Header > Logo'),
      select('layout', 'Layout'),
      { kind: 'range', id: 'gap', label: 'Gap', min: 0, max: 4, step: 1, defaultValue: 0, section: 'Footer' },
      { kind: 'color', id: 'ink', label: 'header › Ink', defaultColor: '#000000', swatches: [] },
      select('links', 'Footer > Links'),
      select('theme', 'Before > After', { section: '' }),
    ]);
    expect(sections.map((s) => [s.name, s.axes.map((entry) => entry.axis.id)])).toEqual([
      [null, ['layout', 'theme']],
      ['Header', ['logo', 'ink']],
      ['Footer', ['gap', 'links']],
    ]);
    expect(sections[1]?.axes.map((entry) => entry.label)).toEqual(['Logo', 'Ink']);
    expect(sections[2]?.axes[0]?.fullLabel).toBe('Footer › Gap');
  });

  it('keeps a dependent selector with the control that reveals it', () => {
    const sections = sectionAxes([
      select('nav', 'Header > Navigation'),
      select('layout', 'Layout'),
      select('sticky', 'Sticky', { showWhen: { axis: 'nav', equals: 'b' } }),
      select('shadow', 'Shadow', { showWhen: { axis: 'sticky', equals: 'b' } }),
      select('own', 'Body > Own', { showWhen: { axis: 'nav', equals: 'b' } }),
      select('loop-a', 'Loop A', { showWhen: { axis: 'loop-b', equals: 'b' } }),
      select('loop-b', 'Loop B', { showWhen: { axis: 'loop-a', equals: 'b' } }),
    ]);
    expect(sections.map((s) => [s.name, s.axes.map((entry) => entry.axis.id)])).toEqual([
      [null, ['layout', 'loop-a', 'loop-b']],
      ['Header', ['nav', 'sticky', 'shadow']],
      ['Body', ['own']],
    ]);
    expect(sections[1]?.axes[2]).toMatchObject({ label: 'Shadow', fullLabel: 'Header › Shadow' });
  });

  it('puts a selector named after a section in it, not above a second heading of that name', () => {
    // A file variant group labelled "Pricing card" beside a "Pricing card > Accent" knob.
    const sections = sectionAxes([
      select('pricing', 'Pricing card'),
      select('more', 'More', { showWhen: { axis: 'pricing', equals: 'b' } }),
      select('alone', 'Footer', { section: '' }),
      { kind: 'color', id: 'accent', label: 'pricing card > Accent', defaultColor: '#000000', swatches: [] },
      select('links', 'Links', { section: 'Footer' }),
    ]);
    expect(sections.map((s) => [s.name, s.axes.map((entry) => entry.axis.id)])).toEqual([
      [null, ['alone']],
      ['Pricing card', ['pricing', 'more', 'accent']],
      ['Footer', ['links']],
    ]);
    expect(sections[1]?.axes.slice(0, 2).map((entry) => [entry.label, entry.fullLabel])).toEqual([
      ['Pricing card', 'Pricing card'],
      ['More', 'Pricing card › More'],
    ]);
  });

  it('groups a large selector set in linear passes without reordering it', () => {
    const axes = Array.from({ length: 5000 }, (_, i) => select(`axis-${i}`, `Area ${i % 7} > Decision ${i}`));
    const sections = sectionAxes(axes);
    expect(sections).toHaveLength(7);
    expect(sections.flatMap((s) => s.axes).length).toBe(5000);
    expect(sections[0]?.axes.slice(0, 2).map((entry) => entry.axis.id)).toEqual(['axis-0', 'axis-7']);
  });

  it('leaves ids, and so ?v= links, untouched', () => {
    const axes = [select('logo', 'Header > Logo'), select('links', 'Links', { section: 'Footer' })];
    expect(serializeVariantParam(axes, { logo: 'b', links: 'b' })).toBe('logo:b,links:b');
    expect(parseVariantParam(axes, 'logo:b,links:a')).toEqual({ logo: 'b', links: 'a' });
  });

  it('gives an overlay selector the section any member carries', () => {
    const list = {
      variants: [variant('logo-a', { files: ['Logo.tsx'] }), variant('logo-b', { files: ['Logo.tsx'], section: 'Header' })],
      active: [],
    };
    expect(overlayAxes(list, '/')[0]).toMatchObject({ label: 'Logo.tsx', section: 'Header' });
    expect(overlayAxes({ variants: [variant('plain', { files: ['A.tsx'] })], active: [] }, '/')[0]).not.toHaveProperty('section');
  });
});

describe('a ?v= the overlay source does not apply', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const listing: OverlayVariantsList = {
    variants: [
      variant('hero-split', { label: 'Split', group: 'hero', groupLabel: 'Header > Hero', files: ['src/Hero.tsx'] }),
      variant('hero-stacked', { label: 'Stacked', group: 'hero', files: ['src/Hero.tsx'] }),
      variant('card-highlight', { label: 'Highlight', files: ['src/Card.tsx'] }),
    ],
    active: ['hero-stacked'],
  };
  /** A source without a live store, as on Vite 5 or without React, on a page at `search`. */
  function source(search: string, live: Parameters<typeof createOverlayVariantsSource>[0]['live'] = null) {
    // Like the endpoint: a posted set is what the next listing has as active.
    let active = listing.active;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') active = (JSON.parse(String(init.body)) as { active: string[] }).active;
        return Response.json({ ...listing, active });
      }),
    );
    let query = search;
    const overlay = createOverlayVariantsSource({
      endpoint: '/variants',
      getRoute: () => '/',
      storage: null,
      knobRoot: null,
      live,
      getSearch: () => query,
    });
    const go = (next: string) => {
      query = next;
    };
    return { overlay, go };
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('names the picks the page does not show, with section, selector and option', async () => {
    const { overlay } = source('?tab=2&v=hero:hero-split,card-highlight:default,theme:dark');
    // Nothing to compare against until the listing is in.
    expect(overlay.getNotice()).toBeNull();
    await overlay.refresh();
    // The card group is at Default already, and `theme` is not a group here: maybe the host's own.
    expect(overlay.getNotice()).toBe(
      'This link’s ?v= asks for Header › Hero: Split, but links don’t choose variants here. Pick it below instead; a pick shows in every tab. Per-tab links need live switching (React on Vite 6+).',
    );
  });

  it('follows the picks: gone once they match the link, back when they move away', async () => {
    const { overlay } = source('?v=hero:hero-split,card-highlight:card-highlight');
    await overlay.refresh();
    expect(overlay.getNotice()).toContain('asks for Header › Hero: Split; Card.tsx: Highlight, but');
    expect(overlay.getNotice()).toContain('Pick them below instead;');
    // The view keeps what it showed while the panel is open; the source says how things are now.
    overlay.setSelection('hero', 'hero-split');
    overlay.setSelection('card-highlight', 'card-highlight');
    expect(overlay.getNotice()).toBeNull();
    overlay.setSelection('hero', OVERLAY_DEFAULT_OPTION);
    expect(overlay.getNotice()).toContain('asks for Header › Hero: Split, but');
    await settle();
    await overlay.refresh();
    expect(overlay.getNotice()).toContain('asks for Header › Hero: Split, but');
  });

  it('names a Default the link asks for', async () => {
    const { overlay } = source('?v=hero:default');
    await overlay.refresh();
    expect(overlay.getNotice()).toContain('asks for Header › Hero: Default, but');
  });

  it('says nothing without ?v=, for pairs naming no member, or with a live store that applies the link', async () => {
    const { overlay, go } = source('?v=hero:gone,hero,:x,');
    await overlay.refresh();
    expect(overlay.getNotice()).toBeNull();
    for (const search of ['', '?v=', '?view=hero:hero-split']) {
      go(search);
      await overlay.refresh();
      expect(overlay.getNotice(), search).toBeNull();
    }

    const live = { active: ['hero-stacked'], select: () => false, subscribe: () => () => {}, reload: () => {} };
    const { overlay: inLive } = source('?v=hero:hero-split', live);
    await inLive.refresh();
    expect(inLive.getNotice()).toBeNull();
  });
});

describe('what the overlay source says the page shows', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  /** A source without a live store, as on Vite 5 or without React, against a stand-in
   *  server (what it shows, which copies hold conflict markers) and HMR channel. */
  function source(live: Parameters<typeof createOverlayVariantsSource>[0]['live'] = null) {
    const server = { active: ['card-bold'], conflicts: new Set<string>(['card-merged']), fail: false };
    const listing = (): OverlayVariantsList => ({
      variants: [
        ['card-bold', 'Bold'],
        ['card-compact', 'Compact'],
        ['card-merged', 'Merged'],
      ]
        .map(([id, label]) =>
          variant(id as string, {
            label,
            group: 'pricing-card',
            files: ['src/Card.tsx'],
            conflicts: server.conflicts.has(id as string) ? ['src/Card.tsx'] : [],
          }),
        )
        .concat(variant('hero-split', { group: 'hero', route: '/other', files: ['src/Hero.tsx'] })),
      active: server.active,
      hmr: '/@vite/client',
    });
    const posted: { active: string[]; groups: string[] }[] = [];
    let gets = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== 'POST') {
          gets++;
          return Response.json(listing());
        }
        const body = JSON.parse(String(init.body)) as { active: string[]; groups: string[] };
        posted.push(body);
        if (server.fail) return Response.json({ error: 'busy' }, { status: 503 });
        // Like the endpoint: it answers with what it shows, never a conflicted copy.
        server.active = body.active.filter((id) => !server.conflicts.has(id));
        return Response.json({ active: server.active });
      }),
    );
    const listeners = new Set<() => void>();
    const connected: string[] = [];
    const hot = async (client: string) => {
      connected.push(client);
      return {
        on: (_event: string, listener: () => void) => {
          listeners.add(listener);
        },
        off: (_event: string, listener: () => void) => {
          listeners.delete(listener);
        },
      };
    };
    const page = { route: '/' };
    const overlay = createOverlayVariantsSource({
      endpoint: '/variants',
      getRoute: () => page.route,
      storage: null,
      knobRoot: null,
      live,
      hot,
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const announce = async () => {
      for (const listener of listeners) listener();
      await settle();
    };
    return { overlay, server, page, posted, connected, listeners, settle, announce, gets: () => gets };
  }
  const disabled = (overlay: ReturnType<typeof createOverlayVariantsSource>) =>
    (overlay.getAxes()[0] as { options: { id: string; disabled?: boolean }[] }).options.filter((o) => o.disabled).map((o) => o.id);

  it('reads the listing again whenever the server says its variants changed', async () => {
    const { overlay, server, connected, listeners, settle, announce, gets } = source();
    await overlay.refresh();
    await settle();
    // Connected once, at the client the listing names, and read again once connected.
    await overlay.refresh();
    await settle();
    expect(connected).toEqual(['http://localhost/@vite/client']);
    expect(gets()).toBe(3);
    expect(overlay.getSelections()['pricing-card']).toBe('card-bold');

    // Another tab or the CLI picks: the highlight and a new note's selections follow.
    server.active = ['card-compact'];
    await announce();
    expect(overlay.getSelections()['pricing-card']).toBe('card-compact');

    // The shown copy gains markers: Default shows, and the option cannot be picked.
    server.conflicts.add('card-compact');
    server.active = [];
    await announce();
    expect(overlay.getSelections()['pricing-card']).toBe(OVERLAY_DEFAULT_OPTION);
    expect(disabled(overlay)).toEqual(['card-compact', 'card-merged']);
    // And back once they are resolved.
    server.conflicts.delete('card-merged');
    await announce();
    expect(disabled(overlay)).toEqual(['card-compact']);

    overlay.dispose();
    await settle();
    expect(listeners.size).toBe(0);
  });

  it('keeps what the server answers a pick with, not what it posted', async () => {
    const { overlay, server, settle } = source();
    await overlay.refresh();
    await settle();
    // Markers arrive before the panel hears of them: the pick still goes out, and the
    // server shows the real file.
    server.conflicts.add('card-compact');
    overlay.setSelection('pricing-card', 'card-compact');
    await vi.waitFor(() => expect(overlay.getSelections()['pricing-card']).toBe(OVERLAY_DEFAULT_OPTION));
  });

  it('names the selectors the reviewer set, so a Default there drops a hidden pick', async () => {
    const { overlay, posted, settle } = source();
    await overlay.refresh();
    await settle();
    overlay.setSelection('pricing-card', OVERLAY_DEFAULT_OPTION);
    await vi.waitFor(() => expect(posted).toEqual([{ active: [], groups: ['pricing-card'] }]));
    // A reset sets every group, on every route.
    overlay.reset?.();
    await vi.waitFor(() => expect(posted[1]).toEqual({ active: [], groups: ['pricing-card', 'hero'] }));
  });

  it('carries the selectors of a pick that failed into the next one', async () => {
    const { overlay, server, page, posted, settle } = source();
    await overlay.refresh();
    await settle();
    server.fail = true;
    overlay.setSelection('pricing-card', OVERLAY_DEFAULT_OPTION);
    await vi.waitFor(() => expect(overlay.getError?.()).toBe('busy'));
    server.fail = false;
    page.route = '/other';
    overlay.setSelection('hero', 'hero-split');
    await vi.waitFor(() => expect(posted[1]).toEqual({ active: ['card-bold', 'hero-split'], groups: ['pricing-card', 'hero'] }));
    // Sent once it went through.
    overlay.setSelection('hero', OVERLAY_DEFAULT_OPTION);
    await vi.waitFor(() => expect(posted[2]).toEqual({ active: ['card-bold'], groups: ['hero'] }));
  });

  it('shows a copy with conflict markers as an option nobody can pick, and says why', async () => {
    const live = { active: ['card-bold'], select: vi.fn(() => false), subscribe: () => () => {}, reload: () => {} };
    const { overlay, posted, settle } = source(live);
    await overlay.refresh();
    expect(disabled(overlay)).toEqual(['card-merged']);
    expect(overlay.getNotice()).toBe(
      '"Merged" holds conflict markers from `variant sync` in src/Card.tsx, so it cannot be shown until they are resolved.',
    );
    overlay.setSelection('pricing-card', 'card-merged');
    await settle();
    expect(live.select).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
    expect(overlay.getError?.()).toBeNull();
    expect(overlay.getSelections()['pricing-card']).toBe('card-bold');
  });
});
