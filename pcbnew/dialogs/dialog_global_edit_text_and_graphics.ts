// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS` (pcbnew/dialogs/dialog_global_edit_text_and_graphics.cpp),
 * on the live BOARD: Edit > Edit Text & Graphics Properties. The scope (the
 * footprint and board text, graphic and dimension kinds), the filters (layer,
 * parent reference and library link by wildcard, selected items), and either
 * the specified values (each defaulting to "-- leave unchanged --") or the
 * layer defaults from Board Setup, as one "Edit Text and Graphics" commit.
 * The window is dialog_global_edit_text_and_graphics_ui.tsx.
 *
 * `m_isBoardEditor` is false in the footprint editor, which hides the board
 * scope boxes and the two parent filters and relabels the footprint boxes.
 */
import { GetPenSizeForBold, GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { TEXT_MAX_SIZE_MM, TEXT_MIN_SIZE_MM } from '@ziroeda/common/eda_text.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FONT, KICAD_FONT_NAME } from '@ziroeda/common/font/font.js';
import { PCB_LAYER_ID, ToLAYER_ID } from '@ziroeda/common/layer_id.js';
import { wildCompareString } from '@ziroeda/common/string_utils.js';
import { INDETERMINATE_ACTION } from '@ziroeda/common/widgets/ui_common.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { BaseType, KICAD_T } from '@ziroeda/core/typeinfo.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { PCB_BARCODE } from '../pcb_barcode.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_DIMENSION_BASE } from '../pcb_dimension.js';
import type { PCB_FIELD } from '../pcb_field.js';
import { PCB_SHAPE } from '../pcb_shape.js';
import type { PCB_SELECTION_TOOL } from '../tools/pcb_selection_tool.js';

/** `g_referenceFilter` / `g_footprintFilter`: kept for the next open. */
let g_referenceFilter = '';
let g_footprintFilter = '';

/** A wxCheckBox in wxCHK_3STATE: true, false, or null for undetermined. */
export type TRI_STATE = boolean | null;

export class DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS {
  // Scope
  m_references = false;
  m_values = false;
  m_otherFootprintFields = false;
  m_footprintGraphics = false;
  m_footprintTexts = false;
  m_footprintDimensions = false;
  m_boardGraphics = false;
  m_boardText = false;
  m_boardDimensions = false;

  // Filter Items
  m_layerFilterOpt = false;
  m_layerFilter: PCB_LAYER_ID = PCB_LAYER_ID.F_SilkS;
  m_referenceFilterOpt = false;
  m_referenceFilter = '';
  m_footprintFilterOpt = false;
  m_footprintFilter = '';
  m_selectedItemsFilter = false;

  // Action
  m_setToSpecifiedValues = true;
  m_LayerCtrl: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  m_visible: TRI_STATE = null;
  readonly m_lineWidth: UNIT_BINDER;
  /** `m_fontCtrl`'s value: a face, "KiCad Font", "Default Font" or INDETERMINATE_ACTION. */
  m_fontCtrl: string = INDETERMINATE_ACTION;
  m_bold: TRI_STATE = null;
  readonly m_textWidth: UNIT_BINDER;
  m_italic: TRI_STATE = null;
  readonly m_textHeight: UNIT_BINDER;
  m_keepUpright: TRI_STATE = null;
  readonly m_thickness: UNIT_BINDER;
  m_autoTextThickness = false;
  m_centerOnFP = false;

  readonly m_isBoardEditor: boolean;
  private m_selection = new Set<EDA_ITEM>();

  constructor(
    private readonly m_parent: PCB_BASE_EDIT_FRAME,
    aIsBoardEditor: boolean,
  ) {
    this.m_isBoardEditor = aIsBoardEditor;

    const provider = m_parent as unknown as ConstructorParameters<typeof UNIT_BINDER>[0];
    this.m_lineWidth = new UNIT_BINDER(provider, 'Line thickness:');
    this.m_textWidth = new UNIT_BINDER(provider, 'Text width:');
    this.m_textHeight = new UNIT_BINDER(provider, 'Text height:');
    this.m_thickness = new UNIT_BINDER(provider, 'Text thickness:');
  }

  /** The scope labels, which the footprint editor changes (:110-113). */
  FootprintScopeLabels(): { texts: string; graphics: string; dimensions: string } {
    return this.m_isBoardEditor
      ? {
          texts: 'Footprint text items',
          graphics: 'Footprint graphic items',
          dimensions: 'Footprint dimensions',
        }
      : { texts: 'Text items', graphics: 'Graphic items', dimensions: 'Dimension items' };
  }

  /** `onDimensionItemCheckbox`: the second radio button's label. */
  LayerDefaultsLabel(): string {
    return this.m_footprintDimensions || this.m_boardDimensions
      ? 'Set to layer and dimension default values:'
      : 'Set to layer default values:';
  }

  /** `onActionButtonChange`: the value controls, or the defaults grid. */
  SpecifiedValuesEnabled(): boolean {
    return this.m_setToSpecifiedValues;
  }

  ThicknessEnabled(): boolean {
    return this.m_setToSpecifiedValues && !this.m_autoTextThickness;
  }

  TransferDataToWindow(): boolean {
    const selTool = this.m_parent
      .GetToolManager()!
      .FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;
    this.m_selection = new Set(selTool.GetSelection());

    if (this.m_isBoardEditor) {
      this.m_referenceFilter = g_referenceFilter;
      this.m_footprintFilter = g_footprintFilter;
    }

    this.m_lineWidth.SetText(INDETERMINATE_ACTION);
    this.m_fontCtrl = INDETERMINATE_ACTION;
    this.m_textWidth.SetText(INDETERMINATE_ACTION);
    this.m_textHeight.SetText(INDETERMINATE_ACTION);
    this.m_thickness.SetText(INDETERMINATE_ACTION);
    this.m_autoTextThickness = false;
    this.m_bold = null;
    this.m_italic = null;
    this.m_keepUpright = null;
    this.m_visible = null;
    this.m_LayerCtrl = PCB_LAYER_ID.UNDEFINED_LAYER;

    return true;
  }

  /** The destructor's statics. */
  OnClose(): void {
    if (this.m_isBoardEditor) {
      g_referenceFilter = this.m_referenceFilter;
      g_footprintFilter = this.m_footprintFilter;
    }
  }

  /** `onAutoTextThickness`. */
  OnAutoTextThickness(aChecked: boolean): void {
    if (aChecked) {
      this.m_autoTextThickness = true;
      this.OnTextSize();

      if (this.m_textWidth.IsIndeterminate() || this.m_textHeight.IsIndeterminate())
        this.m_thickness.SetText('(auto)');
    } else {
      this.m_autoTextThickness = false;
      this.m_thickness.SetText(INDETERMINATE_ACTION);
    }
  }

  /** `onTextSize`: an auto thickness follows the size. */
  OnTextSize(): void {
    if (!this.m_autoTextThickness) return;

    if (this.m_textWidth.IsIndeterminate() || this.m_textHeight.IsIndeterminate()) return;

    const size = Math.min(this.m_textWidth.GetValue(), this.m_textHeight.GetValue());
    const bold = this.m_bold === true;

    this.m_thickness.SetValue(bold ? GetPenSizeForBold(size) : GetPenSizeForNormal(size));
  }

  /** `FONT_CHOICE::GetFontSelection( aBold, aItalic )`. */
  private getFontSelection(aBold: boolean, aItalic: boolean): FONT | null {
    if (this.m_fontCtrl === 'Default Font' || this.m_fontCtrl === INDETERMINATE_ACTION) return null;

    if (this.m_fontCtrl === KICAD_FONT_NAME) return FONT.GetFont(KICAD_FONT_NAME, aBold, aItalic);

    return FONT.GetFont(this.m_fontCtrl, aBold, aItalic);
  }

  private processItem(aCommit: BOARD_COMMIT, aItem: BOARD_ITEM): void {
    aCommit.Modify(aItem);

    const field = aItem.Type() === KICAD_T.PCB_FIELD_T ? (aItem as unknown as PCB_FIELD) : null;
    const text = isEdaText(aItem) ? (aItem as unknown as EDA_TEXT) : null;
    const shape = aItem instanceof PCB_SHAPE ? aItem : null;
    const dimension =
      BaseType(aItem.Type()) === KICAD_T.PCB_DIMENSION_T
        ? (aItem as unknown as PCB_DIMENSION_BASE)
        : null;
    const barcode =
      aItem.Type() === KICAD_T.PCB_BARCODE_T ? (aItem as unknown as PCB_BARCODE) : null;
    const parentFP = aItem.GetParentFootprint();

    if (this.m_setToSpecifiedValues) {
      if (this.m_LayerCtrl !== PCB_LAYER_ID.UNDEFINED_LAYER)
        aItem.SetLayer(ToLAYER_ID(this.m_LayerCtrl));

      if (text) {
        if (!this.m_textWidth.IsIndeterminate())
          text.SetTextSize({ x: this.m_textWidth.GetIntValue(), y: text.GetTextSize().y });

        if (!this.m_textHeight.IsIndeterminate())
          text.SetTextSize({ x: text.GetTextSize().x, y: this.m_textHeight.GetIntValue() });

        if (this.m_autoTextThickness) text.SetAutoThickness(true);
        else if (!this.m_thickness.IsIndeterminate())
          text.SetTextThickness(this.m_thickness.GetIntValue());

        if (this.m_bold !== null) text.SetBold(this.m_bold);

        if (this.m_italic !== null) text.SetItalic(this.m_italic);

        if (this.m_fontCtrl !== INDETERMINATE_ACTION) {
          text.SetFont(this.getFontSelection(text.IsBold(), text.IsItalic()));
        } else if (this.m_italic !== null || this.m_bold !== null) {
          if (text.GetFontName() !== '') {
            text.SetFont(
              FONT.GetFont(
                text.GetFontName(),
                text.IsBold(),
                text.IsItalic(),
                this.m_parent.GetBoard()!.GetFontFiles(),
              ),
            );
          }
        }

        if (parentFP) {
          if (this.m_keepUpright !== null) text.SetKeepUpright(this.m_keepUpright);

          if (this.m_centerOnFP) text.SetTextPos((aItem.GetParent() as BOARD_ITEM).GetCenter());
        }
      }

      if (barcode) {
        if (!this.m_textHeight.IsIndeterminate())
          barcode.SetTextSize(this.m_textHeight.GetIntValue());
        else if (!this.m_textWidth.IsIndeterminate())
          barcode.SetTextSize(this.m_textWidth.GetIntValue());
      }

      if (field) {
        if (this.m_visible !== null) field.SetVisible(this.m_visible);
      }

      if (!this.m_lineWidth.IsIndeterminate()) {
        if (shape) {
          const stroke = shape.GetStroke();
          stroke.SetWidth(this.m_lineWidth.GetIntValue());
          shape.SetStroke(stroke);
        }

        if (dimension) dimension.SetLineThickness(this.m_lineWidth.GetIntValue());
      }
    } else {
      aItem.StyleFromSettings(this.m_parent.GetBoard()!.GetDesignSettings(), false);
    }
  }

  private visitItem(aCommit: BOARD_COMMIT, aItem: BOARD_ITEM): void {
    if (this.m_selectedItemsFilter) {
      let candidate: EDA_ITEM | null = aItem;

      if (!candidate.IsSelected()) {
        const parent = candidate.GetParent();

        if (parent && parent.Type() === KICAD_T.PCB_FOOTPRINT_T) candidate = parent;
      }

      if (!candidate!.IsSelected()) {
        const group = candidate!.GetParentGroup();
        candidate = group ? group.AsEdaItem() : null;

        while (candidate && !candidate.IsSelected() && candidate.GetParentGroup())
          candidate = candidate.GetParentGroup()!.AsEdaItem();

        if (!candidate || !candidate.IsSelected()) return;
      }
    }

    if (this.m_layerFilterOpt && this.m_layerFilter !== PCB_LAYER_ID.UNDEFINED_LAYER) {
      if (aItem.GetLayer() !== this.m_layerFilter) return;
    }

    if (this.m_isBoardEditor) {
      if (this.m_referenceFilterOpt && this.m_referenceFilter !== '') {
        const fp = aItem.GetParentFootprint();

        if (fp && !wildCompareString(this.m_referenceFilter, fp.GetReference(), false)) return;
      }

      if (this.m_footprintFilterOpt && this.m_footprintFilter !== '') {
        const fp = aItem.GetParentFootprint();

        if (fp && !wildCompareString(this.m_footprintFilter, fp.GetFPID().Format(), false)) return;
      }
    }

    this.processItem(aCommit, aItem);
  }

  /** The text size limits OK refuses to cross (UNIT_BINDER::Validate's message). */
  ValidationError(): string | null {
    const minTextSize = pcbIUScale.mmToIU(TEXT_MIN_SIZE_MM);
    const maxTextSize = pcbIUScale.mmToIU(TEXT_MAX_SIZE_MM);

    for (const b of [this.m_textWidth, this.m_textHeight]) {
      if (b.IsIndeterminate()) continue;

      const v = b.GetValue();

      if (v < minTextSize || v > maxTextSize) return b.GetLabel();
    }

    return null;
  }

  /** "Apply and Close". */
  TransferDataFromWindow(): boolean {
    if (this.ValidationError() !== null) return false;

    const commit = new BOARD_COMMIT(this.m_parent);
    const board = this.m_parent.GetBoard()!;

    for (const fp of board.Footprints()) {
      if (this.m_references) this.visitItem(commit, fp.Reference() as unknown as BOARD_ITEM);

      if (this.m_values) this.visitItem(commit, fp.Value() as unknown as BOARD_ITEM);

      for (const field of fp.GetFields()) {
        if (!field) continue; // wxCHECK2( field, continue )

        if (field.IsReference()) continue;

        if (field.IsValue()) continue;

        if (this.m_otherFootprintFields) this.visitItem(commit, field as unknown as BOARD_ITEM);
        else if (this.m_references && field.GetText() === '${REFERENCE}')
          this.visitItem(commit, field as unknown as BOARD_ITEM);
        else if (this.m_values && field.GetText() === '${VALUE}')
          this.visitItem(commit, field as unknown as BOARD_ITEM);
      }

      for (const boardItem of fp.GraphicalItems()) {
        const itemType = boardItem.Type();

        if (itemType === KICAD_T.PCB_TEXT_T || itemType === KICAD_T.PCB_TEXTBOX_T) {
          const textItem = boardItem as unknown as EDA_TEXT;

          if (this.m_footprintTexts) this.visitItem(commit, boardItem);
          else if (this.m_references && textItem.GetText() === '${REFERENCE}')
            this.visitItem(commit, boardItem);
          else if (this.m_values && textItem.GetText() === '${VALUE}')
            this.visitItem(commit, boardItem);
        } else if (itemType === KICAD_T.PCB_TABLE_T) {
          boardItem.RunOnChildren((child: BOARD_ITEM) => {
            if (child.Type() === KICAD_T.PCB_TABLECELL_T && this.m_footprintTexts)
              this.visitItem(commit, child);
          }, RECURSE_MODE.NO_RECURSE);
        } else if (BaseType(itemType) === KICAD_T.PCB_DIMENSION_T) {
          if (this.m_footprintDimensions) this.visitItem(commit, boardItem);
        } else if (itemType === KICAD_T.PCB_SHAPE_T || itemType === KICAD_T.PCB_BARCODE_T) {
          if (this.m_footprintGraphics) this.visitItem(commit, boardItem);
        }
      }
    }

    if (this.m_isBoardEditor) {
      for (const boardItem of board.Drawings()) {
        const itemType = boardItem.Type();

        if (itemType === KICAD_T.PCB_TEXT_T || itemType === KICAD_T.PCB_TEXTBOX_T) {
          if (this.m_boardText) this.visitItem(commit, boardItem);
        } else if (itemType === KICAD_T.PCB_TABLE_T) {
          boardItem.RunOnChildren((child: BOARD_ITEM) => {
            if (child.Type() === KICAD_T.PCB_TABLECELL_T && this.m_boardText)
              this.visitItem(commit, child);
          }, RECURSE_MODE.NO_RECURSE);
        } else if (BaseType(itemType) === KICAD_T.PCB_DIMENSION_T) {
          if (this.m_boardDimensions) this.visitItem(commit, boardItem);
        } else if (itemType === KICAD_T.PCB_SHAPE_T || itemType === KICAD_T.PCB_BARCODE_T) {
          if (this.m_boardGraphics) this.visitItem(commit, boardItem);
        }
      }
    }

    commit.Push('Edit Text and Graphics');
    this.m_parent.GetCanvas()?.Refresh();

    return true;
  }
}

/** `dynamic_cast<EDA_TEXT*>`: the text-bearing board items. */
function isEdaText(aItem: BOARD_ITEM): boolean {
  switch (aItem.Type()) {
    case KICAD_T.PCB_FIELD_T:
    case KICAD_T.PCB_TEXT_T:
    case KICAD_T.PCB_TEXTBOX_T:
    case KICAD_T.PCB_TABLECELL_T:
      return true;
    default:
      return false;
  }
}
