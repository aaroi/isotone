# Onboarding

Maintainer notes on the first run, which is designed as the conversation between
a new user and their coding agent, since most people set Isotone up that way.
Re-run [the agent trial](#the-agent-trial) when changing it.

## The flow

1. The user pastes the README's **Start with your agent** prompt, naming a page.
2. The agent installs `isotone` as a dev dependency and runs `npx isotone init --yes`.
3. `init` prints the development-only setup, the `AGENTS.md` status and, until
   the project has variants or knobs, a **first run**: build two real, opt-in
   variants on the user's page (Vite: a file-variant selector and a knob;
   otherwise a select knob and a range or colour knob), check them with
   `npx isotone variant list`, and reply in a fixed order: the URL, what was
   made, how to pin a note, what changed.
4. The user switches the variants, pins a note and says "check my Isotone notes".
   The `AGENTS.md` section carries the loop into later sessions and points to the
   shipped agent guide.

## Why the CLI leads

Fresh agents given only the prompt and the docs, against a packed tarball, set
up Vite + React, Next.js 16 with Tailwind and plain HTML with their default ports
taken, under three designs. A long prompt with setup-only `init` stalled on
Next (the agent read type declarations and grepped the bundle). A setup-only
prompt with a checklist in the panel was fastest but left a strict agent's
Variants tab empty. A short prompt with a framework-specific first run from
`init` (chosen) was the most consistent: about 80 seconds to a first visible
variant on every framework, on the user's own page.

## The agent trial

`scripts/trial/` repeats this: it packs the package, prepares Vite + React,
Next.js and plain-HTML fixtures, seeds notes, and scores a fresh agent's setup
and notes loop from its transcript. [Its README](../scripts/trial/README.md) has
the prompts and steps; it never starts an agent itself. The `--done` gate, the
stale-copy warning and the viewport rule came from its failures.

## Open follow-ups

- A small first-run hint in the panel that points at the variants the agent built.
- `isotone serve` needs a second process next to the app's dev server.
- No trial agent checked its work visually; they had only `curl`.
