import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function resolveSource(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}

/**
 * Compile `src` modules, and every module they import, to plain `.mjs` under
 * `outDir`, so a child process runs the current sources on Node 20, which has
 * no built-in TypeScript loader. Entries are paths relative to `src`, without
 * an extension. Returns each entry's file URL.
 */
export function compileSources(entries: string[], outDir: string): Record<string, string> {
  const done = new Set<string>();
  const visit = (file: string): void => {
    if (done.has(file)) return;
    done.add(file);
    const output = join(outDir, relative(SRC, file)).replace(/\.tsx?$/, '.mjs');
    const compiled = ts
      .transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: true },
      })
      .outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_, start: string, specifier: string, end: string) => {
        const target = resolveSource(file, specifier);
        visit(target);
        let path = relative(dirname(file), target).replace(/\.tsx?$/, '.mjs');
        if (!path.startsWith('.')) path = `./${path}`;
        return `${start}${path}${end}`;
      });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, compiled);
  };
  const urls: Record<string, string> = {};
  for (const entry of entries) {
    const file = resolveSource(join(SRC, 'entry'), `./${entry}`);
    visit(file);
    urls[entry] = pathToFileURL(join(outDir, relative(SRC, file)).replace(/\.tsx?$/, '.mjs')).href;
  }
  return urls;
}
