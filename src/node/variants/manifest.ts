/** Variant manifests: reading, listing, creating and editing variants. */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IterationElement } from '../../core/types';
import { OVERLAY_GROUP_ID, type OverlayVariant, type OverlayVariantStatus } from '../../core/variants/overlay';
import { writeJson } from '../fs/atomic';
import { isWithin } from '../fs/paths';
import { blobOf, hashFile, isGitIgnored } from './git';
import { type VariantsStoreOptions, mutateVariants, variantsDir } from './options';
import { variantDir, isValidVariantId, isSafeManifestKey, repoRelativeKey } from './paths';

/** Env files, private keys and credentials: a copy would sit in a directory
 *  that is committed by default. `.env.example` and the like are fine. */
function looksSecret(key: string): boolean {
  const segments = key.toLowerCase().split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.includes('.aws') || segments.includes('.ssh')) return true;
  if (/^\.env(\..+)?$/.test(name)) return !/\.(example|sample|template)$/.test(name);
  return (
    /\.(pem|key|p12|pfx|keystore|jks)$/.test(name) ||
    /^id_(rsa|dsa|ecdsa|ed25519)/.test(name) ||
    /credentials.*\.json$/.test(name) ||
    ['.npmrc', '.netrc', '.envrc', '.dev.vars'].includes(name)
  );
}

function isPlausibleVariant(v: unknown): v is OverlayVariant {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.createdAt === 'string' &&
    (o.route === undefined || typeof o.route === 'string') &&
    (o.description === undefined || typeof o.description === 'string') &&
    (o.group === undefined || (typeof o.group === 'string' && OVERLAY_GROUP_ID.test(o.group))) &&
    (o.groupLabel === undefined || typeof o.groupLabel === 'string') &&
    (o.section === undefined || typeof o.section === 'string') &&
    !!o.files &&
    typeof o.files === 'object' &&
    !Array.isArray(o.files) &&
    Object.entries(o.files).every(
      ([key, entry]) =>
        isSafeManifestKey(key) &&
        entry &&
        typeof entry === 'object' &&
        'base' in entry &&
        (entry.base === null || (typeof entry.base === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(entry.base))) &&
        (!('added' in entry) || entry.added === true),
    )
  );
}

export function readVariant(opts: VariantsStoreOptions, id: string): OverlayVariant | null {
  // An id that is not a valid directory name (`..`, a path with a slash)
  // would resolve to somewhere outside the variants dir; there is no
  // variant there by definition.
  if (!isValidVariantId(id)) return null;
  const file = join(variantDir(opts, id), 'variant.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const dir = variantDir(opts, id);
    return isPlausibleVariant(data) &&
      data.id === id &&
      isWithin(variantsDir(opts), file, { realpath: true }) &&
      Object.keys(data.files).every(
        (key) => isWithin(opts.root, join(opts.root, key), { realpath: true }) && isWithin(dir, join(dir, key), { realpath: true }),
      )
      ? data
      : null;
  } catch {
    // Junk directory: unreadable or not JSON. listVariants skips it.
    return null;
  }
}

export function writeVariant(opts: VariantsStoreOptions, v: OverlayVariant): void {
  if (!isPlausibleVariant(v)) throw new Error('Invalid variant manifest');
  const dir = variantDir(opts, v.id);
  if (!isWithin(variantsDir(opts), dir, { realpath: true })) throw new Error('Variant directory escapes the variants tree');
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'variant.json'), v);
}

/** Whether a tracked file has drifted from what its override was derived
 *  from. `base: null` (never hashed, or the manifest was hand-edited to
 *  simulate an unreachable blob) counts as stale too: there's nothing to
 *  compare against, so we can't claim it's unchanged. */
export function isStale(base: string | null, currentHash: string | null): boolean {
  return base === null || currentHash === null || currentHash !== base;
}

/** Every valid manifest, oldest first, without the per-file status that
 *  {@link listVariants} hashes for. */
export function readVariants(opts: VariantsStoreOptions): OverlayVariant[] {
  const dir = variantsDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readVariant(opts, e.name))
    .filter((v): v is OverlayVariant => v !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listVariants(opts: VariantsStoreOptions): OverlayVariantStatus[] {
  const dir = variantsDir(opts);
  if (!existsSync(dir)) return [];
  const root = resolve(opts.root);
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const statuses: OverlayVariantStatus[] = [];
  const hashes = new Map<string, string | null>();
  for (const id of ids) {
    const manifest = readVariant(opts, id);
    if (!manifest) continue; // no manifest, or invalid JSON: not a variant
    const stale: string[] = [];
    const missing: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      const overrideAbs = join(dir, id, file);
      if (!existsSync(overrideAbs)) {
        missing.push(file);
        continue;
      }
      // A file the variant adds is current for as long as the project still
      // lacks it; once a real one appears, the two need a person.
      if (entry.added) {
        if (existsSync(join(root, file))) stale.push(file);
        continue;
      }
      const hashKey = `${entry.base?.length}:${file}`;
      if (!hashes.has(hashKey)) hashes.set(hashKey, hashFile(join(root, file), entry.base));
      if (isStale(entry.base, hashes.get(hashKey) ?? null)) stale.push(file);
    }
    statuses.push({ ...manifest, stale, missing });
  }
  statuses.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return statuses;
}

