/**
 * The feedback route for servers that hand a route Node's `(req, res)` rather
 * than a Fetch `Request`: Express, Fastify's raw objects, plain `node:http`.
 * Typed by shape, with no Node import, so this entry still loads anywhere.
 */

/** As much of `http.IncomingMessage` (or Express's request) as the adapter reads. */
export interface NodeRequestLike {
  method?: string;
  url?: string;
  /** Express: the URL before a router trimmed its mount path. */
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set when a body parser (`express.json()`) already read the body. */
  body?: unknown;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}

/** As much of `http.ServerResponse` as the adapter writes. */
export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body?: string): unknown;
}

/**
 * Wraps the handler `feedback()` returns for a Node server:
 * `app.post('/api/feedback', toNode(feedback({ store })))`.
 *
 * It works with or without a JSON body parser in front of it. Without one the
 * body is read from the stream, up to the route's own size cap; with one, the
 * parser's limit applies first (Express's default is 100 kB).
 */
export function toNode(handle: (request: Request) => Promise<Response>): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void> {
  return async (req, res) => {
    const answer = (response: { status: number; headers?: Headers; text: string }) => {
      res.statusCode = response.status;
      response.headers?.forEach((value, name) => void res.setHeader(name, value));
      res.end(response.text);
    };
    let request: Request;
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const method = req.method ?? 'GET';
      let body: ReadableStream<Uint8Array> | string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        if (req.body === undefined) {
          // Pulled chunk by chunk, so the handler's size cap stops the read.
          const chunks = req[Symbol.asyncIterator]();
          body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              const { done, value } = await chunks.next();
              if (done) controller.close();
              else controller.enqueue(value);
            },
            cancel: () => void chunks.return?.(),
          });
        } else {
          // A parser consumed the stream: send what it made of it, at its new length.
          body =
            typeof req.body === 'string'
              ? req.body
              : req.body instanceof Uint8Array
                ? new TextDecoder().decode(req.body)
                : JSON.stringify(req.body);
          headers.delete('content-length');
        }
      }
      // The address's own host is a placeholder: the handler compares the page's origin with the Host header.
      const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://node.invalid');
      request = new Request(url, { method, headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit);
    } catch {
      // A method or header the Fetch API will not carry: a request this route never takes.
      return answer({ status: 400, text: '{"error":"the request could not be read"}' });
    }
    try {
      const response = await handle(request);
      answer({ status: response.status, headers: response.headers, text: await response.text() });
    } catch (error) {
      console.error('[isotone] The feedback route failed:', error);
      answer({ status: 500, text: '{"error":"Could not save feedback."}' });
    }
  };
}
