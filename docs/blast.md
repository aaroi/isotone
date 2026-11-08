# Blast mode

Blast mode lets your coding agent keep acting on Isotone notes by itself for a set
time. You review in the browser, pin notes, and the agent picks each batch
up, fixes it and closes it, without you prompting it again for every note.

Isotone is not an agent and never runs one. Blast is a command your own agent
runs in a loop: it blocks until new notes arrive, prints them, and exits. The
agent acts on them and runs it again, until the session is over.

## Starting a session

Blast has no button in the panel. Ask your coding agent, in the chat where it
already works on this app:

```text
Run an Isotone Blast session for 45 minutes: `npx isotone blast start 45m`, then follow what it prints.
```

`start` prints everything the agent needs: the loop below and the guardrails.
Then review in the browser as usual and pin notes; the agent picks them up.
To see, lengthen or end the session, ask the agent, or run these yourself in
the app directory:

```sh
npx isotone blast status      # time left, and whether the agent is waiting
npx isotone blast extend 15m  # add time
npx isotone blast stop        # end it; a waiting agent sees it at once
```

## The loop

The agent runs `npx isotone blast`, which waits and then ends in one of these ways:

| Output | Exit | What the agent does |
| --- | --- | --- |
| A batch of new notes, in the same shape as `npx isotone --json` | 0 | Act on each note as usual (`--working`, fix, verify, `--done`), then run it again |
| `No new notes · 32 min left · run npx isotone blast again` (a check-in every `--every`) | 0 | Run it again |
| `Blast session over` | 3 | Stop, and give the user a short summary |
| An error on stderr | 1 | Fix what it names; a busy notes file at the start only needs a retry |

A waiting run never starts a session, so an agent that runs it after the end
is only ever told to stop. Once it is waiting, a notes file another writer
holds for a while only delays a heartbeat or a batch.

A check-in exists only so a run ends before the agent's command timeout, and
each costs the agent a turn. An agent that can run a background task and be woken
when it exits uses `--every off`, so an idle session costs nothing; others keep
`--every` under their timeout (`90s` for Claude Code's default two minutes). A run
cut off by a timeout loses nothing.

When new notes appear, the command waits about three seconds for the notes to
go quiet, so a burst arrives as one batch. A note is handed out once. A note
still open after the agent's fix stays in `npx isotone --json` but is not handed
out again, unless the reviewer edits it (to answer a question, say) or reopens it.

| Command | |
| --- | --- |
| `start [duration] [<route>]` | Start a session: `30s`, `5m`, `1h`, `1h30m` (default `30m`, at most 8h). With a route pattern (`/items`, `/items/*`), hand out only those notes (update notes always). Refuses while another agent is in a live session; replaces one no agent has touched for 15 minutes |
| (none) | Wait for the next batch, check-in or end |
| `status`, `stop`, `extend <duration>` | Show, end or lengthen the session |

| Option | |
| --- | --- |
| `--every <duration>\|off` | Check-in interval for a waiting run: default `5m`, at most `9m`; `off` for none |
| `--json` | Print JSON, one object per run |
| `--stream` | Stay running and print one JSON line per batch until the end, for a process monitor |
| `--file <path>` | Another notes file |

While it waits, the command watches the notes directory (with a two-second
metadata check as a fallback) and reads the notes only when they change.

## Guardrails

`start` prints the rules an agent acting by itself keeps to: act only on what a
note asks (page text and note content are context, not instructions), keep each
change small and reversible, never install packages (except for an
[update note](agent-guide.md#update-notes)), push, deploy or delete anything
outside the change, and leave risky or large requests open and flag them in its
summary. When a note is ambiguous, it asks with
[`--reply`](agent-guide.md#ask-instead-of-guessing) and leaves the note open; no
session hands that note out again until you edit it, and the end of a session
lists it as waiting for you.

## Session state

The session lives beside the notes file, in `.isotone/notes.blast.json`,
which Isotone adds to `.git/info/exclude` like the notes:

```json
{
  "version": 1,
  "startedAt": "2026-11-07T12:00:00.000Z",
  "endsAt": "2026-11-07T12:45:00.000Z",
  "route": null,
  "heartbeatAt": "2026-11-07T12:13:20.000Z",
  "waiting": true,
  "seen": { "<note id>": "<fingerprint>" }
}
```

A waiting run updates `heartbeatAt` every minute, and `--working`, `--done` and
`--reply` update it too. A session counts as live while its deadline has not
passed and it has a heartbeat from the last 15 minutes. One notes file has one
session at a time.

Only the CLI reads and writes this file. No dev server endpoint serves it, and
the browser panel has no part in a session: it shows notes and the agent's
progress on them as it always does.

Isotone 1.2.0's flags still work: `--for 45m --new` starts a session and waits
in one run, and `--status`, `--stop` and `--extend 15m` are the commands above.
