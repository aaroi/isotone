import { APPEARANCE_CSS } from './appearance';
import { MOTION } from '../motion';

/** One shared set of tokens and controls for the shadow-root and inline mounts. */
const MARKER = 'data-isotone-styles';
/** Thumbnail options sit in rows of this many; the arrow keys move by a row. */
export const GRID_COLUMNS = 2;
export const PANEL_CSS = `
${APPEARANCE_CSS}
.isotone-root, .isotone-root *, .isotone-root *::before, .isotone-root *::after { box-sizing: border-box; }
/* Keep native scrolling and focus reveal without visible scrollbar chrome. */
.isotone-root * { scrollbar-width: none; }
.isotone-root *::-webkit-scrollbar { display: none; }
.isotone-root :where(button, textarea, input, fieldset) { font: inherit; color: inherit; margin: 0; padding: 0; background: none; border: 0; }
.isotone-root fieldset { min-inline-size: 0; }
.isotone-root :where(button) { cursor: pointer; touch-action: manipulation; }
.isotone-root :where(button:disabled) { cursor: default; opacity: .4; }
.isotone-root :where(ul, li, p, h2, h3) { margin: 0; padding: 0; list-style: none; }
.isotone-root {
  --iso-space: 12px; --iso-view-gap: 8px; --iso-control-radius: 999px;
  /* Panels are 18px cards with a 14px inset; wells inside them follow with 12px corners. */
  --iso-panel-radius: 18px; --iso-panel-inset: 14px; --iso-inner-radius: 12px;
  /* Shared geometry. Themes must not override these tokens. */
  --iso-rail-size: 44px; --iso-rail-padding: 4px; --iso-rail-gap: var(--iso-rail-padding);
  --iso-rail-key-size: calc(var(--iso-rail-size) - 4 * var(--iso-rail-padding));
  --iso-rail-step: calc(var(--iso-rail-key-size) + var(--iso-rail-gap));
  --iso-rail-end: calc(var(--iso-rail-padding) + var(--iso-rail-gap) / 2);
  --iso-rail-length: calc(2 * var(--iso-rail-step) + 2 * var(--iso-rail-end));
  --iso-rail-key-inset: calc((var(--iso-rail-size) - var(--iso-rail-key-size)) / 2);
  --iso-sans: var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif);
  --iso-zinc-50: oklch(98.5% 0 0); --iso-zinc-100: oklch(96.7% .001 286.375);
  --iso-zinc-200: oklch(92% .004 286.32); --iso-zinc-300: oklch(87.1% .006 286.286);
  --iso-zinc-400: oklch(70.5% .015 286.067); --iso-zinc-500: oklch(55.2% .016 285.938);
  --iso-zinc-600: oklch(44.2% .017 285.786); --iso-zinc-700: oklch(37% .013 285.805);
  --iso-zinc-800: oklch(27.4% .006 286.033); --iso-zinc-900: oklch(21% .006 285.885);
  --iso-zinc-950: oklch(14.1% .005 285.823);
  --iso-ease-out: ${MOTION.easeOut};
  --iso-fast: ${MOTION.exit}ms; --iso-enter: ${MOTION.enter}ms; --iso-exit: ${MOTION.exit}ms;
  --iso-dock-width: min(340px, calc(100vw - 32px));
  /* The height the dock may fill: what is visible (above an on-screen keyboard,
     see viewport.ts) less the safe areas it keeps clear of. */
  --iso-view-height: calc(var(--iso-viewport, 100dvh) - env(safe-area-inset-top, 0px) - max(0px, env(safe-area-inset-bottom, 0px) - 16px));
  position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(calc(16px + var(--iso-keyboard, 0px)), env(safe-area-inset-bottom));
  z-index: 2147483000; width: 44px; display: flex; flex-direction: column; isolation: isolate; max-height: calc(var(--iso-view-height) - 32px); color: var(--iso-fg);
  font: 12px/1.5 var(--iso-sans); -webkit-font-smoothing: antialiased;
  text-align: left; letter-spacing: normal; color-scheme: dark;
  /* Inherited text properties cross the shadow boundary: an RTL or styled host must not mirror or restyle the panel. */
  direction: ltr; writing-mode: horizontal-tb; word-spacing: normal; text-indent: 0; text-transform: none;
  text-shadow: none; white-space: normal; font-feature-settings: normal; font-variation-settings: normal; -webkit-text-fill-color: currentColor;
  cursor: auto;
}
.isotone-root :where(button, input, textarea):focus-visible { outline: 2px solid var(--iso-focus); outline-offset: 3px; }
.isotone-root button { transition: transform var(--iso-fast) var(--iso-ease-out), opacity var(--iso-fast) var(--iso-ease-out); }
.isotone-root button:not(:disabled):active > svg { transform: scale(.92); transition-duration: 100ms; }
.isotone-root svg { display: block; flex-shrink: 0; pointer-events: none; transition: transform var(--iso-fast) var(--iso-ease-out); }
/* Panels move independently; their content and corners retain their natural size. */
.isotone-root[data-open='true'] { width: var(--iso-dock-width); }
.isotone-root { pointer-events: none; }
.isotone-root :is(.isotone-panel, .isotone-rail-button, .isotone-fab, .isotone-float, .isotone-resize) { pointer-events: auto; }
/* Invisible handles on the dock's left edge, the top edge of the top panel and the gap between two panels.
   Only keyboard focus draws one, as a line on the edge itself, kept clear of the rounded corners. */
.isotone-resize { position: absolute; z-index: 2; touch-action: none; outline: none; }
.isotone-resize-w { left: -4px; top: 20px; bottom: calc(var(--iso-rail-size) + var(--iso-view-gap) + 12px); width: 8px; cursor: ew-resize; }
.isotone-resize-h { top: -4px; left: 20px; right: 20px; height: 8px; cursor: ns-resize; }
.isotone-resize-split { top: calc(0px - var(--iso-view-gap)); }
.isotone-resize:focus-visible::after { content: ''; position: absolute; border-radius: 2px; background: var(--iso-focus); }
.isotone-resize-w:focus-visible::after { left: 3px; width: 2px; top: 0; bottom: 0; }
.isotone-resize-h:focus-visible::after { top: 3px; height: 2px; left: 0; right: 0; }
.isotone-root[data-resizing='true'] { user-select: none; }
/* The horizontal pill stays anchored while its panels open above it. */
.isotone-rail, .isotone-rail-tools { display: contents; border: 0; margin: 0; padding: 0; min-width: 0; }
.isotone-root[data-expanded='true'] { min-height: 44px; }
.isotone-root[data-expanded='true'][data-open='false'][data-tools='2'] { width: var(--iso-rail-length); }
.isotone-root[data-open='true'] { padding-bottom: calc(var(--iso-rail-size) + var(--iso-view-gap)); gap: var(--iso-view-gap); }
.isotone-rail-track { position: absolute; right: 0; bottom: 0; width: var(--iso-rail-size); height: var(--iso-rail-size); border-radius: 999px; background: var(--iso-rail-base); border: 0; box-shadow: var(--iso-rail-base-shadow); pointer-events: auto; transition: width var(--iso-enter) var(--iso-ease-out), height var(--iso-enter) var(--iso-ease-out); }
.isotone-root[data-expanded='true'][data-tools='2'] .isotone-rail-track { width: var(--iso-rail-length); }
.isotone-fab, .isotone-rail-button { display: flex; align-items: center; justify-content: center; flex: none; width: var(--iso-rail-size); height: var(--iso-rail-size); border-radius: 999px; }
.isotone-fab { position: relative; isolation: isolate; color: var(--iso-launcher-ink); }
.isotone-rail-button { position: absolute; bottom: 0; right: 0; display: none; color: var(--iso-icon-rest); isolation: isolate; z-index: 1; }
.isotone-root[data-expanded='true'] .isotone-rail-button { display: flex; }
.isotone-root[data-expanded='true'] .isotone-fab { display: none; }
.isotone-rail-button::before { content: ''; position: absolute; inset: var(--iso-rail-key-inset); border-radius: 999px; z-index: -1; pointer-events: none; }
.isotone-rail-button[aria-expanded='true'] { color: var(--iso-fg); }
/* 28px key faces, with 4px between keys and around them, in every appearance. */
.isotone-root[data-tools='2'] .isotone-rail-button { width: var(--iso-rail-step); right: var(--iso-rail-end); }
.isotone-root[data-tools='2'] .isotone-rail-button[aria-label='Variants'] { right: calc(var(--iso-rail-end) + var(--iso-rail-step)); }
.isotone-root[data-tools='2'] .isotone-rail-button::before { inset: var(--iso-rail-key-inset) calc(var(--iso-rail-gap) / 2); }
.isotone-tool-label { display: none; }
.isotone-badge { position: absolute; right: -3px; top: -3px; pointer-events: none; display: grid; place-items: center; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--iso-accent); box-shadow: 0 0 0 2px var(--iso-rail-base); color: var(--iso-accent-ink); font-size: 9px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* Panels are sections inside the dock. Only long content scrolls. */
.isotone-panel { order: 0; position: relative; display: none; flex-direction: column; min-height: 0; flex: 0 1 auto; width: 100%; }
.isotone-panel[data-open='true'] { display: flex; }
.isotone-variants-panel { flex-shrink: 1; max-height: calc(var(--iso-view-height) - 76px); }
.isotone-notes-panel { flex-shrink: 0; max-height: calc(var(--iso-view-height) - 76px); padding: var(--iso-panel-inset); gap: var(--iso-space); }
.isotone-root .isotone-panel { background: var(--iso-bg); border: 0; border-radius: var(--iso-panel-radius); box-shadow: var(--iso-panel-shadow); }
/* The close control sits on the panel's top-left corner, half outside it, with
   the same face as a note's delete button, a touch larger. It fades in while the
   pointer is over the panel; keyboard focus and touch screens always show it. */
.isotone-panel-close { position: absolute; left: -8px; top: -8px; z-index: 3; width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border: 0; isolation: isolate; color: var(--iso-muted); background: none; opacity: 0; }
.isotone-panel-close::before { content: ''; position: absolute; inset: 4px; border-radius: 50%; z-index: -1; background: var(--iso-popup-face); box-shadow: var(--iso-key-shadow); transition: background-color 120ms ease; }
.isotone-root .isotone-panel > .isotone-panel-close { transition: opacity 220ms ease, color 120ms ease; }
.isotone-root .isotone-panel:hover > .isotone-panel-close, .isotone-panel-close:focus-visible { opacity: 1; }
.isotone-root .isotone-panel > .isotone-panel-close:hover { color: var(--iso-fg); }
.isotone-panel-close:hover::before { background: var(--iso-control-hover-face); }
@media (hover: none) { .isotone-panel-close { opacity: 1; } }
/* The defaults bar, at the foot of the variants panel while a pick differs from its default. */
.isotone-root .isotone-vars > .isotone-panel-head { display: flex; align-items: center; gap: 8px; padding: var(--iso-space); z-index: 1; }
/* --iso-menu-max bounds a dialog squeezed above its heading, which then scrolls there; 12px stays clear below. */
.isotone-root .isotone-axis-menu { top: var(--iso-menu-top, 6px); max-height: min(var(--iso-menu-max, 100%), calc(100% - var(--iso-menu-top, 6px) - 12px)); }
.isotone-head-actions { display: flex; align-items: center; gap: 6px; margin-right: auto; }
.isotone-icon { width: 28px; height: 28px; display: inline-grid; place-items: center; flex: none; color: var(--iso-muted); border-radius: 999px; }
.isotone-count { margin-left: 5px; color: var(--iso-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.isotone-vars { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.isotone-vars { min-height: min(var(--iso-menu-need, 0px), calc(var(--iso-view-height) - 76px)); }
/* The panel no longer clips, so its corner close can overhang; the variants body clips itself. */
.isotone-root .isotone-panel > .isotone-vars { overflow: hidden; border-radius: var(--iso-panel-radius); }
/* A stable gutter: classic scrollbars appearing (the defaults bar adds scroll room) never narrow and re-wrap the list. */
.isotone-vars-body { flex: 1; overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; min-height: 0; overscroll-behavior: contain; padding: var(--iso-panel-inset); display: flex; flex-direction: column; gap: var(--iso-panel-inset); }
/* The footer overlaps only the scroller's bottom padding: content fades beneath
   it while scrolling, but the last control remains fully visible at the end. */
/* A selector out of view skips layout, so opening Feedback beside hundreds of them does not lay out every one.
   The clip margin keeps focus rings and corner badges, which reach past the selector, unclipped. */
.isotone-axis { flex: none; content-visibility: auto; contain-intrinsic-size: auto 72px; overflow-clip-margin: 12px; }
/* Sections name the part of the page their selectors change. The header sticks to
   the top of the scroll area while its own selectors pass beneath and fade into the
   surface; the next section's header pushes it out. At rest its padding occupies
   the inset or gap above it, so sticking does not move the text. */
.isotone-section, .isotone-section-body { flex: none; display: flex; flex-direction: column; gap: var(--iso-space); }
.isotone-section-body[hidden] { display: none; }
.isotone-vars-body > * + .isotone-section { padding-top: 8px; }
/* After a collapsed section, the next header sits as close as a list of headers,
   whether that next section is open or not. */
.isotone-section[data-collapsed='true'] + .isotone-section { padding-top: 0; margin-top: -4px; }
/* A collapsed section has nothing to stick over, so its header's backdrop only needs
   to reach the smaller gap; a full inset would cover the header above it. */
.isotone-section[data-collapsed='true'] + .isotone-section[data-collapsed='true'] > .isotone-section-head { margin-top: -4px; padding-top: 4px; }
/* An open section keeps its full backdrop so it covers content when stuck; the
   collapsed header above paints over the part that reaches into the gap. */
.isotone-section[data-collapsed='true'] > .isotone-section-head { z-index: 2; }
/* Sticky offsets start inside the scroller's padding; the negative top reaches its edge. */
.isotone-section-head { position: sticky; top: calc(0px - var(--iso-panel-inset)); z-index: 1; margin: calc(0px - var(--iso-panel-inset)) calc(0px - var(--iso-panel-inset)) -4px; padding: var(--iso-panel-inset) var(--iso-panel-inset) 0; background: var(--iso-bg); font: inherit; }
.isotone-section-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 14px; background: linear-gradient(var(--iso-bg), transparent); pointer-events: none; }
.isotone-section-toggle { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: calc(100% + 7px); min-height: 24px; padding: 2px 7px; margin-left: -7px; border-radius: 999px; text-align: left; color: color-mix(in oklch, var(--iso-fg) 45%, var(--iso-muted)); font-size: 11px; font-weight: 500; }
.isotone-section-toggle > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-section-toggle > svg, .isotone-section-toggle > small { flex: none; }
.isotone-section-toggle > small { color: var(--iso-faint); font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
.isotone-section[data-collapsed='true'] .isotone-section-toggle > svg { transform: rotate(-90deg); }
/* Keyboard focus reveal keeps a focused control clear of the sticky header. */
.isotone-vars-body:has(> .isotone-section) { scroll-padding-top: 44px; }
.isotone-axis-head { display: flex; align-items: center; justify-content: space-between; min-height: 24px; gap: 8px; margin-bottom: 6px; }
.isotone-axis-label { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; min-height: 24px; padding: 2px 7px; margin-left: -7px; border-radius: 999px; text-align: left; }
.isotone-axis-label, .isotone-menu-title > strong, .isotone-menu-heading > strong { font: inherit; font-weight: 450; }
/* A dialog's title is a step larger than the label that opened it, at the same weight. */
.isotone-menu-title > strong, .isotone-menu-heading > strong { font-size: 13px; }
.isotone-axis-label > span, .isotone-menu-title > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A touch quieter than the label's muted ink, between muted and faint; full muted when it is in use. */
.isotone-axis-label svg { color: color-mix(in oklch, var(--iso-muted) 50%, var(--iso-faint)); transition: color var(--iso-fast) var(--iso-ease-out), transform var(--iso-fast) var(--iso-ease-out); }
.isotone-axis-label[aria-expanded='true'] svg, .isotone-axis-label:focus-visible svg { color: var(--iso-muted); }
.isotone-axis-value { min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font: 11px var(--iso-sans); font-variant-numeric: tabular-nums; }
/* The track's corner is a segment's half height plus the track's padding, so it stays concentric with the capsules inside:
   a full capsule on one row, a rounded card around wrapped rows. useSegmentLayout picks the layout from the labels. */
.isotone-segs { --iso-seg-h: 28px; --iso-seg-pad: 3px; --iso-seg-gap: 3px; display: flex; flex-wrap: wrap; gap: var(--iso-seg-gap); padding: var(--iso-seg-pad); border-radius: calc(var(--iso-seg-h) / 2 + var(--iso-seg-pad)); background: var(--iso-well); box-shadow: var(--iso-segment-track-shadow); }
/* Measured to fit, so a row never wraps: options share the room evenly but never shrink past their labels. */
.isotone-segs[data-layout='row'] { flex-wrap: nowrap; }
.isotone-segs[data-layout='row'] > .isotone-opt-seg { flex-basis: 0; }
/* Wrapped rows keep one column width, so options line up; a short last row stretches to fill, and labels truncate before they stack. */
/* Half a pixel under the exact share, so rounding never pushes a row's last column onto the next row. */
.isotone-segs[data-layout='wrap'] > .isotone-opt-seg { flex: 1 1 calc((100% - (var(--iso-seg-cols) - 1) * var(--iso-seg-gap)) / var(--iso-seg-cols) - .5px); min-width: 0; }
.isotone-seg { width: 100%; flex: 1 1 64px; min-width: 0; height: var(--iso-seg-h, 28px); padding: 6px 8px; line-height: 16px; border-radius: 999px; color: var(--iso-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-seg > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-seg[aria-checked='true'] { color: var(--iso-fg); }
.isotone-opt { position: relative; display: flex; min-width: 0; }
/* Never narrower than its label plus the chevron's corner on both sides, so a long label widens its own segment instead of running under the chevron. */
/* A segment is at least its label wide, so labels wrap to a new row before they truncate, but never wider than the row. */
.isotone-opt-seg { flex: 1 1 64px; min-width: auto; max-width: 100%; }
/* The right side clears the hover chevron (5px in, 16px wide); the left only needs the default dot, so options stay narrow enough to share a row. */
.isotone-opt-seg > .isotone-seg { padding-inline: 18px 24px; }
.isotone-opt-swatch { flex: none; }
.isotone-opt > .isotone-seg, .isotone-opt > .isotone-thumb { flex: 1 1 auto; }
/* Quiet and tucked into the option's corner so it never covers the label. With a
   pointer it appears on hover or keyboard focus only (see the hover block); touch
   screens, which cannot hover, always show it. */
.isotone-opt > .isotone-opt-more { position: absolute; top: 1px; right: 1px; z-index: 1; width: 16px; height: 16px; border-radius: 4px; color: var(--iso-faint); background: none; box-shadow: none; }
/* In a capsule segment the chevron sits centred on the right, clear of the rounded end and the default dot. */
.isotone-opt-seg > .isotone-opt-more { top: 50%; right: 5px; margin-top: -8px; border-radius: 50%; }
.isotone-opt-thumb > .isotone-opt-more { top: 4px; right: 4px; border-radius: 50%; background: var(--iso-label-face); box-shadow: var(--iso-label-shadow); }
/* On a swatch it is a small badge just off the corner rather than a button over a
   third of the colour: it overlaps only the rounded corner, outside the paint, so a
   press anywhere on the colour picks it. */
.isotone-opt-swatch > .isotone-opt-more { top: -11px; right: -11px; width: 16px; height: 16px; border-radius: 50%; }
.isotone-opt-swatch > .isotone-opt-more::before { inset: 1px; }
.isotone-opt-swatch > .isotone-opt-more svg { width: 10px; height: 10px; }
.isotone-menu-heading { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.isotone-menu-heading > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The option leads, the selector follows in the same line and size, quieter, as in “Compact Spacing”. */
.isotone-menu-heading > strong { flex: 0 1 auto; }
.isotone-menu-heading > span { flex: 0 1000 auto; color: var(--iso-muted); font-weight: 400; }
.isotone-grid { display: grid; grid-template-columns: repeat(${GRID_COLUMNS},minmax(0,1fr)); gap: 10px; }
.isotone-thumb { position: relative; display: block; min-width: 0; border-radius: 10px; overflow: hidden; background: var(--iso-deep); box-shadow: var(--iso-thumb-shadow); color: var(--iso-muted); }
.isotone-thumb img { display: block; width: 100%; height: 72px; object-fit: cover; }
.isotone-thumb > span { position: absolute; bottom: 6px; left: 6px; max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: 999px; background: var(--iso-label-face); box-shadow: var(--iso-label-shadow); color: color-mix(in oklch, var(--iso-fg) 50%, var(--iso-muted)); text-align: left; font-size: 10px; font-weight: 500; }
.isotone-thumb[aria-checked='true'], .isotone-thumb[aria-checked='true'] > span { color: var(--iso-fg); }
/* The 14px knob has 5px of space above it inside its 24px hit area. */
.isotone-axis-head:has(+ :is(.isotone-range, .isotone-range-wrap)) { margin-bottom: 1px; }
.isotone-range { display: block; appearance: none; -webkit-appearance: none; width: 100%; height: 24px; cursor: pointer; }
/* A recessed groove, a round knob and a clear default mark. */
.isotone-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: var(--iso-track); box-shadow: var(--iso-track-shadow); }
.isotone-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: var(--iso-range-thumb-face); box-shadow: var(--iso-range-thumb-shadow); }
.isotone-range::-moz-range-track { height: 4px; border-radius: 4px; background: var(--iso-track); box-shadow: var(--iso-track-shadow); }
.isotone-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; box-shadow: var(--iso-range-thumb-shadow); border-radius: 50%; background: var(--iso-range-thumb-face); }
.isotone-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 3px; }
.isotone-swatch, .isotone-picker { width: 26px; height: 26px; border-radius: 50%; box-shadow: var(--iso-swatch-shadow); flex: none; }
.isotone-swatch[aria-checked='true'] { box-shadow: var(--iso-swatch-selected-shadow); }
.isotone-picker { display: block; position: relative; overflow: hidden; background: conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444); }
.isotone-picker[aria-expanded='true'], .isotone-picker[data-custom='true'] { box-shadow: var(--iso-swatch-selected-shadow); }
/* A custom pick shows its colour inside the hue ring, the way a selected swatch keeps its colour. */
.isotone-picker[data-custom='true']::after { content: ''; position: absolute; inset: 6px; border-radius: 50%; background: var(--iso-custom); box-shadow: 0 0 0 1.5px var(--iso-popup-face); }
/* The custom colour well: recessed like a selector slot, in the panel's own materials. */
/* The custom colour popover: the action dialog's popup material and entrance, anchored to its swatch. */
.isotone-colour { position: absolute; left: 6px; right: 6px; z-index: 3; display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 14px; background: var(--iso-popup-face); box-shadow: var(--iso-popup-shadow); transform-origin: top right; transition: opacity var(--iso-enter) var(--iso-ease-out), transform var(--iso-enter) var(--iso-ease-out); }
@starting-style { .isotone-colour { opacity: 0; transform: translateY(-4px) scale(.97); } }
.isotone-colour-field { position: relative; height: 112px; border-radius: 10px; cursor: crosshair; touch-action: none; background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.isotone-colour-handle { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0 / .28), 0 1px 3px rgb(0 0 0 / .3); pointer-events: none; }
.isotone-colour-handle:focus-visible { outline: 2px solid var(--iso-focus); outline-offset: 2px; }
.isotone-hue { display: block; appearance: none; -webkit-appearance: none; width: 100%; height: 14px; margin: 0; background: transparent; cursor: pointer; }
.isotone-hue::-webkit-slider-runnable-track { height: 8px; border-radius: 4px; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.isotone-hue::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; margin-top: -3px; border-radius: 4px; background: var(--iso-range-thumb-face); box-shadow: var(--iso-range-thumb-shadow); }
.isotone-hue::-moz-range-track { height: 8px; border-radius: 4px; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.isotone-hue::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 4px; background: var(--iso-range-thumb-face); box-shadow: var(--iso-range-thumb-shadow); }
.isotone-colour-row { display: flex; align-items: center; gap: 4px; min-height: 24px; }
.isotone-colour-hash { color: var(--iso-faint); font-size: 11px; padding-left: 4px; }
.isotone-colour-hex { flex: 1; min-width: 0; height: 24px; padding: 0 2px; border: 0; background: transparent; color: var(--iso-fg); font: inherit; font-size: 11px; font-variant-numeric: tabular-nums; letter-spacing: .04em; text-transform: uppercase; outline: none; }
.isotone-colour-hex:focus-visible { outline: 2px solid var(--iso-focus); outline-offset: 1px; border-radius: 4px; }
/* Raised actions share one face, edge and hover treatment. */
.isotone-save, .isotone-secondary, .isotone-picking button, .isotone-away-action { border-radius: var(--iso-control-radius); color: var(--iso-fg); background: var(--iso-control-face); box-shadow: var(--iso-control-shadow); }
/* Sending is the one coloured control; with nothing to send it sinks to a quiet face. */
.isotone-send { border-radius: 999px; color: var(--iso-accent-ink); background: var(--iso-accent); box-shadow: var(--iso-accent-shadow); }
.isotone-root .isotone-send:disabled { opacity: 1; color: var(--iso-faint); background: var(--iso-hover); box-shadow: none; }
/* Persistent selections share the raised action material, never the recessed
   field/slot material. Keep the face and shadow together in this one rule. */
.isotone-note-editing .isotone-note-hit,
.isotone-seg[aria-checked='true'],
.isotone-thumb[aria-checked='true'],
.isotone-pick[aria-pressed='true'] { background: var(--iso-selected-face); box-shadow: var(--iso-selected-shadow); }
/* The open tool lifts into a key on the rail's capsule. */
.isotone-rail-button[aria-expanded='true']::before { background: var(--iso-key-face); box-shadow: var(--iso-key-shadow); }
.isotone-secondary { padding: 6px 12px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.isotone-save { min-height: 26px; padding: 2px 12px; font-size: 11px; white-space: nowrap; overflow: hidden; }
.isotone-root .isotone-vars > .isotone-panel-head .isotone-head-actions { flex: 1; min-width: 0; }
/* The defaults bar floats over the panel's foot and takes no space, so a pick never moves the selectors and an
   untouched panel has no gap. While it shows, the list can scroll its last row clear of it (see .isotone-vars-tail). */
.isotone-vars { --iso-save-bar-h: calc(var(--iso-space) * 3 + 26px); }
.isotone-root .isotone-vars > .isotone-panel-head { position: absolute; left: 0; right: 0; bottom: 0; height: var(--iso-save-bar-h); min-height: 0; margin: 0; padding-top: calc(var(--iso-space) * 2); background: linear-gradient(to bottom, transparent, var(--iso-bg) calc(var(--iso-space) * 2)); transition: opacity var(--iso-enter) var(--iso-ease-out), transform var(--iso-enter) var(--iso-ease-out); }
.isotone-root .isotone-vars > .isotone-panel-head[data-shown='false'] { opacity: 0; transform: translateY(6px); pointer-events: none; }
/* Extends how far the list scrolls without adding to its height: an absolute box counts towards the scroller's
   overflow but not its size. Cancels its own gap, so it costs nothing while the bar is hidden. */
.isotone-vars-tail { position: relative; flex: none; height: 0; margin-top: calc(0px - var(--iso-panel-inset)); pointer-events: none; }
.isotone-vars[data-saving='true'] .isotone-vars-tail::after { content: ''; position: absolute; left: 0; top: 0; width: 1px; height: var(--iso-save-bar-h); }
/* Keyboard focus scrolls a control clear of the bar too. */
.isotone-vars[data-saving='true'] > .isotone-vars-body { scroll-padding-bottom: var(--iso-save-bar-h); }
.isotone-save-row { position: relative; display: flex; align-items: center; gap: 5px; width: 100%; min-width: 0; }
.isotone-save-count { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--iso-muted); }
/* The source default, marked where the choice is made rather than only in the actions dialog. */
.isotone-seg, .isotone-swatch { position: relative; }
.isotone-default-dot { position: absolute; top: 4px; right: 4px; width: 4px; height: 4px; border-radius: 50%; background: var(--iso-dot); pointer-events: none; }
/* In a capsule the dot leads the label, so the chevron on the right never takes its place. */
.isotone-opt-seg .isotone-default-dot { top: 50%; left: 9px; right: auto; margin-top: -2px; }
.isotone-thumb .isotone-default-dot { top: 6px; right: 6px; width: 5px; height: 5px; box-shadow: 0 0 0 2px var(--iso-deep); }
.isotone-swatch.isotone-is-default::after { content: ''; position: absolute; left: 50%; bottom: -6px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--iso-dot); }
.isotone-range-wrap { position: relative; }
/* Drawn over the track, so it reads as a mark on the line; hidden while the thumb sits on it. */
.isotone-range-tick { position: absolute; top: 50%; left: calc(7px + (100% - 14px) * var(--iso-default-at, 0)); width: 2px; height: 10px; margin: -5px 0 0 -1px; border-radius: 1px; background: var(--iso-tick); pointer-events: none; }
.isotone-save-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.isotone-save-label { display: block; }
/* A local action sheet overlays controls, preserving every underlying position. */
.isotone-axis-menu { position: absolute; inset: 48px 6px auto; z-index: 2; background: var(--iso-popup-face); border-radius: 14px; max-height: calc(100% - 54px); box-shadow: var(--iso-popup-shadow); display: flex; flex-direction: column; transform-origin: top left; opacity: 0; transform: translateY(-4px) scale(.97); visibility: hidden; transition: opacity var(--iso-exit) var(--iso-ease-out), transform var(--iso-exit) var(--iso-ease-out), visibility 0s var(--iso-exit); }
.isotone-axis-menu[data-open='true'] { visibility: visible; opacity: 1; transform: none; transition-delay: 0s; }
@starting-style { .isotone-axis-menu[data-open='true'] { opacity: 0; transform: translateY(-4px) scale(.97); } }
.isotone-menu-title { position: relative; z-index: 1; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 10px 8px 16px; }
/* Fade the moving content into the popup's actual material. A mask preserves
   Instrument's surface gradient and works identically in light and dark mode.
   Matching negative margin/padding preserves the first action's resting position. */
.isotone-menu-scroll { --iso-scroll-fade-bottom: 0px; scroll-padding-block: var(--iso-space) calc(var(--iso-scroll-fade-bottom) + 6px); overflow-y: auto; overscroll-behavior: contain; flex: 1; min-height: 0; margin-top: calc(0px - var(--iso-space)); padding: var(--iso-space) 6px 6px; mask-image: linear-gradient(to bottom, transparent, #000 var(--iso-space), #000 calc(100% - var(--iso-scroll-fade-bottom)), transparent); }
/* The last row fades out rather than being cut; a dialog that has to scroll fades longer, reading as more below. */
.isotone-menu-scroll { --iso-scroll-fade-bottom: var(--iso-space); padding-bottom: calc(var(--iso-space) + 6px); }
.isotone-menu-scroll[data-overflow='true'] { --iso-scroll-fade-bottom: 28px; }
.isotone-menu-action { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; border-radius: 8px; text-align: left; padding: 8px 10px; font-size: 12px; }
.isotone-menu-options { padding: 7px 0; margin: 5px 0; border-top: 1px solid var(--iso-line); border-bottom: 1px solid var(--iso-line); }
.isotone-option-row { display: flex; align-items: center; padding: 2px 4px 2px 7px; gap: 4px; }
.isotone-option-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; }
.isotone-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Tags never shrink, so a long label truncates before them instead of hiding them. */
.isotone-option-tags { flex: none; display: flex; gap: 6px; white-space: nowrap; }
.isotone-option-tags small { font-size: 10px; color: var(--iso-muted); }
/* A pending removal stays listed and readable; only its text quietens. */
.isotone-option-row[data-requested] .isotone-option-label { color: var(--iso-muted); }
.isotone-menu-footer { flex-shrink: 0; padding: 9px 12px; border-top: 1px solid var(--iso-line); font-size: 10px; color: var(--iso-muted); min-height: 0; }
.isotone-confirm { display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; }
.isotone-danger { color: var(--iso-danger); }
/* Scroll through the panel's top inset and fade against its actual surface.
   Cancelling margin/padding keeps the first row in place at scroll start; the
   expanded height preserves the content allowance and composer position.
   The side gutters contain the corner action and keyboard focus outlines. */
.isotone-list { display: flex; flex-direction: column; gap: 0; flex: 0 1 auto; max-height: calc(var(--iso-list-height) + 2 * var(--iso-space) - 8px); min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; margin: calc(0px - var(--iso-space)) calc(-8px - var(--iso-note-outset)) calc(-2px - var(--iso-space)); padding: var(--iso-space) 8px; scroll-padding-block: var(--iso-space); mask-image: linear-gradient(to bottom, transparent, #000 var(--iso-space), #000 calc(100% - var(--iso-space)), transparent); }
.isotone-empty { color: var(--iso-muted); font-size: 11px; line-height: 1.7; padding: 8px; }
.isotone-note { position: relative; flex: none; }
.isotone-request-more { flex: none; color: var(--iso-faint); font-size: 9px; }

.isotone-note-hit { text-align: left; display: block; width: 100%; border-radius: 10px; padding: var(--iso-note-padding-y) var(--iso-note-padding-x); line-height: 18px; }
.isotone-note-hit p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.isotone-meta { display: flex; align-items: center; gap: 4px; min-width: 0; margin-top: 4px; }
/* The agent's question takes a second line under the note, muted, clipped like it. */
.isotone-note-hit:has(> .isotone-reply) { flex-wrap: wrap; row-gap: 1px; }
.isotone-note-hit > p.isotone-reply { order: 3; flex: 1 0 100%; color: var(--iso-muted); font-size: 11px; }
.isotone-reply > span, .isotone-editing-reply > span { color: var(--iso-fg); font-weight: 500; }
.isotone-editing-reply { flex: none; max-height: 58px; overflow-y: auto; padding: 8px var(--iso-input-padding) 0; color: var(--iso-muted); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
.isotone-meta .isotone-chip { flex: 0 1 auto; min-width: 0; height: 18px; padding: 0 7px; font-size: 10px; }
/* A lone reference gets all available space; multiple references share the row. */
.isotone-meta .isotone-chip:not(:only-child) { max-width: 140px; }
/* A count of page errors is short and says nothing cut off. */
.isotone-meta .isotone-chip[data-whole] { flex: none; max-width: none; }
/* The corner action floats outside the text column; its 24px hit target
   surrounds a 16px face without reserving trailing space in every row. */
.isotone-note > .isotone-x { position: absolute; right: -8px; top: -8px; width: 24px; height: 24px; isolation: isolate; opacity: .6; background: none; box-shadow: none; }
.isotone-x::before { content: ''; position: absolute; inset: 4px; border-radius: 50%; z-index: -1; background: var(--iso-popup-face); box-shadow: var(--iso-key-shadow); }
/* One chip per page that has open notes, this page first. */
/* The strip scrolls sideways, which clips vertically too, so it keeps room for the keys' edges and shadow. */
.isotone-pages { display: flex; flex: none; min-width: 0; border-top: 0; border-bottom: 0; border-inline: 0; gap: 4px; overflow-x: auto; overscroll-behavior: contain; margin: -3px calc(0px - var(--iso-panel-inset)) 0; padding: 3px var(--iso-panel-inset); }
/* Scrolled notes are gone before they reach the chips: a clear band, then a longer fade.
   The matching margin and padding keep the first note's resting position. */
.isotone-pages + .isotone-list { margin-top: -18px; padding-top: 18px; scroll-padding-top: 18px; mask-image: linear-gradient(to bottom, transparent 6px, #000 18px, #000 calc(100% - var(--iso-space)), transparent); }
.isotone-page { flex: 0 1 auto; display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 160px; height: 22px; padding: 0 7px; border-radius: var(--iso-control-radius); border: 0; background: transparent; box-shadow: inset 0 0 0 1px var(--iso-line); color: color-mix(in oklch, var(--iso-fg) 40%, var(--iso-muted)); font-size: 10.5px; }
.isotone-page > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-page small { color: var(--iso-muted); font-size: 9px; font-variant-numeric: tabular-nums; }
.isotone-page[aria-pressed='true'] { color: var(--iso-fg); background: var(--iso-key-face); box-shadow: var(--iso-key-shadow); }
/* An agent has said it is working on a note: a soft pulse on the note, and a ring on the launcher.
   Both are driven by one shared clock (see syncPulse), so they beat together. */
/* A long list lays out only the rows in view. The placeholder is one line of text; a row keeps its height once seen. */
.isotone-note-hit { position: relative; content-visibility: auto; contain-intrinsic-size: auto 18px; }
.isotone-working { position: absolute; left: 3px; top: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--iso-focus); }
.isotone-ring { position: absolute; inset: 0; border-radius: 999px; pointer-events: none; }
.isotone-list:empty { display: none; }
/* A single line per note, with compact references sharing its trailing space. */
.isotone-notes-panel {
  --iso-list-height: min(220px, 32dvh);
  --iso-note-padding-y: 6px;
  --iso-note-padding-x: calc(var(--iso-space) - 1px);
  --iso-note-outset: 1px;
}
.isotone-note-hit { display: flex; align-items: center; gap: 8px; }
.isotone-note-hit > p { flex: 1; min-width: 0; }
/* The note keeps most of the row; references take at most a third and shrink first. */
.isotone-note-hit > .isotone-meta { flex: 0 1 auto; max-width: 34%; margin-top: 0; }
.isotone-note-hit > .isotone-meta:has([data-whole]) { max-width: 46%; }
.isotone-compose { flex: none; display: flex; flex-direction: column; }
.isotone-input { --iso-input-padding: var(--iso-space); flex: none; min-width: 0; min-height: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; padding: var(--iso-input-padding); background: var(--iso-well); border: 1px solid var(--iso-input-border); box-shadow: var(--iso-input-shadow); border-radius: var(--iso-inner-radius); cursor: text; }
.isotone-context:empty { display: none; }
/* Content starts and ends at the shared inset, but scrolls through the full
   field width without a fade or a permanent blank strip at either edge. */
.isotone-context { display: flex; flex: none; align-items: center; gap: 4px; flex-wrap: nowrap; height: 32px; overflow-x: auto; overflow-y: hidden; overscroll-behavior: contain; padding: 4px var(--iso-input-padding); margin: 0 calc(0px - var(--iso-input-padding)); scroll-padding-inline: var(--iso-input-padding); }
.isotone-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 24px; max-width: 100%; padding: 0 6px 0 9px; border: 0; border-radius: var(--iso-control-radius); font-size: 10.5px; color: color-mix(in oklch, var(--iso-fg) 55%, var(--iso-muted)); background: var(--iso-label-face); box-shadow: var(--iso-label-shadow); }
.isotone-context > .isotone-chip:not(:only-child) { max-width: calc(100% - 32px); }
.isotone-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-chip button { display: grid; place-items: center; flex: none; width: 16px; height: 16px; border-radius: 50%; background: transparent; box-shadow: none; }
.isotone-root .isotone-textarea { --iso-textarea-inset: 8px; display: block; width: 100%; flex: none; height: 22px; min-height: calc(22px + var(--iso-textarea-inset)); max-height: calc(120px + var(--iso-textarea-inset)); overflow-y: auto; resize: none; margin-top: calc(0px - var(--iso-textarea-inset)); padding: calc(var(--iso-textarea-inset) + 1px) 1px 1px; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--iso-fg) 14%, transparent) transparent; color: var(--iso-fg); background: transparent; border: 0; border-radius: 0; font-size: 12.5px; line-height: 20px; box-shadow: none; cursor: text; }
/* Text scrolls through the gap below tags, or the field inset without tags. */
.isotone-root .isotone-context:empty + .isotone-entry .isotone-textarea { --iso-textarea-inset: var(--iso-input-padding); }
.isotone-textarea::placeholder { color: var(--iso-faint); }
.isotone-root .isotone-textarea:focus-visible { outline: none; }
.isotone-textarea[data-scrolled='true'] { mask-image: linear-gradient(to bottom, transparent, #000 8px); }
.isotone-toolbar { display: flex; flex: none; align-items: center; gap: 7px; height: 32px; }
.isotone-pick[aria-pressed='true'] { color: var(--iso-fg); }
.isotone-pick, .isotone-send { position: relative; }
.isotone-pick { width: 30px; height: 30px; border-radius: 999px; }
/* The microphone sits against the select toggle; listening is the same raised key. */
.isotone-mic { margin-left: -3px; }
.isotone-send { width: 44px; height: 30px; }
.isotone-send svg { width: 16px; height: 16px; }
/* Keep a 28px hit area around the quieter composer faces. */
.isotone-pick::after, .isotone-send::after { content: ''; position: absolute; inset: -2px; border-radius: inherit; }
.isotone-send { display: grid; place-items: center; margin-left: auto; flex: none; }
.isotone-notice { font-size: 10px; color: var(--iso-muted); }
/* The style editor: rows of small wells above the composer, each a label that scrubs and a value. */
/* Its own scroll area: with a colour picker open it can outgrow a short window, and the composer must stay in reach. */
.isotone-adjust { display: flex; flex-direction: column; gap: 8px; flex: 0 1 auto; min-height: 0; max-height: min(52vh, 420px); overflow-y: auto; scrollbar-width: none; margin: 0 1px; padding: 2px 1px var(--iso-space); }
.isotone-adjust-head { display: flex; align-items: center; gap: 6px; min-height: 24px; }
.isotone-adjust-head > strong { font: inherit; font-weight: 450; }
.isotone-adjust-head > small { color: var(--iso-faint); font-size: 10px; }
.isotone-adjust-reset { margin-left: auto; height: 22px; padding: 0 8px; border-radius: 999px; color: var(--iso-muted); font-size: 11px; }
.isotone-adjust-close { margin-left: auto; width: 22px; height: 22px; border-radius: 50%; }
.isotone-adjust-reset + .isotone-adjust-close { margin-left: 0; }
.isotone-adjust-group { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; grid-template-columns: 46px minmax(0, 1fr); column-gap: 6px; row-gap: 8px; align-items: start; }
.isotone-adjust-group > span { color: var(--iso-muted); font-size: 11px; line-height: 26px; }
.isotone-adjust-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; min-width: 0; }
.isotone-num { position: relative; display: flex; align-items: center; min-width: 0; height: 26px; border-radius: 999px; background: var(--iso-well); border: 1px solid var(--iso-input-border); box-shadow: var(--iso-input-shadow); color: var(--iso-muted); font-size: 11px; }
.isotone-num:focus-within { outline: 2px solid var(--iso-focus); outline-offset: 1px; }
.isotone-num[data-changed] { color: var(--iso-fg); }
.isotone-num[data-invalid] input { color: var(--iso-danger); }
.isotone-num-label { flex: none; padding: 0 2px 0 9px; line-height: 24px; color: var(--iso-muted); white-space: nowrap; cursor: ew-resize; user-select: none; touch-action: none; }
.isotone-num-label[data-still] { cursor: default; }
.isotone-num input { flex: 1; min-width: 0; width: 0; height: 24px; padding: 0 9px 0 4px; border: 0; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; text-align: right; outline: none; }
.isotone-num input::placeholder { color: var(--iso-faint); }
.isotone-num[data-changed] input, .isotone-num[data-changed] .isotone-num-value { padding-right: 24px; }
.isotone-num-reset { position: absolute; right: 3px; top: 3px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: var(--iso-muted); }
.isotone-num-swatch { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; height: 24px; border-radius: inherit; text-align: left; font: inherit; color: inherit; }
.isotone-num-swatch:focus-visible { outline: none; }
.isotone-num-swatch > i { flex: none; width: 12px; height: 12px; margin-left: auto; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--iso-line); }
.isotone-num-swatch > i[data-empty] { background: linear-gradient(135deg, transparent 45%, var(--iso-faint) 45% 55%, transparent 55%) !important; }
.isotone-num-swatch .isotone-num-label { cursor: inherit; }
.isotone-num-value { flex: none; padding-right: 9px; font-variant-numeric: tabular-nums; letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 64px; }
.isotone-adjust .isotone-colour { box-shadow: var(--iso-popup-shadow); }
.isotone-entry { position: relative; display: flex; flex-direction: column; gap: 8px; }
/* Select mode covers the field and says how to finish, next to the elements the user is picking. */
.isotone-picking { position: absolute; inset: -4px; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 0 4px 0 8px; border-radius: 10px; background: var(--iso-well); cursor: default; }
.isotone-picking > svg { flex: none; color: var(--iso-fg); }
.isotone-picking p { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; margin: 0; }
/* Hints are never truncated (design.md, "Hints and instructions"): one line, copy short enough to fit. */
.isotone-picking span { font-size: 12px; line-height: 16px; color: var(--iso-fg); font-variant-numeric: tabular-nums; white-space: nowrap; }
.isotone-picking small { font-size: 10px; line-height: 14px; color: var(--iso-muted); white-space: nowrap; }
.isotone-picking button { flex: none; display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; }
.isotone-picking kbd { font: inherit; color: var(--iso-muted); }
/* After a pin, the composer floats beside the element on a panel surface, placed by
   IsotonePanel inside the viewport. It grows out of the point that was clicked. */
.isotone-float { position: fixed; z-index: 2147483002; width: min(300px, calc(100vw - 16px)); padding: 6px; background: var(--iso-bg); border: 0; border-radius: var(--iso-panel-radius); box-shadow: var(--iso-panel-shadow); }
/* The style editor's button takes a face's width from the hint, so the composer grows by as much; a screen too narrow for that keeps the hint. */
.isotone-float:has(.isotone-adjust-toggle) { width: min(336px, calc(100vw - 16px)); }
@media (max-width: 351px) { .isotone-float .isotone-adjust-toggle { display: none; } }
.isotone-float-hint { flex: 1 0 auto; white-space: nowrap; font-size: 10px; color: var(--iso-muted); }
/* Meanwhile the dock keeps the composer's slot and says where the writing went. */
.isotone-away { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 50px; padding: 8px 8px 8px 10px; text-align: left; color: var(--iso-fg); background: var(--iso-well); border: 1px solid var(--iso-input-border); box-shadow: var(--iso-input-shadow); border-radius: var(--iso-inner-radius); }
.isotone-away > svg { flex: none; }
.isotone-root .isotone-float.isotone-exit { pointer-events: none; }
.isotone-away-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.isotone-away-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-away-text > span { font-size: 12px; line-height: 16px; }
.isotone-away-text > small { font-size: 10px; line-height: 14px; color: var(--iso-muted); }
.isotone-away-action { flex: none; display: flex; align-items: center; height: 28px; padding: 0 12px; font-size: 11px; }
/* Under the dock, inside its stacking context: an outline never draws across a panel that covers its element. */
.isotone-hover { position: fixed; pointer-events: none; border: 1px solid var(--iso-pick-line); background: var(--iso-pick-fill); border-radius: 5px; z-index: -1; }
.isotone-selected { border: 2px solid var(--iso-pick-line); background: var(--iso-pick-selected-fill); }
@media (hover: hover) and (pointer: fine) {
  .isotone-root :where(.isotone-icon:not(.isotone-x), .isotone-menu-action, .isotone-axis-label, .isotone-section-toggle, .isotone-adjust-reset, .isotone-num-reset):not(:disabled):not([aria-pressed='true']):hover { background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); color: var(--iso-fg); }
  .isotone-note:not(.isotone-note-editing):hover .isotone-note-hit:not(:disabled):not([data-static]) { background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); }
  .isotone-rail-button:not(:disabled):hover { color: var(--iso-fg); }
  .isotone-seg:not(:disabled):hover { color: var(--iso-fg); }
  .isotone-seg[aria-checked='false']:not(:disabled):hover { background: var(--iso-segment-hover); box-shadow: var(--iso-label-shadow); }
  .isotone-thumb[aria-checked='false']:not(:disabled):hover { box-shadow: var(--iso-thumb-hover-shadow); }
  .isotone-root .isotone-send:not(:disabled):hover { background: var(--iso-accent-hover); }
  .isotone-page[aria-pressed='false']:hover { color: var(--iso-fg); box-shadow: inset 0 0 0 1px var(--iso-edge); }
  .isotone-root :where(.isotone-save, .isotone-secondary, .isotone-picking button):not(:disabled):hover, .isotone-away:hover .isotone-away-action { background: var(--iso-control-hover-face); box-shadow: var(--iso-control-hover-shadow); }
  .isotone-chip button:hover { color: var(--iso-fg); background: var(--iso-hover); }
  .isotone-x:hover { color: var(--iso-fg); }
  .isotone-x:hover::before { background: var(--iso-control-hover-face); }
  .isotone-note .isotone-x { opacity: 0; }
  .isotone-opt > .isotone-opt-more:hover { color: var(--iso-fg); }
  .isotone-axis-label:hover svg { color: var(--iso-muted); }
  .isotone-opt > .isotone-opt-more { opacity: 0; pointer-events: none; }
  .isotone-opt:hover > .isotone-opt-more, .isotone-opt:has(:focus-visible) > .isotone-opt-more, .isotone-opt > .isotone-opt-more[aria-expanded='true'] { opacity: 1; pointer-events: auto; }
  /* The chevron takes the default dot's corner while it shows, except in a capsule, where the dot leads.
     Keyboard focus shows it; focus a closed dialog returns to it after a click does not. */
  .isotone-opt:not(.isotone-opt-seg):is(:hover, :has(:focus-visible)) .isotone-default-dot { opacity: 0; }
  .isotone-note:hover .isotone-x, .isotone-note:focus-within .isotone-x, .isotone-note-editing .isotone-x { opacity: 1; }
}
/* Without a hovering fine pointer the chevron always shows, so it always has the dot's corner. */
@media not all and (hover: hover) and (pointer: fine) { .isotone-opt:not(.isotone-opt-seg) .isotone-default-dot { opacity: 0; } }
@media (max-width: 640px), (max-height: 500px) { .isotone-resize { display: none; } }
/* The dock's size is the reviewer's choice on a window with room for it. */
@media (min-width: 641px) and (min-height: 501px) {
  .isotone-root[data-open='true'] { width: var(--iso-width, var(--iso-dock-width)); }
  .isotone-variants-panel { max-height: min(var(--iso-variants-height, 100vh), calc(var(--iso-view-height) - 76px)); }
  .isotone-notes-panel { max-height: min(var(--iso-notes-height, 100vh), calc(var(--iso-view-height) - 76px)); }
  .isotone-root[data-sized-notes='true'] .isotone-list { max-height: none; }
}
/* Phones. Panels take turns (see viewport.ts). Variants stop at about half the
   screen, so the page they change stays in view; action dialogs keep their
   360px. While selecting, the dock shrinks to the composer so the page can be
   reached, and the saved notes return afterwards. */
@media (max-width: 640px) {
  .isotone-variants-panel { max-height: min(calc(var(--iso-view-height) - 76px), max(50dvh, 360px)); }
}
@media (max-width: 640px), (max-height: 500px) {
  .isotone-root[data-selecting='true'] .isotone-notes-panel > :is(.isotone-list, .isotone-pages) { display: none; }
}
/* A finger needs more than the drawn faces. Hit areas grow without moving
   anything; the faces keep Instrument's geometry. */
@media (pointer: coarse) {
  .isotone-pick::after, .isotone-send::after { inset: -8px -10px; }
  .isotone-chip button { position: relative; }
  .isotone-chip button::after, .isotone-note > .isotone-x::after, .isotone-panel-close::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
}
@media (max-height: 580px) { .isotone-list { --iso-list-height: 72px; } .isotone-root .isotone-textarea { max-height: calc(64px + var(--iso-textarea-inset)); } }
@media (prefers-reduced-motion: reduce) {
  .isotone-ring { box-shadow: 0 0 0 2px color-mix(in srgb, var(--iso-focus) 50%, transparent); }
  .isotone-root .isotone-rail-track { transition: none; }
  .isotone-root .isotone-panel, .isotone-root .isotone-axis-menu, .isotone-root .isotone-rail-tools { transition-property: opacity, visibility; }
  .isotone-colour, .isotone-root .isotone-vars > .isotone-panel-head { transition-property: opacity; }
  .isotone-root button { transition: opacity 125ms ease; }
  .isotone-root button:not(:disabled):active > svg { transform: none; }
}
/* Windows high contrast swaps the palette for system colours and drops every shadow, which drew the edges,
   the selection and the slider. Selection becomes Highlight; colour choices keep their own colour. */
@media (forced-colors: active) {
  .isotone-seg, .isotone-thumb { outline: 1px solid ButtonBorder; outline-offset: -1px; }
  .isotone-seg[aria-checked='true'], .isotone-thumb[aria-checked='true'], .isotone-note-editing .isotone-note-hit, .isotone-pick[aria-pressed='true'], .isotone-page[aria-pressed='true'] { forced-color-adjust: none; background: Highlight; color: HighlightText; }
  .isotone-rail-button[aria-expanded='true']::before { background: Highlight; }
  /* Its gradient is dropped here, and it floats over selectors: give it a solid face. */
  .isotone-root .isotone-vars > .isotone-panel-head { background: Canvas; }
  .isotone-rail-button[aria-expanded='true'] { color: HighlightText; }
  .isotone-swatch, .isotone-picker, .isotone-colour-field, .isotone-colour-handle, .isotone-hue { forced-color-adjust: none; }
  .isotone-swatch, .isotone-picker { box-shadow: 0 0 0 1px CanvasText; }
  .isotone-swatch[aria-checked='true'], .isotone-picker[aria-expanded='true'], .isotone-picker[data-custom='true'] { box-shadow: 0 0 0 2px Canvas, 0 0 0 4px Highlight; }
  .isotone-range::-webkit-slider-runnable-track { background: GrayText; }
  .isotone-range::-moz-range-track { background: GrayText; }
  .isotone-range::-webkit-slider-thumb { background: ButtonText; }
  .isotone-range::-moz-range-thumb { background: ButtonText; }
  .isotone-range-tick { background: GrayText; }
}
/* Keyboard actions are immediate. The rule names only the surfaces a key opens: one over every descendant
   would restyle the whole dock each time the reviewer moves between mouse and keyboard. */
.isotone-root[data-instant='true'] .isotone-rail-track, .isotone-root[data-instant='true'] .isotone-axis-menu, .isotone-root[data-instant='true'] .isotone-colour { transition-duration: 0s !important; transition-delay: 0s !important; }
/* The update notice beside the rail, and its dialog. */
.isotone-notices { position: absolute; z-index: 5; bottom: 10px; right: calc(var(--iso-rail-length) + 10px); display: flex; flex-direction: row-reverse; flex-wrap: wrap-reverse; align-items: center; justify-content: flex-start; gap: 6px; width: max-content; max-width: calc(100vw - var(--iso-rail-length) - 36px); pointer-events: none; }
.isotone-root[data-tools='1'] .isotone-notices { right: calc(var(--iso-rail-size) + 10px); max-width: calc(100vw - var(--iso-rail-size) - 36px); }
.isotone-notices > * { pointer-events: auto; }
.isotone-update-trigger { white-space: nowrap; color: var(--iso-muted); font-size: 10px; padding: 4px 10px; border-radius: 999px; background: var(--iso-rail-base); box-shadow: var(--iso-rail-base-shadow); }
.isotone-update-dialog { position: absolute; right: calc(0px - var(--iso-rail-length) - 10px); bottom: 40px; width: min(var(--iso-dock-width), 260px); max-width: calc(100vw - 32px); max-height: calc(100dvh - 100px); overflow: auto; padding: 10px var(--iso-space) var(--iso-space); display: grid; gap: 8px; border-radius: 14px; background: var(--iso-popup-face); box-shadow: var(--iso-popup-shadow); font-size: 11px; }
.isotone-root[data-tools='1'] .isotone-update-dialog { right: calc(0px - var(--iso-rail-size) - 10px); }
.isotone-update-dialog .isotone-menu-title { padding: 0; background: none; }
.isotone-update-versions { font-variant-numeric: tabular-nums; }
.isotone-update-dialog > p { color: var(--iso-muted); }
.isotone-root .isotone-update-ask { min-height: 28px; padding: 4px 12px; }
.isotone-update-requested { min-height: 28px; display: flex; align-items: center; outline-offset: 2px; }
.isotone-update-actions { display: flex; align-items: center; gap: 2px; margin: -4px 0 -4px -6px; }
.isotone-root .isotone-update-quiet { padding: 4px 6px; border-radius: 5px; color: var(--iso-muted); font-size: 11px; background: none; box-shadow: none; }
.isotone-update-quiet[aria-expanded='true'] { color: var(--iso-fg); }
.isotone-update-actions [role='status'] { min-width: 0; margin-left: auto; color: var(--iso-muted); font-size: 10px; text-align: right; }
.isotone-update-command { display: grid; gap: 4px; min-width: 0; }
.isotone-update-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font-size: 10px; }
.isotone-root .isotone-update-dialog input { width: 100%; padding: 6px 8px; border-radius: 5px; background: var(--iso-well); box-shadow: var(--iso-well-shadow); font-size: 11px; }
@media (pointer: coarse) { .isotone-root .isotone-update-quiet { padding: 9px 6px; } .isotone-update-actions { margin: -9px 0 -9px -6px; } }
@media (hover: hover) and (pointer: fine) { .isotone-update-trigger:hover, .isotone-root .isotone-update-quiet:hover { color: var(--iso-fg); } }
`;
/**
 * Put the panel's styles in `target`, once. Idempotent: a second call with the
 * same root is a no-op, so several panels (or a remount) do not stack copies.
 *
 * `target` is whatever `getRootNode()` returns for the panel — a `ShadowRoot`
 * when mounted by `mountIsotone`, the `Document` when a host embeds the
 * component directly.
 */
export function ensurePanelStyles(target: Document | ShadowRoot): void {
  const parent = target instanceof Document ? target.head : target;
  if (!parent || parent.querySelector(`[${MARKER}]`)) return;
  const style = (target instanceof Document ? target : target.ownerDocument).createElement('style');
  style.setAttribute(MARKER, '');
  style.textContent = PANEL_CSS;
  // Prepend inside a shadow root so host-passed styles could still win, and
  // append in the document so the panel is not undercut by later app CSS.
  if (target instanceof Document) parent.appendChild(style);
  else parent.insertBefore(style, parent.firstChild);
}
