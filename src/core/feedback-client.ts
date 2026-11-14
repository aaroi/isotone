import { readBrowserStorage } from './browser-storage';
import { type FeedbackBrowser, type FeedbackClientConfig, MAX_AUTHOR } from './feedback';
import { createNoteId } from './id';
import { MAX_FEEDBACK_LENGTH } from './limits';
import { request } from './request';
import type { IsotoneElement, IsotoneNote, NoteContext } from './types';

/* ---------------------------------------------------------------------------
 * The store of a panel that collects feedback in a deployed app. Each note is
 * posted to the host's endpoint, which only takes writes; the list the
 * reviewer sees is what this browser sent, kept in `localStorage` with the
 * secret key that lets this browser, and no other, edit or delete each note.
 * A write the endpoint could not take yet waits in an outbox and is sent
 * again later.
 * It has the shape of the development store, so the panel drives either.
 * ------------------------------------------------------------------------- */

/** A string the panel edits outside React state, like the composer's text. */
export interface TextStore {
  get(): string;
  set(value: string): void;
  subscribe(listener: () => void): () => void;
}

/** Most sent notes this browser keeps to show; older ones drop off the list, not the database. */
const MAX_SHOWN = 200;

/** Answers that will never change for this record, so it is not sent again. */
const NEVER_ACCEPTED = new Set([400, 409, 413, 415]);

/** Most notes that wait for the endpoint at once; past this a new one stays in the composer. */
const MAX_WAITING = 50;

/** How long a note waits for an endpoint that keeps turning it away before it is given up. */
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A write as it waits in the outbox: a note's request body, or `remove: true`
 * for a note the reviewer deleted. `queuedAt` is when this write was made,
 * which is what its week of waiting counts from; it is not sent.
 */
type Wire = Record<string, unknown> & { id: string; key: string; queuedAt?: string; remove?: true };

/** A sent note as this browser keeps it: with the key that proves it wrote it, and whether the endpoint has it. */
type Kept = IsotoneNote & { key: string; arrived?: boolean };

type Posted = { state: 'saved' } | { state: 'later'; answered: boolean } | { state: 'refused'; status: number; error?: string };

function readList<T>(key: string): T[] {
  try {
    const items = JSON.parse(readBrowserStorage(window.localStorage, key) ?? '[]');
    return Array.isArray(items) ? (items as T[]) : [];
  } catch {
    return [];
  }
}

