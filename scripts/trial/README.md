# Agent trial

A repeatable check that a fresh coding agent can adopt Isotone from the docs
alone. Isotone is set up by agents, so we measure it by running a fresh agent
through the two conversations the README promises. The scripts here prepare
the apps and score the result. They never start an agent themselves.

1. **Setup**: the README's "Start with your agent" prompt, in an app that has
   never seen Isotone.
2. **Loop**: three review notes pinned on that app, then "Check my Isotone
   notes and handle them."

Each runs in three fixture apps (`fixtures/`): Vite + React, Next.js App Router,
and plain HTML with a tiny static server. All three have the same page: a
header, a hero with a "Sign up" button, and a two-column card grid.

## What is scored

`score.mjs` prints a JSON report, exits 1 if any check fails, and with
`--table <file.md>` adds a row to a markdown table.

**setup**

- `isotone` is in `devDependencies`, installed from this trial's tarball, and
  not in `dependencies`.
- The panel is wired in: the Vite plugin in `vite.config.*`, or a file that
  loads it (a Next layout, an HTML page).
- Every file that loads the panel does it behind a development-only check:
  `process.env.NODE_ENV` or `import.meta.env.DEV` in code, and a
  `location.hostname` localhost test in HTML `<script>` tags. The Vite plugin
  only runs on the dev server, so it needs no check of its own.
- `npm run build` succeeds with `NODE_ENV=production`, and the output (`dist/`
  or `.next/`) has none of `isotone`, `/api/iteration` and `__isotone`. Plain
  HTML has no build, so its development check stands in for this one.
- `AGENTS.md` has the Isotone section that `init --yes` writes.
- `isotone variant list` shows at least two variants or knobs (the first run).

**loop**

- Each of the three seeded notes is done.
- The diff since the seed (untracked files included; `.isotone/`, the notes
  file, lockfiles and `AGENTS.md` left out) answers each note: `sticky` for the
  header, a three-column grid (`repeat(3, …)`, `grid-cols-3`, `1fr 1fr 1fr`)
  for the cards, and `Get started` for the button. The report names the file
  each answer landed in.
- The production build still passes.

**transcript** (with `--transcript <file.jsonl>`, a Claude Code session or
subagent transcript)

- `toolCalls`, `bashCommands` and `minutes` (first to last entry).
- `isotoneCommands` and `isotoneFailures`: `npx isotone …` and similar
  commands, and how many exited non-zero (listed in `failedIsotoneCommands`).
- `internalsReads`: reads of Isotone's code instead of its docs, such as
  `node_modules/isotone/dist/…` or a checkout's `src/`. Each one means the
  docs were not enough. `docsReads` counts the shipped docs, which is what we
  want agents to read.
- `webFetches`: the prompt links the GitHub repo, so this shows how often an
  agent leaves the machine to read docs.

The automatic checks are a floor. Also read the agent's final message: does
it give one URL, say what it made and how to pin a note, and list the files it
changed (the first run's step d)?

## Run it

From this checkout, with network access:

```sh
OUT=/tmp/isotone-trial-$(date +%Y%m%d-%H%M)
node scripts/trial/prepare.mjs "$OUT"
```

This runs `pnpm build`, packs the checkout into `$OUT/isotone-<version>.tgz`
(the path is also in `$OUT/tarball.txt`), and creates `$OUT/vite-react`,
`$OUT/next-app` and `$OUT/plain-html`, each with its own dependencies
installed and committed as a fresh Git repository. Isotone is not installed;
that is the agent's job.

### 1. Setup

Start a fresh agent in each fixture directory, with nothing about Isotone in
its context beyond the prompt. Do not give it this checkout. Use the README's
prompt, naming the home page, plus one line saying where the package is,
since this version is not on the registry yet:

```text
Set up Isotone (https://github.com/aaroi/isotone) in this project, for development
only. Install the `isotone` package as a dev dependency, run `npx isotone init --yes`,
apply the setup it prints and do its first run on the home page (/). Then
tell me what to open and try.

Install the isotone package from this file instead of the npm registry: <$OUT/isotone-x.y.z.tgz>
```

If the README's prompt has changed, use the new one: this trial tests that
prompt. When the agent is done, stop any dev servers it left running, then
score:

```sh
node scripts/trial/score.mjs "$OUT/vite-react" setup --transcript <session.jsonl> --table "$OUT/results.md"
```

Claude Code keeps each session's transcript under
`~/.claude/projects/<the fixture path, with / as ->/<session id>.jsonl`.

### 2. Loop

On each fixture the setup trial finished:

```sh
node scripts/trial/seed-notes.mjs "$OUT/vite-react"
```

This commits what the setup left, so the loop's diff holds only the agent's
answer. Then it writes three open notes through the installed package's own
notes handler, the code path the panel's POST takes. Each note has a route,
viewport and pinned element matching the fixture page. The base commit and
note ids go to `.git/isotone-trial.json`, out of the agent's sight.

Start a fresh agent in the fixture with:

```text
Check my Isotone notes and handle them.
```

Then score:

```sh
node scripts/trial/score.mjs "$OUT/vite-react" loop --transcript <session.jsonl> --table "$OUT/results.md"
```

Scoring the setup on an untouched fixture, or the loop straight after seeding,
fails every check that needs the agent. That is a quick way to see the
scorer is honest.

## Cost

A full round is six agent sessions: setup and loop in three fixtures. Earlier
simulations took about 25–30 tool calls to a first visible variant, and a loop
over three small notes is similar, so budget six medium sessions on the model
you test with. `prepare.mjs` installs Vite, React and Next from the registry
(a few hundred MB on disk, under a minute). The scorer runs each production
build, which takes about 15 seconds for Next. When you change one piece, rerun
just the fixture it affects.

The three fixtures use the usual ports (Vite 5173, Next and the static server
3000, `isotone serve` 4123). Running them one at a time avoids clashes;
running them side by side tests the first run's port advice instead.
