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

A range needs bounds that are valid designs at both ends (padding 8–32px in 2px
steps, not 0–1000px), a positive `step` at the decision's precision, a default
on a step between them, and a unit such as `px`, `%` or `ms` (a bare 0–1 range shows as a
percentage; `unit: ''` keeps the raw number). Check every control at its
minimum, maximum and reset, and keep the source fallback and default in sync.

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
`.aws/` or `.ssh/`) unless given `--force`. Even then, the dev server serves a
copy only where it would serve the real file: what `server.fs.deny` refuses
(`.env`, keys, `.git/`) it refuses for every copy, and no copy is served at its
own path, even from a `variants: { dir }` outside `.isotone/`. `variants: { ignored: true }` keeps
the variants directory local. The active pointer, `.isotone/active.json`, is
local and never committed: like the notes file, it goes into the repository's
`.git/info/exclude` when the dev server starts and when the CLI's notes and
`variant` commands run. `ISOTONE_VARIANT=<id>` (a comma-separated list) bakes
variants into a `vite build` for a preview.

**Keeping copies current.** A copy records the version of the real file it was
made from and reads as stale once that file moves on. In a Git repository that
version is kept in Git's object store; outside one, in the variant's own
`.isotone-base/` directory, so a project without `git init` works the same,
before and after one. Git's object store keeps only a version the current
commit holds; any other (an uncommitted or untracked real file, a repository
with no commits) is kept in `.isotone-base/` too, so it is committed with the
variant, teammates can sync it, and `git gc` never drops it. `variant sync <id>` merges the real file's changes in,
untracked files included; it needs Git installed and says so when it is not.
Where both sides changed the same lines the copy gets conflict markers: `sync`
exits 1, `variant list` counts them under CONFLICTS, and the copy cannot be
shown until they are resolved: `variant use` refuses it, the panel shows it disabled, and if it
was active the real files show meanwhile (it returns once they are). A copy made outside a repository by Isotone 1.5.0 or earlier has no
recorded version: `variant list` names it under NO BASE, since nobody knows
whether its real file changed, and `sync` cannot merge it (unless the copy still
matches the real file). Compare it with the real file by hand, then `variant
promote <id> --force` when it should win.
After `variant promote <id>`, the other variants in its group stay available and
stop reading as stale: they are alternatives to what was promoted.

### What the host needs

