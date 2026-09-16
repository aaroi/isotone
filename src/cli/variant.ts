/**
 * iso-iterate — `variant` CLI subcommands, over the node store in
 * `variants-store.ts`. Every subcommand is synchronous: the store does no
 * I/O beyond the filesystem and `git`, so there is nothing here to await.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { overlayGroups, variantAppliesTo } from '../core/variants';
import { readNotes } from '../store';
import {
  addVariantFile,
  createVariant,
  dropVariant,
  listVariants,
  promoteVariant,
  readActive,
  readVariant,
  removeVariantFile,
  setVariantGroup,
  syncVariant,
  variantDir,
  writeActive,
  type VariantsStoreOptions,
} from '../variants-store';
import {
  type CliIO,
  errOut,
  extractBoolFlag,
  extractFlag,
  findNoteByPrefix,
  out,
  printTable,
} from './util';

export function runVariant(args: string[], io: CliIO): number {
  // `--dir` applies to the whole command group, so it is stripped before the
  // subcommand ever sees its own positional args.
  const { value: dir, rest: withoutDir } = extractFlag(args, '--dir');
  const sub = withoutDir[0];
  const rest = withoutDir.slice(1);
  const opts: VariantsStoreOptions = { root: io.cwd, ...(dir ? { dir } : {}) };

  if (sub === '--help' || sub === '-h' || sub === 'help' || sub === undefined) {
    printVariantHelp(io);
    return sub === undefined ? 1 : 0;
  }

  try {
    switch (sub) {
      case 'list':
        return cmdList(rest, io, opts);
      case 'new':
        return cmdNew(rest, io, opts);
      case 'add':
        return cmdAdd(rest, io, opts);
      case 'rm':
        return cmdRm(rest, io, opts);
      case 'use':
        return cmdUse(rest, io, opts);
      case 'off':
        return cmdOff(rest, io, opts);
      case 'group':
        return cmdGroup(rest, io, opts);
      case 'sync':
        return cmdSync(rest, io, opts);
      case 'promote':
        return cmdPromote(rest, io, opts);
      case 'drop':
        return cmdDrop(rest, io, opts);
      case 'path':
        return cmdPath(rest, io, opts);
      default:
        errOut(
          io,
          `Unknown "variant" subcommand "${sub}". Run \`iso-iterate variant --help\` for the list.`,
        );
        return 1;
    }
  } catch (err) {
    // Every store function throws a plain Error with a one-line, already
    // user-facing message (invalid id, unknown variant, escaping path); this
    // is the single place that turns it into the CLI's exit contract.
    errOut(io, (err as Error).message);
    return 1;
  }
}

function printVariantHelp(io: CliIO): void {
  out(io, 'iso-iterate variant — overlay variants under .iso-iterate/variants/<id>/');
  out(io);
  out(io, '  variant list [<route>] [--all-routes]    every variant; * marks the active ones');
  out(io, '  variant new <id> [--note <prefix>] [--route <path>] [--label <text>]');
  out(io, '                   [--group <id>] [--group-label <text>]');
  out(io, '                                           start one; --note copies route and element from a note,');
  out(io, '                                           --group makes it one alternative of a shared selector');
  out(io, '  variant add <id> <file...>               copy real files into it, then edit the copies');
  out(io, '  variant path <id> <file>                 where the copy of <file> lives');
  out(io, '  variant rm <id> <file>                   stop overriding one file');
  out(io, '  variant group <id> <groupId> [--label <text>]');
  out(io, '                                           put an existing variant into a group');
  out(io, '  variant use <id>                         activate it on every dev server on this root, in');
  out(io, '                                           place of its group siblings; other groups stay');
  out(io, '  variant use default [<groupId>]          back to the real files, for every group or one');
  out(io, '  variant off <id>                         deactivate one variant');
  out(io, '  variant sync <id>                        merge real-file changes into the copies');
  out(io, '  variant promote <id> [--force]           copy the variant over the real files and delete it');
  out(io, '  variant drop <id>                        delete a variant');
  out(io);
  out(io, 'Options: --dir <path> (default .iso-iterate/variants), --file <path> (notes file for --note)');
  out(io);
  out(io, 'Variants that override the same file are alternatives of one selector without a');
  out(io, '--group; use one when the alternatives touch different files.');
}

function cmdList(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const { present: allRoutes, rest: r1 } = extractBoolFlag(rest, '--all-routes');
  const route = r1[0];
  const variants = listVariants(opts);
  const active = readActive(opts);
  const rows =
    route && !allRoutes ? variants.filter((v) => variantAppliesTo(v.route, route)) : variants;

  if (rows.length === 0) {
    out(io, route ? `No variants for "${route}".` : 'No variants.');
    return 0;
  }

  // Grouped over every variant, not the filtered rows: a sibling on another
  // route still decides which selector this one belongs to.
  const groupOf = new Map<string, string>();
  for (const group of overlayGroups(variants)) {
    for (const member of group.members) groupOf.set(member.id, group.id);
  }
  printTable(
    io,
    ['ID', 'LABEL', 'GROUP', 'ROUTE', 'FILES', 'STALE', 'MISSING', 'ACTIVE'],
    rows.map((v) => [
      v.id,
      v.label,
      groupOf.get(v.id) ?? '-',
      v.route || '-',
      String(Object.keys(v.files).length),
      String(v.stale.length),
      String(v.missing.length),
      active.includes(v.id) ? '*' : '',
    ]),
  );
  return 0;
}

function cmdNew(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const { value: label, rest: r1 } = extractFlag(rest, '--label');
  const { value: route, rest: r2 } = extractFlag(r1, '--route');
  const { value: notePrefix, rest: r3 } = extractFlag(r2, '--note');
  const { value: description, rest: r4 } = extractFlag(r3, '--description');
  const { value: notesFile, rest: r5 } = extractFlag(r4, '--file');
  const { value: group, rest: r6 } = extractFlag(r5, '--group');
  const { value: groupLabel, rest: r7 } = extractFlag(r6, '--group-label');
  const id = r7[0];
  if (!id) {
    errOut(io, 'Give a variant id: iso-iterate variant new <id>');
    return 1;
  }

  // --note seeds route/element from an existing piece of feedback so a
  // variant answering a note does not need its context typed out again.
  // Explicit --route still wins over what the note carries.
  let seededRoute = route;
  let element: ReturnType<typeof readNotes>[number]['element'] | undefined;
  let note: string | undefined;
  if (notePrefix) {
    const file = resolve(io.cwd, notesFile ?? '.iteration-feedback.json');
    const match = findNoteByPrefix(readNotes(file), notePrefix);
    seededRoute = seededRoute ?? match.route;
    element = match.element;
    note = match.id;
  }

  const variant = createVariant(opts, {
    id,
    ...(label !== undefined ? { label } : {}),
    ...(seededRoute !== undefined ? { route: seededRoute } : {}),
    ...(element !== undefined ? { element } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(groupLabel !== undefined ? { groupLabel } : {}),
  });
  out(
    io,
    `created "${variant.id}"${variant.route ? ` for ${variant.route}` : ''}${
      variant.group ? ` in group ${variant.group}` : ''
    }`,
  );
  return 0;
}

function cmdAdd(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, ...files] = rest;
  if (!id || files.length === 0) {
    errOut(io, 'Usage: iso-iterate variant add <id> <file...>');
    return 1;
  }
  for (const file of files) addVariantFile(opts, id, file);
  out(io, `added ${files.length} file(s) to "${id}"`);
  return 0;
}

function cmdRm(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, file] = rest;
  if (!id || !file) {
    errOut(io, 'Usage: iso-iterate variant rm <id> <file>');
    return 1;
  }
  removeVariantFile(opts, id, file);
  out(io, `removed "${file}" from "${id}"`);
  return 0;
}

function cmdUse(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, groupId] = rest;
  if (!id) {
    errOut(io, 'Usage: iso-iterate variant use <id> | variant use default [<groupId>]');
    return 1;
  }
  const active = readActive(opts);
  if (id === 'default') {
    if (!groupId) {
      writeActive(opts, []);
      out(io, 'active: default');
      return 0;
    }
    const group = overlayGroups(listVariants(opts)).find((g) => g.id === groupId);
    if (!group) {
      errOut(io, `No group "${groupId}". \`variant list\` shows the GROUP column.`);
      return 1;
    }
    const members = new Set(group.members.map((m) => m.id));
    writeActive(opts, active.filter((a) => !members.has(a)));
    out(io, `active: default for ${groupId}${describeActive(readActive(opts))}`);
    return 0;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  // Only the siblings leave: the reviewer's other picks stay as they were,
  // the same as choosing an option in one selector of the panel.
  const siblings = new Set(
    overlayGroups(listVariants(opts))
      .find((g) => g.members.some((m) => m.id === id))
      ?.members.map((m) => m.id) ?? [id],
  );
  const next = [...active.filter((a) => !siblings.has(a)), id];
  writeActive(opts, next);
  out(io, `active: "${id}"${describeActive(readActive(opts), id)}`);
  return 0;
}

function cmdOff(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = rest[0];
  if (!id) {
    errOut(io, 'Usage: iso-iterate variant off <id>');
    return 1;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  const active = readActive(opts);
  writeActive(opts, active.filter((a) => a !== id));
  out(io, `off: "${id}"${describeActive(readActive(opts))}`);
  return 0;
}

/** The rest of the active set, so a `use` on one group says what else is
 *  showing; empty when nothing else is. */
