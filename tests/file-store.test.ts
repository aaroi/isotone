import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { writeJson } from '../src/file-store';
import { createVariant, readVariant, variantDir } from '../src/variants-store';

it('serializes independent writers while readers only see complete JSON', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iso-atomic-'));
  const file = join(root, 'counter.json');
  // Compile this dependency-free helper so the child test also runs on Node
  // 20, which has no built-in TypeScript loader.
  const helper = join(root, 'file-store.mjs');
  writeFileSync(helper, ts.transpileModule(readFileSync(new URL('../src/file-store.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText);
  writeJson(file, []);
  const errors: unknown[] = [];
  const reader = setInterval(() => {
    try { JSON.parse(readFileSync(file, 'utf8')); } catch (error) { errors.push(error); }
  }, 1);
  try {
    await Promise.all(Array.from({ length: 4 }, (_, writer) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        import { readFileSync } from 'node:fs';
        import { withFileLock, writeJson } from ${JSON.stringify(pathToFileURL(helper).href)};
        for (let i = 0; i < 50; i++) withFileLock(${JSON.stringify(file)}, () => {
          const items = JSON.parse(readFileSync(${JSON.stringify(file)}, 'utf8'));
          items.push(${writer} * 50 + i);
          writeJson(${JSON.stringify(file)}, items);
        });
      `], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
    const values = JSON.parse(readFileSync(file, 'utf8')) as number[];
    expect(new Set(values).size).toBe(200);
    expect(values).toHaveLength(200);
    expect(errors).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(['counter.json', 'file-store.mjs']);
  } finally {
    clearInterval(reader);
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps the old file if serialization fails and leaves no temporary files', () => {
  const root = mkdtempSync(join(tmpdir(), 'iso-atomic-error-'));
  const file = join(root, 'notes.json');
  try {
    writeJson(file, ['Original']);
    expect(() => writeJson(file, { bad: 1n })).toThrow();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['Original']);
    expect(readdirSync(root)).toEqual(['notes.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('preserves every file when separate agents add to the same variant', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iso-variant-writers-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const runtime = join(root, 'runtime');
    // Run the current sources in child processes without rebuilding the
    // package or requiring a TypeScript loader in the supported Node versions.
    for (const source of ['variants-store', 'store', 'file-store', 'core/variants', 'core/request']) {
      const output = join(runtime, `${source}.mjs`);
      mkdirSync(dirname(output), { recursive: true });
      const compiled = ts.transpileModule(readFileSync(new URL(`../src/${source}.ts`, import.meta.url), 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, '$1$2.mjs$3');
      writeFileSync(output, compiled);
    }
    createVariant({ root }, { id: 'shared' });
    const files = Array.from({ length: 20 }, (_, index) => `source-${index}.txt`);
    for (const file of files) writeFileSync(join(root, file), `Contents of ${file}`);
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, writer) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        import { addVariantFile } from ${JSON.stringify(pathToFileURL(join(runtime, 'variants-store.mjs')).href)};
        for (const file of ${JSON.stringify(files.slice(writer * 5, writer * 5 + 5))}) {
          addVariantFile({ root: ${JSON.stringify(root)} }, 'shared', file);
        }
      `], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    expect(Object.keys(readVariant({ root }, 'shared')?.files ?? {}).sort()).toEqual(files.sort());
    for (const file of files) expect(readFileSync(join(variantDir({ root }, 'shared'), file), 'utf8')).toBe(`Contents of ${file}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
