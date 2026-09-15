#!/usr/bin/env node
/**
 * iso-iterate — CLI entry point. All the command handling lives in `./run`
 * (`runCli`), which takes plain argv/cwd/stdout/stderr so it is testable
 * without a subprocess; this file only wires that up to the real process.
 */
import { runCli } from './run';

try {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
