// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pagelayout_editor/dialogs/properties_frame.h` + `properties_frame.cpp`:
 * `PROPERTIES_FRAME`, the docked panel that shows the selected item's
 * parameters and the sheet's general options. The controls' state lives here,
 * named as `properties_frame_base.cpp` names them, so the transfers both ways
 * (`CopyPrmsFrom*ToPanel` / `CopyPrmsFromPanelTo*`) and `OnAcceptPrms` run
 * without a DOM; `properties_frame_ui.tsx` draws them.
 *
 * The flow is upstream's: an edit marks the panel dirty (`onModify`,
 * `onTextFocusLost`, the swatch and the alignment buttons), the next
 * `OnUpdateUI` clears the flag and `CallAfter`s `OnAcceptPrms`, which pushes
 * an undo copy and copies EVERY field back into the item and the model - the
 * panel has no per-field commit.
 *
 * Also here: how `CopyPrmsFromItemToPanel` prints its four plain text fields,
 * which is not one format for all four:
 *
 *   - Rotation      `msg.Printf( wxT( "%.3f" ), item->m_Orient );` (:295)
 *                   `msg.Printf( wxT( "%.3f" ), item->m_Orient.AsDegrees() );` (:342)
 *   - Step text     `msg.Printf( wxT( "%d" ), item->m_IncrementLabel );` (:291)
 *   - Bitmap DPI    `msg.Printf( wxT( "%d" ), item->GetPPI() );` (:351)
 *   - Count         `msg.Printf( wxT( "%d" ), aItem->m_RepeatCount );` (:384)
 */

import { COLOR4D_UNSPECIFIED, type Color4d } from '@ziroeda/common/color4d.js';
import {
  CORNER_ANCHOR,
  type DS_DATA_ITEM,
  type DS_DATA_ITEM_BITMAP,
  type DS_DATA_ITEM_POLYGONS,
  type DS_DATA_ITEM_TEXT,
  DS_ITEM_TYPE,
  PAGE_OPTION,
  TB_DEFAULT_TEXTSIZE,
} from '@ziroeda/common/drawing_sheet/ds_data_item.js';
import { DS_DATA_MODEL } from '@ziroeda/common/drawing_sheet/ds_data_model.js';
import type { DS_DRAW_ITEM_BASE } from '@ziroeda/common/drawing_sheet/ds_draw_item.js';
import {
  DoubleValueFromStringIn,
  drawSheetIUScale,
  FromUserUnit,
  toUserUnit,
} from '@ziroeda/common/eda_units.js';
import { FONT } from '@ziroeda/common/font/font.js';
import { DEFAULT_FONT_NAME, KICAD_FONT_NAME } from '@ziroeda/common/font/stroke_font.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { PL_EDITOR_FRAME } from '../pl_editor_frame.js';
import { PL_SELECTION_TOOL } from '../tools/pl_selection_tool.js';

/**
 * `"%.3f"` — always three decimal places, so a rotation of zero reads `0.000`
 * in a live pl_editor and not `0`.
 */
export function fmtRotation(n: number): string {
  return n.toFixed(3);
}

/**
 * `"%d"` — a plain integer. `%d` takes an int, so a fractional input is
 * truncated toward zero rather than rounded.
 */
export function fmtInt(n: number): string {
  return String(Math.trunc(n));
}

/**
 * Minimum drawing sheet text default size in millmeters from #PROPERTIES_FRAME.
 *
 * @note 0.0 is allowed for a given text to use the default size.
 */
export const DLG_MIN_TEXTSIZE = 0.01;
/// Maximum drawing sheet text size in mm from PROPERTIES_FRAME.
export const DLG_MAX_TEXTSIZE = 100.0;

/** `m_choicePageOptChoices[]` (properties_frame_base.cpp:38). [data] */
export const PAGE_OPTION_CHOICES: readonly string[] = [
  'Show on all pages',
  'First page only',
  'Subsequent pages only',
];

/** `m_comboBoxCornerPos` / `m_comboBoxCornerEnd`'s rows (:275-278, :328-331). [data] */
export const CORNER_CHOICES: readonly string[] = [
  'Upper Right',
  'Upper Left',
  'Lower Right',
  'Lower Left',
];

