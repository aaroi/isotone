type RequestInput = Parameters<typeof fetch>[0];

export function request(input: RequestInput, init?: RequestInit): Promise<Response>;
export function request<T>(input: RequestInput, init: RequestInit | undefined, consume: (response: Response) => Promise<T>): Promise<T>;

/** The deadline includes body consumption, not just receipt of the headers. */
export async function request<T>(input: RequestInput, init?: RequestInit, consume?: (response: Response) => Promise<T>): Promise<Response | T> {
  const native = (globalThis as { __isotoneFetch?: typeof fetch }).__isotoneFetch;
  const controller = new AbortController();
  const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('The local server did not respond in time.', 'TimeoutError')), 5_000);
  let aborted: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    aborted = () => reject(controller.signal.reason);
    if (controller.signal.aborted) aborted();
    else controller.signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    return await Promise.race([cancelled, (async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await (native ?? globalThis.fetch)(input, { ...init, signal: controller.signal });
      return consume ? consume(response) : response;
    })()]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', aborted);
  }
}
