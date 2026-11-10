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
    expect(experimentId('style-editor')).toBe('styleEditor');
    expect(experimentId(' StyleEditor ')).toBe('styleEditor');
    for (const { id } of EXPERIMENTS) {
      expect(experimentId(id)).toBe(id);
      expect(experimentId(id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))).toBe(id);
    }
    expect(experimentId('teleport')).toBeNull();
    expect(experimentId('__proto__')).toBeNull();
  });

  it('keeps only known ids with boolean values from untrusted input', () => {
    expect(experimentFlags({ styleEditor: true, teleport: true, __proto__: true })).toEqual({ styleEditor: true });
    expect(experimentFlags({ 'style-editor': true })).toEqual({ styleEditor: true });
    expect(experimentFlags({ styleEditor: 'yes' })).toEqual({});
    expect(experimentFlags({ styleEditor: false })).toEqual({ styleEditor: false });
    for (const junk of [null, undefined, 'styleEditor', ['styleEditor'], 1]) expect(experimentFlags(junk)).toEqual({});
    expect(enabledExperiments({ styleEditor: true })).toEqual(['styleEditor']);
    expect(enabledExperiments({ styleEditor: false })).toEqual([]);
  });
});
