/**
 * The experimental style editor: a Figma-like inspector docked above the
 * feedback panel. It reads the pinned elements' computed styles, previews
 * edits through `StylePreview`, and leaves the structured diff for the note.
 *
 * Several elements show Mixed where they differ. Editing a field sets it on
 * every element in scope; the scope strip narrows that to elements with the
 * same style, or to one element. The breadcrumb moves the selection to a
 * parent or a child, since a click often lands on the wrong layer.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  STYLE_PROPERTY, STYLE_SECTIONS, groupBySignature, mixedValue, nudgeValue,
  type StyleProperty, type StyleSection, type StyleValues,
} from '../core/style';
import { elementLabel, indexStyleRules, styleOrigin } from '../core/style-source';
import { readBrowserStorage, writeBrowserStorage } from '../core/browser-storage';
import { Icon } from './icons';
import { ColorField, NumberField, SegmentField, SelectField, TextField, type SegmentOption } from './style-fields';
import type { StylePreview, StyleSnapshot } from './style-preview';
import { showOverflowTitle } from './tooltips';

export interface StyleEntry {
  selector: string;
  /** Visible label from the pin descriptor. */
  label: string;
  el: Element;
}

export interface StyleInspectorProps {
  entries: StyleEntry[];
  preview: StylePreview;
  picking: boolean;
  /** Replace `from` with `to` in the selection; returns the new pins' selectors. */
  onNavigate(from: Element[], to: Element[]): string[];
  /** Outline an element on the page while the pointer is over its crumb. */
  onHover(el: Element | null): void;
  /** The selectors edits currently apply to, or null for every pin. */
  onScope(selectors: string[] | null): void;
  onPick(): void;
  onSend(): void;
}

const SECTIONS_KEY = 'isotone-style-sections';
const SKIPPED_CHILDREN = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);

const TEXT_ALIGN: SegmentOption[] = [
  { value: 'left', label: 'Align left', icon: 'text-left', aliases: ['start', '-webkit-left'] },
  { value: 'center', label: 'Align centre', icon: 'text-center', aliases: ['-webkit-center'] },
  { value: 'right', label: 'Align right', icon: 'text-right', aliases: ['end', '-webkit-right'] },
  { value: 'justify', label: 'Justify', icon: 'text-justify' },
];
const DIRECTION: SegmentOption[] = [
  { value: 'row', label: 'Row', icon: 'dir-row' },
  { value: 'column', label: 'Column', icon: 'dir-column' },
  { value: 'row-reverse', label: 'Row reversed', icon: 'dir-row-reverse' },
  { value: 'column-reverse', label: 'Column reversed', icon: 'dir-column-reverse' },
];

/** Readable names for assistive technology. */
const NAMES: Record<string, string> = {
  'margin-top': 'Margin top', 'margin-right': 'Margin right', 'margin-bottom': 'Margin bottom', 'margin-left': 'Margin left',
  'padding-top': 'Padding top', 'padding-right': 'Padding right', 'padding-bottom': 'Padding bottom', 'padding-left': 'Padding left',
  width: 'Width', height: 'Height', 'font-size': 'Font size', 'font-weight': 'Font weight', 'line-height': 'Line height',
  'letter-spacing': 'Letter spacing', color: 'Text colour', 'text-align': 'Text alignment', 'background-color': 'Background colour',
  'border-width': 'Border width', 'border-style': 'Border style', 'border-color': 'Border colour', 'border-radius': 'Corner radius',
  'box-shadow': 'Shadow', opacity: 'Opacity', display: 'Display', 'flex-direction': 'Direction', 'flex-wrap': 'Wrap',
  'grid-template-columns': 'Grid columns', 'align-items': 'Align items', 'justify-content': 'Justify content', gap: 'Gap',
};

