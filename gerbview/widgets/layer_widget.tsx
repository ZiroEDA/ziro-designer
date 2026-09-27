// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Layers manager, `GERBER_LAYER_WIDGET` over `LAYER_WIDGET`
 * (`gerbview/widgets/layer_widget.cpp`, `gerbview/widgets/gerbview_layer_widget.cpp`).
 *
 * It is a **wxNotebook with two pages** — `_( "Layers" )` and `_( "Items" )`
 * (`layer_widget.cpp:505,537,559`; the titles are set for GerbView at
 * `gerbview_layer_widget.cpp:78-81`). Ours drew both lists stacked one above
 * the other under uppercase headers, so the Items list permanently ate the
 * bottom of the pane and there were no tabs at all.
 *
 * Each page is a `wxScrolledWindow` holding a `wxFlexGridSizer`:
 *
 *   Layers  5 columns (`LYR_COLUMN_COUNT`), growable col 3 (`:522-527`)
 *   Items   2 columns (`RND_COLUMN_COUNT`) (`:547`)
 *
 * The five layer columns are fixed by `layer_widget.h:51-55` and built in
 * `insertLayerRow` (`:318-371`):
 *
 *   0 COLUMN_ICON_ACTIVE      INDICATOR_ICON, ON for the active layer
 *   1 COLUMN_COLORBM          COLOR_SWATCH, SWATCH_SMALL
 *   2 COLUMN_COLOR_LYR_CB     wxCheckBox, no label — visibility
 *   3 COLUMN_COLOR_LYRNAME    WX_ELLIPSIZED_STATIC_TEXT, wxST_ELLIPSIZE_MIDDLE
 *   4 COLUMN_ALPHA_INDICATOR  a second INDICATOR_ICON
 *
 * There are **no per-row buttons**. Ours had four emoji apiece — 👁 to hide, ▲▼
 * to reorder, ✕ to delete — and two more in the header. Every one of those
 * commands is a right-click menu item upstream
 * (`gerbview_layer_widget.cpp:157-197`), which is what `onRightDownLayers`
 * pops up, and none of them is a glyph KiCad draws anywhere.
 */

import { useState, type JSX } from 'react';
import { ContextMenu } from '@ziroeda/common/tool/action_menu_bar.js';
import {
  type GERBER_LAYER_WIDGET_ID,
  layerContextMenu,
  type LayerInfo,
  type RenderRow,
} from './gerbview_layer_widget.js';
import { ColorSwatch } from '@ziroeda/common/widgets/color_swatch.js';
import { parseColor4d, toCssColor } from '@ziroeda/common/color4d.js';

export type { LayerInfo, RenderRow } from './gerbview_layer_widget.js';
export { renderRows, layerContextMenu } from './gerbview_layer_widget.js';

