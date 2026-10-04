// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/initpcb.cpp`: `PCB_EDIT_FRAME::Clear_Pcb`. Upstream this also
 * confirms with the user, releases the lock file, swaps in a fresh `BOARD`
 * with default layers, and repaints the toolbars and appearance panel — the
 * window half, which the React component (`pcb_edit_frame_ui.tsx`) already
 * does its own way around `SetBoard`/`setBoard`. This mixin is the part
 * that outlives the window: the undo and redo lists go because the board is
 * about to be replaced whole.
 *
 * `INITPCB_MIXIN` is the same `applyMixins` pattern `undo_redo.ts` already
 * uses for `PCB_BASE_EDIT_FRAME`: each method takes an explicit
 * `this: PCB_EDIT_FRAME` parameter, so it type-checks with full access to
 * the class (and its ancestors'), and `pcb_edit_frame.ts` merges it in with
 * `applyMixins`/`interface … extends INITPCB_MIXIN`.
 */
import { RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { BOARD, BOARD_USE } from './board.js';
import { PCB_DRC_CODE as DRCE } from './drc/drc_item.js';
import type { FOOTPRINT_EDIT_FRAME } from './footprint_edit_frame.js';
import type { PCB_EDIT_FRAME } from './pcb_edit_frame.js';

/** `PCB_EDIT_FRAME`'s `initpcb.cpp` half, mixed into that class by `pcb_edit_frame.ts`. */
export class INITPCB_MIXIN {
  /**
   * `PCB_EDIT_FRAME::Clear_Pcb`, the part that outlives the window: the undo
   * and redo lists go because the board is about to be replaced whole.
   */
  Clear_Pcb(this: PCB_EDIT_FRAME): void {
    // Clear undo and redo lists because we want a full deletion
    this.ClearUndoRedoList();
  }
}

/** `FOOTPRINT_EDIT_FRAME`'s `initpcb.cpp` half, mixed into that class by `footprint_edit_frame.ts`. */
export class FOOTPRINT_EDIT_FRAME_INITPCB_MIXIN {
  /**
   * `FOOTPRINT_EDIT_FRAME::Clear_Pcb` (initpcb.cpp:108-175): an empty
   * footprint-holder board, after offering to save the edited footprint.
   *
   * @return false when the user cancelled.
   */
  async Clear_Pcb(this: FOOTPRINT_EDIT_FRAME, doAskAboutUnsavedChanges: boolean): Promise<boolean> {
    if (this.GetBoard() === null) return false;

    if (doAskAboutUnsavedChanges && this.IsContentModified()) {
      const answer =
        (await this.hooks.askUnsavedChanges?.(
          'The current footprint has been modified.  Save changes?',
        )) ?? 'discard';

      if (answer === 'cancel') return false;

      if (answer === 'save' && !(await this.SaveFootprint(this.GetBoard()!.Footprints()[0]!)))
        return false;
    }

    // Clear undo and redo lists because we want a full deletion
    this.ClearUndoRedoList();
    this.GetScreen()?.SetContentModified(false);

    // Clear the view so we don't attempt redraws
    this.GetCanvas()?.GetView().Clear();

    const board = new BOARD();
    // `SetBoard( new BOARD() )` then `GetBoard()->SetProject( &Prj() )`: the
    // project's libraries reach the new board.
    board.SetFootprintLibAdapter(this.FootprintLibAdapter());
    this.SetBoard(board);

    // Not ported: `GetBoard()->GetDesignSettings() = cfg->m_DesignSettings` —
    // fpedit.json's design settings are not a BOARD_DESIGN_SETTINGS here.
    board.SynchronizeNetsAndNetClasses(true);

    // This board will only be used to hold a footprint for editing
    board.SetBoardUse(BOARD_USE.FPHOLDER);

    // Setup our own severities for the Footprint Checker.
    // These are not (at present) user-editable.
    const drcSeverities = board.GetDesignSettings().m_DRCSeverities;

    for (let errorCode = DRCE.DRCE_FIRST; errorCode <= DRCE.DRCE_LAST; ++errorCode)
      drcSeverities.set(errorCode, RPT_SEVERITY_ERROR);

    drcSeverities.set(DRCE.DRCE_DRILLED_HOLES_COLOCATED, RPT_SEVERITY_WARNING);
    drcSeverities.set(DRCE.DRCE_DRILLED_HOLES_TOO_CLOSE, RPT_SEVERITY_WARNING);

    drcSeverities.set(DRCE.DRCE_PADSTACK, RPT_SEVERITY_WARNING);

    drcSeverities.set(DRCE.DRCE_FOOTPRINT_TYPE_MISMATCH, RPT_SEVERITY_WARNING);

    // clear filename, to avoid overwriting an old file
    board.SetFileName('');

    this.GetScreen()?.InitDataPoints(this.GetPageSizeIU());

    return true;
  }
}
