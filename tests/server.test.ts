import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { notesResponse, readNotes } from '../src/store';
import * as server from '../src/server/index';
import { PAYLOAD_MAX, serveNotesRequest } from '../src/server/index';

const dirs: string[] = [];
function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'iso-iterate-'));
  dirs.push(dir);
  return join(dir, 'notes.json');
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('notesResponse (transport-agnostic)', () => {
  it('creates, lists by route, and deletes a note', () => {
    const file = tempFile();

    const created = notesResponse(file, {
      method: 'POST',
      url: '/api/notes',
      body: { route: '/projects', feedback: 'hi', element: null },
    });
    expect(created.status).toBe(201);
    const id = created.body as { id: string };

    const listed = notesResponse(file, {
      method: 'GET',
      url: '/api/notes?route=/projects',
    });
    const rows = listed.body as Array<{ id: string; feedback: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback).toBe('hi');

    expect(notesResponse(file, {
      method: 'DELETE',
      url: `/api/notes?id=${id.id}`,
    }).status).toBe(200);
    expect(readNotes(file)).toHaveLength(0);
  });

  it('validates and rejects empty feedback', () => {
    const file = tempFile();
    const r = notesResponse(file, {
      method: 'POST',
      url: '/api/notes',
      body: { route: '/x', feedback: '   ', element: null },
    });
    expect(r.status).toBe(400);
  });

  it('holds a 200 with an empty note list', () => {
    const file = tempFile();
    expect(notesResponse(file, { method: 'GET', url: '/api/notes' }).status).toBe(
      200,
    );
  });
});

describe('serveNotesRequest (fetch/gitworker adapter)', () => {
  it('handles a Web Request against the same store', async () => {
    const file = tempFile();
    const req = new Request('http://localhost:3000/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        route: '/',
        feedback: 'web request note',
        element: { tag: 'button', text: 'Go', selector: 'button:first-child' },
      }),
    });
    const res = await serveNotesRequest(file, req);
    expect(res.status).toBe(201);
    expect((res.body as { id: string }).id).toMatch(/^[0-9a-f-]+$/);

    const listed = await serveNotesRequest(
      file,
      new Request('http://localhost:3000/api/notes?route=/'),
    );
    const rows = listed.body as Array<{ element: { selector: string } | null }>;
    expect(rows[0].element?.selector).toBe('button:first-child');
  });
});

describe('the ./server subpath surface', () => {
  // The framework-agnostic story rests on `notesResponse` being reachable
  // without importing vite — a regression here surfaced as "Export named
  // 'notesResponse' not found" at a consumer's module load.
  it('re-exports every symbol a non-Vite host serves the endpoint with', () => {
    for (const name of [
      'notesResponse',
      'serveNotesRequest',
      'readNotes',
      'writeNotes',
      'ensureFileIgnored',
      'NOTES_ENDPOINT',
      'PAYLOAD_MAX',
    ]) {
      expect(server, name).toHaveProperty(name);
    }
  });
});

describe('the opaque payload', () => {
  const variants = { radius: '26', 'pad-x': '28', 'text-size': '15' };

  function create(file: string, body: Record<string, unknown>) {
    return notesResponse(file, { method: 'POST', url: '/api/notes', body });
  }

  it('round-trips host context verbatim through store and endpoint', () => {
    const file = tempFile();
    const created = create(file, {
      route: 'buttons',
      feedback: 'use Get started as the default label',
      element: null,
      payload: { variants },
    });
    expect(created.status).toBe(201);

    expect(readNotes(file)[0].payload).toEqual({ variants });
    const rows = notesResponse(file, { method: 'GET', url: '/api/notes?route=buttons' })
      .body as Array<{ payload?: { variants: Record<string, string> } }>;
    expect(rows[0].payload).toEqual({ variants });
  });

  it('keeps a stored payload when a later autosave omits it', () => {
    const file = tempFile();
    const id = (create(file, {
      route: '/x',
      feedback: 'v1',
      element: null,
      payload: { variants },
    }).body as { id: string }).id;

    create(file, { id, route: '/x', feedback: 'v2', element: null });

    const [note] = readNotes(file);
    expect(note.feedback).toBe('v2');
    expect(note.payload).toEqual({ variants });
  });

  it('leaves the field absent, not null, for a host that never sends one', () => {
    const file = tempFile();
    create(file, { route: '/x', feedback: 'plain', element: null });
    expect('payload' in readNotes(file)[0]).toBe(false);
    const rows = notesResponse(file, { method: 'GET', url: '/api/notes?route=/x' })
      .body as Array<Record<string, unknown>>;
    expect('payload' in rows[0]).toBe(false);
  });

  it('rejects an oversized or circular payload instead of storing it', () => {
    const file = tempFile();
    const oversized = create(file, {
      route: '/x',
      feedback: 'big',
      element: null,
      payload: { blob: 'x'.repeat(PAYLOAD_MAX) },
    });
    expect(oversized.status).toBe(400);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      create(file, { route: '/x', feedback: 'loop', element: null, payload: circular })
        .status,
    ).toBe(400);

    expect(readNotes(file)).toHaveLength(0);
  });
});

describe('the viewport', () => {
  function create(file: string, body: Record<string, unknown>) {
    return notesResponse(file, { method: 'POST', url: '/api/notes', body });
  }

  it('rides on a note and comes back on GET', () => {
    const file = tempFile();
    create(file, {
      route: '/x',
      feedback: 'nav wraps at this width',
      element: null,
      viewport: { w: 900, h: 620 },
    });
    expect(readNotes(file)[0].viewport).toEqual({ w: 900, h: 620 });
    const rows = notesResponse(file, { method: 'GET', url: '/api/notes?route=/x' })
      .body as Array<{ viewport?: { w: number; h: number } }>;
    expect(rows[0].viewport).toEqual({ w: 900, h: 620 });
  });

  it('survives an edit and stays absent when never sent', () => {
    const file = tempFile();
    const id = (create(file, {
      route: '/x',
      feedback: 'v1',
      element: null,
      viewport: { w: 375, h: 812 },
    }).body as { id: string }).id;
    create(file, { id, route: '/x', feedback: 'v2', element: null });
    expect(readNotes(file)[0].viewport).toEqual({ w: 375, h: 812 });

    create(file, { route: '/y', feedback: 'plain', element: null });
    const plain = readNotes(file).find((n) => n.route === '/y');
    expect(plain && 'viewport' in plain).toBe(false);
  });

  it('drops garbage instead of storing it', () => {
    const file = tempFile();
    for (const viewport of [{ w: -1, h: 500 }, { w: 'x', h: 2 }, [1, 2], 'wide']) {
      create(file, { route: '/x', feedback: 'n', element: null, viewport });
    }
    expect(readNotes(file).every((n) => !('viewport' in n))).toBe(true);
  });
});