/**
 * `FONT_CHOICE`'s first two rows (common/widgets/font_choice.cpp:240-258):
 * "Default Font" (no `m_Font`) and the stroke font by name. A browser cannot
 * list the installed faces without the Local Font Access prompt, so the list
 * stops there.
 */
export const FONT_CHOICES: readonly string[] = [DEFAULT_FONT_NAME, KICAD_FONT_NAME];

function fromMM(aMMValue: number): number {
  return FromUserUnit(drawSheetIUScale, 'mm', aMMValue);
}

function toMM(aIUValue: number): number {
  return toUserUnit(drawSheetIUScale, 'mm', aIUValue);
}

function validateMM(aUnitBinder: UNIT_BINDER, aMin: number, aMax: number): boolean {
  return aUnitBinder.Validate(aMin, aMax, 'mm');
}

/** `wxString::ToLong`: the whole text must be an integer. */
function toLong(aText: string): number | null {
  const t = aText.trim();

  return /^[-+]?\d+$/.test(t) ? Number.parseInt(t, 10) : null;
}

/**
 * PROPERTIES_FRAME display properties of the current item.
 */
export class PROPERTIES_FRAME {
  private m_parent: PL_EDITOR_FRAME;

  m_textSizeX: UNIT_BINDER;
  m_textSizeY: UNIT_BINDER;

  m_constraintX: UNIT_BINDER;
  m_constraintY: UNIT_BINDER;

  m_textPosX: UNIT_BINDER;
  m_textPosY: UNIT_BINDER;

  m_textEndX: UNIT_BINDER;
  m_textEndY: UNIT_BINDER;

  m_textStepX: UNIT_BINDER;
  m_textStepY: UNIT_BINDER;

  m_defaultTextSizeX: UNIT_BINDER;
  m_defaultTextSizeY: UNIT_BINDER;

  m_defaultLineWidth: UNIT_BINDER;
  m_defaultTextThickness: UNIT_BINDER;

  m_textLeftMargin: UNIT_BINDER;
  m_textRightMargin: UNIT_BINDER;

  m_textTopMargin: UNIT_BINDER;
  m_textBottomMargin: UNIT_BINDER;

  m_lineWidth: UNIT_BINDER;

  private m_propertiesDirty: boolean;

  // ---- PANEL_PROPERTIES_BASE's other controls, by their base names --------

  /** `m_staticTextType`: the item's class name. */
  m_staticTextType = '';
  m_textCtrlComment = '';
  /** `m_choicePageOpt->GetSelection()`. */
  m_choicePageOpt = 0;
  m_comboBoxCornerPos = 0;
  m_comboBoxCornerEnd = 0;
  /** `m_stcText`'s text. */
  m_stcText = '';
  m_textCtrlTextIncrement = '';
  m_textCtrlRotation = '';
  m_textCtrlBitmapDPI = '';
  m_textCtrlRepeatCount = '';
  /** `m_fontCtrl`: the selected row of {@link FONT_CHOICES}, or -1 (wxNOT_FOUND). */
  m_fontCtrl = 0;
  m_bold = false;
  m_italic = false;
  m_textColorSwatch: Color4d = COLOR4D_UNSPECIFIED;
  /** `m_textColorSwatch->SetSwatchBackground( aParent->GetDrawBgColor() )` (:125). */
  m_swatchBackground: Color4d;
  m_alignLeft = false;
  m_alignCenter = false;
  m_alignRight = false;
  m_vAlignTop = false;
  m_vAlignMiddle = false;
  m_vAlignBottom = false;

  // ---- what CopyPrmsFromItemToPanel shows and hides -----------------------

  /** `m_SizerItemProperties->Show()`: the whole Item Properties page. */
  m_showItemProperties = false;
  m_showTextOptions = false;
  m_showSyntaxHelpLink = false;
  m_showEndPosition = false;
  m_showRotation = false;
  m_showBitmapDPI = false;
  m_showIncLabel = false;

  /** `GetSize().x`, which the page's sash sets. */
  private m_width = 0;
  private m_listener: (() => void) | null = null;

