/**
 * iso-iterate — CLI helpers shared by the notes, variant and init command
 * groups. Kept free of `store`/`variants-store` imports so any group can
 * pull this in without dragging the others' dependencies along.
 */

export interface CliWritable {
  write(chunk: string): void;
}

/** What a command group writes to and reads cwd from. A real run wires this
 *  to process.cwd()/stdout/stderr; a test hands in an in-memory sink so it
 *  can assert on output without spawning a subprocess. */
export interface CliIO {
  cwd: string;
  stdout: CliWritable;
  stderr: CliWritable;
}

export function makeIo(io: Partial<CliIO>): CliIO {
  return {
    cwd: io.cwd ?? process.cwd(),
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
  };
}

export function out(io: CliIO, line = ''): void {
  io.stdout.write(`${line}\n`);
}

export function errOut(io: CliIO, line: string): void {
  io.stderr.write(`${line}\n`);
}

export function valueFor(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function has(args: string[], name: string): boolean {
  return args.indexOf(name) >= 0;
}

/** Validate a command before it reads or writes files. Returns its positionals. */
export function parseArgs(
  args: string[],
  values: readonly string[],
  booleans: readonly string[] = [],
): string[] {
  const positionals: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (!values.includes(arg) && !booleans.includes(arg)) throw new Error(`Unknown option "${arg}".`);
    if (seen.has(arg)) throw new Error(`Option "${arg}" was given more than once.`);
    seen.add(arg);
    if (values.includes(arg) && (!args[++i] || args[i].startsWith('--'))) {
      throw new Error(`Option "${arg}" requires a value.`);
    }
  }
  return positionals;
}

/** Pulls a `--flag value` pair out of an argv slice, wherever it sits, so a
 *  subcommand's own positional parsing never has to skip over it by index. */
export function extractFlag(
  args: string[],
  flag: string,
): { value: string | undefined; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx < 0) return { value: undefined, rest: args };
  const rest = args.filter((_, i) => i !== idx && i !== idx + 1);
  return { value: args[idx + 1], rest };
}

/** Same idea as {@link extractFlag}, for a flag with no value of its own. */
export function extractBoolFlag(
  args: string[],
  flag: string,
): { present: boolean; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx < 0) return { present: false, rest: args };
  return { present: true, rest: args.filter((_, i) => i !== idx) };
}

/** `--done`/`--undone` and `variant new --note` all resolve an id the same
 *  way: a unique prefix wins, an empty or ambiguous one is a user error. */
export function findNoteByPrefix<T extends { id: string }>(notes: T[], prefix: string): T {
  const matches = notes.filter((n) => n.id.startsWith(prefix));
  if (matches.length === 0) throw new Error(`No feedback id starting with "${prefix}".`);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous prefix "${prefix}" (${matches.length} matches) — use more characters.`,
    );
  }
  return matches[0];
}

/** A plain, fixed-width table: two spaces between columns, no colour, no
 *  emoji — stable output an agent can parse as readily as a person can skim. */
export function printTable(io: CliIO, header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  out(io, line(header));
  for (const row of rows) out(io, line(row));
}
