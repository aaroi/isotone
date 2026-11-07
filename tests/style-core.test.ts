import { describe, expect, it } from 'vitest';
import {
  STYLE_PROPERTY,
  describeStyleEdit,
  diffStyleValues,
  groupBySignature,
  groupStyleEdits,
  mixedValue,
  normalizeColor,
  normalizeInput,
  nudgeValue,
  readStyleValues,
  sameValue,
  styleEditsOf,
  summarizeStyleEdits,
  type StyleEdit,
  type StyleValues,
} from '../src/core/style';
import { specificity, splitSelectorList } from '../src/core/style-source';

/** A computed style as a browser reports it. */
function computed(values: Record<string, string>) {
  return { getPropertyValue: (name: string) => values[name] ?? '' };
}

describe('reading computed styles', () => {
  it('normalizes sRGB colours to hex and keeps other colour spaces', () => {
    const values = readStyleValues(computed({
      color: 'rgb(17, 17, 17)',
      'background-color': 'rgba(0, 0, 0, 0)',
      'border-color': 'oklch(0.6 0.2 250)',
      'padding-top': '18px',
    }));
    expect(values.color).toBe('#111111');
    expect(values['background-color']).toBe('transparent');
    expect(values['border-color']).toBe('oklch(0.6 0.2 250)');
    expect(values['padding-top']).toBe('18px');
  });

  it('reads translucent and modern rgb() notation', () => {
    expect(normalizeColor('rgba(255, 0, 0, 0.5)')).toBe('#ff000080');
    expect(normalizeColor('rgb(255 128 0 / 50%)')).toBe('#ff800080');
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
  });

  it('falls back to a longhand when the browser does not serialize a shorthand', () => {
    const values = readStyleValues(computed({ 'row-gap': '8px', 'border-top-width': '1px' }));
    expect(values.gap).toBe('8px');
    expect(values['border-width']).toBe('1px');
  });
});

describe('editing values', () => {
  const property = (name: string) => {
    const found = STYLE_PROPERTY.get(name);
    if (!found) throw new Error(name);
    return found;
  };
  const padding = property('padding-top');
  const lineHeight = property('line-height');
  const opacity = property('opacity');
  const spacing = property('letter-spacing');

  it('treats a bare number as pixels only where CSS would not', () => {
    expect(normalizeInput('24', padding)).toBe('24px');
    expect(normalizeInput('1.5', lineHeight)).toBe('1.5');
    expect(normalizeInput('2rem', padding)).toBe('2rem');
  });

  it('nudges in the value’s own unit, clamped, without float noise', () => {
    expect(nudgeValue('18px', 1, padding)).toBe('19px');
    expect(nudgeValue('1.5rem', 0.1, padding)).toBe('1.6rem');
    expect(nudgeValue('0px', -4, padding)).toBe('0px');
    expect(nudgeValue('0.9', 0.3, opacity)).toBe('1');
    expect(nudgeValue('0.2', 0.1, opacity)).toBe('0.3');
    expect(nudgeValue('normal', 0.1, spacing)).toBe('0.1px');
    expect(nudgeValue('auto', 1, padding)).toBeNull();
  });

  it('compares values across notations', () => {
    expect(sameValue('18px', '18', 'padding-top')).toBe(true);
    expect(sameValue('#ff0000', 'rgb(255, 0, 0)', 'color')).toBe(true);
    expect(sameValue('18px', '19px', 'padding-top')).toBe(false);
  });
});

describe('several elements', () => {
  const card = (padding: string, radius = '11px'): StyleValues =>
    readStyleValues(computed({ 'padding-top': padding, 'border-radius': radius, display: 'flex' }));

  it('shows a shared value, or Mixed with the elements behind each value', () => {
    expect(mixedValue(['18px', '18px'])).toEqual({ value: '18px', mixed: false, options: [{ value: '18px', indices: [0, 1] }] });
    const mixed = mixedValue(['18px', '24px', '18px']);
    expect(mixed.mixed).toBe(true);
    expect(mixed.value).toBeNull();
    expect(mixed.options).toEqual([{ value: '18px', indices: [0, 2] }, { value: '24px', indices: [1] }]);
  });

  it('groups identical styles, largest first, labelled by what tells them apart', () => {
    const groups = groupBySignature([card('18px'), card('24px'), card('18px')]);
    expect(groups.map((group) => group.indices)).toEqual([[0, 2], [1]]);
    expect(groups.map((group) => group.label)).toEqual(['padding-top 18px', 'padding-top 24px']);
  });

  it('labels groups by a property unique to each when several differ', () => {
    const groups = groupBySignature([card('18px'), card('18px', '4px'), card('24px', '4px')]);
    expect(groups).toHaveLength(3);
    // Neither property alone sets the middle group apart, so its label names both.
    expect(groups.map((g) => g.label)).toEqual(['border-radius 11px', 'padding-top 18px, border-radius 4px', 'padding-top 24px']);
  });

  it('has one unlabelled group when every element matches', () => {
    expect(groupBySignature([card('18px'), card('18px')])).toEqual([
      expect.objectContaining({ indices: [0, 1], label: '' }),
    ]);
  });
});