  constructor(aParent: PL_EDITOR_FRAME) {
    this.m_parent = aParent;

    const error = (aMessage: string): void => aParent.GetHost()?.DisplayErrorMessage(aMessage);
    const binder = (aLabel: string): UNIT_BINDER => new UNIT_BINDER(aParent, aLabel, error);

    this.m_textSizeX = binder('Text width:');
    this.m_textSizeY = binder('Text height:');
    this.m_constraintX = binder('Maximum width:');
    this.m_constraintY = binder('Maximum height:');
    this.m_textPosX = binder('X:');
    this.m_textPosY = binder('Y:');
    this.m_textEndX = binder('X:');
    this.m_textEndY = binder('Y:');
    this.m_textStepX = binder('Step X:');
    this.m_textStepY = binder('Step Y:');
    this.m_defaultTextSizeX = binder('Text width:');
    this.m_defaultTextSizeY = binder('Text height:');
    this.m_defaultLineWidth = binder('Line thickness:');
    this.m_defaultTextThickness = binder('Text thickness:');
    this.m_textLeftMargin = binder('Left:');
    this.m_textRightMargin = binder('Right:');
    this.m_textTopMargin = binder('Top:');
    this.m_textBottomMargin = binder('Bottom:');
    this.m_lineWidth = binder('Line width:');
    this.m_propertiesDirty = false;

    this.m_textColorSwatch = COLOR4D_UNSPECIFIED;
    this.m_swatchBackground = aParent.GetDrawBgColor();
  }

  /** The page's repaint, run whenever the controls change under it. */
  SetChangeListener(aListener: (() => void) | null): void {
    this.m_listener = aListener;
  }

  private changed(): void {
    this.m_listener?.();
  }

  /** `GetMinSize()`: `FromDIP( wxSize( 150, -1 ) )` (:142-145). [data] */
  GetMinSize(): { x: number; y: number } {
    return { x: 150, y: -1 };
  }

