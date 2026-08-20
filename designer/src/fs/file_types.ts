// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The words in the file chooser's **Type** column.
 *
 * These are not ours to invent, and they are not what an earlier version of
 * this file assumed either. The GTK chooser does *not* show the MIME
 * description: a real 964 kB PDF shows `Document`, not `PDF document`, even
 * though `g_content_type_get_description("application/pdf")` is `PDF document`.
 * What it shows is the word for the type's **generic icon**, falling back to
 * the description only when a type declares an icon of its own.
 *
 *     x-office-document     -> Document
 *     image-x-generic       -> Image
 *     package-x-generic     -> Archive
 *     text-x-generic        -> Text
 *     application-x-generic -> Program
 *     unknown content type  -> Unknown
 *     its own generic-icon  -> the <comment>
 *
 * That last line is the only reason `KiCad Project` appears at all, and KiCad's
 * source says which types get it: the six entries in
 * `resources/linux/mime/kicad-kicad.xml.in` each carry a `<generic-icon>` and
 * ship an icon under `resources/linux/icons/hicolor/<size>/mimetypes/`.
 * `kicad-gerbers.xml.in` declares no icon — so **`Gerber file` never appears in
 * the column**. A `.gbr` reads `Text`, and so do `.gbrjob` and `.drl`.
 *
 * The table below was measured on the parity machine rather than reasoned out:
 * a `Gtk.FileChooserWidget` was built under python-gi and its GtkTreeView model
 * dumped row by row, over files with genuine content (a stub file sniffs as
 * `text/plain` and answers `Text` for everything, which is how `.otf` first
 * came back as `Document` instead of `Font`). The full capture is in
 * `docs/proposals/file-dialog.md`.
 *
 * A browser cannot sniff a file it has not pulled, so ours answers from the
 * extension alone. Where GTK would sniff — a name we have no entry for — the
 * answer is `Unknown`, which is GTK's own word for a type it cannot place.
 */

/** The word shown for a file whose type we cannot place. GTK's own string. */
export const UNKNOWN_TYPE = 'Unknown';

interface FileTypeEntry {
  /** `<comment>`, the string the Type column shows. */
  readonly label: string;
  /** `<glob pattern>`, lowercased extensions without the dot. */
  readonly extensions: readonly string[];
}

/**
 * The six types from `kicad-kicad.xml.in` that declare a `<generic-icon>`.
 *
 * In file order. These are the ones whose `<comment>` reaches the column; the
 * three in `kicad-gerbers.xml.in` are handled by the category table below,
 * where they read `Text` like any other text file.
 */
const KICAD_ICONED_TYPES: readonly FileTypeEntry[] = [
  { label: 'KiCad Project', extensions: ['pro', 'kicad_pro'] },
  { label: 'KiCad Schematic', extensions: ['sch', 'kicad_sch'] },
  { label: 'KiCad Printed Circuit Board', extensions: ['kicad_pcb'] },
  { label: 'KiCad Footprint', extensions: ['kicad_mod'] },
  { label: 'KiCad Schematic Symbol', extensions: ['kicad_sym'] },
  { label: 'KiCad Drawing Sheet', extensions: ['kicad_wks'] },
];

/**
 * Everything else, by the category word measured for it.
 *
 * The keys cover `s_allowedExtensionsToList` — every file a KiCad project
 * folder can show — plus what a user is likely to drop beside it. An extension
 * absent here answers {@link UNKNOWN_TYPE} rather than a guess.
 *
 * Some of these read oddly and are still what the machine says: `.md` is a
 * Document rather than Text, `.json` is a Program, `.stl` is an Image, and
 * `.lib` is a Program because shared-mime-info reads it as a shared library
 * long before it considers KiCad's legacy symbol format.
 */
