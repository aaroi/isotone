# Changelog

## 0.4.2

- Clarify that existing projects must move the whole local data directory,
  including knob definitions and active variant state.
- Remove the obsolete overlay selector management client after its server
  endpoint was retired.
- Keep `lastSave` scoped to the note just saved while the panel independently
  reports older unsynced notes.

## 0.4.1

- Keep long feedback in the composer with a clear 4,000-character limit; older
  overlong or rejected offline notes no longer block later notes from syncing.
- Save notes on HTTP development hosts where `crypto.randomUUID` is unavailable.
- Remove the unused selector deletion endpoint and its direct `knobs.json` write.
  Selector removal remains a feedback request for the coding agent.
- Replace the automatic project migration command with a short manual guide.

## 0.4.0

- Rename the package and CLI to Isotone (`isotone`), with a previewable migration
  command for existing projects and automatic recovery of browser drafts and
  offline feedback. See `docs/migration.md` before changing an existing install.
- Add quiet automatic npm update checks, explicit `check-update` instructions,
  package-manager-aware upgrade commands, and configurable opt-out.
- Add `panel: false` for manual Vite mounts while retaining local endpoints.
- Instrument is the single design, with shared light/dark materials, raised
  selection states, compact feedback tags, consistent controls and scrolling fades.
  Feedback and Variants open independently above one horizontal pill.
- Add `theme: 'auto' | 'light' | 'dark' | 'system'`. Automatic detection follows
  live host background changes without remounting or losing state.
- Add multi-element feedback, editable notes, durable drafts, selector references,
  contextual selector actions, and cancellable removal requests.
- Add a configurable keyboard shortcut, keyboard pinning of focusable page controls,
  reduced motion, interruptible panel movement and bounded list animation.
- Simplify setup with detected integration instructions, `init --yes`, and structured
  `--json` output. The Vite plugin now brings its own React runtime for every framework.
- Make CLI/server exports importable without React or Vite. Bundle the standalone
  panel with the production React runtime; keep all automatic injection dev-only.
- Preserve offline notes across retries, lost responses and concurrent edits. Use
  atomic, serialized file updates and refuse to overwrite corrupt data.
- Validate variant manifests and paths, reject missing promotion sources, and show
  activation failures instead of silently losing rapid selections.
- Bound request bodies, check request origins, and keep the standalone server on loopback.
- Reduce DOM descriptor work, selector graph traversal and variant polling costs.
- Add a fictional demo, design documentation and package-consumer release checks.
- Finalize Clean Highlight, inline feedback references, smaller composer controls,
  consistent option weights, scrolling insets and brief icon/overflow tooltips.
- Fix nested-root hover expansion, composer sizing after context changes, and
  transient launcher state on hidden routes.
- Keep request deadlines active while reading response bodies and validate save
  acknowledgements before clearing offline feedback.
- Serialize variant edits across agent processes to preserve concurrent additions.
- Make `init --help` read-only even when combined with setup flags.

0.4.0 behavior changes: notes over 4,000 characters are rejected rather than
silently cut, and the standalone `serve` command binds to loopback only; it no
longer accepts `0.0.0.0`.

## 0.3.4

- The Vite plugin's mount loader goes in the document `<head>` instead of
  before `</body>`, and the panel's host is appended at runtime, not written
  into the served HTML. A whole-document React Router app hydrates the body,
  so a stray `<script>` there made React report "Encountered a script tag
  while rendering React component", discard the server tree and drop the host
  whenever hydration failed, which a browser extension that has already
  stuck a node into the page reliably triggers. `<head>` is never part of the
  body React hydrates, so the loader is invisible to hydration whatever the
  extension does.
- `mountIteration` now watches `<html>` and re-appends the host (shadow root
  and panel state intact) if a full-body re-render evicts it, instead of
  leaving a blank corner until the next reload or mounting a second copy.

## 0.3.3

- The Notes tab lists every note from every page, newest first, with the
  page named on each row, so feedback accumulates in one place whatever
  page is open. The notes endpoint answers `?all=1` for that; `?route=` and
  the agent's pending list are unchanged.
- A variant route ending in `/*` covers the base page and every page under
  it.

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
  under `.isotone/variants/<id>/<repo-relative path>` with a
  `variant.json` manifest; the plugin's `load` hook serves the copy in place
  of the real file while that variant is active, and a switch reaches every
  open tab as a hot update, so React Fast Refresh swaps the component in
  place. `ISOTONE_VARIANT=<id>` bakes one into a build, `ISOTONE_VARIANT=<id>,<id>`
  one per group.
- One selector per decision. Variants that override the same file are
  alternatives of one selector; variants over different files are grouped
  with `--group <id>` (and `--group-label` for the selector's name). Each
  selector shows only on its route, and the reviewer can keep one pick per
  selector active at the same time; a switch hot-updates only the files
  that changed hands. `.isotone/active.json` holds the set, and
  `POST /api/iteration/variants/active` takes `{ active: [ids] }`, refusing
  two variants over one file with 409.
- `isotone variant` in the CLI: `list` (with a GROUP column), `new`
  (with `--note` to start from a note, `--group` and `--group-label`),
  `add`, `rm`, `path`, `group`, `use` (which replaces only the variant's
  siblings; `use default <groupId>` clears one group), `off`, `sync`,
  `promote`, `drop`. `promote` refuses a stale or conflicted copy unless
  `--force`.
- Host variants. `createVariantsSource({ axes, onChange })` from
  `isotone/react` turns an app's own variant state into a source the
  panel renders; select, range and colour axes, conditional axes, sections,
  thumbnails. `mountIteration({ variants: source })` with no `endpoint` is a
  variants-only panel; `defaultTab: 'variants'` opens on that tab.
- Save as defaults in the Variants tab. On an overlay host it files one
  `[set-defaults]` note carrying `variants=<id>, <id>` (or
  `variants=default`) naming the pick in every selector on the route, for
  the agent to promote; a host source implements `saveDefaults` itself.
- `isotone init` looks at a repo, recommends overlay, host or serve, and
  prints the setup for the chosen approach; `--yes` appends a paragraph to
  the repo's AGENTS.md.
- `isotone/server` also exports `variantsResponse`,
  `serveVariantsRequest`, `listVariants`, `readActive` and `writeActive`.
- `isotone --help`, `variant --help`, `init --help`, `serve --help`. An
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
  `/api/iteration/variants`, creates `.isotone/active.json` under the
  Vite root (excluded from git through `.git/info/exclude`), watches the
  variants directory, and the panel grows a Variants tab as soon as a
  variant exists for the route. `iteration({ variants: false })` turns all
  of that off. `variants.root`, `variants.dir` and `variants.ignored` tune
  it.
- `.git/info/exclude` gets one isotone comment header, however many
  patterns land under it.

## 0.2.0 and earlier

Notes only: the panel, the Vite plugin, `isotone serve`,
`isotone/server`, and the notes CLI. See the git history up to the
`release: 0.2.0` commit.
