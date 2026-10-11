/**
 * isotone — the standalone browser bundle.
 *
 * Built as an IIFE with React bundled in, so a host needs no build step, no
 * bundler and no React of its own: one `<script src>` (or a bookmarklet) and
 * the panel is there. `isotone serve` hands this file out and appends the
 * `mount` call with its own endpoint, which is why this only exposes the entry
 * point rather than mounting on load — the config lives with the server that
 * owns the notes file, not baked into the bundle.
 */
import { mountIteration, type MountIterationOptions } from '../react/IterationMount';

interface IsotoneGlobal {
  mount(options: MountIterationOptions): void;
  unmount(): void;
  readonly mounted: boolean;
}

declare global {
  interface Window {
    __isotone?: IsotoneGlobal;
  }
}

// A bookmarklet or a hot-reloaded integration can evaluate this script again.
window.__isotone?.unmount();
let off: (() => void) | null = null;

const api: IsotoneGlobal = {
  /** Mount, replacing any panel this bundle already put up. Re-running the
   *  script (a second injection, a bookmarklet clicked twice) swaps the panel
   *  instead of stacking a second one. */
  mount(options) {
    off?.();
    off = mountIteration(options);
  },
  unmount() {
    off?.();
    off = null;
  },
  get mounted() {
    return off !== null;
  },
};

window.__isotone = api;
