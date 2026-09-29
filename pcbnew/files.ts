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
import { RPT_SEVERITY_ERROR, WX_STRING_REPORTER } from '@ziroeda/common/reporter.js';
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
