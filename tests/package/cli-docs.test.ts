import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runCli } from '../../src/cli/run';
import { captureIo } from '../helpers/cli';

// What `--help` shows and what the shipped docs tell an agent to run must
// agree: a flag missing from the docs is undiscoverable, and a command in the
// docs that the CLI does not know is a dead end.
const doc = (name: string) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), 'utf8');
const guide = doc('agent-guide.md');

/** Each help screen, and the shipped docs that must document it. */
const SCREENS: [argv: string[], docs: string[]][] = [
  [['--help'], [guide, doc('integrations.md'), doc('updates.md'), doc('experiments.md')]],
  [
    ['variant', '--help'],
    [guide, doc('variants.md')],
  ],
  [['blast', '--help'], [doc('blast.md')]],
  [
    ['serve', '--help'],
    [doc('integrations.md'), doc('updates.md'), doc('experiments.md')],
  ],
  [['experiment', '--help'], [doc('experiments.md')]],
  [
    ['init', '--help'],
    [guide, doc('integrations.md')],
  ],
  [['check-update', '--help'], [doc('updates.md')]],
];

async function help(argv: string[]): Promise<string> {
  const io = captureIo(process.cwd());
  expect(await runCli(argv, io)).toBe(0);
  return io.text.out;
}

const flags = (text: string) => new Set(text.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? []);

/** `variant list`, `blast start`, and each of `blast status | stop | extend`, as help writes them. */
const subcommands = (text: string, group: string) =>
  new Set(
    [...text.matchAll(new RegExp(`(?:^ *|isotone )${group} ([a-z]+(?: \\| [a-z]+)*)`, 'gm'))].flatMap((m) =>
      (m[1] ?? '').split(' | ').map((sub) => `${group} ${sub}`),
    ),
  );

/** Every command in a doc's code that starts with `isotone` or `npx isotone`, inline or in blocks. */
function commandLines(markdown: string): string[] {
  const code = [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].flatMap((m) => (m[1] ?? '').split('\n'));
  const inline = [...markdown.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
  return [...code, ...inline].flatMap((line) => {
    const command = /^\s*(?:npx )?isotone (.*)$/.exec(line);
    return command ? [`isotone ${command[1]}`] : [];
  });
}

describe('CLI help and shipped docs', () => {
  it.each(SCREENS)('every flag and subcommand in `isotone %s` is documented', async (...args) => {
    const [argv, docs] = args as unknown as [string[], string[]];
    const text = await help(argv);
    const documented = docs.join('\n');
    const shown = [...flags(text)].filter((flag) => flag !== '--help');
    if (argv[0] === 'variant' || argv[0] === 'blast') shown.push(...subcommands(text, argv[0]));
    expect(shown.filter((item) => !documented.includes(item))).toEqual([]);
  });

  it('every isotone command the shipped docs give exists in --help', async () => {
    const helpText = (await Promise.all(SCREENS.map(([argv]) => help(argv)))).join('\n');
    const known = flags(helpText);
    const knownSubs = new Set([...subcommands(helpText, 'variant'), ...subcommands(helpText, 'blast')]);
    const unknown: string[] = [];
    expect(commandLines(guide).length).toBeGreaterThan(10);
    for (const name of ['agent-guide.md', 'variants.md', 'blast.md', 'integrations.md', 'updates.md', 'experiments.md']) {
      for (const line of commandLines(doc(name))) {
        for (const flag of flags(line)) if (!known.has(flag)) unknown.push(`${name}: ${flag} in ${line}`);
        const sub = /^isotone (variant|blast) ([a-z]+)/.exec(line);
        if (sub && !knownSubs.has(`${sub[1]} ${sub[2]}`)) unknown.push(`${name}: ${line}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
