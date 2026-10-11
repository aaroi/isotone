/**
 * Paint only. Layout, typography, hit targets and state selectors live in styles.ts.
 * Both themes implement the same palette contract and share one Instrument
 * material recipe. Layout and interaction never fork with the page theme.
 */
const darkPalette = {
  bg: 'var(--iso-zinc-900)', raised: 'var(--iso-zinc-800)', well: 'var(--iso-zinc-950)',
  line: 'var(--iso-zinc-800)', edge: 'var(--iso-zinc-700)',
  fg: 'var(--iso-zinc-200)', muted: 'var(--iso-zinc-400)',
  faint: 'color-mix(in oklch, var(--iso-zinc-400) 70%, var(--iso-zinc-500))',
  hover: 'var(--iso-zinc-800)',
  'hover-shadow': 'none', 'icon-rest': 'var(--iso-muted)', 'launcher-ink': 'var(--iso-fg)',
  danger: '#f29188', focus: 'var(--iso-zinc-400)', 'selected-edge': 'var(--iso-zinc-400)',
  shadow: '0 12px 40px #0004, 0 2px 6px #0003, 0 0 0 1px var(--iso-line)',
  'panel-shadow': '0 8px 24px #0003, 0 2px 4px #0002',
  'shadow-near': '#0004', 'shadow-deep': '#0005', 'shadow-contact': '#0007',
  'shade-soft': '#0003', 'shade-inset': '#0005',
  bevel: 'color-mix(in oklch, var(--iso-zinc-200) 18%, transparent)',
  'surface-face': 'linear-gradient(color-mix(in oklch, var(--iso-bg), var(--iso-zinc-200) 3%), var(--iso-bg))',
  'key-face': 'linear-gradient(color-mix(in oklch, var(--iso-raised), var(--iso-zinc-200) 7%), var(--iso-raised))',
  'key-hover-face': 'linear-gradient(color-mix(in oklch, var(--iso-raised), var(--iso-zinc-200) 10%), color-mix(in oklch, var(--iso-raised), var(--iso-zinc-200) 3%))',
  'key-shadow': 'inset 0 1px 0 color-mix(in oklch, var(--iso-zinc-200) 20%, transparent), inset 0 -1px 0 #0003, 0 0 0 1px var(--iso-edge), 0 2px 2px #0006',
  'key-hover-shadow': 'var(--iso-key-shadow)',
  'label-lift-shadow': '0 1px 2px var(--iso-shadow-deep)',
  'contact-lift-shadow': '0 2px 2px var(--iso-shadow-contact)',
  'surface-elevation': '0 3px 0 var(--iso-shadow-deep), 0 12px 24px var(--iso-shadow-deep)',
  'well-shadow': 'inset 0 1px 3px #0005, 0 1px 0 var(--iso-line)',
  'range-face': 'linear-gradient(var(--iso-zinc-300), var(--iso-zinc-400))',
  'range-highlight': 'var(--iso-zinc-200)',
  'pick-line': '#81aaff', 'pick-fill': '#78aaff1a', 'pick-selected-fill': '#78aaff0f',
};
type Palette = Record<keyof typeof darkPalette, string>;
export const PALETTES = {
  dark: darkPalette,
  // Gray means recessed. White faces with a crisp border/contact shadow mean
  // raised, including persistent selections. Hover preserves each material.
  light: {
    bg: '#fff', raised: '#fff', well: 'var(--iso-zinc-100)',
    line: 'var(--iso-zinc-200)', edge: 'var(--iso-zinc-300)',
    fg: 'var(--iso-zinc-900)', muted: 'var(--iso-zinc-600)', faint: 'var(--iso-zinc-500)',
    hover: '#fff',
    'hover-shadow': 'inset 0 0 0 1px var(--iso-line)', 'icon-rest': 'var(--iso-zinc-500)', 'launcher-ink': 'var(--iso-muted)',
    danger: '#b42332', focus: 'var(--iso-zinc-600)',
    'selected-edge': 'color-mix(in oklch, var(--iso-zinc-300) 75%, var(--iso-zinc-400))',
    shadow: '0 0 0 1px var(--iso-line), 0 2px 0 var(--iso-line)',
    'panel-shadow': '0 2px 0 var(--iso-line)',
    'shadow-near': 'var(--iso-line)', 'shadow-deep': 'var(--iso-edge)', 'shadow-contact': 'var(--iso-edge)',
    'shade-soft': '#00000006', 'shade-inset': '#00000008',
    bevel: '#fffffff2',
    'surface-face': '#fff',
    'key-face': 'var(--iso-raised)',
    'key-hover-face': 'var(--iso-key-face)',
    'key-shadow': '0 0 0 1px var(--iso-edge), 0 2px 0 var(--iso-edge)',
    'key-hover-shadow': '0 0 0 1px var(--iso-selected-edge), 0 2px 0 var(--iso-selected-edge)',
    'label-lift-shadow': '0 1px 0 var(--iso-edge)',
    'contact-lift-shadow': '0 2px 0 var(--iso-shadow-contact)',
    'surface-elevation': '0 2px 0 var(--iso-line)',
    'well-shadow': 'inset 0 0 0 1px var(--iso-line)',
    'range-face': 'var(--iso-key-face)', 'range-highlight': '#fff',
    'pick-line': '#2563eb', 'pick-fill': '#2563eb14', 'pick-selected-fill': '#2563eb0d',
  },
} satisfies Record<'dark' | 'light', Palette>;

