/**
 * Paint only. Layout, typography, hit targets and state selectors live in panel.ts.
 * Both themes implement the same palette contract and share one Instrument
 * material recipe. Layout and interaction never fork with the page theme.
 *
 * Surfaces a sticky header or a fade must match are flat (`bg`, `well`), so a
 * header never shows as a band over a gradient. Depth comes from edges, inner
 * highlights and shadows instead.
 */
const darkPalette = {
  bg: 'oklch(22.5% .005 286)',
  raised: 'var(--iso-zinc-800)',
  well: 'oklch(17.5% .004 286)',
  // Thumbnail slots sit a step below other wells, so the raised selection reads at a glance.
  deep: 'oklch(16.5% .004 286)',
  line: '#ffffff1c',
  edge: 'var(--iso-zinc-700)',
  fg: 'oklch(95% .003 286)',
  muted: 'oklch(72% .01 286)',
  faint: 'oklch(58% .012 286)',
  hover: '#ffffff0d',
  'hover-shadow': 'none',
  'segment-hover': '#ffffff12',
  'icon-rest': 'var(--iso-muted)',
  'launcher-ink': 'var(--iso-fg)',
  danger: '#f29188',
  focus: 'var(--iso-zinc-400)',
  'selected-edge': 'var(--iso-zinc-400)',
  // The one coloured control: the composer's send action, and the count it feeds.
  accent: '#5f62e0',
  'accent-hover': '#6d70ea',
  'accent-shadow': 'inset 0 1px 0 #ffffff33, 0 0 0 1px #2a2c8a80, 0 1px 2px #0004',
  // Card: inner top light, hairline, a crisp outline against the page, then a soft drop.
  'panel-shadow':
    'inset 0 1px 0 #ffffff17, inset 0 0 0 1px #ffffff0d, 0 0 0 1px #0009, 0 2px 4px #0004, 0 12px 24px -6px #0006, 0 32px 64px -16px #0008',
  'popup-shadow': 'inset 0 1px 0 #ffffff21, inset 0 0 0 1px #ffffff14, 0 0 0 1px #000b, 0 2px 4px #0005, 0 12px 32px -4px #000c',
  'rail-base': 'oklch(20% .005 286)',
  'rail-base-shadow': 'inset 0 1px 0 #ffffff17, inset 0 0 0 1px #ffffff0d, 0 0 0 1px #000c, 0 2px 4px #0005, 0 12px 28px -8px #000a',
  'shadow-contact': '#0007',
  'shade-soft': '#0003',
  'surface-face': 'oklch(27.5% .005 286)',
  'key-face': 'linear-gradient(oklch(34% .006 286), oklch(29.5% .006 286))',
  'key-hover-face': 'linear-gradient(oklch(37% .006 286), oklch(32% .006 286))',
  // Lit top edge, a quiet outline and a small contact shadow.
  'key-shadow': 'inset 0 1px 0 #ffffff1f, 0 0 0 1px #0006, 0 1px 2px #0004',
  'label-face': 'oklch(30% .006 286)',
  'label-shadow': 'inset 0 0 0 1px #ffffff17',
  // Shaded from above, with a faint lit lower lip so the recess reads.
  'well-shadow': 'inset 0 1px 2px #0005, inset 0 0 0 1px #ffffff08, 0 1px 0 #ffffff08',
  'thumb-shadow': 'inset 0 1px 2px #0005, inset 0 0 0 1px #ffffff08, 0 1px 0 #ffffff0a',
  'thumb-hover-shadow': 'inset 0 0 0 1px #ffffff1a, 0 1px 0 #ffffff08',
  track: 'oklch(32% .006 286)',
  'track-shadow': 'inset 0 1px 1px #0005',
  tick: 'oklch(80% .01 286)',
  dot: 'oklch(78% .01 286)',
  'range-face': 'linear-gradient(oklch(88% .004 286), oklch(78% .006 286))',
  'range-shadow': 'inset 0 1px 0 #fff6, 0 0 0 1px #0007, 0 1px 2px #0006',
  'pick-line': '#8a8cf3',
  'pick-fill': '#8a8cf31a',
  'pick-selected-fill': '#8a8cf310',
};
type Palette = Record<keyof typeof darkPalette, string>;
export const PALETTES = {
  dark: darkPalette,
  // Gray means recessed. White faces with a fine edge and a small shadow mean
  // raised, including persistent selections. Hover preserves each material.
  light: {
    bg: '#fff',
    raised: '#fff',
    well: 'oklch(96.5% .002 286)',
    deep: 'oklch(95.5% .003 286)',
    line: '#00000012',
    edge: 'var(--iso-zinc-300)',
    fg: 'oklch(20% .006 286)',
    muted: 'oklch(46% .014 286)',
    faint: 'oklch(60% .014 286)',
    hover: '#0000000a',
    'hover-shadow': 'none',
    'segment-hover': '#ffffffa6',
    'icon-rest': 'var(--iso-zinc-500)',
    'launcher-ink': 'var(--iso-muted)',
    danger: '#b42332',
    focus: 'var(--iso-zinc-600)',
    'selected-edge': 'color-mix(in oklch, var(--iso-zinc-300) 75%, var(--iso-zinc-400))',
    accent: '#5558dc',
    'accent-hover': '#4a4dd0',
    'accent-shadow': 'inset 0 1px 0 #ffffff33, 0 0 0 1px #4346c0, 0 1px 2px #3f42b833',
    'panel-shadow': '0 0 0 1px #00000017, 0 1px 2px #0000000d, 0 8px 24px -10px #00000029',
    'popup-shadow': '0 0 0 1px #0000001a, 0 2px 4px #0000000f, 0 12px 28px -8px #00000033',
    'rail-base': '#fff',
    'rail-base-shadow': '0 0 0 1px #00000017, 0 1px 2px #0000000d, 0 6px 16px -6px #00000029',
    'shadow-contact': 'var(--iso-edge)',
    'shade-soft': '#00000006',
    'surface-face': '#fff',
    'key-face': 'linear-gradient(#fff, oklch(98.6% .002 286))',
    'key-hover-face': '#fff',
    'key-shadow': '0 0 0 1px #00000014, 0 1px 2px #00000012',
    'label-face': '#fff',
    'label-shadow': 'inset 0 0 0 1px #00000014',
    // One crisp hairline; a blurred inner shadow muddies a light field's edge.
    'well-shadow': 'inset 0 0 0 1px #0000000d',
    'thumb-shadow': 'inset 0 0 0 1px #0000000f',
    'thumb-hover-shadow': 'inset 0 0 0 1px #00000024',
    track: 'oklch(85% .006 286)',
    'track-shadow': 'inset 0 1px 1px #0000001f',
    tick: 'oklch(55% .014 286)',
    dot: 'oklch(72% .012 286)',
    'range-face': '#fff',
    'range-shadow': '0 0 0 1px #00000026, 0 1px 3px #00000033',
    'pick-line': '#5558dc',
    'pick-fill': '#5558dc14',
    'pick-selected-fill': '#5558dc0d',
  },
} satisfies Record<'dark' | 'light', Palette>;