  /** `GetSize().x`, for `SaveSettings`' `m_propertiesFrameWidth`. */
  GetWidth(): number {
    return this.m_width;
  }

  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }

  IsDirty(): boolean {
    return this.m_propertiesDirty;
  }

  // Data transfer from general properties to widgets
  CopyPrmsFromGeneralToPanel(): void {
    const model = DS_DATA_MODEL.GetTheInstance();

    // Set default parameters
    this.m_defaultLineWidth.SetDoubleValue(fromMM(model.m_DefaultLineWidth));

    this.m_defaultTextSizeX.SetDoubleValue(fromMM(model.m_DefaultTextSize.x));
    this.m_defaultTextSizeY.SetDoubleValue(fromMM(model.m_DefaultTextSize.y));
    this.m_defaultTextThickness.SetDoubleValue(fromMM(model.m_DefaultTextThickness));

    this.m_textLeftMargin.SetDoubleValue(fromMM(model.GetLeftMargin()));
    this.m_textRightMargin.SetDoubleValue(fromMM(model.GetRightMargin()));
    this.m_textTopMargin.SetDoubleValue(fromMM(model.GetTopMargin()));
    this.m_textBottomMargin.SetDoubleValue(fromMM(model.GetBottomMargin()));

    this.changed();
  }

  // Data transfer from widgets to general properties
  CopyPrmsFromPanelToGeneral(): boolean {
    const model = DS_DATA_MODEL.GetTheInstance();

    // Import default parameters from widgets
    if (validateMM(this.m_defaultLineWidth, 0.0, 10.0))
      model.m_DefaultLineWidth = toMM(this.m_defaultLineWidth.GetIntValue());

    if (validateMM(this.m_defaultTextSizeX, DLG_MIN_TEXTSIZE, DLG_MAX_TEXTSIZE))
      model.m_DefaultTextSize = {
        ...model.m_DefaultTextSize,
        x: toMM(this.m_defaultTextSizeX.GetIntValue()),
      };

    if (validateMM(this.m_defaultTextSizeY, DLG_MIN_TEXTSIZE, DLG_MAX_TEXTSIZE))
      model.m_DefaultTextSize = {
        ...model.m_DefaultTextSize,
        y: toMM(this.m_defaultTextSizeY.GetIntValue()),
      };

    if (validateMM(this.m_defaultTextThickness, 0.0, 5.0))
      model.m_DefaultTextThickness = toMM(this.m_defaultTextThickness.GetIntValue());

    // Get page margins values
    model.SetRightMargin(toMM(this.m_textRightMargin.GetIntValue()));
    model.SetBottomMargin(toMM(this.m_textBottomMargin.GetIntValue()));
    model.SetLeftMargin(toMM(this.m_textLeftMargin.GetIntValue()));
    model.SetTopMargin(toMM(this.m_textTopMargin.GetIntValue()));

    return true;
  }

  // Data transfer from item to widgets in properties frame
  CopyPrmsFromItemToPanel(aItem: DS_DATA_ITEM | null): void {
    if (!aItem) {
      this.m_showItemProperties = false;
      this.m_propertiesDirty = false;
      this.changed();
      return;
    }

    // Set parameters common to all DS_DATA_ITEM types
    this.m_staticTextType = aItem.GetClassName();
    this.m_textCtrlComment = aItem.m_Info;

    switch (aItem.GetPage1Option()) {
      default:
      case PAGE_OPTION.ALL_PAGES:
        this.m_choicePageOpt = 0;
        break;
      case PAGE_OPTION.FIRST_PAGE_ONLY:
        this.m_choicePageOpt = 1;
        break;
      case PAGE_OPTION.SUBSEQUENT_PAGES:
        this.m_choicePageOpt = 2;
        break;
    }

    // Position/ start point
    this.m_textPosX.SetDoubleValue(fromMM(aItem.m_Pos.m_Pos.x));
    this.m_textPosY.SetDoubleValue(fromMM(aItem.m_Pos.m_Pos.y));
    this.m_comboBoxCornerPos = cornerToSelection(aItem.m_Pos.m_Anchor, this.m_comboBoxCornerPos);

    // End point
    this.m_textEndX.SetDoubleValue(fromMM(aItem.m_End.m_Pos.x));
    this.m_textEndY.SetDoubleValue(fromMM(aItem.m_End.m_Pos.y));
    this.m_comboBoxCornerEnd = cornerToSelection(aItem.m_End.m_Anchor, this.m_comboBoxCornerEnd);

    this.m_lineWidth.SetDoubleValue(fromMM(aItem.m_LineWidth));

    // Now, set prms more specific to DS_DATA_ITEM types
    // For a given type, disable widgets which are not relevant,
    // and be sure widgets which are relevant are enabled
    if (aItem.GetType() === DS_ITEM_TYPE.DS_TEXT) {
      const item = aItem as DS_DATA_ITEM_TEXT;
      item.m_FullText = item.m_TextBase;

      // Replace our '\' 'n' sequence by the EOL char
      item.ReplaceAntiSlashSequence();
      this.m_stcText = item.m_FullText;

      this.m_textCtrlTextIncrement = fmtInt(item.m_IncrementLabel);

      // Rotation (poly and text)
      this.m_textCtrlRotation = fmtRotation(item.m_Orient);

      // Constraints:
      this.m_constraintX.SetDoubleValue(fromMM(item.m_BoundingBoxSize.x));
      this.m_constraintY.SetDoubleValue(fromMM(item.m_BoundingBoxSize.y));

      // Font Options
      this.SetFontSelection(item.m_Font);

      this.m_bold = item.m_Bold;
      this.m_italic = item.m_Italic;

      this.m_textColorSwatch = item.m_TextColor;

      this.m_alignLeft = item.m_Hjustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
      this.m_alignCenter = item.m_Hjustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
      this.m_alignRight = item.m_Hjustify === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

      this.m_vAlignTop = item.m_Vjustify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
      this.m_vAlignMiddle = item.m_Vjustify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
      this.m_vAlignBottom = item.m_Vjustify === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

      // Text size
      this.m_textSizeX.SetDoubleValue(fromMM(item.m_TextSize.x));
      this.m_textSizeY.SetDoubleValue(fromMM(item.m_TextSize.y));
    }

    if (aItem.GetType() === DS_ITEM_TYPE.DS_POLYPOLYGON) {
      const item = aItem as DS_DATA_ITEM_POLYGONS;

      // Rotation (poly and text)
      this.m_textCtrlRotation = fmtRotation(item.m_Orient.AsDegrees());
    }

    if (aItem.GetType() === DS_ITEM_TYPE.DS_BITMAP) {
      const item = aItem as DS_DATA_ITEM_BITMAP;

      // select definition in PPI
      this.m_textCtrlBitmapDPI = fmtInt(item.GetPPI());
    }

    this.m_showItemProperties = true;

    const type = aItem.GetType();
    this.m_showTextOptions = type === DS_ITEM_TYPE.DS_TEXT;
    this.m_showSyntaxHelpLink = type === DS_ITEM_TYPE.DS_TEXT;

    this.m_showEndPosition = type === DS_ITEM_TYPE.DS_SEGMENT || type === DS_ITEM_TYPE.DS_RECT;

    this.m_lineWidth.Show(type !== DS_ITEM_TYPE.DS_BITMAP);

    this.m_showRotation = type === DS_ITEM_TYPE.DS_TEXT || type === DS_ITEM_TYPE.DS_POLYPOLYGON;

    this.m_showBitmapDPI = type === DS_ITEM_TYPE.DS_BITMAP;

    this.m_showIncLabel = type === DS_ITEM_TYPE.DS_TEXT;

    // Repeat parameters
    this.m_textCtrlRepeatCount = fmtInt(aItem.m_RepeatCount);

    this.m_textStepX.SetDoubleValue(fromMM(aItem.m_IncrementVector.x));
    this.m_textStepY.SetDoubleValue(fromMM(aItem.m_IncrementVector.y));

    this.changed();
  }

  /** `onHAlignButton`: the three buttons are a radio group. */
  onHAlignButton(aWhich: 'left' | 'center' | 'right'): void {
    this.m_alignLeft = aWhich === 'left';
    this.m_alignCenter = aWhich === 'center';
    this.m_alignRight = aWhich === 'right';

    this.m_propertiesDirty = true;
    this.changed();
  }

  /** `onVAlignButton`. */
  onVAlignButton(aWhich: 'top' | 'middle' | 'bottom'): void {
    this.m_vAlignTop = aWhich === 'top';
    this.m_vAlignMiddle = aWhich === 'middle';
    this.m_vAlignBottom = aWhich === 'bottom';

    this.m_propertiesDirty = true;
    this.changed();
  }

  /** `COLOR_SWATCH_CHANGED` (:127-131). */
  onSwatchChanged(aColor: Color4d): void {
    this.m_textColorSwatch = aColor;
    this.m_propertiesDirty = true;
    this.changed();
  }

  OnAcceptPrms(): void {
    const parent = this.m_parent;
    const selTool = parent.GetToolManager()!.GetTool(PL_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();

    parent.SaveCopyInUndoList();

    const drawItem = (selection.Front() as DS_DRAW_ITEM_BASE | null) ?? null;

    if (drawItem) {
      const dataItem = drawItem.GetPeer();
      this.CopyPrmsFromPanelToItem(dataItem);

      // Be sure what is displayed is what is set for item
      // (mainly, texts can be modified if they contain "\n")
      this.CopyPrmsFromItemToPanel(dataItem);
      parent.GetCanvas()!.GetView().Update(drawItem);
    }

    this.CopyPrmsFromPanelToGeneral();

    // Refresh values, exactly as they are converted, to avoid any mistake
    this.CopyPrmsFromGeneralToPanel();

    this.m_propertiesDirty = false;

    parent.OnModify();

    // Rebuild the draw list with the new parameters
    parent.GetCanvas()!.DisplayDrawingSheet();
    parent.GetCanvas()!.Refresh();
  }

  /** `onModify`: a choice, a combo or a check changed. */
  onModify(): void {
    this.m_propertiesDirty = true;
    this.changed();
  }

  /** `onTextFocusLost` / `onScintillaFocusLost`: an edited field was left. */
  onTextFocusLost(): void {
    this.m_propertiesDirty = true;
  }

  /** `OnUpdateUI` (:465-479): the idle that turns a dirty panel into an accept. */
  OnUpdateUI(): void {
    if (this.m_propertiesDirty) {
      // Clear m_propertiesDirty now. Otherwise OnAcceptPrms() is called multiple
      // times (probably by each updated widget)
      this.m_propertiesDirty = false;
      this.m_parent.CallAfter(() => {
        this.OnAcceptPrms();
      });
    }
  }

  OnSetDefaultValues(): void {
    const model = DS_DATA_MODEL.GetTheInstance();

    model.m_DefaultTextSize = { x: TB_DEFAULT_TEXTSIZE, y: TB_DEFAULT_TEXTSIZE };
    model.m_DefaultLineWidth = 0.15;
    model.m_DefaultTextThickness = 0.15;

    this.CopyPrmsFromGeneralToPanel();

    // Rebuild the draw list with the new parameters
    this.m_parent.GetCanvas()!.DisplayDrawingSheet();
    this.m_parent.GetCanvas()!.Refresh();
  }

  // Data transfer from widgets in properties frame to item
  CopyPrmsFromPanelToItem(aItem: DS_DATA_ITEM | null): boolean {
    if (aItem === null) return false;

    // Import common parameters:
    aItem.m_Info = this.m_textCtrlComment;

    switch (this.m_choicePageOpt) {
      default:
      case 0:
        aItem.SetPage1Option(PAGE_OPTION.ALL_PAGES);
        break;
      case 1:
        aItem.SetPage1Option(PAGE_OPTION.FIRST_PAGE_ONLY);
        break;
      case 2:
        aItem.SetPage1Option(PAGE_OPTION.SUBSEQUENT_PAGES);
        break;
    }

    // Import thickness
    if (validateMM(this.m_lineWidth, 0.0, 10.0))
      aItem.m_LineWidth = toMM(this.m_lineWidth.GetIntValue());

    // Import Start point
    aItem.m_Pos.m_Pos = {
      x: toMM(this.m_textPosX.GetIntValue()),
      y: toMM(this.m_textPosY.GetIntValue()),
    };

    const posAnchor = selectionToCorner(this.m_comboBoxCornerPos);
    if (posAnchor !== null) aItem.m_Pos.m_Anchor = posAnchor;

    // Import End point
    aItem.m_End.m_Pos = {
      x: toMM(this.m_textEndX.GetIntValue()),
      y: toMM(this.m_textEndY.GetIntValue()),
    };

    const endAnchor = selectionToCorner(this.m_comboBoxCornerEnd);
    if (endAnchor !== null) aItem.m_End.m_Anchor = endAnchor;

    // Import Repeat prms
    // `msg.ToLong( &itmp )` leaves itmp as it was when the text is not a
    // number; itmp is uninitialised there, which reads as below 1 below.
    let itmp = toLong(this.m_textCtrlRepeatCount) ?? 0;

    // Ensure m_RepeatCount is > 0. Otherwise it create issues because a repeat
    // count < 1 make no sense
    if (itmp < 1) {
      itmp = 1;
      this.m_textCtrlRepeatCount = String(itmp);
    }

    aItem.m_RepeatCount = itmp;

    aItem.m_IncrementVector = {
      x: toMM(this.m_textStepX.GetIntValue()),
      y: toMM(this.m_textStepY.GetIntValue()),
    };

    if (aItem.GetType() === DS_ITEM_TYPE.DS_TEXT) {
      const item = aItem as DS_DATA_ITEM_TEXT;

      item.m_TextBase = this.m_stcText;

      // `msg.ToLong( &itmp )` again: itmp keeps the repeat count on a bad text.
      itmp = toLong(this.m_textCtrlTextIncrement) ?? itmp;
      item.m_IncrementLabel = itmp;

      item.m_Bold = this.m_bold;
      item.m_Italic = this.m_italic;
      item.m_TextColor = this.m_textColorSwatch;

      if (this.m_alignLeft) item.m_Hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
      else if (this.m_alignCenter) item.m_Hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
      else if (this.m_alignRight) item.m_Hjustify = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT;

      if (this.m_vAlignTop) item.m_Vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
      else if (this.m_vAlignMiddle) item.m_Vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
      else if (this.m_vAlignBottom) item.m_Vjustify = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM;

      if (this.HaveFontSelection())
        item.m_Font = this.GetFontSelection(item.m_Bold, item.m_Italic, true);

      item.m_Orient = DoubleValueFromStringIn(
        drawSheetIUScale,
        'unscaled',
        this.m_textCtrlRotation,
      );

      // Import text size
      if (validateMM(this.m_textSizeX, 0.0, DLG_MAX_TEXTSIZE))
        item.m_TextSize = { ...item.m_TextSize, x: toMM(this.m_textSizeX.GetIntValue()) };

      if (validateMM(this.m_textSizeY, 0.0, DLG_MAX_TEXTSIZE))
        item.m_TextSize = { ...item.m_TextSize, y: toMM(this.m_textSizeY.GetIntValue()) };

      // Import constraints:
      item.m_BoundingBoxSize = {
        x: toMM(this.m_constraintX.GetIntValue()),
        y: toMM(this.m_constraintY.GetIntValue()),
      };
    }

    if (aItem.GetType() === DS_ITEM_TYPE.DS_POLYPOLYGON) {
      const item = aItem as DS_DATA_ITEM_POLYGONS;

      // `m_parent->AngleValueFromString( msg )` (units_provider.h): degrees.
      item.m_Orient = new EDA_ANGLE(
        DoubleValueFromStringIn(drawSheetIUScale, 'degrees', this.m_textCtrlRotation),
        EDA_ANGLE_T.DEGREES_T,
      );
    }

    if (aItem.GetType() === DS_ITEM_TYPE.DS_BITMAP) {
      const item = aItem as DS_DATA_ITEM_BITMAP;
      const value = toLong(this.m_textCtrlBitmapDPI);

      if (value !== null) item.SetPPI(value);
    }

    return true;
  }

  /**
   * `onHelp` (:672-704): HTML_MESSAGE_BOX "Predefined Keywords", its HTML text
   * and its list.
   */
  onHelp(): { caption: string; html: string; list: string[] } {
    let message = '';

    message += 'Texts can include keywords.<br>';
    message += 'Keyword notation is ${keyword}<br>';
    message += 'Each keyword is replaced by its value<br><br>';
    message += 'These build-in keywords are always available:<br><br>';

    const list = [
      'KICAD_VERSION',
      '# (sheet number)',
      '## (sheet count)',
      'COMMENT1 thru COMMENT9',
      'COMPANY',
      'FILENAME',
      'ISSUE_DATE',
      'LAYER',
      'PAPER (paper size)',
      'REVISION',
      'SHEETNAME',
      'SHEETPATH',
      'TITLE',
    ];

    return { caption: 'Predefined Keywords', html: message, list };
  }

  /** The Syntax Help link: `onHelp`'s box, shown by the host. */
  ShowHelp(): void {
    const help = this.onHelp();

    this.m_parent.GetHost()?.HtmlMessageBox(help.caption, help.html, help.list);
  }

  // ---- FONT_CHOICE (common/widgets/font_choice.cpp) ------------------------

  /** `SetFontSelection( aFont, true )`: null is "Default Font". */
  private SetFontSelection(aFont: FONT | null): void {
    if (!aFont) {
      this.m_fontCtrl = 0;
      return;
    }

    const idx = FONT_CHOICES.indexOf(aFont.GetName());
    this.m_fontCtrl = idx >= 0 ? idx : 1;
  }

  /** `HaveFontSelection()`: `GetSelection() != wxNOT_FOUND`. */
  HaveFontSelection(): boolean {
    return this.m_fontCtrl >= 0;
  }

  /** `GetFontSelection( aBold, aItalic, aForDrawingSheet )`: row 0 is no font. */
  GetFontSelection(aBold: boolean, aItalic: boolean, aForDrawingSheet: boolean): FONT | null {
    if (this.m_fontCtrl <= 0) return null;

    return FONT.GetFont(FONT_CHOICES[this.m_fontCtrl], aBold, aItalic, null, aForDrawingSheet);
  }
}

/**
 * The anchor -> combo row switch (:251-257, :263-269). There is no default:
 * an unknown anchor leaves the combo where it was.
 */
function cornerToSelection(aAnchor: number, aCurrent: number): number {
  switch (aAnchor) {
    case CORNER_ANCHOR.RB_CORNER:
      return 2;
    case CORNER_ANCHOR.RT_CORNER:
      return 0;
    case CORNER_ANCHOR.LB_CORNER:
      return 3;
    case CORNER_ANCHOR.LT_CORNER:
      return 1;
    default:
      return aCurrent;
  }
}

/** The combo row -> anchor switch (:540-546); no default either. */
function selectionToCorner(aSelection: number): CORNER_ANCHOR | null {
  switch (aSelection) {
    case 2:
      return CORNER_ANCHOR.RB_CORNER;
    case 0:
      return CORNER_ANCHOR.RT_CORNER;
    case 3:
      return CORNER_ANCHOR.LB_CORNER;
    case 1:
      return CORNER_ANCHOR.LT_CORNER;
    default:
      return null;
  }
}
