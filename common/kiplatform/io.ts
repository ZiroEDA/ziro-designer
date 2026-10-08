// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `KIPLATFORM::IO` (libs/kiplatform/os/unix/io.cpp), the part the library caches ask.
 */
import { wxDirEnumerate, wxFileModificationTime, wxReadFileSync } from '../wx/filefn.js';

/** `fnmatch( aPattern, aName, FNM_CASEFOLD | FNM_PERIOD )` for the `*` and `?` wildcards. */
function fnmatchCasefoldPeriod(aPattern: string, aName: string): boolean {
  // FNM_PERIOD: a leading period must be matched by a period in the pattern.
  if (aName.startsWith('.') && !aPattern.startsWith('.')) return false;

  const re = aPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${re}$`, 'i').test(aName);
}

/**
 * `TimestampDir( aDirPath, aFilespec )`: a number that changes whenever a file matching
 * \a aFilespec in the directory is written, added or removed - each file's time in
 * milliseconds plus its size, summed.
 */
export function TimestampDir(aDirPath: string, aFilespec: string): number {
  let timestamp = 0;
  const entries = wxDirEnumerate(aDirPath);

  if (!entries) return timestamp;

  for (const entry of entries) {
    if (!fnmatchCasefoldPeriod(aFilespec, entry.name)) continue;

    // S_ISREG: directories do not count.
    if (entry.isDir) continue;

    const path = `${aDirPath.replace(/\/+$/, '')}/${entry.name}`;

    timestamp += wxFileModificationTime(path) * 1000;
    timestamp += wxReadFileSync(path)?.length ?? 0;
  }

  return timestamp;
}
