/**
 * isotone — `variant` CLI subcommands, over the node store in
 * `src/node/variants`. Every subcommand is synchronous: the store does no
 * I/O beyond the filesystem and `git`, so there is nothing here to await.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { knobsFor, overlayGroups, splitSectionLabel, variantAppliesTo } from '../core/variants';
import { isRouteModule, scanExports } from '../node/variants/exports';
import { readNotes } from '../node/notes/store';
import {
  activeConflict,
  addVariantFile,
  createVariant,
  crossGroupOverlaps,
  dropVariant,
  KNOBS_FILE,
  listVariants,
  promoteVariant,
  readActive,
  knobProblem,
  readKnobs,
  readVariant,
  removeVariantFile,
  setVariantGroup,
  setVariantSection,
  syncVariant,
  variantDir,
  writeActive,
  type VariantsStoreOptions,
} from '../node/variants';
import { mutateVariants } from '../node/variants/options';
import { repoRelativeKey } from '../node/variants/paths';
import { type CliIO, errOut, extractFlag, findNoteByPrefix, has, out, parseArgs, printTable, valueFor } from './util';

/** Each subcommand's value flags, boolean flags and most positionals; anything else is refused. */
const SPEC: Record<string, [values: string[], booleans: string[], positionals: number]> = {
  list: [[], ['--all-routes'], 1],
  new: [['--label', '--route', '--note', '--description', '--file', '--group', '--group-label', '--section'], [], 1],
  add: [[], ['--new'], Number.POSITIVE_INFINITY],
  rm: [[], [], 2],
  use: [[], [], 2],
  off: [[], [], 1],
  group: [['--label'], [], 2],
  section: [[], ['--none'], Number.POSITIVE_INFINITY],
  sync: [[], [], 1],
  promote: [[], ['--force'], 1],
  drop: [[], [], 1],
  path: [[], [], 2],
};

type Command = (pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions) => number;

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

  const commands: Record<string, Command> = {
    list: cmdList,
    new: cmdNew,
    add: cmdAdd,
    rm: cmdRm,
    use: cmdUse,
    off: cmdOff,
    group: cmdGroup,
    section: cmdSection,
    sync: cmdSync,
    promote: cmdPromote,
    drop: cmdDrop,
    path: cmdPath,
  };
  const spec = Object.hasOwn(SPEC, sub) ? SPEC[sub] : undefined;
  if (!spec) {
    errOut(io, `Unknown "variant" subcommand "${sub}". Run \`isotone variant --help\` for the list.`);
    return 1;
  }
  try {
    // Validate every flag before anything is read or written: a typo such as
    // `drop x --dry-run` must fail, not delete.
    const positionals = parseArgs(rest, spec[0], spec[1]);
    if (positionals.length > spec[2]) throw new Error(`Unexpected "${positionals[spec[2]]}". Run \`isotone variant --help\`.`);
    return commands[sub](positionals, rest, io, opts);
  } catch (err) {
    // Every store function throws a plain Error with a one-line, already
    // user-facing message (invalid id, unknown variant, escaping path); this
    // is the single place that turns it into the CLI's exit contract.
    errOut(io, (err as Error).message);
    return 1;
  }
}

function printVariantHelp(io: CliIO): void {
  out(io, 'isotone variant — overlay variants under .isotone/variants/<id>/');
  out(io);
  out(io, '  variant list [<route>] [--all-routes]    every variant; * marks the active ones');
  out(io, '  variant new <id> [--note <prefix>] [--route <path>] [--label <text>]');
  out(io, '                   [--description <text>] [--group <id>] [--group-label <text>]');
  out(io, '                   [--section <text>]');
  out(io, '                                           start one; --note copies route and element from a note,');
  out(io, '                                           --group makes it one alternative of a shared selector,');
  out(io, '                                           --section names the part of the page it sits under');
  out(io, '  variant add <id> [--new] <file...>       copy real files into it, then edit the copies;');
  out(io, '                                           --new starts a file the project does not have');
  out(io, '  variant path <id> <file>                 where the copy of <file> lives');
  out(io, '  variant rm <id> <file>                   stop overriding one file');
  out(io, '  variant group <id> <groupId> [--label <text>]');
  out(io, '                                           put an existing variant into a group');
  out(io, '  variant section <id> [<text> | --none]   put its selector (every variant in its group) in a');
  out(io, '                                           panel section; no text goes back to the label prefix');
  out(io, '  variant use <id>                         activate it on every dev server on this root, in');
  out(io, '                                           place of its group siblings; other groups stay');
  out(io, '  variant use default [<groupId>]          back to the real files, for every group or one');
  out(io, '  variant off <id>                         deactivate one variant');
  out(io, '  variant sync <id>                        merge real-file changes into the copies');
  out(io, '  variant promote <id> [--force]           copy the variant over the real files and delete it');
  out(io, '  variant drop <id>                        delete a variant');
  out(io);
  out(io, 'Options: --dir <path> (default .isotone/variants), --file <path> (notes file for --note)');
  out(io);
  out(io, 'Variants that override the same file are alternatives of one selector without a');
  out(io, '--group; use one when the alternatives touch different files.');
  out(io, 'With more than a few selectors on a page, give each a section: --section "Header",');
  out(io, 'or a group label prefix such as --group-label "Header > Logo".');
}

