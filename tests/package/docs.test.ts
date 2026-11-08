import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Shipped docs are read from node_modules/isotone, where only the files in
// package.json "files" exist (plus README, which npm always packs). A link to
// anything else, or to a heading that is gone, is broken for the agent there.
// Images count too: npm renders the README from the tarball.
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };

function walk(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];
}

const shipped = new Set(
  ['README.md', ...pkg.files]
    .flatMap((entry) => (existsSync(join(root, entry)) ? walk(join(root, entry)) : []))
    .map((file) => relative(root, file)),
);

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens. */
function anchors(markdown: string): Set<string> {
  const headings = markdown.replace(/```[\s\S]*?```/g, '').match(/^#{1,6} .+$/gm) ?? [];
  return new Set(
    headings.map((heading) =>
      heading
        .replace(/^#+ /, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, '')
        .replace(/ /g, '-'),
    ),
  );
}

describe('shipped docs', () => {
  const docs = [...shipped].filter((file) => file.endsWith('.md'));

  it('include the agent guide and not the maintainer-only files', () => {
    expect(docs).toContain('docs/agent-guide.md');
    for (const file of ['AGENTS.md', 'docs/development.md', 'docs/design.md', 'docs/releasing.md', 'docs/onboarding.md']) {
      expect(shipped.has(file), file).toBe(false);
    }
  });

  it.each(docs)('%s links and images point only to shipped files and existing headings', (file) => {
    const text = readFileSync(join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target = ''] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue; // absolute URLs
      const [path, hash] = target.split('#');
      const linked = path ? normalize(join(dirname(file), path)) : file;
      expect(shipped.has(linked), `${file} → ${target}`).toBe(true);
      if (hash && linked.endsWith('.md')) {
        expect(anchors(readFileSync(join(root, linked), 'utf8')).has(hash), `${file} → ${target}`).toBe(true);
      }
    }
  });
});
