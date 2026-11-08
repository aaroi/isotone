/**
 * isotone/cli — run any `isotone` command in-process, with your own output
 * sinks. Importing it runs nothing; the `isotone` binary is ./bin.ts.
 */
export { runCli } from './run';
export type { CliIO } from './run';
