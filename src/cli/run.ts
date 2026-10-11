/**
 * iso-iterate — CLI command handling, factored out of the executable entry
 * point (`./index.ts`) so tests can call `runCli` directly against an
 * in-memory sink instead of spawning a subprocess for every case, and so
 * `dist/cli.js` and a plain `import('iso-iterate/cli')` both work off the
 * same function.
 *
 *   npx iso-iterate                # open notes, all routes
 *   npx iso-iterate /projects      # one route
 *   npx iso-iterate --days 30      # widen the window
 *   npx iso-iterate --all          # include done items
 *   npx iso-iterate --done <id>    # mark addressed (id prefix ok)
 *   npx iso-iterate --undone <id>  # reopen
 *   npx iso-iterate --file <path>  # point at a non-default notes file
 *
 *   npx iso-iterate serve          # stand up the endpoint + panel for any host
 *   npx iso-iterate serve --port 4123
 *
 *   npx iso-iterate variant ...    # see ./variant.ts
 *   npx iso-iterate init ...       # see ./init.ts
 *   npx iso-iterate --help         # the command surface, also `variant --help`
 */
import { resolve } from 'node:path';

import { readNotes, updateNotes, type StoredNote } from '../store';
import { runInit } from './init';
import { type CliIO, errOut, findNoteByPrefix, has, makeIo, out, parseArgs, valueFor } from './util';
import { runVariant } from './variant';
import { runCheckUpdate } from './update';

export type { CliIO } from './util';

