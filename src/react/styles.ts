import { APPEARANCE_CSS } from './appearance';
import { MOTION } from './motion';
import { FEEDBACK_LAYOUT_CSS } from './feedback-layout';
import { PILL_ACTIVE_CSS } from './pill-active';
import { UPDATE_NOTICE_CSS } from './UpdateNotice';

/** One shared set of tokens and controls for the shadow-root and inline mounts. */
const MARKER = 'data-isotone-styles';
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
  --iso-space: 12px; --iso-view-gap: 8px; --iso-control-radius: 6px;
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
  position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 2147483000; width: 44px; display: flex; flex-direction: column; isolation: isolate; max-height: calc(100dvh - 32px); color: var(--iso-fg);
  font: 12px/1.5 var(--iso-sans); -webkit-font-smoothing: antialiased;
  text-align: left; letter-spacing: normal; color-scheme: dark;
}
.isotone-root :where(button, input, textarea):focus-visible { outline: 2px solid var(--iso-focus); outline-offset: 3px; }
.isotone-root button { transition: transform var(--iso-fast) var(--iso-ease-out), opacity var(--iso-fast) var(--iso-ease-out); }
.isotone-root button:not(:disabled):active > svg { transform: scale(.92); transition-duration: 100ms; }
.isotone-root svg { display: block; flex-shrink: 0; pointer-events: none; transition: transform var(--iso-fast) var(--iso-ease-out); }
/* Panels move independently; their content and corners retain their natural size. */
.isotone-root[data-open='true'] { width: var(--iso-dock-width); }
.isotone-root { pointer-events: none; }
.isotone-root :is(.isotone-panel, .isotone-rail-button, .isotone-fab, .isotone-hint) { pointer-events: auto; }
/* The horizontal pill stays anchored while its panels open above it. */
.isotone-rail, .isotone-rail-tools { display: contents; border: 0; margin: 0; padding: 0; min-width: 0; }
.isotone-root[data-expanded='true'] { min-height: 44px; }
.isotone-root[data-expanded='true'][data-open='false'][data-tools='2'] { width: var(--iso-rail-length); }
.isotone-root[data-open='true'] { padding-bottom: calc(var(--iso-rail-size) + var(--iso-view-gap)); gap: var(--iso-view-gap); }
.isotone-rail-track { position: absolute; right: 0; bottom: 0; width: var(--iso-rail-size); height: var(--iso-rail-size); border-radius: 999px; background: var(--iso-rail-base); border: 0; box-shadow: var(--iso-rail-base-shadow); pointer-events: auto; transition: width var(--iso-enter) var(--iso-ease-out), height var(--iso-enter) var(--iso-ease-out); }
.isotone-rail-track::before { content: ''; position: absolute; inset: var(--iso-rail-padding); border-radius: inherit; background: var(--iso-rail-face); box-shadow: var(--iso-rail-face-shadow); }
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
.isotone-badge { position: absolute; right: -3px; top: -3px; pointer-events: none; display: grid; place-items: center; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--iso-label-face); box-shadow: var(--iso-label-shadow); color: var(--iso-launcher-ink); font-size: 9px; font-weight: 500; font-variant-numeric: tabular-nums; }
/* Panels are sections inside the dock. Only long content scrolls. */
.isotone-panel { order: 0; position: relative; display: none; flex-direction: column; min-height: 0; flex: 0 1 auto; width: 100%; }
.isotone-panel[data-open='true'] { display: flex; }
.isotone-variants-panel { flex-shrink: 1; max-height: calc(100dvh - 76px); }
.isotone-notes-panel { flex-shrink: 0; max-height: calc(100dvh - 76px); padding: var(--iso-space); gap: var(--iso-space); }
.isotone-root .isotone-panel { background: var(--iso-bg); border: 1px solid var(--iso-line); border-radius: 12px; box-shadow: var(--iso-panel-shadow); overflow: hidden; }
.isotone-panel-head { flex: 0 0 42px; min-height: 42px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px 0 14px; gap: 8px; border-bottom: 1px solid var(--iso-line); }
.isotone-root .isotone-notes-panel > .isotone-panel-head { display: none; }
.isotone-root .isotone-vars > .isotone-panel-head { order: 2; flex: 0 0 auto; min-height: 48px; padding: var(--iso-space); border: 0; }
.isotone-root .isotone-vars > .isotone-panel-head:has(.isotone-save) { position: relative; z-index: 1; margin-top: calc(0px - var(--iso-space)); background: linear-gradient(to bottom, transparent, var(--iso-bg) var(--iso-space)); }
.isotone-root .isotone-vars > .isotone-panel-head:not(:has(.isotone-save)) { display: none; }
.isotone-root .isotone-vars > .isotone-panel-head :is(h2, .isotone-icon) { display: none; }
.isotone-root .isotone-axis-menu { top: var(--iso-menu-top, 6px); max-height: calc(100% - var(--iso-menu-top, 6px) - 6px); }
.isotone-panel-head h2 { font-size: 12px; font-weight: 600; letter-spacing: -.01em; }
.isotone-head-actions { display: flex; align-items: center; gap: 6px; margin-right: auto; }
.isotone-icon { width: 28px; height: 28px; display: inline-grid; place-items: center; flex: none; color: var(--iso-muted); border-radius: 6px; }
.isotone-count { margin-left: 5px; color: var(--iso-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.isotone-vars { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }
.isotone-vars { min-height: min(var(--iso-menu-need, 0px), calc(100dvh - 76px)); }
.isotone-vars-body { flex: 1; overflow-y: auto; min-height: 0; overscroll-behavior: contain; padding: var(--iso-space); display: flex; flex-direction: column; gap: var(--iso-space); }
/* The footer overlaps only the scroller's bottom padding: content fades beneath
   it while scrolling, but the last control remains fully visible at the end. */
.isotone-axis { flex: none; }
.isotone-axis-head { display: flex; align-items: center; justify-content: space-between; min-height: 24px; gap: 8px; margin-bottom: 6px; }
.isotone-axis-label { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; min-height: 24px; padding: 2px 7px; margin-left: -7px; border-radius: 6px; text-align: left; }
.isotone-axis-label, .isotone-menu-title > strong { font: inherit; font-weight: 550; }
.isotone-axis-label > span, .isotone-menu-title > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-axis-label svg { color: var(--iso-muted); }
.isotone-axis-value { min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font: 10px var(--iso-sans); font-variant-numeric: tabular-nums; }
.isotone-segs { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 7px; background: var(--iso-well); box-shadow: var(--iso-segment-track-shadow); }
.isotone-seg { flex: 1 1 64px; min-width: 0; padding: 5px 8px; line-height: 16px; border-radius: 5px; color: var(--iso-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-seg > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-seg[aria-pressed='true'] { color: var(--iso-fg); }
.isotone-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.isotone-thumb { position: relative; display: block; min-width: 0; border-radius: 5px; overflow: hidden; background: var(--iso-well); box-shadow: var(--iso-thumb-shadow); color: var(--iso-muted); }
.isotone-thumb img { display: block; width: 100%; height: 72px; object-fit: cover; }
.isotone-thumb > span { position: absolute; bottom: 5px; left: 5px; max-width: calc(100% - 10px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 5px; background: var(--iso-label-face); box-shadow: var(--iso-label-shadow); color: var(--iso-fg); text-align: left; font-size: 10px; font-weight: 500; }
.isotone-thumb[aria-pressed='true'] { color: var(--iso-fg); }
/* The 14px thumb has 5px of space above it inside its 24px hit area. */
.isotone-axis-head:has(+ .isotone-range) { margin-bottom: 1px; }
.isotone-range { display: block; appearance: none; -webkit-appearance: none; width: 100%; height: 24px; cursor: pointer; }
.isotone-range::-webkit-slider-runnable-track { height: 3px; border-radius: 6px; background: var(--iso-edge); }
.isotone-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5.5px; border-radius: var(--iso-range-radius); background: var(--iso-range-thumb-face); box-shadow: var(--iso-range-thumb-shadow); }
.isotone-range::-moz-range-track { height: 3px; border-radius: 6px; background: var(--iso-edge); }
.isotone-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; box-shadow: var(--iso-range-thumb-shadow); border-radius: var(--iso-range-radius); background: var(--iso-range-thumb-face); }
.isotone-swatches { display: flex; flex-wrap: wrap; gap: 10px; padding: 3px; }
.isotone-swatch, .isotone-picker { width: 26px; height: 26px; border-radius: var(--iso-swatch-radius); box-shadow: var(--iso-swatch-shadow); flex: none; }
.isotone-swatch[aria-pressed='true'] { box-shadow: var(--iso-swatch-selected-shadow); }
.isotone-picker { display: block; position: relative; overflow: hidden; background: conic-gradient(#ef4444,#eab308,#22c55e,#3b82f6,#a855f7,#ef4444); }
.isotone-picker input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.isotone-picker:has(input:focus-visible) { outline: 2px solid var(--iso-focus); outline-offset: 3px; }
/* Raised actions share one face, edge and hover treatment. */
.isotone-save, .isotone-secondary, .isotone-send, .isotone-hint button { border-radius: var(--iso-control-radius); color: var(--iso-fg); background: var(--iso-control-face); box-shadow: var(--iso-control-shadow); }
/* Persistent selections share the raised action material, never the recessed
   field/slot material. Keep the face and shadow together in this one rule. */
.isotone-note-editing .isotone-note-hit,
.isotone-seg[aria-pressed='true'],
.isotone-thumb[aria-pressed='true'],
.isotone-pick[aria-pressed='true'] { background: var(--iso-selected-face); box-shadow: var(--iso-selected-shadow); }
${PILL_ACTIVE_CSS}
.isotone-secondary { padding: 6px 9px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.isotone-save { min-height: 24px; padding: 2px 7px; font-size: 11px; white-space: nowrap; overflow: hidden; }
.isotone-save-row { position: relative; }
.isotone-save-state { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.isotone-save-label { display: block; }
/* A local action sheet overlays controls, preserving every underlying position. */
.isotone-axis-menu { position: absolute; inset: 48px 6px auto; z-index: 2; background: var(--iso-popup-face); border-radius: 6px; max-height: calc(100% - 54px); box-shadow: var(--iso-popup-shadow); display: flex; flex-direction: column; transform-origin: top left; opacity: 0; transform: translateY(-4px) scale(.97); visibility: hidden; transition: opacity var(--iso-exit) var(--iso-ease-out), transform var(--iso-exit) var(--iso-ease-out), visibility 0s var(--iso-exit); }
.isotone-axis-menu[data-open='true'] { visibility: visible; opacity: 1; transform: none; transition-delay: 0s; }
@starting-style { .isotone-axis-menu[data-open='true'] { opacity: 0; transform: translateY(-4px) scale(.97); } }
.isotone-menu-title { position: relative; z-index: 1; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 8px 6px 12px; }
/* Fade the moving content into the popup's actual material. A mask preserves
   Instrument's surface gradient and works identically in light and dark mode.
   Matching negative margin/padding preserves the first action's resting position. */
.isotone-menu-scroll { --iso-scroll-fade-bottom: 0px; scroll-padding-block: var(--iso-space) calc(var(--iso-scroll-fade-bottom) + 6px); overflow-y: auto; overscroll-behavior: contain; flex: 1; min-height: 0; margin-top: calc(0px - var(--iso-space)); padding: var(--iso-space) 6px 6px; mask-image: linear-gradient(to bottom, transparent, #000 var(--iso-space), #000 calc(100% - var(--iso-scroll-fade-bottom)), transparent); }
.isotone-axis-menu:has(.isotone-menu-footer) .isotone-menu-scroll { --iso-scroll-fade-bottom: var(--iso-space); padding-bottom: calc(var(--iso-space) + 6px); }
.isotone-menu-action { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; border-radius: 6px; text-align: left; padding: 7px; font-size: 11px; }
.isotone-menu-options { padding: 7px 0; margin: 5px 0; border-top: 1px solid var(--iso-line); border-bottom: 1px solid var(--iso-line); }
.isotone-option-row { display: flex; align-items: center; padding: 2px 4px 2px 7px; gap: 4px; }
.isotone-option-row > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-option-row small { font-size: 9px; color: var(--iso-muted); margin-left: 6px; }
.isotone-menu-footer { flex-shrink: 0; padding: 9px 12px; border-top: 1px solid var(--iso-line); font-size: 10px; color: var(--iso-muted); min-height: 0; }
.isotone-confirm { display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; }
.isotone-danger { color: var(--iso-danger); }
/* Scroll through the panel's top inset and fade against its actual surface.
   Cancelling margin/padding keeps the first row in place at scroll start; the
   expanded height preserves the content allowance and composer position.
   The side gutters contain the corner action and keyboard focus outlines. */
.isotone-list { display: flex; flex-direction: column; gap: 0; flex: 0 1 auto; max-height: calc(var(--iso-list-height) + 2 * var(--iso-space) - 8px); min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: calc(0px - var(--iso-space)) calc(-8px - var(--iso-note-outset)) calc(-2px - var(--iso-space)); padding: var(--iso-space) 8px; scroll-padding-block: var(--iso-space); mask-image: linear-gradient(to bottom, transparent, #000 var(--iso-space), #000 calc(100% - var(--iso-space)), transparent); }
.isotone-empty { color: var(--iso-muted); font-size: 11px; line-height: 1.7; padding: 8px; }
.isotone-note { position: relative; flex: none; }
.isotone-request-more { flex: none; color: var(--iso-faint); font-size: 9px; }

.isotone-note-hit { text-align: left; display: block; width: 100%; border-radius: 8px; padding: var(--iso-note-padding-y) var(--iso-note-padding-x); line-height: 18px; }
.isotone-note-hit p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.isotone-meta { display: flex; align-items: center; gap: 4px; min-width: 0; margin-top: 4px; }
.isotone-meta .isotone-chip { flex: 0 1 auto; min-width: 0; height: 18px; padding: 0 5px; font-size: 9px; }
/* A lone reference gets all available space; multiple references share the row. */
.isotone-meta .isotone-chip:not(:only-child) { max-width: 140px; }
/* The corner action floats outside the text column; its 24px hit target
   surrounds a 16px face without reserving trailing space in every row. */
.isotone-note > .isotone-x { position: absolute; right: -8px; top: -8px; width: 24px; height: 24px; isolation: isolate; opacity: .6; background: none; box-shadow: none; }
.isotone-x::before { content: ''; position: absolute; inset: 4px; border-radius: 50%; z-index: -1; background: var(--iso-bg); box-shadow: 0 0 0 1px var(--iso-edge); }
.isotone-list:empty { display: none; }
${FEEDBACK_LAYOUT_CSS}
.isotone-compose { flex: none; display: flex; flex-direction: column; }
.isotone-input { --iso-input-padding: calc(var(--iso-space) - 2px); flex: none; min-width: 0; min-height: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; padding: var(--iso-input-padding); background: var(--iso-well); border: 1px solid var(--iso-input-border); box-shadow: var(--iso-input-shadow); border-radius: 8px; cursor: text; }
.isotone-context:empty { display: none; }
/* Content starts and ends at the shared inset, but scrolls through the full
   field width without a fade or a permanent blank strip at either edge. */
.isotone-context { display: flex; flex: none; align-items: center; gap: 4px; flex-wrap: nowrap; height: 32px; overflow-x: auto; overflow-y: hidden; overscroll-behavior: contain; padding: 4px var(--iso-input-padding); margin: 0 calc(0px - var(--iso-input-padding)); scroll-padding-inline: var(--iso-input-padding); }
.isotone-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 24px; max-width: 100%; padding: 0 5px 0 7px; border: 1px solid var(--iso-edge); border-radius: var(--iso-control-radius); font-size: 10px; color: var(--iso-muted); background: var(--iso-label-face); box-shadow: var(--iso-label-lift-shadow); }
.isotone-context > .isotone-chip:not(:only-child) { max-width: calc(100% - 32px); }
.isotone-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-chip button { display: grid; place-items: center; flex: none; width: 16px; height: 16px; border-radius: 3px; background: transparent; box-shadow: none; }
.isotone-root .isotone-textarea { --iso-textarea-inset: 8px; display: block; width: 100%; flex: none; height: 22px; min-height: calc(22px + var(--iso-textarea-inset)); max-height: calc(120px + var(--iso-textarea-inset)); overflow-y: auto; resize: none; margin-top: calc(0px - var(--iso-textarea-inset)); padding: calc(var(--iso-textarea-inset) + 1px) 1px 1px; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--iso-fg) 14%, transparent) transparent; color: var(--iso-fg); background: transparent; border: 0; border-radius: 0; font-size: 12px; line-height: 20px; box-shadow: none; cursor: text; }
/* Text scrolls through the gap below tags, or the field inset without tags. */
.isotone-root .isotone-context:empty + .isotone-textarea { --iso-textarea-inset: var(--iso-input-padding); }
.isotone-textarea::placeholder { color: var(--iso-faint); }
.isotone-root .isotone-textarea:focus-visible { outline: none; }
.isotone-textarea[data-scrolled='true'] { mask-image: linear-gradient(to bottom, transparent, #000 8px); }
.isotone-toolbar { display: flex; flex: none; align-items: center; gap: 7px; height: 28px; }
.isotone-pick[aria-pressed='true'] { color: var(--iso-fg); }
.isotone-pick, .isotone-send { position: relative; width: 24px; height: 24px; }
/* Keep a 28px hit area around the quieter composer faces. */
.isotone-pick::after, .isotone-send::after { content: ''; position: absolute; inset: -2px; border-radius: inherit; }
.isotone-send { display: grid; place-items: center; margin-left: auto; flex: none; }
.isotone-notice { font-size: 10px; color: var(--iso-muted); }
.isotone-hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-radius: 24px; background: var(--iso-bg); box-shadow: var(--iso-shadow); font-size: 11px; white-space: nowrap; }
.isotone-hint button { display: flex; align-items: center; gap: 8px; border-radius: 14px; padding: 5px 9px; }
.isotone-hint kbd { font: inherit; color: var(--iso-muted); }
.isotone-hover { position: fixed; pointer-events: none; border: 1px solid var(--iso-pick-line); background: var(--iso-pick-fill); border-radius: 5px; z-index: 2147483001; }
.isotone-selected { border: 2px solid var(--iso-pick-line); background: var(--iso-pick-selected-fill); }
@media (hover: hover) and (pointer: fine) {
  .isotone-root :where(.isotone-icon:not(.isotone-x), .isotone-menu-action, .isotone-axis-label):not(:disabled):not([aria-pressed='true']):hover { background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); color: var(--iso-fg); }
  .isotone-note:not(.isotone-note-editing):hover .isotone-note-hit:not(:disabled) { background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); }
  .isotone-rail-button:not(:disabled):hover { color: var(--iso-fg); }
  .isotone-seg:not(:disabled):hover { color: var(--iso-fg); }
  .isotone-seg[aria-pressed='false']:not(:disabled):hover { box-shadow: var(--iso-hover-shadow); }
  .isotone-thumb[aria-pressed='false']:not(:disabled):hover { box-shadow: var(--iso-thumb-hover-shadow); }
  .isotone-root :where(.isotone-save, .isotone-secondary, .isotone-send, .isotone-hint button):not(:disabled):hover { background: var(--iso-control-hover-face); box-shadow: var(--iso-control-hover-shadow); }
  .isotone-chip button:hover { color: var(--iso-fg); background: var(--iso-hover); }
  .isotone-x:hover { color: var(--iso-fg); }
  .isotone-x:hover::before { background: var(--iso-control-hover-face); }
  .isotone-note .isotone-x { opacity: 0; }
  .isotone-note:hover .isotone-x, .isotone-note:focus-within .isotone-x, .isotone-note-editing .isotone-x { opacity: 1; }
}
@media (max-height: 580px) { .isotone-list { --iso-list-height: 72px; } .isotone-root .isotone-textarea { max-height: calc(64px + var(--iso-textarea-inset)); } }
@media (prefers-reduced-motion: reduce) {
  .isotone-root .isotone-rail-track { transition: none; }
  .isotone-root .isotone-panel, .isotone-root .isotone-axis-menu, .isotone-root .isotone-rail-tools { transition-property: opacity, visibility; }
  .isotone-root button { transition: opacity 125ms ease; }
  .isotone-root button:not(:disabled):active > svg { transform: none; }
}
.isotone-root[data-instant='true'] *, .isotone-root[data-instant='true'] *::before, .isotone-root[data-instant='true'] *::after { transition-duration: 0s !important; transition-delay: 0s !important; animation: none !important; }
${UPDATE_NOTICE_CSS}
`;
/**
 * Put the panel's styles in `target`, once. Idempotent: a second call with the
 * same root is a no-op, so several panels (or a remount) do not stack copies.
 *
 * `target` is whatever `getRootNode()` returns for the panel — a `ShadowRoot`
 * when mounted by `mountIteration`, the `Document` when a host embeds the
 * component directly.
 */
export function ensurePanelStyles(target: Document | ShadowRoot): void {
  const parent = target instanceof Document ? target.head : target;
  if (!parent || parent.querySelector(`[${MARKER}]`)) return;
  const style = (target instanceof Document ? target : target.ownerDocument)
    .createElement('style');
  style.setAttribute(MARKER, '');
  style.textContent = PANEL_CSS;
  // Prepend inside a shadow root so host-passed styles could still win, and
  // append in the document so the panel is not undercut by later app CSS.
  if (target instanceof Document) parent.appendChild(style);
  else parent.insertBefore(style, parent.firstChild);
}
