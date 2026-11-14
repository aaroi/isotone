/**
 * isotone — `variant` CLI subcommands, over the node store in
 * `src/node/variants`. Every subcommand is synchronous: the store does no
 * I/O beyond the filesystem and `git`, so there is nothing here to await.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import {
  axisDefault,
  OVERLAY_DEFAULT_OPTION,
  type OverlayVariantStatus,
  overlayAxes,
  overlayGroups,
  overlayKnobs,
  sectionAxes,
  variantAppliesTo,
  visibleAxes,
} from '../core/variants';
import { isRouteModule, scanExports } from '../node/variants/exports';
import { readNotes } from '../node/notes/store';
import {
  activeConflict,
  addVariantFile,
  createVariant,
  crossGroupOverlaps,
  dropVariant,
  filesWithoutBase,
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
  hasGit,
  NO_GIT_SYNC,
  type SyncBlocker,
  type VariantsStoreOptions,
} from '../node/variants';
import { mutateVariants } from '../node/variants/options';
import { repoRelativeKey } from '../node/variants/paths';
import { docPath } from './docs';
import { hostSourceFiles } from './init';
import { excludeLocalFiles } from './local-files';
import { findNotesFile } from './notes';
import { detectHost, fileVariantSwitching, vitePlugin } from './project';
import { toJson } from './text';
import { type CliIO, errOut, extractFlag, findNoteByPrefix, has, out, parseArgs, printTable, valueFor } from './util';

/** Each subcommand's value flags, boolean flags and most positionals; anything else is refused. */
const SPEC: Record<string, [values: string[], booleans: string[], positionals: number]> = {
  list: [[], ['--all-routes', '--json'], 1],
  new: [['--label', '--route', '--note', '--description', '--file', '--group', '--group-label', '--section'], ['--force'], 1],
  add: [[], ['--new', '--force'], Number.POSITIVE_INFINITY],
  rm: [[], [], 2],
  use: [[], ['--force'], 2],
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
  const command = Object.hasOwn(commands, sub) ? commands[sub] : undefined;
  if (!spec || !command) {
    errOut(io, `Unknown "variant" subcommand "${sub}". Run \`isotone variant --help\` for the list.`);
    return 1;
  }
  try {
    // Validate every flag before anything is read or written: a typo such as
    // `drop x --dry-run` must fail, not delete.
    const positionals = parseArgs(rest, spec[0], spec[1], 'npx isotone variant --help');
    if (positionals.length > spec[2]) throw new Error(`Unexpected "${positionals[spec[2]]}". Run \`isotone variant --help\`.`);
    const code = command(positionals, rest, io, opts);
    excludeLocalFiles(opts.root);
    return code;
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
  out(io, '  variant list [<route>] [--all-routes]    every variant; * marks the active ones;');
  out(io, '               [--json]                    --json: variants, knobs and skipped knobs as one object,');
  out(io, '                                           and hostSources: files with the app’s own selectors');
  out(io, '  variant new <id> [--note <prefix>] [--route <path>] [--label <text>]');
  out(io, '                   [--description <text>] [--group <id>] [--group-label <text>]');
  out(io, '                   [--section <text>] [--force]');
  out(io, '                                           start one; --note copies route and element from a note,');
  out(io, '                                           --group makes it one alternative of a shared selector,');
  out(io, '                                           --section names the part of the page it sits under');
  out(io, '  variant add <id> [--new] [--force] <file...>  copy real files into it, then edit the copies;');
  out(io, '                                           --new starts a file the project does not have,');
  out(io, '                                           --force copies a git-ignored or secret-looking file');
  out(io, '  variant path <id> <file>                 where the copy of <file> lives');
  out(io, '  variant rm <id> <file>                   stop overriding one file');
  out(io, '  variant group <id> <groupId> [--label <text>]');
  out(io, '                                           put an existing variant into a group');
  out(io, '  variant section <id> [<text> | --none]   put its selector (every variant in its group) in a');
  out(io, '                                           panel section; no text goes back to the label prefix');
  out(io, '  variant use <id> [--force]               activate it on every dev server on this root, in');
  out(io, '                                           place of its group siblings; other groups stay');
  out(io, '  variant use default [<groupId>]          back to the real files, for every group or one');
  out(io, '  variant off <id>                         deactivate one variant');
  out(io, '  variant sync <id>                        merge real-file changes into the copies');
  out(io, '  variant promote <id> [--force]           copy the variant over the real files and delete it');
  out(io, '  variant drop <id>                        delete a variant');
  out(io);
  out(io, 'Options: --dir <path> (default .isotone/variants), --file <path> (notes file for --note)');
  out(io);
  out(io, 'File variants need the Vite plugin (isotone/vite). With `isotone serve` or another dev');
  out(io, 'server, use knobs in .isotone/knobs.json, or the app’s own VariantsSource. In a Next.js');
  out(io, 'app, which runs no Vite plugin, new and use refuse unless given --force.');
  out(io);
  out(io, 'Variants that override the same file are alternatives of one selector without a');
  out(io, '--group; use one when the alternatives touch different files.');
  out(io, 'With more than a few selectors on a page, give each a section: --section "Header",');
  out(io, 'or a group label prefix such as --group-label "Header > Logo".');
}

function cmdList(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const allRoutes = has(args, '--all-routes');
  const route = pos[0];
  const scope = route && !allRoutes ? route : undefined;
  const variants = listVariants(opts);
  const active = readActive(opts);
  const rows = scope ? variants.filter((v) => variantAppliesTo(v.route, scope)) : variants;

  // Grouped over every variant, not the filtered rows: a sibling on another
  // route still decides which selector this one belongs to.
  const groupOf = new Map<string, string>();
  const membersOf = new Map<string, string[]>();
  for (const group of overlayGroups(variants)) {
    for (const member of group.members) groupOf.set(member.id, group.id);
    membersOf.set(
      group.id,
      group.members.map((m) => m.id),
    );
  }
  const knobs = knobReport(io, opts, scope, variants);
  // Sections as the panel draws the page (every page, without a route): the same selectors, less
  // those a `showWhen` hides at the active variants and the knobs' defaults, grouped the same way.
  const selects = overlayAxes({ variants, active }, scope);
  const on = new Set(active);
  const picks: Record<string, string> = {};
  for (const axis of selects) picks[axis.id] = axis.options.find((o) => on.has(o.id))?.id ?? OVERLAY_DEFAULT_OPTION;
  for (const knob of knobs?.shown ?? []) picks[knob.id] = axisDefault(knob);
  const sectionOf = new Map<string, string>();
  for (const section of sectionAxes(visibleAxes([...selects, ...(knobs?.shown ?? [])], picks))) {
    if (section.name === null) continue;
    for (const { axis } of section.axes) for (const id of membersOf.get(axis.id) ?? []) sectionOf.set(id, section.name);
  }
  if (variants.length) warnUnserved(io, opts);
  const hostSources = hostSourceFiles(resolve(opts.root));

  if (has(args, '--json')) {
    out(
      io,
      toJson({
        variants: rows.map((v) => ({
          id: v.id,
          label: v.label,
          ...(v.description ? { description: v.description } : {}),
          route: v.route ?? null,
          group: groupOf.get(v.id) ?? null,
          section: sectionOf.get(v.id) ?? null,
          files: Object.keys(v.files),
          stale: v.stale,
          noBase: filesWithoutBase(v),
          missing: v.missing,
          conflicts: v.conflicts ?? [],
          active: active.includes(v.id),
        })),
        knobs: knobs?.shown ?? [],
        skippedKnobs: knobs?.skipped ?? [],
        ...(knobs?.error ? { knobsError: knobs.error } : {}),
        ...(hostSources.length ? { hostSources } : {}),
      }),
    );
    return 0;
  }
  printHostSources(io, hostSources);

  if (rows.length === 0) {
    // A knobs-only project (any dev server without the Vite plugin) has no
    // file variants by design; lead with what it does have.
    if (!knobs) {
      out(io, route ? `No variants for "${route}".` : 'No variants.');
      return 0;
    }
    out(io, route ? `No file variants for "${route}".` : 'No file variants.');
    printKnobs(io, knobs, scope);
    return 0;
  }

  printTable(
    io,
    ['ID', 'LABEL', 'SECTION', 'GROUP', 'ROUTE', 'FILES', 'STALE', 'MISSING', 'CONFLICTS', 'ACTIVE'],
    rows.map((v) => [
      v.id,
      v.label,
      sectionOf.get(v.id) ?? '-',
      groupOf.get(v.id) ?? '-',
      v.route || '-',
      String(Object.keys(v.files).length),
      String(v.stale.length),
      String(v.missing.length),
      String(v.conflicts?.length ?? 0),
      active.includes(v.id) ? '*' : '',
    ]),
  );
  // A copy with no recorded base reads as stale, but nobody knows whether its
  // real file changed; it gets its own line rather than the merge advice.
  const stale = rows.filter((v) => {
    const unbased = filesWithoutBase(v);
    return v.stale.some((file) => !unbased.includes(file));
  });
  if (stale.length) {
    out(io);
    out(
      io,
      hasGit()
        ? `STALE: the real file changed since the copy was made. \`variant sync <id>\` merges the change in: ${stale.map((v) => v.id).join(', ')}`
        : `STALE: the real file changed since the copy was made. ${NO_GIT_SYNC}: ${stale.map((v) => v.id).join(', ')}`,
    );
  }
  const unbased = rows.filter((v) => filesWithoutBase(v).length);
  if (unbased.length) {
    out(io);
    out(
      io,
      `NO BASE: these copies have no base recorded (not a git repo when they were made), so whether their real files changed is unknown and \`variant sync\` cannot merge. Compare each with its real file by hand, then \`variant promote <id> --force\` when it should win: ${unbased.map((v) => `${v.id} (${filesWithoutBase(v).join(', ')})`).join(', ')}`,
    );
  }
  const conflicted = rows.filter((v) => v.conflicts?.length);
  if (conflicted.length) {
    out(io);
    out(
      io,
      `CONFLICTS: these copies hold conflict markers from \`variant sync\` and cannot be shown until you resolve them: ${conflicted.map((v) => v.id).join(', ')}`,
    );
  }
  if (knobs) printKnobs(io, knobs, scope);
  return 0;
}

interface KnobReport {
  shown: ReturnType<typeof readKnobs>;
  skipped: { index: number; id: string | null; reason: string }[];
  /** Why the file gives no knobs at all. */
  error?: string;
}

/**
 * The knobs in `.isotone/knobs.json`, and every entry the panel will skip;
 * null when there is no such file. An invalid knob simply never shows up in
 * the panel, so this is the one place an agent can see why.
 */
function knobReport(io: CliIO, opts: VariantsStoreOptions, route: string | undefined, variants: OverlayVariantStatus[]): KnobReport | null {
  const file = join(resolve(opts.root), KNOBS_FILE);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { shown: [], skipped: [], error: `${KNOBS_FILE} is not valid JSON, so the panel shows no knobs: ${(error as Error).message}` };
  }
  if (!Array.isArray(raw))
    return { shown: [], skipped: [], error: `${KNOBS_FILE} must be a JSON array of knobs, so the panel shows none.` };
  const guide = docPath(io.cwd, 'docs/variants.md');
  const skipped: KnobReport['skipped'] = [];
  const ids = new Set<string>();
  const groups = new Set(overlayGroups(variants).map((group) => group.id));
  raw.forEach((entry, index) => {
    const id =
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id : null;
    const problem = knobProblem(entry);
    if (problem !== null) skipped.push({ index: index + 1, id, reason: `${problem} (see ${guide}, "Knobs").` });
    // An earlier knob already took this id; the panel keeps that one.
    else if (ids.has(id as string))
      skipped.push({ index: index + 1, id, reason: 'another knob earlier in the file already has this id. Give each knob its own id.' });
    else {
      ids.add(id as string);
      if (groups.has(id as string))
        skipped.push({
          index: index + 1,
          id,
          reason: 'a file variant group has this id, so the panel shows only its selector. Give the knob its own id.',
        });
    }
  });
  return { shown: overlayKnobs({ variants, knobs: readKnobs(opts) }, route), skipped };
}

