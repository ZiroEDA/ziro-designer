// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/eeschema.cpp`: the `eeschema` KIFACE — one kiface serving both the
 * Schematic Editor and the Symbol Editor.
 *
 *  - `OnKifaceStart`: registers the two settings objects the frames read
 *    (`symbol_editor` first, then eeschema's own, in upstream's order);
 *  - `CreateKiWindow`: the switch from a class id to what it makes — the four
 *    frames, the two library-table dialogs, and the thirteen Preferences pages;
 *  - `SaveFileAs`: where a project's Save As puts one of its eeschema files,
 *    and the rewritten text of the ones that name the project.
 *
 * Kept small on purpose: the program's settings store (in designer's entry
 * chunk) calls `OnKifaceStart`, so nothing here may pull in a frame or a page.
 * The pages are the program's React panels, handed in by id
 * ({@link EESCHEMA_PAGES}); the frames are mounted by the program.
 *
 * Not here, each for a stated reason: `IfaceOrAddress( KIFACE_NETLIST_SCHEMATIC )`
 * and `readSchematicFromFile` — the in-process netlist call pcbnew makes; ours
 * crosses the kiway as `MAIL_SCH_GET_NETLIST` (`SCH_EDIT_FRAME::KiwayMailIn`).
 * `PreloadLibraries` / `CancelPreload` / `ProjectChanged` — the hosted library
 * preload, `designer/src/editors/schematic/preload.ts`, which drives the app's
 * worker pool. `HandleJob` / `HandleJobConfig` — the CLI jobs handler
 * (`eeschema_jobs_handler`, not ported: no CLI).
 */
import { CopySexprFile } from '@ziroeda/common/gestfich.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import {
  LIBRARY_TABLE,
  LIBRARY_TABLE_SCOPE,
  LIBRARY_TABLE_TYPE,
} from '@ziroeda/common/libraries/library_table.js';
import {
  type EeschemaSettings,
  setEeschemaSettingsProvider,
  setUpdateEeschemaSettingsProvider,
} from './eeschema_settings.js';
import {
  type SymbolEditorSettings,
  setSymbolEditorSettingsProvider,
  setUpdateSymbolEditorSettingsProvider,
} from './symbol_editor/symbol_editor_settings.js';

/** `kiface( "eeschema", KIWAY::FACE_SCH )`. [data] */
export const EESCHEMA_KIFACE_NAME = 'eeschema';

/**
 * `IFACE::OnKifaceStart` (eeschema.cpp:451-479): the symbol editor's settings
 * are registered first, then eeschema's — "in legacy configs, many settings
 * were in a single editor config and the migration routine for the main
 * editor file will try and call into the now separate settings stores". The
 * stores are the program's, so each arrives as the function that reads it.
 */
export function OnKifaceStart(
  aEeschema: () => EeschemaSettings,
  aSymbolEditor: () => SymbolEditorSettings,
  aUpdateEeschema?: (mutate: (s: EeschemaSettings) => void) => void,
  aUpdateSymbolEditor?: (mutate: (s: SymbolEditorSettings) => void) => void,
): void {
  setSymbolEditorSettingsProvider(aSymbolEditor);
  setEeschemaSettingsProvider(aEeschema);

  if (aUpdateSymbolEditor) setUpdateSymbolEditorSettingsProvider(aUpdateSymbolEditor);

  if (aUpdateEeschema) setUpdateEeschemaSettingsProvider(aUpdateEeschema);
}

/**
 * The thirteen Preferences pages `CreateKiWindow` constructs, by the class
 * upstream constructs for each. The program supplies them; a page it leaves
 * out is one this kiface does not answer.
 */
export interface EESCHEMA_PAGES<P> {
  PANEL_SYM_DISPLAY_OPTIONS?: P;
  /** `PANEL_GRID_SETTINGS( …, FRAME_SCH_SYMBOL_EDITOR )`. */
  PANEL_SYM_GRID_SETTINGS?: P;
  PANEL_SYM_EDITING_OPTIONS?: P;
  /** `PANEL_TOOLBAR_CUSTOMIZATION( …, FRAME_SCH_SYMBOL_EDITOR, … )`. */
  PANEL_SYM_TOOLBAR_CUSTOMIZATION?: P;
  PANEL_SYM_COLOR_SETTINGS?: P;
  PANEL_EESCHEMA_DISPLAY_OPTIONS?: P;
  /** `PANEL_GRID_SETTINGS( …, FRAME_SCH )`. */
  PANEL_SCH_GRID_SETTINGS?: P;
  PANEL_EESCHEMA_EDITING_OPTIONS?: P;
  /** `PANEL_TOOLBAR_CUSTOMIZATION( …, FRAME_SCH, … )`. */
  PANEL_SCH_TOOLBAR_CUSTOMIZATION?: P;
  PANEL_EESCHEMA_COLOR_SETTINGS?: P;
  PANEL_TEMPLATE_FIELDNAMES?: P;
  PANEL_SCH_DATA_SOURCES?: P;
  PANEL_SIMULATOR_PREFERENCES?: P;
}

