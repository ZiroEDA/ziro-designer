// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_VIEW (`eeschema/sch_view.{h,cpp}`): the VIEW a schematic or symbol is drawn in. It
 * shows one screen (`DisplaySheet`) or one library symbol (`DisplaySymbol`), keeps the
 * drawing sheet as a view item, and repaints an item's children with it.
 */

import { schIUScale } from '@ziroeda/common/eda_units.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { DS_PROXY_VIEW_ITEM } from '@ziroeda/common/drawing_sheet/ds_proxy_view_item.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { GAL_LAYER_ID, SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_MANAGER } from '@ziroeda/common/tool/tool_manager.js';
import { VIEW } from '@ziroeda/common/view/view.js';
import { type VIEW_ITEM, VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 } from '@ziroeda/kimath';
import type { LIB_SYMBOL } from './lib_symbol.js';
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SCREEN } from './sch_screen.js';

/** `SCH_WORLD_UNIT`: one schematic IU (100 nm) in inches. */
export const SCH_WORLD_UNIT = 1e-7 / 0.0254;

export const SCH_LAYER_ORDER: readonly number[] = [
  GAL_LAYER_ID.LAYER_GP_OVERLAY,
  GAL_LAYER_ID.LAYER_SELECT_OVERLAY,
  SCH_LAYER_ID.LAYER_ERC_ERR,
  SCH_LAYER_ID.LAYER_ERC_WARN,
  SCH_LAYER_ID.LAYER_ERC_EXCLUSION,
  SCH_LAYER_ID.LAYER_DANGLING,
  SCH_LAYER_ID.LAYER_OP_VOLTAGES,
  SCH_LAYER_ID.LAYER_OP_CURRENTS,
  SCH_LAYER_ID.LAYER_REFERENCEPART,
  SCH_LAYER_ID.LAYER_VALUEPART,
  SCH_LAYER_ID.LAYER_FIELDS,
  SCH_LAYER_ID.LAYER_PINNUM,
  SCH_LAYER_ID.LAYER_PINNAM,
  SCH_LAYER_ID.LAYER_INTERSHEET_REFS,
  SCH_LAYER_ID.LAYER_NETCLASS_REFS,
  SCH_LAYER_ID.LAYER_RULE_AREAS,
  SCH_LAYER_ID.LAYER_BUS_JUNCTION,
  SCH_LAYER_ID.LAYER_JUNCTION,
  SCH_LAYER_ID.LAYER_NOCONNECT,
  SCH_LAYER_ID.LAYER_HIERLABEL,
  SCH_LAYER_ID.LAYER_GLOBLABEL,
  SCH_LAYER_ID.LAYER_LOCLABEL,
  SCH_LAYER_ID.LAYER_SHEETFILENAME,
  SCH_LAYER_ID.LAYER_SHEETNAME,
  SCH_LAYER_ID.LAYER_SHEETLABEL,
  SCH_LAYER_ID.LAYER_SHEETFIELDS,
  SCH_LAYER_ID.LAYER_NOTES,
  SCH_LAYER_ID.LAYER_PRIVATE_NOTES,
  SCH_LAYER_ID.LAYER_WIRE,
  SCH_LAYER_ID.LAYER_BUS,
  SCH_LAYER_ID.LAYER_DEVICE,
  SCH_LAYER_ID.LAYER_SHEET,
  SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
  GAL_LAYER_ID.LAYER_DRAW_BITMAPS,
  SCH_LAYER_ID.LAYER_SHAPES_BACKGROUND,
  SCH_LAYER_ID.LAYER_DEVICE_BACKGROUND,
  SCH_LAYER_ID.LAYER_SHEET_BACKGROUND,
  SCH_LAYER_ID.LAYER_NOTES_BACKGROUND,
  GAL_LAYER_ID.LAYER_DRAWINGSHEET,
];

/**
 * What the view asks of its `SCH_BASE_FRAME`. `RefreshZoomDependentItems` walks the
 * selection tool's selection (sch_base_frame.cpp:431), so the frames gain it with the live
 * `SCH_SELECTION_TOOL` (S5); until then a zoom repaints nothing extra.
 */
export interface SCH_VIEW_FRAME {
  IsType(aType: FRAME_T): boolean;
  GetToolManager(): TOOL_MANAGER | null;
  RefreshZoomDependentItems?(): void;
}

export class SCH_VIEW extends VIEW {
  /** The frame using this view. Can be null. Used mainly to know the frame type. */
  private m_frame: SCH_VIEW_FRAME | null;
  private m_drawingSheet: DS_PROXY_VIEW_ITEM | null = null;

  constructor(aFrame: SCH_VIEW_FRAME | null) {
    super();
    this.m_frame = aFrame;
  }

  override Update(aItem: VIEW_ITEM, aUpdateFlags: number = VIEW_UPDATE_FLAGS.ALL): void {
    if (aItem.IsSCH_ITEM()) {
      const schItem = aItem as unknown as SCH_ITEM;

      if (schItem.Type() === KICAD_T.SCH_TABLECELL_T) {
        super.Update(schItem.GetParent()!);
      } else {
        schItem.RunOnChildren((child) => {
          super.Update(child, aUpdateFlags);
        }, RECURSE_MODE.RECURSE);
      }
    }

    super.Update(aItem, aUpdateFlags);
  }

  Cleanup(): void {
    this.Clear();
    this.m_drawingSheet = null;
    // m_preview.reset(): InitPreview makes the next one.
  }

