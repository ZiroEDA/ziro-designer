// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DS_DRAW_ITEM_BASE::GetMsgPanelInfo` — `common/drawing_sheet/ds_draw_item.cpp:107-168`.
 *
 * The six rows the message panel shows while exactly one drawing-sheet item is
 * selected. Upstream this lives in `common/`, not in `pagelayout_editor/`,
 * because it hangs off the draw item rather than off the frame — so it lives in
 * `common/` here too.
 *
 * The rows are the *whole* panel, not an addition to it:
 * `EDA_DRAW_FRAME::SetMsgPanel` (`common/eda_draw_frame.cpp:955-964`) calls
 * `EraseMsgBox()` before appending, and `PL_EDITOR_CONTROL::UpdateMessagePanel`
 * (`pagelayout_editor/tools/pl_editor_control.cpp:147-179`) picks exactly one of
 * two sources every time the selection changes:
 *
 *   - one item selected  → that item's `GetMsgPanelInfo`
 *   - anything else      → `PL_EDITOR_FRAME::UpdateMsgPanelInfo`, which is Page
 *                          Width and Page Height and nothing else
 *                          (`pl_editor_frame.cpp:968-977`)
 *
 * so the page rows are never on screen at the same time as an item's rows.
 */
import { unescapeString } from '../string_utils.js';
import type { WksItem, WksItemType, WksOption } from './types.js';

/** One `MSG_PANEL_ITEM`: the small upper label and the larger lower value. */
export interface WksMsgPanelItem {
  upper: string;
  lower: string;
}

/**
 * The type row's label. Same table as `DS_DATA_ITEM::GetClassName`
 * (`ds_data_item.cpp:365-379`) — note `polygon` reads "Imported Shape", which is
 * what a `(polygon)` in a `.kicad_wks` always is: an imported DXF/SVG outline.
 */
export const WKS_ITEM_TYPE_LABEL: Record<WksItemType, string> = {
  line: 'Line',
  rect: 'Rectangle',
  text: 'Text',
  polygon: 'Imported Shape',
  bitmap: 'Image',
};

/** `DS_DATA_ITEM::GetPage1Option`'s three strings (`ds_draw_item.cpp:144-151`). */
export const WKS_PAGE1_OPTION_LABEL: Record<WksOption, string> = {
  page1only: 'First Page Only',
  notonpage1: 'Subsequent Pages',
  normal: 'All Pages',
};

/**
 * `DS_DRAW_ITEM_BASE::GetMsgPanelInfo`, in order.
 *
 * `formatMM` is the frame's `MessageTextFromValue` — a millimetre distance
 * rendered in the frame's display units *with* its unit label, because
 * `UNITS_PROVIDER::MessageTextFromValue` defaults `aAddUnitLabel` to true
 * (`include/units_provider.h:127`). That is why the panel reads
 * `(0.00 mils, 1.97 mils)` and not `(0.00, 1.97)`.
 *
 * `ellipsize` is `KIUI::EllipsizeStatusText`, which the Text row goes through
 * upstream (`ds_draw_item.cpp:132`) and which is the caller's to supply because
 * it needs a window to measure against. Omitted, only the width-independent
 * half runs - see {@link statusTextOneLine}; the row is then whole, which is
 * what it always was here and why a long `${...}` ran off the panel.
 */
export function wksItemMsgPanelInfo(
  item: WksItem,
  formatMM: (mm: number) => string,
  ellipsize: (text: string) => string = statusTextOneLine,
): WksMsgPanelItem[] {
  return [
    {
      upper: WKS_ITEM_TYPE_LABEL[item.type],
      // "Don't use GetShownText(); we want to see the variable references here"
      // (ds_draw_item.cpp:130) — the raw ${TITLE}, not its substitution.
      lower: item.type === 'text' ? ellipsize(item.text) : '',
    },
    { upper: 'First Page Option', lower: WKS_PAGE1_OPTION_LABEL[item.option] },
    // Both counts go through MessageTextFromValue( unityScale, UNSCALED, … ),
    // which adds no unit label and no decimals.
    { upper: 'Repeat Count', lower: String(item.repeat) },
    { upper: 'Repeat Label Increment', lower: String(item.incrlabel) },
    {
      upper: 'Repeat Position Increment',
      lower: `(${formatMM(item.incrx)}, ${formatMM(item.incry)})`,
    },
    { upper: 'Comment', lower: item.comment },
  ];
}

/**
 * `KIUI::EllipsizeStatusText`'s width-INDEPENDENT half (`ui_common.cpp:203-210`):
 *
 *     wxString msg = UnescapeString( aString );
 *     msg.Replace( "\n", " " ); msg.Replace( "\r", " " ); msg.Replace( "\t", " " );
 *
 * A message panel row is one line, so a text carrying a newline has to be
 * flattened before anything measures it - and that much needs no window, which
 * is why it is the default when no measured ellipsizer is supplied.
 */
export function statusTextOneLine(text: string): string {
  return unescapeString(text).replace(/[\n\r\t]/g, ' ');
}

/**
 * The pixel budget `EllipsizeStatusText` gives the text, from the window's own
 * width (`ui_common.cpp:212-216`):
 *
 *     // 30% of the first 800 pixels plus 60% of the remaining width
 *     int textWidth = std::min( statusWidth, 800 ) * 0.3
 *                     + std::max( statusWidth - 800, 0 ) * 0.6;
 *
 * [data] the two percentages and the 800 are KiCad's own, written in that
 * comment beside the line.
 */
export function statusTextWidth(windowWidth: number): number {
  return Math.min(windowWidth, 800) * 0.3 + Math.max(windowWidth - 800, 0) * 0.6;
}

/**
 * `wxControl::Ellipsize( …, wxELLIPSIZE_END, … )`: the string, or as much of it
 * as fits followed by an ellipsis.
 *
 * `measure` is the caller's `wxClientDC::GetTextExtent` - the browser's own
 * text measurement, so the answer is the one the panel will actually draw with
 * rather than a character count standing in for it.
 */
export function ellipsizeStatusText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  const msg = statusTextOneLine(text);

  if (maxWidth <= 0 || measure(msg) <= maxWidth) return msg;

  // wx replaces the trailing characters with the ellipsis until what is left
  // fits, so the ellipsis is INSIDE the budget rather than added past it.
  const ELLIPSIS = '...';
  let keep = msg.length;

  while (keep > 0 && measure(msg.slice(0, keep) + ELLIPSIS) > maxWidth) keep--;

  return msg.slice(0, keep) + ELLIPSIS;
}
