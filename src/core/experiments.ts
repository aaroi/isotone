/**
 * Experiments: features that ship in the package but stay off until someone
 * turns them on. One list, shared by the panel, the servers and the CLI, so a
 * flag means the same thing wherever it is set. Browser-safe.
 */

/** Every flag there is. Adding an experiment starts here. */
export type ExperimentId = 'dictation';

export interface Experiment {
  /** The flag: `experimental: { dictation: true }`, `isotone experiment on dictation`. */
  id: ExperimentId;
  label: string;
  /** One sentence for the person deciding whether to turn it on. */
  summary: string;
  /** Anything they should know first: browser support, what leaves the machine. */
  caveat?: string;
}

/** Every experiment this version knows, in the order `isotone experiment` lists them. */
export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: 'dictation',
    label: 'Dictation',
    summary: 'A microphone button in the feedback composer: speak a note instead of typing it.',
    caveat: 'Uses the browser’s speech recognition (Chrome, Edge, Safari), which may send audio to the browser vendor’s service.',
  },
];

/** Which experiments are on. A missing id is off. */
export type ExperimentFlags = Partial<Record<ExperimentId, boolean>>;

const KNOWN = new Map<string, ExperimentId>(
  EXPERIMENTS.flatMap(({ id }) => [
    [id.toLowerCase(), id],
    // `style-editor` on a command line is `styleEditor` in code.
    [id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), id],
  ]),
);

/** The experiment a name means, in either spelling (`styleEditor`, `style-editor`), else null. */
export function experimentId(name: string): ExperimentId | null {
  return KNOWN.get(name.trim().toLowerCase()) ?? KNOWN.get(name.trim()) ?? null;
}

/**
 * Flags from anything a config file, an option or a page may hold: known ids
 * with boolean values. Unknown ids are dropped, so a flag from a newer or
 * older version never turns on something else.
 */
export function experimentFlags(value: unknown): ExperimentFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const flags: ExperimentFlags = {};
  for (const [name, on] of Object.entries(value)) {
    const id = experimentId(name);
    if (id && typeof on === 'boolean') flags[id] = on;
  }
  return flags;
}

/** The ids that are on, in list order. */
export function enabledExperiments(flags: ExperimentFlags): ExperimentId[] {
  return EXPERIMENTS.map(({ id }) => id).filter((id) => flags[id] === true);
}
