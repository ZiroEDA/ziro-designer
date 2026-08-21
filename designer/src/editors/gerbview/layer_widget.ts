// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LAYER_WIDGET`'s data — the Items page's rows and the layers' right-click
 * menu (`gerbview/widgets/gerbview_layer_widget.cpp`), named for the upstream
 * file rather than for the React component that draws them.
 *
 * A `.ts` module, not part of `LayerManager.tsx`, and the reason is a gate
 * rather than taste: `qa`'s tsconfig compiles `.ts` only, so a test importing
 * from the `.tsx` fails `pnpm -r typecheck` with "--jsx is not set" while
 * vitest itself runs green. A suite that passes locally and breaks CI is the
 * same class of problem as a test that cannot fail.
 */

import type { MenuItem } from '../../ui/menu_types.js';

export interface LayerInfo {
  index: number;
  name: string;
  color: string;
  visible: boolean;
  hasContent: boolean;
  function?: string;
}

/** One row of the Items page. */
export interface RenderRow {
  /** Empty for the separator row. */
  id: string;
  label: string;
  tooltip: string;
  /** `COLOR4D::UNSPECIFIED` renders a placeholder instead of a swatch. */
  color: string | null;
  /** `ROW::changeable` — Background is the one row that cannot be switched off. */
  changeable: boolean;
  /** `RR()`, the blank row at index 2. */
  spacer?: boolean;
}

/**
 * `GERBER_LAYER_WIDGET::ReFillRender` (`gerbview_layer_widget.cpp:117-152`),
 * verbatim — seven rows, in this order, with the separator third.
 *
 * The colours are each row's `s_defaultTheme` entry, which is what
 * `m_frame->GetVisibleElementColor( id )` resolves to on a fresh profile
 * (`:145`), so they live in `gerberColors.ts` with the rest of the table rather
 * than here.
 */
export function renderRows(colors: {
  dcodes: string;
  negativeObjects: string;
  grid: string;
  drawingSheet: string;
  pageLimits: string;
  background: string;
}): RenderRow[] {
  return [
    {
      id: 'dcodes',
      label: 'DCodes',
      tooltip: 'Show DCodes identification',
      color: colors.dcodes,
      changeable: true,
    },
    {
      id: 'negativeObjects',
      label: 'Negative Objects',
      tooltip: 'Show negative objects in this color',
      color: colors.negativeObjects,
      changeable: true,
    },
    // `RR()` — the default-constructed row, which is the spacer.
    { id: '', label: '', tooltip: '', color: null, changeable: false, spacer: true },
    {
      id: 'grid',
      label: 'Grid',
      tooltip: 'Show the (x,y) grid dots',
      color: colors.grid,
      changeable: true,
    },
    {
      id: 'drawingSheet',
      label: 'Drawing Sheet',
      tooltip: 'Show drawing sheet border and title block',
      color: colors.drawingSheet,
      changeable: true,
    },
    {
      id: 'pageLimits',
      label: 'Page Limits',
      tooltip: 'Show drawing sheet page limits',
      color: colors.pageLimits,
      changeable: true,
    },
    {
      // `RR( _( "Background" ), ..., BLACK, _( "PCB Background" ), true, false )`
      // — the last two arguments are `spacer` false and `changeable` FALSE, so
      // this row's checkbox is disabled. Note the tooltip really does say "PCB
      // Background" in GerbView (`gerbview_layer_widget.cpp:141`).
      id: 'background',
      label: 'Background',
      tooltip: 'PCB Background',
      color: colors.background,
      changeable: false,
    },
  ];
}

/**
 * `GERBER_LAYER_WIDGET::AddRightClickMenuItems`
 * (`gerbview_layer_widget.cpp:155-197`), in order, separators included.
 * "Remember: menu text is capitalized" is upstream's own comment on it.
 */
export interface LayerMenuHandlers {
  showAll: () => void;
  hideAllButActive: () => void;
  hideAll: () => void;
  /** ID_SORT_GBR_LAYERS_X2 — `GERBVIEW_FRAME::SortLayersByX2Attributes`. */
  sortByX2: () => void;
  /** ID_SORT_GBR_LAYERS_FILE_EXT — `SortLayersByFileExtension`. */
  sortByFileExtension: () => void;
  moveUp: () => void;
  moveDown: () => void;
  clearLayer: () => void;
}

export function layerContextMenu(h: LayerMenuHandlers): MenuItem[] {
  return [
    { label: 'Show All Layers', action: h.showAll },
    { label: 'Hide All Layers But Active', action: h.hideAllButActive },
    {
      // ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE drives m_alwaysShowActiveLayer,
      // which GERBER_LAYER_WIDGET keeps as state and re-applies on every layer
      // change (`gerbview_layer_widget.cpp:52`). We hold no such mode, so it is
      // greyed in its upstream position rather than left out.
      label: 'Always Hide All Layers But Active',
      disabled: true,
    },
    { label: 'Hide All Layers', action: h.hideAll },
    { sep: true },
    // ID_SORT_GBR_LAYERS_X2 / ID_SORT_GBR_LAYERS_FILE_EXT
    // (`gerbview_layer_widget.cpp:253-259`). Both reorder the image list and
    // then renumber the graphic layers to match; the comparators are ported in
    // `@ziroeda/gerbview`'s layer_sort.ts.
    { label: 'Sort Layers if X2 Mode', action: h.sortByX2 },
    { label: 'Sort Layers by File Extension', action: h.sortByFileExtension },
    { sep: true },
    // ID_SET_GBR_LAYERS_DRAW_PRMS opens DIALOG_DRAW_LAYERS_SETTINGS
    // (`gerbview/dialogs/dialog_draw_layers_settings.cpp`), which we have not
    // built.
    { label: 'Layers Display Parameters: Offset and Rotation', disabled: true },
    { sep: true },
    { label: 'Move Current Layer Up', action: h.moveUp },
    { label: 'Move Current Layer Down', action: h.moveDown },
    { label: 'Clear Current Layer...', action: h.clearLayer },
  ];
}
