/**
 * A closed note waits in the panel until the reviewer checks it: the agent's
 * summary is there to read, and the element to look at again. Browser-safe, so
 * the endpoint, the panel and the hosted demo agree on what is shown.
 */
import type { IsotoneNote } from './types';

/** How long a closed, unchecked note keeps waiting in the panel. */
const CHECK_WINDOW_MS = 7 * 86_400_000;

/**
 * Closed within the window by a CLI that records closes, and not yet checked
 * by the reviewer. A note closed before that has no `resolution`: after an
 * upgrade, a week of old closes must not all come back to be checked.
 */
export function awaitsCheck(note: Pick<IsotoneNote, 'done' | 'doneAt' | 'checkedAt' | 'resolution'>, now = Date.now()): boolean {
  if (!note.done || note.checkedAt || !note.resolution) return false;
  const at = Date.parse(note.doneAt ?? '');
  return Number.isFinite(at) && now - at <= CHECK_WINDOW_MS;
}
