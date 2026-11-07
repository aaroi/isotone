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

## Boundaries

| Layer | Responsibility |
| --- | --- |
| `src/core` | Note descriptors, browser persistence, variant sources and selection rules. No React or Vite. |
| `src/react` | Shadow-root panel, shared materials, controls, themes and motion. |
| `src/store.ts`, `src/file-store.ts` | Validated note storage, atomic writes and serialized updates. |
| `src/variants-store.ts` | Manifests, file alternatives, path guards, activation and promotion. |
| `src/server` | Request adapters, bounded bodies and origin checks. |
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
`examples/demo/agent-prompt.ts`; `tests/agent-prompt.test.ts` keeps the two the
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

`.github/workflows/demo.yml` deploys [isotone.vercel.app](https://isotone.vercel.app):
production on every push to `main`, and a preview for every pull request, whose
link it posts and then keeps updated in one PR comment, so a change can be tried
on a phone before it merges. `publish.yml` dispatches the workflow again after
its version commit, because pushes made with `GITHUB_TOKEN` start no workflows;
a run whose commit is no longer the tip of `main` skips production. The workflow
uses a pinned Vercel CLI and three repository secrets. Without them (forks,
Dependabot, or before setup) it skips with a notice and passes.

To set it up once:

1. Create a token at [vercel.com/account/tokens](https://vercel.com/account/tokens),
   scoped to the team or account that owns the demo project.
2. Find the IDs: run `vercel link` in a checkout and read `orgId` and
   `projectId` from `.vercel/project.json` (ignored by Git), or copy the Project
   ID from the project's Settings → General and the team or user ID from its
   settings.
3. Add them as repository secrets (Settings → Secrets and variables → Actions),
   or with `gh secret set VERCEL_TOKEN`, `gh secret set VERCEL_ORG_ID` and
   `gh secret set VERCEL_PROJECT_ID`.
4. Vercel protects preview deployments with Vercel Authentication by default.
   To open previews on a phone without signing in, turn it off for previews in
   the project's Settings → Deployment Protection, or sign in to Vercel there.

Pull-request runs have the token, so only branches in this repository get
previews. Keep the token scoped to the team or account that owns the demo
project and nothing wider: a pull request can change what the workflow runs.
The workflow passes the token only to `vercel pull` and `vercel deploy`; the
build, which runs the project's own scripts, gets no token, and the checkout
keeps no GitHub credentials. A preview is built from the pull request merged
into its base branch, as GitHub tests it, so its comment names both. Connecting the repository
in the Vercel dashboard (Project → Settings → Git) is an alternative: Vercel then
deploys `main` and comments on pull requests itself, using `vercel.json`. Use
one or the other, not both, or every commit deploys twice; if you choose the
Git integration, delete `demo.yml` and its dispatch step in `publish.yml`.
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
