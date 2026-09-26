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

import { LSET } from '@ziroeda/common/lset.js';
import type { MenuItem } from '@ziroeda/common/tool/action_menu_types.js';
import type { TOOL_ACTION } from '@ziroeda/common/tool/tool_action.js';
import { GERBVIEW_ACTIONS } from '../tools/gerbview_actions.js';

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
 * (`gerbview_layer_widget.cpp:155-197`), in order, separators included, each
 * row carrying its id to {@link GERBER_LAYER_WIDGET.onPopupSelection}, as
 * every row upstream lands in the one `onPopupSelection` handler.
 * "Remember: menu text is capitalized" is upstream's own comment on it.
 */
export function layerContextMenu(aSelect: (aId: GERBER_LAYER_WIDGET_ID) => void): MenuItem[] {
  const row = (aLabel: string, aId: GERBER_LAYER_WIDGET_ID): MenuItem => ({
    label: aLabel,
    action: () => aSelect(aId),
  });

  return [
    row('Show All Layers', GERBER_LAYER_WIDGET_ID.ID_SHOW_ALL_LAYERS),
    row('Hide All Layers But Active', GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS_BUT_ACTIVE),
    row(
      'Always Hide All Layers But Active',
      GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE,
    ),
    row('Hide All Layers', GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS),
    { sep: true },
    row('Sort Layers if X2 Mode', GERBER_LAYER_WIDGET_ID.ID_SORT_GBR_LAYERS_X2),
    row('Sort Layers by File Extension', GERBER_LAYER_WIDGET_ID.ID_SORT_GBR_LAYERS_FILE_EXT),
    { sep: true },
    row(
      'Layers Display Parameters: Offset and Rotation',
      GERBER_LAYER_WIDGET_ID.ID_SET_GBR_LAYERS_DRAW_PRMS,
    ),
    { sep: true },
    row('Move Current Layer Up', GERBER_LAYER_WIDGET_ID.ID_LAYER_MOVE_UP),
    row('Move Current Layer Down', GERBER_LAYER_WIDGET_ID.ID_LAYER_MOVE_DOWN),
    row('Clear Current Layer...', GERBER_LAYER_WIDGET_ID.ID_LAYER_DELETE),
  ];
}

/**
 * `GERBER_LAYER_WIDGET`'s popup ids (`gerbview_layer_widget.h:97-110`).
 * Their values are ours; only the identity matters.
 */
export enum GERBER_LAYER_WIDGET_ID {
  ID_SHOW_ALL_LAYERS,
  ID_SHOW_NO_LAYERS,
  ID_SHOW_NO_LAYERS_BUT_ACTIVE,
  ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE,
  ID_SORT_GBR_LAYERS_X2,
  ID_SORT_GBR_LAYERS_FILE_EXT,
  ID_SET_GBR_LAYERS_DRAW_PRMS,
  ID_LAYER_MOVE_UP,
  ID_LAYER_MOVE_DOWN,
  ID_LAYER_DELETE,
}

/** What `GERBER_LAYER_WIDGET` asks of `GERBVIEW_FRAME`. */
export interface GERBER_LAYER_WIDGET_FRAME {
  GetActiveLayer(): number;
  GetImagesList(): { ImagesMaxCount(): number; GetGbrImage(aIdx: number): unknown | null };
  SetVisibleLayers(aLayerMask: LSET): void;
  GetCanvas(): { Refresh(): void } | null;
  SortLayersByX2Attributes(): void;
  SortLayersByFileExtension(): void;
  SetLayerDrawPrms(): unknown;
  Erase_Current_DrawLayer(query: boolean): unknown;
  GetToolManager(): { RunAction(aAction: TOOL_ACTION): unknown } | null;
}

/**
 * `GERBER_LAYER_WIDGET` (`gerbview/widgets/gerbview_layer_widget.cpp`), the
 * engine half: the "always show the active layer" mode and the popup menu's
 * dispatch. The rows and their drawing are `layer_widget.tsx`'s.
 */