function loadCollapsed(): Set<StyleSection> {
  try {
    const raw = readBrowserStorage(localStorage, SECTIONS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function ancestorOf(el: Element, levels: number): Element | null {
  let node: Element | null = el;
  for (let i = 0; i < levels && node; i++) node = node.parentElement;
  return node && node.tagName !== 'HTML' ? node : null;
}

function selectableChildren(el: Element): Element[] {
  return Array.from(el.children).filter((child) =>
    !SKIPPED_CHILDREN.has(child.tagName) && !child.closest('[data-isotone]')).slice(0, 40);
}

/** The child of `parent` that corresponds to `model` in a sibling structure. */
function matchingChild(parent: Element, model: Element, index: number): Element | null {
  const children = selectableChildren(parent);
  const same = (child: Element) => child.tagName === model.tagName && child.className === model.className;
  return children.find(same) ?? children[index] ?? null;
}

function unique(elements: (Element | null)[]): Element[] {
  return [...new Set(elements.filter((el): el is Element => el !== null))];
}

export function StyleInspector({ entries, preview, picking, onNavigate, onHover, onScope, onPick, onSend }: StyleInspectorProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => preview.subscribe(rerender), [preview]);
  const key = entries.map((entry) => entry.selector).join('\n');
  // Read every element's starting point before anything is previewed on it.
  for (const entry of entries) preview.baseline(entry.el);

  const [scope, setScope] = useState<{ selectors: string[]; label: string } | null>(null);
  const pendingScope = useRef<string[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope follows the selection.
  useEffect(() => {
    const present = new Set(entries.map((entry) => entry.selector));
    // Nothing selected (a sent note, for one): earlier snapshots no longer apply.
    if (!entries.length) history.current = { undo: [], redo: [], gesture: '', at: 0 };
    const pending = pendingScope.current;
    pendingScope.current = null;
    if (pending?.length && pending.every((selector) => present.has(selector)) && pending.length < entries.length) {
      setScope({ selectors: pending, label: pending.length === 1 ? 'one' : `${pending.length}` });
    } else setScope((current) => (current?.selectors.every((selector) => present.has(selector)) ? current : null));
  }, [key]);
  const scoped = scope ? entries.filter((entry) => scope.selectors.includes(entry.selector)) : entries;
  useEffect(() => { onScope(scope?.selectors ?? null); }, [scope, onScope]);
  useEffect(() => () => onScope(null), [onScope]);

  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleSection = (section: StyleSection) => {
    const next = new Set(collapsed);
    if (next.has(section)) next.delete(section); else next.add(section);
    setCollapsed(next);
    try { writeBrowserStorage(localStorage, SECTIONS_KEY, JSON.stringify([...next])); } catch {}
  };
  const [invalid, setInvalid] = useState<string | null>(null);
  const [childMenu, setChildMenu] = useState(false);

  // Undo history: snapshots of every override, one per gesture.
  const history = useRef<{ undo: StyleSnapshot[]; redo: StyleSnapshot[]; gesture: string; at: number }>({ undo: [], redo: [], gesture: '', at: 0 });
  const record = (gesture?: string) => {
    const h = history.current;
    const now = Date.now();
    if (gesture && gesture === h.gesture && now - h.at < 1500) { h.at = now; return; }
    h.undo.push(preview.snapshot());
    if (h.undo.length > 100) h.undo.shift();
    h.redo = [];
    h.gesture = gesture ?? '';
    h.at = now;
  };
  const undo = () => {
    const h = history.current;
    const previous = h.undo.pop();
    if (!previous) return;
    h.redo.push(preview.snapshot());
    h.gesture = '';
    preview.restore(previous);
  };
  const redo = () => {
    const h = history.current;
    const next = h.redo.pop();
    if (!next) return;
    h.undo.push(preview.snapshot());
    h.gesture = '';
    preview.restore(next);
  };

  const setAll = (name: string, value: string, gesture?: string) => {
    record(gesture);
    let rejected = false;
    for (const entry of scoped) if (!preview.set(entry.el, name, value)) rejected = true;
    setInvalid(rejected ? name : null);
    return !rejected;
  };
  const nudgeAll = (name: string, delta: number, gesture?: string) => {
    const property = STYLE_PROPERTY.get(name);
    if (!property) return;
    record(gesture);
    for (const entry of scoped) {
      const next = nudgeValue(preview.current(entry.el)[name] ?? '', delta, property);
      if (next !== null) preview.set(entry.el, name, next);
    }
    setInvalid(null);
  };
  const resetAll = (name: string) => {
    record();
    for (const entry of scoped) preview.set(entry.el, name, null);
    setInvalid(null);
  };
  const resetEverything = () => {
    record();
    preview.revert();
    setInvalid(null);
  };

  // Values as shown. Read on every render: an edit can change values it did
  // not set (padding changes an auto width), and the page can re-render.
  const current: StyleValues[] = scoped.map((entry) => preview.current(entry.el));
  const field = (name: string) => mixedValue(current.map((values) => values[name] ?? ''));
  const changed = (name: string) => scoped.some((entry) => name in preview.overrides(entry.el));

  // Groups by original style, so they stay put while the reviewer edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: baselines are fixed per selection.
  const groups = useMemo(
    () => (entries.length > 1 ? groupBySignature(entries.map((entry) => preview.baseline(entry.el))) : []),
    [key],
  );

  // Tokens behind each section's values, for the first few elements in scope.
  const scopeKey = scoped.map((entry) => entry.selector).join('\n');
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when the scope changes.
  const tokens = useMemo(() => {
    const result = new Map<StyleSection, Map<string, string>>();
    if (!scoped.length) return result;
    let index: ReturnType<typeof indexStyleRules>;
    try { index = indexStyleRules(scoped[0].el.ownerDocument); } catch { return result; }
    for (const entry of scoped.slice(0, 6)) {
      for (const property of STYLE_PROPERTY.values()) {
        const origin = styleOrigin(entry.el, property, index);
        if (!origin?.tokens) continue;
        const section = result.get(property.section) ?? new Map<string, string>();
        for (const [name, value] of Object.entries(origin.tokens)) if (section.size < 8) section.set(name, value);
        result.set(property.section, section);
      }
    }
    return result;
  }, [scopeKey]);

  const lead = scoped[scoped.length - 1] ?? entries[entries.length - 1];
  const crumbs = useMemo(() => {
    const list: Element[] = [];
    for (let node = lead?.el.parentElement ?? null; node && node.tagName !== 'HTML'; node = node.parentElement) list.unshift(node);
    return list;
  }, [lead?.el]);
  const children = lead ? selectableChildren(lead.el) : [];
  const crumbStrip = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the current element in view.
  useEffect(() => {
    const strip = crumbStrip.current;
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [lead?.el]);

  const navigate = (to: Element[]) => {
    const from = scoped.map((entry) => entry.el);
    if (!to.length) return;
    onHover(null);
    setChildMenu(false);
    pendingScope.current = onNavigate(from, to);
  };
  const toParent = (levels = 1) => navigate(unique(scoped.map((entry) => ancestorOf(entry.el, levels))));
  const toChild = (model: Element) => {
    const index = lead ? selectableChildren(lead.el).indexOf(model) : 0;
    navigate(unique(scoped.map((entry) => matchingChild(entry.el, model, index))));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // In a field, Alt+arrow is a fine step; elsewhere it moves the selection.
    const inField = target.closest('input, select, textarea') !== null;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !inField) {
      event.preventDefault();
      if (event.key === 'ArrowUp') toParent();
      else if (children[0]) toChild(children[0]);
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z' && !target.dataset.dirty) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (event.key === 'Escape' && childMenu) {
      event.preventDefault();
      setChildMenu(false);
    }
  };

  const count = preview.count();
  const values = (name: string) => {
    const mixed = field(name);
    return { value: mixed.value, mixed };
  };
  const props = (name: string, label?: string) => {
    const property = STYLE_PROPERTY.get(name) as StyleProperty;
    const { value } = values(name);
    return {
      property,
      value,
      changed: changed(name),
      invalid: invalid === name,
      name: NAMES[name] ?? name,
      label: label ?? property.label,
      onSet: (next: string, gesture?: string) => setAll(name, next, gesture),
      onReset: () => resetAll(name),
    };
  };
  const number = (name: string, label?: string) => (
    <NumberField {...props(name, label)} onNudge={(delta, gesture) => nudgeAll(name, delta, gesture)} />
  );
  const cell = (name: string) => (
    <NumberField {...props(name)} bare onNudge={(delta, gesture) => nudgeAll(name, delta, gesture)} />
  );
  /**
   * Narrow to the elements that share one of a Mixed value: each section
   * offers this for its first Mixed property, e.g. "padding-top 30px ×1".
   */
  const mixedChoices = (id: StyleSection) => {
    const mixedProperty = [...STYLE_PROPERTY.values()].find((property) => {
      if (property.section !== id) return false;
      const { mixed } = values(property.name);
      return mixed.mixed && mixed.options.length <= 6;
    });
    if (!mixedProperty) return null;
    const { mixed } = values(mixedProperty.name);
    const label = (NAMES[mixedProperty.name] ?? mixedProperty.name).toLowerCase();
    return (
      <fieldset className="isotone-mixed" aria-label={`Edit only elements with this ${label}`}>
        <span className="isotone-mixed-label">Mixed {label}</span>
        {mixed.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="isotone-mixed-value"
            onClick={() => setScope({ selectors: option.indices.map((i) => scoped[i].selector), label: option.value })}
          >
            <span onPointerOver={showOverflowTitle}>{option.value || 'none'}</span><small>×{option.indices.length}</small>
          </button>
        ))}
      </fieldset>
    );
  };

  const displays = new Set(current.map((v) => v.display ?? ''));
  const flex = [...displays].some((d) => d.includes('flex'));
  const grid = [...displays].some((d) => d.includes('grid'));
  const size = (name: 'width' | 'height') => {
    const value = values(name).value;
    if (value === null) return 'Mixed';
    const n = Number.parseFloat(value);
    return /px$/.test(value) && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : value;
  };

  if (!entries.length) {
    return (
      <div className="isotone-style">
        <StyleHead count={0} undo={undo} redo={redo} history={history.current} />
        <div className="isotone-style-empty">
          <Icon name="style" size={16} />
          <p>
            <span>{picking ? 'Click an element on the page' : 'Pin an element to edit its styles'}</span>
            <small>Changes preview live and go to your agent with the note.</small>
          </p>
          {!picking && <button type="button" className="isotone-secondary" onClick={onPick}>Select</button>}
        </div>
      </div>
    );
  }

  const section = (id: StyleSection, content: ReactNode) => {
    const meta = STYLE_SECTIONS.find((s) => s.id === id);
    const open = !collapsed.has(id);
    const sectionTokens = tokens.get(id);
    const edited = scoped.some((entry) => Object.keys(preview.overrides(entry.el)).some((name) => STYLE_PROPERTY.get(name)?.section === id));
    return (
      <section className="isotone-style-section" data-open={open} aria-label={meta?.label}>
        <button type="button" className="isotone-style-section-head" aria-expanded={open} onClick={() => toggleSection(id)}>
          <Icon name="crumb" size={12} />
          <span>{meta?.label}</span>
          {edited && <span className="isotone-style-dot" aria-hidden="true" />}
          {edited && <span className="isotone-sr">, changed</span>}
        </button>
        {open && <div className="isotone-style-section-body">
          {content}
          {mixedChoices(id)}
          {sectionTokens && sectionTokens.size > 0 && (
            <p className="isotone-style-tokens">
              {[...sectionTokens].map(([name, value]) => (
                <span key={name} className="isotone-token"><code onPointerOver={showOverflowTitle}>{name}</code><small onPointerOver={showOverflowTitle}>{value || 'unset'}</small></span>
              ))}
            </p>
          )}
        </div>}
      </section>
    );
  };

  const classes = lead ? Array.from(lead.el.classList) : [];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts for the fields inside.
    <div className="isotone-style" onKeyDown={onKeyDown}>
      <StyleHead count={entries.length} undo={undo} redo={redo} history={history.current} />
      <div className="isotone-style-target">
        <nav className="isotone-crumb-bar" aria-label="Element ancestors">
          <button type="button" className="isotone-icon" aria-label="Select parent (Alt+↑)" title="Select parent · Alt+↑" disabled={!crumbs.length} onClick={() => toParent()}>
            <Icon name="parent" size={13} />
          </button>
          <div className="isotone-crumbs" ref={crumbStrip}>
          {crumbs.slice(-4).map((el, index, shown) => (
            <button
              // Crumbs are positions in the ancestor chain, so the position is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={index}
              type="button"
              className="isotone-crumb"
              onPointerEnter={() => onHover(el)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(el)}
              onBlur={() => onHover(null)}
              onClick={() => toParent(shown.length - index)}
            >
              {elementLabel(el)}
            </button>
          ))}
          <span className="isotone-crumb isotone-crumb-current">
            {scoped.length > 1 ? `${elementLabel(lead.el)} ×${scoped.length}` : elementLabel(lead.el)}
          </span>
          </div>
          <button
            type="button"
            className="isotone-icon"
            aria-label="Select a child (Alt+↓)"
            title="Select a child · Alt+↓"
            aria-expanded={childMenu}
            disabled={!children.length}
            onClick={() => setChildMenu((open) => !open)}
          >
            <Icon name="child" size={13} />
          </button>
        </nav>
        {childMenu && (
          <div className="isotone-child-menu" role="menu" aria-label="Children">
            {children.map((child, index) => (
              <button
                // Children are listed by position; a re-render lists them again.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                key={index}
                type="button"
                role="menuitem"
                className="isotone-child"
                onPointerEnter={() => onHover(child)}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(child)}
                onBlur={() => onHover(null)}
                onClick={() => toChild(child)}
              >
                <span>{elementLabel(child)}</span>
                <small>{(child.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}</small>
              </button>
            ))}
          </div>
        )}
        {classes.length > 0 && <p className="isotone-classes"><span onPointerOver={showOverflowTitle}>{classes.map((name) => `.${name}`).join(' ')}</span></p>}
        {entries.length > 1 && (
          <fieldset className="isotone-scope" aria-label="Apply edits to">
            <button type="button" className="isotone-page" aria-pressed={!scope} onClick={() => setScope(null)}>
              <span>All</span><small>{entries.length}</small>
            </button>
            {groups.length > 1 && groups.length < entries.length && groups.map((group) => {
              const selectors = group.indices.map((i) => entries[i].selector);
              const pressed = scope !== null && scope.selectors.length === selectors.length && selectors.every((s) => scope.selectors.includes(s));
              return (
                <button key={group.key} type="button" className="isotone-page" aria-pressed={pressed} onClick={() => setScope({ selectors, label: group.label })}>
                  <span onPointerOver={showOverflowTitle}>{group.label}</span><small>{group.indices.length}</small>
                </button>
              );
            })}
            {entries.map((entry) => {
              const pressed = scope !== null && scope.selectors.length === 1 && scope.selectors[0] === entry.selector;
              return (
                <button
                  key={entry.selector}
                  type="button"
                  className="isotone-page"
                  aria-pressed={pressed}
                  onPointerEnter={() => onHover(entry.el)}
                  onPointerLeave={() => onHover(null)}
                  onClick={() => setScope({ selectors: [entry.selector], label: entry.label })}
                >
                  <span onPointerOver={showOverflowTitle}>{entry.label}</span>
                </button>
              );
            })}
          </fieldset>
        )}
      </div>
      <div className="isotone-style-body">
        {section('layout', <>
          <SelectField {...props('display')} />
          {flex && <>
            <SegmentField {...props('flex-direction')} options={DIRECTION} />
            <div className="isotone-style-grid">
              <SelectField {...props('flex-wrap')} />
              {number('gap')}
            </div>
          </>}
          {grid && <>
            <TextField {...props('grid-template-columns')} />
            {!flex && number('gap')}
          </>}
          {(flex || grid) && <div className="isotone-style-grid">
            <SelectField {...props('align-items')} />
            <SelectField {...props('justify-content')} />
          </div>}
        </>)}
        {section('spacing', (
          <fieldset className="isotone-box" aria-label="Margin and padding">
            <span className="isotone-box-caption">Margin</span>
            <span className="isotone-box-top">{cell('margin-top')}</span>
            <span className="isotone-box-left">{cell('margin-left')}</span>
            <div className="isotone-box-padding">
              <span className="isotone-box-caption">Padding</span>
              <span className="isotone-box-top">{cell('padding-top')}</span>
              <span className="isotone-box-left">{cell('padding-left')}</span>
              <span className="isotone-box-content">{size('width')} × {size('height')}</span>
              <span className="isotone-box-right">{cell('padding-right')}</span>
              <span className="isotone-box-bottom">{cell('padding-bottom')}</span>
            </div>
            <span className="isotone-box-right">{cell('margin-right')}</span>
            <span className="isotone-box-bottom">{cell('margin-bottom')}</span>
          </fieldset>
        ))}
        {section('size', (
          <div className="isotone-style-grid">
            {number('width')}
            {number('height')}
          </div>
        ))}
        {section('typography', <>
          <div className="isotone-style-grid">
            {number('font-size')}
            <SelectField {...props('font-weight')} />
            {number('line-height')}
            {number('letter-spacing')}
          </div>
          <ColorField {...props('color')} />
          <SegmentField {...props('text-align')} options={TEXT_ALIGN} />
        </>)}
        {section('fill', <>
          <ColorField {...props('background-color')} />
          <div className="isotone-style-grid">
            {number('border-width')}
            <SelectField {...props('border-style')} />
          </div>
          <ColorField {...props('border-color')} />
          <div className="isotone-style-grid">
            {number('border-radius')}
            {number('opacity')}
          </div>
          <TextField {...props('box-shadow')} />
        </>)}
      </div>
      <div className="isotone-style-foot">
        <button type="button" className="isotone-secondary" disabled={!count} onClick={resetEverything}>Reset</button>
        <span className="isotone-style-count" aria-live="polite">{count ? `${count} change${count === 1 ? '' : 's'}` : 'No changes yet'}</span>
        <button type="button" className="isotone-save isotone-style-send" disabled={!count} onClick={onSend}>
          Send to agent <Icon name="send" size={12} />
        </button>
      </div>
    </div>
  );
}

function StyleHead({ count, undo, redo, history }: {
  count: number; undo(): void; redo(): void; history: { undo: unknown[]; redo: unknown[] };
}) {
  return (
    <div className="isotone-style-head">
      <h2>Style</h2>
      <span className="isotone-experimental">Experimental</span>
      {count > 1 && <span className="isotone-count">{count} elements</span>}
      <span className="isotone-style-actions">
        <button type="button" className="isotone-icon" aria-label="Undo style change" title="Undo · ⌘Z" disabled={!history.undo.length} onClick={undo}>
          <Icon name="undo" size={14} />
        </button>
        <button type="button" className="isotone-icon" aria-label="Redo style change" title="Redo · ⇧⌘Z" disabled={!history.redo.length} onClick={redo}>
          <Icon name="redo" size={14} />
        </button>
      </span>
    </div>
  );
}
