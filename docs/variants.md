# Variants

A variant is an alternative of one specific element, chosen from the
panel's Variants tab. Two host shapes:

**A Vite host with no variant system** gets overlay variants, on by default.
A variant is a directory under `.isotone/variants/<id>/` holding copies
of source files at their repo-relative paths plus a `variant.json`
manifest. While the variant is active, the plugin serves the copy in place
of the real file. In a React project on Vite 6 or later the browser loads
every version up front and switches between them itself (see
[live switching](#live-switching)). Variants that override the same files, or share a
`--group`, are alternatives of one decision and appear as one selector with
Default and each option; unrelated variants get their own selectors and can
be active at the same time. A selector shows only on the variant's route;
a route ending in `/*` covers every page under it, and a variant made
without a route shows everywhere.

**A host with its own variant system** hands the panel a `VariantsSource`:

```ts
import { createVariantsSource, mountIteration } from 'isotone/react';

const source = createVariantsSource({ axes, onChange: applySelections });
mountIteration({ variants: source, defaultTab: 'variants' });
```

The panel renders select, range and colour axes, thumbnail grids,
conditional axes and per-selector actions; the app keeps its own state and URL
sync. `npx isotone init --approach host` prints a complete example.

## Choosing a selector

Choose the control for the decision being reviewed, not for variety in the panel:

| Decision | Definition | Example |
| --- | --- | --- |
| A few distinct, named alternatives | `kind: 'select'`, or omit `kind` | Compact / Comfy / Spacious; two options for an on/off choice |
| Alternatives best compared visually | A select with `image` on **every** option | Card arrangements or illustration treatments |
| One numeric property across a useful interval | `kind: 'range'` | Card radius, padding, opacity or animation duration |
| A colour | `kind: 'color'` with named `swatches` | Accent or surface colour, with the built-in custom picker |

Thumbnail grids are a presentation of select axes, not another `kind`. There are
no separate checkbox, toggle, dropdown or free-text axis kinds. Use stable IDs,
short descriptive labels, and independent axes for independent decisions.
`showWhen` hides a dependent axis until its parent has the relevant selection.
Keep the default among the available options or swatches.

## Sections

Once a page has more than a few selectors, put each one in a section named after
the part of the page it changes. Write the section as a label prefix, a `>`
with a space on each side:

```ts
{ id: 'logo-size', label: 'Header > Logo size', kind: 'range', min: 16, max: 48, step: 2, defaultValue: 24, unit: 'px' }
```

The panel shows a **Header** heading with *Logo size* under it. The heading stays
at the top of the list while you scroll through its selectors, shows how many it
holds, and folds the section away. Screen readers, notes and saved defaults keep
the full name, `Header › Logo size`.

- Only the first ` > ` splits, so `Header > Nav > Gap` is *Nav > Gap* in Header.
  ` › ` works the same way. The spaces matter: `a>b` stays one label.
- A slash never makes a section, so binary selectors such as `Light / Dark` or
  `Grid / List` keep their whole label.
- Sections match without regard to case and keep the casing of their first selector.
- Selectors without a section come first, without a heading. Sections follow in
  the order their first selector appears, and selectors keep their order inside them.
- A `showWhen` selector without its own section joins its parent's section.
- Section names are display text only. IDs, `?v=` links and `selections` do not change.

An explicit `section` field overrides the prefix. The label then shows as written,
less a prefix that repeats the section. `section: ''` keeps a label that needs a
spaced `>`, such as `Before > After`, out of every section:

```ts
{ id: 'order', label: 'Before > After', section: '', options: [/* … */], defaultOption: 'before' }
```

The same works everywhere a selector is defined. Host axes and `.isotone/knobs.json`
entries take a prefixed `label` or a `section` field. File variants take it from the
group label (`variant new <id> --group-label "Header > Logo"`), or from
`variant new <id> --section Header`. `variant section <id> <text>` moves an existing
selector, with every variant in its group; `variant section <id> --none` takes it out
of every section. `variant list` shows a SECTION column.

For a range, choose bounds that produce useful, valid designs at both extremes.
Use a positive `step` that matches the decision's precision, and a default aligned
to that step within `min` and `max`. For example, padding from 8–32px in 2px steps
is easier to compare than 0–1000px in tiny increments. Radius from 0–24px in 1px
steps retains useful control. Use a unit such as `px`, `%` or `ms`; a bare 0–1
range displays as a percentage, while `unit: ''` keeps its raw numeric value.

In a host source, ranges return numeric **strings** in `selections`; the host's
`onChange` must apply them to its state or styles. For example:

```ts
const source = createVariantsSource({
  axes: [{
    id: 'card-radius', label: 'Card radius', kind: 'range',
    min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px',
  }],
  onChange: (selections) => {
    document.documentElement.style.setProperty('--card-radius', `${selections['card-radius']}px`);
  },
});
```

```css
.card { border-radius: var(--card-radius, 11px); }
```

Use source-file variants for structural or content alternatives. In a Vite overlay
project, declare numeric and colour controls in `knobs.json` as below, and read
their CSS custom properties instead of copying a file for every possible value.
Verify every control changes the intended app property, including its minimum,
maximum and reset state. When saving defaults, keep the source fallback and the
axis default in sync. The interactive demo includes card radius and padding sliders
in a Cards section and the accent colour in a Theme section; its screenshot view
keeps the original two selectors, without sections, for a compact composition.

Each option, thumbnail and colour swatch has a small chevron in its corner (and a right click)
that opens the selector dialog for that option alone: feedback on it, keep only
it, or remove it. The selector's own dialog offers the same per-option actions.
Opening it does not change the selection.

A `[keep-option]` note means the reviewer picked a winner: make that option the
default and remove the selector and the other options. Apply it like a promoted
variant: `variant promote <id>` for the named option (or inline the knob's
chosen branch), then drop the others. `[keep-default]` is the same for the
current default, and `[remove-option]` / `[remove-axis]` only remove.

Removal actions in the panel save requests for the agent. Selectors and options
stay visible and usable until the agent changes the project. Requests open in
the composer like any note; editing them preserves their structured action and
reference. Cancelling a pending request leaves the selector unchanged. Deleting
a request after the agent has applied it does not undo a source change.

For hosts that explicitly manage their own definitions, the core source also
provides a programmatic `manage(action)` API. Its `onManage(axes, selections,
action)` callback can persist edited definitions or reject to leave them
unchanged. The panel never calls this API as a side effect of creating a note.
Normal selection changes still use `onChange`. A custom source can expose optional `getError(): string | null`
to surface load or update failures in the panel; notify subscribers when that
error changes, and return `null` after recovery. Feedback stores a `variant` reference with
selector/option IDs separately from the host's `payload`.

**Keeping copies current.** A copy records the version of the real file it was
made from, and reads as stale once that file moves on. `variant sync <id>` merges
the real file's changes into the copy and works on files git does not track yet.
When both sides changed the same lines, the copy gets conflict markers to resolve,
and while they are there the copy is a syntax error, which in live mode also breaks
pages that import the real file. `variant promote <id>` lands a copy over the real
file. The other variants in its group stay available and stop reading as stale,
since they are alternatives to what was just promoted.

Two groups that override the same file cannot both be active. The panel names
them when you pick the second, and `variant add` warns when the overlap is created.

**The loop.** Pin an element and write the ask. The agent starts a variant
from the note and edits the copy. You switch between Default and the
alternatives in the panel; the switch applies in place. **Make
default** files your picks as a note, and the agent lands the named
variants over the real files with `variant promote`. Nothing else changes:
other variants stay until you ask for one to be dropped.

Variant files are committed by default, since they are the change under
review; `variants: { ignored: true }` keeps them local. The active pointer,
`.isotone/active.json`, is local and never committed. `ISOTONE_VARIANT=<id>`
(a comma-separated list) bakes variants into a `vite build` for a preview.

### Knobs

Some decisions are a number, not an alternative file: how far a fade
reaches, how dense a dot field is. Declare those in
`.isotone/knobs.json`, a JSON array of range, colour or select axes with an
optional `route` (a pattern like a variant's, or a list of them):

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

The panel renders range knobs as sliders and colour knobs as swatches with a
custom picker, on their configured routes. An entry with a missing or invalid
field is skipped; `npx isotone variant list` names each one. Knobs also work with
`isotone serve`, so any dev server gets them, not only Vite. A value reaches the
page as a custom property on `<html>`, `--knob-<id>`, with the unit
appended, so the source reads it with the committed default as the
fallback:

```css
mask-image: radial-gradient(ellipse, black var(--knob-fade-from, 0%), transparent 100%);
```

A select knob names a style rather than a number, for a choice that one line of
CSS or a draw call can act on. Give it `options` of `{ "id", "label" }` and a
`defaultOption`. CSS cannot branch on a custom property, so its value also lands
as `data-knob-<id>` on `<html>`:

```css
html[data-knob-tick-style="dots"] .tick { border-radius: 50%; }
```

When the alternative changes structure, a file variant is still the right tool,
because a select knob leaves both branches in the source until someone removes one.

Code that draws for itself, such as a canvas chart, reads the custom property and
redraws on the `isotone:knob` event, which bubbles from `<html>` with
`{ id, value }` and a `null` value when the knob returns to its default:

```js
document.addEventListener('isotone:knob', ({ detail }) => {
  if (detail.id === 'tick-style') chart.setTicks(detail.value ?? 'lines');
});
```

The event only fires while the panel is mounted, so keep the committed default in
the source. Knob values live in the reviewer's browser, not on the server. "Make
default" files the moved knobs in the same `[set-defaults]` note as the
variant picks, as `Knobs: Hero › Fade starts 40% (fade-from)` with a `knobs`
payload of `fade-from:40`; the agent writes the number into the source and
into the knob file's `defaultValue`.

## Live switching

In a React project on Vite 6 or later, the plugin serves each overridden
script as a small dispatcher module that imports every version of the file:
the real one as `<file>?isotone=_base` and each variant's copy as
`<file>?isotone=<id>`. Each export becomes one binding, decided in the
browser:

- A component becomes a wrapper that renders the active version. A switch
  re-renders it, and state outside it survives.
- A value that is identical in every version passes through.
- Anything else (a hook, a helper function, a constant object, a context) is
  fixed when the page loads, because React cannot swap a hook under a mounted
  component. A switch that changes one reloads the page.

Every copy of a file defines its functions and objects afresh, so a copied
file that exports a hook or helper reloads on every switch even when that
export is unchanged. Keep a variant's copies to files that export only
components, and move shared helpers into files the variant leaves alone.

The selection belongs to the tab. Picking an option writes it to the URL as
`?v=<group>:<variant>`, in the same grammar as host variants, and the URL
keeps it through client-side navigation, so a copied link opens the same
variant. A tab without `?v=` shows `.isotone/active.json`, and the panel
writes each pick there too, as the default for new tabs and for the agent.
Two tabs with different `?v=` values show different variants side by side.

A variant can add a file the project does not have:
`isotone variant add <id> --new <file>` starts an empty one. Import it
relatively, or through an alias whose last path segments name it.

`variants: { live: false }` turns this off and switches by swapping whole
files over HMR, which is also what non-React hosts, CSS files, Vite 5 and
`vite build` use. In live mode the plugin still serves these files whole:

- route modules (a default export beside `loader`, `action`, `meta` and
  similar, which the router's plugin reads one by one);
- files without exports, such as an entry, since every version would run;
- files that compare element types (`child.type === Tab`), which a wrapper
  would break;
- files whose exports it cannot list (`export *`, destructuring, several
  declarators in one `export const`).

A file served whole, and every CSS file, follows `.isotone/active.json` in
every tab, so it does not take part in per-tab selection. The browser also
loads every version of a dispatched file, so a variant's copy runs even
while its variant is off. A global stylesheet it imports applies on every
tab, and a syntax error in it breaks pages that import the real file until
it is fixed.

**Server rendering.** The server renders from `.isotone/active.json`, since
it cannot tell which tab a request is for. A component mismatch between the
server and the tab hydrates from the server's version and switches right
after. When a link opens a tab whose `?v=` differs from the server in a
fixed export, the tab saves its set as the default and reloads once. A
reload in such a tab leaves the default alone and hydrates with a
recoverable mismatch instead, so two tabs never take the server back and
forth.

## What whole-file switching needs from the host

Without live switching (or for a file it serves whole), a switch is
delivered as a Vite hot update, so it swaps in place exactly where an edit to
that file would.

- **Framework HMR support.** Keep the host's Vite framework plugin. React uses
  Fast Refresh through `@vitejs/plugin-react` or its framework wrapper; Vue and
  Svelte use their own plugins. Without an HMR accept boundary, a change reloads.
- **React component-only exports.** A file that also exports data or a hook
  cannot be swapped alone; the update climbs to its importer, and an entry
  with no accept handler reloads. Accept the import in the entry and
  re-render from the new module, or move the extra exports out.
- **Tailwind v4** scans only the sources it is pointed at. Add
  `@source "../.isotone/variants/**/*.{ts,tsx}";` (relative to the CSS
  file) or classes new to a variant render unstyled.
- **A sibling dev server** that aliases into another package sets
  `variants: { root: '../that-package' }` so both serve the same variants.
- **Routes** come from `window.location.pathname`. An app on a memory
  router sees `/` everywhere; leave `--route` off there.
- **Linters** should ignore `.isotone` (Biome: `"!.isotone"` in
  `files.includes`; ESLint: `{ ignores: ['.isotone/**'] }`).
