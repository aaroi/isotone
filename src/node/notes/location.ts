/**
 * Where the notes live when no `file` or `--file` says otherwise, and the
 * one-time move from the name used before 1.3.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { blastFile } from '../blast';
import { withFileLock } from '../fs/lock';

export const NOTES_FILE = '.isotone/notes.json';
/** The notes file before 1.3; only ever read to move it. */
export const LEGACY_NOTES_FILE = '.iteration-feedback.json';

/**
 * The default notes file in `dir`. A `.iteration-feedback.json` there is moved
 * to `.isotone/notes.json` with one rename (its Blast session file with it),
 * under the old file's lock so no older Isotone writes it mid-move. When both
 * exist the new file is used and the old one is named, never merged.
 */
export function defaultNotesFile(dir: string, log: (line: string) => void): string {
  const file = join(dir, NOTES_FILE);
  const legacy = join(dir, LEGACY_NOTES_FILE);
  if (!existsSync(legacy)) return file;
  if (existsSync(file)) {
    log(`Using ${NOTES_FILE}; ${LEGACY_NOTES_FILE} beside it is an older notes file and is not read.`);
    return file;
  }
  withFileLock(legacy, () => {
    if (existsSync(file) || !existsSync(legacy)) return;
    mkdirSync(dirname(file), { recursive: true });
    renameSync(legacy, file);
    if (existsSync(blastFile(legacy)) && !existsSync(blastFile(file))) renameSync(blastFile(legacy), blastFile(file));
    log(`Moved ${LEGACY_NOTES_FILE} to ${NOTES_FILE}.`);
  });
  return file;
}