function cmdList(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const allRoutes = has(args, '--all-routes');
  const route = pos[0];
  const variants = listVariants(opts);
  const active = readActive(opts);
  const rows = route && !allRoutes ? variants.filter((v) => variantAppliesTo(v.route, route)) : variants;

  if (rows.length === 0) {
    // A knobs-only project (any dev server without the Vite plugin) has no
    // file variants by design; lead with what it does have.
    if (!existsSync(join(resolve(opts.root), KNOBS_FILE))) {
      out(io, route ? `No variants for "${route}".` : 'No variants.');
      return 0;
    }
    out(io, route ? `No file variants for "${route}".` : 'No file variants.');
    printKnobs(io, opts, route && !allRoutes ? route : undefined);
    return 0;
  }

  // Grouped over every variant, not the filtered rows: a sibling on another
  // route still decides which selector this one belongs to.
  const groupOf = new Map<string, string>();
  const sectionOf = new Map<string, string>();
  for (const group of overlayGroups(variants)) {
    // The same rule as the panel: a member's `section`, else the label prefix.
    const explicit = group.members.find((m) => m.section !== undefined)?.section;
    const section = splitSectionLabel(group.label, explicit).section;
    for (const member of group.members) {
      groupOf.set(member.id, group.id);
      if (section) sectionOf.set(member.id, section);
    }
  }
  printTable(
    io,
    ['ID', 'LABEL', 'SECTION', 'GROUP', 'ROUTE', 'FILES', 'STALE', 'MISSING', 'ACTIVE'],
    rows.map((v) => [
      v.id,
      v.label,
      sectionOf.get(v.id) ?? '-',
      groupOf.get(v.id) ?? '-',
      v.route || '-',
      String(Object.keys(v.files).length),
      String(v.stale.length),
      String(v.missing.length),
      active.includes(v.id) ? '*' : '',
    ]),
  );
  printKnobs(io, opts, route && !allRoutes ? route : undefined);
  return 0;
}

/**
 * The knobs in `.isotone/knobs.json`, and every entry the panel will skip.
 * An invalid knob simply never shows up in the panel, so this is the one
 * place an agent can see why.
 */
function printKnobs(io: CliIO, opts: VariantsStoreOptions, route: string | undefined): void {
  const file = join(resolve(opts.root), KNOBS_FILE);
  if (!existsSync(file)) return;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    out(io);
    out(io, `${KNOBS_FILE} is not valid JSON, so the panel shows no knobs: ${(error as Error).message}`);
    return;
  }
  if (!Array.isArray(raw)) {
    out(io);
    out(io, `${KNOBS_FILE} must be a JSON array of knobs, so the panel shows none.`);
    return;
  }
  const valid = readKnobs(opts);
  const skipped: string[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, index) => {
    const id =
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : null;
    const name = `knob ${index + 1}${id === null ? '' : ` "${id}"`}`;
    const problem = knobProblem(entry);
    if (problem !== null) skipped.push(`Skipped ${name}: ${problem} (see node_modules/isotone/docs/variants.md, "Knobs").`);
    // An earlier knob already took this id; the panel keeps that one.
    else if (ids.has(id as string))
      skipped.push(`Skipped ${name}: another knob earlier in the file already has this id. Give each knob its own id.`);
    else ids.add(id as string);
  });
  const shown = route ? knobsFor(valid, route) : valid;
  out(io);
  if (shown.length) {
    printTable(
      io,
      ['KNOB', 'KIND', 'LABEL', 'ROUTE'],
      shown.map((k) => [k.id, k.kind ?? 'select', k.label, k.route === undefined ? '-' : ([] as string[]).concat(k.route).join(', ')]),
    );
  } else {
    out(io, route ? `No knobs for "${route}".` : `No valid knobs in ${KNOBS_FILE}.`);
  }
  for (const line of skipped) out(io, line);
}

