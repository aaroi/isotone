/**
 * Vitest global setup: make sure `dist/isotone.global.js` matches the source.
 *
 * `isotone serve` and the Vite plugin serve that prebuilt bundle, so the tests
 * that load it would otherwise run against whatever the last `pnpm build` left
 * behind, or fail when there was none. Rebuild just that bundle (about a
 * second) when any source file is newer.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Options } from 'tsup';

import config from '../../tsup.config';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundle = join(root, 'dist/isotone.global.js');

function newest(dir: string): number {
  return Math.max(
    0,
    ...readdirSync(dir, { withFileTypes: true }).map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? newest(path) : statSync(path).mtimeMs;
    }),
  );
}

export default async function setup() {
  let built = 0;
  try {
    built = statSync(bundle).mtimeMs;
  } catch {}
  if (built > newest(join(root, 'src'))) return;
  const standalone = (config as Options[]).find((options) => options.format?.includes('iife'));
  if (!standalone) throw new Error('tsup.config.ts has no standalone (iife) build');
  await build({ ...standalone, config: false, silent: true, outDir: join(root, 'dist') });
}