/**
 * `IFACE::CreateKiWindow( aParent, aClassId, aKiway, aCtlBits )`
 * (eeschema.cpp:187-395), the Preferences arm: the page for each `PANEL_*` id.
 * The frame and dialog ids (`FRAME_SCH`, `FRAME_SCH_SYMBOL_EDITOR`,
 * `FRAME_SIMULATOR`, `FRAME_SCH_VIEWER`, `FRAME_SYMBOL_CHOOSER`,
 * `DIALOG_SCH_LIBRARY_TABLE`, `DIALOG_DESIGN_BLOCK_LIBRARY_TABLE`) are windows
 * the program mounts, so they answer null here, as does any id this kiface
 * does not know.
 */
export function CreateKiWindow<P>(aClassId: FRAME_T, aPages: EESCHEMA_PAGES<P>): P | null {
  switch (aClassId) {
    case FRAME_T.PANEL_SYM_DISP_OPTIONS:
      return aPages.PANEL_SYM_DISPLAY_OPTIONS ?? null;

    case FRAME_T.PANEL_SYM_EDIT_GRIDS:
      return aPages.PANEL_SYM_GRID_SETTINGS ?? null;

    case FRAME_T.PANEL_SYM_EDIT_OPTIONS:
      return aPages.PANEL_SYM_EDITING_OPTIONS ?? null;

    case FRAME_T.PANEL_SYM_TOOLBARS:
      return aPages.PANEL_SYM_TOOLBAR_CUSTOMIZATION ?? null;

    case FRAME_T.PANEL_SYM_COLORS:
      return aPages.PANEL_SYM_COLOR_SETTINGS ?? null;

    case FRAME_T.PANEL_SCH_DISP_OPTIONS:
      return aPages.PANEL_EESCHEMA_DISPLAY_OPTIONS ?? null;

    case FRAME_T.PANEL_SCH_GRIDS:
      return aPages.PANEL_SCH_GRID_SETTINGS ?? null;

    case FRAME_T.PANEL_SCH_EDIT_OPTIONS:
      return aPages.PANEL_EESCHEMA_EDITING_OPTIONS ?? null;

    case FRAME_T.PANEL_SCH_TOOLBARS:
      return aPages.PANEL_SCH_TOOLBAR_CUSTOMIZATION ?? null;

    case FRAME_T.PANEL_SCH_COLORS:
      return aPages.PANEL_EESCHEMA_COLOR_SETTINGS ?? null;

    case FRAME_T.PANEL_SCH_FIELD_NAME_TEMPLATES:
      return aPages.PANEL_TEMPLATE_FIELDNAMES ?? null;

    case FRAME_T.PANEL_SCH_DATA_SOURCES:
      return aPages.PANEL_SCH_DATA_SOURCES ?? null;

    case FRAME_T.PANEL_SCH_SIMULATOR:
      return aPages.PANEL_SIMULATOR_PREFERENCES ?? null;

    default:
      return null;
  }
}

/** What `SaveFileAs` does with one file: where it goes, and its text there. */
export interface SAVE_FILE_AS_RESULT {
  /** The destination path. */
  path: string;
  /**
   * The rewritten text (`CopySexprFile`, or the re-saved library table), or
   * null when the file is copied as it is (`KiCopyFile`).
   */
  text: string | null;
}

const KICAD_SCHEMATIC_EXT = 'kicad_sch';
const LEGACY_SCHEMATIC_EXT = 'sch';
const BACKUP_SUFFIX = '-bak';
const SCHEMATIC_SYMBOL_EXT = 'sym';
const LEGACY_SYMBOL_LIB_EXT = 'lib';
const LEGACY_SYMBOL_DOC_EXT = 'dcm';
const KICAD_SYMBOL_LIB_EXT = 'kicad_sym';
const NETLIST_EXT = 'net';
const SYMBOL_LIBRARY_TABLE_FILE = 'sym-lib-table';

/**
 * `IFACE::SaveFileAs` (eeschema.cpp:634-771): one of a project's eeschema
 * files, copied into the project saved as \a aNewProjectName under
 * \a aNewProjectBasePath.
 *
 * - A schematic (or its backup) named after the project takes the new name
 *   and has its `(project "…")` rewritten; one already named after the NEW
 *   project is refused, since the new root sheet would overwrite it.
 * - A `.sym` file keeps its name; a symbol library named `<project>-cache` or
 *   `<project>-rescue` follows the project.
 * - A netlist named after the project follows it, and its `(source …)` paths
 *   are rewritten.
 * - The project's `sym-lib-table` has its cache/rescue/project library URIs
 *   renamed and is re-saved.
 *
 * @param aSrcText the source file's text (the browser has no path to open).
 * @param aErrors accumulates the messages upstream appends to `aErrors`.
 * @return where the file goes and its new text, or null when it is not copied.
 */
