# Changing Isotone

This repository is the Isotone package. Using Isotone in another app instead?
Follow [the agent guide](docs/agent-guide.md); it ships in the package as
`node_modules/isotone/docs/agent-guide.md`.

- Read [development](docs/development.md) first, and [the design
  language](docs/design.md) before changing the panel.
- The panel answers to [its invariants](docs/design.md#invariants) before any
  other rule in the design guide. A panel change keeps each one and its test; a
  fix for something a reviewer saw adds the invariant it broke, not only a case
  for that one transition.
- Run `pnpm check` before every commit, and `pnpm check:package` when the
  package, an adapter or a shipped doc changes.
- Every user-facing change updates the demo (`examples/demo`), at phone sizes
  too, and gets a line under `Unreleased` in `CHANGELOG.md`.
- Each fact in the docs has one owner ([documentation](docs/development.md#documentation)).
  Agent-facing rules live in [the agent guide](docs/agent-guide.md), the
  `AGENTS.md` section `init` writes (`src/cli/init.ts`) and the CLI's help and
  hints. Change a rule where it lives and link to it from elsewhere.
- Never change the version in `package.json` or add the `minor-release` label:
  every merge ships as the next patch, and a minor is the maintainer's
  decision alone ([releasing](docs/releasing.md#before-merging)).
- Write pull requests as [development](docs/development.md#pull-requests)
  describes. Merging into `main` publishes to npm ([releasing](docs/releasing.md)).
