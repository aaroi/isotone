/**
 * Layout and states for the experimental style editor. Paint comes from the
 * shared palette tokens only: fields are wells (recessed), the current crumb,
 * pressed segments and the size readout are raised, like every selection.
 */
export const STYLE_INSPECTOR_CSS = `
.isotone-style-panel { flex: 0 1 auto; min-height: min(240px, 34dvh); max-height: calc(100dvh - 76px); }
.isotone-root .isotone-panel > .isotone-style { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; border-radius: 11px; }
.isotone-style-head { flex: none; display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 6px 6px 2px var(--iso-space); }
.isotone-style-head h2 { font-size: 12px; font-weight: 600; letter-spacing: -.01em; }
.isotone-style-head .isotone-count { margin-left: 0; }
.isotone-experimental { flex: none; display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px; border: 1px solid var(--iso-edge); color: var(--iso-muted); font-size: 9px; font-weight: 500; letter-spacing: .02em; }
.isotone-style-actions { display: flex; gap: 0; margin-left: auto; }
.isotone-style-target { position: relative; flex: none; display: flex; flex-direction: column; gap: 6px; padding: 0 var(--iso-space) 10px; border-bottom: 1px solid var(--iso-line); }
.isotone-crumb-bar { display: flex; align-items: center; gap: 2px; min-width: 0; margin: 0 -6px; }
.isotone-crumb-bar > .isotone-icon { width: 24px; height: 24px; }
/* The strip scrolls to its end, the current element; earlier crumbs fade under its start. */
.isotone-crumbs { flex: 1; display: flex; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; overscroll-behavior: contain; padding: 2px 0; mask-image: linear-gradient(to right, transparent, #000 10px); }
.isotone-crumb { flex: none; display: inline-flex; align-items: center; height: 22px; max-width: 150px; padding: 0 6px; border-radius: 5px; color: var(--iso-muted); font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.isotone-crumb + .isotone-crumb::before { content: '›'; margin-right: 6px; color: var(--iso-faint); font-family: var(--iso-sans); }
.isotone-crumb-current { color: var(--iso-fg); background: var(--iso-selected-face); box-shadow: var(--iso-selected-shadow); max-width: 180px; }
.isotone-crumb-current::before { display: none; }
.isotone-child-menu { position: absolute; z-index: 3; top: 30px; left: 8px; right: 8px; max-height: min(240px, 40dvh); overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; padding: 4px; border-radius: 6px; background: var(--iso-popup-face); box-shadow: var(--iso-popup-shadow); }
.isotone-child { display: flex; align-items: baseline; gap: 8px; min-height: 28px; padding: 6px 7px; border-radius: 5px; text-align: left; }
.isotone-child > span { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--iso-fg); }
.isotone-child > small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: var(--iso-muted); }
.isotone-classes { min-width: 0; font: 10px/16px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--iso-muted); }
.isotone-classes > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-scope { display: flex; gap: 4px; min-width: 0; overflow-x: auto; overscroll-behavior: contain; border: 0; margin: 0 calc(0px - var(--iso-space)); padding: 2px var(--iso-space); }
.isotone-scope .isotone-page { flex: none; }
.isotone-style-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px var(--iso-space) var(--iso-space); scroll-padding-block: var(--iso-space); mask-image: linear-gradient(to bottom, transparent, #000 6px, #000 calc(100% - var(--iso-space)), transparent); }
.isotone-style-section + .isotone-style-section { border-top: 1px solid var(--iso-line); }
.isotone-style-section-head { display: flex; align-items: center; gap: 6px; width: calc(100% + 12px); height: 32px; margin: 0 -6px; padding: 0 6px; border-radius: 6px; color: var(--iso-fg); font-weight: 550; text-align: left; }
.isotone-style-section-head > svg { color: var(--iso-muted); }
.isotone-style-section[data-open='true'] > .isotone-style-section-head > svg { transform: rotate(90deg); }
.isotone-style-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--iso-focus); }
.isotone-style-section-body { display: flex; flex-direction: column; gap: 6px; padding: 0 0 10px; }
.isotone-style-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
/* A field is a well. Its label scrubs number values sideways. */
.isotone-field { position: relative; display: flex; align-items: center; height: 26px; min-width: 0; border-radius: var(--iso-control-radius); background: var(--iso-well); box-shadow: var(--iso-well-shadow); }
.isotone-field:has(.isotone-field-input:focus-visible) { box-shadow: var(--iso-well-shadow), 0 0 0 1px var(--iso-focus); }
.isotone-field-label { flex: none; min-width: 24px; padding: 0 4px 0 8px; color: var(--iso-muted); font-size: 10px; line-height: 26px; white-space: nowrap; user-select: none; -webkit-user-select: none; }
.isotone-scrub { cursor: ew-resize; touch-action: none; }
.isotone-root .isotone-field-input { flex: 1; min-width: 0; width: 100%; height: 100%; padding: 0 8px 0 2px; border: 0; border-radius: 0; background: transparent; color: var(--iso-fg); font: 11px/26px var(--iso-sans); font-variant-numeric: tabular-nums; text-overflow: ellipsis; }
.isotone-root .isotone-field-input:focus-visible { outline: none; }
.isotone-field-input::placeholder { color: var(--iso-faint); }
.isotone-field[data-changed] > .isotone-field-label { color: var(--iso-fg); font-weight: 600; }
.isotone-root [data-invalid] .isotone-field-input { color: var(--iso-danger); }
.isotone-field-reset { flex: none; display: grid; place-items: center; width: 20px; height: 20px; margin-right: 3px; border-radius: 4px; color: var(--iso-muted); }
.isotone-select-field { cursor: pointer; }
.isotone-root select.isotone-field-input { appearance: none; -webkit-appearance: none; padding-right: 22px; cursor: pointer; white-space: nowrap; }
.isotone-select-chevron { position: absolute; right: 7px; top: 7px; color: var(--iso-muted); pointer-events: none; }
.isotone-select-field[data-changed] .isotone-select-chevron { right: 27px; }
.isotone-select-field[data-changed] select.isotone-field-input { padding-right: 42px; }
.isotone-color-field > .isotone-field-label { min-width: 48px; }
.isotone-color-swatch { position: relative; flex: none; width: 18px; height: 18px; margin-right: 6px; border-radius: 4px; overflow: hidden; cursor: pointer;
  background: linear-gradient(var(--iso-swatch-value), var(--iso-swatch-value)), repeating-conic-gradient(var(--iso-zinc-300) 0 25%, var(--iso-zinc-50) 0 50%) 0 0 / 8px 8px;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--iso-fg) 16%, transparent); }
.isotone-color-swatch[data-mixed] { background: linear-gradient(135deg, var(--iso-edge) 50%, var(--iso-line) 50%); }
.isotone-color-swatch input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
.isotone-color-swatch:has(input:focus-visible) { outline: 2px solid var(--iso-focus); outline-offset: 2px; }
.isotone-field-row { display: flex; align-items: center; gap: 6px; }
.isotone-style-segs { flex: 1; flex-wrap: nowrap; min-width: 0; margin: 0; border: 0; padding: 3px; }
.isotone-style-segs .isotone-seg { flex: 1 1 0; display: grid; place-items: center; padding: 3px 0; min-width: 0; }
/* Margin around padding around the element, like a box-model diagram. */
.isotone-box { position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr) 42px; grid-template-rows: 26px auto 26px; grid-template-areas: '. top .' 'left mid right' '. bottom .'; align-items: center; justify-items: center; padding: 2px; border-radius: 8px; background: var(--iso-well); box-shadow: var(--iso-well-shadow); }
.isotone-box-padding { grid-area: mid; position: relative; display: grid; width: 100%; grid-template-columns: 42px minmax(0, 1fr) 42px; grid-template-rows: 26px 30px 26px; grid-template-areas: '. top .' 'left mid right' '. bottom .'; align-items: center; justify-items: center; border-radius: 6px; background: var(--iso-bg); box-shadow: 0 0 0 1px var(--iso-line); }
.isotone-box-top { grid-area: top; }
.isotone-box-left { grid-area: left; }
.isotone-box-right { grid-area: right; }
.isotone-box-bottom { grid-area: bottom; }
.isotone-box-caption { position: absolute; top: 6px; left: 8px; color: var(--iso-faint); font-size: 9px; line-height: 1; pointer-events: none; }
.isotone-box-content { grid-area: mid; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 8px; border-radius: 5px; color: var(--iso-muted); background: var(--iso-control-face); box-shadow: var(--iso-control-shadow); font-size: 10px; font-variant-numeric: tabular-nums; }
.isotone-box-cell { display: block; }
.isotone-root .isotone-box-cell .isotone-field-input { display: block; width: 38px; height: 20px; padding: 0 2px; border-radius: 4px; text-align: center; line-height: 20px; color: var(--iso-muted); cursor: ew-resize; touch-action: none; }
.isotone-root .isotone-box-cell .isotone-field-input:focus { cursor: text; color: var(--iso-fg); background: var(--iso-bg); box-shadow: 0 0 0 1px var(--iso-focus); }
.isotone-root .isotone-box-cell[data-changed] .isotone-field-input { color: var(--iso-fg); font-weight: 600; }
.isotone-root .isotone-box-cell .isotone-field-input[data-scrubbing] { color: var(--iso-fg); background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); }
.isotone-mixed { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.isotone-mixed-label { color: var(--iso-faint); font-size: 10px; margin-right: 2px; }
.isotone-mixed-value { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; height: 20px; padding: 0 6px; border-radius: 5px; border: 1px dashed var(--iso-edge); color: var(--iso-muted); font-size: 10px; }
.isotone-mixed-value > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.isotone-mixed-value > small { color: var(--iso-faint); font-size: 9px; font-variant-numeric: tabular-nums; }
.isotone-style-tokens { display: flex; flex-wrap: wrap; gap: 4px; }
.isotone-token { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 18px; padding: 0 5px; border: 1px solid var(--iso-edge); border-radius: 4px; background: var(--iso-label-face); box-shadow: var(--iso-label-lift-shadow); font-size: 9px; }
.isotone-token > code { min-width: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--iso-fg); }
.isotone-token > small { min-width: 0; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font-size: 9px; }
.isotone-style-foot { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px var(--iso-space); border-top: 1px solid var(--iso-line); }
.isotone-style-count { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.isotone-root .isotone-style-send { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 9px; font-weight: 500; }
.isotone-style-empty { display: flex; align-items: center; gap: 10px; padding: 8px var(--iso-space) var(--iso-space); }
.isotone-style-empty > svg { flex: none; color: var(--iso-muted); }
.isotone-style-empty p { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.isotone-style-empty span { font-size: 12px; line-height: 16px; }
.isotone-style-empty small { font-size: 10px; line-height: 14px; color: var(--iso-muted); }
/* The style toggle on the select-mode cover is a quiet icon like the composer's, not a raised action. */
.isotone-root .isotone-picking .isotone-pick { width: 28px; height: 28px; padding: 0; display: grid; place-items: center; color: var(--iso-muted); background: none; box-shadow: none; }
.isotone-root .isotone-picking .isotone-pick[aria-pressed='true'] { color: var(--iso-fg); background: var(--iso-selected-face); box-shadow: var(--iso-selected-shadow); }
@media (hover: hover) and (pointer: fine) {
  .isotone-root .isotone-picking .isotone-pick:not([aria-pressed='true']):not(:disabled):hover { color: var(--iso-fg); background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); }
}
/* The style editor needs the height; the note list keeps a few rows. */
.isotone-root[data-style-open='true'] .isotone-notes-panel { --iso-list-height: 76px; }
/* Outlines of pinned elements under the dock pass behind its panels, not over the fields. */
.isotone-root[data-style-open='true'] .isotone-panel { z-index: 2147483002; }
.isotone-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.isotone-marquee { position: fixed; z-index: 2147483001; pointer-events: none; border: 1px dashed var(--iso-pick-line); background: var(--iso-pick-fill); border-radius: 2px; }
.isotone-style-panel:has(.isotone-style-empty) { min-height: 0; }
/* Pins outside the elements an edit applies to recede while the scope is narrowed. */
.isotone-selected[data-scoped='false'] { opacity: .4; border-style: dashed; }
@media (hover: hover) and (pointer: fine) {
  .isotone-root :where(.isotone-crumb:not(.isotone-crumb-current), .isotone-child, .isotone-style-section-head):hover { background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); color: var(--iso-fg); }
  .isotone-root .isotone-box-cell .isotone-field-input:not(:focus):hover { color: var(--iso-fg); background: var(--iso-hover); box-shadow: var(--iso-hover-shadow); }
  .isotone-field-reset:hover, .isotone-mixed-value:hover { color: var(--iso-fg); }
  .isotone-mixed-value:hover { border-style: solid; }
}
`;