function cmdNew(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [label, route, notePrefix, description, notesFile, group, groupLabel, section] = [
    '--label',
    '--route',
    '--note',
    '--description',
    '--file',
    '--group',
    '--group-label',
    '--section',
  ].map((flag) => valueFor(args, flag));
  const id = pos[0];
  if (!id) {
    errOut(io, 'Give a variant id: isotone variant new <id>');
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
    element = match.elements?.[0] ?? match.element;
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
    ...(section !== undefined ? { section: section.replace(/\s+/g, ' ').trim() } : {}),
  });
  out(
    io,
    `created "${variant.id}"${variant.route ? ` for ${variant.route}` : ''}${
      variant.group ? ` in group ${variant.group}` : ''
    }${variant.section ? ` in section "${variant.section}"` : ''}`,
  );
  return 0;
}

function cmdAdd(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const create = has(args, '--new');
  const [id, ...files] = pos;
  if (!id || files.length === 0) {
    errOut(io, 'Usage: isotone variant add <id> [--new] <file...>');
    return 1;
  }
  for (const file of files) addVariantFile(opts, id, file, { create });
  out(io, create ? `created ${files.length} new file(s) in "${id}"` : `added ${files.length} file(s) to "${id}"`);
  if (!create) for (const file of files) warnNoHotSwap(io, file);
  warnOverlaps(io, opts, id);
  return 0;
}

/** Say up front what would otherwise look like a page that reloads for no
 *  reason. Reads the export names only, so a capitalized constant slips by. */
function warnNoHotSwap(io: CliIO, file: string): void {
  const names = scanExports(readFileSync(resolve(io.cwd, file), 'utf8'));
  if (!names || isRouteModule(names)) {
    errOut(
      io,
      `warning: ${file} is served whole, so it follows .isotone/active.json in every tab instead of switching per tab. See "Live switching" in the variants guide.`,
    );
    return;
  }
  const fixed = names.filter((name) => name !== 'default' && !/^[A-Z]/.test(name));
  if (fixed.length) {
    errOut(
      io,
      `warning: ${file} exports ${fixed.join(', ')}, so switching this variant reloads the page. Move ${fixed.length === 1 ? 'it' : 'them'} to a file the variant leaves alone to switch in place.`,
    );
  }
}

function warnOverlaps(io: CliIO, opts: VariantsStoreOptions, id: string): void {
  for (const { file, other } of crossGroupOverlaps(opts, id)) {
    errOut(
      io,
      `warning: ${file} is also overridden by "${other}" in another group, so picking both fails. Put them in one group with \`variant group\`, or have them override different files.`,
    );
  }
}

function cmdRm(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, file] = pos;
  if (!id || !file) {
    errOut(io, 'Usage: isotone variant rm <id> <file>');
    return 1;
  }
  removeVariantFile(opts, id, file);
  out(io, `removed "${file}" from "${id}"`);
  return 0;
}

function cmdUse(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, groupId] = pos;
  if (!id) {
    errOut(io, 'Usage: isotone variant use <id> | variant use default [<groupId>]');
    return 1;
  }
  if (groupId !== undefined && id !== 'default') {
    errOut(io, `Unexpected "${groupId}": only \`variant use default <groupId>\` takes a group.`);
    return 1;
  }
  // Under the same lock as every other variants change, and refused like the
  // panel's request when another group already overrides one of its files.
  const message = mutateVariants(opts, () => {
    const active = readActive(opts);
    const groups = overlayGroups(listVariants(opts));
    if (id === 'default') {
      if (!groupId) {
        writeActive(opts, []);
        return 'active: default';
      }
      const group = groups.find((g) => g.id === groupId);
      if (!group) throw new Error(`No group "${groupId}". \`variant list\` shows the GROUP column.`);
      const members = new Set(group.members.map((m) => m.id));
      writeActive(
        opts,
        active.filter((a) => !members.has(a)),
      );
      return `active: default for ${groupId}${describeActive(readActive(opts))}`;
    }
    if (!readVariant(opts, id)) throw new Error(`No variant "${id}"`);
    // Only the siblings leave: the reviewer's other picks stay as they were,
    // the same as choosing an option in one selector of the panel.
    const siblings = new Set(groups.find((g) => g.members.some((m) => m.id === id))?.members.map((m) => m.id) ?? [id]);
    const next = [...active.filter((a) => !siblings.has(a)), id];
    const conflict = activeConflict(opts, next);
    if (conflict) {
      const [a, b, file] = conflict;
      const other = a === id ? b : a;
      throw new Error(
        `"${id}" and "${other}" both override ${file}, so only one can be active. Turn "${other}" off first (\`variant off ${other}\`), or put them in one group.`,
      );
    }
    writeActive(opts, next);
    return `active: "${id}"${describeActive(readActive(opts), id)}`;
  });
  out(io, message);
  return 0;
}

