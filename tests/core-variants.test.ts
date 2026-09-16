import { describe, expect, it } from 'vitest';

import {
  OVERLAY_DEFAULT_OPTION,
  type OverlayVariantStatus,
  overlayAxes,
  overlayGroups,
  applyKnobValues,
  knobCssValue,
  knobDelta,
  knobsFor,
  knobVar,
  type KnobAxis,
} from '../src/core/variants';

function variant(
  id: string,
  extra: Partial<Omit<OverlayVariantStatus, 'files'>> & { files?: string[] } = {},
): OverlayVariantStatus {
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
    const forward = overlayGroups([
      variant('b', { files: ['src/x.tsx'] }),
      variant('a', { files: ['src/x.tsx'] }),
    ]);
    const reverse = overlayGroups([
      variant('a', { files: ['src/x.tsx'] }),
      variant('b', { files: ['src/x.tsx'] }),
    ]);
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
    expect(axes[0].options.map((o) => o.id)).toEqual([
      OVERLAY_DEFAULT_OPTION,
      'table-dense',
      'table-striped',
    ]);
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
    expect(overlayAxes(list, '/pricing')[0].options.map((o) => o.id)).toEqual([
      OVERLAY_DEFAULT_OPTION,
      'pricing-b',
    ]);
  });

  it('shows only the members that belong to the route', () => {
    const [axis] = overlayAxes(
      {
        variants: [
          variant('a', { group: 'g', route: '/here' }),
          variant('b', { group: 'g', route: '/there' }),
        ],
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
    expect(knobsFor([fade, dots, ink], '/computers/cmp_1').map((k) => k.id)).toEqual([
      'fade-from',
      'dot-alpha',
    ]);
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
