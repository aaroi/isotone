# iso-iterate — for agents

A dev-only internal feedback loop between a human reviewing a web app and the
coding agent working on it. The reviewer drops notes on real UI elements; the
agent reads them and marks them addressed.

## The loop

1. The reviewer opens the **Iteration** control (the icon bottom-right of the
   app) and writes notes. Enter sends, and a note optionally carries a pinned
   element (the crosshair in the composer: hover to highlight, click to pin).
2. Notes persist to a local gitignored JSON file (default
   `.iteration-feedback.json` in the working dir), served at
   `/api/iteration/notes` by the Vite plugin, by `iso-iterate serve`, or by a
   route handler on `iso-iterate/server`.
3. You read them and mark them done as you address them.

## Reading & marking notes

```bash
npx iso-iterate               # open notes, all routes
npx iso-iterate /projects     # one route
npx iso-iterate --days 30     # widen the window
npx iso-iterate --all         # include done items
npx iso-iterate --done <id>   # mark addressed — id prefix is enough
npx iso-iterate --undone <id> # reopen
npx iso-iterate --help        # the whole command surface
```

An **open note is a task**. At the start of a session, run `npx
iso-iterate` (or point the plugin's `file` and read that path) and act on
what's open. When you fix it, `--done <id>` so the reviewer's panel reflects it.

A note may carry host context on a `·` line — a compact `key=value`
breadcrumb of the state it was written against (the knob settings for a design
note, the active fixture, the selected tenant). Treat it as the conditions to
reproduce under, not as instructions.

An element-scoped note prints the pin target:

```
↳ <span> "platform-api" — tr:nth-child(1) > td:nth-child(1) > div:nth-child(1) > span:nth-child(1)
```

That path is the debugging breadcrumb: find that node in the current page's
DOM, then the component/file that renders it. Route is the URL the note was
written on. The timestamp line carries the reviewer's window size
(`(2026-08-29 14:00 · 900×620)`) — layout feedback only means something at
the breakpoint it was seen on, so reproduce at that width.

## Variants

When a note asks for an alternative — "try it another way," a different
version — don't edit the real file. Make a variant:

```bash
npx iso-iterate variant new <id> --note <notePrefix>   # copies route + element from the note
npx iso-iterate variant add <id> <file...>             # copies files into the variant
npx iso-iterate variant path <id> <file>               # prints the copy's path
npx iso-iterate variant --help                         # every subcommand
```

Edit the copy under `.iso-iterate/variants/<id>/` and leave the original alone;
the dev server hot-swaps the copy in while that variant is active, in place,
without a page reload wherever an edit to that file would swap in place. Keep
the copy's imports as they are: it is served under the real file's module id.
`variant use <id>` switches the dev server to it if you want to look yourself,
`variant use default` goes back. Mark the note done once the variant exists;
the reviewer decides between Default and it in the panel. Ids are lowercase
letters, digits and hyphens. A variant made without `--route` shows on every
route, which is what an app on a memory router (every screen at `/`) needs.

The panel shows one selector per decision, only on the page where that
element lives, and the reviewer can have one pick per decision active at the
same time. So give every variant the route from its note, and when you make
the second alternative to the same element, put both in a group: `--group
<id>` on `variant new`, or `variant group <id> <groupId>` for one that already
exists (`--group-label` names the selector; `--label` on `group` does the
same). Two variants that override the same file are one group without being
told, since only one copy of a file can be served, so `--group` is for
alternatives that touch different files. `variant use <id>` deactivates only
that variant's siblings; `variant off <id>` deactivates one; `variant use
default <groupId>` clears one group.

The panel's "Save as defaults" files a `[set-defaults]` note that only names
the picks. `variants=<id>, <id>` on its context line means run `variant
promote` for each named id, leave every other variant alone, and mark the note
done. `variants=default` means there is nothing to promote; mark it done.

`variant promote <id>` copies the variant over the real files and deletes the
variant. It refuses a stale override (the real file changed since you copied
it — run `variant sync <id>` first) or one still carrying conflict markers,
unless you pass `--force`. `variant drop <id>` deletes a variant; do that only
when the person you work for asks, in so many words, to drop one. Run `variant
list` at the start of a session, same as `npx iso-iterate` for notes, and
commit the variant files with the rest of the branch unless the repo set
`variants: { ignored: true }`.

`npx iso-iterate init` stands the whole loop up in a repo that doesn't have
it yet. It looks at what's there and prints which of overlay, host or serve
fits, so ask the person you're working for which one they want, then run
`init --approach <name>` (add `--yes` to have it write the AGENTS.md
paragraph and, for overlay, the variants directory itself). It never edits
`vite.config` or app code; the printed snippets are for you to place.

## Conventions

- `--done` uses the id *prefix* (unique is enough); ambiguous prefixes are
  rejected.
- `route` is only a scope string. It is a URL path in a routed app, but nothing
  parses it — a host may file notes under a design slug or component name.
- Done notes leave the panel as you mark them, so feedback drains as you
  work; `--all` still lists them.
- There is no hosted endpoint and no database; everything is the local file.
- Notes never render in a production build. Variants can, wherever a host
  mounts a source; overlay variants specifically can't, since they need the
  dev plugin's endpoint.

## Standing the loop up

Three ways, depending on the host:

```bash
npx iso-iterate serve        # any framework: one <script src> in the host's dev HTML
                             # (or the bookmarklet at http://127.0.0.1:4123)
```

or, for a Vite host, register `iteration()` from `iso-iterate/vite` in
`vite.config.ts` — two lines, no host HTML; or, for a framework with its own
dev API, a route handler on `iso-iterate/server` plus `mountIteration` from
`iso-iterate/react` in a dev-only client module. `init --approach serve`
prints the route handler.

Run `serve` **inside the repo being reviewed**. The process that owns the notes
file is then the checkout you are working in, so a note's route and selector
always point at code you can open.

## Publishing this package

Published to npm as `iso-iterate`; `pnpm check` runs before every publish. The
`bin` (`iso-iterate`) and the `react`/`core`/`server`/`serve`/`vite`/`cli`
subpath exports are stable shapes to build against (`pnpm build` produces
`dist/`). CHANGELOG.md carries what changed for existing users.

`iso-iterate/vite` is one adapter, not the boundary. `iso-iterate/server`
holds the transport-free half — the file store and `notesResponse(file, req)
=> { status, headers, body }` — so a Next route handler, `Bun.serve`, a Vercel
function or plain `node:http` can serve the same endpoint against the same
file. It imports neither React nor Vite. `body` is the parsed payload, not a
string; the caller serializes it. Because iso-iterate is often consumed as a
linked dependency, `iteration()` deliberately returns a structural
`IterationPlugin` rather than vite's own `Plugin` type: two vite type
instances are nominally incompatible, and one unassignable entry makes a
consumer's whole `plugins: []` array fail to typecheck.

## Map of the code

For agents working on iso-iterate itself. `tsup.config.ts` builds six ESM
entries and one IIFE; `package.json` `exports` maps them to subpaths.

Entries and what they feed:

- `src/react/index.ts`: the `iso-iterate/react` surface, so the panel, the
  mount, the variants helpers and types, and re-exports from core. Builds
  `dist/index.js`.
- `src/core/index.ts`: `iso-iterate/core`, the note and element model,
  `describeIterationElement`, the route rule (`isRouteVisible`), the
  browser-side store client (`createIterationStore`, fetch with a
  localStorage fallback). No React, no Vite. Re-exports `./variants`.
- `src/core/variants.ts`: axis types, `VariantsSource`,
  `createVariantsSource`, the overlay grouping (`overlayGroups`,
  `overlayAxes`) and `createOverlayVariantsSource`, `VARIANTS_ENDPOINT`.
  Feeds core, react and server.
- `src/server/index.ts`: `iso-iterate/server`, re-exports of both stores
  plus `serveNotesRequest` / `serveVariantsRequest` for `Request`-based
  runtimes.
- `src/serve/index.ts`: `iso-iterate/serve` and the `serve` command, the
  `node:http` server, loopback-only CORS, the bundle with its mount call,
  the setup page with the tag and bookmarklet.
- `src/vite/index.ts`: `iso-iterate/vite`, `iteration()`. Notes and
  variants middleware, HTML injection on navigations, the native-fetch
  capture, overlay `load` and `handleHotUpdate`, the active-file watcher.
- `src/cli/index.ts`: the `bin` and `iso-iterate/cli`; wires `runCli` to
  the process.
- `src/standalone/index.ts`: the IIFE with React inside,
  `dist/iso-iterate.global.js`, which `serve` hands out;
  `window.__isoIterate.mount`.

Shared modules:

- `src/store.ts`: the notes file, `readNotes`, `writeNotes`,
  `notesResponse`, `ensureFileIgnored` / `ensureDirIgnored` for
  `.git/info/exclude`. Used by server, serve, vite and cli.
- `src/variants-store.ts`: the variants directory, manifests, create / add
  / rm / group / sync / promote / drop, blob hashing through `git`, the
  active set and its conflict check, `variantsResponse`. Used by server,
  vite and cli.
- `src/cli/run.ts`: `runCli`, the notes commands, `serve`, `--help`, and
  dispatch to `variant` and `init`.
- `src/cli/variant.ts`: the `variant` subcommands over `variants-store`.
- `src/cli/init.ts`: `init`, host detection, the printed setup per
  approach, the AGENTS.md paragraph and the variants README.
- `src/cli/util.ts`: `CliIO`, flag parsing, note-prefix lookup, the table
  printer.
- `src/react/IterationPanel.tsx`: the panel, so composer, notes list, element
  picker, the Variants / Notes tab bar.
- `src/react/VariantsView.tsx`: the Variants tab, segments, ranges,
  swatches, thumbnails, Save as defaults.
- `src/react/IterationMount.tsx`: `mountIteration`, shadow root, route
  tracking, the overlay source with Save as defaults filing a note.
- `src/react/styles.ts`: `PANEL_CSS`, injected into the shadow root.

Tests, one file per module:

- `tests/cli.test.ts`: `runCli`, notes, every `variant` subcommand, `init`.
- `tests/core.test.ts`: the element descriptor and the route rule.
- `tests/core-variants.test.ts`: `overlayGroups` and `overlayAxes`.
- `tests/react-mount.test.ts`: `mountIteration` next to a document-level
  host root.
- `tests/react-variants.test.ts`: `VariantsView`, the tabbed panel,
  `mountIteration` variants options, the Save as defaults note.
- `tests/serve.test.ts`: the standalone server, bundle, endpoint, CORS,
  setup page.
- `tests/server.test.ts`: `notesResponse`, `serveNotesRequest`, the
  subpath surface, payload and viewport handling.
- `tests/store.test.ts`: the notes store and `ensureFileIgnored`.
- `tests/variants-store.test.ts`: create / add / list, groups, stale
  detection, sync, promote / drop, the active set, `variantsResponse` with
  its 409, path escapes.
- `tests/vite-plugin.test.ts`: the plugin served, injection, streamed HTML,
  the fetch capture, overlay `load`, hot updates, the watcher.
