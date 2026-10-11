/** Raised highlight with one edge and a crisp one-pixel contact shadow. */
export const PILL_ACTIVE_CSS = `
.isotone-rail-button[aria-expanded='true']::before {
  background: color-mix(in oklch, var(--iso-raised), #fff 8%);
  box-shadow: 0 0 0 1px color-mix(in oklch, var(--iso-edge), var(--iso-fg) 12%), 0 1px 0 var(--iso-shadow-contact);
}
`;