describe('style diffs', () => {
  const before = readStyleValues(computed({ 'padding-top': '18px', color: 'rgb(17, 17, 17)', 'font-size': '14px' }));

  it('records changed properties in catalogue order and drops no-ops', () => {
    expect(diffStyleValues(before, { color: '#333', 'padding-top': '24px', 'font-size': '14px' })).toEqual([
      { property: 'padding-top', from: '18px', to: '24px' },
      { property: 'color', from: '#111111', to: '#333' },
    ]);
  });

  const edits: StyleEdit[] = [
    { selector: '#cards > article:nth-child(1)', classes: ['card'], changes: [{ property: 'padding-top', from: '18px', to: '24px', rule: '.cards article', declared: 'padding: var(--card-padding, 18px)', tokens: { '--card-padding': '' }, matches: ['--space-6'] }] },
    { selector: '#cards > article:nth-child(2)', changes: [{ property: 'padding-top', from: '18px', to: '24px' }] },
    { selector: 'h1', changes: [{ property: 'color', from: '#111111', to: '#333' }] },
  ];

  it('summarizes shared changes once, with the number of elements', () => {
    // The same change on two elements is one group, whatever context each carries.
    expect(groupStyleEdits(edits).map((group) => group.selectors.length)).toEqual([2, 1]);
    const same: StyleEdit[] = [edits[1], { ...edits[1], selector: 'x' }, edits[2]];
    expect(summarizeStyleEdits(same)).toBe('Style: padding-top 18px → 24px (2 elements); color #111111 → #333');
    expect(summarizeStyleEdits([])).toBe('');
  });

  it('describes each change with its rule, written value and tokens for the CLI', () => {
    expect(describeStyleEdit(edits[0], '  ')).toEqual([
      '  classes: card',
      '  style: padding-top 18px → 24px  (rule .cards article; declared padding: var(--card-padding, 18px); --card-padding: (unset); to equals --space-6)',
    ]);
  });

  it('validates untrusted edits, dropping malformed entries and bounding strings', () => {
    expect(styleEditsOf(undefined)).toBeUndefined();
    expect(styleEditsOf('nope')).toBeNull();
    expect(styleEditsOf(Array.from({ length: 51 }, () => edits[1]))).toBeNull();
    const cleaned = styleEditsOf([
      edits[0],
      { selector: '', changes: edits[1].changes },
      { selector: 'p', changes: [{ property: 'Not A Property', to: '1px' }, { property: 'color', to: '' }] },
      { selector: 'p', changes: [{ property: 'color', from: 7, to: 'x'.repeat(400), tokens: { __proto__: 'x', '--ok': 'y', bad: 'z' }, matches: ['--a', 'b'] }] },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned?.[0]).toEqual(edits[0]);
    const change = cleaned?.[1].changes[0];
    expect(change?.from).toBe('');
    expect(change?.to).toHaveLength(300);
    expect(change?.tokens).toEqual({ '--ok': 'y' });
    expect(change?.matches).toEqual(['--a']);
  });
});

describe('subpixel layout', () => {
  it('rounds computed lengths to a tenth of a pixel so equal boxes are not Mixed', () => {
    const a = readStyleValues(computed({ width: '314.656px', gap: '8.04px 12px' }));
    const b = readStyleValues(computed({ width: '314.672px' }));
    expect(a.width).toBe('314.7px');
    expect(a.gap).toBe('8px 12px');
    expect(mixedValue([a.width, b.width]).mixed).toBe(false);
  });
});

describe('specificity', () => {
  it('counts ids, classes and types, including escaped utility classes', () => {
    expect(specificity('#a .b c')).toEqual([1, 1, 1]);
    expect(specificity('.hover\\:bg-red-500:hover')).toEqual([0, 2, 0]);
    expect(specificity('.p-1\\.5')).toEqual([0, 1, 0]);
    expect(specificity('a[href]::before')).toEqual([0, 1, 2]);
    expect(specificity('*')).toEqual([0, 0, 0]);
  });

  it('follows :is, :not and :where', () => {
    expect(specificity(':where(#a) .b')).toEqual([0, 1, 0]);
    expect(specificity(':is(#a, .b) p')).toEqual([1, 0, 1]);
    expect(specificity('li:not(.x):nth-child(2)')).toEqual([0, 2, 1]);
  });

  it('splits only top-level commas', () => {
    expect(splitSelectorList('.a, :is(.b, .c) d, [data-x="1,2"]')).toEqual(['.a', ':is(.b, .c) d', '[data-x="1,2"]']);
  });
});
