/**
 * Several sources as one panel source: a host's own selectors beside the
 * overlay's knobs. Every pick, preview and request reaches its owner.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  combineVariantsSources,
  compareFor,
  createOverlayVariantsSource,
  createVariantsSource,
  type OverlayVariantsList,
  type VariantAxis,
  type VariantsSource,
} from '../../src/core/variants';

const LAYOUT: VariantAxis = {
  id: 'layout',
  label: 'Layout',
  defaultOption: 'grid',
  options: [
    { id: 'grid', label: 'Grid' },
    { id: 'list', label: 'List' },
  ],
};
const RADIUS: VariantAxis = { kind: 'range', id: 'radius', label: 'Radius', min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px' };

/** The overlay source over a fixed listing with one knob, writing to a fake `<html>`. */
async function knobsSource(knobs = [{ kind: 'range', id: 'fade', label: 'Fade', min: 0, max: 100, step: 1, defaultValue: 0, unit: '%' }]) {
  const list = { variants: [], active: [], knobs } as unknown as OverlayVariantsList;
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => list }));
  const props = new Map<string, string>();
  const source = createOverlayVariantsSource({
    endpoint: '/api/isotone/variants',
    getRoute: () => '/',
    storage: null,
    live: null,
    knobRoot: {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
        getPropertyValue: (name: string) => props.get(name) ?? '',
      } as never,
    },
  });
  await source.refresh();
  vi.unstubAllGlobals();
  return { source, props };
}

