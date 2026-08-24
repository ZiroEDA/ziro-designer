// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Counterpart: `common/common.cpp` — the small free functions every editor
 * shares. One home, because upstream has one.
 */

/**
 * `EnsureFileExtension` (common/common.cpp:662-678).
 *
 * Upstream's own comment says why it is not simply "append the extension":
 *
 *   It's annoying to throw up nag dialogs when the extension isn't right. Just
 *   fix it, but be careful not to destroy existing after-dot-text that isn't
 *   actually a bad extension, such as "Schematic_1.1".
 *
 * so `Schematic_1.1` becomes `Schematic_1.1.kicad_sch` rather than losing its
 * `.1`. Three details of the C++ that are easy to drop:
 *
 *  - the comparison is `newFilename.Lower().AfterLast( '.' )`, so the test is
 *    case-INSENSITIVE but the returned string keeps the caller's casing:
 *    `FOO.KICAD_SCH` comes back untouched, not lower-cased;
 *  - wxString's `AfterLast` returns the WHOLE string when the character is
 *    absent, so a bare `foo` compares as `foo`, fails, and gains the extension;
 *  - a name already ending in `.` does not get a second dot.
 *
 * `aExtension` carries no leading dot, exactly as the callers pass
 * `FILEEXT::KiCadSchematicFileExtension`.
 */
export function ensureFileExtension(filename: string, extension: string): string {
  // wxString::AfterLast( ch ) returns the entire string if `ch` is not present.
  const afterLastDot = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1)
    : filename;

  if (afterLastDot.toLowerCase() === extension) return filename;
  return filename.endsWith('.') ? filename + extension : `${filename}.${extension}`;
}

/** `FILEEXT::KiCadSchematicFileExtension` (include/wildcards_and_files_ext.h). */
export const KICAD_SCHEMATIC_FILE_EXTENSION = 'kicad_sch';

/** `FILEEXT::DrawingSheetFileExtension` (wildcards_and_files_ext.h:158). */
export const DRAWING_SHEET_FILE_EXTENSION = 'kicad_wks';
