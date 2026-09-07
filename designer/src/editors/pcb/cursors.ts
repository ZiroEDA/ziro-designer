// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which cursor the board editor's canvas shows, as a function rather than a
 * ternary buried in the JSX — the shape `editors/schematic/cursors.ts` already
 * had, and the reason it is worth copying: a decision inside a component can
 * only be checked by rendering it, so in practice it was not checked at all.
 * The board editor lost the delete tool's eraser that way.
 */
import { kiCursor } from '../../ui/kicursors.js';
import { toolCursorCss } from '../../ui/tool_cursors.js';

/** What the board canvas needs to know beyond the tool id. */
export interface BoardCursorState {
  /**
   * A table's first corner has been clicked and the second is being dragged.
   *
   * `DRAWING_TOOL::DrawTable`'s `setCursor` is a two-arm chain rather than one
   * answer (`drawing_tool.cpp:1203-1210`):
   *
   *     if( table ) SetCurrentCursor( KICURSOR::MOVING );
   *     else        SetCurrentCursor( KICURSOR::PENCIL );
   *
   * so the tool id alone cannot answer for it — the same reason
   * `editors/drawingsheet/cursors.ts` takes a state.
   */
  tableDragging?: boolean;
}

/**
 * `ui/tool_cursors.ts` answers for every action another editor also has; what
 * is left here is this frame's own.
 *
 * `BOARD_INSPECTION_TOOL::LocalRatsnestTool` runs a picker that sets no cursor
 * of its own, so it keeps the crosshair; everything unarmed is the plain arrow.
 */
export const boardToolCursor = (tool: string, state: BoardCursorState = {}): string => {
  // The one tool whose cursor changes partway through the gesture. Checked
  // before the shared table, which holds its idle answer.
  if (tool === 'drawTable' && state.tableDragging) return kiCursor('MOVING');
  return toolCursorCss(tool, tool === 'localRatsnestTool' ? 'crosshair' : 'default');
};