/** Instrument is the single material recipe; themes supply its lighting. */
export const INSTRUMENT_MATERIAL = {
  'accent-ink': '#fff',
  'input-border': 'transparent',
  'input-shadow': 'var(--iso-well-shadow)',
  'segment-track-shadow': 'var(--iso-well-shadow)',
  'control-face': 'var(--iso-key-face)',
  'control-hover-face': 'var(--iso-key-hover-face)',
  'control-shadow': 'var(--iso-key-shadow)',
  'control-hover-shadow': 'var(--iso-key-shadow)',
  // Persistent selection is raised, just like an action. Never route it to a well.
  'selected-face': 'var(--iso-control-face)',
  'selected-shadow': 'var(--iso-control-shadow)',
  'popup-face': 'var(--iso-surface-face)',
  'range-thumb-face': 'var(--iso-range-face)',
  'range-thumb-shadow': 'var(--iso-range-shadow)',
  'swatch-shadow':
    'inset 0 1px 0 #fff6, inset 0 -2px 0 var(--iso-shade-soft), 0 0 0 1px var(--iso-edge), 0 2px 0 var(--iso-shadow-contact)',
  // Preserve the represented colour inside the raised selection frame.
  'swatch-selected-shadow': '0 0 0 2px var(--iso-raised), 0 0 0 3px var(--iso-edge), 0 2px 0 3px var(--iso-shadow-contact)',
};

export const PALETTE_TOKEN_NAMES = new Set(Object.keys(darkPalette).map((name) => `--iso-${name}`));
function tokens(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `--iso-${name}: ${value};`)
    .join('\n');
}
export const APPEARANCE_CSS = `
.isotone-root { ${tokens(PALETTES.dark)} ${tokens(INSTRUMENT_MATERIAL)} }
.isotone-root[data-theme='light'] { ${tokens(PALETTES.light)} color-scheme: light; }
`;