function cmdOff(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = pos[0];
  if (!id) {
    errOut(io, 'Usage: isotone variant off <id>');
    return 1;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  mutateVariants(opts, () =>
    writeActive(
      opts,
      readActive(opts).filter((a) => a !== id),
    ),
  );
  out(io, `off: "${id}"${describeActive(readActive(opts))}`);
  return 0;
}

/** The rest of the active set, so a `use` on one group says what else is
 *  showing; empty when nothing else is. */
function describeActive(active: string[], except?: string): string {
  const others = active.filter((a) => a !== except);
  return others.length ? ` (also active: ${others.map((a) => `"${a}"`).join(', ')})` : '';
}

function cmdGroup(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const label = valueFor(args, '--label');
  const [id, groupId] = pos;
  if (!id || !groupId) {
    errOut(io, 'Usage: isotone variant group <id> <groupId> [--label <text>]');
    return 1;
  }
  setVariantGroup(opts, id, groupId, label);
  out(io, `"${id}" is now in group ${groupId}${label !== undefined ? ` ("${label}")` : ''}`);
  warnOverlaps(io, opts, id);
  return 0;
}

/** A section belongs to the selector, so every variant in the group gets it. */
function cmdSection(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const none = has(args, '--none');
  const [id, ...words] = pos;
  if (!id || (none && words.length)) {
    errOut(io, 'Usage: isotone variant section <id> [<text> | --none]');
    return 1;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  const text = words.join(' ').replace(/\s+/g, ' ').trim();
  const members = overlayGroups(listVariants(opts))
    .find((g) => g.members.some((m) => m.id === id))
    ?.members.map((m) => m.id) ?? [id];
  // No text hands the decision back to the label prefix; --none keeps the
  // selector out of every section even when its label has a " > ".
  for (const member of members) setVariantSection(opts, member, none ? '' : text || undefined);
  const others =
    members.length > 1
      ? ` (with ${members
          .filter((m) => m !== id)
          .map((m) => `"${m}"`)
          .join(', ')})`
      : '';
  out(
    io,
    text
      ? `"${id}"${others} is now in section "${text}"`
      : none
        ? `"${id}"${others} is in no section`
        : `"${id}"${others} takes its section from its label`,
  );
  return 0;
}

function cmdSync(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = pos[0];
  if (!id) {
    errOut(io, 'Usage: isotone variant sync <id>');
    return 1;
  }
  const { merged, conflicts, unchanged } = syncVariant(opts, id);
  out(io, `merged: ${merged.length ? merged.join(', ') : 'none'}`);
  out(io, `conflicts: ${conflicts.length ? conflicts.join(', ') : 'none'}`);
  out(io, `unchanged: ${unchanged.length ? unchanged.join(', ') : 'none'}`);
  for (const file of conflicts) out(io, syncAdvice(opts, id, file));
  return 0;
}

function syncAdvice(opts: VariantsStoreOptions, id: string, file: string): string {
  const copy = join(variantDir(opts, id), file);
  if (existsSync(copy) && readFileSync(copy, 'utf8').includes('<<<<<<< variant')) {
    return `${file}: resolve the conflict markers in ${copy}`;
  }
  return `${file}: there is no base version to merge from, so the copy was left as it is. Compare it with the real file by hand, then \`variant promote ${id} --force\` when it should win.`;
}

function cmdPromote(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const force = has(args, '--force');
  const id = pos[0];
  if (!id) {
    errOut(io, 'Usage: isotone variant promote <id> [--force]');
    return 1;
  }
  const { files, rebased } = promoteVariant(opts, id, { force });
  out(io, `promoted "${id}": ${files.length ? files.join(', ') : 'no files'}`);
  if (rebased.length) out(io, `still alternatives, now based on the promoted files: ${rebased.join(', ')}`);
  return 0;
}

function cmdDrop(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const id = pos[0];
  if (!id) {
    errOut(io, 'Usage: isotone variant drop <id>');
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

function cmdPath(pos: string[], _args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, file] = pos;
  if (!id || !file) {
    errOut(io, 'Usage: isotone variant path <id> <file>');
    return 1;
  }
  if (!readVariant(opts, id)) {
    errOut(io, `No variant "${id}"`);
    return 1;
  }
  out(io, join(variantDir(opts, id), repoRelativeKey(io.cwd, file).key));
  return 0;
}
