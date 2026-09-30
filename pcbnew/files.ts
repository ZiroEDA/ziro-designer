// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/files.cpp`: the project/rules half of `PCB_EDIT_FRAME::
 * OpenProjectFiles` — loading the `.kicad_pro`'s `board.design_settings`,
 * `net_settings` and `tuning_profiles` into the live board, synchronising
 * nets and netclasses, and initialising the DRC engine on the project's
 * `.kicad_dru` (`OnBoardLoaded`). KiCad spreads `PCB_EDIT_FRAME`'s methods
 * across many `.cpp` files; we mirror that with the same `applyMixins`
 * pattern `undo_redo.ts` already uses for `PCB_BASE_EDIT_FRAME`.
 *
 * The rest of `OpenProjectFiles` — the progress dialog, `wxFileDialog`,
 * `PROF_TIMER`/`wxLogTrace` phase timing, cancellation, and the zone
 * tessellation it drives with a live progress callback — stays in
 * `pcb_edit_frame_ui.tsx`'s own load effect: that is the window/canvas half
 * (and the async cancellation semantics a paint-yielding progress dialog
 * needs), which upstream's own window-owning `PCB_EDIT_FRAME` keeps too, in
 * the same function only because C++ has no equivalent of splitting a
 * render loop from its model. `SavePcbFile`/`SavePcbCopy`/`SaveBoard`
 * (native `wxFileDialog`s, lock files, backup files, project creation) have
 * no port at all: the browser/cloud architecture replaces every one of
 * them with the `onSaveBoard` prop the host already owns.
 */
import type { RawFile } from '@ziroeda/common';
import type { JsonValue } from '@ziroeda/common/settings/json_settings.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { IMPORT_PROJ_PROPS } from '@ziroeda/common/import_proj_properties.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { KICTL_IMPORT_LIB } from '@ziroeda/common/kiway_player.js';
import type { PROGRESS_REPORTER } from '@ziroeda/common/progress_reporter.js';
import { RPT_SEVERITY_ERROR, WX_STRING_REPORTER } from '@ziroeda/common/reporter.js';
import type { APP_SETTINGS_BASE } from '@ziroeda/common/settings/app_settings.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import { FOOTPRINT_IMPORT_RECONCILER } from './footprint_import_reconciler.js';
import { findProjectDru, findProjectPrl, findProjectPro } from './pcb_edit_frame.js';
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';

/** `PCB_EDIT_FRAME`'s `files.cpp` half, mixed into that class by `pcb_edit_frame.ts`. */
export class FILES_MIXIN {
  /**
   * The project's slices into the live BOARD, as `BOARD::SetProject` binds
   * `bds.m_NetSettings` to the project file's NET_SETTINGS and
   * `PCB_EDIT_FRAME::OnBoardLoaded` initialises the DRC engine on the
   * project's `.kicad_dru`: the `.kicad_pro`'s `board.design_settings` is
   * loaded into the board's BOARD_DESIGN_SETTINGS and its `net_settings`
   * into the board's own NET_SETTINGS, the nets take their classes
   * (`SynchronizeNetsAndNetClasses`), the engine compiles the implicit
   * rules plus the custom ones and fills the clearance cache. The files
   * come from the editor's project file list, the way SETTINGS_MANAGER
   * reads them off disk.
   *
   * On a later change of those files (Board Setup's OK persists them) the
   * pads and tracks repaint with the new clearances — the caller's own
   * `boardSetupRepaint`, since that is canvas work, not this method's.
   */
  SyncProjectSettingsIntoBoard(
    this: PCB_EDIT_FRAME,
    files: readonly RawFile[],
    rootPro: string | undefined,
    aFromBoardSetup: boolean,
    /**
     * The project folder's absolute path, `/<projectName>` - where the file
     * dialogs show it and where the 3D viewer mounts its files. KiCad's
     * project is always an absolute path; KIPRJMOD and FILENAME_RESOLVER
     * need one.
     */
    aProjectDir: string,
  ): void {
    const kb = this.GetBoard();
    if (!kb) return;
    // SETTINGS_MANAGER::LoadProject + BOARD::SetProject: the `.kicad_pro` is
    // the PROJECT_FILE, and its `board.design_settings`, `net_settings` and
    // `tuning_profiles` become the board's. A changed file (Board Setup's OK
    // persists one) is a fresh load: the manager drops the old project first.
    const pro = findProjectPro(files, rootPro);
    const manager = Pgm().GetSettingsManager();
    const proName = pro?.name ?? `${rootPro ?? 'untitled'}.kicad_pro`;
    const proPath = aProjectDir === '' ? proName : `${aProjectDir}/${proName}`;
    let proJson: JsonValue | null = null;
    if (pro) {
      try {
        proJson = JSON.parse(pro.text) as JsonValue;
      } catch {
        proJson = null;
      }
    }
    const prl = findProjectPrl(files, rootPro);
    let prlJson: JsonValue | null = null;
    if (prl) {
      try {
        prlJson = JSON.parse(prl.text) as JsonValue;
      } catch {
        prlJson = null;
      }
    }
    if (manager.GetProject(proPath)) manager.UnloadProject(manager.GetProject(proPath));
    manager.LoadProject(proPath, proJson, prlJson);
    kb.SetProject(manager.Prj());
    // `SynchronizeNetsAndNetClasses( true )` after the dialog resets the
    // custom track/via sizes to the Default class; the load's own call
    // (inside InitEngine's loadImplicitRules) passes false.
    kb.SynchronizeNetsAndNetClasses(aFromBoardSetup);
    // "Initialise time domain tuning caches" (files.cpp:986), after the
    // project's profiles are in and before anything asks for a length.
    kb.SynchronizeTuningProfileProperties();
    // "Load project settings after setting up board; some of them depend on
    // the nets list" (files.cpp:906-908): only when a board is opened, not
    // when Board Setup or another session rewrote the project's files, and
    // only once the window has a canvas for them to land on.
    if (!aFromBoardSetup && this.GetCanvas()) {
      this.LoadProjectSettings();
      this.LoadDrawingSheet((aFullPath) => {
        const hit = files.find(
          (f) => aFullPath === f.name || aFullPath === `${aProjectDir}/${f.name}`,
        );

        return hit ? hit.text : null;
      });
    }
    const dru = findProjectDru(files, rootPro);
    this.OnBoardLoaded(dru?.text ?? null, dru?.name ?? '');
    // The load stops here: OnBoardLoaded's own tail (SetActiveLayer + a full
    // UpdateAllItems) is the first display sync of the board, in pcb_canvas.
  }

  /**
   * The non-KiCad arm of `PCB_EDIT_FRAME::OpenProjectFiles` (files.cpp:571-783),
   * up to `SetBoard`: find the plugin that reads the file
   * (`FindPluginTypeFromBoardPath`), load it with the page size and the import
   * properties, take the importer's cached library footprints when
   * `KICTL_IMPORT_LIB` asks for a project library, then the post-load fixes
   * that do not need the board on the frame (`m_ImportKeepKiCadLayerNames`,
   * `BuildListOfNets`).
   *
   * The caller does the rest: `SetBoard`, connectivity and the project's
   * settings (the window's load path), then `reconcileImportedFootprintLibraries`
   * with `importedLibFootprints` when `KICTL_IMPORT_LIB` is set. The board
   * keeps the editor's file name, as upstream keeps `previousBoardFileName`
   * when a non-KiCad file is opened into a project.
   *
   * The plugins are imported on demand (`pcb_io_mgr.ts`). The layer-mapping
   * dialog is not ported (DIALOG_MAP_LAYERS); every layer takes the
   * importer's automatic mapping, as `m_ImportSkipLayerMapping` does upstream.
   *
   * Throws the loader's IO_ERROR; the caller reports "Error loading PCB '%s'."
   */
  async ImportNonKicadBoard(
    this: PCB_EDIT_FRAME,
    aFileName: string,
    aData: Uint8Array,
    aCtl: number,
    aProgressReporter: PROGRESS_REPORTER | null = null,
  ): Promise<{
    board: BOARD;
    importedLibFootprints: FOOTPRINT[];
    loadMessages: string;
    customRules: string;
  }> {
    const { PCB_IO_MGR, PCB_FILE_T } = await import('./pcb_io/pcb_io_mgr.js');
    const readFile = (aPath: string): Uint8Array | null => (aPath === aFileName ? aData : null);

    const pluginType = await PCB_IO_MGR.FindPluginTypeFromBoardPath(aFileName, readFile, aCtl);

    if (pluginType === PCB_FILE_T.FILE_TYPE_NONE)
      throw new IO_ERROR('File format is not supported');

    const pi = await PCB_IO_MGR.FindPlugin(pluginType);

    // There was no plugin found, e.g. due to invalid file extension, file header,...
    if (!pi) throw new IO_ERROR('File format is not supported');

    pi.SetFileReader(readFile);

    const props = new Map<string, string>(this.m_importProperties ?? []);

    // PCB_IO_EAGLE can use this info to center the BOARD, but it does not yet.
    const pageSize = this.GetPageSizeIU();
    props.set('page_width', String(pageSize.x));
    props.set('page_height', String(pageSize.y));

    // Use loadReporter for import issues - they will be shown in the status bar
    // warning icon instead of a modal dialog
    const loadReporter = new WX_STRING_REPORTER();

    if ((this.config() as APP_SETTINGS_BASE | null)?.m_System.show_import_issues ?? true)
      pi.SetReporter(loadReporter);
    else pi.SetReporter(null);

    pi.SetProgressReporter(aProgressReporter);

    const loadedBoard = pi.LoadBoard(aFileName, null, props, null);

    // grab cached lib footprints while the plugin is alive, for reconciliation below
    const importedLibFootprints: FOOTPRINT[] = [];

    if (aCtl & KICTL_IMPORT_LIB) {
      try {
        importedLibFootprints.push(...pi.GetImportedCachedLibraryFootprints());
      } catch (e) {
        // no cached library, reconcile from placed only
        if (!(e instanceof IO_ERROR)) throw e;
      }
    }

    // converted: every plugin this is reached with is a non-KiCad one
    if (this.GetPcbNewSettings().m_ImportKeepKiCadLayerNames) {
      for (const layer of loadedBoard.GetEnabledLayers().Seq()) loadedBoard.SetLayerName(layer, '');
    }

    // we should not ask PCB_IOs to do these items:
    loadedBoard.BuildListOfNets();

    // PCB_IO_EAGLE::LoadBoard writes the class clearance matrix to a `.kicad_dru` beside the
    // board, only when it holds a rule; a plugin cannot write files here, so the caller does.
    const rules = (pi as { GetCustomRules?: () => string }).GetCustomRules?.() ?? '';

    return {
      board: loadedBoard,
      importedLibFootprints,
      loadMessages: loadReporter.GetMessages(),
      customRules: rules.includes('(rule ') ? rules : '',
    };
  }

  /**
   * `PCB_EDIT_FRAME::reconcileImportedFootprintLibraries` (files.cpp:1208-1245,
   * new in 10.0.6): after a non-KiCad board is imported, extract a project
   * footprint library and re-link the board's FPIDs, so Update PCB from
   * Schematic works. The manager pre-commits the cache nickname and the source
   * libraries in `m_importProperties`; a standalone import derives the nickname
   * from the board's file name.
   *
   * `aDefinitions` are the importer's `GetImportedCachedLibraryFootprints()`.
   * `PROJECT_PCB::FootprintLibAdapter( &Prj() )` is the adapter the host hung
   * on the board (`project_pcb.ts`). The C++ reports to
   * `KISTATUSBAR::AddWarningMessages( "load", ... )`; here that is the window's
   * `addStatusBarWarnings` hook.
   */
  reconcileImportedFootprintLibraries(
    this: PCB_EDIT_FRAME,
    aDefinitions: readonly FOOTPRINT[],
    aBoardPath: string,
  ): void {
    const adapter = this.GetBoard()?.GetFootprintLibAdapter();

    if (!adapter) return;

    // manager pre-commits the cache nickname + source libs; standalone import derives from filename
    const props = IMPORT_PROJ_PROPS.ReadFootprintProps(this.m_importProperties);
    let cacheNick = props.cacheNickname;

    if (cacheNick === '') {
      const fileName = aBoardPath.split(/[\\/]/).pop() ?? '';
      cacheNick = IMPORT_PROJ_PROPS.MakeCacheNickname(fileName.replace(/\.[^.]*$/, ''));
    }

    const reporter = new WX_STRING_REPORTER();
    const reconciler = new FOOTPRINT_IMPORT_RECONCILER(
      adapter,
      this.Prj().GetProjectPath(),
      reporter,
    );

    // reconciliation failure must not abort the import
    try {
      reconciler.Reconcile(this.GetBoard(), aDefinitions, cacheNick, props.sourceFpLibs);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      reporter.Report(
        `Could not reconcile imported footprint libraries: ${e.message}`,
        RPT_SEVERITY_ERROR,
      );
    }

    if (reporter.HasMessage()) this.hooks.addStatusBarWarnings?.('load', reporter.GetMessages());
  }
}