export function createVariant(
  opts: VariantsStoreOptions,
  input: {
    id: string;
    label?: string;
    route?: string;
    element?: IterationElement | null;
    note?: string;
    description?: string;
    group?: string;
    groupLabel?: string;
    section?: string;
  },
): OverlayVariant {
  return mutateVariants(opts, () => {
    if (!isValidVariantId(input.id)) {
      throw new Error(`Invalid variant id "${input.id}"`);
    }
    if (input.group !== undefined) assertGroupId(input.group);
    if (readVariant(opts, input.id)) {
      throw new Error(`Variant "${input.id}" already exists`);
    }
    const variant: OverlayVariant = {
      id: input.id,
      label: input.label || input.id,
      createdAt: new Date().toISOString(),
      files: {},
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.element !== undefined ? { element: input.element } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
      ...(input.groupLabel !== undefined ? { groupLabel: input.groupLabel } : {}),
      ...(input.section !== undefined ? { section: input.section } : {}),
    };
    writeVariant(opts, variant);
    return variant;
  });
}

function assertGroupId(group: string): void {
  if (!OVERLAY_GROUP_ID.test(group)) {
    throw new Error(`Invalid group id "${group}" (lowercase letters, digits and hyphens)`);
  }
}

/** Put an existing variant into a group, so two variants made separately
 *  become alternatives of one decision. `groupLabel` is left as it was
 *  unless given. */
export function setVariantGroup(opts: VariantsStoreOptions, id: string, group: string, groupLabel?: string): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    assertGroupId(group);
    manifest.group = group;
    if (groupLabel !== undefined) manifest.groupLabel = groupLabel;
    writeVariant(opts, manifest);
    return manifest;
  });
}

/**
 * Put an existing variant's selector in a panel section, or take it out of
 * every section with `''`. `undefined` removes the field, so the group label's
 * prefix (`"Header > Logo"`) decides again.
 */
export function setVariantSection(opts: VariantsStoreOptions, id: string, section: string | undefined): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    if (section === undefined) delete manifest.section;
    else manifest.section = section.replace(/\s+/g, ' ').trim();
    writeVariant(opts, manifest);
    return manifest;
  });
}

/**
 * Copy a real file into the variant. With `create`, the file is one the
 * project does not have yet: the variant gets an empty file at that path,
 * and the plugin resolves imports of it while the variant is loaded.
 * A git-ignored or secret-looking file is refused unless `force` is set.
 */
export function addVariantFile(
  opts: VariantsStoreOptions,
  id: string,
  file: string,
  { create = false, force = false }: { create?: boolean; force?: boolean } = {},
): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const { abs: sourceAbs, key } = repoRelativeKey(root, file);
    // Idempotent: a file already tracked keeps its override and its base
    // untouched. Re-adding is a no-op, not a refresh (sync is how you refresh).
    if (Object.hasOwn(manifest.files, key)) return manifest;
    const destAbs = join(variantDir(opts, id), key);
    if (!isWithin(variantDir(opts, id), destAbs, { realpath: true })) throw new Error('Override path escapes the variant directory');
    if (create) {
      if (existsSync(sourceAbs)) throw new Error(`"${file}" already exists; add it without --new`);
      mkdirSync(dirname(destAbs), { recursive: true });
      if (!existsSync(destAbs)) writeFileSync(destAbs, '');
      manifest.files = { ...manifest.files, [key]: { base: null, added: true } };
      writeVariant(opts, manifest);
      return manifest;
    }
    if (!existsSync(sourceAbs)) throw new Error(`"${file}" does not exist. Use --new for a file the variant adds.`);
    const refusal = force
      ? null
      : looksSecret(key)
        ? `"${file}" looks like a secret`
        : isGitIgnored(sourceAbs)
          ? `Git ignores "${file}"`
          : null;
    if (refusal)
      throw new Error(`${refusal}; variants are meant to be committed, so it is not copied. Ask the user before copying it with --force.`);
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, readFileSync(sourceAbs));
    manifest.files = { ...manifest.files, [key]: { base: blobOf(sourceAbs) } };
    writeVariant(opts, manifest);
    return manifest;
  });
}

export function removeVariantFile(opts: VariantsStoreOptions, id: string, file: string): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const { key } = repoRelativeKey(root, file);
    if (Object.hasOwn(manifest.files, key)) {
      delete manifest.files[key];
      rmSync(join(variantDir(opts, id), key), { force: true });
      writeVariant(opts, manifest);
    }
    return manifest;
  });
}
