#!/usr/bin/env node
/** The `isotone` command. The library, isotone/cli, is ./index.ts. */
import { runCli } from './run';

// A reader that stops early (`| head`) closes the pipe: that is the end of
// the output, not a crash.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
process.exitCode = await runCli(process.argv.slice(2));
