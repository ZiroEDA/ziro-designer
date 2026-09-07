// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * File > New Project scaffolding: the three files a fresh project starts
 * with (.kicad_pro / .kicad_sch / .kicad_pcb), byte-identical in spirit to
 * what the desktop suite writes, so a new ZiroEDA project opens
 * anywhere.
 */

import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import type { PickedHomeFile } from './files.js';

const enc = new TextEncoder();

// What pcbnew writes for File > New Board. `BOARD_DESIGN_SETTINGS`'s
// constructor is explicit about the shape (`board_design_settings.cpp:64-66`):
//
//     // Default design is a double layer board with 4 user defined layers
//     SetCopperLayerCount( 2 );
//     SetUserDefinedLayerCount( 4 );
//
// so User.1-4 are enabled before the board has ever been through Board Setup.
// This template stopped at B.Fab, which is why a new board here opened with no
// user layers where a new board in KiCad has four. They come last because the
// writer walks `GetEnabledLayers().TechAndUserUIOrder()`, whose tail is the
// User.N run (`pcb_io_kicad_sexpr.cpp:678`); their ids are User_1 = 39 stepping
// by two, and they carry the plain `user` qualifier because LT_AUX is not
// LT_FRONT or LT_BACK (`:684-694`).
export const EMPTY_PCB = `(kicad_pcb (version 20241229) (generator "${GENERATOR}")
  (general (thickness 1.6) (legacy_teardrops no))
  (paper "A4")
  (layers
    (0 "F.Cu" signal)
    (2 "B.Cu" signal)
    (9 "F.Adhes" user "F.Adhesive")
    (11 "B.Adhes" user "B.Adhesive")
    (13 "F.Paste" user)
    (15 "B.Paste" user)
    (5 "F.SilkS" user "F.Silkscreen")
    (7 "B.SilkS" user "B.Silkscreen")
    (1 "F.Mask" user)
    (3 "B.Mask" user)
    (17 "Dwgs.User" user "User.Drawings")
    (19 "Cmts.User" user "User.Comments")
    (21 "Eco1.User" user "User.Eco1")
    (23 "Eco2.User" user "User.Eco2")
    (25 "Edge.Cuts" user)
    (27 "Margin" user)
    (31 "F.CrtYd" user "F.Courtyard")
    (29 "B.CrtYd" user "B.Courtyard")
    (35 "F.Fab" user)
    (33 "B.Fab" user)
    (39 "User.1" user)
    (41 "User.2" user)
    (43 "User.3" user)
    (45 "User.4" user)
  )
  (net 0 "")
)
`;

// What eeschema writes for File > New Schematic: an empty root sheet (A4,
// page 1). The uuid is the sheet's own id, referenced from the .kicad_pro
// "sheets" list (KiCad ties the project's root sheet to this uuid).
export const emptySch = (uuid: string): string => `(kicad_sch
	(version 20250114)
	(generator "${GENERATOR}")
	(generator_version "${GENERATOR_VERSION}")
	(uuid "${uuid}")
	(paper "A4")
	(lib_symbols)
	(sheet_instances
		(path "/"
			(page "1")
		)
	)
)
`;

// KiCad's default project file (kicad_pro): JSON settings written by File > New
// Project. Only the essentials KiCad always emits, the app derives the project
// name from `meta.filename` and ties the root schematic via `sheets`.
export const projectJson = (name: string, rootUuid: string): string =>
  `${JSON.stringify(
    {
      board: {
        design_settings: { defaults: {}, rules: {}, track_widths: [], via_dimensions: [] },
        layer_presets: [],
        viewports: [],
      },
      boards: [],
      cvpcb: { equivalence_files: [] },
      erc: { rule_severities: {}, pin_map: [], erc_exclusions: [] },
      libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
      meta: { filename: `${name}.kicad_pro`, version: 3 },
      net_settings: { classes: [{ name: 'Default', clearance: 0.2 }], meta: { version: 3 } },
      pcbnew: { last_paths: {}, page_layout_descr_file: '' },
      schematic: {
        annotate_start_num: 0,
        drawing: {},
        legacy_lib_dir: '',
        legacy_lib_list: [],
        meta: { version: 1 },
        net_format_name: '',
        spice_current_sheet_as_root: false,
      },
      sheets: [[rootUuid, '']],
      text_variables: {},
    },
    null,
    2,
  )}\n`;

// Build the three files KiCad's File > New Project writes from scratch, nested
// under a folder named for the project (mirrors KiCad's project directory). The
// root schematic shares the .kicad_pro basename so the editor pairs them.
export const newProjectFiles = (name: string): PickedHomeFile[] => {
  const uuid = (): string =>
    crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rootUuid = uuid();
  const dir = `${name}/`;
  const mk = (path: string, text: string): PickedHomeFile => ({
    name: path,
    text,
    bytes: enc.encode(text),
  });
  return [
    mk(`${dir}${name}.kicad_pro`, projectJson(name, rootUuid)),
    mk(`${dir}${name}.kicad_sch`, emptySch(rootUuid)),
    mk(`${dir}${name}.kicad_pcb`, EMPTY_PCB),
  ];
};

// KiCad rejects these in project names (invalid on common filesystems).
export const sanitizeProjectName = (s: string): string => s.replace(/[/\\:*?"<>|]/g, '').trim();

/**
 * Save As: copy the project's files under a new project name, the folder
 * prefix and every file whose stem matches the old project name are renamed
 * (mirrors the upstream manager's SaveProjectAs copy).
 */
export function copyProjectFiles(
  files: readonly PickedHomeFile[],
  stripPrefix: string,
  oldName: string,
  newName: string,
): PickedHomeFile[] {
  return files.map((f) => {
    let rel = f.name.replace(/\\/g, '/');
    if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length);
    rel = rel.replace(/^\/+/, '');
    const parts = rel.split('/');
    const base = parts[parts.length - 1]!;
    const dot = base.lastIndexOf('.');
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    const ext = dot >= 0 ? base.slice(dot) : '';
    if (stem.toLowerCase() === oldName.toLowerCase()) parts[parts.length - 1] = `${newName}${ext}`;
    return { ...f, name: `${newName}/${parts.join('/')}` };
  });
}
