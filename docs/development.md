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
provides the theme settings:

| Control | What it changes |
| --- | --- |
| Page | The mock app's actual light or dark background |
| Panel | Automatic page detection, system preference, or an explicit theme |

The sample app's Spacing, Accent colour, Card radius and Card padding selectors
remain inside the panel. Clean Highlight is the product default; there is no
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
the Agent buttons edit those notes the way `--working` and `--done` would. It is
deployed to [isotone.vercel.app](https://isotone.vercel.app) with
`vercel deploy --prod`; `vercel.json` holds the build command.
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
even when a label is visually truncated.

`src/react/feedback-layout.ts` holds the accepted inline-reference layout.
`src/react/pill-active.ts` holds the accepted Clean Highlight recipe. Future
review alternatives belong under `.isotone/variants/`.
Edit the copied recipe when developing an alternative; keep shared geometry,
theme tokens and unrelated controls in the main stylesheet.

The panel's auto theme samples rendered background colours, not pixels from
images. A host can pass `light` or `dark` when those samples do not represent the
page. `system` deliberately ignores the host theme.

For notice layout checks, `/?review=1&update-preview=1` supplies a fictional
update result. It does not contact npm or install anything. `/?review=1` keeps
feedback open across variant reloads.
