// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readBundle } from '../src/standalone/bundle';
import type { MountIterationOptions } from '../src/react/IterationMount';

type PanelGlobal = { mount(options: MountIterationOptions): void; unmount(): void; mounted: boolean };
const panel = () => (window as unknown as { __isoIterate: PanelGlobal }).__isoIterate;
function inject(bundle: string) {
  // biome-ignore lint/security/noGlobalEval: Execute our own built IIFE to test the script-tag entry point.
  window.eval(bundle);
}

afterEach(() => {
  panel()?.unmount();
  vi.runAllTimers();
  vi.useRealTimers();
});

it('replaces the old standalone instance when the script is injected twice', () => {
  vi.useFakeTimers();
  const bundle = readBundle();
  inject(bundle);
  const first = panel();
  first.mount({ endpoint: '/api/iteration/notes' });
  expect(first.mounted).toBe(true);
  inject(bundle);
  expect(first.mounted).toBe(false);
  expect(panel()).not.toBe(first);
  // Let the old deferred unmount complete before checking the new host.
  vi.runAllTimers();
  expect(document.querySelectorAll('[data-iso-iterate="root"]')).toHaveLength(0);
  panel().mount({ endpoint: '/api/iteration/notes' });
  expect(document.querySelectorAll('[data-iso-iterate="root"]')).toHaveLength(1);
  panel().unmount();
  vi.runAllTimers();
  expect(document.querySelectorAll('[data-iso-iterate="root"]')).toHaveLength(0);
});
