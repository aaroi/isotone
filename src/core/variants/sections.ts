/** Sections: grouping a page's selectors by the part of the page they change. */

import type { VariantAxis } from './axes';

/** How a section and its selector are joined for display: `Header › Logo size`. */
const SECTION_SEPARATOR = ' › ';

export interface SectionedLabel {
  /** The section's display name, or `null` for a selector without one. */
  section: string | null;
  /** What the panel prints under the section header. */
  label: string;
  /** Section and label together, for assistive technology, notes and the CLI. */
  fullLabel: string;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The first spaced `>` (or `›`) with text on both sides. A slash is deliberately
 * not a separator: binary selectors are naturally named `Light / Dark` or
 * `Grid / List`, and a slash would turn their first word into a section.
 */
function prefixSplit(label: string): [string, string] | null {
  for (const match of label.matchAll(/\s+[>›]\s+/g)) {
    const before = label.slice(0, match.index);
    const after = label.slice(match.index + match[0].length);
    if (!before.trim() || !after.trim()) continue;
    return [squash(before), squash(after)];
  }
  return null;
}

/**
 * Split a selector label into its section and its own name. `"Header > Logo size"`
 * is the Logo size selector in the Header section. The first separator wins, so
 * `"Header > Nav > Gap"` is `Nav > Gap` in Header. An explicit `section` overrides
 * the prefix: the label then shows as written, less a prefix that repeats the
 * section, and `''` means no section at all.
 */
export function splitSectionLabel(label: string, section?: string): SectionedLabel {
  const whole = squash(label);
  let name: string | null;
  let own = whole;
  if (section !== undefined) {
    name = squash(section) || null;
    const split = name ? prefixSplit(whole) : null;
    if (name && split && split[0].toLowerCase() === name.toLowerCase()) own = split[1];
  } else {
    const split = prefixSplit(whole);
    name = split?.[0] ?? null;
    if (split) own = split[1];
  }
  return { section: name, label: own, fullLabel: name ? `${name}${SECTION_SEPARATOR}${own}` : own };
}

export function axisSection(axis: Pick<VariantAxis, 'label' | 'section'>): SectionedLabel {
  return splitSectionLabel(axis.label, axis.section);
}

export interface VariantSection<T extends VariantAxis = VariantAxis> {
  /** Display name, from the section's first selector; `null` for selectors without one. */
  name: string | null;
  /** Case-insensitive identity: `"Header"` and `"header"` are one section. */
  key: string;
  axes: (SectionedLabel & { axis: T })[];
}

/**
 * Group axes for the panel. Selectors without a section come first, without a
 * header; sections follow in the order their first selector appears, and every
 * selector keeps its relative order. A dependent axis (`showWhen`) without its
 * own section joins its parent's, so it never jumps away from the control that
 * reveals it. A selector with no section that is named after one, like a file
 * variant group labelled `Pricing card` beside a `Pricing card > Accent` knob,
 * joins it rather than sitting apart above a heading of the same name. Linear
 * in the number of axes.
 */
export function sectionAxes<T extends VariantAxis>(axes: T[]): VariantSection<T>[] {
  const byId = new Map(axes.map((axis) => [axis.id, axis]));
  const labels = new Map(axes.map((axis) => [axis.id, axisSection(axis)]));
  const named = new Set<string>();
  for (const label of labels.values()) if (label.section !== null) named.add(label.section.toLowerCase());
  const resolved = new Map<string, string | null>();
  const sectionOf = (axis: T): string | null => {
    const trail = new Set<string>();
    let current: T | undefined = axis;
    let result: string | null = null;
    while (current) {
      const known = resolved.get(current.id);
      if (known !== undefined) {
        result = known;
        break;
      }
      const own = labels.get(current.id)?.section ?? null;
      trail.add(current.id);
      if (own !== null || current.section !== undefined || !current.showWhen) {
        // `section: ''` keeps a selector out even when its name matches one.
        const title = labels.get(current.id)?.label ?? '';
        result = own ?? (current.section === undefined && named.has(title.toLowerCase()) ? title : null);
        break;
      }
      const parent = byId.get(current.showWhen.axis);
      if (!parent || trail.has(parent.id)) break;
      current = parent;
    }
    for (const id of trail) resolved.set(id, result);
    return result;
  };
  const loose: VariantSection<T> = { name: null, key: '', axes: [] };
  const sections = new Map<string, VariantSection<T>>();
  for (const axis of axes) {
    const label = labels.get(axis.id) as SectionedLabel;
    const name = sectionOf(axis);
    const entry = { ...label, axis };
    if (name === null) {
      loose.axes.push(entry);
      continue;
    }
    const key = name.toLowerCase();
    // An inherited section still prints the child's own label in full; one named after its section only once.
    if (label.section === null && label.label.toLowerCase() !== key) entry.fullLabel = `${name}${SECTION_SEPARATOR}${label.label}`;
    const section = sections.get(key) ?? { name, key, axes: [] };
    sections.set(key, section);
    section.axes.push(entry);
  }
  return [...(loose.axes.length ? [loose] : []), ...sections.values()];
}
