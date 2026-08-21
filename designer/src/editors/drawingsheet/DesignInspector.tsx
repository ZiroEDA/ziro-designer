// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Design Inspector dialog, the web counterpart of `pl_editor`'s
 * DIALOG_INSPECTOR (pagelayout_editor/dialogs/design_inspector.cpp): a wxGrid
 * of every item in the sheet with a leading root "Layout" row describing the
 * page.
 *
 * What the grid *contains* is `design_inspector.ts`; this file draws it.
 * Clicking a row selects that item on the canvas and leaves the dialog open.
 */

import type { JSX } from 'react';
import type { WksItem } from '@ziroeda/common';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { DS_INSPECTOR_COLUMNS, dsInspectorRows } from './design_inspector.js';
import {
  DS_ICON_ROOT,
  DS_INSPECTOR_BITMAP_SIZE,
  DS_INSPECTOR_ICON,
  DS_INSPECTOR_ICON_OFFSET,
  DS_INSPECTOR_ICON_PX,
  xpmRuns,
  type XpmIcon,
} from './inspector_icons.js';

/** The row's icon, by item type — `ReCreateDesignList`'s switch (:243-263). */
const iconFor = (item: WksItem | undefined): XpmIcon | undefined =>
  item ? DS_INSPECTOR_ICON[item.type] : undefined;

/**
 * One XPM, drawn at its native 12 x 12 with square pixels.
 *
 * `shapeRendering="crispEdges"` because these are bitmaps, not vectors: a
 * wxBitmap blit does not antialias, and letting the browser smooth a 12 px
 * glyph is the difference between KiCad's icon and a blurry approximation of it.
 */
function XpmBitmap({ icon }: { icon: XpmIcon | undefined }): JSX.Element | null {
  if (!icon) return null;
  return (
    <svg
      width={DS_INSPECTOR_ICON_PX}
      height={DS_INSPECTOR_ICON_PX}
      viewBox={`0 0 ${DS_INSPECTOR_ICON_PX} ${DS_INSPECTOR_ICON_PX}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'block', marginLeft: DS_INSPECTOR_ICON_OFFSET.x, marginTop: DS_INSPECTOR_ICON_OFFSET.y }}
    >
      {xpmRuns(icon).map(([x, y, w]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={1} fill={icon.color} />
      ))}
    </svg>
  );
}

export function DesignInspector({
  items,
  selection,
  title,
  paperType,
  pageMM,
  onSelect,
  onClose,
}: {
  items: WksItem[];
  selection: ReadonlySet<number>;
  /**
   * `SetTitle( fn.GetName() )` (design_inspector.cpp:216-221) — already
   * resolved by the caller through `dsInspectorTitle`, so a sheet that has
   * never been saved reads `<default drawing sheet>`.
   */
  title: string;
  /** `PAGE_INFO::GetTypeAsString()` — the page type NAME, e.g. `A3`. */
  paperType: string;
  /** `PL_EDITOR_FRAME::GetPageSizeIU`, in millimetres. */
  pageMM: readonly [number, number];
  onSelect: (index: number) => void;
  onClose: () => void;
}): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const rows = dsInspectorRows(items, paperType, pageMM);

  /**
   * The grid itself is the SHARED WX_GRID skin, `.ze-grid` in ui/shell.css -
   * the same one the Schematic Setup panels use, because this dialog holds the
   * same widget (a wxGrid) and KiCad gives every wxGrid one look. It used to
   * carry its own: `4px 8px` cells under a `rgba(128,128,128,0.2)` rule, a
   * header on an undeclared `--panel` token, and a blue selection wash that
   * exists nowhere in KiCad. Nothing about how it LOOKS is stated here now.
   */
  /** COL_BITMAP's minimum width, `BITMAP_SIZE * 2` (design_inspector.cpp:303-304). */
  const bitmapCell: React.CSSProperties = {
    minWidth: DS_INSPECTOR_BITMAP_SIZE * 2,
    width: DS_INSPECTOR_BITMAP_SIZE * 2,
    padding: 0,
  };
  /** wxGrid's row-label gutter: SetRowLabelSize( 40 ), centred. [data] */
  const gutter: React.CSSProperties = {
    width: 40,
    textAlign: 'center',
    opacity: 0.7,
    userSelect: 'none',
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 720, maxWidth: '92vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          {title}
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }} data-testid="ds-inspector">
          <table className="ze-grid">
            <thead>
              {/* Sticky is the only thing this header adds to .ze-grid th: the
                  dialog scrolls its own body, so the column labels have to hold
                  station the way a wxGrid's do. */}
              <tr style={{ position: 'sticky', top: 0 }}>
                {/* The gutter carries no column label of its own. */}
                <th style={gutter} />
                {DS_INSPECTOR_COLUMNS.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.number}
                  className={
                    row.itemIndex !== null && selection.has(row.itemIndex) ? 'selected' : undefined
                  }
                  style={{ cursor: 'default' }}
                  // DIALOG_INSPECTOR::onCellClicked
                  // (design_inspector.cpp:338-354) selects the row, selects the
                  // item in the editor and repopulates the properties frame.
                  // It does NOT end the dialog: you walk the list row by row
                  // with it open, watching the canvas behind it.
                  //
                  // The root row is `m_itemsList[0] == nullptr` (:238), and
                  // onCellClicked returns early on it.
                  onClick={() => {
                    if (row.itemIndex !== null) onSelect(row.itemIndex);
                  }}
                >
                  <td className="ze-grid-text" style={gutter}>
                    {row.number}
                  </td>
                  {/* COL_BITMAP. `BitmapGridCellRenderer::Draw`
                      (design_inspector.cpp:359-366) blits the row's 12 x 12 XPM
                      at +5, +2 inside the cell. The table is
                      `inspector_icons.ts`, mirrored from the C++. */}
                  <td className="ze-grid-text" style={bitmapCell}>
                    <XpmBitmap
                      icon={row.itemIndex === null ? DS_ICON_ROOT : iconFor(items[row.itemIndex])}
                    />
                  </td>
                  <td className="ze-grid-text">{row.type}</td>
                  <td className="ze-grid-text">{row.count}</td>
                  <td className="ze-grid-text">{row.comment}</td>
                  <td
                    className="ze-grid-text"
                    style={{
                      whiteSpace: 'nowrap',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {row.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          {/* m_sdbSizer holds exactly one button, wxID_CANCEL
              (dialog_design_inspector_base.cpp:60-63). */}
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
