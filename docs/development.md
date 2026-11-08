# Development

This guide is for changing Isotone itself. Agents using Isotone in another
project follow [the agent guide](agent-guide.md).

Read [the design language](design.md) before changing panel UI. Instrument is
the accepted design; keep geometry and interaction rules shared across themes.
Selection is raised, and Clean Highlight is the pill’s active state. Keep
experimental alternatives separate until the reviewer chooses one.

Run `pnpm check` for types, lint, unused files and exports (knip), build, and
tests. `pnpm test` rebuilds a stale `dist/isotone.global.js` itself. For
package, adapter or shipped-doc changes, also run `pnpm check:package`, which
installs the packed archive in a clean consumer.
It also fails when `dist/isotone.global.js` or the tarball outgrows its budget
in `scripts/check-package.mjs`; raise a budget only in the change that needs it.
`pnpm smoke` (after `pnpm build`; it needs the network) installs it into fresh
Vite 5 and Vite 8 apps with React 18 and 19 and checks that a production build
has no panel. `pnpm test:coverage` enforces the per-layer coverage floors in
`vitest.config.ts`; raise a floor when its layer improves. `pnpm mutate` runs
Stryker over `src/core` and `src/node` (weekly in CI; `--mutate <glob>` narrows
it) and writes `reports/mutation/index.html`. Tests focus on observable behaviour, transport and store failures,
lifecycle cleanup and design boundaries; add a small regression case for each bug.
Inspect both themes, keyboard use, reduced motion, scrolling, and long content
when changing UI.

[Onboarding](onboarding.md) explains how the README prompt, `init` and its first
run fit together, and the agent trial (`scripts/trial/`) that re-runs a fresh
agent through them. Re-run it when changing them.

Merging into `main` publishes automatically. Follow [the release guide](releasing.md)
before merging; use a development branch until the change is ready for npm.

The runtime is TypeScript throughout. The expensive work is DOM traversal, disk
access, and redundant updates; avoiding that work matters more here than adding
a second language or runtime.

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

Write the description for a person who hasn't followed the work and doesn't
know the codebase well, however technical the change is. When the review depends
on a part of Isotone (the dock, knobs, overlay variants, the notes file), say in a
sentence what it is. `.github/pull_request_template.md` has the outline:

- **Before:** what someone using Isotone experiences today, in plain words. Name
  who that is: the person reviewing their app, their coding agent, or a maintainer.
- **After:** what changes for them.
- **Review notes:** only the technical detail a reviewer needs, such as risks,
  trade-offs, effects on existing users, and what to try in the demo. Leave out
  file-by-file lists, internal names and implementation narration unless they
  matter for the review.
- **Tested:** what was checked, and what wasn't.

Agents that write the description themselves (`gh pr create --body`) follow the
same outline.

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
| `src/vite`, `src/serve` | Development-server integration and self-contained panel delivery. | core, node |
| `src/cli` | Setup, feedback and variant commands over the same stores. | core, node, serve (only to start `isotone serve`) |

`tests/package/boundaries.test.ts` enforces the last column, dynamic `import()`
included, keeps `node:*` out of core, react and standalone, and keeps React
packages out of everything but react and standalone. Biome refuses import cycles.

Public entry points are `react`, `core`, `server`, `serve`, `vite`, and `cli`,
built to `dist/<name>.js`; the `isotone` binary is `dist/bin.js`. Each barrel
(`src/<name>/index.ts`) exports only names the docs or the demo use, listed in
`tests/package/exports.test.ts`: add one there on purpose, and list a removal
in the CHANGELOG. Keep browser code out of server entries and keep React/Vite
optional for CLI and standalone consumers. The build bundles only the icons
used by the panel.

## Local workflow

`pnpm dev` starts the fictional demo at `http://127.0.0.1:4173`. Its top bar
has a Panel theme select (automatic page detection, system preference, or an
explicit theme), a light and dark toggle for the page, and a Tour button. The
tour (`examples/demo/tour.tsx`) starts by itself on a browser's first visit and
remembers when it was closed; `/?tour=1` starts it regardless. Its last step
hands visitors the README's "Start with your agent" prompt, kept in
`examples/demo/agent-prompt.ts`; `tests/package/agent-prompt.test.ts` keeps the two the
same, so change both together. A pretend agent marks each new note as being worked on a moment after it
is sent and closes it a few seconds later, the way `--working` and `--done`
would.

