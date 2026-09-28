// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/eeschema_helpers.cpp`/`.h`: `EESCHEMA_HELPERS`, the headless
 * schematic loader `kicad-cli`/Python scripting/the IPC API use to load a
 * `SCHEMATIC` outside a `SCH_EDIT_FRAME` GUI session — resolve or load the
 * project, pick a format plugin, parse the file, migrate/prune/annotate the
 * loaded sheets, then rebuild the connection graph.
 *
 * We have no CLI and no out-of-process API boundary for this to serve (no
 * `eeschema/api/`, per `eeschema/STRUCTURE.md`'s own table), so the bulk of
 * `LoadSchematic` — the `SETTINGS_MANAGER`/`PROJECT` resolution, the actual
 * `SCH_IO` plugin parse, the `SCH_SHEET_LIST`/`SCH_SCREENS` migration walk,
 * `TOOL_MANAGER`/`SCH_COMMIT` wiring for `RecalculateConnections` — has no
 * caller here, the way `STRUCTURE.md` already noted before this file
 * existed. That whole pipeline also currently reaches into
 * `SCHEMATIC`/`connection_graph`/`sch_io/kicad_sexpr`, which are mid-port by
 * other work in this same tree; wiring it up now would mean depending on
 * classes whose shape is still moving.
 *
 * What's ported here instead are `LoadSchematic`'s two genuinely pure,
 * caller-independent pieces, each usable (and tested) on their own once a
 * real caller exists:
 *
 * - the format-dispatch overload (`LoadSchematic(aFileName, aSetActive,
 *   aForceDefaultProject, …)`, which picks a `SCH_IO_MGR::SCH_FILE_T` by
 *   `aFileName`'s extension before calling the format-specific overload) —
 *   `chooseSchFileFormat`;
 * - the root-sheet display-name resolution (`rootSheet->GetName().IsEmpty()`
 *   branch, matching the loaded file against
 *   `PROJECT_FILE::GetTopLevelSheets()`'s entries by absolute path) —
 *   `resolveRootSheetName`.
 *
 * `SetSchEditFrame`'s "is the project already the live one" shortcut
 * (`s_SchEditFrame && project == &mgr.Prj()`) is not ported: it exists to
 * hand back the GUI frame's already-loaded `SCHEMATIC` instead of
 * re-parsing, and there is exactly one `SCH_EDIT_FRAME` GUI window here
 * anyway, so nothing needs a second, headless load path to short-circuit
 * against.
 */
import type { TOP_LEVEL_SHEET_INFO } from '@ziroeda/common/project/project_file.js';
import { KICAD_SCHEMATIC_FILE_EXTENSION } from '@ziroeda/common/common.js';
import { wxNormalizePath } from '@ziroeda/common/wx/filefn.js';

/** `SCH_IO_MGR::SCH_FILE_T`, as far as `LoadSchematic`'s dispatch needs it. */
export enum SCH_FILE_T {
  SCH_KICAD = 0,
  SCH_LEGACY = 1,
}

/** `FILEEXT::LegacySchematicFileExtension` (wildcards_and_files_ext.cpp:139). */
const LEGACY_SCHEMATIC_FILE_EXTENSION = 'sch';

/**
 * `EESCHEMA_HELPERS::LoadSchematic(aFileName, aSetActive, aForceDefaultProject, …)`
 * (eeschema_helpers.cpp:49-61): which format plugin to parse `aFileName`
 * with. `.kicad_sch` is `SCH_KICAD`, `.sch` is `SCH_LEGACY`, and anything
 * else — "as fall back for any other kind" — is `SCH_LEGACY` too, exactly
 * as upstream falls back.
 */
export function chooseSchFileFormat(aFileName: string): SCH_FILE_T {
  const lower = aFileName.toLowerCase();

  if (lower.endsWith(`.${KICAD_SCHEMATIC_FILE_EXTENSION}`)) return SCH_FILE_T.SCH_KICAD;

  if (lower.endsWith(`.${LEGACY_SCHEMATIC_FILE_EXTENSION}`)) return SCH_FILE_T.SCH_LEGACY;

  // "as fall back for any other kind use the legacy format" (eeschema_helpers.cpp:59-60).
  return SCH_FILE_T.SCH_LEGACY;
}

/**
 * `EESCHEMA_HELPERS::LoadSchematic`'s root-sheet-name resolution
 * (eeschema_helpers.cpp:132-149): when the loaded root sheet has no name of
 * its own, find the `schematic.top_level_sheets` entry (`PROJECT_FILE`)
 * whose path matches the loaded file and use its display name; "Root"
 * ($( _( "Root" ) )) when none matches.
 *
 * @param aTopLevelSheets `project->GetProjectFile().GetTopLevelSheets()`.
 * @param aProjectDir `project->GetProjectPath()` — the project directory,
 * with its trailing separator (`PROJECT.GetProjectPath()`'s own contract).
 * @param aSchFilePath the loaded schematic file's absolute path.
 */
export function resolveRootSheetName(
  aTopLevelSheets: readonly TOP_LEVEL_SHEET_INFO[],
  aProjectDir: string,
  aSchFilePath: string,
): string {
  const wantPath = wxNormalizePath(aSchFilePath);

  for (const info of aTopLevelSheets) {
    if (info.name === '') continue;

    const candidatePath = wxNormalizePath(aProjectDir + info.filename);

    if (candidatePath === wantPath) return info.name;
  }

  return 'Root';
}
