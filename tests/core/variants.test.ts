import { describe, expect, it, vi } from 'vitest';

import {
  OVERLAY_DEFAULT_OPTION,
  createVariantsSource,
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
    expect(groups[0].label).toBe('Settings layout');
    expect(groups[0].members.map((m) => m.id)).toEqual(['settings-tabs', 'settings-accordion']);
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
    expect(groups[0].members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('labels an inferred group by the file every member shares, else the lone label', () => {
    const [table, hero, bare] = overlayGroups([
      variant('table-dense', { files: ['src/ui/table.tsx', 'src/ui/row.tsx'] }),
      variant('table-striped', { files: ['src/ui/table.tsx'] }),
      variant('hero-b', { label: 'Bold hero', files: ['src/Hero.tsx'] }),
      variant('empty', { label: 'Nothing yet' }),
    ]);
    expect(table.id).toBe('table-dense+table-striped');
    expect(table.label).toBe('table.tsx');
    // A lone variant still names its selector after its file.
    expect(hero.label).toBe('Hero.tsx');
    expect(bare.label).toBe('Nothing yet');
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
    expect(mixed.label).toBe('layout');
  });

  it('keeps the id stable whatever order the members arrive in', () => {
    const forward = overlayGroups([variant('b', { files: ['src/x.tsx'] }), variant('a', { files: ['src/x.tsx'] })]);
    const reverse = overlayGroups([variant('a', { files: ['src/x.tsx'] }), variant('b', { files: ['src/x.tsx'] })]);
    expect(forward[0].id).toBe('a+b');
    expect(reverse[0].id).toBe('a+b');
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
    expect(axes[0].label).toBe('table.tsx');
    expect(axes[0].options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'table-dense', 'table-striped']);
    expect(axes[0].defaultOption).toBe(OVERLAY_DEFAULT_OPTION);
  });

  it('keeps a selector on its own route even while its variant is active elsewhere', () => {
    // The file swap applies to every page, but the place to switch it back
    // is the page the variant was made for; other pages show nothing.
    const list = {
      variants: [variant('pricing-b', { route: '/pricing' })],
      active: ['pricing-b'],
    };
    expect(overlayAxes(list, '/about')).toEqual([]);
    expect(overlayAxes(list, '/pricing')[0].options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'pricing-b']);
  });

  it('shows only the members that belong to the route', () => {
    const [axis] = overlayAxes(
      {
        variants: [variant('a', { group: 'g', route: '/here' }), variant('b', { group: 'g', route: '/there' })],
        active: [],
      },
      '/here',
    );
    expect(axis.options.map((o) => o.id)).toEqual([OVERLAY_DEFAULT_OPTION, 'a']);
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
  const { hexToHsv, hsvToHex, normalizeHex } = await import('../../src/react/ColorPicker');
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
    expect(sections[1].axes.map((entry) => entry.label)).toEqual(['Logo', 'Ink']);
    expect(sections[2].axes[0].fullLabel).toBe('Footer › Gap');
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
    expect(sections[1].axes[2]).toMatchObject({ label: 'Shadow', fullLabel: 'Header › Shadow' });
  });

  it('groups a large selector set in linear passes without reordering it', () => {
    const axes = Array.from({ length: 5000 }, (_, i) => select(`axis-${i}`, `Area ${i % 7} > Decision ${i}`));
    const sections = sectionAxes(axes);
    expect(sections).toHaveLength(7);
    expect(sections.flatMap((s) => s.axes).length).toBe(5000);
    expect(sections[0].axes.slice(0, 2).map((entry) => entry.axis.id)).toEqual(['axis-0', 'axis-7']);
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
