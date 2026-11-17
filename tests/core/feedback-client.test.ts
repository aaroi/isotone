import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeedbackStore } from '../../src/core/feedback-client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A browser's `window`, as much of it as the store reads. */
function browser() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    location: { origin: 'https://app.example', pathname: '/projects', search: '?tab=2', hash: '#top' },
    screen: { width: 1512, height: 982 },
    devicePixelRatio: 2,
    matchMedia: (query: string) => ({ matches: query.includes('dark') }),
  });
  return values;
}

/** An endpoint whose answers the test scripts; records every body it was sent. */
function endpoint(...answers: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const answer = answers.shift() ?? Response.json({ id: 'saved' }, { status: 201 });
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  );
  return bodies;
}

const store = (over: Partial<Parameters<typeof createFeedbackStore>[0]> = {}) =>
  createFeedbackStore({ endpoint: '/api/feedback', key: 'app', ...over });

/** An endpoint that answers each request only when the test lets it, in order. */
function heldEndpoint() {
  const sent: { id: string; feedback?: string; remove?: boolean }[] = [];
  const answers: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { id, feedback, remove } = JSON.parse(String(init?.body));
      sent.push({ id, ...(feedback ? { feedback } : {}), ...(remove ? { remove } : {}) });
      return new Promise<Response>((resolve) => answers.push(resolve));
    }),
  );
  const answer = (status = 201) => answers.shift()?.(Response.json({ id: 'x' }, { status }));
  return { sent, answer };
}

