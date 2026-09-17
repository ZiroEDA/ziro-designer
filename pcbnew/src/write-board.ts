// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `.kicad_pcb` writing: the editor's `Board` is a view of KiCad's own model
 * (`pcb_io/kicad_sexpr/board_view.ts`), and `PCB_IO_KICAD_SEXPR::format`
 * writes that model — the same bytes pcbnew writes for the same board. The
 * tree-patching writer that used to live here is gone with the `source`
 * nodes it patched.
 */
import { boardToBOARD } from './pcb_io/kicad_sexpr/board_view.js';
import { FormatBoard, FormatBoardAsync } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board } from './types.js';

/**
 * Serialize a board to `.kicad_pcb` text: the view's edits go back into
 * KiCad's model (`boardToBOARD`) and `format( BOARD )` writes it.
 */
export function serializeBoard(board: Board): string {
  return FormatBoard(boardToBOARD(board));
}

/**
 * `serializeBoard` without holding the thread (`FormatBoardAsync`): the
 * editor's autosave, which runs a moment after every edit on a board the
 * user is still working on. Null when `aAbort` said the board moved
 * underneath it.
 */
export function serializeBoardAsync(
  board: Board,
  aYield: () => Promise<void>,
  aAbort: () => boolean = () => false,
): Promise<string | null> {
  return FormatBoardAsync(boardToBOARD(board), aYield, aAbort);
}
