import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXPERIMENTS_FILE, readExperiments, resolveExperiments, setExperiment } from '../../src/node/experiments';
import { serveMountOptions } from '../../src/serve/mount-config';
import { mountModuleSource } from '../../src/vite/html-inject';

const dirs: string[] = [];
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'isotone-experiments-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the project’s experiment flags', () => {
  it('has none without a file, and keeps the others when one is set', () => {
    const root = project();
    expect(readExperiments(root)).toEqual({});
    expect(setExperiment(root, 'dictation', true)).toEqual({ dictation: true });
    expect(JSON.parse(readFileSync(join(root, EXPERIMENTS_FILE), 'utf8'))).toEqual({ dictation: true });
    expect(setExperiment(root, 'dictation', false)).toEqual({ dictation: false });
    expect(readExperiments(root)).toEqual({ dictation: false });
  });

  it('drops flags this version does not know, on read and on the next write', () => {
    const root = project();
    mkdirSync(join(root, '.isotone'));
    writeFileSync(join(root, EXPERIMENTS_FILE), JSON.stringify({ teleport: true, dictation: true }));
    expect(readExperiments(root)).toEqual({ dictation: true });
  });

  it('lets the file win over the host option, either way', () => {
    const root = project();
    expect(resolveExperiments(root, { dictation: true })).toEqual({ dictation: true });
    setExperiment(root, 'dictation', false);
    expect(resolveExperiments(root, { dictation: true })).toEqual({ dictation: false });
    setExperiment(root, 'dictation', true);
    expect(resolveExperiments(root, undefined)).toEqual({ dictation: true });
  });

  it('keeps the host option and says why when the file is broken', () => {
    const root = project();
    mkdirSync(join(root, '.isotone'));
    writeFileSync(join(root, EXPERIMENTS_FILE), '{ dictation: ');
    expect(() => readExperiments(root)).toThrow(/should hold one JSON object/);
    const warn = vi.fn();
    expect(resolveExperiments(root, { dictation: true }, warn)).toEqual({ dictation: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(EXPERIMENTS_FILE.replace('/', join('a', 'b').slice(1, 2))));
  });

  it('reaches the panel through `isotone serve`, read with every bundle', () => {
    const root = project();
    expect(serveMountOptions('http://localhost:4123', root, {})).not.toHaveProperty('experimental');
    setExperiment(root, 'dictation', true);
    expect(serveMountOptions('http://localhost:4123', root, {}).experimental).toEqual({ dictation: true });
    expect(serveMountOptions('http://localhost:4123', project(), { experimental: { dictation: true } }).experimental).toEqual({
      dictation: true,
    });
  });

  it('reaches the panel through the Vite plugin’s mount module, and is absent when nothing is on', () => {
    expect(mountModuleSource({}, '', true)).not.toContain('experimental');
    expect(mountModuleSource({}, '', true, undefined, undefined, { dictation: true })).toContain('"experimental":{"dictation":true}');
  });
});
