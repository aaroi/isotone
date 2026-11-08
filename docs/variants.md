# Variants

A variant is an alternative of one specific element, chosen from the panel's
Variants tab. A **file variant** (Vite) is a copy of source files under
`.isotone/variants/<id>/` that the dev server serves in place of the real file;
the [agent guide](agent-guide.md#variants) has its commands. A **knob** (Vite or
`isotone serve`) is a number, colour or named style in `.isotone/knobs.json`. A
**host source** is an app's own variant system, rendered by the panel. This page
says how to make each well; [How switching works](#how-switching-works), last,
is reference.

## Choosing a selector

Choose the control for the decision being reviewed, not for variety in the panel:

| Decision | Definition | Example |
| --- | --- | --- |
| Structure or content alternatives | A file variant | Two hero layouts, a different card component |
| A few distinct, named alternatives | `kind: 'select'`, or omit `kind` | Compact / Comfy / Spacious; two options for an on/off choice |
| Alternatives best compared visually | A select with `image` on **every** option | Card arrangements or illustration treatments |
| One numeric property across a useful interval | `kind: 'range'` | Card radius, padding, opacity or animation duration |
| A colour | `kind: 'color'` with named `swatches` | Accent or surface colour, with the built-in custom picker |

Thumbnails are a presentation of select axes, not a `kind`, and there are no
checkbox, toggle, dropdown or free-text kinds. Use stable IDs, short labels, and
independent axes for independent decisions; `showWhen` hides a dependent axis
until its parent has the relevant selection. Keep the default among the options
or swatches.

For a range, choose bounds that give a valid design at both extremes (padding
8–32px in 2px steps, not 0–1000px), a positive `step` matching the decision's
precision, and a default on a step within `min` and `max`. Use a unit such as
`px`, `%` or `ms`; a bare 0–1 range displays as a percentage, and `unit: ''`
keeps the raw number.

Check that every control changes the intended property at its minimum, maximum
and reset, and keep the source fallback and the default in sync.

## File variants

The real file stays as it is and is the selector's Default; each variant is an
alternative to it. Variants that override the same files, or share a `--group`,
are alternatives of one decision and appear as one selector; unrelated variants
get their own selectors and can be active at the same time. Two groups that
override the same file cannot both be active: the panel names them when you pick
the second, and `variant add` warns when the overlap is created.

A selector shows only on the variant's route, a pattern as in [the agent
guide](agent-guide.md#act-on-notes); a variant made without one shows
everywhere. Copy only files that export components where you can
([why](#live-switching)). `variant add <id> --new <file>` starts a file the
project does not have; import it relatively, or through an alias whose last path
segments name it.

Variant files are the change under review, so they are committed by default and
`variant add` refuses a git-ignored file or one that looks like a secret
(`.env`, private keys, `*credentials*.json`, `*.keystore`, anything under
`.aws/` or `.ssh/`) unless given `--force`. `variants: { ignored: true }` keeps
the variants directory local. The active pointer, `.isotone/active.json`, is
local and never committed. `ISOTONE_VARIANT=<id>` (a comma-separated list) bakes
variants into a `vite build` for a preview.

**Keeping copies current.** A copy records the version of the real file it was
made from and reads as stale once that file moves on. `variant sync <id>` merges
the real file's changes in, untracked files included. Where both sides changed
the same lines the copy gets conflict markers, and until they are resolved it is
a syntax error, which in live mode also breaks pages importing the real file.
After `variant promote <id>`, the other variants in its group stay available and
stop reading as stale: they are alternatives to what was promoted.

### What the host needs

- **Framework HMR support.** Keep the host's Vite framework plugin (React Fast
  Refresh through `@vitejs/plugin-react` or its framework wrapper; Vue and
  Svelte use their own). Without an HMR accept boundary, a switch reloads.
- **Tailwind v4** scans only the sources it is pointed at. Add
  `@source "../.isotone/variants/**/*.{ts,tsx}";` (relative to the CSS
  file) or classes new to a variant render unstyled.
- **A sibling dev server** that aliases into another package sets
  `variants: { root: '../that-package' }` so both serve the same variants.
- **Routes** come from `window.location.pathname`. An app on a memory
  router sees `/` everywhere; leave `--route` off there.
- **Linters** should ignore `.isotone` (Biome: `"!.isotone"` in
  `files.includes`; ESLint: `{ ignores: ['.isotone/**'] }`).

## Knobs

A decision that is a number, colour or named style, not an alternative file,
is a knob in `.isotone/knobs.json`: a JSON array of range, colour or select axes,
each with an optional `route` (a pattern or a list of them):

```json
[
  {
    "kind": "range",
    "id": "fade-from",
    "label": "Hero > Fade starts",
    "min": 0,
    "max": 100,
    "step": 1,
    "defaultValue": 0,
    "unit": "%",
    "route": ["/computers/*", "/databases/*"]
  }
]
```

A colour knob takes a `defaultColor` and named `swatches`, all as hex values:

```json
{
  "kind": "color",
  "id": "accent",
  "label": "Accent colour",
  "defaultColor": "#2f6f4e",
  "swatches": [
    { "id": "forest", "label": "Forest", "value": "#2f6f4e" },
    { "id": "clay", "label": "Clay", "value": "#b4532a" }
  ]
}
```

Ranges render as sliders and colours as swatches with a custom picker. An
invalid entry is skipped, and `npx isotone variant list` names it. Knobs work
with `isotone serve` too. A value reaches the page as `--knob-<id>` on `<html>`,
unit appended, so the source reads it with the committed default as fallback:

```css
mask-image: radial-gradient(ellipse, black var(--knob-fade-from, 0%), transparent 100%);
```

A select knob names a style that one line of CSS or a draw call can act on. Give
it `options` of `{ "id", "label" }` and a `defaultOption`. Its value also lands
as `data-knob-<id>` on `<html>`, since CSS cannot branch on a custom property:

```css
html[data-knob-tick-style="dots"] .tick { border-radius: 50%; }
```

When the alternative changes structure, use a file variant: a select knob leaves
both branches in the source until someone removes one.

Code that draws for itself, such as a canvas chart, reads the property and
redraws on the `isotone:knob` event, which bubbles from `<html>` with
`{ id, value }` (`null` when the knob returns to its default):

```js
document.addEventListener('isotone:knob', ({ detail }) => {
  if (detail.id === 'tick-style') chart.setTicks(detail.value ?? 'lines');
});
```

The event only fires while the panel is mounted, so keep the committed default in
the source. Knob values live in the reviewer's browser; **Make default** files the
moved ones in its `[set-defaults]` note (`payload.knobs` as `fade-from:40`).

## Sections

Once a page has more than a few selectors, put each in a section named after the
part of the page it changes, as a label prefix with a spaced `>`:

```ts
{ id: 'logo-size', label: 'Header > Logo size', kind: 'range', min: 16, max: 48, step: 2, defaultValue: 24, unit: 'px' }
```

The panel shows *Logo size* under a sticky, foldable **Header** heading with a
count. Screen readers, notes and saved defaults keep the full name,
`Header › Logo size`.

- Only the first ` > ` (or ` › `) splits: `Header > Nav > Gap` is *Nav > Gap*
  in Header, and `a>b` stays one label. A slash never splits, so `Light / Dark`
  keeps its whole label.
- Sections match case-insensitively and keep their first selector's casing.
  Unsectioned selectors come first; sections follow in order of their first
  selector, and selectors keep their order inside them.
- A `showWhen` selector without its own section joins its parent's.
- Sections are display text only: IDs, `?v=` links and `selections` do not change.

An explicit `section` field overrides the prefix, and the label shows as
written, less a prefix repeating the section. `section: ''` keeps a label that
needs a spaced `>`, such as `Before > After`, out of every section:

```ts
{ id: 'order', label: 'Before > After', section: '', options: [/* … */], defaultOption: 'before' }
```

Host axes and `.isotone/knobs.json` entries take a prefixed `label` or a
`section` field. File variants take it from the group label
(`variant new <id> --group-label "Header > Logo"`) or
`variant new <id> --section Header`.
`variant section <id> <text>` moves an existing selector with its whole group,
`variant section <id> --none` takes it out of every section, and `variant list`
shows a SECTION column.

## The Variants panel

Each option's chevron (or a right click) offers feedback on it, keeping only it,
or removing it. Keep, remove and **Make default** file a request note
([what each asks](agent-guide.md#requests-from-the-variants-panel)); the
selector stays as it is until the agent changes the project.

## A host source

A host with its own variant system hands the panel a `VariantsSource`. The panel
renders the axes; the app keeps its own state and URL sync.
`npx isotone init --approach host` prints a complete example.

```ts
import { createVariantsSource, mountIsotone } from 'isotone/react';

const source = createVariantsSource({
  axes: [{
    id: 'card-radius', label: 'Card radius', kind: 'range',
    min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px',
  }],
  onChange: (selections) => {
    document.documentElement.style.setProperty('--card-radius', `${selections['card-radius']}px`);
  },
});
mountIsotone({ variants: source, defaultTab: 'variants' });
```

```css
.card { border-radius: var(--card-radius, 11px); }
```

`selections` maps each axis id to a string; a range's value is a numeric string,
and `onChange` must apply it to the app's state or styles. The axis types
(`VariantAxis` and the select, range and colour axes) come from `isotone/core`.

A host that manages its own definitions can use the source's `manage(action)`:
its `onManage(axes, selections, action)` callback persists edited definitions or
rejects to leave them unchanged (filing a note never calls it). A custom source
can expose `getError(): string | null`, notifying subscribers on change, to show
load or update failures in the panel.

## How switching works

### Live switching

In a React project on Vite 6 or later, the plugin serves each overridden script
as a dispatcher module importing every version: the real file as
`<file>?isotone=_base` and each copy as `<file>?isotone=<id>`. Each export
becomes one binding, decided in the browser:

- A component becomes a wrapper rendering the active version; a switch
  re-renders it, and state outside it survives.
- A value identical in every version passes through.
- Anything else (a hook, helper, constant object, context) is fixed at page
  load, since React cannot swap a hook under a mounted component, and a switch
  that changes one reloads. Every copy defines these afresh, so a copied file
  exporting one reloads on every switch: move shared helpers into files the
  variant leaves alone.

The selection belongs to the tab: a pick goes into the URL as
`?v=<group>:<variant>` (the host-variant grammar), kept through client-side
navigation, so a copied link opens the same variant and two tabs can compare. It
also goes to `.isotone/active.json`, which tabs without `?v=` and the agent
follow. Every version of a dispatched file loads, so a copy runs even while off:
a global stylesheet it imports applies everywhere, and a syntax error in it
breaks pages importing the real file.

### Whole-file switching

`variants: { live: false }` swaps whole files over HMR instead, as non-React
hosts, CSS files, Vite 5 and `vite build` always do. Live mode still serves these
whole:

- route modules (a default export beside `loader`, `action`, `meta` and
  similar, which the router's plugin reads one by one);
- files without exports, such as an entry, since every version would run;
- files that compare element types (`child.type === Tab`), which a wrapper
  would break;
- files whose exports it cannot list (`export *`, destructuring, several
  declarators in one `export const`).

Such a file, and every CSS file, follows `.isotone/active.json` in every tab, and
switches as a Vite hot update, exactly as an edit to it would. A React file that
also exports data or a hook cannot be swapped alone: the update climbs to its
importer, and an entry with no accept handler reloads. Accept the import in the
entry and re-render from the new module, or move the extra exports out.

### Server rendering

Server rendering follows `.isotone/active.json`, since the server cannot tell
tabs apart; a tab whose components differ hydrates from it and switches right
after. A link whose `?v=` differs in a fixed export saves its set as the default
and reloads once; later reloads hydrate with a recoverable mismatch, so two tabs
never fight over the default.
