/**
 * Where the guides shipped with this package are, as a path an agent can
 * open from the project it runs in. Resolved from the running package itself,
 * so a hoisted monorepo (isotone in the root `node_modules`), pnpm's store or
 * an `npx` cache all print a path that exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let root: string | undefined;

/** The directory holding this package's package.json: `dist/..` once built, the repo in development. */
function packageRoot(): string {
  root ??= findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return root;
}

function findPackageRoot(start: string): string {
  for (let dir = start; dirname(dir) !== dir; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    try {
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'isotone') return dir;
    } catch {
      /* Not ours; keep looking. */
    }
  }
  return dirname(start);
}

/**
 * A shipped file (`docs/agent-guide.md`) as seen from `cwd`:
 * `node_modules/isotone/…` when the project has it there, a relative path
 * into an ancestor's `node_modules` in a hoisted workspace, else absolute.
 */
export function docPath(cwd: string, file: string, from = packageRoot()): string {
  if (existsSync(join(cwd, 'node_modules', 'isotone', file))) return `node_modules/isotone/${file}`;
  const absolute = join(from, file);
  const path = relative(cwd, absolute).split(sep).join('/');
  return !isAbsolute(path) && /^(\.\.\/)*node_modules\//.test(path) ? path : absolute;
}
