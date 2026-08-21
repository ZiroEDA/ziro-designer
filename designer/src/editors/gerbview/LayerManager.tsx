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

import { useRef, useState, type JSX } from 'react';
import { ContextMenu } from '../../ui/MenuBar.js';
import { layerContextMenu, type LayerInfo, type RenderRow } from './layer_widget.js';

export type { LayerInfo, RenderRow } from './layer_widget.js';
export { renderRows, layerContextMenu } from './layer_widget.js';

export function LayerManager({
  layers,
  activeLayer,
  onSetActive,
  onToggleVisible,
  onSetColor,
  onShowAll,
  onHideAll,
  onHideAllButActive,
  onDelete,
  onMoveUp,
  onMoveDown,
  renderToggles,
  onRenderToggle,
  onSortByX2,
  onSortByFileExtension,
  rows,
}: {
  layers: LayerInfo[];
  activeLayer: number;
  onSetActive: (index: number) => void;
  onToggleVisible: (index: number) => void;
  onSetColor: (index: number, color: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onHideAllButActive: () => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  renderToggles: Record<string, boolean>;
  onRenderToggle: (id: string) => void;
  onSortByX2: () => void;
  onSortByFileExtension: () => void;
  rows: RenderRow[];
}): JSX.Element {
  const [page, setPage] = useState<'layers' | 'items'>('layers');
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const colorInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const menu = layerContextMenu({
    showAll: onShowAll,
    hideAllButActive: onHideAllButActive,
    hideAll: onHideAll,
    sortByX2: onSortByX2,
    sortByFileExtension: onSortByFileExtension,
    moveUp: () => onMoveUp(activeLayer),
    moveDown: () => onMoveDown(activeLayer),
    clearLayer: () => onDelete(activeLayer),
  });

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
              {/* col 1, COLUMN_COLORBM */}
              <button
                type="button"
                className="ze-layer-swatch picker"
                style={{ background: layer.color }}
                title="Left double click or middle click for color change, right click for menu"
                onClick={(e) => {
                  e.stopPropagation();
                  colorInputs.current[layer.index]?.click();
                }}
              >
                <input
                  ref={(el) => {
                    colorInputs.current[layer.index] = el;
                  }}
                  type="color"
                  value={layer.color}
                  onChange={(e) => onSetColor(layer.index, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              </button>
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
