# Onboarding

Maintainer notes on how a new user's first run is designed, and why. Most people
set Isotone up through their coding agent, so the first run is designed as the
conversation between the user and that agent. Re-run [the agent trial](#the-agent-trial)
when changing it.

## The flow

1. The user pastes the README's **Start with your agent** prompt, naming a page.
2. The agent installs `isotone` as a dev dependency and runs `npx isotone init --yes`.
3. `init` detects the framework and prints the development-only setup, a **first
   run** and the `AGENTS.md` status. The first run has the agent build two real,
   opt-in variants on the user's page (Vite: one file-variant selector and one
   knob; any other dev server: a select knob and a range or colour knob), check
   them with `npx isotone variant list`, and send a short message in a fixed
   order: the URL, what was made, how to pin a note, what changed.
4. The user switches the variants, pins a note and says "check my Isotone notes".
   The short `AGENTS.md` section carries the loop into later sessions and points
   to the shipped agent guide for the rest.

`init` skips the first run once the project has variants or knobs.

## Why the CLI leads

Three designs were simulated with fresh agents given only the user's prompt and
the docs, against a packed tarball, in Vite + React, Next.js 16 with Tailwind and
plain HTML projects whose default ports were taken:

- **A, prompt-led:** a long README prompt; `init` prints setup only. As good on
  Vite, but on Next the agent had to read type declarations for the knob schema
  and grep the bundle for the endpoint.
- **B, CLI-led (chosen):** a short prompt; `init` prints a framework-specific
  first run. The most consistent result: about 80 seconds and 26–29 tool calls to
  a first visible variant on every framework, and the user opens the panel to
  alternatives of their own page.
- **C, panel-led:** a setup-only prompt and a checklist in the panel. Fastest to
  set up, but a strict agent leaves an empty Variants tab.

The simulations led to `isotone serve` serving `.isotone/knobs.json`, `variant
list` naming skipped knobs, the Next `next/script` tag in the root layout, the
static localhost-only loader, and the first run covering ports, Tailwind and
checking without a browser.

## The agent trial

`scripts/trial/` makes the simulations repeatable: it packs the package, prepares
Vite + React, Next.js and plain-HTML fixtures, seeds notes, and scores a fresh
agent's setup and notes loop from its transcript. [Its README](../scripts/trial/README.md)
has the prompts and steps; it never starts an agent itself.

The round-2 baseline passed every check in 5 to 17 tool calls, and shaped `--done`:
agents chained an edit and `--done`, so a failed edit still closed the note; fixes
left file-variant copies stale; and layout notes ignored their viewport.

## Open follow-ups

- A small first-run hint in the panel that points at the variants the agent built.
- `isotone serve` needs a second process next to the app's dev server.
- No trial agent checked its work visually; they had only `curl`.
- The notes file is still `.iteration-feedback.json`. Manual routes, `file`
  options and `--file` flags name it, so renaming it would split notes between
  two files until every one of them changed. The Vite export is now `isotone()`.