/** Instrument is the single material recipe; themes supply its lighting. */
export const INSTRUMENT_MATERIAL = {
  'rail-base': 'var(--iso-well)', 'rail-base-shadow': 'var(--iso-well-shadow)',
  'rail-face': 'var(--iso-key-face)', 'rail-face-shadow': 'var(--iso-key-shadow)',
  'input-border': 'transparent', 'input-shadow': 'var(--iso-well-shadow)',
  'segment-track-shadow': 'var(--iso-well-shadow)',
  'control-face': 'var(--iso-key-face)', 'control-hover-face': 'var(--iso-key-hover-face)',
  'control-shadow': 'var(--iso-key-shadow)', 'control-hover-shadow': 'var(--iso-key-hover-shadow)',
  // Persistent selection is raised, just like an action. Never route it to a well.
  'selected-face': 'var(--iso-control-face)', 'selected-shadow': 'var(--iso-control-shadow)',
  'popup-face': 'var(--iso-surface-face)',
  'popup-shadow': 'inset 0 1px 0 var(--iso-bevel), inset 0 -1px 0 var(--iso-shade-inset), 0 0 0 1px var(--iso-line), var(--iso-surface-elevation)',
  'thumb-shadow': 'var(--iso-well-shadow)',
  'thumb-hover-shadow': 'inset 0 0 0 1px var(--iso-edge)',
  'label-face': 'var(--iso-key-face)', 'label-shadow': 'inset 0 1px 0 var(--iso-bevel), 0 0 0 1px var(--iso-edge), var(--iso-label-lift-shadow)',
  'range-thumb-face': 'var(--iso-range-face)', 'range-thumb-shadow': 'inset 0 1px 0 var(--iso-range-highlight), 0 0 0 1px var(--iso-edge), var(--iso-contact-lift-shadow)', 'range-radius': '4px',
  'swatch-radius': '6px', 'swatch-shadow': 'inset 0 1px 0 #fff6, inset 0 -2px 0 var(--iso-shade-soft), 0 0 0 1px var(--iso-edge), 0 2px 0 var(--iso-shadow-contact)',
  // Preserve the represented colour inside the raised selection frame.
  'swatch-selected-shadow': '0 0 0 2px var(--iso-raised), 0 0 0 3px var(--iso-edge), 0 2px 0 3px var(--iso-shadow-contact)',
};

export const PALETTE_TOKEN_NAMES = new Set(
  Object.keys(darkPalette).map(name => `--iso-${name}`),
);
function tokens(values: Record<string, string>): string {
  return Object.entries(values).map(([name, value]) => `--iso-${name}: ${value};`).join('\n');
}
export const APPEARANCE_CSS = `
.iso-iter-root { ${tokens(PALETTES.dark)} ${tokens(INSTRUMENT_MATERIAL)} }
.iso-iter-root[data-theme='light'] { ${tokens(PALETTES.light)} color-scheme: light; }
`;
