/**
 * Hold to compare, per kind of source: the defaults show while held, the
 * picks come back exactly on release, and nothing is stored on the way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compareAxes,
  compareFor,
  createOverlayVariantsSource,
  createVariantsSource,
  KNOBS_STORAGE_KEY,
  type OverlayVariantsList,
  type VariantAxis,
  type VariantsSource,
  visibleAxes,
} from '../../src/core/variants';

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
  { kind: 'color', id: 'accent', label: 'Accent', defaultColor: '#2f6f4e', swatches: [{ id: 'clay', label: 'Clay', value: '#b4532a' }] },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a host source', () => {
  it('shows the defaults while held and the picks again on release, storing nothing', () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes: AXES, selections: { layout: 'list', radius: '20' }, onChange, compare: true });
    const listener = vi.fn();
    source.subscribe(listener);
    const before = { ...source.getSelections() };
    const compare = compareFor(source);

    expect(compare.start('pointer')).toBe(true);
    expect(compare.held).toEqual({ layout: 'grid', radius: '11' });
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'grid', radius: '11', accent: '#2f6f4e' }, { preview: true });
    expect(source.getSelections()).toEqual(before);
    // One hold at a time, and only its holder ends it.
    expect(compare.start('key')).toBe(false);
    compare.end('key');
    expect(compare.held).not.toBeNull();

    compare.end('pointer');
    expect(compare.held).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(before, { preview: false });
    expect(source.getSelections()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    // Ending again changes nothing.
    compare.end();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('offers nothing when no pick differs, or when the source cannot preview', () => {
    const source = createVariantsSource({ axes: AXES, compare: true });
    expect(compareFor(source).start('key')).toBe(false);
    const custom: VariantsSource = {
      ...createVariantsSource({ axes: AXES, selections: { layout: 'list' }, compare: true }),
      preview: undefined,
    };
    expect(compareAxes(custom, AXES, custom.getSelections())).toEqual({ ids: [], skipped: [] });
    expect(compareFor(custom).start('key')).toBe(false);
  });

  it('is opt-in: a host source without compare has no preview, and onChange never sees one', () => {
    const onChange = vi.fn();
    const source = createVariantsSource({ axes: AXES, selections: { layout: 'list' }, onChange });
    expect(source.preview).toBeUndefined();
    expect(compareFor(source).start('key')).toBe(false);
    source.setSelection('radius', '4');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]).toHaveLength(1);
  });

  it('compares only what the source can switch instantly, and says when that is not everything', () => {
    const base = createVariantsSource({ axes: AXES, selections: { layout: 'list', radius: '20' } });
    const preview = vi.fn();
    const source: VariantsSource = { ...base, preview, canPreview: (id) => id === 'radius' || (id === 'layout' && 'switches later') };
    expect(compareAxes(source, AXES, source.getSelections())).toEqual({
      ids: ['radius'],
      skipped: [{ axis: AXES[0], reason: 'switches later' }],
    });
    const compare = compareFor(source);
    compare.start('key');
    expect(preview).toHaveBeenLastCalledWith({ radius: '11' });
    compare.end();
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  it('holds only the axes the source says it showed, and nothing when it showed none', () => {
    const base = createVariantsSource({ axes: AXES, selections: { layout: 'list', radius: '20' } });
    let shows: string[] = ['radius'];
    const preview = vi.fn((selections: unknown) => (selections ? shows : undefined));
    const source: VariantsSource = { ...base, preview };
    const compare = compareFor(source);
    expect(compare.start('key')).toBe(true);
    expect(compare.held).toEqual({ radius: '11' });
    compare.end();
    shows = [];
    expect(compare.start('key')).toBe(false);
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(compare.held).toBeNull();
  });

  it('skips selectors that are hidden, and survives a preview that throws', () => {
    const axes: VariantAxis[] = [
      ...AXES,
      {
        id: 'dense',
        label: 'Dense',
        options: [
          { id: 'no', label: 'No' },
          { id: 'yes', label: 'Yes' },
        ],
        defaultOption: 'no',
        showWhen: { axis: 'layout', equals: 'list' },
      },
    ];
    const base = createVariantsSource({ axes, selections: { dense: 'yes' }, compare: true });
    expect(visibleAxes(axes, base.getSelections()).map((a) => a.id)).not.toContain('dense');
    expect(compareFor(base).start('key')).toBe(false);
    const failing: VariantsSource = {
      ...createVariantsSource({ axes: AXES, selections: { layout: 'list' } }),
      preview: () => {
        throw new Error('host failed');
      },
    };
    expect(compareFor(failing).start('key')).toBe(false);
    expect(compareFor(failing).held).toBeNull();
  });
});

describe('the overlay source', () => {
  const listing: OverlayVariantsList = {
    variants: [
      {
        id: 'hero-b',
        label: 'Hero B',
        group: 'hero',
        createdAt: '2026-01-01T00:00:00.000Z',
        files: { 'src/Hero.tsx': { base: null } },
        stale: [],
        missing: [],
      },
    ],
    active: ['hero-b'],
    knobs: [
      { kind: 'range', id: 'fade', label: 'Fade', min: 0, max: 100, step: 1, defaultValue: 0, unit: '%' },
      {
        id: 'ticks',
        label: 'Ticks',
        options: [
          { id: 'lines', label: 'Lines' },
          { id: 'dots', label: 'Dots' },
        ],
        defaultOption: 'lines',
      },
    ],
  };

  function fixture(live: Parameters<typeof createOverlayVariantsSource>[0]['live'] = null) {
    const posts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)));
        return Response.json(listing);
      }),
    );
    const stored = new Map([[KNOBS_STORAGE_KEY, JSON.stringify({ fade: '40', ticks: 'dots' })]]);
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => void stored.set(key, value)),
      removeItem: vi.fn((key: string) => void stored.delete(key)),
    };
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const knobRoot = {
      style: {
        setProperty: (name: string, value: string) => void props.set(name, value),
        removeProperty: (name: string) => void props.delete(name),
        getPropertyValue: (name: string) => props.get(name) ?? '',
      },
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
    };
    const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot, live });
    return { source, posts, stored, storage, props, attrs };
  }

  it('flicks knobs on the page without writing storage, and leaves a file swap alone', async () => {
    const { source, posts, stored, storage, props, attrs } = fixture();
    await source.refresh();
    const before = { ...source.getSelections() };
    const storedBefore = stored.get(KNOBS_STORAGE_KEY);
    expect(props.get('--knob-fade')).toBe('40%');
    expect(compareAxes(source, source.getAxes(), before)).toEqual({
      ids: ['fade', 'ticks'],
      skipped: [{ axis: source.getAxes()[0], reason: 'switches through the dev server' }],
    });

    const compare = compareFor(source);
    expect(compare.start('key')).toBe(true);
    expect(compare.held).toEqual({ fade: '0', ticks: 'lines' });
    expect(props.has('--knob-fade')).toBe(false);
    expect(attrs.has('data-knob-ticks')).toBe(false);
    expect(source.getSelections()).toEqual(before);

    compare.end('key');
    expect(props.get('--knob-fade')).toBe('40%');
    expect(attrs.get('data-knob-ticks')).toBe('dots');
    expect(source.getSelections()).toEqual(before);
    expect(stored.get(KNOBS_STORAGE_KEY)).toBe(storedBefore);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(posts).toEqual([]);
  });

  it('keeps a preview through a refresh while held', async () => {
    const { source, props } = fixture();
    await source.refresh();
    const compare = compareFor(source);
    compare.start('key');
    await source.refresh();
    expect(props.has('--knob-fade')).toBe(false);
    compare.end();
    expect(props.get('--knob-fade')).toBe('40%');
  });

  it('flicks a live file variant in the tab alone, unless it would reload', async () => {
    let reloads = false;
    const live = {
      active: ['hero-b'],
      select: vi.fn(() => false),
      subscribe: () => () => {},
      reload: vi.fn(),
      needsReload: vi.fn(() => reloads),
      preview: vi.fn(() => !reloads),
    };
    const { source, posts } = fixture(live);
    await source.refresh();
    expect(source.canPreview?.('hero')).toBe(true);
    const compare = compareFor(source);
    compare.start('pointer');
    expect(live.preview).toHaveBeenLastCalledWith([]);
    expect(source.getSelections().hero).toBe('hero-b');
    compare.end();
    expect(live.preview).toHaveBeenLastCalledWith(null);
    expect(live.select).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(posts).toEqual([]);

    // A copy whose fixed exports differ only switches with a reload: not offered.
    reloads = true;
    expect(source.canPreview?.('hero')).toBe('switches by reloading the page');
    expect(compareAxes(source, source.getAxes(), source.getSelections()).skipped).toHaveLength(1);
  });
  it('does not make the panel re-read its selectors for a live preview', async () => {
    const listeners = new Set<() => void>();
    const live = {
      active: ['hero-b'],
      select: vi.fn(() => false),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      reload: vi.fn(),
      needsReload: () => false,
      preview: vi.fn(() => {
        for (const listener of listeners) listener();
        return true;
      }),
    };
    const { source } = fixture(live);
    await source.refresh();
    const seen = vi.fn();
    source.subscribe(seen);
    const compare = compareFor(source);
    compare.start('key');
    compare.end();
    expect(live.preview).toHaveBeenCalledTimes(2);
    expect(seen).not.toHaveBeenCalled();
    // The server moving the tab still reaches the panel.
    for (const listener of listeners) listener();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('leaves a file variant on its pick, and out of the hold, when the tab refuses the preview', async () => {
    const live = {
      active: ['hero-b'],
      select: vi.fn(() => false),
      subscribe: () => () => {},
      reload: vi.fn(),
      needsReload: () => false,
      // Each group alone switches in place; the combined set would not.
      preview: vi.fn((next: string[] | null) => next === null),
    };
    const { source, props } = fixture(live);
    await source.refresh();
    const compare = compareFor(source);
    expect(compare.start('key')).toBe(true);
    expect(compare.held).toEqual({ fade: '0', ticks: 'lines' });
    expect(props.has('--knob-fade')).toBe(false);
    compare.end();
    expect(live.preview).toHaveBeenLastCalledWith(null);
  });
});
