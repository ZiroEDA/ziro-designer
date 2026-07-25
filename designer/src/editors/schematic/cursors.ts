/**
 * The mouse cursor each schematic tool shows. Counterparts: `common/gal/
 * cursors.cpp` (CURSOR_STORE, the XPM/hotspot table) and the
 * `SetCurrentCursor( KICURSOR::… )` calls in `eeschema/tools/
 * sch_drawing_tools.cpp` / `sch_line_wire_bus_tool.cpp`, which decide which
 * one a tool uses.
 *
 * The bitmaps are KiCad's, painted to a canvas and handed to CSS as data-URI
 * cursors. This matters beyond looks: the GAL crosshair is drawn *on the
 * canvas*, so leaving the pointer as the browser's `crosshair` puts two
 * near-identical crosses on screen. KiCad's tool cursors are arrows and
 * pencils that read as a pointer, with the crosshair being the one that marks
 * the snapped point.
 */

import { XPM_CURSORS, type XpmCursor } from './cursors_data.js';

/** KICURSOR, restricted to the ones eeschema's tools ask for. */
export type KiCursor =
  | 'arrow'
  | 'place'
  | 'pencil'
  | 'component'
  | 'text'
  | 'labelNet'
  | 'labelGlobal'
  | 'labelHier'
  | 'lineWire'
  | 'lineBus'
  | 'lineGraphic'
  | 'selectLasso'
  | 'moving';

/** Painted cursors, keyed by name, each XPM is rasterised once. */
const cache = new Map<string, string>();

/** Paint an XPM to a data URI and wrap it as a CSS cursor value. */
function cssCursor(name: string, def: XpmCursor, fallback: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  if (typeof document === 'undefined') return fallback;
  const size = def.rows.length;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallback;
  for (let y = 0; y < size; y++) {
    const row = def.rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const colour = def.palette[row[x]!];
      if (!colour) continue; // transparent
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const [hx, hy] = def.hotspot;
  const value = `url("${canvas.toDataURL()}") ${hx} ${hy}, ${fallback}`;
  cache.set(name, value);
  return value;
}

/** The CSS cursor for a KICURSOR value. */
export function kiCursor(cursor: KiCursor): string {
  if (cursor === 'arrow') return 'default';
  if (cursor === 'moving') return 'move';
  const def = XPM_CURSORS[cursor];
  return def ? cssCursor(cursor, def, 'crosshair') : 'crosshair';
}

/**
 * Which KICURSOR a right-toolbar tool runs with, following the tool that
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
  switch (tool) {
    case 'select':
      return 'arrow';
    case 'selectLasso':
      return 'selectLasso';
    case 'drawWire':
      return 'lineWire';
    case 'drawBus':
      return 'lineBus';
    case 'lines':
      return 'lineGraphic';
    case 'junction':
    case 'noConnect':
    case 'busEntry':
    case 'image':
      return 'place';
    case 'placeSymbol':
    case 'placePower':
      return 'component';
    case 'placeText':
    case 'text':
    case 'textBox':
      return 'text';
    case 'placeLabel':
      return 'labelNet';
    case 'placeGlobalLabel':
      return 'labelGlobal';
    case 'placeHierLabel':
    case 'sheetPin':
      return 'labelHier';
    default:
      // Graphics, sheets, tables, rule areas and the rest of the drawing tools.
      return 'pencil';
  }
}

/** The CSS cursor a tool shows while active. */
export function toolCursor(tool: string): string {
  return kiCursor(toolCursorName(tool));
}
