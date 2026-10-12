/** A single line per note, with compact references sharing its trailing space. */
export const FEEDBACK_LAYOUT_CSS = `
.isotone-notes-panel {
  --iso-list-height: min(220px, 32dvh);
  --iso-note-padding-y: 6px;
  --iso-note-padding-x: calc(var(--iso-space) - 1px);
  --iso-note-outset: 1px;
}
.isotone-note-hit { display: flex; align-items: center; gap: 8px; }
.isotone-note-hit > p { flex: 1; min-width: 0; }
.isotone-note-hit > .isotone-meta { flex: 0 1 auto; max-width: 42%; margin-top: 0; }
`;
