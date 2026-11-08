/**
 * Where the notes live when no `file` or `--file` says otherwise, and the
 * move from the name used before 1.3.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { blastFile } from '../blast';
import { ensureFileIgnored } from '../fs/git-exclude';
import { withFileLock } from '../fs/lock';
import { readNotes, writeNotes } from './store';

export const NOTES_FILE = '.isotone/notes.json';
/** The notes file before 1.3; only ever read to move it. */
export const LEGACY_NOTES_FILE = '.iteration-feedback.json';

/**
 * The default notes file in `dir`. A `.iteration-feedback.json` there is moved
 * to `.isotone/notes.json` with one rename (its Blast session file with it).
 * When both exist, as when a 1.2 dev server still running after the upgrade
 * recreates the old file, the old file's notes whose IDs the new file lacks
 * are added to it and the old file is removed. Both run under the old file's
 * lock, which 1.2 takes at the same path, so no older Isotone writes it
 * mid-move. The new file is then kept out of Git, as the servers do.
 */
export function defaultNotesFile(dir: string, log: (line: string) => void): string {
  const file = join(dir, NOTES_FILE);
  const legacy = join(dir, LEGACY_NOTES_FILE);
  if (!existsSync(legacy)) return file;
  withFileLock(legacy, () => {
    if (!existsSync(legacy)) return;
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      renameSync(legacy, file);
      if (existsSync(blastFile(legacy)) && !existsSync(blastFile(file))) renameSync(blastFile(legacy), blastFile(file));
      log(`Moved ${LEGACY_NOTES_FILE} to ${NOTES_FILE}.`);
      return;
    }
    let added: number;
    try {
      added = withFileLock(file, () => {
        const notes = readNotes(file);
        const ids = new Set(notes.map((note) => note.id));
        const only = readNotes(legacy).filter((note) => !ids.has(note.id));
        if (only.length) writeNotes(file, [...notes, ...only]);
        return only.length;
      });
    } catch {
      log(`Using ${NOTES_FILE}; ${LEGACY_NOTES_FILE} beside it could not be merged and is left untouched.`);
      return;
    }
    rmSync(legacy);
    log(`Merged ${added} ${added === 1 ? 'note' : 'notes'} from ${LEGACY_NOTES_FILE}.`);
  });
  ensureFileIgnored(file);
  return file;
}
