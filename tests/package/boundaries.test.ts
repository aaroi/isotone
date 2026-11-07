import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The layers in docs/development.md ("Boundaries"), checked on every import
// statement in src: browser-safe core, Node-only code that never reaches the
// panel, and React kept out of everything the server entries load.
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

/** Every module a file imports or re-exports: bare specifiers as written,
 *  relative ones as a path inside src. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)].map(
    (match) => match[1] ?? match[2],
  );
  return specifiers.map((specifier) =>
    specifier.startsWith('.')
      ? relative(SRC, resolve(dirname(file), specifier))
          .split('\\')
          .join('/')
      : specifier,
  );
}

const files = sources(SRC).map((file) => ({ path: relative(SRC, file).split('\\').join('/'), imports: importsOf(file) }));
const inLayer = (layer: string) => files.filter((file) => file.path.startsWith(`${layer}/`));
/** The react and react-dom packages, or the panel's own src/react layer. */
const isReact = (specifier: string) => /^(react|react-dom)(\/|$)/.test(specifier);

describe('import boundaries', () => {
  it('finds the sources it checks', () => {
    expect(inLayer('core').length).toBeGreaterThan(5);
    expect(inLayer('node').length).toBeGreaterThan(5);
  });

  it('keeps core free of Node, React, Vite and every other layer', () => {
    const offending = inLayer('core').flatMap((file) =>
      file.imports
        .filter(
          (specifier) => specifier.startsWith('node:') || isReact(specifier) || specifier === 'vite' || !/^core(\/|$)/.test(specifier),
        )
        .map((specifier) => `${file.path} → ${specifier}`),
    );
    expect(offending).toEqual([]);
  });

  it('keeps React and the panel out of Node code and the server entries', () => {
    const offending = ['node', 'server', 'serve', 'vite', 'cli'].flatMap((layer) =>
      inLayer(layer).flatMap((file) => file.imports.filter(isReact).map((specifier) => `${file.path} → ${specifier}`)),
    );
    expect(offending).toEqual([]);
  });

  it('keeps Vite out of Node code', () => {
    const offending = inLayer('node').flatMap((file) =>
      file.imports
        .filter((specifier) => specifier === 'vite' || /^vite(\/|$)/.test(specifier))
        .map((specifier) => `${file.path} → ${specifier}`),
    );
    expect(offending).toEqual([]);
  });
});
