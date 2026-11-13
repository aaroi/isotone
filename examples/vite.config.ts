import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { notesResponse } from '../src/node/notes/handler';
import { updateNotes, writeNotes } from '../src/node/notes/store';
import { isotone } from '../src/vite/index';
import { checkRequest, nodeRequestFacts, readNodeJson, sendFailure } from '../src/node/http';
import type { UpdateInfo } from '../src/core/update';
import { updateResponse } from '../src/node/update/note';

/**
 * Not a real release: the demo never contacts npm or installs anything. The
 * directory is the demo's own notes directory, since an update note may only
 * name one inside its notes file's project.
 */
const demoUpdate = (cwd: string): UpdateInfo => ({
  currentVersion: '1.1.3',
  latestVersion: '1.2.0',
  status: 'available',
  upgrade: { manager: 'pnpm', command: 'pnpm add -D --exact isotone@1.2.0', cwd },
});

/** Real notes transport, isolated from every project's review data. */
function demoNotes(): Plugin {
  return {
    name: 'isotone-demo-notes',
    configureServer(server) {
      const directory = mkdtempSync(join(tmpdir(), 'isotone-demo-'));
      const files = new Map<string, string>();
      for (const session of ['interactive', 'light', 'dark', 'stress']) {
        const file = join(directory, `${session}.json`);
        files.set(`/demo-notes/${session}`, file);
        const notes: Parameters<typeof writeNotes>[1] = [
          {
            id: 'demo-card-spacing',
            route: '/',
            feedback: 'Give the cards a little more room.',
            element: { tag: 'section', text: 'Overview cards', selector: '#overview-cards' },
            done: false,
            doneAt: null,
            createdAt: new Date().toISOString(),
            // The README image: one note the agent is working on, one waiting.
            ...(session === 'light' || session === 'dark' ? { workingAt: new Date().toISOString() } : {}),
            // Written with a knob moved: the note says so, for the agent and in the panel.
            ...(session === 'interactive' ? { knobs: { 'card-padding': '24' } } : {}),
          },
        ];
        if (session === 'light' || session === 'dark') {
          notes.push({
            id: 'demo-capture-label',
            route: '/',
            feedback: 'Shorten this to "Active".',
            element: { tag: 'p', text: 'Active projects', selector: '#overview-cards article p' },
            done: false,
            doneAt: null,
            createdAt: new Date(Date.now() + 1000).toISOString(),
          });
        }
        if (session === 'interactive') {
          const examples: [feedback: string, text: string][] = [
            ['Make the empty state more useful.', 'Projects'],
            ['Keep the filters visible when scrolling.', 'Project filters'],
            ['The status label needs more contrast.', 'Project status'],
            ['Align these values with their headings.', 'Overview cards'],
            ['Try a quieter colour for the secondary action.', 'New project'],
            ['Use the same spacing between all cards.', 'Overview cards'],
            ['Keep this title on one line when the window is narrow.', 'Workspace overview'],
          ];
          // Notes on other pages, so the page chips have something to show.
          const elsewhere: [string, string, string][] = [
            ['/pricing', 'The plan names are too similar.', 'Plans'],
            ['/pricing', 'Show the yearly saving next to the toggle.', 'Billing toggle'],
            ['/settings', 'Group the notification options.', 'Notifications'],
          ];
          elsewhere.forEach(([route, feedback, text], index) => {
            notes.push({
              id: `demo-elsewhere-${index}`,
              route,
              feedback,
              element: { tag: 'section', text, selector: '#overview-cards' },
              done: false,
              doneAt: null,
              createdAt: new Date(Date.now() + (index + 20) * 1000).toISOString(),
            });
          });
          examples.forEach(([feedback, text], index) => {
            notes.push({
              id: `demo-review-${index}`,
              route: '/',
              feedback,
              element: { tag: 'section', text, selector: '#overview-cards' },
              done: false,
              doneAt: null,
              createdAt: new Date(Date.now() + (index + 1) * 1000).toISOString(),
            });
          });
        }
        if (session === 'stress') {
          for (let index = 1; index < 500; index++)
            notes.push({
              id: `stress-note-${index}`,
              route: '/',
              feedback:
                index === 499
                  ? `Long feedback ${'with detailed context '.repeat(450)}`
                  : `Review item ${index}: ${'A long unbroken label '.replaceAll(' ', '').repeat(index % 20 === 0 ? 60 : 3)}`,
              element: { tag: 'section', text: `Overview card ${index}`, selector: '#overview-cards' },
              done: false,
              doneAt: null,
              createdAt: new Date(Date.now() + index * 1000).toISOString(),
            });
        }
        writeNotes(file, notes);
      }
      server.httpServer?.once('close', () => rmSync(directory, { recursive: true, force: true }));
      server.middlewares.use(async (req, res, next) => {
        // `?update-preview=1`: a fictional update. Asking the agent files a real
        // update note in the session's notes, built by the same server code.
        const preview = /^\/demo-update\/([a-z]+)$/.exec((req.url ?? '').replace(/\?.*$/s, ''));
        if (preview) {
          try {
            checkRequest(nodeRequestFacts(req));
            const body = req.method === 'POST' ? await readNodeJson(req) : undefined;
            const result = updateResponse(files.get(`/demo-notes/${preview[1]}`) ?? null, demoUpdate(directory), {
              method: req.method,
              body,
            });
            res.writeHead(result.status, result.headers);
            res.end(JSON.stringify(result.body));
          } catch (error) {
            sendFailure(res, error);
          }
          return;
        }
        // The pretend agent: `start` is `isotone --working` on one note, `finish` is `--done`.
        if ((req.url ?? '').startsWith('/demo-agent') && req.method === 'POST') {
          try {
            checkRequest(nodeRequestFacts(req));
          } catch (error) {
            sendFailure(res, error);
            return;
          }
          const query = new URL(req.url ?? '', 'http://x').searchParams;
          const action = query.get('action');
          const sessionNotes = files.get(`/demo-notes/${query.get('session') ?? ''}`);
          // A reload forgets what the pretend agent was doing, so nothing it
          // marked as being worked on will ever finish: clear it.
          if (sessionNotes && action === 'reset') {
            updateNotes(sessionNotes, (notes) => notes.map(({ workingAt: _stale, ...note }) => note));
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          for (const file of files.values())
            updateNotes(file, (notes) => {
              const target = notes.find((n) => n.id === query.get('id') && !n.done);
              if (!target) return notes;
              if (action === 'start') target.workingAt = new Date().toISOString();
              else {
                target.done = true;
                target.doneAt = new Date().toISOString();
                delete target.workingAt;
              }
              return notes;
            });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        const file = files.get((req.url ?? '').replace(/\?.*$/s, ''));
        if (!file) {
          next();
          return;
        }
        try {
          checkRequest(nodeRequestFacts(req));
          const body = req.method === 'POST' ? await readNodeJson(req) : undefined;
          const result = notesResponse(file, { method: req.method, url: req.url, body });
          res.writeHead(result.status, result.headers);
          res.end(JSON.stringify(result.body));
        } catch (error) {
          sendFailure(res, error);
        }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    demoNotes(),
    isotone({
      panel: false,
      variants: { root: '..' },
      file: join(tmpdir(), 'isotone-demo-adapter.json'),
    }),
  ],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  // `pnpm build:demo` builds the hosted demo; it keeps notes in the browser.
  build: { outDir: '../demo-dist', emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('index.html', import.meta.url)) } },
});