  override SetScale(aScale: number, aAnchor: Vec2 = { x: 0, y: 0 }): void {
    super.SetScale(aScale, aAnchor);

    // Redraw items whose rendering is dependent on zoom
    this.m_frame?.RefreshZoomDependentItems?.();
  }

  DisplaySheet(aScreen: SCH_SCREEN): void {
    for (const item of aScreen.Items()) this.Add(item);

    const schematic = aScreen.Schematic()!;
    this.m_drawingSheet = new DS_PROXY_VIEW_ITEM(
      schIUScale,
      aScreen.GetPageSettings(),
      // Upstream hands the PROJECT, and DS_PROXY_VIEW_ITEM reads the sheet layout from the
      // DS_DATA_MODEL singleton the frame loaded; ours takes the layout from this argument.
      // No layout here means KiCad's default; the project's own (m_SchDrawingSheetFileName)
      // comes with the canvas switch (S4-6).
      { GetDrawingSheet: () => null },
      aScreen.GetTitleBlock(),
      schematic.GetProperties(),
    );

    this.m_drawingSheet.SetPageNumber(aScreen.GetPageNumber());
    this.m_drawingSheet.SetSheetCount(aScreen.GetPageCount());
    this.m_drawingSheet.SetFileName(aScreen.GetFileName());
    this.m_drawingSheet.SetColorLayer(SCH_LAYER_ID.LAYER_SCHEMATIC_DRAWINGSHEET);
    this.m_drawingSheet.SetPageBorderColorLayer(SCH_LAYER_ID.LAYER_SCHEMATIC_PAGE_LIMITS);

    const currentVariant = schematic.GetCurrentVariant();
    const variantDesc = schematic.GetVariantDescription(currentVariant);
    this.m_drawingSheet.SetVariantName(currentVariant);
    this.m_drawingSheet.SetVariantDesc(variantDesc);

    if (this.m_frame?.IsType(FRAME_T.FRAME_SCH)) {
      const editFrame = this.m_frame as unknown as SCH_EDIT_FRAME;

      // The title block metadata (sheet name/path, first-page flag) is derived from the
      // current sheet, so the screen being displayed must be the current sheet's screen.
      if (editFrame.GetCurrentSheet().LastScreen() !== aScreen) return;

      this.syncDrawingSheetToCurrentSheet(editFrame);
    } else {
      this.m_drawingSheet.SetIsFirstPage(aScreen.GetVirtualPageNumber() === 1);
      this.m_drawingSheet.SetSheetName('');
      this.m_drawingSheet.SetSheetPath('');
    }

    this.Add(this.m_drawingSheet);

    this.InitPreview();

    // Allow tools to add anything they require to the view (such as the selection VIEW_GROUP)
    this.m_frame?.GetToolManager()?.ResetTools(RESET_REASON.REDRAW);
  }

  private syncDrawingSheetToCurrentSheet(aFrame: SCH_EDIT_FRAME): void {
    const screen = aFrame.GetScreen();

    if (!screen || !this.m_drawingSheet) return;

    this.m_drawingSheet.SetPageNumber(screen.GetPageNumber());
    this.m_drawingSheet.SetSheetCount(screen.GetPageCount());
    this.m_drawingSheet.SetFileName(screen.GetFileName());

    // Use the sheet path's virtual page number rather than the screen's, because the screen's
    // value can be stale after operations like save that temporarily overwrite all screen page
    // numbers for serialization.
    this.m_drawingSheet.SetIsFirstPage(aFrame.GetCurrentSheet().GetVirtualPageNumber() === 1);
    this.m_drawingSheet.SetSheetName(aFrame.GetScreenDesc());
    this.m_drawingSheet.SetSheetPath(aFrame.GetFullScreenDesc());
  }

  RefreshDrawingSheetPageInfo(): void {
    if (!this.m_drawingSheet) return;

    if (this.m_frame?.IsType(FRAME_T.FRAME_SCH)) {
      this.syncDrawingSheetToCurrentSheet(this.m_frame as unknown as SCH_EDIT_FRAME);
      this.Update(this.m_drawingSheet, VIEW_UPDATE_FLAGS.REPAINT);
    }
  }

  DisplaySymbol(aSymbol: LIB_SYMBOL | null): void {
    this.Clear();

    if (!aSymbol) return;

    // Draw the fields.
    for (const item of aSymbol.GetDrawItems()) {
      if (item.Type() === KICAD_T.SCH_FIELD_T) this.Add(item);
    }

    // Draw the parent items if the symbol is inherited from another symbol.
    const drawnSymbol = aSymbol.IsDerived() ? aSymbol.GetRootSymbol() : aSymbol;

    for (const item of drawnSymbol.GetDrawItems()) {
      // Fields already drawn above.  (Besides, we don't want to show parent symbol fields as
      // users may be confused by shown fields that can not be edited.)
      if (item.Type() === KICAD_T.SCH_FIELD_T) continue;

      this.Add(item);
    }

    this.InitPreview();
  }

  ClearHiddenFlags(): void {
    for (const item of this.m_allItems) {
      if (!item) continue;

      this.Hide(item, false);
    }
  }

  HideDrawingSheet(): void {
    //    SetVisible( m_drawingSheet.get(), false );
  }

  GetDrawingSheet(): DS_PROXY_VIEW_ITEM | null {
    return this.m_drawingSheet;
  }
}
