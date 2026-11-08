# Isotone

Ask your coding agent for design variants, switch between them in your running
app, and pin feedback to the exact elements you want changed.

![Switching layout, spacing and colour variants, pinning a card with a note, and an agent picking the note up and closing it](https://raw.githubusercontent.com/aaroi/isotone/main/docs/assets/loop.gif)

Isotone is not an agent, an MCP server or an AI product. It is a small review
panel that runs inside your app during development, and it works with the coding
agent you already use: the agent runs a few CLI commands and reads a JSON file.
Nothing is added to production.

Try it in your browser at [isotone.vercel.app](https://isotone.vercel.app). Nothing to install.

## How it works

Isotone adds a small panel to your app while it runs in development.

Ask your agent for variants of anything on the page: a layout, a spacing scale,
a colour, a component. They appear in the panel's Variants tab as thumbnails,
segmented choices, colour swatches or sliders, and switching one updates the
live page. Save your picks as the defaults for the agent to apply, or leave
feedback on a single option.

![The Variants panel with thumbnail, segmented, colour and range selectors above the feedback notes](https://raw.githubusercontent.com/aaroi/isotone/main/docs/assets/preview.png)

When something needs changing, open Feedback with **⌘/Ctrl + Shift + .**, click
the elements you mean, write the change and send. Each note is saved to a JSON
file in your project with the page route, the viewport size, and a selector and
the text of every element you pinned.

Your agent reads the notes with `npx isotone --json`, makes the changes, and
closes each note when it's done. The panel marks the note the agent is working
on and updates without a reload, so you can keep adding notes while it works.

Comparing design directions one prompt at a time is slow, and so is describing
UI in words. Element pickers built into agents work only in the agent's own
browser; Isotone works in yours, with any agent that can run a command.

## Get started

Isotone needs Node.js 22 or later. Pick one of these ways to start.

### Start with your agent

The quickest way. In your project, give this to Claude Code, Cursor, Codex or any
agent that can run commands. Name the page you're working on:

```text
Set up Isotone (https://github.com/aaroi/isotone) in this project, for development
only. Install the `isotone` package as a dev dependency, run `npx isotone init --yes`,
apply the setup it prints and do its first run on <the page I'm working on>. Then
tell me what to open and try.
```

The agent adds the panel behind your framework's development check, makes two
real variants of something on that page, and tells you where to look. Switch them
in the panel, pin a note on anything you want changed, then tell the agent to
check your Isotone notes.

### Set it up yourself

```sh
npm install -D isotone
npx isotone init
```

`init` looks at your project and prints the one change to make: on Vite, a
plugin line that only acts on the dev server; on any other dev server, a small
local server and a script tag that loads only on localhost. `init --yes` also
adds a short section to `AGENTS.md` that teaches your agent the loop. The
[integration guide](docs/integrations.md) covers every setup and how each stays
out of production. Isotone works only on the machine running the dev server.

## Blast mode

Once Isotone is set up, ask your agent for a [Blast session](docs/blast.md): for
the time you choose, it keeps picking up each batch of new notes, fixing and
closing them, without being prompted again. Isotone still never runs the agent;
it hands your agent the notes.

## Keys

**Enter** sends a note and **Shift + Enter** adds a newline. Click a saved note
to edit it. Opening Feedback with the mouse or **⌘/Ctrl + Shift + .** starts
select mode. With Feedback open, the same shortcut starts select mode again, or
finishes it if it's on. In select mode, click to pin or unpin, hold
**Shift** to use the page normally, and press **Enter** to finish or **Escape**
to clear what you pinned. After a pin, the note field opens next to the element
you clicked, and you can start typing right away. Once you're done selecting,
**Escape** moves the field back into the panel.

## Updates

The dev server checks npm for a newer version at most once a day, sending no
project content. When one is out, **Ask agent to update** in the panel files a
note your agent picks up with the others; nothing installs by itself.
`checkForUpdates: false` turns it off ([details](docs/updates.md)).

## For agents and maintainers

Coding agents working in your app follow the [agent guide](docs/agent-guide.md).
[Development and contributing](https://github.com/aaroi/isotone/blob/main/docs/development.md)
covers changing Isotone itself.

MIT.
