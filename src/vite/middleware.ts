/**
 * The dev server's endpoints: notes, the update notice and variants. Each
 * checks the request's origin first and answers JSON, or a 500 when the store
 * throws, so the panel never waits on a hung request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { UpdateInfo } from '../core/update';
import { checkRequest, readNodeJson, sendFailure, writeResponse } from '../node/http';
import { notesResponse } from '../node/notes/handler';
import { updateResponse } from '../node/update/note';
import { type VariantsStoreOptions, variantsResponse } from '../node/variants';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/** The names Vite was told to serve besides local ones (`server.allowedHosts`). */
export type AllowedHosts = () => readonly string[];

/** Whether the request may use the endpoints; answers 403 when not. Only this
 *  machine may: `vite --host` exposes the app, not the notes file. */
function guard(req: IncomingMessage, res: ServerResponse, allowedHosts: AllowedHosts): boolean {
  try {
    checkRequest({
      origin: req.headers.origin,
      host: req.headers.host,
      remoteAddress: req.socket?.remoteAddress ?? null,
      allowedHosts: allowedHosts(),
    });
    return true;
  } catch (error) {
    sendFailure(res, error);
    return false;
  }
}

/** GET reads the cached check; POST asks for the update note, which the
 *  server builds from that check rather than from the request. */
export function updateEndpoint(file: () => string, updates: { getSnapshot(): UpdateInfo }, allowedHosts: AllowedHosts): Middleware {
  return (req, res) => {
    if (!guard(req, res, allowedHosts)) return;
    const method = req.method ?? '';
    (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
      .then((body) => {
        writeResponse(res, () => updateResponse(file(), updates.getSnapshot(), { method, body }));
      })
      .catch((error) => sendFailure(res, error));
  };
}

/** Notes endpoint → local file. Other methods fall through to the next handler. */
export function notesEndpoint(file: () => string, allowedHosts: AllowedHosts): Middleware {
  return (req, res, next) => {
    if (!guard(req, res, allowedHosts)) return;
    const method = req.method ?? '';
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
      next();
      return;
    }
    (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
      .then((body) => {
        writeResponse(res, () => notesResponse(file(), { method, url: req.url, body }));
      })
      .catch((error) => sendFailure(res, error));
  };
}

/** The variants endpoint. A successful POST answers once `activate` has put
 *  the new set in place, so the panel can reload straight into it. */
export function variantsEndpoint(
  vopts: () => VariantsStoreOptions,
  activate: (active: string[], changedFiles?: string[]) => Promise<void>,
  allowedHosts: AllowedHosts,
): Middleware {
  return (req, res, next) => {
    if (!guard(req, res, allowedHosts)) return;
    const method = req.method ?? '';
    if (method !== 'GET' && method !== 'POST') {
      next();
      return;
    }
    (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
      .then((body) => {
        // connect strips the mount from `req.url`, which is the shape
        // variantsResponse routes on ("/", "/active?...").
        let result: ReturnType<typeof variantsResponse>;
        try {
          result = variantsResponse(vopts(), { method, url: req.url, body });
        } catch (error) {
          sendFailure(res, error);
          return;
        }
        const send = () => {
          writeResponse(res, () => result);
        };
        if (result.status === 200 && method === 'POST') {
          const updated = result.body as { active: string[]; changedFiles?: string[] };
          // Answer once the switch is in place, so the panel can reload
          // straight into it.
          activate(updated.active, updated.changedFiles).then(send, send);
        } else {
          send();
        }
      })
      .catch((error) => sendFailure(res, error));
  };
}
