// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which `KICURSOR` each schematic tool runs with.
 *
 * This is eeschema's half of the cursor question and nothing else. Upstream it
 * is not a table at all: every tool calls
 * `m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::… )` in its own
 * `setCursor` lambda — `sch_drawing_tools.cpp`,
 * `sch_line_wire_bus_tool.cpp`, `sch_selection_tool.cpp`, `zoom_tool.cpp` —
 * and the ART those names resolve to belongs to `CURSOR_STORE`, which every
 * editor shares.
 *
 * So the art is not here. This file used to carry a second copy of KiCad's
 * cursor table, `cursors_data.ts`, re-encoded as XPM strings and rasterised
 * to a data URI in the browser; `ui/kicursors.ts` is the CURSOR_STORE, the
 * schematic canvas draws from it like every other canvas, and what is left
 * over is the mapping below — the part that really is eeschema's.
 */

import { kiCursor, type KiCursor } from '../../ui/kicursors.js';
import { sharedToolCursorName } from '../../ui/tool_cursors.js';

/**
 * Which `KICURSOR` a right-toolbar tool runs with, following the tool that
 * handles it upstream:
 *
 *  - SingleClickPlace (junction, no-connect, bus entry), KICURSOR::PLACE
 *  - PlaceSymbol / power, KICURSOR::COMPONENT
 *  - TwoClickPlace, TEXT / LABEL_NET / LABEL_GLOBAL / LABEL_HIER, and PENCIL
 *    for the rest (sheet pins, netclass flags…)
 *  - DrawShape / DrawRuleArea / DrawTable / DrawSheet, KICURSOR::PENCIL
 *  - SCH_LINE_WIRE_BUS_TOOL, LINE_WIRE / LINE_BUS / LINE_GRAPHIC
 *  - selection tools, ARROW, and the lasso its own cursor
 */
export function toolCursorName(tool: string): KiCursor {
  // The actions eeschema shares with the other editors answer once, in
  // `ui/tool_cursors.ts` — the delete tool's eraser, the zoom tool's glass.
  // Restating them here is how the board editor and this one came to disagree.
  const shared = sharedToolCursorName(tool);
  if (shared) return shared;

  switch (tool) {
    case 'select':
      return 'ARROW';
    case 'selectLasso':
      return 'SELECT_LASSO';
    case 'drawWire':
      return 'LINE_WIRE';
    case 'drawBus':
      return 'LINE_BUS';
    case 'lines':
      return 'LINE_GRAPHIC';
    case 'junction':
    case 'noConnect':
    case 'busEntry':
    case 'image':
      return 'PLACE';
    case 'placeSymbol':
    case 'placePower':
      return 'COMPONENT';
    case 'placeText':
    case 'text':
    case 'textBox':
      return 'TEXT';
    case 'placeLabel':
    // `SCH_DRAWING_TOOLS::TwoClickPlace`'s setCursor puts the net-label cursor
    // on both, and only the shapes fall through to the pencil:
    //
    //     else if( isNetLabel || isClassLabel )
    //         m_frame->GetCanvas()->SetCurrentCursor( KICURSOR::LABEL_NET );
    case 'placeClassLabel':
      return 'LABEL_NET';
    case 'placeGlobalLabel':
      return 'LABEL_GLOBAL';
    case 'placeHierLabel':
    case 'sheetPin':
      return 'LABEL_HIER';
    default:
      // Graphics, sheets, tables, rule areas and the rest of the drawing tools.
      return 'PENCIL';
  }
}

/**
 * The CSS cursor a tool shows while active — `SetCurrentCursor( KICURSOR )`
 * followed by `CURSOR_STORE::GetCursor`, which is the only path to a cursor
 * upstream and now the only one here.
 */
export function toolCursor(tool: string): string {
  return kiCursor(toolCursorName(tool));
}
