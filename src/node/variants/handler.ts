/** The variants endpoint the panel calls. */

import { conflictedReason, overlayGroups } from '../../core/variants/overlay';
import { LockBusyError, SERVER_LOCK_WAIT_MS } from '../fs/lock';
import { type HandlerRequest, type HandlerResponse, jsonResponse } from '../http';
import { activeConflict, conflictedCopies, readActive, readPointer, withUnshown, writeActive } from './active';
import { readKnobs } from './knobs';
import { readVariant, readVariants, listVariants } from './manifest';
import { mutateVariants, type VariantsStoreOptions } from './options';
import { isValidVariantId } from './paths';

/**
 * The transport-agnostic core of the variants endpoint, mirroring
 * {@link import('../notes/store').notesResponse}. `req.url` is the path relative
 * to wherever the caller mounted `VARIANTS_ENDPOINT` ("/", "/active"), so
 * this function never needs to know the mount point.
 */
export function variantsResponse(opts: VariantsStoreOptions, req: HandlerRequest): HandlerResponse {
  const method = req.method ?? '';
  const path = (req.url ?? '/').split('?')[0] || '/';
  const json = jsonResponse;

  if (method === 'GET' && path === '/') {
    return json(200, { variants: listVariants(opts), active: readActive(opts), knobs: readKnobs(opts) });
  }

  if (method === 'POST' && path === '/active') {
    // The same lock as the CLI's `variant use`/`promote`, with a server's short wait.
    try {
      return mutateVariants(opts, () => setActive(opts, req.body), { waitMs: SERVER_LOCK_WAIT_MS });
    } catch (error) {
      if (error instanceof LockBusyError) return json(503, { error: error.message });
      throw error;
    }
  }

  return json(405, { error: 'method not allowed' });
}

function setActive(opts: VariantsStoreOptions, body: unknown): HandlerResponse {
  const json = jsonResponse;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'body must be a JSON object' });
  }
  const raw = (body as { active?: unknown }).active;
  if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) {
    return json(400, { error: 'active must be an array of variant ids' });
  }
  const active = Array.from(new Set(raw as string[]));
  for (const id of active) {
    // Malformed, not merely unknown: a 404 would imply the shape was fine.
    if (!isValidVariantId(id)) return json(400, { error: `invalid variant id "${id}"` });
  }
  const pointer = readPointer(opts);
  for (const id of active) {
    if (!readVariant(opts, id)) return json(404, { error: `unknown variant "${id}"` });
    // Only a new pick: a tab that still names one already in the set, while
    // it picks in another group, keeps it as the file does.
    const conflicted = pointer.includes(id) ? [] : conflictedCopies(opts, id);
    if (conflicted.length > 0) return json(409, { error: conflictedReason(id, conflicted) });
  }
  const conflict = activeConflict(opts, active);
  if (conflict) {
    const [a, b, file] = conflict;
    const groups = overlayGroups(readVariants(opts));
    const named = (id: string) => {
      const label = groups.find((group) => group.members.some((member) => member.id === id))?.label;
      return label ? `"${id}" (${label})` : `"${id}"`;
    };
    return json(409, {
      error: `${named(a)} and ${named(b)} both override ${file}; only one can be active`,
      conflict,
    });
  }
  // A tab posts what it shows, which leaves out a conflicted pick the file keeps.
  writeActive(opts, withUnshown(opts, active));
  return json(200, { active: readActive(opts) });
}
