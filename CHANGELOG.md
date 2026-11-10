# Changelog

## Unreleased

### Fixed

- **Buttons with words answer a press like the icon buttons do.** Done, Make default, segments and page chips sink slightly while pressed.
- **Picks and pins move instead of jumping.** Clicking another segment or thumbnail slides the raised key across to it, swatches and thumbnails sink under a press, a held slider knob grows, the saved message in the defaults bar crossfades, and new pins and composer references settle into place. Keyboard changes stay instant.

## 1.3.4

### Fixed

- **Several checkouts no longer lose notes to each other's `isotone serve` without a word.** When one checkout's `serve` holds the port, another checkout's `serve` now says which checkout has it, and `npx isotone` and `isotone blast start` warn that this checkout's panel saves its notes there. `serve` reports its project and notes file at `GET /api/isotone/server`, and the integration guide shows how to give each checkout its own port.
- **The default option's dot is quieter in the dark theme.** It is now dimmer than the option labels, so it marks the default without pulling the eye from the choice you made.

## 1.3.3

### Fixed

- **Segmented selectors that need more than one row look right again.** When the options fit side by side they stay one capsule. When they don't, they wrap into balanced rows with aligned columns, a short last row stretches to fill, and labels truncate rather than stack. The track's corners follow the capsules inside instead of ballooning into a stadium.
- **Changing a pick no longer moves the Variants panel.** The "Make default" bar floats over the foot of the panel instead of pushing the selectors up, and the list scrolls far enough to show its last row above it. If the bar would cover the control you just used, the list brings that control clear of it.
- **A segment's hover chevron no longer overlaps its label.**
- **Closing a panel with the pointer no longer leaves a focus ring on the pill's corner.** Focus still returns there, with the ring shown only after keyboard use.

## 1.3.2

### Fixed

- **The panel reads more clearly in both themes, with a softer, rounder look.** Panels are rounded cards with layered shadows, and buttons, chips and segmented choices are capsules. Send is the one coloured control, and the count on the pill shares its colour. Labels are lighter, sliders are round knobs on a clear groove, and the default option's dot sits beside the label so the hover chevron no longer hides it. Layout, behaviour and the light and dark themes are otherwise unchanged.
- **A selector's action dialog no longer covers its heading on a short panel.** When it fits neither above nor below the heading, it opens on the roomier side and scrolls there.
- **Scrolled notes no longer show through under the page chips** in the feedback panel.

## 1.3.1

- Merge pull request #42 from aaroi/prompt-followup

## 1.3.0

### What you need to know

