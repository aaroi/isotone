/**
 * iso-iterate — `init`: tells a repo which of overlay, host or serve fits
 * it, prints the setup for the chosen one, and (opt-in) drops the paperwork.
 * Never touches vite.config or app code — at most AGENTS.md and a fresh
 * `.iso-iterate/variants/README.md`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_VARIANTS_DIR } from '../variants-store';
import { type CliIO, errOut, extractBoolFlag, extractFlag, out } from './util';

type Host = 'vite' | 'next' | 'other';
type Approach = 'host' | 'overlay' | 'serve';

const AXES_ROOTS = ['src', 'app', 'lib', 'experiments', 'components'];
const AXES_MAX_DEPTH = 4;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts)$/;
const AGENTS_MARKER = '## iso-iterate';

export function runInit(args: string[], io: CliIO): number {
  const { value: approachArg, rest: r1 } = extractFlag(args, '--approach');
  const { present: yes, rest: r2 } = extractBoolFlag(r1, '--yes');

  if (r2[0] === '--help' || r2[0] === '-h' || r2[0] === 'help') {
    out(io, 'Usage: iso-iterate init                      look at this repo and recommend an approach');
    out(io, '       iso-iterate init --approach <name>    print the setup for overlay, host or serve');
    out(io, '       iso-iterate init --approach <name> --yes');
    out(io, '                                             also write the AGENTS.md paragraph (and, for');
    out(io, '                                             overlay, .iso-iterate/variants/README.md)');
    out(io, 'init never edits vite.config or app code.');
    return 0;
  }

  const host = detectHost(io.cwd);
  if (approachArg === undefined) {
    printDetection(io, host, detectHostOwnedAxes(io.cwd));
    return 0;
  }
  if (!isApproach(approachArg)) {
    errOut(io, `Unknown approach "${approachArg}". Use host, overlay or serve.`);
    return 1;
  }

  printApproach(io, approachArg, host);
  if (yes) applyApproach(io.cwd, approachArg);
  return 0;
}

function isApproach(v: string): v is Approach {
  return v === 'host' || v === 'overlay' || v === 'serve';
}

/* ── detection ────────────────────────────────────────────────────────── */

function detectHost(cwd: string): Host {
  const files = safeReaddir(cwd);
  const has = (prefix: string) => files.some((f) => f === prefix || f.startsWith(`${prefix}.`));
  if (has('vite.config') || has('react-router.config')) return 'vite';
  if (has('next.config')) return 'next';
  return 'other';
}

function detectHostOwnedAxes(cwd: string): boolean {
  return AXES_ROOTS.some((root) => walkForAxes(join(cwd, root), AXES_MAX_DEPTH));
}

