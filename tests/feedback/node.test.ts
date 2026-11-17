import { createServer } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FEEDBACK_BODY } from '../../src/core/feedback';
import { type FeedbackEntry, feedback, toNode } from '../../src/feedback/index';

const note = { id: 'note-1', key: 'k'.repeat(32), author: 'Ada', feedback: 'Too tight', route: '/' };
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

/** A real Node server with the route behind `toNode`, optionally after a body parser like `express.json()`. */
async function serve(parsed = false) {
  const saved: FeedbackEntry[] = [];
  const route = toNode(feedback({ store: { save: (entry) => void saved.push(entry), remove: () => {} } }));
  const server = createServer(async (req, res) => {
    if (parsed) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      (req as unknown as { body: unknown }).body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    }
    await route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => new Promise((resolve) => server.close(() => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${origin}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...headers },
      body: JSON.stringify(body),
    });
  return { saved, post, origin };
}

describe('the route on a Node server', () => {
  it('reads the body from the stream and answers through res', async () => {
    const { saved, post } = await serve();
    const response = await post(note, { 'user-agent': 'Node/Test' });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ id: 'note-1' });
    expect(saved[0]).toMatchObject({ author: 'Ada', browser: { userAgent: 'Node/Test' } });
  });

  it('takes the body a parser already read', async () => {
    const { saved, post } = await serve(true);
    expect((await post(note)).status).toBe(201);
    expect((await post({ ...note, remove: true })).status).toBe(200);
    expect(saved).toHaveLength(1);
  });

  it('answers a request the Fetch API will not carry, instead of leaving it open', async () => {
    const { saved, origin } = await serve();
    const { port } = new URL(origin);
    /** The status line a raw request gets back. */
    const raw = (head: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(Number(port), '127.0.0.1', () => socket.write(`${head}\r\nConnection: close\r\n\r\n`));
        let answer = '';
        socket.on('data', (chunk) => {
          answer += chunk;
        });
        socket.on('end', () => resolve(answer.split('\r\n')[0] ?? ''));
        socket.on('error', reject);
        socket.setTimeout(3000, () => reject(new Error('no answer')));
      });
    expect(await raw('TRACE /api/feedback HTTP/1.1\r\nHost: app.example')).toContain('400');
    expect(await raw('POST /api/feedback HTTP/1.1\r\nHost: a b\r\nContent-Length: 0')).toMatch(/400|415/);
    expect(saved).toEqual([]);
  });

  it('answers 500 when the handler itself fails', async () => {
    const failing = toNode(async () => {
      throw new Error('boom');
    });
    const server = createServer((req, res) => void failing(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(() => resolve()));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect(response.status).toBe(500);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('keeps the origin check and the size cap', async () => {
    const { saved, post, origin } = await serve();
    expect((await post(note, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ ...note, payload: 'x'.repeat(MAX_FEEDBACK_BODY) })).status).toBe(413);
    expect((await fetch(`${origin}/api/feedback`)).status).toBe(405);
    expect(saved).toEqual([]);
  });
});
