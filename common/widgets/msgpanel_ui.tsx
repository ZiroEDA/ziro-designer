// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EDA_MSG_PANEL` (common/widgets/msgpanel.cpp), the strip of two-row cells
 * `EDA_DRAW_FRAME` builds once (common/eda_draw_frame.cpp:145) and every draw
 * frame instantiates. Written once here for the same reason.
 *
 * The upstream layout, which this reproduces:
 *   - one `MSG_PANEL_ITEM` per cell, packed left to right in insertion order,
 *     no columns and no separators (`updateItemPos`);
 *   - upper text on the top row, lower text on the bottom row, each exactly one
 *     control-font line high, and the panel's best height is `2 * fontSize.y`
 *     *whatever the items contain* (`DoGetBestSize`) — an item with an empty
 *     row still occupies both rows, so an empty value must be a non-breaking
 *     space here or HTML collapses the row and the panel loses height;
 *   - the first cell is inset by one 'W' width (`m_last_x = m_fontSize.x`),
 *     and cells are separated by the item's padding IN SPACES plus one 'W' —
 *     the padding spaces are appended to the text before it is measured
 *     (`:140`), so they are part of the advance and not a separate gap.
 */

import type { JSX, Ref } from 'react';
import { MSG_PANEL_DEFAULT_PAD, type MsgPanelItem } from './msgpanel_types.js';

// The panel's data types live in a `.ts` so qa's tsc can reach them; see
// msgpanel_types.ts. Re-exported so nothing that imported them here changed.
export type { MsgPanelItem } from './msgpanel_types.js';
export { MSG_PANEL_DEFAULT_PAD } from './msgpanel_types.js';

/**
 * What an empty upper/lower text renders as. `EDA_MSG_PANEL::showItem` simply
 * skips drawing an empty string and the cell keeps both of its rows; a bare
 * space in HTML collapses, so the row would lose its height.
 */
export const MSG_PANEL_EMPTY = ' ';

export function MsgPanel({
  items,
  testId,
  panelRef,
}: {
  items: readonly MsgPanelItem[];
  testId?: string;
  /**
   * The panel element, for the callers that have to MEASURE against it.
   * `KIUI::EllipsizeStatusText` takes a window and asks it for a
   * `wxClientDC` (`ui_common.cpp:211-213`), so a caller shortening a row to fit
   * needs the same window - the panel itself, in the panel's own font.
   */
  panelRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  return (
    <div className="ze-msgpanel" data-testid={testId} ref={panelRef}>
      {items.map((item, i) => (
        // Upstream keys nothing: items are positional and duplicates are legal
        // (two pads can report the same net). Index is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: MSG_PANEL_ITEMs are positional
        <div
          className="ze-msgpanel-item"
          key={`${i}:${item.upper}`}
          // The cell advances by its own width, then its padding spaces, then
          // one 'W' (msgpanel.cpp:140,151-154). The stylesheet already writes
          // the default 6; only an item that asks for another number needs to
          // say so, and it says it in the same measured units.
          style={
            item.padding === undefined || item.padding === MSG_PANEL_DEFAULT_PAD
              ? undefined
              : {
                  paddingRight: `calc(${item.padding} * var(--msgpanel-space) + var(--msgpanel-gutter))`,
                }
          }
        >
          <div className="ze-msgpanel-upper">{item.upper || MSG_PANEL_EMPTY}</div>
          <div className="ze-msgpanel-lower">{item.lower || MSG_PANEL_EMPTY}</div>
        </div>
      ))}
    </div>
  );
}