function describeActive(active: string[], except?: string): string {
  const others = active.filter((a) => a !== except);
  return others.length ? ` (also active: ${others.map((a) => `"${a}"`).join(', ')})` : '';
}

function cmdGroup(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const { value: label, rest: r1 } = extractFlag(rest, '--label');
  const [id, groupId] = r1;
  if (!id || !groupId) {
    errOut(io, 'Usage: iso-iterate variant group <id> <groupId> [--label <text>]');
    return 1;
  }
  setVariantGroup(opts, id, groupId, label);
  out(io, `"${id}" is now in group ${groupId}${label !== undefined ? ` ("${label}")` : ''}`);
  return 0;
}

function cmdSync(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = rest[0];
  if (!id) {
    errOut(io, 'Usage: iso-iterate variant sync <id>');
    return 1;
  }
  const { merged, conflicts, unchanged } = syncVariant(opts, id);
  out(io, `merged: ${merged.length ? merged.join(', ') : 'none'}`);
  out(io, `conflicts: ${conflicts.length ? conflicts.join(', ') : 'none'}`);
  out(io, `unchanged: ${unchanged.length ? unchanged.join(', ') : 'none'}`);
  return 0;
}

function cmdPromote(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  // Pulled out first so `promote --force <id>` and `promote <id> --force`
  // both leave the id as the one positional.
  const { present: force, rest: r1 } = extractBoolFlag(rest, '--force');
  const id = r1[0];
  if (!id) {
    errOut(io, 'Usage: iso-iterate variant promote <id> [--force]');
    return 1;
  }
  const { files } = promoteVariant(opts, id, { force });
  out(io, `promoted "${id}": ${files.length ? files.join(', ') : 'no files'}`);
  return 0;
}

function cmdDrop(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = rest[0];
  if (!id) {
    errOut(io, 'Usage: iso-iterate variant drop <id>');
    return 1;
  }
  if (!existsSync(variantDir(opts, id))) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  dropVariant(opts, id);
  out(io, `dropped "${id}"`);
  return 0;
}

function cmdPath(rest: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, file] = rest;
  if (!id || !file) {
    errOut(io, 'Usage: iso-iterate variant path <id> <file>');
    return 1;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  out(io, join(variantDir(opts, id), repoRelative(io.cwd, file)));
  return 0;
}

/** Same escape guard as the store's own (private) `repoRelativeKey`, just
 *  for turning a CLI-supplied file argument into the manifest's POSIX key —
 *  `path` never touches the store's own state, so it does not warrant an
 *  export from there. */
function repoRelative(root: string, file: string): string {
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`"${file}" escapes the project root`);
  }
  return rel.split(sep).join('/');
}
