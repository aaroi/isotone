# Changelog

## Unreleased

## 1.6.1

### Fixed

- **On Windows, a variant copy's source map names the copy with forward slashes**, like every other path Isotone records, so a pinned element's `source` reads the same on every platform.

## 1.6.0

### Added

- **Isotone tells you whether a pick stays in its tab.** `init` names how picks switch in your project and what would change it: per tab, with `?v=` links, in a React app on Vite 6 or later; shared by every tab on Vite 5 or without React; knobs only with `isotone serve`. `init --json` has it as `switching`, and the first run has the agent pass it on. The variants guide has a table of what each setup does, including that knob values stay in the browser and never travel in a link.
- **The Variants panel says when a link's `?v=` isn't applied.** Where picks are shared by every tab, a link that asks for other variants used to show the current ones without a word; the panel now names what the link asked for. A `VariantsSource` of your own can show a note there too, with the optional `getNotice()`.
- **`variant new` and `use` refuse in a Next.js app**, where nothing serves file variants, instead of succeeding with a warning, and point to knobs or your app's own `VariantsSource`; `--force` goes ahead when you still want them, as when a sibling Vite dev server serves them. `variant add` there, and every command where a Vite config lacks `isotone/vite`, warns. After a fix there, `--done` no longer suggests `variant sync` for copies nothing serves. `variant --help` says file variants need the Vite plugin.
- **`init` sets up what file variants need around the plugin.** It names React Router's framework mode and Remix, and says their server renders from `.isotone/active.json` while the tab follows its `?v=`; prints the Tailwind v4 `@source` line for your CSS file and the `.isotone` ignore for an ESLint flat config or a linting Biome config, until they are in place; names your framework's Vite plugin instead of React's; uses the port your package.json script gives `isotone serve`; and once your app has its own `VariantsSource` and no file variants, recommends it and stops suggesting one.
- **`--done` names the files it counted as the fix**, so an unrelated change (another agent's, yours) that let it close a note shows. Any change still counts, since a fix often lands outside the pinned component; `--working` keeps earlier edits out.
- **`combineVariantsSources(...sources)`** in `isotone/core`: one panel source over several, each pick, preview and request reaching the source that owns the selector.
- **A note says which selectors you had moved.** A new note records every selector shown on its page that sits off its default (knobs, selects and variant picks), so your agent knows the page it describes showed those values when you sent it, rather than the defaults. `--json` has them under `selections`, `npx isotone` prints a `selections:` line, and the note carries one tag such as "2 picks" that lists them on hover and to a screen reader. A note with several pins likewise shows one "3 pins" tag instead of a row of cut-off names.

### Fixed

- **The Variants panel and a note's `selections` name what the page shows.** Where picks are shared by every tab (Vite 5, or without React), a pick in another tab or a `variant use` switched the page while this tab's panel kept highlighting the old option, and a note filed then recorded it in `selections`. The panel now follows every change to the server's picks.
- **A copy with conflict markers from `variant sync` is never shown.** `variant use` exited 0 on one and the page broke with an error naming the real file; in a live tab, picking it showed the real file while the panel and `selections` named the variant. Now `variant use` refuses it and says why, the panel shows it disabled with the reason above the selectors, and an active copy that gains markers shows the real files (a tab whose link picked it shows Default in that selector) until they are resolved, when it comes back, unless you pick Default in that selector or reset the panel meanwhile. An open panel sees a copy gain or lose markers as it happens. No tab, link or note names it meanwhile. A host source's options can take `disabled: true` too.
- **Isotone's scripts no longer break hydration of a server-rendered `<head>`.** The dev server put them at the start of `<head>`, where React 18 failed hydrating a whole-document app and React 19 mistook one for a `<script>` the app renders in its head. They now go at the end of `<head>`, and still run before the page's modules. The capture of the browser's own `fetch` also comes back when live variant switching is on; it was skipped there. That capture now runs after the app's classic `<head>` scripts, so a `fetch` stub the app loads as a classic `<script>` in `<head>` is the one it keeps, and the panel's saves go through the stub; load such a stub as a module to keep them on the browser's own `fetch`.
- **Knobs no longer cause hydration errors or flash their defaults.** In a framework that renders `<html>` (React Router framework mode, Next.js), knob values written to `<html style>` made React log "attributes of the server rendered HTML didn't match" on some loads, and every full load showed the defaults until the panel loaded. Knob properties now live in a `:root` rule of a stylesheet the page adopts, which React never sees, and the Vite plugin applies the route's stored values from its inline `<head>` script before the page paints. A select knob's `data-knob-<id>` on `<html>` waits until React has hydrated the page (at most five seconds, and it comes back if React re-renders the page itself); in a Vite app without server rendering it is there before the first paint too. `var(--knob-<id>, …)`, `html[data-knob-<id>]` and the `isotone:knob` event, which still fires for each moved knob on a full load, work as before; code that read `document.documentElement.style.getPropertyValue('--knob-…')` reads `getComputedStyle(document.documentElement)` instead.
- **A pinned element's `source` names a file you can open, and `selector` survives a layout change.** On Next.js, `source` used to be a compiled chunk (`/_next/static/chunks/…js:31`); it now reads the source map, Turbopack's included, and gives `src/components/Counter.tsx:9`, with webpack's eval'd modules mapped to their real line too. A line is given only when the position is a JSX call in the code the page loaded: once a hot update changes a module, its elements give the file without a line rather than a wrong one until the page reloads, and on Turbopack, where the chunk names no file, every element from a changed chunk gives no `source`. The code is compared by length with the page's own download (a hot update to one Vite module leaves its parents' lines), so on Next an edit that keeps a chunk's length can still give a wrong line. A server component under webpack gives its file without a line, and under Turbopack no `source` rather than a chunk. An absolute path inside the app is stored relative to it. With a file variant active, `source` names the copy (`/.isotone/variants/<id>/src/…:15`), so the path and line agree. Vue apps now get `component` and `source` (the file, without a line). `selector` prefers a unique id or test id, or a stable attribute of the pinned element itself (`a[href="/pricing"]`, `input[name="email"]`), over a chain of `nth-child`. It never uses a class, which state, a Tailwind utility, a style fix or a variant can change, nor an id React's `useId` generated, so a pin can't move to another element when the page changes.
- **A knob for one page no longer changes the others.** A knob whose `route` names `/pricing` showed its control only there, but its value applied on every page, including ones where the panel had no control to set it back. It now applies only on its own routes, after a full load or a client-side navigation, and comes back when you return to that page.
- **A tab on Default stays on Default.** With live switching (React on Vite 6 or later), picking Default now writes `?v=<group>:default` to the tab's URL, so you can compare Default in one tab against a variant in another; before, the Default tab quietly followed the other tab's pick. A tab you haven't picked in still follows the latest pick and `variant use`, as before, and stylesheets still follow the latest pick in every tab.
- **`--done` no longer tells your agent to switch every tab back to Default.** After closing a note, it names a variant showing in place of the fix only when that variant copies a file the fix changed, and goes by the option the note is about before `.isotone/active.json`, which may be another tab's pick. It no longer suggests `variant use default`, which moved every tab following the default, nor `variant sync` for a copy with no base recorded, which it cannot merge.
- **The shortcuts work for agents driving a browser.** Automation tools often send a key event with a key (`.`) but no physical key code, so ⌘⇧. and the compare hold ignored them. Isotone still matches the physical key first and now reads the key when that's missing.
- **A selector named after a section sits in it.** A file variant group labelled `Pricing card` no longer appears above a separate *Pricing card* heading holding a `Pricing card > Accent` knob; it joins that section, and `variant list` reports it there too, for the route given and the variants switched on.
- **A knob can no longer take a file variant group's id.** The two shared one selection, so the panel moved the wrong control. The panel now leaves such a knob out, and `variant list` names it with the reason.
- **The agent guide no longer promises colours as hex.** A pinned element's `styles` give opaque `rgb()` colours as hex and any other colour, such as Tailwind v4's `oklch(…)`, as the browser reports it. Only the docs changed.
- **`variant drop` removes `.isotone/variants/` once it's empty**, as does promoting the last variant. A directory holding anything else, such as `init`'s README, stays.
- **`variant add` warns only about what happens in your setup.** On Vue and other hosts without React, where a switch swaps the whole file, it no longer says a copy reloads the page or is served whole. On React with Vite 5 or `variants: { live: false }`, it says a copy exporting helpers may reload the page, rather than that it will.
- **An app's own selectors and `.isotone/knobs.json` knobs show together.** `mountIsotone({ variants: source, endpoint })` with the notes endpoint of the Vite plugin or `isotone serve` now lists the knobs (and, on Vite, file variants) beside the source's selectors, where before the knobs silently disappeared and stopped applying. Compare holds both, and Make default files one `[set-defaults]` note naming every pick, the app's own selectors in `payload.selectors`. A source's own `saveDefaults` still runs first. A knob with the id of one of the app's own selectors is left out, and the panel says so.
- **Make default and Compare appear for a host source without `saveDefaults`** once it is mounted with a notes endpoint; the bar that holds them needed one.
- **`init --approach host` fits its setup and check to the framework.** It names the endpoint for Vite or `isotone serve`, and no longer asks for the Vite-only `data-isotone-inject` and `?isotone=` checks. It says the CLI cannot see the app's own selectors, and `variant list` names the files that hold them (`hostSources` in `--json`).
- **File variants of Vue, Svelte and Astro components work.** A variant of a `.vue` file with `<style scoped>` used to fail with a CSS error and a blank page, and a Svelte copy's styles came out as the whole file; each part of the copy now compiles as the real file's would. Switching a Vue variant from the panel or with `variant use`, or editing the active copy, reloads the page, where it used to change nothing until a manual reload, and `variant add` says so; Svelte switches as a hot update, and editing an active Svelte copy no longer shows an error. [Vue components](docs/variants.md#vue-components) says what each supports.
- **`<file>?isotone=<id>` serves the copy on any dev server on Vite 6 and later**, not only with live switching in React, so the check `init` suggests works there too. A `.vue`, `.svelte` or `.astro` file is checked with `variant use <id>` instead.
- **A variant's base is never left where teammates and `git gc` lose it.** A copy of a file with uncommitted changes, or a `variant sync` in a repository with no commits yet, recorded its base only as a loose Git object no commit held, so a teammate could not sync the variant and `git gc` could later drop it. Such a base is now kept in the variant's `.isotone-base/`, committed with it.
- **Variants work in a project that is not a Git repository.** A copy made there used to read as stale from the start, and `variant sync` refused it with "no base version to merge from". The version a copy was made from is now kept in the variant's own `.isotone-base/` directory when Git can't hold it, so staleness and `variant sync` behave as they do in a repository, also after a later `git init`. Without Git installed, `variant sync` says so. A copy made outside a repository by an earlier version has no recorded base; `variant list` now names it under NO BASE and asks you to compare it by hand instead of claiming its file changed, and `variant sync` adopts the real file as its base when the copy still matches it. `variant sync` lists files it could not merge under `not merged`, apart from real conflicts.
- **The notes file and `.isotone/active.json` stay out of a repository made after the dev server started.** The CLI's notes and `variant` commands now add them to `.git/info/exclude` too, so `git init` followed by `git add -A` no longer commits them.
- **Selectors no longer jump when the defaults bar appears.** The Variants panel used to grow by the bar's height on your first pick and shrink again when the last pick went back to Default, moving the selector you were about to click. It now keeps the bar's room at its foot, so picking and returning to Default leave every control where it was. An untouched panel shows that room as space below its last selector.
- **Section headers stay put when you pick after scrolling.** A header held at the top of the Variants list while its selectors pass no longer slides in from where it was before the scroll.
- **A second click never lands on Make default by accident.** When a pick near the foot of a long list brings up the defaults bar under the pointer, the list scrolls that selector just clear of the bar, and clicking again without moving does nothing.
- **A variant's copy of a secret file is never served.** A variant that copied `.env`, or another file Vite's `server.fs.deny` refuses, with `variant add --force` served that copy to anyone requesting `/.env` while the variant was active. The dev server now serves a copy only where it would serve the real file, and never at the copy's own path, even when `variants.dir` puts the copies outside `.isotone/`.
- **A pinned element's `within` no longer borrows a card's heading.** A block is named only by its `aria-labelledby`, its `aria-label`, its `data-testid`, a heading of its own before the element, or the heading in a `header` or `hgroup` before it; never by a card, column or wrapper beside the element. A button in a "Pro" card inside a "Simple pricing" page reads as in `<main> headed "Simple pricing"` > `<section> headed "Pro"`. A block with no such title gets no label, which includes a card whose title sits in a plain `div` header (Bootstrap's `.card-header`, older shadcn/ui cards, MUI's `CardHeader`).
- **`component` names the components whose code wrote the element, not the framework around it.** For the element and each component that rendered it, the component React called to write it is named when it is the app's, whatever `.map` callback, helper, `useMemo`, `Children.map` or React Compiler `_temp` the JSX sits in, so a page a router or Next.js creates, a component a Radix `asChild` slot clones, a list's row component and the component around a render prop are named, while Next's boundaries (`RedirectBoundary`, `SegmentViewNode` and the like), layout providers and library internals are not. An element from a server component names that component. A wrapping JSX runtime such as Emotion's no longer hides the app's components. `source` is the first line of the app's code after the element factory, never a file inside `node_modules`, a vendored minified file or the server bundle. A column's `render` a table calls names nothing; a class's `render` names the class. An anonymous `forwardRef` render function has no name to give. With Turbopack, Next's `ClientPageRoot` can still appear above a client page, as Turbopack serves it beside the app's own code.

## 1.5.0

### Changed

- **Figures roll into place.** When a slider's value, a colour's hex or the count on the pill changes, only the characters that changed roll, up for a larger number and down for a smaller one, the way iOS animates numbers.
- **The pill is glass.** It blurs and lifts the colour of the page behind it, so it sits in your app rather than on top of it.
- **Opening a section eases its selectors in** from under its header instead of popping them in.
- **A note an agent is working on glints.** A slow light passes along its text while the agent works, beside the existing working dot.

### Changed

- **Scrolled selectors dissolve at the panel's edges.** Where content leaves view in Variants, it blurs gradually and fades into the panel, and each row recedes a little as it goes. A stuck section header and the defaults bar now float over the list as one surface with that fade, rather than solid blocks with a seam beside them. Nothing at rest is blurred, and the last selector still scrolls fully clear of the bar. The notes list and a dialog's scrolled rows fade the same softer way.
- **The defaults bar no longer covers a short list.** When the selectors fit without scrolling, the panel grows to make room as the bar appears, so collapsed section headers stay visible and clickable. In a list that scrolls, the bar still floats over its end and nothing moves.
- **The panel's edge looks the same all the way round.** In the dark theme its lit rim no longer disappears beside headers and the defaults bar, or flashes when the list bounces at the top.
- **Keyboard focus on the pill rings the round button, not a tall box around it.**

## 1.4.1

### Fixed

- **Notes no longer fail to save on Windows when several writers land at once.** Windows briefly refuses to recreate a lock file another process has just deleted; Isotone now waits those few milliseconds instead of reporting that it cannot lock the store.

## 1.4.0

### Added

- **Hold to compare your picks with the defaults.** In Variants, hold **Compare** beside Make default, or hold the key under Escape (` or §) with the panel open or closed, and the page shows every selector at its default; let go and your picks come back exactly as they were. Nothing is saved or filed, and the selectors show the defaults while you hold. It covers what switches instantly (knobs, live file variants, and host selectors whose `createVariantsSource` sets `compare: true`); a selector left on its pick is named in the bar. `compareShortcut` changes or turns off the key.
- **A pinned element now tells your agent how it looks.** Each pin records the computed styles that matter (spacing, type size and weight, colours as hex, layout, radius, shadow), so a note like "too tight" or "make this bigger" comes with the values to start from. `npx isotone` prints them on a `styles:` line and `--json` has them under `elements[].styles`.

## 1.3.6

### Fixed

- **Buttons with words answer a press like the icon buttons do.** Done, Make default, segments and page chips sink slightly while pressed.
- **Picks and pins settle instead of snapping.** Clicking another segment or thumbnail lands on it at once while the one you left fades out, swatches and thumbnails sink under a press, a held slider knob grows, the saved message in the defaults bar crossfades, and new pins and composer references settle into place. Keyboard changes stay instant.

## 1.3.5

### Fixed

- **The first pick after opening Variants no longer jolts the list.** The selectors used to jump up and settle back once, on the first option you chose after a reload. The panel was animating from where each selector sat before its layout had settled.

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
