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
