/**
 * The update note: the user's request, through the feedback list, that their
 * coding agent upgrade Isotone. The local server builds it from its own update
 * check. A browser can ask for one but never supplies the versions, the
 * command or the directory, so page content cannot put a command in front of
 * the agent. At most one update note is open; a newer release updates it.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { UpdateInfo, UpdateRequest } from './core/update';
import { withFileLock } from './file-store';
import { readNotes, writeNotes, type NotesResponse } from './store';
import { changelogUrl, compareVersions, updateRequestOf } from './update-request';

/** The note's readable text. */
export function updateNoteText(update: Pick<UpdateRequest, 'from' | 'to'>): string {
  return `Update Isotone ${update.from} → ${update.to}`;
}

/** The request a snapshot supports, or null when there is nothing to run. */
export function updateRequestFrom(info: UpdateInfo): UpdateRequest | null {
  if (info.status !== 'available' || !info.latestVersion || !info.upgrade) return null;
  return updateRequestOf({
    from: info.currentVersion, to: info.latestVersion,
    command: info.upgrade.command, cwd: info.upgrade.cwd, manager: info.upgrade.manager,
    changelog: changelogUrl(info.latestVersion),
  });
}

const MAX_ROUTE = 2000;

/**
 * Create the update note, or bring the open one up to date. Returns its id,
 * and whether it is new; null when the snapshot has no update to request.
 */
export function requestUpdateNote(file: string, info: UpdateInfo, route = '/'): { id: string; created: boolean } | null {
  const update = updateRequestFrom(info);
  if (!update) return null;
  const where = route.startsWith('/') && route.length <= MAX_ROUTE ? route : '/';
  return withFileLock(file, () => {
    const notes = readNotes(file);
    const open = notes
      .filter((note) => !note.done && updateRequestOf(note.update))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const current = open[0];
    if (!current) {
      const id = randomUUID();
      notes.push({
        id, route: where, feedback: updateNoteText(update), element: null,
        done: false, doneAt: null, createdAt: new Date().toISOString(), update,
      });
      writeNotes(file, notes);
      return { id, created: true };
    }
    const existing = updateRequestOf(current.update) as UpdateRequest;
    let changed = open.length > 1;
    // A newer release, or a new command for the same one, replaces the request.
    // An older snapshot (another server still on yesterday's check) leaves it.
    if (compareVersions(existing.to, update.to) <= 0 && JSON.stringify(existing) !== JSON.stringify(update)) {
      if (current.feedback === updateNoteText(existing)) current.feedback = updateNoteText(update);
      current.update = update;
      delete current.workingAt;
      changed = true;
    }
    if (changed) writeNotes(file, notes.filter((note) => note === current || !open.includes(note)));
    return { id: current.id, created: false };
  });
}

/**
 * The update endpoint: GET reads the server's cached check, POST asks for the
 * update note. Only `route` is read from the body, as context for the note.
 * `file` is null when this server keeps no notes.
 */
export function updateResponse(file: string | null, info: UpdateInfo, req: { method?: string; body?: unknown }): NotesResponse {
  const json = (status: number, body: unknown): NotesResponse => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body,
  });
  if (req.method === 'GET') return json(200, info);
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!file) return json(404, { error: 'this server keeps no notes' });
  const route = (req.body as { route?: unknown } | undefined)?.route;
  const result = requestUpdateNote(file, info, typeof route === 'string' ? route : '/');
  if (!result) return json(409, { error: 'There is no update this server can request.' });
  return json(result.created ? 201 : 200, result);
}

const NOTED_FILE = join(tmpdir(), `isotone-update-notes-${process.getuid?.() ?? 'user'}-v1.json`);
const NOTED_LIMIT = 100;

async function readNoted(file: string): Promise<Record<string, string>> {
  try {
    if ((await stat(file)).size > 64 * 1024) return {};
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

/**
 * `checkForUpdates: 'note'`: create the update note the first time this notes
 * file sees a release. A user who deletes it is not asked again for that
 * version; a later release asks once more. Remembered per user in the same
 * temporary directory as the daily check.
 */
export async function autoUpdateNote(file: string, info: UpdateInfo, options: { stateFile?: string } = {}): Promise<string | null> {
  const update = updateRequestFrom(info);
  if (!update) return null;
  const stateFile = options.stateFile ?? NOTED_FILE;
  const key = resolve(file);
  const noted = await readNoted(stateFile);
  const seen = noted[key];
  try { if (typeof seen === 'string' && compareVersions(seen, update.to) >= 0) return null; } catch { /* Malformed: ask again. */ }
  const result = requestUpdateNote(file, info, '/');
  delete noted[key];
  const entries = [...Object.entries(noted).filter(([, value]) => typeof value === 'string'), [key, update.to]].slice(-NOTED_LIMIT);
  const temporary = `${stateFile}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600, flag: 'wx' });
    await rename(temporary, stateFile);
  } finally { await rm(temporary, { force: true }); }
  return result?.id ?? null;
}
