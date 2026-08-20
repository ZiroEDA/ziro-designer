// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which files a project folder shows.
 *
 * `PROJECT_TREE_PANE` does not list everything and grey out what it cannot
 * open. It builds `m_filters` from `s_allowedExtensionsToList`
 * (`kicad/project_tree_pane.cpp:266`) and shows only what matches — so a
 * `.docx` beside a `.kicad_pro` simply never appears, and there is no
 * "cannot open this" state to render.
 *
 * This is **data**, in the sense CLAUDE.md means: a table KiCad itself
 * hardcodes. It is mirrored rather than invented, verbatim and in order,
 * including the parts that look like mistakes:
 *
 *  - Four patterns open `^[^$]` rather than `^.*`, so a name beginning with a
 *    dollar is excluded — `$foo.kicad_pcb` is hidden where `foo.kicad_pcb` is
 *    shown. Backup and lock files are what that is for.
 *  - `.kicad_mod` carries the upstream comment "currently not listed", which is
 *    stale — it *is* in the array and does list. The comment is kept because
 *    the next person to read it deserves to know it is upstream's, not ours.
 *  - The final entry has **no trailing `$`**, so it matches any name containing
 *    `.kicad_jobset`, not only one ending in it. Preserved deliberately: this
 *    is a port, and correcting KiCad's oddities is how a port stops matching.
 *
 * The sentinel `^no KiCad files found` lives in the same array upstream
 * (`:268`) but is not an extension — it is the row an empty directory shows —
 * so it is not here.
 */

/**
 * `s_allowedExtensionsToList`, in upstream's order.
 *
 * The strings are the C++ regexes with one change: `\\.` becomes `\.`, because
 * that doubling is C++ string escaping rather than part of the pattern.
 */
export const ALLOWED_FILE_PATTERNS: readonly string[] = [
  '^.*\\.pro$',
  '^.*\\.kicad_pro$',
  '^.*\\.pdf$',
  '^.*\\.sch$', // Legacy Eeschema files
  '^.*\\.kicad_sch$', // S-expr Eeschema files
  '^[^$].*\\.brd$', // Legacy Pcbnew files
  '^[^$].*\\.kicad_pcb$', // S format Pcbnew board files
  '^[^$].*\\.kicad_dru$', // Design rule files
  '^[^$].*\\.kicad_wks$', // S format kicad drawing sheet files
  '^[^$].*\\.kicad_mod$', // S format kicad footprint files, currently not listed
  '^.*\\.net$', // pcbnew netlist file
  '^.*\\.cir$', // Spice netlist file
  '^.*\\.lib$', // Legacy schematic library file
  '^.*\\.kicad_sym$', // S-expr symbol libraries
  '^.*\\.txt$', // Text files
  '^.*\\.md$', // Markdown files
  '^.*\\.pho$', // Gerber file (Old Kicad extension)
  '^.*\\.gbr$', // Gerber file
  '^.*\\.gbrjob$', // Gerber job file
  '^.*\\.gb[alops]$', // Gerber back (or bottom) layer file (deprecated Protel ext)
  '^.*\\.gt[alops]$', // Gerber front (or top) layer file (deprecated Protel ext)
  '^.*\\.g[0-9]{1,2}$', // Gerber inner layer file (deprecated Protel ext)
  '^.*\\.gm[0-9]{1,2}$', // Gerber mechanical layer file (deprecated Protel ext)
  '^.*\\.gko$', // Gerber keepout layer file (deprecated Protel ext)
  '^.*\\.odt$',
  '^.*\\.htm$',
  '^.*\\.html$',
  '^.*\\.rpt$', // Report files
  '^.*\\.csv$', // Report files in comma separated format
  '^.*\\.pos$', // Footprint position files
  '^.*\\.cmp$', // CvPcb cmp/footprint link files
  '^.*\\.drl$', // Excellon drill files
  '^.*\\.nc$', // Excellon NC drill files (alternate file ext)
  '^.*\\.xnc$', // Excellon NC drill files (alternate file ext)
  '^.*\\.svg$', // SVG print/plot files
  '^.*\\.ps$', // PostScript plot files
  '^.*\\.zip$', // Zip archive files
  '^.*\\.kicad_jobset', // KiCad jobs file
];

/**
 * The row an empty project folder shows — `project_tree_pane.cpp:268`, where it
 * sits in the same array as the extensions and is matched against nothing.
 */
export const NO_FILES_FOUND = 'no KiCad files found';

/** Compiled once: `m_filters` is built at construction upstream, not per file. */
const COMPILED = ALLOWED_FILE_PATTERNS.map((p) => new RegExp(p));

/**
 * Whether a project folder lists this name.
 *
 * Case-sensitive, as `wxRegEx::Matches` is here — upstream compiles these with
 * no `wxRE_ICASE`, so `FOO.KICAD_PCB` does not list. That is worth knowing
 * before someone "fixes" it: it is upstream's behaviour, not an oversight of
 * this port.
 */
export function isListedFile(name: string): boolean {
  return COMPILED.some((re) => re.test(name));
}
