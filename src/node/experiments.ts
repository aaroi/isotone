/**
 * The project's experiment flags: `.isotone/experiments.json`, a small object
 * of `{ "<id>": true | false }`. The dev server reads it for every page, so
 * `isotone experiment on <id>` takes effect on the next reload, with no
 * restart and no change to the app's config.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExperimentFlags, type ExperimentId, experimentFlags } from '../core/experiments';
import { writeJson } from './fs/atomic';

/** Relative to the app's directory, beside the notes file and the knobs. */
export const EXPERIMENTS_FILE = '.isotone/experiments.json';

export const experimentsFile = (root: string): string => join(root, EXPERIMENTS_FILE);

/** The flags the project's file sets; none when it is missing, and an error when it is not JSON. */
export function readExperiments(root: string): ExperimentFlags {
  const file = experimentsFile(root);
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, 'utf8').trim();
    return raw ? experimentFlags(JSON.parse(raw)) : {};
  } catch (cause) {
    throw new Error(`Could not read ${file}: it should hold one JSON object such as { "styleEditor": true }. Fix the file or delete it.`, {
      cause,
    });
  }
}

/** Turn one experiment on or off in the project's file, keeping the others. */
export function setExperiment(root: string, id: ExperimentId, on: boolean): ExperimentFlags {
  const flags = { ...readExperiments(root), [id]: on };
  writeJson(experimentsFile(root), flags);
  return flags;
}

/**
 * What a page gets: the host's own option, then the project's file over it,
 * so a flag set from the command line wins either way. A broken file leaves
 * the option standing rather than taking the panel down with it.
 */
export function resolveExperiments(root: string, option: unknown, warn?: (message: string) => void): ExperimentFlags {
  let file: ExperimentFlags = {};
  try {
    file = readExperiments(root);
  } catch (error) {
    warn?.((error as Error).message);
  }
  return { ...experimentFlags(option), ...file };
}