export async function runCli(argv: string[], ioInput: Partial<CliIO> = {}): Promise<number> {
  const io = makeIo(ioInput);
  try {
    if (argv[0] === 'check-update') return await runCheckUpdate(argv.slice(1), io);
    if (argv[0] === 'serve') return await runServe(argv.slice(1), io);
    if (argv[0] === 'variant') return await runVariant(argv.slice(1), io);
    if (argv[0] === 'init') return runInit(argv.slice(1), io);
    if (isHelp(argv[0])) {
      printHelp(io);
      return 0;
    }
    return runNotes(argv, io);
  } catch (error) {
    errOut(io, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function isHelp(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h' || arg === 'help';
}

function printHelp(io: CliIO): void {
  out(io, 'iso-iterate — notes and variants between a reviewer’s browser and a coding agent');
  out(io);
  out(io, 'Notes (the file is .iteration-feedback.json in the current directory)');
  out(io, '  iso-iterate                    open notes, all routes');
  out(io, '  iso-iterate <route>            one route');
  out(io, '  iso-iterate --done <id>        mark addressed (an id prefix is enough)');
  out(io, '  iso-iterate --undone <id>      reopen');
  out(io, '  iso-iterate --all              include done notes');
  out(io, '  iso-iterate --days <n>         widen the window (default 14)');
  out(io, '  iso-iterate --file <path>      another notes file');
  out(io, '  iso-iterate --json             full note records as JSON for agents and scripts');
  out(io);
  out(io, 'Endpoint and panel for a host without the Vite plugin');
  out(io, '  iso-iterate serve [--port 4123] [--file <path>] [--theme auto|light|dark|system]');
  out(io);
  out(io, 'Overlay variants');
  out(io, '  iso-iterate variant --help');
  out(io);
  out(io, 'Updates (read-only)');
  out(io, '  iso-iterate check-update [--json] [--manager npm|pnpm|yarn]');
  out(io);
  out(io, 'Setting a repo up');
  out(io, '  iso-iterate init [--approach overlay|host|serve] [--yes] [--json]');
}

/**
 * `serve` runs until signalled, so unlike every other command its exit code
 * arrives asynchronously, once the server has actually closed — the caller
 * (index.ts) awaits this the same way it awaits any other command.
 */
async function runServe(args: string[], io: CliIO): Promise<number> {
  const { serveIteration, DEFAULT_PORT } = await import('../serve/index');
  if (isHelp(args[0])) {
    out(io, 'Usage: iso-iterate serve [--port 4123] [--host 127.0.0.1] [--file <path>] [--theme auto|light|dark|system]');
    out(io, 'Run it inside the repo under review, then add the printed <script> tag to the dev page.');
    out(io, '--no-update-check disables the daily background npm update check.');
    return 0;
  }
  try {
    if (parseArgs(args, ['--file', '--port', '--host', '--theme'], ['--no-update-check']).length) throw new Error('serve does not take positional arguments.');
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const file = resolve(io.cwd, valueFor(args, '--file') ?? '.iteration-feedback.json');
  const port = Number(valueFor(args, '--port') ?? DEFAULT_PORT);
  const host = valueFor(args, '--host');
  const theme = valueFor(args, '--theme') ?? 'auto';
  if (theme !== 'auto' && theme !== 'light' && theme !== 'dark' && theme !== 'system') {
    errOut(io, 'Theme must be auto, light, dark or system.');
    return 1;
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    errOut(io, 'Port must be an integer between 0 and 65535.');
    return 1;
  }
  let served: Awaited<ReturnType<typeof serveIteration>>;
  try {
    served = await serveIteration({ file, port, host, theme, projectRoot: io.cwd, checkForUpdates: !has(args, '--no-update-check') });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      errOut(
        io,
        `Port ${port} is already in use, by another \`iso-iterate serve\` or a dev server. Pass --port <n> to use a different one.`,
      );
      return 1;
    }
    throw err;
  }
  out(io, `iso-iterate serving on ${served.url}`);
  out(io, `  notes  ${file}`);
  out(io, `  panel  <script src="${served.bundleUrl}" defer></script>`);
  out(io, `  setup  ${served.url}  (script tag + bookmarklet)`);
  return new Promise<number>((resolveExit) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void served.close().then(() => resolveExit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

function runNotes(argv: string[], io: CliIO): number {
  let routes: string[];
  try {
    routes = parseArgs(argv, ['--days', '--file', '--done', '--undone'], ['--all', '--json']);
    if (routes.length > 1) throw new Error('Give at most one route.');
    if (has(argv, '--done') && has(argv, '--undone')) throw new Error('Use either --done or --undone, not both.');
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const days = Number(valueFor(argv, '--days') ?? 14);
  if (!Number.isFinite(days) || days <= 0) {
    errOut(io, '--days must be a positive number.');
    return 1;
  }
  const file = resolve(io.cwd, valueFor(argv, '--file') ?? '.iteration-feedback.json');
  const all = has(argv, '--all');
  const doneIdx = argv.indexOf('--done');
  const undoneIdx = argv.indexOf('--undone');

  const route = routes[0];

  const notes = readNotes(file);
  const within = (iso: string, d: number) => Date.now() - new Date(iso).getTime() < d * 86_400_000;

  const flipIdx = doneIdx >= 0 ? doneIdx : undoneIdx;
  if (flipIdx >= 0) {
    const prefix = argv[flipIdx + 1];
    if (!prefix) {
      errOut(io, 'Give the feedback id (prefix ok): iso-iterate --done <id>');
      return 1;
    }
    let match!: StoredNote;
    try {
      updateNotes(file, (current) => {
        match = findNoteByPrefix(current, prefix);
        match.done = doneIdx >= 0;
        match.doneAt = match.done ? new Date().toISOString() : null;
        return current;
      });
    } catch (err) {
      errOut(io, (err as Error).message);
      return 1;
    }
    const setDone = doneIdx >= 0;

    if (has(argv, '--json')) {
      out(io, JSON.stringify(match, null, 2));
      return 0;
    }
    out(
      io,
      `${setDone ? 'done' : 'reopened'}: [${match.id.slice(0, 8)}] ${match.route} — ${match.feedback.slice(0, 60)}`,
    );
    return 0;
  }

  const rows = notes
    .filter((n) => (route ? n.route === route : true))
    .filter((n) => within(n.createdAt, days))
    .filter((n) => all || !n.done)
    .sort((a, b) => a.route.localeCompare(b.route) || b.createdAt.localeCompare(a.createdAt));

  if (has(argv, '--json')) {
    out(io, JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    out(
      io,
      `No ${all ? '' : 'open '}iteration notes${route ? ` for "${route}"` : ''} in the last ${days} days.`,
    );
    return 0;
  }

  let cur = '';
  for (const n of rows) {
    if (n.route !== cur) {
      cur = n.route;
      out(io, `\n## ${n.route}`);
    }
    const when = n.createdAt.slice(0, 16).replace('T', ' ');
    const at = n.viewport ? ` · ${n.viewport.w}×${n.viewport.h}` : '';
    const done = n.done ? ' ✓done' : '';
    out(io, `- [${n.id.slice(0, 8)}] (${when}${at})${done}`);
    for (const element of n.elements ?? (n.element ? [n.element] : [])) {
      const label = element.text ? `"${element.text}"` : '(no text)';
      out(io, `  ↳ <${element.tag}> ${label} — ${element.selector}`);
    }
    if (n.variant) out(io, `  ◇ ${n.variant.label}${n.variant.optionLabel ? ` → ${n.variant.optionLabel}` : ''} — selector=${n.variant.axisId}${n.variant.optionId ? ` option=${n.variant.optionId}` : ''}${n.variant.value ? ` value=${n.variant.value}` : ''}`);
    const context = n.payload === undefined ? '' : describePayload(n.payload);
    if (context) out(io, `  · ${context}`);
    if (n.feedback) out(io, `  ${n.feedback}`);
  }
  out(io, `\n${rows.length} iteration note(s).`);
  return 0;
}

/**
 * One compact line of a note's host payload — the context that gives the note
 * its meaning, like the knob settings a design note was written against. A
 * flat map of scalars reads as `key=value`; anything else falls back to
 * compact JSON. Truncated, because this is a breadcrumb, not the data.
 */
function describePayload(payload: unknown, max = 300): string {
  if (payload === null) return '';
  let text: string;
  const flat = asFlatMap(payload);
  if (flat) {
    text = flat;
  } else {
    // A host that nests its context under one key (`{ variants: {...} }`) is
    // the common shape, and dumping it as JSON buries the part worth reading.
    const entries = asEntries(payload);
    const single = entries?.length === 1 ? entries[0] : null;
    const inner = single ? asFlatMap(single[1]) : null;
    if (single && inner) {
      text = `${single[0]}: ${inner}`;
    } else {
      try {
        text = JSON.stringify(payload) ?? '';
      } catch {
        return '(unserializable payload)';
      }
    }
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function asEntries(v: unknown): [string, unknown][] | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.entries(v as Record<string, unknown>)
    : null;
}

/** `key=value key=value` when every value is a scalar, else null. */
function asFlatMap(v: unknown): string | null {
  const entries = asEntries(v);
  if (!entries?.length) return null;
  if (!entries.every(([, x]) => typeof x === 'string' || typeof x === 'number')) {
    return null;
  }
  return entries.map(([k, x]) => `${k}=${x}`).join(' ');
}