export function LayerManager({
  layers,
  activeLayer,
  onSetActive,
  onToggleVisible,
  onSetColor,
  onPopupSelection,
  renderToggles,
  onRenderToggle,
  rows,
}: {
  layers: LayerInfo[];
  activeLayer: number;
  onSetActive: (index: number) => void;
  onToggleVisible: (index: number) => void;
  onSetColor: (index: number, color: string) => void;
  /** `GERBER_LAYER_WIDGET::onPopupSelection`, which every menu row lands in. */
  onPopupSelection: (aId: GERBER_LAYER_WIDGET_ID) => void;
  renderToggles: Record<string, boolean>;
  onRenderToggle: (id: string) => void;
  rows: RenderRow[];
}): JSX.Element {
  const [page, setPage] = useState<'layers' | 'items'>('layers');
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const menu = layerContextMenu(onPopupSelection);

  return (
    <div className="ze-gbr-layers">
      {/* wxNotebook, wxNB_TOP (`layer_widget.cpp:505`). The page titles are set
          for GerbView in SetLayersManagerTabsText (`gerbview_layer_widget.cpp:78-81`). */}
      <div className="ze-nb-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={page === 'layers'}
          className={page === 'layers' ? 'active' : ''}
          onClick={() => setPage('layers')}
        >
          Layers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={page === 'items'}
          className={page === 'items' ? 'active' : ''}
          onClick={() => setPage('items')}
        >
          Items
        </button>
      </div>

      {page === 'layers' && (
        <div
          className="ze-gbr-layer-list"
          onContextMenu={(e) => {
            // `m_LayerScrolledWindow->Connect( wxEVT_RIGHT_DOWN, ... onRightDownLayers )`
            // (`gerbview_layer_widget.cpp:60-62`).
            e.preventDefault();
            setMenuAt({ x: e.clientX, y: e.clientY });
          }}
        >
          {layers.map((layer) => (
            <div
              key={layer.index}
              className={`ze-gbr-layer-row${layer.index === activeLayer ? ' active' : ''}`}
              onClick={() => onSetActive(layer.index)}
              title={layer.function ? `${layer.name}, ${layer.function}` : layer.name}
            >
              {/* col 0, COLUMN_ICON_ACTIVE */}
              <span
                className={`ze-layer-indicator${layer.index === activeLayer ? ' on' : ''}`}
                aria-hidden="true"
              />
              {/* col 1, COLUMN_COLORBM: a COLOR_SWATCH (color_swatch.cpp:301-328)
                  whose left-down is also the row's (layer_widget.cpp:339), so
                  the click is left to bubble. */}
              <ColorSwatch
                size="small"
                label={`Set color for ${layer.name}`}
                color={parseColor4d(layer.color)}
                onChange={(picked) => onSetColor(layer.index, toCssColor(picked, ', '))}
              />
              {/* col 2, COLUMN_COLOR_LYR_CB — an unlabelled checkbox. */}
              <input
                type="checkbox"
                checked={layer.visible}
                title="Enable this for visibility"
                aria-label={`${layer.name} visible`}
                onChange={() => onToggleVisible(layer.index)}
                onClick={(e) => e.stopPropagation()}
              />
              {/* col 3, COLUMN_COLOR_LYRNAME — ellipsized, and the growable one. */}
              <span className="ze-gbr-name ze-ellipsis">{layer.name}</span>
              {/* col 4, COLUMN_ALPHA_INDICATOR. GerbView never lights this: it
                  is created STATE::OFF (`layer_widget.cpp:367-370`) and nothing
                  in GerbView sets it. It stays so the grid keeps five columns. */}
              <span className="ze-layer-indicator" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      {page === 'items' && (
        <div className="ze-gbr-render-list">
          {rows.map((r, i) =>
            r.spacer ? (
              // `RR()` — a blank row that keeps the grid full
              // (`layer_widget.cpp:461-474`).
              <div key={`sp${i}`} className="ze-gbr-render-row spacer" aria-hidden="true" />
            ) : (
              <label key={r.id} className="ze-gbr-render-row" title={r.tooltip}>
                {r.color === null ? (
                  <span className="ze-layer-swatch blank" />
                ) : (
                  <span className="ze-layer-swatch" style={{ background: r.color }} />
                )}
                <input
                  type="checkbox"
                  checked={renderToggles[r.id] ?? false}
                  disabled={!r.changeable}
                  onChange={() => onRenderToggle(r.id)}
                />
                {r.label}
              </label>
            ),
          )}
        </div>
      )}

      {menuAt && (
        <ContextMenu items={menu} x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)} />
      )}
    </div>
  );
}

/**
 * `LAYER_WIDGET::GetBestSize` + `GERBVIEW_FRAME::ReFillLayerWidget`, the reason
 * KiCad's layers pane changes width when you open a set of gerbers.
 *
 *     wxSize LAYER_WIDGET::GetBestSize() const
 *     {
 *         wxArrayInt widths = m_LayersFlexGridSizer->GetColWidths();
 *         int totWidth = 0;
 *         for( ... ) totWidth += widths[i];
 *         totWidth += 15;             // "Account for the parent's frame"
 *         ...                         // same again for the Render tab
 *         return wxSize( max( renderz.x, layerz.x ), ... );
 *     }                                        gerbview/widgets/layer_widget.cpp:582
 *
 *     wxSize bestz = m_LayersManager->GetBestSize();
 *     bestz.x += 5;                   // "gives a little margin"
 *     lyrs.MinSize( bestz );
 *     lyrs.BestSize( bestz );
 *     lyrs.FloatingSize( bestz );     gerbview/gerbview_frame.cpp:381-387
 *
 * So the pane is exactly as wide as its widest row plus 20 px of chrome, and
 * **there is no cap on the pane**. The cap Akshay suspected is real but it is
 * on the *name*, one level down in `GERBER_FILE_IMAGE_LIST::GetDisplayName`:
 *
 *     const int maxlen = 30;
 *     if( !aFullName && filename.Length() > maxlen )
 *         filename = filename.Left( 2 ) + "..." + filename.Right( maxlen - 5 );
 *                                    gerbview/gerber_file_image_list.cpp:146-151
 *
 * and the floor is a string too: every row's label is a wxStaticText with
 * `SetMinimumStringLength( m_smallestLayerString )` (`layer_widget.cpp:364`),
 * which GerbView sets to the display name of a layer one past the last -
 * "Graphic layer <max+1>" (`gerbview_frame.cpp:146-148`).
 *
 * Note `MinSize` is set to the same value, so once files are loaded the pane
 * cannot be dragged narrower than its own content - the FromDIP( 80 ) floor
 * applies only to the empty pane.
 *
 * Pure, and in `.ts`, so the arithmetic can be pinned without a DOM: the widths
 * come from the caller, which measures them against the real row font.
 */
export function layersPaneWidth(
  nameWidths: readonly number[],
  smallestNameWidth: number,
  chromeWidth: number,
): number {
  const widest = nameWidths.reduce((a, b) => Math.max(a, b), smallestNameWidth);
  // 15 for the parent's frame, then ReFillLayerWidget's 5 of margin.
  return Math.ceil(widest + chromeWidth + 15 + 5);
}
