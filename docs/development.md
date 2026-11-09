# Development

This guide is for changing Isotone itself. Agents using Isotone in another
project follow [the agent guide](agent-guide.md).

Panel UI follows [the design language](design.md), which also lists what to
inspect for a UI change. [Onboarding](onboarding.md) covers the README prompt,
`init`'s first run and the agent trial that re-runs them; re-run it when
changing them. Merging into `main` publishes to npm, so follow [the release
guide](releasing.md) and keep work on a branch until it is ready.

## Checks

| Command | What it does |
| --- | --- |
| `pnpm check` | Types, lint, unused files and exports (knip), build and tests. `pnpm test` rebuilds a stale `dist/isotone.global.js` itself. |
| `pnpm check:package` | Installs the packed archive in a clean consumer; fails when `dist/isotone.global.js` or the tarball outgrows its budget in `scripts/check-package.mjs` (raise one only in the change that needs it). Run it for package or shipped-doc changes. |
| `pnpm smoke` | After `pnpm build`, with network: installs into fresh Vite 5, 6, 7 and 8 apps with React 18 and 19 and checks a production build has no panel. |
| `pnpm test:coverage` | The per-layer floors in `vitest.config.ts`; raise a floor when its layer improves. |
| `pnpm mutate` | Stryker over the Node-side layers (weekly in CI, failing below its `break` score; `--mutate <glob>` narrows it), into `reports/mutation/index.html`. |

Tests check observable behaviour, transport and store failures, lifecycle
cleanup and design boundaries; add a small regression case for each bug.

## Documentation

Each topic lives in one file, for one reader; other files link to it.

| File | Reader | Owns |
| --- | --- | --- |
| `README.md` | Someone trying Isotone | What it is, the agent prompt, keys |
| `docs/agent-guide.md` | The agent in a user's app | Setup steps, the notes loop, the note record, update notes, variant procedure |
| The section `init` writes | The same agent, every session | Dev-only rule, the loop, trust, where the guide is |
| `docs/integrations.md` | Whoever wires up a host | Hosts, endpoint rules, themes, production guards |
| `docs/variants.md` | Agent and host developer | Making file variants, knobs, sections and host sources well; how switching works, last |
| `docs/blast.md`, `updates.md` | The person using Isotone | Blast, update checks |
| `AGENTS.md`, `docs/development.md`, `design.md`, `releasing.md`, `onboarding.md` | Maintainers | Not shipped |

`tests/package/docs.test.ts` checks that shipped docs link only to shipped files
and existing headings (use absolute GitHub URLs for the rest), and that the agent
guide and the CLI's `updateHint` list the same update commands.

## Pull requests

Write the description for someone who hasn't followed the work or the
codebase, however technical the change. When the review depends on a part of
Isotone (the dock, knobs, overlay variants, the notes file), say in a sentence
what it is. The outline, in `.github/pull_request_template.md` and for
`gh pr create --body` alike:

- **Before:** what someone using Isotone experiences today, in plain words, and
  who: the person reviewing their app, their coding agent, or a maintainer.
- **After:** what changes for them.
- **Review notes:** only what a reviewer needs (risks, trade-offs, effects on
  existing users, what to try in the demo); no file lists, internal names or
  implementation narration unless they matter.
- **Tested:** what was checked, and what wasn't.

## Boundaries

| Layer | Responsibility | May import |
| --- | --- | --- |
| `src/core` | Note descriptors, browser persistence, variant sources and selection rules, shared config types and size limits. No React, Vite or Node. | — |
| `src/react` | Shadow-root panel, shared materials, controls, themes and motion. | core |
| `src/standalone` | Private bundled React runtime for hosts without React. | core, react |
| `src/node` | Node-only stores and helpers, used by the Vite plugin, `serve` and the CLI. No React. | core |
| `src/node/fs` | Atomic JSON writes, file locks, path guards and Git exclude entries. | |
| `src/node/notes` | Validated note storage and the notes endpoint. | |
| `src/node/variants` | Manifests, file alternatives, activation and promotion, the export scanner, and the variants endpoint. | |
| `src/node/update`, `src/node/blast.ts` | Update checks and update notes; Blast sessions. | |
| `src/node/http.ts`, `src/node/bundle.ts` | Bounded request bodies, origin checks and response writing; reading the built browser bundle. | |
| `src/node/serve-owner.ts` | Which checkout an `isotone serve` port belongs to. | |
| `src/vite`, `src/serve` | Development-server integration and self-contained panel delivery. | core, node |
| `src/cli` | Setup, feedback and variant commands over the same stores. | core, node, serve (only to start `isotone serve`) |

