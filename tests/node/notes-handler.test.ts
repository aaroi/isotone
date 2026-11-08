import { rmSync } from 'node:fs';

import { afterEach, assert, describe, expect, it } from 'vitest';

import { notesResponse } from '../../src/node/notes/handler';
import { readNotes, updateNotes } from '../../src/node/notes/store';
import { PAYLOAD_MAX } from '../../src/core/limits';
import { tempNotesFile } from '../helpers/fs';

const dirs: string[] = [];
function tempFile() {
  return tempNotesFile(dirs);
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
    expect(rows[0]?.feedback).toBe('hi');

    expect(
      notesResponse(file, {
        method: 'DELETE',
        url: `/api/notes?id=${id.id}`,
      }).status,
    ).toBe(200);
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
    expect(notesResponse(file, { method: 'GET', url: '/api/notes' }).status).toBe(200);
  });
});

describe('notes revision polling', () => {
  it('answers a repeat poll with no rows until the notes change', () => {
    const file = tempFile();
    notesResponse(file, { method: 'POST', url: '/api/notes', body: { route: '/', feedback: 'one' } });
    const first = notesResponse(file, { method: 'GET', url: '/api/notes?all=1&rev=' }).body as { rev: string; notes: unknown[] };
    expect(first.notes).toHaveLength(1);
    const same = notesResponse(file, { method: 'GET', url: `/api/notes?all=1&rev=${first.rev}` }).body;
    expect(same).toEqual({ rev: first.rev, unchanged: true });
    notesResponse(file, { method: 'POST', url: '/api/notes', body: { route: '/', feedback: 'two' } });
    const next = notesResponse(file, { method: 'GET', url: `/api/notes?all=1&rev=${first.rev}` }).body as { rev: string; notes: unknown[] };
    expect(next.rev).not.toBe(first.rev);
    expect(next.notes).toHaveLength(2);
  });

  it('polls only the open backlog and notices a closed note', () => {
    const file = tempFile();
    notesResponse(file, { method: 'POST', url: '/api/notes', body: { id: 'a', route: '/', feedback: 'one' } });
    const first = notesResponse(file, { method: 'GET', url: '/api/notes?rev=' }).body as { rev: string; notes: { id: string }[] };
    updateNotes(file, (notes) => notes.map((n) => ({ ...n, done: true })));
    const next = notesResponse(file, { method: 'GET', url: `/api/notes?rev=${first.rev}` }).body as { rev: string; notes: unknown[] };
    expect(next.notes).toEqual([]);
  });

  it('answers a missing file with a stable empty revision', () => {
    const file = tempFile();
    const first = notesResponse(file, { method: 'GET', url: '/api/notes?rev=' }).body as { rev: string };
    expect(notesResponse(file, { method: 'GET', url: `/api/notes?rev=${first.rev}` }).body).toEqual({ rev: first.rev, unchanged: true });
  });

  it('keeps answering a plain list when no revision is asked for', () => {
    const file = tempFile();
    expect(notesResponse(file, { method: 'GET', url: '/api/notes?all=1' }).body).toEqual([]);
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

    expect(readNotes(file)[0]?.payload).toEqual({ variants });
    const rows = notesResponse(file, { method: 'GET', url: '/api/notes?route=buttons' }).body as Array<{
      payload?: { variants: Record<string, string> };
    }>;
    expect(rows[0]?.payload).toEqual({ variants });
  });

  it('keeps a stored payload when a later autosave omits it', () => {
    const file = tempFile();
    const id = (
      create(file, {
        route: '/x',
        feedback: 'v1',
        element: null,
        payload: { variants },
      }).body as { id: string }
    ).id;

    create(file, { id, route: '/x', feedback: 'v2', element: null });

    const [note] = readNotes(file);
    expect(note?.feedback).toBe('v2');
    expect(note?.payload).toEqual({ variants });
  });

  it('leaves the field absent, not null, for a host that never sends one', () => {
    const file = tempFile();
    create(file, { route: '/x', feedback: 'plain', element: null });
    const [stored] = readNotes(file);
    assert(stored);
    expect('payload' in stored).toBe(false);
    const [row] = notesResponse(file, { method: 'GET', url: '/api/notes?route=/x' }).body as Array<Record<string, unknown>>;
    assert(row);
    expect('payload' in row).toBe(false);
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
    expect(create(file, { route: '/x', feedback: 'loop', element: null, payload: circular }).status).toBe(400);

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
    expect(readNotes(file)[0]?.viewport).toEqual({ w: 900, h: 620 });
    const rows = notesResponse(file, { method: 'GET', url: '/api/notes?route=/x' }).body as Array<{ viewport?: { w: number; h: number } }>;
    expect(rows[0]?.viewport).toEqual({ w: 900, h: 620 });
  });

  it('survives an edit and stays absent when never sent', () => {
    const file = tempFile();
    const id = (
      create(file, {
        route: '/x',
        feedback: 'v1',
        element: null,
        viewport: { w: 375, h: 812 },
      }).body as { id: string }
    ).id;
    create(file, { id, route: '/x', feedback: 'v2', element: null });
    expect(readNotes(file)[0]?.viewport).toEqual({ w: 375, h: 812 });

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
