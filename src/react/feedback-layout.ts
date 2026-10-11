/** A single line per note, with compact references sharing its trailing space. */
export const FEEDBACK_LAYOUT_CSS = `
.iso-iter-notes-panel {
  --iso-list-height: min(220px, 32dvh);
  --iso-note-padding-y: 6px;
  --iso-note-padding-x: calc(var(--iso-space) - 1px);
  --iso-note-outset: 1px;
}
.iso-iter-note-hit { display: flex; align-items: center; gap: 8px; }
.iso-iter-note-hit > p, .iso-iter-note-hit > .iso-iter-request-heading { flex: 1; min-width: 0; }
.iso-iter-note-hit > .iso-iter-meta { flex: 0 1 auto; max-width: 42%; margin-top: 0; }
`;