const CATEGORY_BY_EXTENSION: Readonly<Record<string, string>> = {
  // --- from s_allowedExtensionsToList ---
  pdf: 'Document',
  brd: 'Text',
  kicad_dru: 'Text',
  net: 'Text',
  cir: 'Text',
  lib: 'Program',
  txt: 'Text',
  md: 'Document',
  pho: 'Text',
  gbr: 'Text',
  gbrjob: 'Text',
  gko: 'Text',
  odt: 'Document',
  htm: 'Text',
  html: 'Text',
  rpt: 'Text',
  csv: 'Text',
  pos: 'Text',
  cmp: 'Text',
  drl: 'Text',
  nc: 'Document',
  xnc: 'Text',
  svg: 'Image',
  ps: 'Document',
  zip: 'Archive',
  kicad_jobset: 'Text',
  // The Protel layer extensions are a family: `.gb[alops]`, `.gt[alops]`,
  // `.g[0-9]{1,2}` and `.gm[0-9]{1,2}`. They are matched by
  // `protelLayerCategory` below rather than enumerated, because the numeric
  // ones alone are 220 keys. `.gba` is the exception the measurement caught:
  // shared-mime-info claims it for Game Boy Advance ROMs, so it reads Program.
  gba: 'Program',
  // --- 3D models a project carries beside the board ---
  step: 'Text',
  stp: 'Text',
  wrl: 'Document',
  stl: 'Image',
  dxf: 'Image',
  dwg: 'Image',
  // --- what a user drops in a project folder ---
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  bmp: 'Image',
  ico: 'Image',
  tif: 'Image',
  xml: 'Markup',
  json: 'Program',
  js: 'Program',
  sh: 'Program',
  bat: 'Program',
  exe: 'Program',
  dll: 'Program',
  so: 'Shared library',
  ttf: 'Font',
  otf: 'Font',
  woff: 'Font',
  woff2: 'Font',
  tar: 'Archive',
  gz: 'Archive',
  tgz: 'Archive',
  bz2: 'Archive',
  xz: 'Archive',
  '7z': 'Archive',
  rar: 'Archive',
  deb: 'Archive',
  a: 'Archive',
  doc: 'Document',
  docx: 'Document',
  xls: 'Spreadsheet',
  xlsx: 'Spreadsheet',
  ppt: 'Presentation',
  pptx: 'Presentation',
  mp3: 'Audio',
  ogg: 'Audio',
  wav: 'Audio',
  mp4: 'Video',
  webm: 'Video',
  db: 'SQLite3 database',
  sqlite: 'SQLite3 database',
  py: 'Text',
  c: 'Text',
  cpp: 'Text',
  h: 'Text',
  hpp: 'Text',
  ts: 'Text',
  ini: 'Text',
  cfg: 'Text',
  conf: 'Text',
  toml: 'Text',
  yaml: 'Text',
  yml: 'Text',
  log: 'Text',
  lock: 'Text',
  env: 'Text',
};

const BY_EXTENSION = new Map<string, string>(
  KICAD_ICONED_TYPES.flatMap((t) => t.extensions.map((e) => [e, t.label] as const)),
);

/**
 * The deprecated Protel layer extensions, which are a pattern rather than a
 * list — `s_allowedExtensionsToList` writes them as four regexes and the
 * numeric ones would be hundreds of keys spelled out.
 *
 * All plain text to shared-mime-info, `.gba` excepted (see the table).
 */
function protelLayerCategory(ext: string): string | null {
  if (/^g[bt][alops]$/.test(ext)) return 'Text';
  if (/^gm?[0-9]{1,2}$/.test(ext)) return 'Text';
  return null;
}

/**
 * The extension of a name, lowercased, without the dot — `''` when there is
 * none.
 *
 * Everything after the last dot, so `board.kicad_pcb` is `kicad_pcb` rather
 * than `pcb`: the table's own keys contain underscores. A leading dot is not an
 * extension, so `.gitignore` has none.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * What the Type column shows for a file name.
 *
 * A folder has no type at all — the column is empty for one, as it is for its
 * size — so this is asked only about files, and the caller draws nothing for a
 * folder rather than passing its name here.
 */
export function fileTypeLabel(name: string): string {
  const ext = fileExtension(name);
  return (
    BY_EXTENSION.get(ext) ?? CATEGORY_BY_EXTENSION[ext] ?? protelLayerCategory(ext) ?? UNKNOWN_TYPE
  );
}

/** The six iconed KiCad types, for tests and for the filter combo. */
export const KICAD_FILE_TYPES = KICAD_ICONED_TYPES;
