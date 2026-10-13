import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { notesResponse, updateNotes, writeNotes } from '../src/store';
import { iteration } from '../src/vite/index';
import { checkOrigin, readNodeJson, sendFailure } from '../src/server/http';

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
        const notes: Parameters<typeof writeNotes>[1] = [{
          id: 'demo-card-spacing', route: '/',
          feedback: 'Give the cards a little more room.',
          element: { tag: 'section', text: 'Overview cards', selector: '#overview-cards' },
          done: false, doneAt: null, createdAt: new Date().toISOString(),
        }];
        if (session === 'light' || session === 'dark') {
          // The README image: one note the agent is working on, one waiting.
          notes[0].workingAt = new Date().toISOString();
          notes.push({
            id: 'demo-capture-label', route: '/',
            feedback: 'Shorten this to "Active".',
            element: { tag: 'p', text: 'Active projects', selector: '#overview-cards article p' },
            done: false, doneAt: null, createdAt: new Date(Date.now() + 1000).toISOString(),
          });
        }
        if (session === 'interactive') {
          const examples = [
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
          elsewhere.forEach(([route, feedback, text], index) => { notes.push({
            id: `demo-elsewhere-${index}`, route, feedback,
            element: { tag: 'section', text, selector: '#overview-cards' },
            done: false, doneAt: null,
            createdAt: new Date(Date.now() + (index + 20) * 1000).toISOString(),
          }); });
          examples.forEach(([feedback, text], index) => { notes.push({
            id: `demo-review-${index}`, route: '/', feedback,
            element: { tag: 'section', text, selector: '#overview-cards' },
            done: false, doneAt: null,
            createdAt: new Date(Date.now() + (index + 1) * 1000).toISOString(),
          }); });
        }
        if (session === 'stress') {
          for (let index = 1; index < 500; index++) notes.push({
            id: `stress-note-${index}`, route: '/',
            feedback: index === 499
              ? `Long feedback ${'with detailed context '.repeat(450)}`
              : `Review item ${index}: ${'A long unbroken label '.replaceAll(' ', '').repeat(index % 20 === 0 ? 60 : 3)}`,
            element: { tag: 'section', text: `Overview card ${index}`, selector: '#overview-cards' },
            done: false, doneAt: null,
            createdAt: new Date(Date.now() + index * 1000).toISOString(),
          });
        }
        writeNotes(file, notes);
      }
      server.httpServer?.once('close', () => rmSync(directory, { recursive: true, force: true }));
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/demo-update' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            currentVersion: '0.3.4', latestVersion: '0.4.0', status: 'available',
            upgrade: { manager: 'pnpm', command: 'pnpm add -D --exact isotone@0.4.0', cwd: '/workspace/example-app' },
          }));
          return;
        }
        // Stands in for an agent: `start` is `isotone --working` on the oldest
        // open note nobody has started, `finish` is `--done` on the oldest started one.
        if ((req.url ?? '').startsWith('/demo-agent') && req.method === 'POST') {
          try { checkOrigin(req.headers.origin, req.headers.host ?? ''); } catch (error) { sendFailure(res, error); return; }
          const action = new URL(req.url ?? '', 'http://x').searchParams.get('action');
          const file = files.get('/demo-notes/interactive') as string;
          const route = new URL(req.url ?? '', 'http://x').searchParams.get('route');
          let touched = '';
          updateNotes(file, (notes) => {
            if (action === 'reset') {
              for (const n of notes) { n.done = false; n.doneAt = null; delete n.workingAt; }
              return notes;
            }
            const open = notes.filter((n) => !n.done && (!route || n.route === route))
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            const target = action === 'start' ? open.find((n) => !n.workingAt) : open.find((n) => n.workingAt);
            if (!target) return notes;
            touched = target.id;
            if (action === 'start') target.workingAt = new Date().toISOString();
            else { target.done = true; target.doneAt = new Date().toISOString(); delete target.workingAt; }
            return notes;
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, touched }));
          return;
        }
        const file = files.get((req.url ?? '').split('?')[0]);
        if (!file) { next(); return; }
        try {
          checkOrigin(req.headers.origin, req.headers.host ?? '');
          const body = req.method === 'POST' ? await readNodeJson(req) : undefined;
          const result = notesResponse(file, { method: req.method, url: req.url, body });
          res.writeHead(result.status, result.headers);
          res.end(JSON.stringify(result.body));
        } catch (error) { sendFailure(res, error); }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [demoNotes(), iteration({
      panel: false,
      variants: { root: '..' },
      file: join(tmpdir(), 'isotone-demo-adapter.json'),
    })],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  // `pnpm build:demo` builds the hosted demo; it keeps notes in the browser.
  build: { outDir: '../demo-dist', emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('index.html', import.meta.url)) } },
});
