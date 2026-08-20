// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The words in the file chooser's **Type** column.
 *
 * These are not ours to invent. The GTK file chooser reads them from the
 * system MIME database, and the KiCad entries in it are shipped by KiCad —
 * `resources/linux/mime/kicad-kicad.xml.in` and `kicad-gerbers.xml.in`, whose
 * `<comment>` is exactly the string the column shows. A capture of Save Project
 * on Ubuntu reads `KiCad Project` for a `.kicad_pro`, which is that file's
 * comment verbatim.
 *
 * So this is **data** in CLAUDE.md's sense: mirrored from upstream's table
 * rather than written to look right. It is deliberately *not* a description of
 * every extension we list — `s_allowedExtensionsToList` has 38 patterns and
 * KiCad supplies MIME entries for nine. The rest are types the desktop already
 * knows (`.pdf`, `.txt`, `.csv`, `.zip`), and inventing KiCad-flavoured names
 * for them would be putting words in the column that no KiCad user has seen.
 *
 * The glob weights (40 for the legacy extension, 50 for the current one) are
 * how the desktop breaks ties between two MIME entries claiming one file. There
 * is no tie to break here — one table, longest suffix wins — so they are
 * recorded in the comments and not modelled.
 */

interface FileTypeEntry {
  /** `<comment>`, the string the Type column shows. */
  readonly label: string;
  /** `<glob pattern>`, lowercased extensions without the dot. */
  readonly extensions: readonly string[];
}

/**
 * `kicad-kicad.xml.in` then `kicad-gerbers.xml.in`, in file order.
 *
 * `application/x-kicad-*` and the Gerber types. The MIME type strings
 * themselves are not modelled: nothing here dispatches on them, and a name we
 * do not use is a name that can drift without anyone noticing.
 */
const FILE_TYPES: readonly FileTypeEntry[] = [
  { label: 'KiCad Project', extensions: ['pro', 'kicad_pro'] },
  { label: 'KiCad Schematic', extensions: ['sch', 'kicad_sch'] },
  { label: 'KiCad Printed Circuit Board', extensions: ['kicad_pcb'] },
  { label: 'KiCad Footprint', extensions: ['kicad_mod'] },
  { label: 'KiCad Schematic Symbol', extensions: ['kicad_sym'] },
  { label: 'KiCad Drawing Sheet', extensions: ['kicad_wks'] },
  { label: 'Gerber file', extensions: ['gbr'] },
  { label: 'Gerber job file', extensions: ['gbrjob'] },
  { label: 'Excellon drill file', extensions: ['drl'] },
];

const BY_EXTENSION = new Map<string, string>(
  FILE_TYPES.flatMap((t) => t.extensions.map((e) => [e, t.label] as const)),
);

/**
 * The extension of a name, lowercased, without the dot — `''` when there is
 * none.
 *
 * Longest match, so `board.kicad_pcb` is `kicad_pcb` rather than `pcb`: the
 * table's own keys contain underscores and a naive "after the last dot" is
 * right here only by accident. A leading dot is not an extension, so
 * `.gitignore` has none.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * What the Type column shows for a name, or `null` when the desktop would
 * answer instead of KiCad.
 *
 * `null` is a real answer, not a gap: `.pdf` is a PDF because the system says
 * so, and the caller decides what to show for one. Returning an invented
 * `'PDF Document'` here would be this module claiming authority it does not
 * have.
 */
export function fileTypeLabel(name: string): string | null {
  return BY_EXTENSION.get(fileExtension(name)) ?? null;
}

/** The table, for tests and for anything that needs to enumerate it. */
export const KICAD_FILE_TYPES = FILE_TYPES;
