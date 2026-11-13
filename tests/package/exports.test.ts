import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every name each subpath exports, types included. The list is the supported
// API: a name added to a barrel fails here until it is added on purpose, and
// a name removed is a breaking change for the CHANGELOG.
const SUPPORTED: Record<string, string[]> = {
  react: [
    'IsotonePanel',
    'IsotonePanelProps',
    'IsotoneShortcut',
    'IsotoneStoreConfig',
    'IsotoneTheme',
    'MountIsotoneOptions',
    'VariantAxis',
    'VariantSelections',
    'VariantsSource',
    'createVariantsSource',
    'mountIsotone',
  ],
  core: [
    'ColorSwatch',
    'ColorVariantAxis',
    'IsotoneElement',
    'IsotoneNote',
    'NoteContext',
    'NoteReply',
    'RangeVariantAxis',
    'RouteGateOptions',
    'SelectVariantAxis',
    'VariantAction',
    'VariantAxis',
    'VariantAxisCondition',
    'VariantOption',
    'VariantReference',
    'VariantRemoval',
    'VariantSelections',
    'VariantsSource',
    'createVariantsSource',
  ],
  serve: ['ServeIsotoneOptions', 'ServedIsotone', 'serveIsotone'],
  vite: ['IsotonePlugin', 'IsotoneViteOptions', 'isotone', 'iteration'],
  feedback: [
    'FeedbackBrowser',
    'FeedbackEntry',
    'FeedbackOptions',
    'FeedbackStore',
    'PostgresClient',
    'PostgresOptions',
    'feedback',
    'postgresStore',
    'toNode',
  ],
  postgres: ['PostgresUrlOptions', 'postgres'],
  cli: ['CliIO', 'runCli'],
};

const root = new URL('../../', import.meta.url);
const entry = (subpath: string) => fileURLToPath(new URL(`src/${subpath}/index.ts`, root));

describe('public API', () => {
  it('package.json exports exactly these subpaths', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { exports: Record<string, unknown> };
    const subpaths = Object.keys(pkg.exports).filter((key) => key !== './package.json');
    expect(subpaths.sort()).toEqual(
      Object.keys(SUPPORTED)
        .map((name) => `./${name}`)
        .sort(),
    );
  });

  // Type-checking every entry is about 1.5 s of CPU alone and several times that
  // on a loaded runner, so this one test gets a longer timeout.
  it('each subpath exports exactly its supported names', { timeout: 60_000 }, () => {
    const files = Object.keys(SUPPORTED).map(entry);
    const program = ts.createProgram(files, {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const actual = Object.fromEntries(
      Object.keys(SUPPORTED).map((subpath) => {
        const source = program.getSourceFile(entry(subpath));
        const module = source && checker.getSymbolAtLocation(source);
        const names = module ? checker.getExportsOfModule(module).map((symbol) => symbol.name) : [];
        return [subpath, names.sort()];
      }),
    );
    expect(actual).toEqual(Object.fromEntries(Object.entries(SUPPORTED).map(([key, names]) => [key, [...names].sort()])));
  });
});
