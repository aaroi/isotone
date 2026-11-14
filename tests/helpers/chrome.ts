/**
 * A headless Chrome over the DevTools Protocol, for the few tests that need real
 * layout (jsdom has none). Finds Chrome from `CHROME`, then the usual install
 * paths; `findChrome()` returns null when there is none, and CI must have one.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const CANDIDATES: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

export function findChrome(): string | null {
  if (process.env.CHROME) return process.env.CHROME;
  for (const candidate of CANDIDATES[process.platform] ?? []) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (dir && existsSync(join(dir, candidate))) return join(dir, candidate);
    }
  }
  return null;
}

export interface Chrome {
  /** Evaluate an expression in the page, awaiting a promise, and return its JSON value. */
  eval<T>(expression: string): Promise<T>;
  goto(url: string): Promise<void>;
  viewport(width: number, height: number, mobile?: boolean): Promise<void>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number): Promise<void>;
  /** Close Chrome, wait for it to exit and remove its profile. */
  close(): Promise<void>;
}

export async function launchChrome(binary: string): Promise<Chrome> {
  const profile = mkdtempSync(join(tmpdir(), 'isotone-chrome-'));
  const proc = spawn(
    binary,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      // Recent Ubuntu runners refuse Chrome's sandbox; the page is the test's own, on loopback.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  const removeProfile = async () => {
    // Windows can hold the profile a moment after Chrome exits.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  };
  const kill = async () => {
    proc.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    await removeProfile();
  };
  let ws: WebSocket;
  try {
    // Chrome prints the DevTools address it chose on stderr.
    const browserUrl = await new Promise<string>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${seen}`)), 20_000);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      proc.once('error', fail);
      proc.once('exit', () => fail(new Error(`Chrome exited: ${seen}`)));
      proc.stderr.on('data', (chunk: Buffer) => {
        seen += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
        if (match) {
          clearTimeout(timer);
          resolve(match[1] as string);
        }
      });
    });
    const { port } = new URL(browserUrl);
    // The first page can take a moment to be listed.
    let page: { type: string; webSocketDebuggerUrl: string } | undefined;
    for (let attempt = 0; !page && attempt < 50; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 100));
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      page = targets.find((target) => target.type === 'page');
    }
    if (!page) throw new Error('Chrome opened no page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Could not reach Chrome')), { once: true });
    });
  } catch (error) {
    await kill();
    throw error;
  }
  let id = 0;
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const loads = new Set<() => void>();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Page.loadEventFired') for (const done of loads) done();
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });
  // biome-ignore lint/suspicious/noExplicitAny: protocol results are loosely typed.
  const send = (method: string, params: object = {}): Promise<any> =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  const mouse = (type: string, x: number, y: number) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  return {
    async eval<T>(expression: string) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value as T;
    },
    async goto(url) {
      const loaded = new Promise<void>((resolve) => {
        const done = () => {
          loads.delete(done);
          resolve();
        };
        loads.add(done);
      });
      await send('Page.navigate', { url });
      await loaded;
    },
    async viewport(width, height, mobile = false) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    },
    async move(x, y) {
      await mouse('mouseMoved', x, y);
    },
    async click(x, y) {
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y);
      await mouse('mouseReleased', x, y);
    },
    async close() {
      ws.close();
      await kill();
    },
  };
}
