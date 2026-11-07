/**
 * The dev server's endpoints: notes, the update notice and variants. Each
 * checks the request's origin first and answers JSON, or a 500 when the store
 * throws, so the panel never waits on a hung request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { UpdateInfo } from '../core/update';
import { checkOrigin, readNodeJson, sendFailure, writeResponse } from '../node/http';
import { notesResponse } from '../node/notes/handler';
import { updateResponse } from '../node/update/note';
import { type VariantsStoreOptions, variantsResponse } from '../node/variants';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/** Whether the request's origin may use the endpoints; answers 403 when not. */
export function guardOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  try {
    checkOrigin(req.headers.origin, req.headers.host ?? '');
    return true;
  } catch (error) {
    sendFailure(res, error);
    return false;
  }
}

/** Whether the request declares a JSON body (`application/json`, with or
 *  without a charset parameter). */
export function isJsonRequest(req: IncomingMessage): boolean {
  const type = req.headers['content-type'];
  return typeof type === 'string' && type.toLowerCase().includes('application/json');
}

/** GET reads the cached check; POST asks for the update note, which the
 *  server builds from that check rather than from the request. */
export function updateEndpoint(file: () => string, updates: { getSnapshot(): UpdateInfo }): Middleware {
  return (req, res) => {
    if (!guardOrigin(req, res)) return;
    const method = req.method ?? '';
    (method === 'POST' ? readNodeJson(req) : Promise.resolve(undefined))
      .then((body) => {
        writeResponse(res, () => updateResponse(file(), updates.getSnapshot(), { method, body }));
      })
      .catch((error) => sendFailure(res, error));
  };
}

/** Notes endpoint → local file. Other methods fall through to the next handler. */
export function notesEndpoint(file: () => string): Middleware {
  return (req, res, next) => {
    if (!guardOrigin(req, res)) return;
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
): Middleware {
  return (req, res, next) => {
    if (!guardOrigin(req, res)) return;
    const method = req.method ?? '';
    if (method !== 'GET' && method !== 'POST') {
      next();
      return;
    }
    // A POST switches every open tab of this dev server to another set
    // of files. A cross-site page can fire a `no-cors` form post at
    // localhost, but only with a text/plain or form content type; a
    // JSON content type needs a preflight, which vite's CORS does not
    // grant to an unknown origin. So the header is the gate.
    if (method === 'POST' && !isJsonRequest(req)) {
      res.statusCode = 415;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'content-type must be application/json' }));
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