The sample app's selectors sit in two sections: Cards (layout, spacing, corner
radius and padding) and Theme (accent colour). `/?stress=1` puts its 500 selectors
in sections of a dozen, one of them with a long name. Clean Highlight is the product default; there is no
active-pill design switcher.

`/preview.html` frames the live demo for the README image. The README image is
`?scene=both` (variants and feedback panels) captured at an 816 × 856 window
with a device scale of 2 and a transparent background
(`--default-background-color=00000000` in headless Chrome), saved as PNG so the
window's rounded corners have no frame. `?scene=focus` shows the feedback panel alone,
`?scene=pin` shows select mode with a pinned card, and `?theme=light` switches
the page. Give headless captures a long virtual time budget (15s) so the panel's
opening motion has settled.

`docs/assets/loop.gif` is recorded by `scripts/capture/record-loop.mjs`, which
drives the hosted demo build through the Chrome DevTools Protocol and encodes the
frames with ffmpeg. The header comment has the commands.

## Hosted demo

`pnpm build:demo` builds the demo as a static site in `demo-dist/`. Without a
dev server, the page answers the notes endpoint itself from `localStorage`, and
the pretend agent edits those notes there. `pnpm dev --mode hosted` serves the
same hosted variant from the dev server. `vercel.json` holds the install and
build commands.

Every user-facing change updates the demo so it shows the change: new controls
appear in the sample app, new copy in the tour, new behaviour somewhere a
visitor will try it. Many visitors use a phone, so check the demo at a phone
size (375 × 812 and landscape) as well.

The Vercel project is connected to this repository, so Vercel deploys
[isotone.vercel.app](https://isotone.vercel.app) on every push to `main` and
posts a preview link on every pull request; try a change on a phone from that
link before it merges. To open previews without signing in, turn off Vercel
Authentication for previews in the project's Settings → Deployment Protection.
Pull requests from forks need a project member to authorize their preview.
`vercel deploy --prod` still works for an emergency.

Demo feedback uses seeded files in a temporary
directory, separate from project notes; the server removes them when it closes.
Open `/?stress=1` for 500 selectors and 500 notes, including long labels and large
feedback.

## Performance

Selector dependencies are walked iteratively in linear time; long chains do not
consume the JavaScript call stack. DOM descriptors read sibling metadata only
where a selector needs it. Variant status uses an in-process Git-compatible blob
hash rather than launching a process per file.

Theme events and picker geometry are coalesced per frame. Note and selector layout
animation runs only when the collection changes; collections above 40 items skip
per-item motion. Reads precede writes, interrupted animations start from the
visible position, and reduced-motion or keyboard actions remove movement.

Do not add virtualization or a new runtime without a measured bottleneck and a
clear benefit. Preserve native scrolling and keyboard access. Before changing
performance-sensitive code, include large collections and failure/retry paths in
validation; a fast happy path is insufficient.

## UI changes

Follow [the design language](design.md). Use shared semantic materials and
components rather than selector-specific theme overrides. Check both themes,
selected/hover/focus/disabled states, long labels, empty and populated feedback,
sticky fades, narrow viewports, and reduced motion. Context must remain accessible
even when a label is visually truncated. On touch, copy names taps rather than
keys or Shift, and nothing depends on hover; see "Phones and touch" in
[the design language](design.md).

`src/react/styles/panel.ts` holds the accepted inline-reference layout and
Clean Highlight recipe. Future
review alternatives belong under `.isotone/variants/`.
Edit the copied recipe when developing an alternative; keep shared geometry,
theme tokens and unrelated controls in the main stylesheet.

The panel's auto theme samples rendered background colours, not pixels from
images. A host can pass `light` or `dark` when those samples do not represent the
page. `system` deliberately ignores the host theme.

For notice layout checks, `/?review=1&update-preview=1` supplies a fictional
update result, in the dev demo and the hosted one. **Ask agent to update** then
files a demo update note, built by the same server code in the dev demo, which
the pretend agent picks up and closes. It does not contact npm or install anything. `/?review=1` keeps
feedback open across variant reloads.

Reloading the demo clears any note the pretend agent had marked as being worked
on, since it never finishes it.