/**
 * The app's own selectors live in its code, out of the CLI's reach: say so
 * first, so an empty or partial list is not read as what the panel shows.
 */
function printHostSources(io: CliIO, files: string[]): void {
  if (!files.length) return;
  const shown = files.slice(0, 3).join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : '');
  out(io, `Not listed: the app’s own selectors (${shown}), which only the page can show.`);
  out(io, 'The panel lists them first, then the variants and knobs below once mountIsotone');
  out(io, 'has the notes endpoint of the Vite plugin or `isotone serve`.');
  out(io);
}

function printKnobs(io: CliIO, report: KnobReport, route: string | undefined): void {
  out(io);
  if (report.error) {
    out(io, report.error);
    return;
  }
  if (report.shown.length) {
    printTable(
      io,
      ['KNOB', 'KIND', 'LABEL', 'ROUTE'],
      report.shown.map((k) => [
        k.id,
        k.kind ?? 'select',
        k.label,
        k.route === undefined ? '-' : ([] as string[]).concat(k.route).join(', '),
      ]),
    );
  } else {
    out(io, route ? `No knobs for "${route}".` : `No valid knobs in ${KNOBS_FILE}.`);
  }
  for (const { index, id, reason } of report.skipped) out(io, `Skipped knob ${index}${id === null ? '' : ` "${id}"`}: ${reason}`);
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
  refuseUnserved(io, opts, args, `"${id}" was not created`);

  // --note seeds route/element from an existing piece of feedback so a
  // variant answering a note does not need its context typed out again.
  // Explicit --route still wins over what the note carries.
  let seededRoute = route;
  let element: ReturnType<typeof readNotes>[number]['element'] | undefined;
  let note: string | undefined;
  if (notePrefix) {
    const { file } = findNotesFile(io, notesFile);
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
  warnUnserved(io, opts, args);
  return 0;
}

function cmdAdd(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const create = has(args, '--new');
  const [id, ...files] = pos;
  if (!id || files.length === 0) {
    errOut(io, 'Usage: isotone variant add <id> [--new] [--force] <file...>');
    return 1;
  }
  for (const file of files) addVariantFile(opts, id, file, { create, force: has(args, '--force') });
  out(io, create ? `created ${files.length} new file(s) in "${id}"` : `added ${files.length} file(s) to "${id}"`);
  if (!create) {
    const switching = switchingOf(opts);
    for (const file of files) warnNoHotSwap(io, file, switching);
  }
  warnOverlaps(io, opts, id);
  // Its --force is about the file copied, so it never silences this.
  warnUnserved(io, opts);
  return 0;
}

/** Where Next.js leaves file variants to: knobs, or the app's own selectors. */
function alternatives(root: string): string {
  const own = hostSourceFiles(root)[0];
  return own
    ? `Use knobs in .isotone/knobs.json, or a selector in the app’s own VariantsSource (${own}).`
    : 'Use knobs in .isotone/knobs.json, or the app’s own VariantsSource (npx isotone init --approach host).';
}

/**
 * Nothing serves a file variant in a Next.js app, so making or activating one
 * there would only look like it worked: `new` and `use` refuse, unless
 * `--force`. Both only write Isotone's own files; `add` warns instead, since
 * its `--force` lets a secret-looking or git-ignored file through.
 */
function refuseUnserved(io: CliIO, opts: VariantsStoreOptions, args: string[], what: string): void {
  if (has(args, '--force') || switchingOf(opts) !== 'none') return;
  throw new Error(
    `${what}: Next.js runs no Vite plugin, so nothing here serves file variants and the panel would never show it. ${alternatives(variantsProject(opts) ?? io.cwd)} If the user still wants file variants here (a sibling Vite dev server serves them), pass --force.`,
  );
}

/**
 * The store takes a variant anywhere, but only the Vite plugin serves one: in
 * a Next app, or under `isotone serve`, the panel lists nothing while the CLI
 * reports success. Said on stderr, so `--json` output stays parseable. Only
 * Next is certain (and refused without `--force`, so said only by `list`): a
 * sibling dev server can serve this project's variants (`variants: { root }`),
 * so the rest say "may".
 */
function warnUnserved(io: CliIO, opts: VariantsStoreOptions, args: string[] = []): void {
  const root = variantsProject(opts);
  if (root === null) return;
  const { loaded, viteConfig } = vitePlugin(root);
  if (loaded) return;
  if (detectHost(root) === 'next') {
    // A forced `new` or `use` was just refused with this.
    if (has(args, '--force')) return;
    errOut(
      io,
      `warning: file variants need the Vite plugin (isotone/vite), and Next.js does not run it, so the panel will not show them. ${alternatives(root)}`,
    );
  } else if (viteConfig) {
    errOut(
      io,
      `warning: ${viteConfig} does not import isotone/vite, so the panel may not show file variants from here. \`npx isotone init\` prints the plugin line.`,
    );
  } else {
    errOut(
      io,
      `warning: file variants need the Vite plugin (isotone/vite), and no config in this directory imports it, so the panel may not show them. ${alternatives(root)}`,
    );
  }
}

/** The project that holds the variants: `--dir <app>/.isotone/variants` names another one; any other directory, null. */
function variantsProject(opts: VariantsStoreOptions): string | null {
  if (!opts.dir) return opts.root;
  const dir = resolve(opts.root, opts.dir);
  return basename(dirname(dir)) === '.isotone' ? dirname(dirname(dir)) : null;
}

/**
 * How the plugin will switch these variants, for what `variant add` warns about
 * ({@link fileVariantSwitching}). Next serves none, which `warnUnserved` says.
 */
function switchingOf(opts: VariantsStoreOptions): ReturnType<typeof fileVariantSwitching> {
  const root = variantsProject(opts);
  return root === null ? 'live' : fileVariantSwitching(root);
}

/** Say up front what would otherwise look like a page that reloads for no
 *  reason. Reads the export names only, so a capitalized constant slips by. */
function warnNoHotSwap(io: CliIO, file: string, switching: ReturnType<typeof switchingOf>): void {
  if (switching === 'none') return;
  // plugin-vue's hot update reads the real file, so the Vite plugin switches a Vue component by reloading.
  if (file.endsWith('.vue')) {
    errOut(
      io,
      `warning: ${file} is a Vue component, so switching this variant, or editing its copy while it is active, reloads the page and changes every tab. See "Vue components" in the variants guide.`,
    );
    return;
  }
  // Astro reloads the page after any change to an `.astro` file, a switch included.
  if (file.endsWith('.astro')) {
    errOut(
      io,
      `warning: ${file} is an Astro component, so switching this variant reloads the page, as any edit of an .astro file does, and changes every tab. See "Vue components" in the variants guide.`,
    );
    return;
  }
  // A host without React swaps the file over HMR, which its own components accept.
  if (switching === 'whole') return;
  const names = scanExports(readFileSync(resolve(io.cwd, file), 'utf8'));
  if (!names || isRouteModule(names)) {
    // Every file is served whole outside live mode; only there is this one the exception.
    if (switching === 'live') {
      errOut(
        io,
        `warning: ${file} is served whole, so it follows .isotone/active.json in every tab instead of switching per tab. See "Live switching" in the variants guide.`,
      );
    }
    return;
  }
  const fixed = names.filter((name) => name !== 'default' && !/^[A-Z]/.test(name));
  if (!fixed.length) return;
  const move = `Move ${fixed.length === 1 ? 'it' : 'them'} to a file the variant leaves alone to switch in place.`;
  errOut(
    io,
    switching === 'live'
      ? `warning: ${file} exports ${fixed.join(', ')}, so switching this variant reloads the page. ${move}`
      : // Fast Refresh cannot swap such a file alone: the update climbs to its importers, and reloads at an entry.
        `warning: ${file} exports ${fixed.join(', ')}, so a switch re-runs the files that import it and may reload the page. ${move}`,
  );
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

function cmdUse(pos: string[], args: string[], io: CliIO, opts: VariantsStoreOptions): number {
  const [id, groupId] = pos;
  if (!id) {
    errOut(io, 'Usage: isotone variant use <id> | variant use default [<groupId>]');
    return 1;
  }
  if (groupId !== undefined && id !== 'default') {
    errOut(io, `Unexpected "${groupId}": only \`variant use default <groupId>\` takes a group.`);
    return 1;
  }
  // Back to the real files is what the page shows anyway.
  if (id !== 'default') refuseUnserved(io, opts, args, `"${id}" was not activated`);
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
  if (id !== 'default') warnUnserved(io, opts, args);
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
  const { merged, conflicts, unchanged, blocked } = syncVariant(opts, id);
  const notMerged = Object.keys(blocked);
  out(io, `merged: ${merged.length ? merged.join(', ') : 'none'}`);
  out(io, `conflicts: ${conflicts.length ? conflicts.join(', ') : 'none'}`);
  out(io, `unchanged: ${unchanged.length ? unchanged.join(', ') : 'none'}`);
  if (notMerged.length) out(io, `not merged: ${notMerged.join(', ')}`);
  for (const file of conflicts)
    out(io, `${file}: resolve the conflict markers in ${join(variantDir(opts, id), file)}. Until then the reviewer cannot see "${id}".`);
  for (const file of notMerged) out(io, notMergedAdvice(id, file, blocked[file] as SyncBlocker));
  if (!conflicts.length && !notMerged.length) return 0;
  const problems = [
    ...(conflicts.length ? [conflicts.length === 1 ? 'a conflict' : 'conflicts'] : []),
    ...(notMerged.length ? [`${notMerged.length === 1 ? 'a file' : 'files'} sync could not merge`] : []),
  ];
  errOut(io, `Not synced: "${id}" has ${problems.join(' and ')}. Fix each file above, then check with \`npx isotone variant list\`.`);
  return 1;
}

function notMergedAdvice(id: string, file: string, why: SyncBlocker): string {
  if (why === 'no-git') return `${file}: ${NO_GIT_SYNC}.`;
  if (why === 'no-file')
    return `${file}: the real file no longer exists. \`variant rm ${id} ${file}\` drops the copy; \`variant promote ${id} --force\` lands it as a new file.`;
  const reason = {
    'no-base': 'no base recorded (not a git repo when the copy was made)',
    appeared: 'the variant adds this file, and the project now has its own',
    failed: 'the base it was made from could not be read or merged',
  }[why];
  return `${file}: ${reason}, so the copy was left as it is. Compare it with the real file by hand, then \`variant promote ${id} --force\` when it should win.`;
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