/** Whether the list was stored: blocked or full storage keeps nothing. */
function writeList(key: string, items: unknown[]): boolean {
  try {
    if (items.length) window.localStorage.setItem(key, JSON.stringify(items));
    else window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** What the browser reports about itself; the server adds the user agent. */
function browserFacts(): FeedbackBrowser {
  const facts: FeedbackBrowser = {};
  try {
    if (navigator.language) facts.language = navigator.language;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) facts.timezone = timezone;
    if (window.screen?.width) facts.screen = { w: window.screen.width, h: window.screen.height };
    if (window.devicePixelRatio) facts.pixelRatio = window.devicePixelRatio;
    if (typeof window.matchMedia === 'function') {
      facts.colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      facts.touch = window.matchMedia('(pointer: coarse)').matches;
    }
  } catch {
    /* A browser that withholds one of these still sends the rest. */
  }
  return facts;
}

/** The name field: the host's name when it knows the reviewer, else the one this browser last used. */
function createAuthor(key: string, known: string | undefined): TextStore {
  const given = known?.trim().slice(0, MAX_AUTHOR) ?? '';
  let value = given;
  if (!value) {
    try {
      value = readBrowserStorage(window.localStorage, key) ?? '';
    } catch {
      /* No storage: the field starts empty. */
    }
  }
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const text = next.slice(0, MAX_AUTHOR);
      if (text === value) return;
      value = text;
      // A name from the app's session is the app's to remember, not this browser's.
      if (!given) {
        try {
          window.localStorage.setItem(key, text);
        } catch {
          /* Remembered for this page only. */
        }
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface FeedbackStoreConfig extends FeedbackClientConfig {
  /** localStorage namespace, as for the development store. */
  key: string;
  /** What every selector on the page is set to when a note is sent. */
  getSelections?: () => Record<string, string> | undefined;
}

export function createFeedbackStore(cfg: FeedbackStoreConfig) {
  const { endpoint } = cfg;
  const sentKey = `${cfg.key}::sent`;
  const outboxKey = `${cfg.key}::outbox`;
  const author = createAuthor(`${cfg.key}::author`, cfg.name);
  let flushing: Promise<boolean> | null = null;
  try {
    // A browser blocks this silently, and the note would wait in the outbox as if the server were away.
    if (new URL(endpoint, window.location.href).origin !== window.location.origin) {
      console.warn(
        `Isotone: the feedback endpoint ${endpoint} is on another origin than this page. Serve it from the page's own origin (a dev proxy does that), or name this page's origin in the route's \`origins\`.`,
      );
    }
  } catch {
    /* An endpoint that is not a URL fails when the first note is sent. */
  }

  const sent = () => readList<Kept>(sentKey).filter((note) => note && typeof note.id === 'string' && typeof note.key === 'string');
  const outbox = () => readList<Wire>(outboxKey).filter((item) => item && typeof item.id === 'string');

  const withoutId = (key: string, id: string) =>
    writeList(
      key,
      readList<{ id?: unknown }>(key).filter((item) => item?.id !== id),
    );

  /** 'saved', 'refused' for good, or 'later': the endpoint answered with something that may pass, or not at all. */
  async function post({ queuedAt: _local, ...body }: Wire): Promise<Posted> {
    try {
      return await request(
        endpoint,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        async (response): Promise<Posted> => {
          if (response.ok) return { state: 'saved' };
          if (!NEVER_ACCEPTED.has(response.status)) return { state: 'later', answered: true };
          const error = ((await response.json().catch(() => null)) as { error?: unknown } | null)?.error;
          return { state: 'refused', status: response.status, ...(typeof error === 'string' ? { error } : {}) };
        },
      );
    } catch {
      return { state: 'later', answered: false };
    }
  }

  /**
   * A note's requests go out one at a time, in the order they were made: an
   * edit never overtakes the save before it, and a retry never lands after a
   * delete. In this tab that is a queue per note; across tabs of the same
   * site, a Web Lock where the browser has them.
   */
  const turns = new Map<string, Promise<unknown>>();
  function inTurn<T>(id: string, run: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    const locked = () => (locks ? (locks.request(`${cfg.key}::${id}`, run) as Promise<T>) : run());
    const mine = (turns.get(id) ?? Promise.resolve()).then(locked, locked);
    const done = mine.catch(() => {});
    turns.set(id, done);
    void done.then(() => {
      if (turns.get(id) === done) turns.delete(id);
    });
    return mine;
  }

  const isQueued = (body: Wire) => {
    const snapshot = JSON.stringify(body);
    return outbox().some((item) => JSON.stringify(item) === snapshot);
  };

  /** One write per note waits at a time: the latest replaces whatever was queued for it. */
  const queue = (body: Wire) => writeList(outboxKey, [...outbox().filter((item) => item.id !== body.id), body]);

  /** Takes a write the endpoint answered out of the outbox, unless a newer one for the note took its place. */
  function settle(body: Wire): void {
    const snapshot = JSON.stringify(body);
    writeList(
      outboxKey,
      outbox().filter((item) => JSON.stringify(item) !== snapshot),
    );
  }

  /**
   * Sends one write in its note's turn. A queued write that a newer one
   * replaced while it waited its turn is not sent: the answer is `null`.
   * `queued` is false only where storage could not keep the write.
   */
  function send(body: Wire, queued = true): Promise<Posted | null> {
    return inTurn(body.id, async () => {
      if (queued && !isQueued(body)) return null;
      const result = await post(body);
      if (result.state !== 'later') settle(body);
      if (result.state === 'saved' && !body.remove) {
        writeList(
          sentKey,
          sent().map((note) => (note.id === body.id ? { ...note, arrived: true } : note)),
        );
      }
      return result;
    });
  }

  /**
   * A write that will not be sent is dropped, once and loudly. A note that
   * never reached the endpoint comes off the list with it; one that did stays,
   * since its row and the key to it are still good.
   */
  function giveUp(body: Wire, why: string): void {
    settle(body);
    if (!body.remove && !sent().find((note) => note.id === body.id)?.arrived) withoutId(sentKey, body.id);
    const { key: _secret, ...shown } = body;
    console.warn(`Isotone dropped feedback ${why}.`, shown);
  }

  /**
   * Send what is waiting, oldest first, one run at a time. Resolves false
   * while something still waits. An endpoint that does not answer ends the
   * run; one that turns a write away for now does not hold up the ones behind
   * it, and a write it has turned away for a week is given up.
   */
  function flush(): Promise<boolean> {
    flushing ??= (async () => {
      let waiting = false;
      for (const body of outbox()) {
        const result = await send(body);
        if (!result || result.state === 'saved') continue;
        if (result.state === 'refused') {
          giveUp(body, `the endpoint refuses (${result.status}${result.error ? `: ${result.error}` : ''})`);
        } else if (!result.answered) return false;
        // A write with no readable time is as old as can be.
        else if (!(Date.now() - Date.parse(body.queuedAt ?? '') <= MAX_WAIT_MS)) giveUp(body, 'the endpoint turned away for a week');
        else waiting = true;
      }
      return !waiting;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  const newestFirst = (a: IsotoneNote, b: IsotoneNote) => b.createdAt.localeCompare(a.createdAt);
  const listed = () =>
    sent()
      .map(({ key: _secret, arrived: _state, ...note }): IsotoneNote => note)
      .sort(newestFirst);

  async function saveNote(
    route: string,
    feedback: string,
    element: IsotoneElement | null,
    editedId: string | null,
    payload?: unknown,
    viewport?: { w: number; h: number },
    context?: NoteContext,
  ): Promise<string> {
    const text = feedback.trim();
    if (text.length > MAX_FEEDBACK_LENGTH) throw new RangeError(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
    const name = author.get().trim();
    if (!name) throw new Error('A name is required to send feedback.');
    // An edit sends the whole note again under its id and key; the server replaces the row.
    const previous = editedId ? sent().find((note) => note.id === editedId) : undefined;
    if (editedId && !previous) throw new Error('This note is no longer on this browser, so it cannot be edited here.');
    // The id survives a retry, and the key is what lets this browser change the note later.
    const id = previous?.id ?? createNoteId();
    const key = previous?.key ?? `${createNoteId()}${createNoteId()}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const createdAt = previous?.createdAt ?? new Date().toISOString();
    const elements = context?.elements ?? (element ? [element] : []);
    const selections = cfg.getSelections?.();
    const body: Wire = {
      id,
      key,
      queuedAt: new Date().toISOString(),
      createdAt,
      author: name,
      feedback: text,
      route,
      url: `${window.location.origin}${window.location.pathname}${window.location.search}`,
      elements,
      ...(context?.variant ? { variant: context.variant } : {}),
      ...(selections && Object.keys(selections).length ? { selections } : {}),
      ...(viewport ? { viewport } : {}),
      browser: browserFacts(),
      ...(cfg.release ? { release: cfg.release } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    if (outbox().length >= MAX_WAITING) throw new Error('Too much feedback is already waiting to be sent.');
    // Kept before it is sent, so closing the tab mid-request loses nothing; the id makes a second send harmless.
    const waitingBefore = outbox().find((item) => item.id === id);
    const kept = queue(body);
    const result = await send(body, kept);
    // A newer edit, or a delete, took this write's place while it waited its turn: that one speaks for the note.
    if (!result) return id;
    if (result.state === 'refused') {
      // A refused edit leaves the earlier version waiting, if it still was.
      if (waitingBefore) queue(waitingBefore);
      throw new Error(`Sending feedback failed (${result.status})${result.error ? `: ${result.error}` : ''}`);
    }
    // Neither sent nor kept: it stays in the composer rather than vanish.
    if (result.state === 'later' && !kept) throw new Error('Feedback could not be sent, and this browser cannot keep it for later.');
    const note: Kept = {
      id,
      key,
      route,
      feedback: text,
      element: elements[0] ?? null,
      elements,
      ...(context?.variant ? { variant: context.variant } : {}),
      done: false,
      createdAt,
      ...(viewport ? { viewport } : {}),
      ...(result.state === 'saved' || previous?.arrived ? { arrived: true } : {}),
    };
    writeList(sentKey, [...sent().filter((item) => item.id !== id), note].slice(-MAX_SHOWN));
    return id;
  }

  return {
    author,
    pendingNotes: async () => listed(),
    /** The list is this browser's own, so a poll only retries the outbox. A
     *  failed retry throws, which makes the caller wait longer before the next. */
    async pollNotes(_rev: string | null): Promise<{ rev: string | null; notes: IsotoneNote[] | null }> {
      if (outbox().length && !(await flush())) throw new Error('Feedback is waiting to be sent.');
      return { rev: null, notes: listed() };
    },
    saveNote,
    /**
     * Deletes a note: off this browser's list, and its row out of the host's
     * store, which the note's key allows. An endpoint that cannot answer now
     * is asked again later; one that refuses throws, and the note stays.
     */
    async deleteNote(id: string): Promise<void> {
      const note = sent().find((item) => item.id === id);
      if (!note) return;
      const body: Wire = { id, key: note.key, remove: true, queuedAt: new Date().toISOString() };
      const waitingBefore = outbox().find((item) => item.id === id);
      // In place of any write still waiting for this note, which must not land after the delete.
      const kept = queue(body);
      const result = await send(body, kept);
      if (result?.state === 'refused') {
        if (waitingBefore) queue(waitingBefore);
        throw new Error(`Deleting feedback failed (${result.status})${result.error ? `: ${result.error}` : ''}`);
      }
      if (result?.state === 'later' && !kept)
        throw new Error('Feedback could not be deleted, and this browser cannot keep the request for later.');
      withoutId(sentKey, id);
    },
    /** Whether a write is still waiting for the endpoint. */
    get hasUnsyncedNotes(): boolean {
      return outbox().length > 0;
    },
  };
}
