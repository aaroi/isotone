# Changelog

## Unreleased

- chore: the hosted demo deploys from `main` and gives each pull request a preview link (`demo.yml`)
- feat: removing an option from a selector's action dialog keeps the dialog open, marks the row "Removal requested" and moves focus to the next option, so several can be removed in a row
- feat: selector sections. A label prefix such as `Header > Logo size`, or a `section` field, puts the selector under a sticky, foldable Header heading with a count in the Variants panel, for host axes, knobs and file variants. `variant new --section` and `variant section` set it, and `variant list` has a SECTION column
  - compatibility: an existing label containing a spaced ` > ` (or ` › `) now splits into a section and a shorter label, so `Before > After` shows as *After* under a Before heading
  - compatibility: an existing `section` field, which used to draw only a hairline between neighbouring sections, now renders a heading and reorders the selectors: unsectioned ones first, then each section in the order its first selector appears
  - `section: ''` opts a selector out of every section and keeps its label whole
- feat: on touch, select mode says "Tap", shows no Shift, ⌘/Ctrl or ↵ hints, and explains that Done (or the crosshair) pauses selecting so the page can be used, with pins kept. Copy follows the last pointer used
- feat: a tapped element gets the floating composer under or over it rather than on top of it, and a finger no longer leaves a stray selection preview
- feat: on small screens the variants and feedback panels take turns, the variants panel stops at half the screen, and selecting hides the saved notes so the page can be reached
- fix: the dock and the floating composer stay above an on-screen keyboard, and the dock's height allows for safe areas
- feat: larger touch hit areas around the composer controls, reference removal, note delete and panel close
- fix: select-mode hints are never cut off. They read "Hold ⇧ to use the page" (touch: "Tap Done to use the page") and, beside a pinned element, "Click to pin more · ⇧ uses the page" (touch: "Tap to pin more · crosshair pauses"), each on one line at phone and desktop widths
- chore: the demo works on phones: touch copy in the tour, the cards scroll into view, larger touch targets, and a list layout and top bar that fit a phone
- change: `serveNotesRequest` and `serveVariantsRequest` answer 404 when `NODE_ENV` is `production`. This breaks any production use of them: a deliberate, access-controlled review deployment must now pass `{ allowProduction: true }` as the third argument to keep its endpoints working. See [the migration guide](docs/migration.md#request-handlers-are-off-in-production)
- fix: `init` and the serve setup page give static HTML a script loader that requests nothing outside localhost, and give Next a `next/script` tag behind `NODE_ENV === 'development'` in the root layout, instead of a plain tag that would make visitors' browsers request their own localhost if it shipped
- fix: the generated AGENTS.md section states the development-only rule
- feat: the README starts with a prompt for your coding agent, and says up front that Isotone is not an agent, an MCP server or an AI product
- feat: `init` prints a first run for the agent: two real, opt-in variants on the user's page and a short message telling them what to open and try. It is skipped once the project has variants or knobs
- feat: `isotone serve` serves `.isotone/knobs.json`, so range, colour and select knobs work on Next, static sites and any other dev server, not only Vite. Its panel has a Variants tool only while that file holds valid knobs, and an empty list there asks for knobs, not file variants
- feat: `variant list` lists knobs and names every knobs.json entry the panel would skip, and says when one is skipped for repeating an earlier knob's id
- fix: the generated AGENTS.md section names `variant use default` for going back
- chore: the demo tour ends with the same agent prompt as the README, with a Copy button, and keeps the install commands under "Or set it up yourself"
- feat: the update notice is one quiet line, "Isotone x.y.z is available". Its dialog shows the versions and **Ask agent to update**, with Copy prompt (a ready-to-paste agent request) and the raw command one click away
- feat: **Ask agent to update** files an update note in Feedback that the agent reads with `npx isotone --json`. The dev server builds it from its own update check (versions, command, directory, changelog) under an `update` field; the browser cannot supply them. At most one is open, a newer release updates it, and deleting it cancels the request. The CLI prints it with an `updateHint`, and AGENTS.md tells agents how to carry it out
- fix: an update note's request is checked wherever it is read: the command must be exactly the canonical `npm`, `pnpm` or `yarn` command for that version, and its directory inside the notes file's project, or the request is dropped. Its text is always rebuilt as "Update Isotone a → b", and the notes endpoint refuses edits to it
- feat: `checkForUpdates: 'note'` and `isotone serve --update-note` file the update note by themselves, once per version. There is deliberately no silent auto-install; `docs/updates.md` explains why
- feat: the demo's `?update-preview=1` works in the hosted demo too, and the pretend agent picks up the update note like any other
- feat: Blast mode. `npx isotone blast --for 45m --new` lets your coding agent keep acting on notes for a set time: it waits for new notes (a directory watch plus a cheap poll), hands out each batch in the `--json` record shape after a 3-second quiet time, prints a check-in every `--every` (default 5m, at most 9m) and "Blast session over" at the deadline with exit status 3. Running bare `npx isotone blast` again continues the session, and after the end only ever answers "over"; `--for` or `--new` starts the next session however recently the last one ended, and `--new` refuses to take over a live one; a note is handed out once unless the reviewer edits it. `--status`, `--stop`, `--extend` and `--stream` (one JSON line per batch, for background tasks and Claude Code's Monitor). Isotone still never runs an agent
- feat: the panel shows "Blast · 32 min left" beside the pill during a live session, with a filled dot while a note is in progress, and **Extend 15 min** and **Stop**. Without one it offers **Start Blast**, which copies a ready-to-paste prompt for a chosen duration. The Vite plugin and `isotone serve` serve the session at `/api/iteration/blast` with the notes endpoint's origin checks; the browser can only extend or stop a session. `serveBlastRequest` and `blastEndpoint` cover manual mounts
- feat: `npx isotone --reply <id> "<text>"` lets an agent ask about a note instead of guessing. The reply shows under the note in the panel, the note stays open, and editing it answers
- docs: `docs/blast.md`, and Blast guardrails in AGENTS.md and the section `init` writes: act only on what notes ask, one small reversible change at a time, no installs, pushes, deploys or deletions, ask when unclear, leave risky requests open, summarize at the end
- feat: the demo's `?blast-preview=1` shows a fictional session, and its pretend agent works through notes in batches like a Blast agent

## 1.1.3

- fix: a failed variant switch shows the server's reason, naming the variants, their groups and the shared file
- fix: deleting an active variant's folder by hand no longer makes every later switch fail with a 404
- fix: `variant sync` keeps working on files git does not track, where a second sync used to fail and leave the file stale
- fix: `variant promote` leaves the other variants in its group current
- fix: adding a file to or removing one from a variant now reaches server-rendered modules, which caused stale HTML and hydration mismatches, and reaches whole-file switching too
- fix: pinning an element could highlight a different one and move the composer to it, because the saved path also matched earlier elements. A path now matches only the pinned element
- feat: pinned elements carry their React components, labelled or headed ancestors, attributes and page position, so an agent can tell which element a note means
- feat: select knobs, which also set `data-knob-<id>` on `<html>`, and an `isotone:knob` event for code that draws for itself
- feat: `variant add` warns about exports that force a reload and about files another group already overrides

## 1.1.2

- feat: the shortcut opens feedback in select mode, and toggles select mode once it's open. Escape closes the panel; the shortcut no longer does

## 1.1.1

- feat: open feedback in select mode, and write the note next to the pinned element

## 1.1.0

- Overlay variants switch in the browser in React projects on Vite 6 or later.
  The plugin loads every version of an overridden file once, so a component
  switch is a re-render, and a switch that changes a hook or other
  non-component export reloads the page once. The pick lives in the tab's
  `?v=`, so links reproduce it and two tabs can compare variants.
  `variants: { live: false }` keeps whole-file HMR swaps.
- `isotone variant add <id> --new <file>` lets a variant add a file the
  project does not have.

## 1.0.10

- Hosted demo with a first-visit tour, and Enter finishes selecting (#15)

## 1.0.9

- docs: lead the README with how Isotone works, and show the variants panel (#14)

## 1.0.8

- feat: close either panel from a corner button

## 1.0.7

- feat: live notes, page scope and agent progress in the panel (#12)

## 1.0.6

- fix: stop the launcher flickering when hovered at the count badge (#11)

## 1.0.5

- fix: render saved-defaults notes like every other note (#10)

## 1.0.4

- Let split dev servers reach the notes API; show save results in the button (#9)

## 1.0.3

- feat: tell agents how to close a note from the CLI (#8)

## 1.0.2

- feat: polish the variants dialog, select mode and feedback field (#7)

## 1.0.1

- ci: tag successful npm publishes before registry propagation (#6)

## 1.0.0

- Put host-project setup and feedback handling first in the agent guide, and
  move Isotone source and design rules into maintainer documentation.
- Keep maintainer-only guides in the public repository rather than the npm
  archive, while retaining consumer guides and the README screenshot.
- Publish tested main commits automatically, with a committed version bump and
  npm provenance tied to the exact release commit.

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
