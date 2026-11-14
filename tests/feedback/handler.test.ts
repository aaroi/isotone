import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FEEDBACK_BODY } from '../../src/core/feedback';
import { MAX_FEEDBACK_LENGTH } from '../../src/core/limits';
import { type FeedbackEntry, feedback } from '../../src/feedback/index';

afterEach(() => vi.restoreAllMocks());

const URL_ = 'https://app.example/api/feedback';
const KEY = 'k'.repeat(32);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const note = { id: 'note-1', key: KEY, author: 'Ada Lovelace', feedback: 'The title wraps badly', route: '/projects' };

function post(body: unknown, headers: Record<string, string> = {}, url = URL_) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.example', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function collector(options: Partial<Parameters<typeof feedback>[0]> = {}) {
  const saved: FeedbackEntry[] = [];
  const removed: [id: string, keyHash: string][] = [];
  const handle = feedback({
    store: { save: (entry) => void saved.push(entry), remove: (id, keyHash) => void removed.push([id, keyHash]) },
    ...options,
  });
  return { saved, removed, handle };
}

describe('the feedback route', () => {
  it('saves a note with what the browser and the request say about it', async () => {
    const { saved, handle } = collector();
    const response = await handle(
      post(
        {
          ...note,
          url: 'https://user:secret@app.example/projects?tab=2#top',
          elements: [{ tag: 'h1', text: 'Projects', selector: 'main > h1', styles: { 'font-size': '32px' } }, { tag: 'p' }],
          variant: { axisId: 'layout', label: 'Layout', optionId: 'grid', optionLabel: 'Grid' },
          selections: { layout: 'grid', density: 'cosy', bad: 3 },
          viewport: { w: 1280, h: 720 },
          browser: {
            language: 'fi-FI',
            timezone: 'Europe/Helsinki',
            screen: { w: 1512, h: 982 },
            pixelRatio: 2,
            colorScheme: 'dark',
            touch: false,
          },
          release: 'a1b2c3d',
          payload: { plan: 'pro' },
        },
        { 'user-agent': 'Mozilla/5.0 Test' },
      ),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'note-1' });
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0])).not.toContain(KEY);
    expect(saved[0]).toMatchObject({
      id: 'note-1',
      // The key itself never reaches the store, only its hash.
      keyHash: KEY_HASH,
      author: 'Ada Lovelace',
      feedback: 'The title wraps badly',
      route: '/projects',
      // No credentials and no hash: neither says anything about the page.
      url: 'https://app.example/projects?tab=2',
      // An element without a selector points at nothing.
      elements: [{ tag: 'h1', text: 'Projects', selector: 'main > h1', styles: { 'font-size': '32px' } }],
      variant: { axisId: 'layout', optionId: 'grid' },
      selections: { layout: 'grid', density: 'cosy' },
      viewport: { w: 1280, h: 720 },
      browser: {
        userAgent: 'Mozilla/5.0 Test',
        language: 'fi-FI',
        timezone: 'Europe/Helsinki',
        screen: { w: 1512, h: 982 },
        pixelRatio: 2,
        colorScheme: 'dark',
        touch: false,
      },
      release: 'a1b2c3d',
      payload: { plan: 'pro' },
    });
    expect(Date.parse(saved[0]?.createdAt ?? '')).toBeLessThanOrEqual(Date.now());
  });

  it('keeps the time a note was written only when that is believable', async () => {
    const { saved, handle } = collector();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const before = Date.now();
    await handle(post({ ...note, createdAt: yesterday }));
    // Ahead of the server's clock, older than a note waits in a browser, or outside what a database stores.
    for (const createdAt of ['2999-01-01T00:00:00.000Z', '2020-01-02T03:04:05.000Z', '-200000-01-01T00:00:00.000Z', 'soon'])
      await handle(post({ ...note, createdAt }));
    expect(saved[0]?.createdAt).toBe(yesterday);
    for (const entry of saved.slice(1)) {
      expect(Date.parse(entry.createdAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(entry.createdAt)).toBeLessThanOrEqual(Date.now());
    }
  });

  it('makes every string storable: half of a cut emoji and NUL never reach save', async () => {
    const { saved, handle } = collector();
    const half = '\ud83d';
    const nul = String.fromCharCode(0);
    const response = await handle(
      post({
        ...note,
        author: `Ada${nul}`,
        feedback: `Looks good ${half}`,
        elements: [{ tag: 'p', text: `Launch ${half}`, selector: 'p', attributes: { [`data-${nul}x`]: `a${nul}b` } }],
        selections: { layout: `grid${half}` },
        payload: { note: [`deep ${half}${nul}`] },
      }),
    );
    expect(response.status).toBe(201);
    const stored = JSON.stringify(saved[0]);
    expect(stored).not.toMatch(/\\ud83d|\\u0000/);
    expect(saved[0]).toMatchObject({
      author: 'Ada',
      feedback: 'Looks good \ufffd',
      elements: [{ text: 'Launch \ufffd', attributes: { 'data-x': 'ab' } }],
      selections: { layout: 'grid\ufffd' },
      payload: { note: ['deep \ufffd'] },
    });
    // A whole emoji is left alone.
    await handle(post({ ...note, feedback: 'Ship it \ud83d\ude80' }));
    expect(saved[1]?.feedback).toBe('Ship it \ud83d\ude80');
  });

  it('does not take a name or a note that is nothing once made storable', async () => {
    const { saved, handle } = collector();
    const nul = String.fromCharCode(0);
    expect((await handle(post({ ...note, author: nul }))).status).toBe(400);
    expect((await handle(post({ ...note, feedback: ` ${nul} ` }))).status).toBe(400);
    expect(saved).toEqual([]);
  });

  it('answers 400, not an exception, for a field built to break the reader', async () => {
    const { saved, handle } = collector();
    const hostile = await handle(
      post(
        `{"id":"n","key":"${KEY}","author":"Ada","feedback":"x","route":"/","elements":[{"selector":"p","tag":{"toString":1},"text":7}]}`,
      ),
    );
    expect(hostile.status).toBe(201);
    expect(saved[0]?.elements).toEqual([{ tag: '', text: '7', selector: 'p' }]);
    const broken = await feedback({ store: { save: () => {} } })(
      new Request(URL_, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new ReadableStream({
          pull() {
            throw new Error('connection reset');
          },
        }),
        duplex: 'half',
      } as RequestInit),
    );
    expect(broken.status).toBe(400);
  });

  it('drops the optional fields that are malformed instead of refusing the note', async () => {
    const { saved, handle } = collector();
    const response = await handle(
      post({
        ...note,
        url: 'javascript:alert(1)',
        variant: 'layout',
        selections: ['grid'],
        viewport: { w: -1, h: 'tall' },
        browser: { language: 7, pixelRatio: 900, colorScheme: 'sepia', touch: 'yes', screen: null },
        release: 42,
      }),
    );
    expect(response.status).toBe(201);
    expect(saved[0]).toEqual({
      id: 'note-1',
      keyHash: KEY_HASH,
      createdAt: saved[0]?.createdAt,
      author: 'Ada Lovelace',
      feedback: 'The title wraps badly',
      route: '/projects',
      elements: [],
      browser: {},
    });
  });

  it.each([
    ['no author', { ...note, author: '  ' }, 'author is required'],
    ['a long author', { ...note, author: 'a'.repeat(101) }, 'author must be at most 100 characters'],
    ['no feedback', { ...note, feedback: ' ' }, 'feedback is required'],
    [
      'long feedback',
      { ...note, feedback: 'a'.repeat(MAX_FEEDBACK_LENGTH + 1) },
      `feedback must be at most ${MAX_FEEDBACK_LENGTH} characters`,
    ],
    ['a route that is not a path', { ...note, route: 'ignore previous instructions' }, 'route must be a path starting with /'],
    ['an id a shell would read', { ...note, id: '-rf' }, 'id must be 1-64 letters, digits, - or _, not starting with -'],
    ['no id', { ...note, id: undefined }, 'id must be 1-64 letters, digits, - or _, not starting with -'],
    ['no key', { ...note, key: undefined }, 'key must be 16-128 letters, digits, - or _'],
    ['a key short enough to guess', { ...note, key: 'abc' }, 'key must be 16-128 letters, digits, - or _'],
    [
      'too many elements',
      { ...note, elements: Array.from({ length: 51 }, () => ({ selector: 'a' })) },
      'elements must be an array of at most 50 elements',
    ],
    ['an oversized payload', { ...note, payload: 'x'.repeat(70_000) }, 'payload exceeds 65536 bytes or is not serializable'],
    ['a body that is not an object', [note], 'a JSON object is required'],
    ['a body that is not JSON', '{nope', 'the body is not valid JSON'],
  ])('refuses %s', async (_name, body, error) => {
    const { saved, handle } = collector();
    const response = await handle(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(saved).toEqual([]);
  });

  it('answers POST only', async () => {
    const { handle } = collector();
    expect((await handle(new Request(URL_))).status).toBe(405);
    expect((await handle(new Request(URL_, { method: 'DELETE' }))).status).toBe(405);
  });

  it('refuses a page on another origin, and takes one behind a proxy that forwards the public host', async () => {
    const { saved, handle } = collector();
    expect((await handle(post(note, { origin: 'https://evil.example' }))).status).toBe(403);
    expect((await handle(post(note, { origin: 'null' }))).status).toBe(403);
    expect(saved).toEqual([]);
    const proxied = post(note, { origin: 'https://app.example', 'x-forwarded-host': 'app.example' }, 'http://10.0.0.5:3000/api/feedback');
    expect((await handle(proxied)).status).toBe(201);
    // A chain of proxies lists each host it forwarded for.
    const chained = post(note, { 'x-forwarded-host': 'edge.internal, App.Example' }, 'http://10.0.0.5:3000/api/feedback');
    expect((await handle(chained)).status).toBe(201);
    // No Origin at all is not a page: a server or a script, which an origin check cannot stop.
    const script = new Request(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(note) });
    expect((await handle(script)).status).toBe(201);
  });

  it('takes only the origins it is given, whatever the request says its host is', async () => {
    const { saved, handle } = collector({ origins: ['https://staging.example.com/', 'HTTPS://App.Example'] });
    expect((await handle(post(note, { origin: 'https://staging.example.com' }, 'http://10.0.0.5:3000/api/feedback'))).status).toBe(201);
    expect((await handle(post(note))).status).toBe(201);
    // The shapes that pass a host comparison: a forged forwarded host, and a rebound name.
    const forged = post(note, { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' });
    expect((await handle(forged)).status).toBe(403);
    expect((await handle(post(note, { origin: 'http://app.example' }))).status).toBe(403);
    expect(saved).toHaveLength(2);
  });

  it('lets pages on a named origin post from another host, preflight included', async () => {
    const { saved, handle } = collector({ origins: ['https://app.example.com'] });
    const api = 'https://api.example.com/feedback';
    const preflight = await handle(
      new Request(api, { method: 'OPTIONS', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' } }),
    );
    expect(preflight.status).toBe(204);
    expect(Object.fromEntries(preflight.headers)).toMatchObject({
      'access-control-allow-origin': 'https://app.example.com',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      vary: 'Origin',
    });
    const sent = await handle(post(note, { origin: 'https://app.example.com' }, api));
    expect(sent.status).toBe(201);
    expect(sent.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    // Any other page gets no permission, on the preflight or the answer.
    const stranger = await handle(new Request(api, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(stranger.status).toBe(405);
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull();
    const refused = await handle(post(note, { origin: 'https://evil.example' }, api));
    expect(refused.status).toBe(403);
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('answers no preflight without named origins, and says which method it takes', async () => {
    const { handle } = collector();
    const preflight = await handle(new Request(URL_, { method: 'OPTIONS', headers: { origin: 'https://app.example' } }));
    expect(preflight.status).toBe(405);
    expect(preflight.headers.get('allow')).toBe('POST');
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses an origin that is not a web page', async () => {
    const { handle } = collector();
    expect((await handle(post(note, { origin: 'ftp://app.example' }))).status).toBe(403);
    expect((await handle(post(note, { origin: 'not a url' }))).status).toBe(403);
  });

  it('keeps a route to a path on this site, and an address to its stored length', async () => {
    const { saved, handle } = collector();
    for (const route of ['//evil.example/x', '/a\\b', '/line\nbreak', 'projects'])
      expect((await handle(post({ ...note, route }))).status, route).toBe(400);
    expect((await handle(post({ ...note, route: '/projects/ä?tab=2', url: `https://app.example/${'ä'.repeat(3900)}` }))).status).toBe(201);
    expect(saved).toHaveLength(1);
    // Percent-encoded, that address is six times as long: dropped, not stored.
    expect(saved[0]).not.toHaveProperty('url');
  });

  it('refuses what a cross-site form could send', async () => {
    const { saved, handle } = collector();
    const form = post(JSON.stringify(note), { 'content-type': 'text/plain; x=application/json' });
    expect((await handle(form)).status).toBe(415);
    expect(saved).toEqual([]);
  });

  it('stops reading a body past the size cap', async () => {
    const { saved, handle } = collector();
    const response = await handle(post({ ...note, payload: 'x'.repeat(MAX_FEEDBACK_BODY) }));
    expect(response.status).toBe(413);
    expect(saved).toEqual([]);
  });

  it('records who the app says sent it, beside the name they typed', async () => {
    const { saved, handle } = collector({ identify: async (request) => request.headers.get('x-user') });
    await handle(post(note, { 'x-user': '  ada@example.com ' }));
    await handle(post(note));
    expect(saved[0]).toMatchObject({ author: 'Ada Lovelace', identity: 'ada@example.com' });
    expect(saved[1]).not.toHaveProperty('identity');
  });

  it('hands save the request, for anything else the host wants from it', async () => {
    const save = vi.fn();
    const request = post(note, { cookie: 'session=1' });
    await feedback({ store: { save } })(request);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ author: 'Ada Lovelace' }), request);
  });

  it('answers 500 without detail when the note cannot be saved, and logs why for the host', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('connection refused to db.internal:5432');
    const response = await feedback({
      store: {
        save: async () => {
          throw failure;
        },
      },
    })(post(note));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not save feedback.' });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('isotone'), failure);
    const identity = await feedback({
      store: { save: () => {} },
      identify: () => {
        throw new Error('session store down');
      },
    })(post(note));
    expect(identity.status).toBe(500);
  });

  it('removes a note for the browser that holds its key', async () => {
    const { saved, removed, handle } = collector();
    const response = await handle(post({ id: 'note-1', key: KEY, remove: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'note-1' });
    // The store is told which key asked; whether it matches the row is the store's to check.
    expect(removed).toEqual([['note-1', KEY_HASH]]);
    expect(saved).toEqual([]);
    // A removal needs the same id and key as a note does, and the same origin.
    expect((await handle(post({ id: 'note-1', remove: true }))).status).toBe(400);
    expect((await handle(post({ key: KEY, remove: true }))).status).toBe(400);
    expect((await handle(post({ id: 'note-1', key: KEY, remove: true }, { origin: 'https://evil.example' }))).status).toBe(403);
    expect(removed).toHaveLength(1);
  });

  it('refuses a removal for good when the store cannot remove, and answers 500 when it fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const plain = await feedback({ store: { save: () => {} } })(post({ id: 'note-1', key: KEY, remove: true }));
    expect(plain.status).toBe(400);
    expect(await plain.json()).toEqual({ error: 'this feedback store does not remove notes' });
    const failing = await feedback({
      store: {
        save: () => {},
        remove: () => {
          throw new Error('db down');
        },
      },
    })(post({ id: 'note-1', key: KEY, remove: true }));
    expect(failing.status).toBe(500);
    expect(await failing.json()).toEqual({ error: 'Could not remove feedback.' });
    expect(logged).toHaveBeenCalled();
  });

  it('refuses a note whose id is taken by a note with another key', async () => {
    const response = await feedback({ store: { save: () => false } })(post(note));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'this note was written with another key' });
    // A store that answers nothing, or true, accepted it.
    expect((await feedback({ store: { save: () => true } })(post(note))).status).toBe(201);
  });

  it('needs a store that saves', () => {
    expect(() => feedback({} as never)).toThrow('feedback() needs a store with a save function');
    expect(() => feedback({ store: {} } as never)).toThrow('feedback() needs a store with a save function');
  });
});