export class GERBER_LAYER_WIDGET {
  private readonly m_frame: GERBER_LAYER_WIDGET_FRAME;
  /** `m_alwaysShowActiveLayer`: ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE's mode. */
  private m_alwaysShowActiveLayer = false;

  constructor(aParent: GERBER_LAYER_WIDGET_FRAME) {
    this.m_frame = aParent;
    this.m_alwaysShowActiveLayer = false;
  }

  /** Whether the "always" mode is on. */
  IsAlwaysShowActiveLayer(): boolean {
    return this.m_alwaysShowActiveLayer;
  }

  /**
   * The layer ids of the rows, in row order: `ReFill` makes one per image in
   * the list and skips an empty slot (`:299-303`).
   */
  GetLayerRows(): number[] {
    const rows: number[] = [];
    const images = this.m_frame.GetImagesList();

    for (let layer = 0; layer < images.ImagesMaxCount(); ++layer) {
      if (images.GetGbrImage(layer) !== null) rows.push(layer);
    }

    return rows;
  }

  onPopupSelection(menuId: GERBER_LAYER_WIDGET_ID): void {
    const visible = menuId === GERBER_LAYER_WIDGET_ID.ID_SHOW_ALL_LAYERS;

    switch (menuId) {
      case GERBER_LAYER_WIDGET_ID.ID_SHOW_ALL_LAYERS:
      case GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS:
      case GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE:
      case GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS_BUT_ACTIVE: {
        // Set the display layers options. Sorting layers has no effect to these options
        this.m_alwaysShowActiveLayer =
          menuId === GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE;
        const force_active_layer_visible =
          menuId === GERBER_LAYER_WIDGET_ID.ID_SHOW_NO_LAYERS_BUT_ACTIVE ||
          menuId === GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE;

        // `LSET visibleLayers;`: every layer without a row stays false.
        const visibleLayers = new LSET();

        // Update icons and check boxes
        for (const layer of this.GetLayerRows()) {
          let loc_visible = visible;

          if (force_active_layer_visible && layer === this.m_frame.GetActiveLayer())
            loc_visible = true;

          visibleLayers.set(layer, loc_visible);
        }

        this.m_frame.SetVisibleLayers(visibleLayers);
        this.m_frame.GetCanvas()?.Refresh();
        break;
      }

      case GERBER_LAYER_WIDGET_ID.ID_SORT_GBR_LAYERS_X2:
        this.m_frame.SortLayersByX2Attributes();
        break;

      case GERBER_LAYER_WIDGET_ID.ID_SORT_GBR_LAYERS_FILE_EXT:
        this.m_frame.SortLayersByFileExtension();
        break;

      case GERBER_LAYER_WIDGET_ID.ID_SET_GBR_LAYERS_DRAW_PRMS:
        void this.m_frame.SetLayerDrawPrms();
        break;

      case GERBER_LAYER_WIDGET_ID.ID_LAYER_MOVE_UP:
        this.m_frame.GetToolManager()?.RunAction(GERBVIEW_ACTIONS.moveLayerUp);
        break;

      case GERBER_LAYER_WIDGET_ID.ID_LAYER_MOVE_DOWN:
        this.m_frame.GetToolManager()?.RunAction(GERBVIEW_ACTIONS.moveLayerDown);
        break;

      case GERBER_LAYER_WIDGET_ID.ID_LAYER_DELETE:
        // No query: the menu row is its own confirmation (`:273-275`).
        void this.m_frame.Erase_Current_DrawLayer(false);
        break;
    }
  }

  /**
   * `OnLayerSelected` (`:280-290`): in the "always" mode, re-apply it so the
   * newly active layer is the one shown.
   */
  OnLayerSelected(): boolean {
    if (!this.m_alwaysShowActiveLayer) return false;

    // postprocess after active layer selection ensure active layer visible
    this.onPopupSelection(GERBER_LAYER_WIDGET_ID.ID_ALWAYS_SHOW_NO_LAYERS_BUT_ACTIVE);
    return true;
  }
}