- **Node.js 22 or later** is required (`engines.node` is `>=22`; Node 20 reached end of life in April 2026).
- **The `Iteration` names are now `Isotone`.** The Vite plugin is `isotone()` (`import { isotone } from 'isotone/vite'`); `iteration()` still works as a deprecated alias; it will be removed in 1.5.0. `IterationPanel` → `IsotonePanel`, `mountIteration` → `mountIsotone`, `serveIteration` → `serveIsotone`, and every `Iteration*` type likewise (`IsotoneNote`, `MountIsotoneOptions`, …). Only import names change.
- **Notes live in `.isotone/notes.json`** (Blast: `.isotone/notes.blast.json`). The CLI, the Vite dev server and `isotone serve` move an old `.iteration-feedback.json` there on first run and say so (until 1.5.0); if the old file reappears, its notes are merged in and it is removed. A `file` option or `--file` path is never moved. **The endpoints are now `/api/isotone/*`**, which matters only if you call them yourself or pass a full `endpoint` URL to `mountIsotone`.
- **Isotone works only on the machine running the dev server.** A Vite server started with `--host` still serves the app to other devices, but without the panel, and Isotone's endpoints answer them 403.
- **`isotone/server` is removed.** Apps that wired Isotone into their own routes run `npx isotone serve` and add the loader tag `init` prints.
- **Fewer exports.** Each subpath exports only what the docs use, and `isotone/react` no longer repeats `isotone/core`. If a name goes missing, [Removed](#removed) gives its replacement.
- **`--json` output changed.** It is one compact line; pinned elements are only under `elements` (read `elements[0]` where you read `element`); `null` fields are left out; `reply.about` is gone. `--done`, `--undone`, `--working` and `--reply` with `--json` print an array of the notes they changed. [docs/note.schema.json](docs/note.schema.json) is the schema.
- **`--done` refuses while nothing changed** since the note was written or since `--working` on it, and closes nothing. Run `--working <id>` before each fix; add `--force` for a note that needed no change.
- **Re-run `npx isotone init --yes` after upgrading.** The `AGENTS.md` section is now short, sits between `<!-- isotone:start -->` and `<!-- isotone:end -->`, and points to `node_modules/isotone/docs/agent-guide.md`. Later runs rewrite only the text between the markers; an unmarked 1.2.x section is replaced, and `init` prints what it removed.

### Security

- Live variant switching served `?isotone=` for any project file around Vite's `server.fs.deny`, so `/.env?isotone=_base` returned the file to other localhost pages. It now answers only for files a variant tracks. Isotone 1.2.x has the same hole; upgrade.
- The notes file, the Blast session file and `.isotone/` are added to Vite's `server.fs.deny`.
- A file tracked with `variant add --force`, such as `.env`, still obeys `server.fs.deny` when live switching asks for one of its versions.
- `*.test` no longer counts as a local `Host`, as in Vite, because a hostile resolver can point it at `127.0.0.1` to read notes from `isotone serve`.
- The notes endpoint refuses a route that does not start with `/`, and `npx isotone` labels the route heading and payload lines as browser input too.
- Endpoints refuse a `Host` other than `localhost`, `*.localhost` or a loopback address, which stops DNS rebinding; on Vite, add other names to `server.allowedHosts`. A request a tunnel or proxy forwards for another machine counts as that machine.
- `isotone serve` binds to `127.0.0.1`, and neither panel bundle loads into other websites' `<script>` tags.
- Every POST needs a JSON content type (415 otherwise), which a cross-site form cannot send. Note IDs a host chooses must be 1–64 letters, digits, `-` or `_`, not starting with `-`.
- `doneCommand` is shell-quoted, and `--json` passes on only the note fields Isotone knows, so a page or a hand edit cannot plant a command for the agent.
- Routes are capped at 2,000 characters and a notes file at 10,000 notes.
- `variant add` refuses Git-ignored files and files that look like secrets (`.env*`, keys, `.npmrc`, `.aws/`, `.ssh/`, …) unless the user approves `--force`.
- Note output strips terminal control characters and quotes reviewer text as `> ` lines, so note content cannot pose as CLI output.

### Fixed

**Notes and the CLI**

- Notes a still-running 1.2 dev server writes to `.iteration-feedback.json` during the upgrade are merged into `.isotone/notes.json` on the next CLI run or dev server start, and the moved file is kept out of Git right away.
- Concurrent writers no longer lose notes, and a lock or temporary file left by a crashed process no longer leaves the store "busy"; lock and temporary files are kept out of Git.
- Commands run from a subdirectory use the nearest `.isotone/notes.json` up to the Git root and name it on stderr.
- `--done`, `--undone` and `--working` take several IDs (`a b` or `a,b`) and change all or none; `--done a b` used to close only `a`.
- A full note ID wins over a prefix, `--all` wins over `--days`, and `--working` refuses a closed note.
- `--reply` accepts text starting with a dash, "Unknown option" errors name the `--help` to read, and `| head` no longer prints an EPIPE stack trace.
- `init` after an upgrade says "Already set up" instead of asking for the plugin again, and asks to rename `iteration()` if the config still uses it (`init --json` adds `integration`).
- `init` prints the install command for your package manager and explains that a `file://` page never loads the panel.
- On Windows, in a project whose path Node names with an 8.3 short name (`C:\Users\RUNNER~1\…`) while Git prints the long one, Isotone's files are kept out of Git again and `--done` no longer counts its own write to the notes file as the fix.
- On Windows, saving notes while the CLI or another process is reading the file no longer fails with EPERM; the save waits a moment and retries.

**Blast**

- A busy notes file or a wall-clock change no longer makes a waiting run exit 1 or overrun `--every`.
- `blast start 2024-recap` scopes to that route, and a closed then reopened note is handed out again.
- Each batch now ends with the viewport rule and "run `--done` as its own command", like the loop `blast start` prints.

**Variants**

- `variant drop x --dry-run` deleted `x`; every `variant` subcommand now rejects unknown flags and extra arguments before changing anything.
- `variant use` refuses a file another group's active variant overrides, and `promote` replaces all of a variant's files or none.
- `variant add` records a file under its real spelling, so a case mismatch on macOS or Windows still overrides it.
- On Windows, switching variants updates the page without a manual reload.
- On Windows, overrides apply in a project reached through an 8.3 short name, as Vite names its modules by the long one.
- `variant sync` exits 1 on a conflict, `variant list` (`conflicts` in `--json`) and `--done` name copies with conflict markers, and in live mode such a copy no longer breaks the real page.

**The panel**

- In the Variants panel, a section header after a closed section sits as close as one closed header to the next, whether its own section is open or not.
- The note list keeps your place when a note is deleted or edited, or an agent marks one working or done.
- The note list is one Tab stop: arrow keys, Home and End move between notes and their delete buttons.
- Keys, focus, input and wheel events inside Isotone no longer reach the app's handlers, and Escape in the app's own fields no longer closes Isotone.
- In select mode, clicking pins an element without pressing it, so menus that open on press stay closed.
- Closing a panel returns keyboard focus to the launcher instead of the page.
- Right-to-left pages and inherited page styles no longer leak into the panel.
- On React 19, notes record the pinned element's source file and line again.
- Outlines and the composer follow an element that moves without a scroll.
- `/about/`, `/about` and `/about?tab=2` are one page, as in the CLI.
- With many selectors, the first key after a click no longer stalls for 0.2–0.4 s.
- Smaller fixes: long option labels, Windows high contrast, SVG selectors, screen-reader names, edits during a save, and phone Done.

### Changed

**Notes and the CLI**

- `npx isotone` lists every open note however old; `--days <n>` and `--all` add closed ones.
- One route pattern everywhere: `/items` is that page, `/items/*` also pages under it, `/items*` any route starting with `/items`. In the panel's `rule.visible` and `rule.hidden`, write `/items/*` where a bare `/items` used to cover sub-pages.
- `--done`'s change check uses a Git snapshot taken by `--working`, so staged edits, reverts and commits count.
- After `--done`, Isotone names variants that copy files changed since the note, with the `variant sync` command that brings the fix in.
- Editing a note an agent already closed reopens it.
- New: `npx isotone --version` and `variant list --json`. `--help` is regrouped and ends with the paths of the installed guides.
- While another writer holds the notes file, the endpoint answers 503 at once and the panel retries.

**Blast**

- A waiting `npx isotone blast` checks in after 90 seconds instead of 5 minutes, to fit a two-minute command timeout. Use `--every off` in a background task.
- A batch holds at most ten notes and ends with a one-line guardrail and the next command, so the rules survive context compaction.

**Package and panel**

- Every subpath has a `default` export condition and the binary is `dist/bin.js`; run `npx isotone`, not a `dist/` path.
- The package is about 380 kB to download instead of 836 kB, and the `isotone/vite` and `isotone/serve` types no longer need React.
- The docs are shorter, with each topic in one place; the package no longer ships the repository's `AGENTS.md`.
- The panel opens and types fast with hundreds of selectors or notes (about 1–2 ms a keystroke on 500 selectors, from 100 ms).
- Single-choice options are radio groups driven by arrow keys; an option's actions open with Shift+F10 or the context-menu key.

### Removed

- The `iso-iterate` migration guide and the panel's one-time move of `iso-iterate` browser storage.
- `isotone/server` (`serveNotesRequest`, `serveVariantsRequest`, `notesResponse`, `variantsResponse`, `readNotes`). Use `npx isotone serve`, and `npx isotone --json` to read notes from a script.
- From `isotone/react`: everything but `IsotonePanel`, `mountIsotone`, their option types, `IsotoneTheme`, `IsotoneShortcut`, `IsotoneStoreConfig`, `createVariantsSource`, `VariantsSource`, `VariantAxis` and `VariantSelections`. Mount the panel instead of `VariantsView`, `PANEL_CSS` or `ensurePanelStyles`; import note and axis types from `isotone/core`.
- From `isotone/core`: the panel's internals (`createIterationStore`, `describeIterationElement`, `isRouteVisible`, selection, overlay and knob helpers). It keeps the note record types, `RouteGateOptions`, `createVariantsSource` and the axis types.
- `DEFAULT_PORT` and `readBundle` from `isotone/serve`, `withNativeFetch` from `isotone/vite`, and the unused `title` of `VariantsSource` and `createVariantsSource`.
- `reply.about` from the note record; read `reply.answered`.
- `npx isotone blast --stream` (use `--every off`) and the 1.2.0 flags `--for`, `--new`, `--status`, `--stop` and `--extend` (use `blast start 45m`, `blast`, `blast status | stop | extend 15m`).

## 1.2.4

- feat: drag the dock's left edge to change its width, and the top edge of the top open panel to change that panel's height. With both panels open, the gap between them moves the split. The arrow keys resize a focused edge, Shift takes bigger steps, and Home or a double-click restores the default. Sizes are remembered per browser; phones keep their one-panel layout

## 1.2.3

- feat: every select option, thumbnail and colour swatch has its own actions (from #37). A chevron in its corner, shown on hover or keyboard focus and always on touch screens, or a right click opens the selector dialog scoped to that option: Feedback on this option, Keep only this, Remove this option. Opening it never changes the selection, and it opens below the option when it cannot fit above. Its title reads as one line, the option then the selector ("Compact Spacing")
- change: Keep default only is back in every selector's dialog. On the Default row, Keep only this files the same `keep-default` request
- fix: a closing selector action dialog keeps its place until its fade ends, instead of jumping to the panel's top mid-fade
- change: the selector heading chevron is a touch quieter at rest
- docs: AGENTS.md, the `init` guidance and the variants guide tell agents what a `[keep-option]` note asks for

## 1.2.2

- feat: custom colours open a picker in the panel's own popup material instead of the browser's native colour dialog
- feat: Save as defaults becomes Make default, beside a count of the changed picks, and confirms with “Default request saved”
- feat: the variants panel marks each selector's source default with a dot on its option or swatch and a tick on its range
- feat: any option or swatch can be kept as the only choice and made the default from its row in the selector dialog, which replaces Keep default only for those selectors. Notes carry a `keep-option` variant action

## 1.2.1

- change: Blast commands are subcommands. `npx isotone blast start 45m [</route>]` starts a session, prints the loop and the guardrails, and exits, so the user's prompt is one line and the agent reads no guide. Bare `npx isotone blast` waits for the next batch and never starts a session. `status`, `stop` and `extend 15m` replace the flags. The 1.2.0 flags still work: `--for 45m --new` starts and waits in one run
- feat: `npx isotone blast --every off` waits for a batch or the end only, with no check-ins, for an agent that runs it as a background task. An idle session then costs the agent no turns
- change: `start` refuses while another agent is in a live session and replaces an abandoned one; `--for` on a live session no longer continues it with a notice, and a run after the end no longer suggests starting again (`status` does)
- change: Blast JSON is compact, one object per line. `--every` is per waiting run and no longer stored in the session file, and an end's `reason` is `time`, `stopped` or `none` (was `stopped-cli` and `removed`); `stillOpen` on an end has the same shape with `--stream` and `--json`
- docs: the Blast sections of AGENTS.md and the one `init` writes shrink to a pointer at `blast start`, which every agent session loads

## 1.2.0

- chore: the hosted demo deploys from `main` and gives each pull request a preview link, through Vercel's Git connection
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
- change: `serveNotesRequest` and `serveVariantsRequest` answer 404 when `NODE_ENV` is `production`. This breaks any production use of them: a deliberate, access-controlled review deployment must now pass `{ allowProduction: true }` as the third argument to keep its endpoints working (`isotone/server` was later removed)
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
  - Blast is an agent and CLI feature only: you start it by asking your agent (`docs/blast.md` has a ready-to-paste prompt), and the panel has no Blast controls. The session lives in a local state file beside the notes, read and written only by the CLI; no dev server endpoint serves it
- feat: `npx isotone --reply <id> "<text>"` lets an agent ask about a note instead of guessing. The reply shows under the note in the panel, the note stays open, and editing it answers
- docs: `docs/blast.md`, with a ready-to-paste prompt for starting a session, and Blast guardrails in AGENTS.md and the section `init` writes: act only on what notes ask, one small reversible change at a time, no installs, pushes, deploys or deletions, ask when unclear, leave risky requests open, summarize at the end

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