describe('a store that collects feedback', () => {
  it('posts a note once, signed, with the page and the browser around it', async () => {
    browser();
    const bodies = endpoint();
    const notes = store({ name: 'Ada Lovelace', release: 'a1b2c3d' });
    const pin = { tag: 'h1', text: 'Projects', selector: 'main > h1' };
    const id = await notes.saveNote(
      '/projects',
      '  Too tight  ',
      pin,
      null,
      { plan: 'pro' },
      { w: 1280, h: 720 },
      { elements: [pin], selections: { layout: 'grid' } },
    );
    expect(fetch).toHaveBeenCalledWith('/api/feedback', expect.objectContaining({ method: 'POST' }));
    expect(bodies).toEqual([
      {
        id,
        // A secret only this browser holds: what later lets it edit or delete the note.
        key: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/),
        createdAt: expect.any(String),
        author: 'Ada Lovelace',
        feedback: 'Too tight',
        route: '/projects',
        url: 'https://app.example/projects?tab=2',
        elements: [pin],
        selections: { layout: 'grid' },
        viewport: { w: 1280, h: 720 },
        browser: {
          language: expect.any(String),
          timezone: expect.any(String),
          screen: { w: 1512, h: 982 },
          pixelRatio: 2,
          colorScheme: 'dark',
          touch: false,
        },
        release: 'a1b2c3d',
        payload: { plan: 'pro' },
      },
    ]);
    // The list is what this browser sent; the endpoint is never read. The key stays out of what the panel is handed.
    const listed = await notes.pendingNotes();
    expect(listed).toMatchObject([{ id, route: '/projects', feedback: 'Too tight', elements: [pin], done: false }]);
    expect(listed[0]).not.toHaveProperty('key');
    expect((await notes.pollNotes(null)).notes).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('edits a note by sending it again under its id and key', async () => {
    browser();
    const bodies = endpoint();
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Frist', null, null, { plan: 'pro' });
    const edited = await notes.saveNote('/', 'First', null, id);
    expect(edited).toBe(id);
    expect(bodies).toMatchObject([
      { id, feedback: 'Frist', payload: { plan: 'pro' } },
      { id, key: bodies[0]?.key, createdAt: bodies[0]?.createdAt, feedback: 'First' },
    ]);
    // An edit sends no payload: the server keeps the one the note came with.
    expect(bodies[1]).not.toHaveProperty('payload');
    expect(await notes.pendingNotes()).toMatchObject([{ id, feedback: 'First' }]);
    // A note this browser no longer holds has no key here, so it cannot be changed from here.
    await expect(notes.saveNote('/', 'Whose?', null, 'someone-elses')).rejects.toThrow('cannot be edited here');
    expect(bodies).toHaveLength(2);
  });

  it('sends only the latest edit of a note that is still waiting', async () => {
    browser();
    const bodies = endpoint(new TypeError('offline'), new TypeError('offline'));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Draft', null, null);
    await notes.saveNote('/', 'Final', null, id);
    expect((await notes.pollNotes(null)).notes).toMatchObject([{ id, feedback: 'Final' }]);
    expect(bodies.map((body) => body.feedback)).toEqual(['Draft', 'Final', 'Final']);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('puts a refused edit back as it was', async () => {
    browser();
    endpoint(undefined as never, Response.json({ error: 'feedback is required' }, { status: 400 }));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Stays', null, null);
    await expect(notes.saveNote('/', 'Refused edit', null, id)).rejects.toThrow('Sending feedback failed (400)');
    expect(await notes.pendingNotes()).toMatchObject([{ id, feedback: 'Stays' }]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('will not send without a name', async () => {
    browser();
    const bodies = endpoint();
    const notes = store();
    await expect(notes.saveNote('/', 'Anonymous', null, null)).rejects.toThrow('A name is required');
    expect(bodies).toEqual([]);
  });

  it('starts the name from the app, else from what this browser last used', async () => {
    const values = browser();
    const typed = store();
    expect(typed.author.get()).toBe('');
    const heard = vi.fn();
    typed.author.subscribe(heard);
    typed.author.set('Grace Hopper');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store().author.get()).toBe('Grace Hopper');
    // The app knows who is signed in: its name leads, and an edit of it is not this browser's to keep.
    const known = store({ name: '  Ada Lovelace ' });
    expect(known.author.get()).toBe('Ada Lovelace');
    known.author.set('Ada');
    expect(known.author.get()).toBe('Ada');
    expect(values.get('app::author')).toBe('Grace Hopper');
    known.author.set('x'.repeat(300));
    expect(known.author.get()).toHaveLength(100);
  });

  it('keeps a note the endpoint could not take, and sends it again on a later poll', async () => {
    browser();
    const bodies = endpoint(new TypeError('Failed to fetch'), Response.json({ error: 'busy' }, { status: 503 }));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Written on a train', null, null);
    expect(notes.hasUnsyncedNotes).toBe(true);
    expect(await notes.pendingNotes()).toMatchObject([{ id }]);
    // Still down: the poll fails, so the panel waits longer before the next one.
    await expect(notes.pollNotes(null)).rejects.toThrow('waiting to be sent');
    expect(notes.hasUnsyncedNotes).toBe(true);
    // Back: the same record goes out, id and time unchanged, so the server stores it once.
    expect((await notes.pollNotes(null)).notes).toMatchObject([{ id }]);
    expect(notes.hasUnsyncedNotes).toBe(false);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    // A reload in between loses nothing: the outbox is in storage.
    expect(store({ name: 'Ada' }).hasUnsyncedNotes).toBe(false);
  });

  it('gives a refused note back to the reviewer instead of listing it as sent', async () => {
    browser();
    endpoint(Response.json({ error: 'feedback is required' }, { status: 400 }));
    const notes = store({ name: 'Ada' });
    await expect(notes.saveNote('/', 'Nope', null, null)).rejects.toThrow('Sending feedback failed (400): feedback is required');
    expect(await notes.pendingNotes()).toEqual([]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('drops a waiting note the endpoint refuses for good, once and loudly', async () => {
    browser();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    endpoint(new TypeError('offline'), new TypeError('offline'), Response.json({ error: 'route must start with /' }, { status: 400 }));
    const notes = store({ name: 'Ada' });
    await notes.saveNote('/', 'First', null, null);
    const second = await notes.saveNote('/', 'Second', null, null);
    expect((await notes.pollNotes(null)).notes).toMatchObject([{ id: second }]);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('deletes a note here and asks the endpoint to remove its row, with the key', async () => {
    browser();
    const bodies = endpoint();
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Never mind', null, null);
    await notes.deleteNote(id);
    expect(bodies[1]).toEqual({ id, key: bodies[0]?.key, remove: true });
    expect(await notes.pendingNotes()).toEqual([]);
    expect(notes.hasUnsyncedNotes).toBe(false);
    // Deleting what is not on this browser asks nothing of the endpoint.
    await notes.deleteNote('someone-elses');
    expect(bodies).toHaveLength(2);
  });

  it('removes a row later when the endpoint cannot be reached now, in place of the note still waiting', async () => {
    browser();
    const bodies = endpoint(new TypeError('offline'), new TypeError('offline'));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Written and withdrawn offline', null, null);
    await notes.deleteNote(id);
    expect(await notes.pendingNotes()).toEqual([]);
    expect(notes.hasUnsyncedNotes).toBe(true);
    await notes.pollNotes(null);
    // The note itself is not sent after all: only the removal, in case the first try did arrive.
    expect(bodies.map((body) => body.remove ?? false)).toEqual([false, true, true]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('keeps a note whose removal the endpoint refuses', async () => {
    browser();
    endpoint(undefined as never, Response.json({ error: 'this feedback store does not remove notes' }, { status: 400 }));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Cannot be removed', null, null);
    await expect(notes.deleteNote(id)).rejects.toThrow('Deleting feedback failed (400): this feedback store does not remove notes');
    expect(await notes.pendingNotes()).toMatchObject([{ id }]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('does not let a note the endpoint keeps turning away hold up the ones behind it', async () => {
    browser();
    const bodies = endpoint(
      Response.json({ error: 'boom' }, { status: 500 }),
      new TypeError('offline'),
      Response.json({ error: 'boom' }, { status: 500 }),
    );
    const notes = store({ name: 'Ada' });
    const stuck = await notes.saveNote('/', 'The server chokes on this', null, null);
    const fine = await notes.saveNote('/', 'This one is fine', null, null);
    // The first is turned away again, the second goes through: one still waits.
    await expect(notes.pollNotes(null)).rejects.toThrow('waiting to be sent');
    expect(bodies.map((body) => body.id)).toEqual([stuck, fine, stuck, fine]);
    expect(notes.hasUnsyncedNotes).toBe(true);
    expect((await notes.pendingNotes()).map((note) => note.id).sort()).toEqual([stuck, fine].sort());
  });

  it('gives up a note the endpoint has turned away for a week, and takes it off the list', async () => {
    const values = browser();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    endpoint(Response.json({}, { status: 403 }), Response.json({}, { status: 403 }));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Never arrives', null, null);
    const waiting = JSON.parse(values.get('app::outbox') ?? '[]');
    waiting[0].queuedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    values.set('app::outbox', JSON.stringify(waiting));
    expect((await notes.pollNotes(null)).notes).toEqual([]);
    expect(notes.hasUnsyncedNotes).toBe(false);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('turned away for a week'), expect.objectContaining({ id }));
  });

  it('does not retry for ever a waiting write that has lost its time', async () => {
    const values = browser();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    endpoint(Response.json({}, { status: 503 }));
    values.set('app::outbox', JSON.stringify([{ id: 'old', key: 'k'.repeat(32), remove: true }]));
    const notes = store({ name: 'Ada' });
    await notes.pollNotes(null);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('sends one request for a note even when a retry run starts while it is out', async () => {
    browser();
    const { sent, answer } = heldEndpoint();
    const notes = store({ name: 'Ada' });
    const saving = notes.saveNote('/', 'In flight', null, null);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    // The panel's poll finds the note in the outbox and waits its turn; by then there is nothing left to send.
    const polling = notes.pollNotes(null);
    answer();
    await saving;
    await polling;
    expect(sent).toHaveLength(1);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('never lets a retry of the old text land after an edit', async () => {
    browser();
    const offline = endpoint(new TypeError('offline'));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'v1', null, null);
    expect(offline).toHaveLength(1);
    const { sent, answer } = heldEndpoint();
    // A retry of v1 is out when the reviewer edits the note.
    const polling = notes.pollNotes(null);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const editing = notes.saveNote('/', 'v2', null, id);
    answer();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    answer();
    await Promise.all([polling, editing]);
    // In the order they were written, so the row ends as the edit.
    expect(sent.map((request) => request.feedback)).toEqual(['v1', 'v2']);
    expect(await notes.pendingNotes()).toMatchObject([{ id, feedback: 'v2' }]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('never lets a retry bring back a note that was deleted meanwhile', async () => {
    browser();
    endpoint(new TypeError('offline'));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Withdrawn', null, null);
    const { sent, answer } = heldEndpoint();
    const polling = notes.pollNotes(null);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const deleting = notes.deleteNote(id);
    answer();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    answer(200);
    await Promise.all([polling, deleting]);
    // The save that was already out lands first; the removal is the last word.
    expect(sent).toEqual([
      { id, feedback: 'Withdrawn' },
      { id, remove: true },
    ]);
    expect(await notes.pendingNotes()).toEqual([]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('keeps a note the endpoint has, when a later edit of it is given up', async () => {
    const values = browser();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    endpoint(undefined as never, Response.json({}, { status: 503 }), Response.json({}, { status: 503 }));
    const notes = store({ name: 'Ada' });
    const id = await notes.saveNote('/', 'Arrived long ago', null, null);
    // Written nine days ago, as the list remembers it; edited now, while the database sleeps.
    const kept = JSON.parse(values.get('app::sent') ?? '[]');
    kept[0].createdAt = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    values.set('app::sent', JSON.stringify(kept));
    await notes.saveNote('/', 'Edited today', null, id);
    // The edit is a new write: its week starts now, whatever the note's age.
    await expect(notes.pollNotes(null)).rejects.toThrow('waiting to be sent');
    expect(notes.hasUnsyncedNotes).toBe(true);
    // And when an edit is given up in the end, the note itself stays: its row and key are still good.
    const waiting = JSON.parse(values.get('app::outbox') ?? '[]');
    waiting[0].queuedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    values.set('app::outbox', JSON.stringify(waiting));
    endpoint(Response.json({}, { status: 503 }));
    expect((await notes.pollNotes(null)).notes).toMatchObject([{ id }]);
    expect(notes.hasUnsyncedNotes).toBe(false);
  });

  it('says so when the endpoint is on another origin than the page', () => {
    browser();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (window as unknown as { location: { href: string } }).location.href = 'https://app.example/projects';
    store({ endpoint: '/api/feedback' });
    store({ endpoint: 'https://app.example/api/feedback' });
    expect(warned).not.toHaveBeenCalled();
    store({ endpoint: 'http://localhost:4320/api/feedback' });
    expect(warned).toHaveBeenCalledWith(expect.stringContaining('another origin'));
  });

  it('keeps a note in the composer when it can be neither sent nor kept for later', async () => {
    browser();
    endpoint(new TypeError('offline'));
    const notes = store({ name: 'Ada' });
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    await expect(notes.saveNote('/', 'Private window, no network', null, null)).rejects.toThrow('cannot keep it for later');
  });

  it('stops queueing past fifty waiting notes', async () => {
    const values = browser();
    values.set('app::outbox', JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ id: `waiting-${index}`, key: 'k' }))));
    const bodies = endpoint();
    await expect(store({ name: 'Ada' }).saveNote('/', 'One too many', null, null)).rejects.toThrow('already waiting');
    expect(bodies).toEqual([]);
  });

  it('keeps a note before sending it, so a tab closed mid-request loses nothing', async () => {
    const values = browser();
    let kept: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        kept = JSON.parse(values.get('app::outbox') ?? '[]');
        return Response.json({ id: 'x' }, { status: 201 });
      }),
    );
    const id = await store({ name: 'Ada' }).saveNote('/', 'Half way', null, null);
    expect(kept).toMatchObject([{ id, feedback: 'Half way' }]);
    expect(values.has('app::outbox')).toBe(false);
  });

  it('still sends where storage is blocked or holds something else', async () => {
    const values = browser();
    values.set('app::sent', '{"not":"a list"}');
    values.set('app::outbox', 'garbage');
    const bodies = endpoint();
    const notes = store({ name: 'Ada' });
    expect(await notes.pendingNotes()).toEqual([]);
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    await notes.saveNote('/', 'Private window', null, null);
    expect(bodies).toHaveLength(1);
    expect(await notes.pendingNotes()).toEqual([]);
  });
});
