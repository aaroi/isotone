# Onboarding

Maintainer notes on how a new user's first run is designed, and why. Most people
set Isotone up through their coding agent, so the first run is designed as the
conversation between the user and that agent.

## The flow

1. The user pastes the README's **Start with your agent** prompt, naming a page.
2. The agent installs `isotone` as a dev dependency and runs `npx isotone init --yes`.
3. `init` detects the framework and prints three things: the development-only
   setup, a **first run** and the `AGENTS.md` status. The first run has the agent
   build two real, opt-in variants on the user's page (Vite: one file-variant
   selector and one knob; any other dev server: a select knob and a range or colour
   knob), check them with `npx isotone variant list`, and send a short message in a
   fixed order: the URL, what was made, how to pin a note, what changed.
4. The user switches the variants, pins a note and says "check my Isotone notes".
   The `AGENTS.md` section carries the loop into later sessions.

`init` skips the first run once the project has variants or knobs, so running it
again on a set-up project stays quiet.

## Options considered

- **A: prompt-led.** A long README prompt tells the agent to set up, build two
  variants and explain the panel. `init` prints setup only.
- **B: CLI-led.** A short prompt says to run `init` and follow it. `init` prints a
  framework-specific first run for the agent. Chosen.
- **C: panel-led.** A short setup-only prompt; a first-run checklist in the panel
  teaches switching, pinning and sending. Not built; judged from its description.

## Simulations

Each run gave a fresh agent only the user's prompt and a copy of the README and
docs, against an `npm pack` tarball of the branch, in throwaway projects: Vite +
React, Next.js 16 App Router with Tailwind, and plain HTML served by browser-sync.
The default ports (3000, 4123, 5173) were taken, so every run also had to move ports.
Tool calls include a few refusals from the simulation's own sandbox.

| Run | Option | First visible variant | Tool calls to it | Total calls |
| --- | --- | --- | --- | --- |
| Vite | B | 100 s | 29 | 40 |
| Next | B | 103 s | 24 | 37 |
| Static | B | 97 s | 29 | 33 |
| Vite | A | 62 s (identical copies), 89 s with real differences | 19 | 43 |
| Next | A | 145 s | 39 | 51 |
| Next | C | 98 s, with an example knob the agent chose to add | about 29 | 46 |
| Vite, final version | B | 84 s | 29 | 40 |
| Next, final version | B | 77 s | 26 | 40 |

The final runs used the version on this branch. Neither agent had to guess the
port setup, misread `variant use default`, or search the bundle for the knobs
endpoint.

A separate agent played a first-time user and scored each final message on
knowing what to do next, learning what Isotone can do, trusting nothing ships, and
clarity. It ranked B, then A, then C:

- **B** gave the most consistent message across frameworks: the user opens the
  panel to alternatives of their own page and knows what to say next.
- **A** can produce an equally good message on Vite. On Next its agent had to
  work out that knobs were the only path, read type declarations for the colour
  knob schema and grep the bundle for the endpoint. Its message stopped the
  servers and listed keyboard details first.
- **C** set up fastest, but its agent had no guidance on whether to make anything.
  A stricter agent leaves an empty Variants tab, and the user needs another round
  trip before seeing why Isotone exists.

## Changes the simulations led to

- `isotone serve` serves `.isotone/knobs.json`, so Next and static sites get a
  real first variant without Vite.
- `variant list` lists knobs and names every entry the panel would skip, since an
  invalid knob otherwise just never appears.
- `init` points Next at the root layout with a `next/script` tag behind
  `NODE_ENV === 'development'`, gives static HTML a localhost-only loader, and drops
  the Next route-handler alternative from other hosts.
- The first run covers ports, Tailwind, checking without a browser, using today's
  value as a knob's fallback, and leaving the dev server running.
- `AGENTS.md` says `variant use default`, not just `default`, and states the
  dev-only rule without contradicting the Vite plugin's own guarantee.
- The colour knob schema is in [variants](variants.md#knobs).

## Open follow-ups

- A small first-run hint in the panel that points at the variants the agent built
  (option C's useful part). Left out to keep panel changes minimal.
- The `iteration()` export and `.iteration-feedback.json` file name confused the
  simulated first-time user, who expected names with `isotone` in them.
- `isotone serve` needs a second terminal next to the app's dev server, so the user
  has to start two processes.
