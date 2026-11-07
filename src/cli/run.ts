/**
 * isotone — CLI command dispatch, factored out of the executable entry point
 * (`./index.ts`) so tests can call `runCli` directly against an in-memory
 * sink, and so `dist/cli.js` and `import('isotone/cli')` share one function.
 * Run `npx isotone --help` for the command surface.
 */
import { resolve } from 'node:path';

import { BLAST } from '../core/blast';
import { runBlast } from './blast';
import { runInit } from './init';
import { NOTES_FILE, runNotes } from './notes';
import { runCheckUpdate } from './update';
import { type CliIO, errOut, has, makeIo, out, parseArgs, valueFor } from './util';
import { runVariant } from './variant';

export type { CliIO } from './util';

export async function runCli(argv: string[], ioInput: Partial<CliIO> = {}): Promise<number> {
  const io = makeIo(ioInput);
  try {
    if (argv[0] === 'check-update') return await runCheckUpdate(argv.slice(1), io);
    if (argv[0] === 'serve') return await runServe(argv.slice(1), io);
    if (argv[0] === BLAST.command) return await runBlast(argv.slice(1), io);
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

function isHelp(arg: string | undefined): boolean {
  return arg === '--help' || arg === '-h' || arg === 'help';
}

function printHelp(io: CliIO): void {
  out(io, 'isotone — notes and variants between a reviewer’s browser and a coding agent');
  out(io, 'Agent guide: node_modules/isotone/docs/agent-guide.md');
  out(io);
  out(io, `Notes (in ${NOTES_FILE} in the current directory)`);
  out(io, '  isotone [<route>]              open notes, of every route or one: /items is that page,');
  out(io, '                                 /items/* also every page under it');
  out(io, '  isotone --working <id...>      tell the panel you started on notes');
  out(io, '  isotone --done <id...>         close notes once fixed and verified');
  out(io, '  isotone --undone <id...>       reopen notes');
  out(io, '  isotone --reply <id> "<text>"  ask the reviewer about a note; it stays open');
  out(io, '  --days <n>                     also list notes closed in the last n days');
  out(io, '  --all                          also list every closed note');
  out(io, '  --json                         note records as JSON, one array');
  out(io, '  --file <path>                  another notes file');
  out(io, '  An id prefix is enough; give several ids as "a b" or "a,b".');
  out(io);
  out(io, `${BLAST.name}: keep acting on notes for a set time (${BLAST.doc})`);
  out(io, `  isotone ${BLAST.command} start [30m] [<route>]   start a session and print how to run it`);
  out(io, `  isotone ${BLAST.command}                         wait for new notes, print each batch, exit`);
  out(io, `  isotone ${BLAST.command} --help`);
  out(io);
  out(io, 'Variants');
  out(io, '  isotone variant --help');
  out(io);
  out(io, 'Endpoint and panel for a host without the Vite plugin');
  out(io, '  isotone serve --help');
  out(io);
  out(io, 'Setup and updates');
  out(io, '  isotone init [--approach overlay|host|serve] [--yes] [--json]');
  out(io, '  isotone check-update [--json] [--manager npm|pnpm|yarn]');
}

/**
 * `serve` runs until signalled, so unlike every other command its exit code
 * arrives asynchronously, once the server has actually closed — the caller
 * (index.ts) awaits this the same way it awaits any other command.
 */
async function runServe(args: string[], io: CliIO): Promise<number> {
  const { serveIteration, DEFAULT_PORT } = await import('../serve/index');
  if (isHelp(args[0])) {
    out(io, 'Usage: isotone serve [--port 4123] [--host 127.0.0.1] [--file <path>] [--theme auto|light|dark|system]');
    out(io, '                     [--no-update-check | --update-note]');
    out(io, 'Run it inside the repo under review, then add the printed <script> tag to the dev page.');
    out(io, '--no-update-check disables the daily background npm update check.');
    out(io, '--update-note files an update note for your agent the first time a new version appears.');
    return 0;
  }
  try {
    if (parseArgs(args, ['--file', '--port', '--host', '--theme'], ['--no-update-check', '--update-note']).length)
      throw new Error('serve does not take positional arguments.');
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const file = resolve(io.cwd, valueFor(args, '--file') ?? NOTES_FILE);
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
    served = await serveIteration({
      file,
      port,
      host,
      theme,
      projectRoot: io.cwd,
      checkForUpdates: has(args, '--no-update-check') ? false : has(args, '--update-note') ? 'note' : true,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      errOut(io, `Port ${port} is already in use, by another \`isotone serve\` or a dev server. Pass --port <n> to use a different one.`);
      return 1;
    }
    throw err;
  }
  out(io, `isotone serving on ${served.url}`);
  out(io, `  notes  ${file}`);
  out(io, `  knobs  ${served.url}/api/iteration/variants  (from .isotone/knobs.json)`);
  out(io, `  panel  ${served.bundleUrl}  (load it on development pages only)`);
  out(io, `  setup  ${served.url}  (a localhost-only script tag + bookmarklet)`);
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
