/**
 * `isotone experiment`: list the experiments this version ships, and turn one
 * on or off for the project.
 */
import { enabledExperiments, EXPERIMENTS, experimentId } from '../core/experiments';
import { relative } from 'node:path';

import { EXPERIMENTS_FILE, experimentsFile, readExperiments, setExperiment } from '../node/experiments';
import { docPath } from './docs';
import { findNotesFile } from './notes';
import { toJson } from './text';
import { type CliIO, errOut, has, out, parseArgs } from './util';

const HELP = 'npx isotone experiment --help';

function printHelp(io: CliIO): void {
  out(io, 'Usage: isotone experiment [--json]            list experiments and whether each is on');
  out(io, '       isotone experiment on <id>             turn one on for this project');
  out(io, '       isotone experiment off <id>            turn it off');
  out(io, `Flags are kept in ${EXPERIMENTS_FILE}; reload the page to apply a change. An experiment may change`);
  out(io, 'or go away in any release. Turn one on only when the user asks for it.');
  out(io, `More: ${docPath(io.cwd, 'docs/experiments.md')}`);
}

export async function runExperiment(args: string[], io: CliIO): Promise<number> {
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printHelp(io);
    return 0;
  }
  let positionals: string[];
  try {
    positionals = parseArgs(args, [], ['--json'], HELP);
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const json = has(args, '--json');
  // The app's directory: where its notes file is, as for every other command.
  const { dir } = findNotesFile(io, undefined);
  const [action, name, ...extra] = positionals;
  try {
    if (action === undefined) {
      const flags = readExperiments(dir);
      if (json) {
        // `set` tells a flag the file turns off from one it does not mention, which a host's own option may still turn on.
        out(
          io,
          toJson(EXPERIMENTS.map((experiment) => ({ ...experiment, on: flags[experiment.id] === true, set: experiment.id in flags }))),
        );
        return 0;
      }
      for (const experiment of EXPERIMENTS) {
        const state = flags[experiment.id] === true ? 'on ' : experiment.id in flags ? 'off' : '-  ';
        out(io, `${state}  ${experiment.id} — ${experiment.summary}`);
        if (experiment.caveat) out(io, `     ${experiment.caveat}`);
      }
      out(io);
      out(io, `Turn one on with: npx isotone experiment on <id>   (kept in ${EXPERIMENTS_FILE}; reload the page)`);
      out(io, `This is what ${EXPERIMENTS_FILE} says: on, off, or - when it does not say. Where the file does not say,`);
      out(io, 'the app’s own Isotone setup may still turn one on (experimental: { <id>: true }); on and off here win over it.');
      return 0;
    }
    if (action !== 'on' && action !== 'off') throw new Error(`Unknown experiment command "${action}". Run \`${HELP}\`.`);
    if (!name || extra.length) throw new Error(`Give one experiment: isotone experiment ${action} <id>`);
    const id = experimentId(name);
    if (!id)
      throw new Error(
        `No experiment called "${name}" in this version. There ${EXPERIMENTS.length === 1 ? 'is' : 'are'}: ${EXPERIMENTS.map((e) => e.id).join(', ')}.`,
      );
    const flags = setExperiment(dir, id, action === 'on');
    // Named in full: run from the wrong directory, this is the only sign the dev server reads another file.
    const file = experimentsFile(dir);
    if (json) {
      out(io, toJson({ id, on: action === 'on', enabled: enabledExperiments(flags), file }));
      return 0;
    }
    const experiment = EXPERIMENTS.find((e) => e.id === id);
    out(io, `${id}: ${action}. Reload the page to ${action === 'on' ? 'see it' : 'remove it'}.`);
    out(io, `Saved in ${relative(io.cwd, file) || file}, which the dev server reads from the app’s directory.`);
    if (action === 'on' && experiment?.caveat) out(io, experiment.caveat);
    return 0;
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
}
