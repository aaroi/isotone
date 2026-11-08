import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The layers in docs/development.md ("Boundaries"), checked on every import in
// src, dynamic `import()` included: which layers each one may use, Node's
// built-ins kept out of browser code, React out of the server entries.
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Each layer and the layers it may import from (itself included). */
const ALLOWED: Record<string, readonly string[]> = {
  core: ['core'],
  react: ['core', 'react'],
  standalone: ['core', 'react', 'standalone'],
  node: ['core', 'node'],
  serve: ['core', 'node', 'serve'],
  vite: ['core', 'node', 'vite'],
  cli: ['core', 'node', 'serve', 'cli'],
};
/** Layers that run in a browser: no `node:*`. */
const BROWSER = ['core', 'react', 'standalone'];
/** Packages only some layers may import. */
const PACKAGES: [RegExp, readonly string[]][] = [
  [/^(react|react-dom|lucide-react)(\/|$)/, ['react', 'standalone']],
  [/^vite(\/|$)/, ['vite']],
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

/** Every module a file imports, re-exports or loads with `import()`: bare
 *  specifiers as written, relative ones as a path inside src. */
function importsOf(file: string, text = readFileSync(file, 'utf8')): string[] {
  const statics = /^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  const dynamics = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const specifiers = [...text.matchAll(statics), ...text.matchAll(dynamics)].map((match) => match[1] ?? match[2] ?? '');
  return specifiers.map((specifier) =>
    specifier.startsWith('.')
      ? relative(SRC, resolve(dirname(file), specifier))
          .split('\\')
          .join('/')
      : specifier,
  );
}

const files = sources(SRC).map((file) => ({ path: relative(SRC, file).split('\\').join('/'), imports: importsOf(file) }));
const layerOf = (path: string) => path.split('/')[0] ?? '';

/** What a file may not import, as `file → specifier`. */
function violations(file: { path: string; imports: string[] }): string[] {
  const layer = layerOf(file.path);
  const allowed = ALLOWED[layer] ?? [];
  return file.imports
    .filter((specifier) => {
      if (specifier.startsWith('node:')) return BROWSER.includes(layer);
      const pkg = PACKAGES.find(([pattern]) => pattern.test(specifier));
      if (pkg) return !pkg[1].includes(layer);
      // A relative import resolves inside src, so its first segment is a layer.
      if (!/^[a-z]+\//.test(specifier) || !(layerOf(specifier) in ALLOWED)) return false;
      return !allowed.includes(layerOf(specifier));
    })
    .map((specifier) => `${file.path} → ${specifier}`);
}

describe('import boundaries', () => {
  it('knows every layer in src', () => {
    expect([...new Set(files.map((file) => layerOf(file.path)))].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('keeps each layer to the layers and packages it may use', () => {
    expect(files.flatMap(violations)).toEqual([]);
  });

  it('catches a forbidden import, static or dynamic', () => {
    const check = (path: string, text: string) => violations({ path, imports: importsOf(join(SRC, path), text) });
    expect(check('react/bad.ts', "import { readFileSync } from 'node:fs';")).toHaveLength(1);
    expect(check('react/bad.ts', "import { readNotes } from '../node/notes/store';")).toHaveLength(1);
    expect(check('core/bad.ts', "const fs = await import('node:fs');")).toHaveLength(1);
    expect(check('serve/bad.ts', "export { iteration } from '../vite/index';")).toHaveLength(1);
    expect(check('node/bad.ts', "import { mountIteration } from '../standalone/index';")).toHaveLength(1);
    expect(check('cli/ok.ts', "import { readNotes } from '../node/notes/store';")).toEqual([]);
  });
});
