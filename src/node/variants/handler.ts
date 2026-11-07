/** The variants endpoint the panel calls. */

import { overlayGroups } from '../../core/variants';
import { type HandlerRequest, type HandlerResponse, jsonResponse } from '../http';
import { activeConflict, readActive, writeActive } from './active';
import { readKnobs } from './knobs';
import { readVariant, readVariants, listVariants } from './manifest';
import type { VariantsStoreOptions } from './options';
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
    const body = req.body;
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
    for (const id of active) {
      if (!readVariant(opts, id)) return json(404, { error: `unknown variant "${id}"` });
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
    writeActive(opts, active);
    return json(200, { active });
  }

  return json(405, { error: 'method not allowed' });
}
