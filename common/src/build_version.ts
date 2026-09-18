// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/build_version.cpp`: the KiCad version the port follows. Data, not
 * chrome: the reports and file headers name the KiCad release whose formats
 * they write.
 */

/** `KICAD_MAJOR_MINOR_PATCH_VERSION` of the reference build. */
export const KICAD_MAJOR_MINOR_PATCH_VERSION = '10.0.5';

export function GetMajorMinorPatchVersion(): string {
  return KICAD_MAJOR_MINOR_PATCH_VERSION;
}

export function GetMajorMinorPatchTuple(): readonly [number, number, number] {
  return [10, 0, 5];
}