export function SaveFileAs(
  aProjectBasePath: string,
  aProjectName: string,
  aNewProjectBasePath: string,
  aNewProjectName: string,
  aSrcFilePath: string,
  aSrcText: string,
  aErrors: { value: string },
): SAVE_FILE_AS_RESULT | null {
  const pathSep = '/';
  const slash = aSrcFilePath.lastIndexOf(pathSep);
  let destPath = aSrcFilePath.slice(0, slash + 1); // GetPathWithSep()
  const fullName = aSrcFilePath.slice(slash + 1);
  const dot = fullName.lastIndexOf('.');
  let name = dot > 0 ? fullName.slice(0, dot) : fullName;
  const ext = dot > 0 ? fullName.slice(dot + 1) : '';

  if (destPath.startsWith(aProjectBasePath + pathSep)) {
    // destPath.Replace( aProjectBasePath, aNewProjectBasePath, false ): the first occurrence.
    destPath = destPath.replace(aProjectBasePath, aNewProjectBasePath);
  }

  const dest = (): string => (ext === '' ? `${destPath}${name}` : `${destPath}${name}.${ext}`);

  if (
    ext === LEGACY_SCHEMATIC_EXT ||
    ext === LEGACY_SCHEMATIC_EXT + BACKUP_SUFFIX ||
    ext === KICAD_SCHEMATIC_EXT ||
    ext === KICAD_SCHEMATIC_EXT + BACKUP_SUFFIX
  ) {
    if (name === aProjectName) {
      name = aNewProjectName;
    } else if (name === aNewProjectName) {
      if (aErrors.value !== '') aErrors.value += '\n';

      aErrors.value += `Cannot copy file '${dest()}' as it will be overwritten by the new root sheet file.`;
      return null;
    }

    const text = CopySexprFile(
      aSrcText,
      dest(),
      (token, value) => {
        if (token === 'project' && value.value === aProjectName) {
          value.value = aNewProjectName;
          return true;
        }

        return false;
      },
      aErrors,
    );

    return text === null ? null : { path: dest(), text };
  }

  if (ext === SCHEMATIC_SYMBOL_EXT) {
    // Symbols are not project-specific.  Keep their source names.
    return { path: dest(), text: null };
  }

  if (
    ext === LEGACY_SYMBOL_LIB_EXT ||
    ext === LEGACY_SYMBOL_DOC_EXT ||
    ext === KICAD_SYMBOL_LIB_EXT
  ) {
    if (name === `${aProjectName}-cache`) name = `${aNewProjectName}-cache`;

    if (name === `${aProjectName}-rescue`) name = `${aNewProjectName}-rescue`;

    return { path: dest(), text: null };
  }

  if (ext === NETLIST_EXT) {
    if (name === aProjectName) name = aNewProjectName;

    const text = CopySexprFile(
      aSrcText,
      dest(),
      (token, value) => {
        if (token === 'source') {
          for (const extension of ['.sch', '.kicad_sch']) {
            if (value.value === aProjectName + extension) {
              value.value = aNewProjectName + extension;
              return true;
            } else if (value.value === `${aProjectBasePath}/${aProjectName}${extension}`) {
              value.value = `${aNewProjectBasePath}/${aNewProjectName}${extension}`;
              return true;
            } else if (value.value.startsWith(aProjectBasePath)) {
              value.value = value.value.replace(aProjectBasePath, aNewProjectBasePath);
              return true;
            }
          }
        }

        return false;
      },
      aErrors,
    );

    return text === null ? null : { path: dest(), text };
  }

  if (name === SYMBOL_LIBRARY_TABLE_FILE) {
    const libTable = LIBRARY_TABLE.FromFile(aSrcFilePath, aSrcText, LIBRARY_TABLE_SCOPE.PROJECT);
    libTable.SetPath(dest());
    libTable.SetType(LIBRARY_TABLE_TYPE.SYMBOL);

    for (const row of libTable.Rows()) {
      let uri = row.URI();

      uri = uri.replaceAll(`/${aProjectName}-cache.lib`, `/${aNewProjectName}-cache.lib`);
      uri = uri.replaceAll(`/${aProjectName}-rescue.lib`, `/${aNewProjectName}-rescue.lib`);
      uri = uri.replaceAll(`/${aProjectName}.lib`, `/${aNewProjectName}.lib`);

      row.SetURI(uri);
    }

    return { path: dest(), text: libTable.FormatForSave() };
  }

  // wxFAIL_MSG( "Unexpected filetype for Eeschema::SaveFileAs()" )
  return null;
}
