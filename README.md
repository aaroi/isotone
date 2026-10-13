# Isotone

Point at the part of your app you want changed, say what should change, and your
coding agent gets the exact element, page and screen size with your note.

![A running app with one pinned element and the Isotone feedback panel](docs/assets/preview.jpg)

## Why

Coding agents write UI fast, but telling one which piece of UI you mean is slow.
You type "the label above the number in the first stats card", the agent guesses
a component, and the next round goes to correcting the guess. Comparing two
design directions is worse: you ask for one, review it, ask for the other, and
try to remember what the first looked like.

Some agents let you select an element, Claude Code among them, but only inside
the browser they ship with. You lose your own browser with its sign-ins,
extensions, devtools and window sizes, and each selection lives in a single chat
message.

Isotone is a purpose-built tool for design engineering with a coding agent. It
runs in your dev server and adds a small panel to the page you already have open:

- Pin one or more elements and write a note. The note records the route, the
  viewport, and a selector and the visible text of every pinned element.
- Keep a backlog. Notes go to a JSON file in your project, so you can keep
  writing while the agent works through them.
- Follow progress. The agent marks a note as started and closes it when the
  change is verified, and the panel updates without a reload.
- Compare variants. The agent can build two or three versions of a component.
  You switch between them on the live page, comment on one, or keep the default.
- Use any agent. Agents read notes with `npx isotone --json`, so nothing depends
  on a particular agent, editor or browser.

There is no account, database or hosted service, and nothing is added to
production builds.

## Install

Run in the project you want to review:

```sh
npm install -D isotone
npx isotone init --yes
```

`init` detects your setup, prints the integration to add, and adds a short
workflow to `AGENTS.md` so your agent knows the loop. It does not edit app code.

For **Vite**, add the plugin next to your existing plugins. It works with any
Vite framework:

```ts
import { defineConfig } from 'vite';
import { iteration } from 'isotone/vite';

export default defineConfig({
  plugins: [/* your framework plugin */, iteration()],
});
```

For **any other dev server**, run `npx isotone serve` and add this to your
development HTML:

```html
<script src="http://127.0.0.1:4123/isotone.js" defer></script>
```

The [integration guide](docs/integrations.md) covers Next and other route
handlers, React embeds, themes and production guards. Node.js 20 or later is
required. Coming from the previous package? See the [migration guide](docs/migration.md).

## The loop

1. Open Feedback with **⌘/Ctrl + Shift + .**, pin elements, write a note and send.
2. Your agent reads `npx isotone --json`, marks the note it starts with
   `npx isotone --working <id>`, makes and checks the change, then closes it
   with `npx isotone --done <id>`.
3. Review the result on the page. For alternatives, ask for
   [variants](docs/variants.md) and switch between them in place.

The panel lists the current page's notes. When other pages have open notes,
page chips let you include them. Click a saved note to edit it. **Enter** sends
and **Shift + Enter** adds a newline. While selecting, click to pin, hold
**Shift** to use the page normally, and press Enter or Escape to finish.

## Updates

The dev server checks npm for a newer version at most once a day and shows the
upgrade command in the panel. The check sends no project content and stays quiet
offline. Set `checkForUpdates: false` to turn it off. [Update details](docs/updates.md).

## For maintainers

[Development and contributing](https://github.com/aaroi/isotone/blob/main/docs/development.md)
covers the source, design language, checks and releases.

MIT.
