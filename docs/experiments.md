# Experiments

An experiment is a feature that ships in the package but stays off until you
turn it on. It lets you try something early and tell us how it went. An
experiment may change or be removed in any release, without the notice a
stable feature gets, so nothing else in Isotone depends on one.

## What you can turn on

| Flag | What it adds | Know first |
| --- | --- | --- |
| `dictation` | A microphone button in the feedback composer. Press it and speak; the words land in the note as you say them, and you can keep typing. Press it again, or send the note, to stop. | Needs a browser with speech recognition (Chrome, Edge, Safari); in others the button is not shown. The browser does the recognising and may send the audio to its vendor's service. The page needs microphone permission. |

`npx isotone experiment` prints this list for the installed version, with what
is on.

## Turning one on

Ask your agent ("turn on Isotone's dictation experiment"), or run it yourself in
the app's directory:

```sh
npx isotone experiment on dictation
npx isotone experiment off dictation
```

The flag is saved in `.isotone/experiments.json`. Reload the page to apply it;
the dev server does not need a restart. Commit the file to share the choice
with your team, or leave it out.

Whoever sets Isotone up can turn one on in code instead:

```ts
isotone({ experimental: { dictation: true } })                 // Vite
serveIsotone({ file, experimental: { dictation: true } })      // isotone/serve
mountIsotone({ endpoint, experimental: { dictation: true } })  // your own mount
<IsotonePanel experimental={{ dictation: true }} … />
```

`npx isotone serve --experimental dictation` does the same for one run. The
project's `.isotone/experiments.json` wins over all of these, so a flag set
from the command line always takes effect. A flag this version does not know is
ignored.

## For agents

Turn an experiment on only when the user asks for it, with the command above,
then tell them to reload the page. `npx isotone experiment --json` lists each
experiment with `id`, `label`, `summary`, `caveat` and `on`.
