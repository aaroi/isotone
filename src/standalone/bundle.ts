import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The IIFE bundle, next to this module in `dist/`. */
export function readBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    // built: dist/serve.js sits beside the bundle
    resolve(here, 'iso-iterate.global.js'),
    resolve(here, '..', 'dist', 'iso-iterate.global.js'),
    // from source (tests): src/serve/ -> the repo's dist/
    resolve(here, '..', '..', 'dist', 'iso-iterate.global.js'),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    'iso-iterate: the browser bundle is missing from dist/. Run `pnpm build`.',
  );
}
