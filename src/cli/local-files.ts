/**
 * isotone — keeping a checkout's local state out of Git from the CLI, as the
 * dev servers do when they start.
 */
import { join } from 'node:path';

import { ensureFilesIgnored } from '../node/fs/git-exclude';
import { NOTES_FILE } from '../node/notes/location';
import { ACTIVE_FILE } from '../node/variants/options';

/**
 * Exclude the notes file and the active-variants pointer in `root`'s
 * repository. The servers do this on start, so a `git init` made while one
 * ran left both files open to `git add -A`; the commands an agent runs next
 * close that gap. Idempotent, and quiet outside a repository.
 */
export function excludeLocalFiles(root: string, notesFile = join(root, NOTES_FILE)): void {
  ensureFilesIgnored([notesFile, join(root, ACTIVE_FILE)]);
}
