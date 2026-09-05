// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the drawing-sheet canvas shows for each tool.
 *
 * The last of the five editors to get one of these. `PL_DRAWING_TOOLS`'s
 * `setCursor` (`pl_drawing_tools.cpp:84-99`) is a chain rather than a table:
 *
 *     if( item )            -> KICURSOR::PLACE
 *     else if( isText )     -> KICURSOR::TEXT
 *     else if( placeImage ) -> KICURSOR::ARROW
 *     else                  -> KICURSOR::PENCIL
 *
 * — so unlike its siblings this editor's answer depends on more than the tool
 * id, and `placing` and `moveMode` are that "more". The shared actions still
 * come from the shared table; the chain below is only what is left.
 */
import { kiCursor } from '../../ui/kicursors.js';
import { sharedToolCursorName } from '../../ui/tool_cursors.js';

export interface DrawingSheetCursorState {
  /** An item is being placed — `if( item ) -> KICURSOR::PLACE`, our PENCIL arm. */
  placing: boolean;
  /**
   * A drag is in progress: `KICURSOR::MOVING` (`pl_edit_tool.cpp:158`).
   * Optional because the canvas's own flag is, and an absent one is no drag.
   */
  moveMode?: boolean;
}

export function drawingSheetToolCursor(tool: string, state: DrawingSheetCursorState): string {
  const shared = sharedToolCursorName(tool);
  if (shared) return kiCursor(shared);

  // `else if( isText )` — KiCad's own I-beam art, not the browser's `text`,
  // which is a different glyph.
  if (tool === 'dsAddText') return kiCursor('TEXT');

  // `else if( placeImage ) -> KICURSOR::ARROW` (`:91-94`).
  if (tool === 'dsAddBitmap') return 'default';

  if (state.placing) return kiCursor('PENCIL');
  if (state.moveMode) return kiCursor('MOVING');

  // `PL_SELECTION_TOOL` idles on the arrow (`pl_selection_tool.cpp:209`); the
  // crosshair is DRAWN on the canvas, not pointed with.
  return 'default';
}
