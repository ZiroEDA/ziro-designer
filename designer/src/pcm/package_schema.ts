// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCM package schema (`go.kicad.org/pcm/schemas/v1`), read into our model.
 *
 * Split out of `pcmStore.ts` so the store reads as what it is -- installed
 * packages, repositories and the pending queue -- and so a package's payload
 * can be normalised without the store's localStorage-backed singleton.
 *
 * `PLUGIN_CONTENT_MANAGER::PreparePackage` (`kicad/pcm/pcm.cpp`) is the model:
 * parse every version, mark which ones the running app can take, sort newest
 * first.
 */

import { colorThemeFromFile, type ColorThemeContents } from '@ziroeda/common';
import type { Contact, LibraryPayload, PackageVersion, RepoPackage } from './types.js';

/** The running application's KiCad-compatibility version (kicad_version check). */
export const APP_KICAD_VERSION = '9.0.0';

// ---- version helpers (PreparePackage) ----------------------------------------

/** Parse a "major.minor.patch" string into a numeric tuple (missing = 0). */
export function versionParts(v: string): [number, number, number] {
  const m = /(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/.exec(v);
  if (!m) return [0, 0, 0];
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Parsed [major, minor, patch, epoch] tuple used for ordering. */
export function parsedVersion(pv: PackageVersion): [number, number, number, number] {
  const [maj, min, patch] = versionParts(pv.version);
  return [maj, min, patch, pv.versionEpoch ?? 0];
}

/** Compare parsed version tuples; epoch dominates, then major/minor/patch. */
export function compareParsed(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  // epoch first (index 3), then major, minor, patch.
  return a[3] - b[3] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Whether a version runs on the current app (kicad_version[_max] window). */
function isCompatible(pv: PackageVersion): boolean {
  const app = versionParts(APP_KICAD_VERSION);
  if (compareParsed([...versionParts(pv.kicadVersion), 0], [...app, 0]) > 0) return false;
  if (pv.kicadVersionMax) {
    if (compareParsed([...app, 0], [...versionParts(pv.kicadVersionMax), 0]) > 0) return false;
  }
  return true;
}

/** Fill parsedVersion + compatible and sort versions newest-first (in place). */
export function preparePackage(pkg: RepoPackage): RepoPackage {
  for (const v of pkg.versions) {
    v.parsedVersion = parsedVersion(v);
    v.compatible = isCompatible(v);
  }
  pkg.versions.sort((a, b) => compareParsed(b.parsedVersion!, a.parsedVersion!));
  return pkg;
}

/** The newest compatible, non-deprecated version of a package, if any. */
export function latestVersion(pkg: RepoPackage): PackageVersion | undefined {
  return (
    pkg.versions.find((v) => v.compatible && v.status !== 'deprecated') ??
    pkg.versions.find((v) => v.compatible)
  );
}

// ---- repository JSON normalisation (KiCad pcm.v1 → our model) -----------------

/**
 * A colour-theme package's payload.
 *
 * A KiCad colour-theme package is a zip whose `colors/` folder holds one theme
 * file, which the PCM copies into the third-party colours directory and
 * `SETTINGS_MANAGER::loadAllColorSettings` reads like any other. A repository
 * this app reads carries that file inline as `theme`, and it is read with the
 * same reader the theme folder uses -- migrations included, since every theme
 * the KiCad PCM offers is still a version-3 file. Already-read contents (an
 * installed package written back from localStorage) pass through.
 */
function normalizeTheme(raw: unknown): ColorThemeContents | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const file = colorThemeFromFile(raw);
  if (file) return file;
  const r = raw as Partial<ColorThemeContents>;
  if (typeof r.name === 'string' && typeof r.colors === 'object' && r.colors !== null) {
    return {
      name: r.name,
      colors: r.colors,
      ...(r.board ? { board: r.board } : {}),
      override: r.override === true,
    };
  }
  return undefined;
}

export function normalizeContact(raw: unknown): Contact {
  if (typeof raw === 'string') return { name: raw };
  const r = (raw ?? {}) as { name?: string; contact?: Record<string, string> };
  return { name: r.name ?? 'Unknown', contact: r.contact };
}

/** Map a KiCad-schema (snake_case) or native (camelCase) version object. */
export function normalizeVersion(raw: Record<string, unknown>): PackageVersion {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k] as T;
    return undefined;
  };
  return {
    version: String(pick('version') ?? '0'),
    versionEpoch: pick<number>('versionEpoch', 'version_epoch'),
    downloadUrl: pick<string>('downloadUrl', 'download_url'),
    downloadSha256: pick<string>('downloadSha256', 'download_sha256'),
    downloadSize: pick<number>('downloadSize', 'download_size'),
    installSize: pick<number>('installSize', 'install_size'),
    status: (pick<string>('status') as PackageVersion['status']) ?? 'stable',
    platforms: pick<string[]>('platforms'),
    kicadVersion: String(pick('kicadVersion', 'kicad_version') ?? '0'),
    kicadVersionMax: pick<string>('kicadVersionMax', 'kicad_version_max'),
    keepOnUpdate: pick<string[]>('keepOnUpdate', 'keep_on_update'),
    runtime: pick<PackageVersion['runtime']>('runtime'),
  };
}

/** Map a KiCad-schema (snake_case) or native package object to a RepoPackage. */
export function normalizePackage(raw: Record<string, unknown>): RepoPackage {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k] as T;
    return undefined;
  };
  const versions = (pick<Record<string, unknown>[]>('versions') ?? []).map(normalizeVersion);
  return preparePackage({
    id: String(pick('id', 'identifier') ?? ''),
    kind: (pick<string>('kind', 'type') as RepoPackage['kind']) ?? 'plugin',
    name: String(pick('name') ?? ''),
    description: String(pick('description') ?? ''),
    descriptionFull: pick<string>('descriptionFull', 'description_full'),
    author: normalizeContact(pick('author')),
    maintainer: raw.maintainer !== undefined ? normalizeContact(raw.maintainer) : undefined,
    license: String(pick('license') ?? 'Unknown'),
    category: pick<string>('category'),
    tags: pick<string[]>('tags'),
    keepOnUpdate: pick<string[]>('keepOnUpdate', 'keep_on_update'),
    resources: pick<Record<string, string>>('resources'),
    icon: pick<string>('icon'),
    versions,
    theme: normalizeTheme(pick('theme')),
    libraries: pick<LibraryPayload[]>('libraries'),
  });
}
