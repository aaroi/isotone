import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The IIFE bundle, next to this module in `dist/`. */
export function readBundle(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    // built: dist/serve.js sits beside the bundle
    resolve(here, 'isotone.global.js'),
    resolve(here, '..', 'dist', 'isotone.global.js'),
    // from source (tests): src/serve/ -> the repo's dist/
    resolve(here, '..', '..', 'dist', 'isotone.global.js'),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error(
    'isotone: the browser bundle is missing from dist/. Run `pnpm build`.',
  );
}