describe('combineVariantsSources', () => {
  it('lists every source’s axes in order, and the earlier source keeps a shared id', () => {
    const a = createVariantsSource({ axes: [LAYOUT] });
    const b = createVariantsSource({ axes: [{ ...LAYOUT, label: 'Shadowed' }, RADIUS], selections: { layout: 'list', radius: '20' } });
    const combined = combineVariantsSources(a, b);
    expect(combined.getAxes().map((axis) => axis.label)).toEqual(['Layout', 'Radius']);
    // The shared id reads from its owner, not the source it was left out of.
    expect(combined.getSelections()).toEqual({ layout: 'grid', radius: '20' });
  });

  it('sends a pick to the source that owns the axis, and notifies through every source', () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const a = createVariantsSource({ axes: [LAYOUT], onChange: onA });
    const b = createVariantsSource({ axes: [RADIUS], onChange: onB });
    const combined = combineVariantsSources(a, b);
    const listener = vi.fn();
    const off = combined.subscribe(listener);

    combined.setSelection('radius', '16');
    expect(onB).toHaveBeenCalledWith({ radius: '16' });
    expect(onA).not.toHaveBeenCalled();
    combined.setSelection('layout', 'list');
    expect(onA).toHaveBeenCalledWith({ layout: 'list' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(combined.getSelections()).toEqual({ layout: 'list', radius: '16' });
    // An unknown axis goes nowhere.
    combined.setSelection('missing', 'x');

    combined.reset();
    expect(combined.getSelections()).toEqual({ layout: 'grid', radius: '11' });
    off();
    combined.setSelection('layout', 'list');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('offers only what some source offers', () => {
    const plain = createVariantsSource({ axes: [LAYOUT] });
    const combined = combineVariantsSources(plain);
    expect(combined.preview).toBeUndefined();
    expect(combined.canPreview).toBeUndefined();
    expect(combined.saveDefaults).toBeUndefined();
    expect(combined.getError).toBeUndefined();
    expect((combined as { refresh?: unknown }).refresh).toBeUndefined();
    // createVariantsSource always has `manage`.
    expect(combined.manage).toBeTypeOf('function');
  });

  it('holds Compare across a host selector and a knob, and lets go of each', async () => {
    const onChange = vi.fn();
    const host = createVariantsSource({ axes: [LAYOUT], selections: { layout: 'list' }, onChange, compare: true });
    const { source: knobs, props } = await knobsSource();
    knobs.setSelection('fade', '40');
    expect(props.get('--knob-fade')).toBe('40%');
    const combined = combineVariantsSources(host, knobs);
    const compare = compareFor(combined);

    expect(compare.start('key')).toBe(true);
    expect(compare.held).toEqual({ layout: 'grid', fade: '0' });
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'grid' }, { preview: true });
    expect(props.has('--knob-fade')).toBe(false);
    compare.end('key');
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'list' }, { preview: false });
    expect(props.get('--knob-fade')).toBe('40%');
    expect(combined.getSelections()).toEqual({ layout: 'list', fade: '40' });
  });

  it('leaves a selector out of Compare when its source cannot preview, and touches only the sources it held', async () => {
    const onChange = vi.fn();
    const host = createVariantsSource({ axes: [LAYOUT], selections: { layout: 'list' }, onChange });
    const { source: knobs } = await knobsSource();
    knobs.setSelection('fade', '40');
    const combined = combineVariantsSources(host, knobs);
    expect(combined.canPreview?.('layout')).toBe(false);
    expect(combined.canPreview?.('fade')).toBe(true);
    expect(combined.canPreview?.('missing')).toBe(false);

    const compare = compareFor(combined);
    expect(compare.start('key')).toBe(true);
    expect(compare.held).toEqual({ fade: '0' });
    compare.end('key');
    expect(onChange).not.toHaveBeenCalled();

    // Only a knob moved: a host with Compare is not asked to preview or to let go.
    const previewing = createVariantsSource({ axes: [LAYOUT], onChange, compare: true });
    const both = combineVariantsSources(previewing, knobs);
    expect(both.preview?.({ fade: '0' })).toEqual(['fade']);
    both.preview?.(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('saves defaults through each source’s own saveDefaults, with its own picks', async () => {
    const saved: string[] = [];
    const a = createVariantsSource({ axes: [LAYOUT], saveDefaults: (s) => void saved.push(`a ${JSON.stringify(s)}`) });
    const b = createVariantsSource({ axes: [RADIUS] });
    const c: VariantsSource = {
      ...createVariantsSource({ axes: [{ ...RADIUS, id: 'gap' }] }),
      saveDefaults: async (s) => void saved.push(`c ${JSON.stringify(s)}`),
    };
    const combined = combineVariantsSources(a, b, c);
    await combined.saveDefaults?.({ layout: 'list', radius: '4', gap: '6', stray: 'x' });
    expect(saved).toEqual(['a {"layout":"list"}', 'c {"gap":"6"}']);
  });

  it('lets go of every source when one of them cannot show a hold', () => {
    const onChange = vi.fn();
    const first = createVariantsSource({ axes: [LAYOUT], selections: { layout: 'list' }, onChange, compare: true });
    const broken: VariantsSource = {
      ...createVariantsSource({ axes: [RADIUS], selections: { radius: '20' } }),
      preview: () => {
        throw new Error('no preview here');
      },
    };
    const combined = combineVariantsSources(first, broken);
    expect(compareFor(combined).start('key')).toBe(false);
    expect(onChange.mock.calls.map((call) => call[1])).toEqual([{ preview: true }, { preview: false }]);
    expect(compareFor(combined).held).toBeNull();
  });

  it('asks a source with nothing on this page to save nothing', async () => {
    const save = vi.fn();
    const empty = createVariantsSource({ axes: [], saveDefaults: save });
    const combined = combineVariantsSources(createVariantsSource({ axes: [LAYOUT], saveDefaults: vi.fn() }), empty);
    await combined.saveDefaults?.({ layout: 'list' });
    expect(save).not.toHaveBeenCalled();
  });

  it('refreshes every source that can, and reports the first error', async () => {
    const refreshed: string[] = [];
    const quiet = createVariantsSource({ axes: [LAYOUT] });
    const failing: VariantsSource & { refresh(): Promise<void> } = {
      ...createVariantsSource({ axes: [RADIUS] }),
      getError: () => 'Loading variants failed (500)',
      refresh: async () => void refreshed.push('failing'),
    };
    const combined = combineVariantsSources(quiet, failing) as VariantsSource & { refresh?: () => Promise<void> };
    await combined.refresh?.();
    expect(refreshed).toEqual(['failing']);
    expect(combined.getError?.()).toBe('Loading variants failed (500)');
  });

  it('routes a managed change to its owner, and refuses one no source can make', async () => {
    const onManage = vi.fn();
    const host = createVariantsSource({ axes: [LAYOUT], onManage });
    const fixed: VariantsSource = { ...createVariantsSource({ axes: [RADIUS] }), manage: undefined };
    const combined = combineVariantsSources(host, fixed);
    await combined.manage?.({ action: 'keep-default', axisId: 'layout' });
    expect(onManage).toHaveBeenCalledOnce();
    expect(() => combined.manage?.({ action: 'keep-default', axisId: 'radius' })).toThrow('cannot be changed');
  });
});

// #63's panel note on a link's unapplied `?v=` with #64's combined source: the panel reads
// the optional `getNotice` off the source it is given, which beside a host source is the combined one.
describe('the overlay notice beside a host source', () => {
  it("passes the overlay's note on a link's ?v= through the combined source", async () => {
    const list = {
      variants: [{ id: 'hero-split', label: 'Split', group: 'hero', groupLabel: 'Hero', files: {}, createdAt: '', stale: [], missing: [] }],
      active: [],
      knobs: [],
    } as unknown as OverlayVariantsList;
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => list }));
    try {
      const overlay = createOverlayVariantsSource({
        endpoint: '/api/isotone/variants',
        getRoute: () => '/',
        storage: null,
        knobRoot: null,
        live: null,
        getSearch: () => '?v=hero:hero-split',
      });
      const host = createVariantsSource({ axes: [LAYOUT], onChange: () => {} });
      const combined = combineVariantsSources(host, overlay);
      await (combined as { refresh?: () => Promise<void> }).refresh?.();
      expect(overlay.getNotice()).toContain('asks for Hero: Split');
      expect(combined.getNotice?.()).toBe(overlay.getNotice());
      // A host source alone has no notice to give.
      expect(combineVariantsSources(host).getNotice).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
