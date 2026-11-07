# Development

This guide is for changing Isotone itself. Agents using Isotone in another
project should follow that project’s generated `AGENTS.md` section and the
[integration guide](integrations.md).

Read [the design language](design.md) before changing panel UI. Instrument is
the accepted design; keep geometry and interaction rules shared across themes.
Selection is raised, and Clean Highlight is the pill’s active state. Keep
experimental alternatives separate until the reviewer chooses one.

Run `pnpm check` for types, lint, build, and tests. For package or adapter
changes, also run `pnpm check:package`. Inspect both themes, keyboard use,
reduced motion, scrolling, and long content when changing UI.

[Onboarding](onboarding.md) explains how the README prompt, `init` and its first
run fit together, and the simulations behind them. Re-run one when changing them.

Merging into `main` publishes automatically. Follow [the release guide](releasing.md)
before merging; use a development branch until the change is ready for npm.

The runtime is TypeScript throughout. The expensive work is DOM traversal, disk
access, and redundant updates; avoiding that work matters more here than adding
a second language or runtime.

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

| Layer | Responsibility |
| --- | --- |
| `src/core` | Note descriptors, browser persistence, variant sources and selection rules, shared config types and size limits. No React, Vite or Node. |
| `src/react` | Shadow-root panel, shared materials, controls, themes and motion. |
| `src/node` | Node-only stores and helpers, used by the adapters and the CLI. No React. |
| `src/node/fs` | Atomic JSON writes, file locks, path guards and Git exclude entries. |
| `src/node/notes` | Validated note storage and the notes endpoint. |
| `src/node/variants` | Manifests, file alternatives, activation and promotion, and the variants endpoint. |
| `src/node/update`, `src/node/blast.ts` | Update checks and update notes; Blast sessions. |
| `src/node/http.ts` | Bounded request bodies, origin checks and response writing. |
| `src/server` | Request adapters for `Request`-based runtimes. |
| `src/vite`, `src/serve` | Development-server integration and self-contained panel delivery. |
| `src/cli` | Setup, feedback and variant commands over the same stores. |
| `src/standalone` | Private bundled React runtime for hosts without React. |

Public entry points are `react`, `core`, `server`, `serve`, `vite`, and `cli`.
Keep browser code out of server entries and keep React/Vite optional for CLI and
standalone consumers. The build bundles only the icons used by the panel.

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

The demo project on Vercel is connected to this repository (Project → Settings
→ Git), so Vercel deploys [isotone.vercel.app](https://isotone.vercel.app) on
every push to `main`, including the release workflow's version commit, and
posts a preview link on every pull request, using `vercel.json`. Try a change on
a phone from that link before it merges. No repository secrets are involved.
Vercel protects preview deployments with Vercel Authentication by default; to
open previews on a phone without signing in, turn it off for previews in the
project's Settings → Deployment Protection, or sign in to Vercel there. Vercel
asks a project member to authorize a preview for a pull request from a fork.
Deploying by hand with `vercel deploy --prod` still works for an emergency.

Demo feedback uses seeded files in a temporary
directory, separate from project notes; the server removes them when it closes.
Open `/?stress=1` for 500 selectors and 500 notes, including long labels and large
feedback.

`pnpm check` runs types, lint, build, and the test suite. `pnpm check:package`
exercises the packed artifact in a clean consumer. Tests focus on observable
behaviour, transport/store failures, lifecycle cleanup, and design boundaries.
Use small regression cases for bugs; avoid tests that merely duplicate code.

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

`src/react/feedback-layout.ts` holds the accepted inline-reference layout.
`src/react/pill-active.ts` holds the accepted Clean Highlight recipe. Future
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
