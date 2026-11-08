import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { noteRecord } from '../../src/cli/notes';
import { runCli } from '../../src/cli/run';
import { type StoredNote, writeNotes } from '../../src/node/notes/store';
import { captureIo } from '../helpers/cli';
import { tempGitRepo } from '../helpers/fs';

// The shipped schema is the contract for `--json`. Records built from every
// field the store can hold must match it, and must use every property it
// names, so neither can change without the other.
const schema = JSON.parse(readFileSync(new URL('../../docs/note.schema.json', import.meta.url), 'utf8'));

type Schema = Record<string, unknown>;

/** The subset of JSON Schema the note schema uses; returns every violation found. */
function validate(value: unknown, node: Schema, path = '$'): string[] {
  if (typeof node.$ref === 'string') {
    const name = node.$ref.replace('#/$defs/', '');
    return validate(value, (schema.$defs as Record<string, Schema>)[name] ?? {}, path);
  }
  if ('const' in node && value !== node.const) return [`${path}: expected ${JSON.stringify(node.const)}`];
  if (Array.isArray(node.enum) && !node.enum.includes(value)) return [`${path}: not one of ${node.enum.join(', ')}`];
  const type = node.type as string | undefined;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (type && actual !== type) return [`${path}: expected ${type}, got ${actual}`];
  const errors: string[] = [];
  if (typeof value === 'string' && typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value))
    errors.push(`${path}: does not match ${node.pattern}`);
  if (Array.isArray(value) && node.items) {
    value.forEach((item, i) => {
      errors.push(...validate(item, node.items as Schema, `${path}[${i}]`));
    });
  }
  if (actual === 'object') {
    const object = value as Record<string, unknown>;
    const properties = (node.properties ?? {}) as Record<string, Schema>;
    for (const key of (node.required as string[] | undefined) ?? []) if (!(key in object)) errors.push(`${path}: missing ${key}`);
    for (const [key, child] of Object.entries(object)) {
      if (properties[key]) errors.push(...validate(child, properties[key], `${path}.${key}`));
      else if (node.additionalProperties === false) errors.push(`${path}: unexpected ${key}`);
      else if (node.additionalProperties && typeof node.additionalProperties === 'object')
        errors.push(...validate(child, node.additionalProperties as Schema, `${path}.${key}`));
    }
  }
  return errors;
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

const element = {
  tag: 'button',
  text: 'Sign up',
  selector: '#app > button',
  attributes: { class: 'cta' },
  component: ['App', 'Hero'],
  source: 'src/App.jsx:12',
  within: ['Hero'],
  near: 'Welcome',
  rect: { x: 1, y: 2, w: 3, h: 4 },
};

function notes(root: string): StoredNote[] {
  return [
    {
      id: 'full-open',
      route: '/',
      feedback: 'Make it bigger',
      element,
      elements: [element],
      done: false,
      doneAt: null,
      workingAt: '2026-01-08T10:00:00.000Z',
      createdAt: '2026-01-08T09:00:00.000Z',
      viewport: { w: 1280, h: 800 },
      payload: { knobs: { radius: 12 } },
      variant: { axisId: 'hero', label: 'Hero', optionId: 'left', optionLabel: 'Left', value: '12' },
      variantAction: { axisId: 'hero', action: 'keep-option', optionId: 'left' },
      // Answered: the note changed since this fingerprint.
      reply: { text: 'Which one?', at: '2026-01-08T09:30:00.000Z', about: 'stale-fingerprint' },
      update: { from: '1.2.0', to: '1.3.0', command: 'npm install -D --save-exact isotone@1.3.0', cwd: root, manager: 'npm' },
    },
    {
      id: 'closed',
      route: '/pricing',
      feedback: 'Done already',
      element: null,
      done: true,
      doneAt: '2026-01-08T11:00:00.000Z',
      createdAt: '2026-01-08T08:00:00.000Z',
    },
  ];
}

describe('the note record JSON Schema', () => {
  it('matches every record the CLI builds, and names no field it never prints', () => {
    const root = tempGitRepo('isotone-schema-', dirs);
    const records = notes(root).map((n) => noteRecord(n, root));
    for (const record of records) expect(validate(record, schema)).toEqual([]);
    const printed = new Set(records.flatMap((r) => Object.keys(r)));
    expect([...printed].sort()).toEqual(Object.keys(schema.properties).sort());
    const pinned = (records[0]?.elements as Record<string, unknown>[] | undefined)?.[0] ?? {};
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(schema.$defs.element.properties).sort());
  });

  it('matches what --json, --working, --reply and --done print', async () => {
    const root = tempGitRepo('isotone-schema-', dirs);
    writeNotes(join(root, '.isotone/notes.json'), notes(root));
    const outputs: unknown[] = [];
    for (const argv of [
      ['--json', '--all'],
      ['--working', 'full', '--json'],
      ['--reply', 'full', 'Left or right?', '--json'],
    ]) {
      const io = captureIo(root);
      expect(await runCli(argv, io), io.text.err).toBe(0);
      outputs.push(...JSON.parse(io.text.out));
    }
    writeFileSync(join(root, 'fix.txt'), 'fixed');
    const later = new Date(Date.now() + 1000);
    utimesSync(join(root, 'fix.txt'), later, later);
    const done = captureIo(root);
    expect(await runCli(['--done', 'full', '--json'], done), done.text.err).toBe(0);
    outputs.push(...JSON.parse(done.text.out));
    expect(outputs.length).toBe(5);
    for (const record of outputs) expect(validate(record, schema)).toEqual([]);
  });

  it('rejects what it should', () => {
    expect(validate({ id: '-x', route: '/', feedback: '', done: false, createdAt: 'x', extra: 1 }, schema)).toEqual([
      '$.id: does not match ^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$',
      '$: unexpected extra',
    ]);
  });
});
