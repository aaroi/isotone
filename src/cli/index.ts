#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCli } from './run';

export { runCli } from './run';
export type { CliIO } from './run';

// Importing iso-iterate/cli must not execute a command or terminate the host.
let isMain = false;
try {
  isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch { /* Imported by a runtime without an on-disk entry point. */ }
if (isMain) process.exitCode = await runCli(process.argv.slice(2));
