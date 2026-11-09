import { describe, expect, it } from 'vitest';

import { EXPERIMENTS, enabledExperiments, experimentFlags, experimentId } from '../../src/core/experiments';

describe('experiments', () => {
  it('each has an id usable as a flag, a label and a one-sentence summary', () => {
    const ids = EXPERIMENTS.map((experiment) => experiment.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const experiment of EXPERIMENTS) {
      expect(experiment.id).toMatch(/^[a-z][A-Za-z0-9]*$/);
      expect(experiment.label).not.toBe('');
      expect(experiment.summary).toMatch(/\.$/);
    }
  });

  it('accepts a flag in code or command-line spelling, and nothing unknown', () => {
    expect(experimentId('dictation')).toBe('dictation');
    expect(experimentId(' Dictation ')).toBe('dictation');
    for (const { id } of EXPERIMENTS) {
      expect(experimentId(id)).toBe(id);
      expect(experimentId(id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))).toBe(id);
    }
    expect(experimentId('teleport')).toBeNull();
    expect(experimentId('__proto__')).toBeNull();
  });

  it('keeps only known ids with boolean values from untrusted input', () => {
    expect(experimentFlags({ dictation: true, teleport: true, __proto__: true })).toEqual({ dictation: true });
    expect(experimentFlags({ dictation: 'yes' })).toEqual({});
    expect(experimentFlags({ dictation: false })).toEqual({ dictation: false });
    for (const junk of [null, undefined, 'dictation', ['dictation'], 1]) expect(experimentFlags(junk)).toEqual({});
    expect(enabledExperiments({ dictation: true })).toEqual(['dictation']);
    expect(enabledExperiments({ dictation: false })).toEqual([]);
  });
});
