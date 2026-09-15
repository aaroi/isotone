# Changelog

## 0.3.2

- A variant's selector shows only on the route it was made for, active or
  not. 0.3.1 kept an active variant's selector on every page so it could be
  switched back from anywhere, which read as a selector with missing
  options; the place to switch it back is its own page.

## 0.3.1

The Variants tab, and everything behind it. Use this version rather than
0.3.0, which was published from an earlier build of the same branch: there a
variant switch reloaded the page, the panel could disable the host's Fast
Refresh by loading React first, and the overlay Variants tab had no Save as
defaults.

New

- Overlay variants for Vite hosts. Alternative copies of source files live
  under `.iso-iterate/variants/<id>/<repo-relative path>` with a
  `variant.json` manifest; the plugin's `load` hook serves the copy in place
  of the real file while that variant is active, and a switch reaches every
  open tab as a hot update, so React Fast Refresh swaps the component in
  place. `ISO_VARIANT=<id>` bakes one into a build, `ISO_VARIANT=<id>,<id>`
  one per group.
- One selector per decision. Variants that override the same file are
  alternatives of one selector; variants over different files are grouped
  with `--group <id>` (and `--group-label` for the selector's name). Each
  selector shows only on its route, and the reviewer can keep one pick per
  selector active at the same time; a switch hot-updates only the files
  that changed hands. `.iso-iterate/active.json` holds the set, and
  `POST /api/iteration/variants/active` takes `{ active: [ids] }`, refusing
  two variants over one file with 409.
- `iso-iterate variant` in the CLI: `list` (with a GROUP column), `new`
  (with `--note` to start from a note, `--group` and `--group-label`),
  `add`, `rm`, `path`, `group`, `use` (which replaces only the variant's
  siblings; `use default <groupId>` clears one group), `off`, `sync`,
  `promote`, `drop`. `promote` refuses a stale or conflicted copy unless
  `--force`.
- Host variants. `createVariantsSource({ axes, onChange })` from
  `iso-iterate/react` turns an app's own variant state into a source the
  panel renders; select, range and colour axes, conditional axes, sections,
  thumbnails. `mountIteration({ variants: source })` with no `endpoint` is a
  variants-only panel; `defaultTab: 'variants'` opens on that tab.
- Save as defaults in the Variants tab. On an overlay host it files one
  `[set-defaults]` note carrying `variants=<id>, <id>` (or
  `variants=default`) naming the pick in every selector on the route, for
  the agent to promote; a host source implements `saveDefaults` itself.
- `iso-iterate init` looks at a repo, recommends overlay, host or serve, and
  prints the setup for the chosen approach; `--yes` appends a paragraph to
  the repo's AGENTS.md.
- `iso-iterate/server` also exports `variantsResponse`,
  `serveVariantsRequest`, `listVariants`, `readActive` and `writeActive`.
- `iso-iterate --help`, `variant --help`, `init --help`, `serve --help`. An
  unknown option is an error instead of a silent listing, `serve` on a busy
  port says so and points at `--port`, and `variant drop` of an unknown id
  is an error.

Changed, for existing users

- The Vite plugin imports the panel after the page's `load` event instead of
  statically. The host's own `react-dom` now always evaluates first, so its
  Fast Refresh hook registers and hot updates re-render again; the panel
  appears a moment later than before.
- `mountIteration`'s `endpoint` is optional. With neither `endpoint` nor
  `variants`, nothing mounts.
- `variants` is on by default in `iteration()`. The dev server gains
  `/api/iteration/variants`, creates `.iso-iterate/active.json` under the
  Vite root (excluded from git through `.git/info/exclude`), watches the
  variants directory, and the panel grows a Variants tab as soon as a
  variant exists for the route. `iteration({ variants: false })` turns all
  of that off. `variants.root`, `variants.dir` and `variants.ignored` tune
  it.
- `.git/info/exclude` gets one iso-iterate comment header, however many
  patterns land under it.

## 0.2.0 and earlier

Notes only: the panel, the Vite plugin, `iso-iterate serve`,
`iso-iterate/server`, and the notes CLI. See the git history up to the
`release: 0.2.0` commit.