- **Framework HMR.** Keep the host's Vite framework plugin (`@vitejs/plugin-react`
  or its wrapper; Vue and Svelte their own): without an accept boundary, a
  switch reloads. A `.vue` or `.astro` file always reloads ([Vue components](#vue-components)).
- **Tailwind v4** scans only the sources it is pointed at. Add
  `@source "../.isotone/variants/**/*.{ts,tsx}";` (relative to the CSS
  file, with your components' extensions; `init` prints the line) or classes
  new to a variant render unstyled.
- **A sibling dev server** that aliases into another package sets
  `variants: { root: '../that-package' }` so both serve the same variants.
- **Routes** come from `window.location.pathname`; on a memory router (`/`
  everywhere) leave `--route` off.
- **Linters** should ignore `.isotone`, since a copy's imports resolve from the
  real file (Biome: `"!.isotone"` in `files.includes`; ESLint:
  `{ ignores: ['.isotone/**'] }`). `init` says so when it finds a config.

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
invalid entry is skipped, and so is a knob whose id a file variant group already
has (a lone variant's id is its group's); `npx isotone variant list` names each one. Knobs work
with `isotone serve` too. A value reaches the page as `--knob-<id>` on `<html>`,
unit appended, so the source reads it with the committed default as fallback:

```css
mask-image: radial-gradient(ellipse, black var(--knob-fade-from, 0%), transparent 100%);
```

A knob's value applies only on the routes its `route` names, where its control
is. On any other page, after a full load or a client-side navigation, its
property and attribute come off and the source's default shows; the reviewer's
value stays stored and returns with its route. A knob for a shared component
that should change on every page leaves `route` out.

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
`{ id, value }` (`null` when the knob returns to its default or leaves the page
with its route):

```js
document.addEventListener('isotone:knob', ({ detail }) => {
  if (detail.id === 'tick-style') chart.setTicks(detail.value ?? 'lines');
});
```

The event only fires while the panel is mounted, so keep the committed default in
the source. Knob values live in the reviewer's browser, never in a link
([how](#per-tab-or-shared)); **Make default** files the moved ones in its
`[set-defaults]` note (`payload.knobs` as `fade-from:40`).

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
- A selector without a section that is named after one, such as a file variant
  group labelled `Pricing card` beside a `Pricing card > Accent` knob, joins it.
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
shows a SECTION column: as the panel draws `variant list <route>`, or every
route's selectors together without one.

## The Variants panel

Each option's chevron (or a right click) offers feedback on it, keeping only it,
or removing it. Keep, remove and **Make default** file a request note
([what each asks](agent-guide.md#requests-from-the-variants-panel)); the
selector stays as it is until the agent changes the project.

### Hold to compare

While a pick differs from its default, hold **Compare** beside Make default, or
the key under Escape (` or §) with the panel open or closed, to see the page
with every selector at its default; let go and the picks come back as they were.
Nothing is saved, filed or sent to the server, and the selectors that switched
show their defaults until you let go. Only what switches instantly takes part:
knobs, file variants switched live whose exported hooks and values match, and
host selectors whose source [opts in](#a-host-source). A selector that needs the
dev server or a reload keeps its pick: the bar reads “Showing defaults, except
Hero” and Compare's tooltip says why. A quick click only says “Hold to compare”.
`compareShortcut` on `isotone()` or `mountIsotone` picks another key
(`{ code: 'KeyC', alt: true }`; `code` may list several), or `false` turns the
key off.

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
  compare: true, // onChange below keeps previews out of the URL
  onChange: (selections, change) => {
    document.documentElement.style.setProperty('--card-radius', `${selections['card-radius']}px`);
    if (change?.preview) return; // a held Compare: show it, store nothing
    // Sync the URL or storage here, if the app does.
  },
});
mountIsotone({ variants: source, defaultTab: 'variants' });
```

```css
.card { border-radius: var(--card-radius, 11px); }
```

`selections` maps each axis id to a string; a range's value is a numeric string,
and `onChange` must apply it to the app's state or styles. A select option with
`disabled: true` shows but cannot be picked. With `compare: true`
the panel offers [Compare](#hold-to-compare) for these selectors: while the
reviewer holds it, `onChange` gets the defaults with `{ preview: true }` as its
second argument, then the picks with `{ preview: false }`. Apply both, but keep
a preview out of the URL, storage and any server. Without `compare: true` the
source has no preview and Compare leaves its selectors out. The axis types
(`VariantAxis` and the select, range and colour axes) come from `isotone/core`.

### Beside knobs and file variants

Given the notes endpoint of the Vite plugin or `isotone serve`, `mountIsotone`
also reads that server's knobs (and, on Vite, its file variants) and lists them
after the source's selectors, so `.isotone/knobs.json` works in a host app too:

```ts
mountIsotone({ variants: source, endpoint: 'http://127.0.0.1:4123/api/isotone/notes' });
```

Any other notes endpoint gets no knobs unless `variantsEndpoint` names where they
are. A knob with the id of one of the source's selectors is left out, and the
Variants view says so: give it an id of its own. Compare holds every selector that can switch at once, whichever source owns
it. **Make default** files one `[set-defaults]` note naming every pick, the
source's own in `payload.selectors` for the agent to make the defaults in code.
A source's own `saveDefaults` still runs first with its picks; the note names
them too, since a route keeps one open `[set-defaults]` note and this one
replaces any that `saveDefaults` filed.

To show several sources in one panel yourself, for an `IsotonePanel` or two
variant systems of your own, combine them; earlier sources keep a shared axis
id, and each pick, preview and request reaches the source that owns it:

```ts
import { combineVariantsSources } from 'isotone/core';

mountIsotone({ variants: combineVariantsSources(themeSource, layoutSource) });
```

### Definitions, errors and Compare

A host that manages its own definitions can use the source's `manage(action)`:
its `onManage(axes, selections, action)` callback persists edited definitions or
rejects to leave them unchanged (filing a note never calls it). A custom source
can expose `getError(): string | null`, notifying subscribers on change, to show
load or update failures in the panel. To offer Compare, a custom source
implements `preview(selections)`: show those axes' values over the stored ones
without storing or notifying, and `preview(null)` shows the stored ones again.
It may return the axis ids it showed, when it could not show them all. An
optional `canPreview(axisId)` returns `true`, or `false` or a reason
(`'switches by reloading the page'`) for an axis that cannot switch at once.
Without `preview` the panel offers no Compare. An optional `getNotice()` returns
a short note the Variants view shows above the selectors, or `null`; it is read
as the view opens and kept until it closes.

## How switching works

### Per tab or shared

Whether a pick stays in its tab depends on the setup, and `npx isotone init`
names the one it finds:

| Setup | File variants | A link with `?v=` |
| --- | --- | --- |
| React on Vite 6 or later | Per tab, in the tab's URL ([live](#live-switching)); CSS and files served whole follow every tab | Opens those variants |
| Vite 5, Vue, Svelte or another host without React, or `variants: { live: false }` | Shared by every tab and browser, through `.isotone/active.json` ([whole files](#whole-file-switching)) | Not applied; the Variants panel says so |
| `isotone serve` (Next.js, other dev servers) | None: only the Vite plugin serves them. In Next.js `variant new` and `use` refuse without `--force`; the other `variant` commands warn | — |
| A host `VariantsSource` | The app's own: per tab when it keeps picks in the URL. File variants listed beside it ([on Vite](#beside-knobs-and-file-variants)) switch as in the rows above | The app's own selectors as the app decides; file variants as above |

Knob values stay in the browser in every setup: the panel keeps them in
`localStorage` (`isotone:knobs`, per origin), never in the URL, so a link does not
carry them. A page reads them when it loads; an open tab does not follow moves made
in another, and its next move saves its own whole set over them.

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
navigation, so a copied link opens the same variant and two tabs can compare.
Picking Default writes `?v=<group>:default`, so a tab on Default keeps the real
files while another tab tries a variant. Each pick also goes to
`.isotone/active.json`, which the agent reads and a tab without `?v=` follows: a
fresh tab opens on the latest pick, and `variant use` switches it. Once you pick
in a tab, it keeps its pick; open the page without `?v=` to follow again. A
stylesheet and the other files served whole follow `.isotone/active.json` in
every tab ([whole-file switching](#whole-file-switching)).

Every version of a dispatched file loads, so a copy runs even while off: a
global stylesheet it imports applies everywhere, and a syntax error in it breaks
pages importing the real file.

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
On Vite 6 and later, `<file>?isotone=<id>` serves one copy whole without
switching anything, to check that it compiles; Vite 5 answers 404.

### Vue components

Vue, Svelte and Astro compile a component into several modules, and the page
asks the dev server for each part on its own (`Card.vue?vue&type=style…`,
`Card.svelte?svelte&type=style…`, `Card.astro?astro&type=style…`). The plugin
swaps the whole file and leaves each part to the framework's plugin, which
compiled the copy, so a variant renders its own template, script and styles.
Such a variant switches whole files: it follows `.isotone/active.json` in every
tab, and a pick has no `?v=` link.

- **Vue:** a switch, or an edit of the active copy, reloads the page, since
  plugin-vue's own hot update reads the real file from disk.
- **Svelte:** a switch is a hot update, as an edit would be.
- **Astro:** the page reloads, as after any edit of an `.astro` file.

A variant of a `.ts` or `.css` file still switches as a hot update.
`<file>?isotone=<id>` answers 404 for these components, since their parts come
from the page's compile: check a copy by switching to it with
`variant use <id>`.

### Server rendering

Server rendering (React Router's framework mode, Remix on Vite) follows
`.isotone/active.json`, since the server cannot tell tabs apart; a tab whose components differ hydrates from it and switches right
after. A link whose `?v=` differs in a fixed export saves its set as the default
and reloads once; later reloads hydrate with a recoverable mismatch, so two tabs
never fight over the default.
