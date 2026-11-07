/**
 * The update note: the user's request, through the feedback list, that their
 * coding agent upgrade Isotone. The local server builds it from its own update
 * check. A browser can ask for one but never supplies the versions, the
 * command or the directory, so page content cannot put a command in front of
 * the agent. At most one update note is open; a newer release updates it.
 */
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { updateNoteText, type UpdateInfo, type UpdateRequest } from '../../core/update';
import { MAX_UPDATE_NOTE_ROUTE, MAX_UPDATE_NOTED_BYTES } from '../../core/limits';
import { readJsonBounded, writeJsonAtomic } from '../fs/atomic';
import { withFileLock } from '../fs/lock';
import { readNotes, writeNotes } from '../notes/store';
import { type HandlerResponse, jsonResponse } from '../http';
import { changelogUrl, compareVersions, notesProjectRoot, updateRequestOf } from './request';

/**
 * The request a snapshot supports, or null when there is nothing to run. With
 * a notes file, its directory must also lie inside that file's project.
 */
function updateRequestFrom(info: UpdateInfo, file?: string): UpdateRequest | null {
  if (info.status !== 'available' || !info.latestVersion || !info.upgrade) return null;
  return updateRequestOf(
    {
      from: info.currentVersion,
      to: info.latestVersion,
      command: info.upgrade.command,
      cwd: info.upgrade.cwd,
      manager: info.upgrade.manager,
      changelog: changelogUrl(info.latestVersion),
    },
    file === undefined ? {} : { root: notesProjectRoot(file) },
  );
}

/**
 * Create the update note, or bring the open one up to date. Returns its id,
 * and whether it is new; null when the snapshot has no update to request.
 */
export function requestUpdateNote(file: string, info: UpdateInfo, route = '/'): { id: string; created: boolean } | null {
  const update = updateRequestFrom(info, file);
  if (!update) return null;
  const where = route.startsWith('/') && route.length <= MAX_UPDATE_NOTE_ROUTE ? route : '/';
  const root = notesProjectRoot(file);
  return withFileLock(file, () => {
    const notes = readNotes(file);
    const open = notes
      .filter((note) => !note.done && updateRequestOf(note.update, { root }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const current = open[0];
    if (!current) {
      const id = randomUUID();
      notes.push({
        id,
        route: where,
        feedback: updateNoteText(update),
        element: null,
        done: false,
        doneAt: null,
        createdAt: new Date().toISOString(),
        update,
      });
      writeNotes(file, notes);
      return { id, created: true };
    }
    const existing = updateRequestOf(current.update, { root }) as UpdateRequest;
    let changed = open.length > 1;
    // A newer release, or a new command for the same one, replaces the request.
    // An older snapshot (another server still on yesterday's check) leaves it.
    if (compareVersions(existing.to, update.to) <= 0 && JSON.stringify(existing) !== JSON.stringify(update)) {
      // The text is the server's, never the reviewer's, so it follows the request.
      current.feedback = updateNoteText(update);
      current.update = update;
      delete current.workingAt;
      changed = true;
    }
    if (changed)
      writeNotes(
        file,
        notes.filter((note) => note === current || !open.includes(note)),
      );
    return { id: current.id, created: false };
  });
}

/**
 * The update endpoint: GET reads the server's cached check, POST asks for the
 * update note. Only `route` is read from the body, as context for the note.
 * `file` is null when this server keeps no notes.
 */
export function updateResponse(file: string | null, info: UpdateInfo, req: { method?: string; body?: unknown }): HandlerResponse {
  const json = jsonResponse;
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
  const data = await readJsonBounded(file, MAX_UPDATE_NOTED_BYTES);
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, string>) : {};
}

/**
 * `checkForUpdates: 'note'`: create the update note the first time this notes
 * file sees a release. A user who deletes it is not asked again for that
 * version; a later release asks once more. Remembered per user in the same
 * temporary directory as the daily check.
 */
export async function autoUpdateNote(file: string, info: UpdateInfo, options: { stateFile?: string } = {}): Promise<string | null> {
  const update = updateRequestFrom(info, file);
  if (!update) return null;
  const stateFile = options.stateFile ?? NOTED_FILE;
  const key = resolve(file);
  const noted = await readNoted(stateFile);
  const seen = noted[key];
  try {
    if (typeof seen === 'string' && compareVersions(seen, update.to) >= 0) return null;
  } catch {
    /* Malformed: ask again. */
  }
  const result = requestUpdateNote(file, info, '/');
  delete noted[key];
  const entries = [...Object.entries(noted).filter(([, value]) => typeof value === 'string'), [key, update.to]].slice(-NOTED_LIMIT);
  await writeJsonAtomic(stateFile, Object.fromEntries(entries));
  return result?.id ?? null;
}
