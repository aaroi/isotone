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

import { readNotes, writeNotes, type StoredNote } from '../store';
import { runInit } from './init';
import { type CliIO, errOut, findNoteByPrefix, has, makeIo, out, valueFor } from './util';
import { runVariant } from './variant';

export type { CliIO } from './util';

export async function runCli(argv: string[], ioInput: Partial<CliIO> = {}): Promise<number> {
  const io = makeIo(ioInput);
  if (argv[0] === 'serve') return runServe(argv.slice(1), io);
  if (argv[0] === 'variant') return runVariant(argv.slice(1), io);
  if (argv[0] === 'init') return runInit(argv.slice(1), io);
  if (isHelp(argv[0])) {
    printHelp(io);
    return 0;
  }
  return runNotes(argv, io);
}

export function isHelp(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h' || arg === 'help';
}

const NOTES_FLAGS = ['--days', '--file', '--done', '--undone', '--all'];

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
  out(io);
  out(io, 'Endpoint and panel for a host without the Vite plugin');
  out(io, '  iso-iterate serve [--port 4123] [--host 127.0.0.1] [--file <path>]');
  out(io);
  out(io, 'Overlay variants');
  out(io, '  iso-iterate variant --help');
  out(io);
  out(io, 'Setting a repo up');
  out(io, '  iso-iterate init [--approach overlay|host|serve] [--yes]');
}

/**
 * `serve` runs until signalled, so unlike every other command its exit code
 * arrives asynchronously, once the server has actually closed — the caller
 * (index.ts) awaits this the same way it awaits any other command.
 */
async function runServe(args: string[], io: CliIO): Promise<number> {
  const { serveIteration, DEFAULT_PORT } = await import('../serve/index');
  if (isHelp(args[0])) {
    out(io, 'Usage: iso-iterate serve [--port 4123] [--host 127.0.0.1] [--file <path>]');
    out(io, 'Run it inside the repo under review, then add the printed <script> tag to the dev page.');
    return 0;
  }
  const file = resolve(io.cwd, valueFor(args, '--file') ?? '.iteration-feedback.json');
  const port = Number(valueFor(args, '--port') ?? DEFAULT_PORT);
  const host = valueFor(args, '--host');
  let served: Awaited<ReturnType<typeof serveIteration>>;
  try {
    served = await serveIteration({ file, port, host });
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
      void served.close().then(() => resolveExit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

function runNotes(argv: string[], io: CliIO): number {
  const unknown = argv.find((a) => a.startsWith('-') && !NOTES_FLAGS.includes(a));
  if (unknown) {
    errOut(io, `Unknown option "${unknown}". Run \`iso-iterate --help\` for the commands.`);
    return 1;
  }
  const days = Number(valueFor(argv, '--days') ?? 14);
  const file = resolve(io.cwd, valueFor(argv, '--file') ?? '.iteration-feedback.json');
  const all = has(argv, '--all');
  const doneIdx = argv.indexOf('--done');
  const undoneIdx = argv.indexOf('--undone');

  // Indices that belong to a flag or its value, so the leftover positional
  // is the route. Each `--x value` occupies two slots.
  const consumed = new Set<number>();
  for (const flag of NOTES_FLAGS) {
    const idx = argv.indexOf(flag);
    if (idx >= 0) {
      consumed.add(idx);
      if (idx + 1 < argv.length) consumed.add(idx + 1);
    }
  }
  const route = argv.find((a, i) => !a.startsWith('--') && !consumed.has(i));

  const notes = readNotes(file);
  const within = (iso: string, d: number) => Date.now() - new Date(iso).getTime() < d * 86_400_000;

  const flipIdx = doneIdx >= 0 ? doneIdx : undoneIdx;
  if (flipIdx >= 0) {
    const prefix = argv[flipIdx + 1];
    if (!prefix) {
      errOut(io, 'Give the feedback id (prefix ok): iso-iterate --done <id>');
      return 1;
    }
    let match: StoredNote;
    try {
      match = findNoteByPrefix(notes, prefix);
    } catch (err) {
      errOut(io, (err as Error).message);
      return 1;
    }
    const setDone = doneIdx >= 0;
    match.done = setDone;
    match.doneAt = setDone ? new Date().toISOString() : null;
    writeNotes(file, notes);
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
    if (n.element) {
      const label = n.element.text ? `"${n.element.text}"` : '(no text)';
      out(io, `  ↳ <${n.element.tag}> ${label} — ${n.element.selector}`);
    }
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