`tests/package/boundaries.test.ts` enforces the last column (dynamic `import()`
included) and keeps `node:*` out of core, react and standalone and React out of
everything but react and standalone. Biome refuses import cycles.

Public entry points are `react`, `core`, `serve`, `vite` and `cli`,
built to `dist/<name>.js`; the `isotone` binary is `dist/bin.js`. Each barrel
(`src/<name>/index.ts`) exports only names the docs or the demo use, listed in
`tests/package/exports.test.ts`: add one there on purpose, and list a removal
in the CHANGELOG. Keep browser code out of server entries and keep React/Vite
optional for CLI and standalone consumers. The build bundles only the icons
used by the panel.

## Local workflow

`pnpm dev` starts the fictional demo at `http://127.0.0.1:4173`, with a panel
theme select, a page light/dark toggle and a Tour button in its top bar. The tour
(`examples/demo/tour.tsx`) starts on a browser's first visit until closed
(`/?tour=1` forces it) and ends with the README's "Start with your agent"
prompt, kept in `examples/demo/agent-prompt.ts` and checked against the README
by `tests/package/agent-prompt.test.ts`. A pretend agent marks each new note as
worked on and closes it seconds later, as `--working` and `--done` would; a
reload clears a claim it never finished.

The sample app's selectors sit in two sections, Cards and Theme. Other demo URLs:

| URL | Shows |
| --- | --- |
| `/?stress=1` | 500 selectors in sections of a dozen (one with a long name) and 500 notes, with long labels and large feedback |
| `/?review=1` | Feedback stays open across variant reloads |
| `/?review=1&update-preview=1` | A fictional update result; **Ask agent to update** files a demo update note (built by the same server code in the dev demo) that the pretend agent closes. Nothing contacts npm. |

`/preview.html` frames the live demo for the README image: `?scene=both`
(variants and feedback) captured in headless Chrome at 816 × 856, device scale
2, with `--default-background-color=00000000` and saved as PNG so the rounded
corners have no frame, and a 15s virtual time budget so the opening motion has
settled. `?scene=focus` shows the feedback panel alone, `?scene=pin` select mode
with a pinned card, and `?theme=light` the light page.

`scripts/capture/record-loop.mjs` records `docs/assets/loop.gif` from the hosted
demo build over the Chrome DevTools Protocol and ffmpeg; its header has the
commands.

## Hosted demo

`pnpm build:demo` builds the demo as a static site in `demo-dist/` that answers
the notes endpoint itself from `localStorage`; `pnpm dev --mode hosted` serves
the same build mode from the dev server, and `vercel.json` holds the install and
build commands.

Every user-facing change updates the demo so it shows the change: new controls
in the sample app, new copy in the tour, new behaviour where a visitor will try
it. Many visitors use a phone, so check it at 375 × 812 and landscape too. The
dev demo's notes are seeded files in a temporary directory, removed when the
server closes.

Vercel deploys [isotone.vercel.app](https://isotone.vercel.app) on every push to
`main` and posts a preview link on every pull request; try a change on a phone
there before it merges. To open previews without signing in, turn off Vercel
Authentication for previews (Settings → Deployment Protection). Pull requests
from forks need a project member to authorize their preview. `vercel deploy
--prod` works for an emergency.

## Performance

The runtime is TypeScript throughout; the expensive work is DOM traversal, disk
access and redundant updates, so avoid that work rather than adding a language
or runtime. Selector dependencies are walked iteratively in linear time, DOM
descriptors read sibling metadata only where a selector needs it, and variant
status hashes blobs in process (Git-compatible) rather than spawning per file.
Theme events and picker geometry are coalesced per frame; panel motion and
render budgets are in [the design language](design.md#motion).

Add virtualization or a new runtime only for a measured bottleneck, keeping
native scrolling and keyboard access, and validate performance changes with
large collections and failure and retry paths, not just the happy path.