function walkForAxes(dir: string, depthLeft: number): boolean {
  if (depthLeft < 0) return false;
  const entries = safeReaddirent(dir);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      if (walkForAxes(join(dir, entry.name), depthLeft - 1)) return true;
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name)) continue;
    const text = safeRead(join(dir, entry.name));
    if (entry.name === 'meta.ts' && text.includes('defaultOption')) return true;
    if (text.includes('useVariant(')) return true;
  }
  return false;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeReaddirent(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/* ── printing ─────────────────────────────────────────────────────────── */

function hostLabel(host: Host): string {
  return host === 'vite' ? 'Vite' : host === 'next' ? 'Next' : 'other';
}

function printDetection(io: CliIO, host: Host, hostOwnedAxes: boolean): void {
  out(io, `iso-iterate init — ${hostLabel(host)}`);
  out(io, '');
  out(io, 'Approaches');
  out(io, '  1. overlay   Alternative source files under .iso-iterate/variants, swapped by the Vite');
  out(io, '               plugin while a variant is active. Zero changes to app code. Committed.');
  out(io, '  2. host      Your app already owns variants (axes + hooks). Hand them to the panel with');
  out(io, '               mountIteration({ variants: source }). Nothing new in git.');
  out(io, '  3. serve     No bundler hook available. Notes via `npx iso-iterate serve` or a route');
  out(io, '               handler on iso-iterate/server; variants need approach 2.');
  out(io, '');
  const [n, reason] = recommend(host, hostOwnedAxes);
  out(io, `Recommended: ${n} because ${reason}`);
  out(io, 'Ask the person you are working for which approach they want, then run');
  out(io, '  npx iso-iterate init --approach <name>');
  out(io, 'That prints the setup; add --yes to also write the AGENTS.md paragraph.');
}

function recommend(host: Host, hostOwnedAxes: boolean): [number, string] {
  if (hostOwnedAxes) {
    return [
      2,
      'this app already defines variant axes and hooks, so the panel should read them directly instead of duplicating them as file overlays.',
    ];
  }
  if (host === 'vite') {
    return [1, 'the Vite plugin can swap alternative files in with zero changes to app code.'];
  }
  return [
    3,
    'there is no bundler hook to swap files here, so notes work today and variants would need approach 2.',
  ];
}

function printApproach(io: CliIO, approach: Approach, host: Host): void {
  out(io, `iso-iterate init — ${approach}`);
  out(io, '');
  if (approach === 'overlay') {
    if (host !== 'vite') {
      out(io, 'No vite.config or react-router.config found here. Overlay variants need the Vite');
      out(io, 'plugin; for another dev server use --approach serve for notes, or host for variants.');
      out(io, '');
    }
    out(io, 'Add the plugin in vite.config.ts (npm install -D iso-iterate first):');
    out(io, '');
    out(io, "  import { defineConfig } from 'vite';");
    out(io, "  import { iteration } from 'iso-iterate/vite';");
    out(io, '');
    out(io, '  export default defineConfig({ plugins: [iteration()] });');
    out(io, '');
    out(io, 'That serves the notes and variants endpoints from the dev server and injects the');
    out(io, 'panel. Alternative source files live under .iso-iterate/variants/<id>/<repo-relative');
    out(io, 'path>, one directory per variant, with a variant.json manifest next to them; the');
    out(io, 'plugin swaps them in for the real files while that variant is active, one selector');
    out(io, 'per decision (variants over one file, or made with --group) on its route. Keep');
    out(io, '@vitejs/plugin-react (or your framework plugin) in the list so a switch swaps the');
    out(io, 'component in place instead of reloading the page.');
  } else if (approach === 'host') {
    out(io, 'Your app owns the variant state; the panel is a view over it. A complete example:');
    out(io, '');
    for (const line of HOST_EXAMPLE) out(io, line ? `  ${line}` : '');
    out(io, '');
    out(io, 'onChange fires with the full selections after every change; the app renders from');
    out(io, "them and keeps its own defaults and URL sync. Add endpoint: '/api/iteration/notes'");
    out(io, 'for a Notes tab too (served by the Vite plugin or `iso-iterate serve`), and');
    out(io, "defaultTab: 'variants' when reviewers come for the controls first.");
  } else {
    out(io, 'npx iso-iterate serve');
    out(io, '');
    out(io, 'Then, in dev only, one line in the host HTML:');
    out(io, '  <script src="http://127.0.0.1:4123/iso-iterate.js" defer></script>');
    out(io, '');
    out(io, 'That is the endpoint and the panel from one process, with no app code. To serve the');
    out(io, `endpoint from ${host === 'next' ? 'a Next route handler' : "the app's own dev server"} instead, iso-iterate/server has the handler:`);
    out(io, '');
    for (const line of ROUTE_HANDLER_EXAMPLE) out(io, line ? `  ${line}` : '');
    out(io, '');
    out(io, 'and the panel mounts from a dev-only client module:');
    out(io, '');
    out(io, "  import { mountIteration } from 'iso-iterate/react';");
    out(io, "  if (process.env.NODE_ENV === 'development') mountIteration({ endpoint: '/api/iteration/notes' });");
  }
  out(io, '');
  out(io, 'Paste this into AGENTS.md:');
  out(io, '');
  for (const line of agentsParagraph(approach).split('\n')) out(io, line);
}

/** Typechecks against `iso-iterate/react` as written; `kind` defaults to select. */
const HOST_EXAMPLE = [
  "import { createVariantsSource, mountIteration } from 'iso-iterate/react';",
  "import type { VariantAxis } from 'iso-iterate/react';",
  '',
  'const axes: VariantAxis[] = [',
  '  {',
  "    id: 'cta',",
  "    label: 'Call to action',",
  "    defaultOption: 'join',",
  '    options: [',
  "      { id: 'join', label: 'Join the waitlist' },",
  "      { id: 'start', label: 'Get started' },",
  '    ],',
  '  },',
  '];',
  '',
  'const source = createVariantsSource({',
  '  axes,',
  '  onChange: (selections) => {',
  "    // selections is { cta: 'join' | 'start' }; render from it.",
  '    document.documentElement.dataset.cta = selections.cta;',
  '  },',
  '});',
  '',
  'mountIteration({ variants: source });',
];

/** A Request-based handler; `serveNotesRequest` reads the method, query and
 *  JSON body itself, so GET, POST and DELETE all go through the one export. */
const ROUTE_HANDLER_EXAMPLE = [
  '// app/api/iteration/notes/route.ts',
  "import { serveNotesRequest } from 'iso-iterate/server';",
  '',
  'const handle = async (req: Request) => {',
  "  const { status, headers, body } = await serveNotesRequest('.iteration-feedback.json', req);",
  '  return Response.json(body, { status, headers });',
  '};',
  'export { handle as GET, handle as POST, handle as DELETE };',
];

function applyApproach(cwd: string, approach: Approach): void {
  appendAgentsParagraph(cwd, agentsParagraph(approach));
  if (approach === 'overlay') createVariantsReadme(cwd);
}

function agentsParagraph(approach: Approach): string {
  if (approach === 'overlay') {
    return [
      AGENTS_MARKER,
      '',
      'Variants are alternative file contents behind a switch in the panel, under',
      '.iso-iterate/variants/<id>/. When a note asks for a different version, don’t edit',
      'the real file: `variant new <id> --note <prefix>` starts one from the note,',
      '`variant add <id> <file...>` copies files into it, then edit the copy (`variant',
      'path <id> <file>` prints where). Give it the route from the note, and `--group <id>`',
      'when it is one of several alternatives of the same element that touch different',
      'files, so the panel shows one selector per decision on its page. `variant use',
      '<id>` switches the dev server to it, `default` goes back. Once the reviewer picks',
      'a winner, `variant promote <id>` lands it over the real files; it refuses a stale',
      'or conflicted override, `variant sync <id>` merges first. A `[set-defaults]` note',
      'carrying `variants=<id>, <id>` means promote each named id and leave the other',
      'variants alone; `variant drop <id>` only when asked to drop one.',
    ].join('\n');
  }
  if (approach === 'host') {
    return [
      AGENTS_MARKER,
      '',
      'This app hands its own variant axes to the iso-iterate panel through a',
      'VariantsSource (`createVariantsSource({ axes, onChange })` passed to',
      '`mountIteration({ variants: source })`), so switching a variant in the panel calls',
      'back into this app’s own state rather than swapping a file. There is nothing under',
      '.iso-iterate/ for it; promotion and defaults stay this app’s own code to change.',
    ].join('\n');
  }
  return [
    AGENTS_MARKER,
    '',
    'Notes from the panel land in .iteration-feedback.json. Read them with `npx',
    'iso-iterate` and mark one addressed with `npx iso-iterate --done <id>`. Variants',
    'need a bundler hook this app doesn’t have; re-run `iso-iterate init` if it gets a',
    'Vite config later, or ask for approach host if it already owns variant state.',
  ].join('\n');
}

function appendAgentsParagraph(cwd: string, paragraph: string): void {
  const file = join(cwd, 'AGENTS.md');
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (existing.includes(AGENTS_MARKER)) return; // already there; do not duplicate
  const sep = existing ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  writeFileSync(file, `${existing}${sep}${paragraph}\n`);
}

function createVariantsReadme(cwd: string): void {
  const dir = join(cwd, DEFAULT_VARIANTS_DIR);
  mkdirSync(dir, { recursive: true });
  const readme = join(dir, 'README.md');
  if (existsSync(readme)) return;
  writeFileSync(
    readme,
    [
      '# Overlay variants',
      '',
      'Each subdirectory here is one variant: `<id>/variant.json` is its manifest, and',
      'everything else under `<id>/` mirrors a real source file at its repo-relative path.',
      'The Vite plugin swaps a file in for the real one while that variant is active.',
      '',
      'Manage these with the CLI rather than by hand:',
      '',
      '  npx iso-iterate variant list',
      '  npx iso-iterate variant new <id>',
      '  npx iso-iterate variant add <id> <file...>',
      '  npx iso-iterate variant use <id>',
      '  npx iso-iterate variant promote <id>',
      '',
    ].join('\n'),
  );
}
