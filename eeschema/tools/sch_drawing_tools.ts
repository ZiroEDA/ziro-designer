// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_DRAWING_TOOLS (`eeschema/tools/sch_drawing_tools.{h,cpp}`) on the live model: the members
 * that build sheets, sheet pins and hierarchical labels. The interactive tool around them (the
 * cursor, the preview, the property dialogs and TOOL_EVENTs) arrives with the tool framework (S5);
 * until then a caller that already knows what to place - the AI - drives these members directly,
 * each step the one the interactive tool takes, with the text the dialog would have been given.
 */
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { parseColor4d } from '@ziroeda/common/gal/color4d.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { VECTOR2I } from '@ziroeda/kimath';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { currentEeschemaSettings } from '../eeschema_settings.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { AUTOPLACE_ALGO } from '../sch_item.js';
import { LABEL_FLAG_SHAPE, SCH_HIERLABEL, type SCH_LABEL_BASE, SPIN_STYLE } from '../sch_label.js';
import { MIN_SHEET_HEIGHT, MIN_SHEET_WIDTH, SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../sch_sheet_pin.js';

export class SCH_DRAWING_TOOLS {
  private m_frame: SCH_EDIT_FRAME;

  // The tool's memory of the last choices (sch_drawing_tools.cpp:83-88).
  m_lastSheetPinType: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastGlobalLabelShape: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastTextOrientation: SPIN_STYLE = new SPIN_STYLE(SPIN_STYLE.RIGHT);
  m_lastTextBold = false;
  m_lastTextItalic = false;
  m_lastAutoLabelRotateOnPlacement = false;

  constructor(aFrame: SCH_EDIT_FRAME) {
    this.m_frame = aFrame;
  }

  /** `sizeSheet` (sch_drawing_tools.cpp:3603): size \a aSheet to reach \a aPos, at least the minimum. */
  sizeSheet(aSheet: SCH_SHEET, aPos: VECTOR2I): void {
    const pos = aSheet.GetPosition();
    const size = { x: aPos.x - pos.x, y: aPos.y - pos.y };

    size.x = Math.max(size.x, schIUScale.milsToIU(MIN_SHEET_WIDTH));
    size.y = Math.max(size.y, schIUScale.milsToIU(MIN_SHEET_HEIGHT));

    const grid = this.m_frame.GetNearestGridPosition({ x: pos.x + size.x, y: pos.y + size.y });
    aSheet.Resize({ x: grid.x - pos.x, y: grid.y - pos.y });
  }

  /**
   * `DrawSheet` (sch_drawing_tools.cpp:3212) without the cursor: the new sheet from its
   * top-left \a aPos to \a aEnd, named \a aName, on the file \a aFileName (what the sheet
   * properties dialog would have been given), linked through ChangeSheetFile and added to the
   * current screen in one commit. Returns the sheet, or null when the file change was refused.
   */
  DrawSheet(aPos: VECTOR2I, aEnd: VECTOR2I, aName: string, aFileName: string): SCH_SHEET | null {
    const cfg = currentEeschemaSettings();
    const sheet = new SCH_SHEET(this.m_frame.GetCurrentSheet().Last(), aPos);
    sheet.SetScreen(null);

    sheet.GetField(FIELD_T.SHEET_NAME)!.SetText(aName);
    sheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(aFileName);

    sheet.SetFlags(IS_NEW | IS_MOVING);
    sheet.SetBorderWidth(schIUScale.milsToIU(cfg.drawing.default_line_thickness));
    sheet.SetBorderColor(parseColor4d(cfg.drawing.default_sheet_border_color));
    sheet.SetBackgroundColor(parseColor4d(cfg.drawing.default_sheet_background_color));
    this.sizeSheet(sheet, aEnd);

    const hierarchy = this.m_frame.Schematic().Hierarchy();
    const instance = this.m_frame.GetCurrentSheet().Clone();
    instance.push_back(sheet);

    // Find the next available page number by checking all existing page numbers
    const usedPageNumbers = new Set<number>();

    for (const path of hierarchy) {
      const pageNum = Number.parseInt(path.GetPageNumber(), 10);

      if (`${pageNum}` === path.GetPageNumber().trim() && pageNum > 0) usedPageNumbers.add(pageNum);
    }

    // Find the first available number starting from 1
    let nextAvailable = 1;

    while (usedPageNumbers.has(nextAvailable)) nextAvailable++;

    instance.SetPageNumber(`${nextAvailable}`);

    // EditSheetProperties: the dialog's file name goes through ChangeSheetFile.
    if (!this.m_frame.ChangeSheetFile(sheet, aFileName)) return null;

    sheet.ClearFlags(IS_NEW | IS_MOVING);
    sheet.AutoplaceFields(this.m_frame.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

    const commit = new SCH_COMMIT(this.m_frame);

    // We need to manually add the sheet to the screen otherwise annotation will not be able to find
    // the sheet and its symbols to annotate.
    this.m_frame.AddToScreen(sheet, this.m_frame.GetScreen());
    commit.Added(sheet, this.m_frame.GetScreen());

    // Refresh the hierarchy so the new sheet and its symbols are found during annotation.
    // The cached hierarchy was built before this sheet was added.
    this.m_frame.Schematic().RefreshHierarchy();

    // Automatic annotation of the new sheet's symbols (m_AnnotatePanel.automatic) runs on the
    // selection tool's ANNOTATE_SELECTION, which arrives with the tools (S5); a new file has none.

    commit.Push('Draw Sheet');
    return sheet;
  }

  /** `createNewSheetPin` (sch_drawing_tools.cpp:2003). */
  createNewSheetPin(aSheet: SCH_SHEET, aPosition: VECTOR2I): SCH_SHEET_PIN {
    const settings = aSheet.Schematic()!.Settings();
    const pin = new SCH_SHEET_PIN(aSheet);

    pin.SetFlags(IS_NEW | IS_MOVING);
    pin.SetText(`${aSheet.GetPins().length + 1}`);
    pin.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
    pin.SetPosition(aPosition);
    pin.ClearSelected();

    this.m_lastSheetPinType = pin.GetShape();

    return pin;
  }

  /** `createNewSheetPinFromLabel` (sch_drawing_tools.cpp:2020). */
  createNewSheetPinFromLabel(
    aSheet: SCH_SHEET,
    aPosition: VECTOR2I,
    aLabel: SCH_HIERLABEL,
  ): SCH_SHEET_PIN {
    const pin = this.createNewSheetPin(aSheet, aPosition);
    pin.SetText(aLabel.GetText());
    pin.SetShape(aLabel.GetShape());
    return pin;
  }

  /** `importHierLabel` (sch_drawing_tools.cpp:3873): the first, by name, without a pin yet. */
  importHierLabel(aSheet: SCH_SHEET): SCH_HIERLABEL | null {
    if (!aSheet.GetScreen()) return null;

    const labels = aSheet
      .GetScreen()!
      .Items()
      .OfType(KICAD_T.SCH_HIER_LABEL_T) as unknown as SCH_HIERLABEL[];

    const sorted = [...labels].sort((label1, label2) =>
      strNumCmp(label1.GetText(), label2.GetText(), true),
    );

    for (const label of sorted) {
      if (!aSheet.HasPin(label.GetText())) return label;
    }

    return null;
  }

  /** `importHierLabels` (sch_drawing_tools.cpp:3902): every one without a pin yet. */
  importHierLabels(aSheet: SCH_SHEET): SCH_HIERLABEL[] {
    if (!aSheet.GetScreen()) return [];

    const labels: SCH_HIERLABEL[] = [];

    for (const item of aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
      const label = item as unknown as SCH_HIERLABEL;

      if (!aSheet.HasPin(label.GetText())) labels.push(label);
    }

    return labels;
  }

  /**
   * `AutoPlaceAllSheetPins` (sch_drawing_tools.cpp:3714) on \a aSheet rather than the selection:
   * a pin for every hierarchical label without one, outputs down the right edge and the rest down
   * the left, stacked below the pins already there, the sheet grown to fit. Returns the number
   * placed (0: "No new hierarchical labels found.").
   */
  AutoPlaceAllSheetPins(aSheet: SCH_SHEET): number {
    const labels = this.importHierLabels(aSheet);

    if (labels.length === 0) return 0;

    const commit = new SCH_COMMIT(this.m_frame);
    commit.Modify(aSheet, this.m_frame.GetScreen());

    // Vertical pitch big enough to keep pin text from touching, snapped to grid.
    const grid = schIUScale.milsToIU(50);
    const textSize = aSheet.Schematic()!.Settings().m_DefaultTextSize;
    let pitch = Math.max(Math.round(textSize * 2.0), schIUScale.milsToIU(100));
    pitch = Math.round(pitch / grid) * grid;

    const margin = pitch;
    const leftX = aSheet.GetPosition().x;
    const rightX = aSheet.GetPosition().x + aSheet.GetSize().x;
    const topY = aSheet.GetPosition().y;

    // Stack new pins below whatever is already on each edge, without moving it.
    let leftY = topY + margin - pitch;
    let rightY = topY + margin - pitch;

    for (const pin of aSheet.GetPins()) {
      if (pin.GetSide() === SHEET_SIDE.RIGHT) rightY = Math.max(rightY, pin.GetPosition().y);
      else if (pin.GetSide() === SHEET_SIDE.LEFT) leftY = Math.max(leftY, pin.GetPosition().y);
    }

    // New pins: outputs on the right edge, everything else on the left.
    const leftLabels: SCH_HIERLABEL[] = [];
    const rightLabels: SCH_HIERLABEL[] = [];

    for (const label of labels) {
      if (label.GetShape() === LABEL_FLAG_SHAPE.L_OUTPUT) rightLabels.push(label);
      else leftLabels.push(label);
    }

    // std::sort with a->GetText() < b->GetText(): wxString's operator<, a plain code-unit compare.
    const byText = (a: SCH_HIERLABEL, b: SCH_HIERLABEL) =>
      a.GetText() < b.GetText() ? -1 : a.GetText() > b.GetText() ? 1 : 0;

    leftLabels.sort(byText);
    rightLabels.sort(byText);

    // Grow the sheet if the new pins would run past the bottom edge.
    const botLeft = leftY + leftLabels.length * pitch;
    const botRight = rightY + rightLabels.length * pitch;
    const needBot = Math.max(botLeft, botRight) + margin;

    if (needBot > topY + aSheet.GetSize().y)
      aSheet.SetSize({ x: aSheet.GetSize().x, y: needBot - topY });

    const placeColumn = (aLabels: SCH_HIERLABEL[], aX: number, aStartY: number) => {
      let y = Math.round(aStartY / grid) * grid;

      for (const label of aLabels) {
        y += pitch;

        const pin = this.createNewSheetPinFromLabel(aSheet, { x: aX, y }, label);
        pin.ClearFlags(IS_NEW | IS_MOVING);
        aSheet.AddPin(pin);
        pin.AutoplaceFields(this.m_frame.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);
      }
    };

    placeColumn(leftLabels, leftX, leftY);
    placeColumn(rightLabels, rightX, rightY);

    commit.Push('Auto-place Sheet Pins');
    return labels.length;
  }

  /**
   * `createNewLabel` (sch_drawing_tools.cpp:1854) for a hierarchical label, given the text the
   * label properties dialog would have been given; the caller places it (TwoClickPlace's commit).
   */
  createNewHierLabel(aPosition: VECTOR2I, aText: string, aShape: LABEL_FLAG_SHAPE): SCH_LABEL_BASE {
    const settings = this.m_frame.Schematic().Settings();
    const labelItem = new SCH_HIERLABEL(aPosition);
    labelItem.SetShape(this.m_lastGlobalLabelShape);
    labelItem.SetAutoRotateOnPlacement(this.m_lastAutoLabelRotateOnPlacement);

    // The normal parent is the current screen for these labels, set by SCH_SCREEN::Append()
    // but it is also used during placement for SCH_HIERLABEL before beeing appended
    labelItem.SetParent(this.m_frame.GetScreen());

    labelItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });

    // Must be after SetTextSize()
    labelItem.SetBold(this.m_lastTextBold);
    labelItem.SetItalic(this.m_lastTextItalic);

    labelItem.SetSpinStyle(this.m_lastTextOrientation);
    labelItem.SetFlags(IS_NEW | IS_MOVING);

    // DIALOG_LABEL_PROPERTIES: the text and shape it would have been given.
    labelItem.SetText(aText);
    labelItem.SetShape(aShape);

    this.m_lastTextBold = labelItem.IsBold();
    this.m_lastTextItalic = labelItem.IsItalic();
    this.m_lastTextOrientation = labelItem.GetSpinStyle();
    this.m_lastGlobalLabelShape = labelItem.GetShape();
    this.m_lastAutoLabelRotateOnPlacement = labelItem.AutoRotateOnPlacement();

    return labelItem;
  }
}
