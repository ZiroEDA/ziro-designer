// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DRAWING_TOOLS` (eeschema/tools/sch_drawing_tools.{h,cpp}): the tool that places items on
 * the live model. Single-click items (no-connects, junctions, bus entries), two-click items
 * (labels, text, sheet pins), sheets, and the sheet-pin helpers are here (S5-5a); symbols, shapes,
 * rule areas, tables, images and imports follow.
 *
 * Every dialog is the window's, through SCH_EDIT_FRAME::ShowModalDialog / EditSheetProperties.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { IS_MOVING, IS_NEW, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { parseColor4d } from '@ziroeda/common/gal/color4d.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { type KIID, newKiid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import { NULL_REPORTER } from '@ziroeda/common/reporter.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import type { SELECTION_CONDITION } from '@ziroeda/common/tool/selection_conditions.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  MD_SHIFT,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type SCH_BUS_ENTRY_BASE, SCH_BUS_WIRE_ENTRY } from '../sch_bus_entry.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../sch_item.js';
import { SCH_JUNCTION } from '../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../sch_label.js';
import type { SCH_LINE } from '../sch_line.js';
import { SCH_NO_CONNECT } from '../sch_no_connect.js';
import {
  type ANNOTATE_ALGO_T,
  type ANNOTATE_ORDER_T,
  ANNOTATE_SCOPE_T,
} from '../sch_reference_list.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { MIN_SHEET_HEIGHT, MIN_SHEET_WIDTH, SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_PATH, SYMBOL_FILTER } from '../sch_sheet_path.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../sch_sheet_pin.js';
import { SCH_TEXT } from '../sch_text.js';
import type { SCHEMATIC } from '../schematic.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

/** `FILEEXT::KiCadSchematicFileExtension` (wildcards_and_files_ext.cpp). */
const KiCadSchematicFileExtension = 'kicad_sch';

export class SCH_DRAWING_TOOLS extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  // The tool's memory of the last choices (sch_drawing_tools.cpp:83-104).
  m_lastSheetPinType: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastGlobalLabelShape: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastNetClassFlagShape: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.F_ROUND;
  m_lastTextOrientation: SPIN_STYLE = new SPIN_STYLE(SPIN_STYLE.RIGHT);
  m_lastTextBold = false;
  m_lastTextItalic = false;
  m_lastTextAngle: EDA_ANGLE = ANGLE_0;
  m_lastTextboxAngle: EDA_ANGLE = ANGLE_0;
  m_lastTextHJustify: GR_TEXT_H_ALIGN_T = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
  m_lastTextVJustify: GR_TEXT_V_ALIGN_T = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
  m_lastTextboxHJustify: GR_TEXT_H_ALIGN_T = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
  m_lastTextboxVJustify: GR_TEXT_V_ALIGN_T = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
  m_lastFillStyle: FILL_T = FILL_T.NO_FILL;
  m_lastTextboxFillStyle: FILL_T = FILL_T.NO_FILL;
  m_mruPath = '';
  m_lastAutoLabelRotateOnPlacement = false;
  m_drawingRuleArea = false;

  private m_inDrawingTool = false; // Re-entrancy guard

  /**
   * \a aFrame is TS-only: a caller with no TOOL_MANAGER (the AI's headless frame) hands its frame
   * here and uses only the members that need nothing else (sizeSheet, createNewSheetPin…,
   * importHierLabel(s), autoPlaceSheetPins). A registered tool gets its frame from Init.
   */
  constructor(aFrame: SCH_EDIT_FRAME | null = null) {
    super('eeschema.InteractiveDrawing');
    this.m_frame = aFrame;
  }

  override Init(): boolean {
    super.Init();

    const belowRootSheetCondition: SELECTION_CONDITION = () =>
      this.m_frame!.GetCurrentSheet().Last() !== this.m_frame!.Schematic().Root();

    const inDrawingRuleArea: SELECTION_CONDITION = () => this.m_drawingRuleArea;

    const ctxMenu = this.m_menu.GetMenu();
    ctxMenu.AddItem(SCH_ACTIONS.leaveSheet, belowRootSheetCondition, 150);
    ctxMenu.AddItem(SCH_ACTIONS.closeOutline, inDrawingRuleArea, 200);
    ctxMenu.AddItem(SCH_ACTIONS.deleteLastPoint, inDrawingRuleArea, 200);

    return true;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as VIEW_CONTROLS;
  }

  private schematic(): SCHEMATIC {
    return this.m_frame!.Schematic();
  }

  *SingleClickPlace(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let cursorPos: VECTOR2I = { x: 0, y: 0 };
    const type = aEvent.Parameter<KICAD_T>();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const controls = this.controls();
    let previewItem: SCH_ITEM;
    let loggedInfoBarError = false;
    let description: string;
    const screen = this.m_frame!.GetScreen()!;
    let allowRepeat = false; // Set to true to allow new item repetition

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      if (type === KICAD_T.SCH_JUNCTION_T && aEvent.HasPosition()) {
        const selection = this.m_selectionTool!.GetSelection();
        const front = selection.Front();
        const wire = front?.Type() === KICAD_T.SCH_LINE_T ? (front as SCH_LINE) : null;

        if (wire) {
          const seg = new SEG(wire.GetStartPoint(), wire.GetEndPoint());
          const nearest = seg.NearestPoint(controls.GetCursorPosition());
          controls.SetCrossHairCursorPosition(nearest, false);
          controls.WarpMouseCursor(controls.GetCursorPosition(), true);
        }
      }

      switch (type) {
        case KICAD_T.SCH_NO_CONNECT_T:
          previewItem = new SCH_NO_CONNECT(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add No Connect Flag';
          allowRepeat = true;
          break;

        case KICAD_T.SCH_JUNCTION_T:
          previewItem = new SCH_JUNCTION(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add Junction';
          break;

        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
          previewItem = new SCH_BUS_WIRE_ENTRY(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add Wire to Bus Entry';
          allowRepeat = true;
          break;

        default:
          // wxASSERT_MSG( false, "Unknown item type in SCH_DRAWING_TOOLS::SingleClickPlace" )
          return 0;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      cursorPos = aEvent.HasPosition() ? aEvent.Position() : controls.GetMousePosition();

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PLACE);
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      this.m_view!.ClearPreview();
      this.m_view!.AddToPreview(previewItem.Clone());

      // Prime the pump
      if (aEvent.HasPosition() && (type as KICAD_T) !== KICAD_T.SCH_SHEET_PIN_T)
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      else this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = evt.IsPrime() ? evt.Position() : controls.GetMousePosition();
        cursorPos = grid.BestSnapAnchor(cursorPos, grid.GetItemGrid(previewItem), null);
        controls.ForceCursorPosition(true, cursorPos);

        if (evt.IsCancelInteractive()) {
          this.m_frame!.PopTool(aEvent);
          break;
        } else if (evt.IsActivate()) {
          if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          if (!screen.GetItem(cursorPos, 0, type)) {
            if (type === KICAD_T.SCH_JUNCTION_T) {
              if (!screen.IsExplicitJunctionAllowed(cursorPos)) {
                this.m_frame!.ShowInfoBarError(
                  'Junction location contains no joinable wires and/or pins.',
                );
                loggedInfoBarError = true;
                continue;
              } else if (loggedInfoBarError) {
                this.m_frame!.GetInfoBar()?.Dismiss();
              }
            }

            if (type === KICAD_T.SCH_JUNCTION_T) {
              const commit = new SCH_COMMIT(this.m_toolMgr!);
              const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
              lwbTool.AddJunction(commit, screen, cursorPos);

              this.schematic().CleanUp(commit);

              commit.Push(description);
            } else {
              const newItem = previewItem.Clone() as SCH_ITEM;
              (newItem as { m_Uuid: KIID }).m_Uuid = newKiid();
              newItem.SetPosition(cursorPos);
              newItem.SetFlags(IS_NEW);
              this.m_frame!.AddToScreen(newItem, screen);

              if (allowRepeat) this.m_frame!.SaveCopyForRepeatItem(newItem);

              const commit = new SCH_COMMIT(this.m_toolMgr!);
              commit.Added(newItem, screen);

              this.schematic().CleanUp(commit);

              commit.Push(description);
            }
          }

          if (evt.IsDblClick(BUT_LEFT) || (type as KICAD_T) === KICAD_T.SCH_SHEET_PIN_T) {
            // Finish tool.
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion()) {
          previewItem.SetPosition(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(previewItem.Clone());
          this.m_frame!.SetMsgPanel(previewItem);
        } else if (evt.Category() === TC_COMMAND) {
          if (
            type === KICAD_T.SCH_BUS_WIRE_ENTRY_T &&
            (evt.IsAction(SCH_ACTIONS.rotateCW) ||
              evt.IsAction(SCH_ACTIONS.rotateCCW) ||
              evt.IsAction(SCH_ACTIONS.mirrorV) ||
              evt.IsAction(SCH_ACTIONS.mirrorH))
          ) {
            const busItem = previewItem as SCH_BUS_ENTRY_BASE;

            if (evt.IsAction(SCH_ACTIONS.rotateCW)) {
              busItem.Rotate(busItem.GetPosition(), false);
            } else if (evt.IsAction(SCH_ACTIONS.rotateCCW)) {
              busItem.Rotate(busItem.GetPosition(), true);
            } else if (evt.IsAction(SCH_ACTIONS.mirrorV)) {
              busItem.MirrorVertically(busItem.GetPosition().y);
            } else if (evt.IsAction(SCH_ACTIONS.mirrorH)) {
              busItem.MirrorHorizontally(busItem.GetPosition().x);
            }

            this.m_view!.ClearPreview();
            this.m_view!.AddToPreview(previewItem.Clone());
          } else if (evt.IsAction(SCH_ACTIONS.properties)) {
            switch (type) {
              case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
                yield* this.RunMainStackModal(() =>
                  this.m_frame!.ShowModalDialog('DIALOG_WIRE_BUS_PROPERTIES', [previewItem]),
                );
                break;

              case KICAD_T.SCH_JUNCTION_T:
                yield* this.RunMainStackModal(() =>
                  this.m_frame!.ShowModalDialog('DIALOG_JUNCTION_PROPS', [previewItem]),
                );
                break;

              default:
                // Do nothing
                break;
            }

            this.m_view!.ClearPreview();
            this.m_view!.AddToPreview(previewItem.Clone());
          } else {
            evt.SetPassEvent();
          }
        } else {
          evt.SetPassEvent();
        }
      }

      this.m_view!.ClearPreview();

      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      controls.ForceCursorPosition(false);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  private findWire(aPosition: VECTOR2I): SCH_LINE | null {
    for (const item of this.m_frame!.GetScreen()!
      .Items()
      .Overlapping(KICAD_T.SCH_LINE_T, aPosition)) {
      const line = item as SCH_LINE;

      if (line.GetEditFlags() & STRUCT_DELETED) continue;

      if (line.IsWire()) return line;
    }

    return null;
  }

  ///< Gets the (global) label name driving this wire, if it is driven by a label
  private findWireLabelDriverName(aWire: SCH_LINE): string {
    const sheetPath = this.m_frame!.GetCurrentSheet();
    const wireConnection = aWire.Connection(sheetPath);

    if (wireConnection) {
      const wireDriver = wireConnection.Driver();

      if (wireDriver?.IsType([KICAD_T.SCH_LABEL_T, KICAD_T.SCH_GLOBAL_LABEL_T]))
        return wireConnection.LocalName();
    }

    return '';
  }

  /**
   * `createNewLabel` (sch_drawing_tools.cpp:1854): a label of \a aType (its layer), named from the
   * wire it lands on or by DIALOG_LABEL_PROPERTIES, which may itself fill \a aLabelList (a pasted
   * list of names). False when the dialog was cancelled.
   */
  *createNewLabel(
    aPosition: VECTOR2I,
    aType: SCH_LAYER_ID,
    aLabelList: SCH_LABEL_BASE[],
  ): COROUTINE_BODY<boolean> {
    const settings = this.schematic().Settings();
    let labelItem: SCH_LABEL_BASE;
    let netName = '';

    switch (aType) {
      case SCH_LAYER_ID.LAYER_LOCLABEL: {
        labelItem = new SCH_LABEL(aPosition);

        const wire = this.findWire(aPosition);

        if (wire) netName = this.findWireLabelDriverName(wire);

        break;
      }

      case SCH_LAYER_ID.LAYER_NETCLASS_REFS: {
        labelItem = new SCH_DIRECTIVE_LABEL(aPosition);
        labelItem.SetShape(this.m_lastNetClassFlagShape);
        labelItem.GetFields().push(new SCH_FIELD(labelItem, FIELD_T.USER, 'Netclass'));
        labelItem.GetFields().push(new SCH_FIELD(labelItem, FIELD_T.USER, 'Component Class'));
        const last = labelItem.GetFields()[labelItem.GetFields().length - 1]!;
        last.SetItalic(true);
        last.SetVisible(true);
        break;
      }

      case SCH_LAYER_ID.LAYER_HIERLABEL:
        labelItem = new SCH_HIERLABEL(aPosition);
        labelItem.SetShape(this.m_lastGlobalLabelShape);
        labelItem.SetAutoRotateOnPlacement(this.m_lastAutoLabelRotateOnPlacement);
        break;

      case SCH_LAYER_ID.LAYER_GLOBLABEL: {
        const globalLabel = new SCH_GLOBALLABEL(aPosition);
        globalLabel.SetShape(this.m_lastGlobalLabelShape);
        globalLabel.GetField(FIELD_T.INTERSHEET_REFS)!.SetVisible(settings.m_IntersheetRefsShow);
        globalLabel.SetAutoRotateOnPlacement(this.m_lastAutoLabelRotateOnPlacement);
        labelItem = globalLabel;

        const wire = this.findWire(aPosition);

        if (wire) netName = this.findWireLabelDriverName(wire);

        break;
      }

      default:
        // wxFAIL_MSG( "SCH_DRAWING_TOOLS::createNewLabel() unknown label type" )
        return false;
    }

    // The normal parent is the current screen for these labels, set by SCH_SCREEN::Append()
    // but it is also used during placement for SCH_HIERLABEL before beeing appended
    labelItem.SetParent(this.m_frame!.GetScreen());

    labelItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });

    if (aType !== SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      // Must be after SetTextSize()
      labelItem.SetBold(this.m_lastTextBold);
      labelItem.SetItalic(this.m_lastTextItalic);
    }

    labelItem.SetSpinStyle(this.m_lastTextOrientation);
    labelItem.SetFlags(IS_NEW | IS_MOVING);

    if (netName !== '') {
      // Auto-create from attached wire
      labelItem.SetText(netName);
    } else {
      // DIALOG_LABEL_PROPERTIES dlg( m_frame, labelItem, true ); dlg.SetLabelList( &aLabelList ):
      // QuasiModal required for syntax help and Scintilla auto-complete
      if (
        (yield* this.RunMainStackModal(() =>
          this.m_frame!.ShowModalDialog('DIALOG_LABEL_PROPERTIES', [labelItem], {
            isNew: true,
            labelList: aLabelList,
          }),
        )) !== wxID_OK
      )
        return false;
    }

    if (aType !== SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      this.m_lastTextBold = labelItem.IsBold();
      this.m_lastTextItalic = labelItem.IsItalic();
    }

    this.m_lastTextOrientation = labelItem.GetSpinStyle();

    if (aType === SCH_LAYER_ID.LAYER_GLOBLABEL || aType === SCH_LAYER_ID.LAYER_HIERLABEL) {
      this.m_lastGlobalLabelShape = labelItem.GetShape();
      this.m_lastAutoLabelRotateOnPlacement = labelItem.AutoRotateOnPlacement();
    } else if (aType === SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      this.m_lastNetClassFlagShape = labelItem.GetShape();
    }

    // DIALOG_LABEL_PROPERTIES already filled in aLabelList when it is not empty; labelItem is
    // then extraneous to needs
    if (aLabelList.length === 0) aLabelList.push(labelItem);

    return true;
  }

  private *createNewText(aPosition: VECTOR2I): COROUTINE_BODY<SCH_TEXT | null> {
    const schematic = this.schematic();
    const settings = schematic.Settings();

    const textItem = new SCH_TEXT(aPosition);
    textItem.SetParent(schematic);
    textItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
    // Must be after SetTextSize()
    textItem.SetBold(this.m_lastTextBold);
    textItem.SetItalic(this.m_lastTextItalic);
    textItem.SetHorizJustify(this.m_lastTextHJustify);
    textItem.SetVertJustify(this.m_lastTextVJustify);
    textItem.SetTextAngle(this.m_lastTextAngle);
    textItem.SetFlags(IS_NEW | IS_MOVING);

    // DIALOG_TEXT_PROPERTIES: QuasiModal required for syntax help and Scintilla auto-complete
    if (
      (yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [textItem]),
      )) !== wxID_OK
    )
      return null;

    this.m_lastTextBold = textItem.IsBold();
    this.m_lastTextItalic = textItem.IsItalic();
    this.m_lastTextHJustify = textItem.GetHorizJustify();
    this.m_lastTextVJustify = textItem.GetVertJustify();
    this.m_lastTextAngle = textItem.GetTextAngle();
    return textItem;
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

  /**
   * TwoClickPlace. The Sync Sheet Pins dialog's placement template (m_dialogSyncSheetPin) is not
   * ported: that dialog is the window's, and it places through placeHierLabel / placeSheetPin as
   * the plain tools do.
   */
  *TwoClickPlace(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let item: SCH_ITEM | null = null;
    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    let ignorePrimePosition = false;
    const common_settings = Pgm().GetCommonSettings();
    let sheet: SCH_SHEET | null = null;
    let description = '';

    const itemsToPlace: SCH_LABEL_BASE[] = [];

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const isText = aEvent.IsAction(SCH_ACTIONS.placeSchematicText);
      const isGlobalLabel = aEvent.IsAction(SCH_ACTIONS.placeGlobalLabel);
      const isHierLabel = aEvent.IsAction(SCH_ACTIONS.placeHierLabel);
      const isClassLabel = aEvent.IsAction(SCH_ACTIONS.placeClassLabel);
      const isNetLabel = aEvent.IsAction(SCH_ACTIONS.placeLabel);
      const isSheetPin = aEvent.IsAction(SCH_ACTIONS.placeSheetPin);

      const snapGrid = isText ? GRID_HELPER_GRIDS.GRID_TEXT : GRID_HELPER_GRIDS.GRID_CONNECTABLE;

      // If we have a selected sheet use it, otherwise try to get one under the cursor
      if (isSheetPin) {
        const front = this.m_selectionTool!.GetSelection().Front();
        sheet = front instanceof SCH_SHEET ? front : null;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        const canvas = this.m_frame!.GetCanvas();

        if (item) canvas?.SetCurrentCursor(KICURSOR.PLACE);
        else if (isText) canvas?.SetCurrentCursor(KICURSOR.TEXT);
        else if (isGlobalLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_GLOBAL);
        else if (isNetLabel || isClassLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_NET);
        else if (isHierLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_HIER);
        else canvas?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const updatePreview = () => {
        this.m_view!.ClearPreview();
        this.m_view!.AddToPreview(item!, false);
        item!.RunOnChildren((aChild: SCH_ITEM) => {
          this.m_view!.AddToPreview(aChild, false);
        }, RECURSE_MODE.NO_RECURSE);
        this.m_frame!.SetMsgPanel(item!);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        item = null;

        itemsToPlace.length = 0;
      };

      const prepItemForPlacement = (aItem: SCH_ITEM, cursorPos: VECTOR2I) => {
        aItem.SetPosition(cursorPos);

        aItem.SetFlags(IS_NEW | IS_MOVING);

        // Not placed yet, so pass a nullptr screen reference
        aItem.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

        updatePreview();
        this.m_selectionTool!.ClearSelection(true);
        this.m_selectionTool!.AddItemToSel(aItem);
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

        // update the cursor so it looks correct before another event
        setCursor();
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) {
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      } else if (
        (common_settings?.m_Input.immediate_actions ?? true) &&
        !aEvent.IsReactivate() &&
        (isText || isGlobalLabel || isHierLabel || isClassLabel || isNetLabel)
      ) {
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
        ignorePrimePosition = true;
      }

      const commit = new SCH_COMMIT(this.m_toolMgr!);

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        let cursorPos = controls.GetMousePosition();
        cursorPos = grid.BestSnapAnchor(cursorPos, snapGrid, item);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!item && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || evt.IsAction(ACTIONS.undo)) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (item) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (item && evt.IsMoveTool()) {
            // we're already moving our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (item) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel item creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          isSyntheticClick ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          // First click creates...
          if (!item) {
            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            if (isText) {
              item = yield* this.createNewText(cursorPos);
              description = 'Add Text';
            } else if (isHierLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_HIERLABEL, itemsToPlace);
              description = 'Add Hierarchical Label';
            } else if (isNetLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_LOCLABEL, itemsToPlace);
              description = 'Add Label';
            } else if (isGlobalLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_GLOBLABEL, itemsToPlace);
              description = 'Add Label';
            } else if (isClassLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_NETCLASS_REFS, itemsToPlace);
              description = 'Add Label';
            } else if (isSheetPin) {
              const i: { value: EDA_ITEM | null } = { value: null };

              // If we didn't have a sheet selected, try to find one under the cursor
              if (
                !sheet &&
                (yield* this.m_selectionTool!.SelectPoint(cursorPos, [KICAD_T.SCH_SHEET_T], i))
              )
                sheet = i.value instanceof SCH_SHEET ? i.value : null;

              if (!sheet) {
                // STATUS_TEXT_POPUP "Click over a sheet." for 2 s: the infobar here.
                this.m_frame!.ShowInfoBarMsg('Click over a sheet.');
                item = null;
              } else {
                // User is using the 'Place Sheet Pins' tool
                const label = this.importHierLabel(sheet);

                if (!label) {
                  this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');
                  item = null;

                  this.m_frame!.PopTool(aEvent);
                  break;
                }

                item = this.createNewSheetPinFromLabel(sheet, cursorPos, label);
              }

              description = 'Add Sheet Pin';
            }

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = grid.Align(evt.Position());
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = controls.GetMousePosition();
              cursorPos = grid.BestSnapAnchor(cursorPos, snapGrid, item);
            }

            if (itemsToPlace.length > 0) item = itemsToPlace.shift()!;

            if (item) prepItemForPlacement(item, cursorPos);

            if (this.m_frame!.GetMoveWarpsCursor()) controls.SetCursorPosition(cursorPos, false);

            this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          } else {
            // ... and second click places:
            const placed: SCH_ITEM = item;
            placed.ClearFlags(IS_MOVING);

            if (placed.IsConnectable())
              this.m_frame!.AutoRotateItem(this.m_frame!.GetScreen()!, placed);

            if (isSheetPin && sheet) {
              // Sheet pins are owned by their parent sheet.
              commit.Modify(sheet, this.m_frame!.GetScreen());
              sheet.AddPin(placed as SCH_SHEET_PIN);
            } else {
              this.m_frame!.SaveCopyForRepeatItem(placed);
              this.m_frame!.AddToScreen(placed, this.m_frame!.GetScreen());
              commit.Added(placed, this.m_frame!.GetScreen());
            }

            placed.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

            commit.Push(description);

            this.m_view!.ClearPreview();

            item = null;

            if (isSheetPin && sheet) {
              const label = this.importHierLabel(sheet);

              if (!label) {
                this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');

                this.m_frame!.PopTool(aEvent);
                break;
              }

              item = this.createNewSheetPinFromLabel(sheet, cursorPos, label);
            } else if (itemsToPlace.length > 0) {
              item = itemsToPlace.shift()!;
              prepItemForPlacement(item, cursorPos);
            }
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (item && evt.IsSelectionEvent()) {
          // This happens if our text was replaced out from under us by ConvertTextType()
          const selection = this.m_selectionTool!.GetSelection();

          if (selection.GetSize() === 1) {
            item = selection.Front() as SCH_ITEM;
            updatePreview();
          } else {
            item = null;
          }
        } else if (evt.IsAction(ACTIONS.increment)) {
          if (evt.HasParameter())
            this.m_toolMgr!.RunSynchronousAction(
              ACTIONS.increment,
              commit,
              evt.Parameter<INCREMENT>(),
            );
          else
            this.m_toolMgr!.RunSynchronousAction<INCREMENT>(ACTIONS.increment, commit, {
              Delta: 1,
              Index: 0,
            });
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (item) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          item.SetPosition(cursorPos);

          // Not placed yet, so pass a nullptr screen reference
          item.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          updatePreview();
        } else if (item && evt.IsAction(ACTIONS.doDelete)) {
          cleanup();
        } else if (evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else if (
          item &&
          (evt.IsAction(SCH_ACTIONS.toDLabel) ||
            evt.IsAction(SCH_ACTIONS.toGLabel) ||
            evt.IsAction(SCH_ACTIONS.toHLabel) ||
            evt.IsAction(SCH_ACTIONS.toLabel) ||
            evt.IsAction(SCH_ACTIONS.toText) ||
            evt.IsAction(SCH_ACTIONS.toTextBox))
        ) {
          wxBell();
        } else if (
          item &&
          (evt.IsAction(SCH_ACTIONS.properties) ||
            evt.IsAction(SCH_ACTIONS.autoplaceFields) ||
            evt.IsAction(SCH_ACTIONS.rotateCW) ||
            evt.IsAction(SCH_ACTIONS.rotateCCW) ||
            evt.IsAction(SCH_ACTIONS.mirrorV) ||
            evt.IsAction(SCH_ACTIONS.mirrorH))
        ) {
          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          evt.SetPassEvent();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is an item to be placed
        controls.SetAutoPan(item !== null);
        controls.CaptureCursor(item !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      controls.ForceCursorPosition(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /**
   * DrawSheet. drawSheetFromDesignBlock (a DESIGN_BLOCK's schematic) is not ported yet: the design
   * block libraries are not on the live model.
   */
  *DrawSheet(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const isDrawSheetCopy = aEvent.IsAction(SCH_ACTIONS.drawSheetFromFile);

    let sheet: SCH_SHEET | null = null;
    let filename = '';

    if (isDrawSheetCopy) {
      const ptr = aEvent.Parameter<string>();

      if (!ptr) return 0; // wxCHECK

      // We own the string if we're importing a sheet
      filename = ptr;
    }

    if (isDrawSheetCopy && !this.m_frame!.FileExists(filename)) {
      this.m_frame!.DisplayError(`File '${filename}' does not exist.`);
      return 0;
    }

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const cfg = this.m_frame!.eeconfig();
      // m_DesignBlockChooserPanel lives on APP_SETTINGS_BASE, not in the eeschema JSON slice
      const designBlockChooser = this.m_frame!.config()?.m_DesignBlockChooserPanel;
      const schSettings = this.schematic().Settings();
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };
      let startedWithDrag = false; // Track if initial sheet placement started with a drag

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        sheet = null;
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition() && !isDrawSheetCopy) this.m_toolMgr!.PrimeTool(aEvent.Position());

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!sheet && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (sheet && evt.IsAction(ACTIONS.undo))) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (sheet) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (sheet && evt.IsMoveTool()) {
            // we're already drawing our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (sheet) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel sheet creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          !sheet &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsDrag(BUT_LEFT))
        ) {
          const selection = this.m_selectionTool!.GetSelection();

          if (
            selection.Size() === 1 &&
            selection.Front()!.Type() === KICAD_T.SCH_SHEET_T &&
            selection.Front()!.GetBoundingBox().Contains(cursorPos)
          ) {
            if (evt.IsClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorClick)) {
              // sheet already selected
              continue;
            } else if (evt.IsDblClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorDblClick)) {
              this.m_toolMgr!.PostAction(SCH_ACTIONS.enterSheet);
              this.m_frame!.PopTool(aEvent);
              break;
            }
          }

          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          const sheetPos = evt.IsDrag(BUT_LEFT)
            ? grid.Align(evt.DragOrigin(), GRID_HELPER_GRIDS.GRID_GRAPHICS)
            : cursorPos;

          // Remember whether this sheet was initiated with a drag so we can treat mouse-up as
          // the terminating (second) click.
          startedWithDrag = evt.IsDrag(BUT_LEFT);

          const newSheet = new SCH_SHEET(this.m_frame!.GetCurrentSheet().Last(), sheetPos);
          sheet = newSheet;
          newSheet.SetScreen(null);

          const ext = `.${KiCadSchematicFileExtension}`;

          if (isDrawSheetCopy) {
            // wxFileName( filename ).GetName(): the base name without directory or extension
            const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

            newSheet.GetField(FIELD_T.SHEET_NAME)!.SetText(base);
            newSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(base + ext);
          } else {
            newSheet.GetField(FIELD_T.SHEET_NAME)!.SetText('Untitled Sheet');
            newSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(`untitled${ext}`);
          }

          newSheet.SetFlags(IS_NEW | IS_MOVING);

          if (cfg) {
            newSheet.SetBorderWidth(schIUScale.milsToIU(cfg.drawing.default_line_thickness));
            newSheet.SetBorderColor(parseColor4d(cfg.drawing.default_sheet_border_color));
            newSheet.SetBackgroundColor(parseColor4d(cfg.drawing.default_sheet_background_color));
          }

          this.sizeSheet(newSheet, cursorPos);

          const hierarchy = this.schematic().Hierarchy();
          const instance = this.m_frame!.GetCurrentSheet().Clone();
          instance.push_back(newSheet);

          // Find the next available page number by checking all existing page numbers
          const usedPageNumbers = new Set<number>();

          for (const path of hierarchy) {
            const existingPageNum = path.GetPageNumber();
            // wxString::ToLong: the whole string must be a number
            const pageNum = /^\s*[-+]?\d+$/.test(existingPageNum)
              ? Number.parseInt(existingPageNum, 10)
              : 0;

            if (pageNum > 0) usedPageNumbers.add(pageNum);
          }

          // Find the first available number starting from 1
          let nextAvailable = 1;

          while (usedPageNumbers.has(nextAvailable)) nextAvailable++;

          instance.SetPageNumber(`${nextAvailable}`);

          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(newSheet.Clone());
        } else if (
          sheet &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            isSyntheticClick ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(ACTIONS.finishInteractive) ||
            (startedWithDrag && evt.IsMouseUp(BUT_LEFT)))
        ) {
          const placed: SCH_SHEET = sheet;
          controls.SetAutoPan(false);
          controls.CaptureCursor(false);

          if (
            yield* this.RunMainStackModal(() =>
              this.m_frame!.EditSheetProperties(
                placed,
                this.m_frame!.GetCurrentSheet(),
                isDrawSheetCopy ? filename : undefined,
              ),
            )
          ) {
            this.m_view!.ClearPreview();

            placed.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

            // Use the commit we were provided or make our own
            const eventCommit = evt.Commit();
            const c =
              eventCommit instanceof SCH_COMMIT ? eventCommit : new SCH_COMMIT(this.m_toolMgr!);

            // We need to manually add the sheet to the screen otherwise annotation will not be able
            // to find the sheet and its symbols to annotate.
            this.m_frame!.AddToScreen(placed);
            c.Added(placed, this.m_frame!.GetScreen());

            // Refresh the hierarchy so the new sheet and its symbols are found during annotation.
            // The cached hierarchy was built before this sheet was added.
            this.schematic().RefreshHierarchy();

            const annotateNonPowerSymbols =
              !!cfg?.annotation.automatic &&
              !(isDrawSheetCopy && !!designBlockChooser?.keep_annotations);

            if (annotateNonPowerSymbols) {
              // Annotation will remove this from selection, but we add it back later
              this.m_selectionTool!.AddItemToSel(placed);

              this.m_frame!.AnnotateSymbols(
                c,
                ANNOTATE_SCOPE_T.ANNOTATE_SELECTION,
                schSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T,
                schSettings.m_AnnotateMethod as ANNOTATE_ALGO_T,
                true /* recursive */,
                schSettings.m_AnnotateStartNum,
                true /* reset */,
                false /* regroup */,
                false /* repair */,
                NULL_REPORTER.GetInstance(),
                SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
              );
            }

            c.Push(isDrawSheetCopy ? 'Import Sheet Copy' : 'Draw Sheet');

            this.m_selectionTool!.AddItemToSel(placed);

            if (isDrawSheetCopy && !designBlockChooser?.repeated_placement) {
              this.m_frame!.PopTool(aEvent);
              sheet = null;
              break;
            }
          } else {
            this.m_view!.ClearPreview();
          }

          sheet = null;
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (sheet) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (
          sheet &&
          (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion() || evt.IsDrag(BUT_LEFT))
        ) {
          const sizing: SCH_SHEET = sheet;
          this.sizeSheet(sizing, cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(sizing.Clone());
          this.m_frame!.SetMsgPanel(sizing);
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!sheet) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (sheet && evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a sheet to be placed
        controls.SetAutoPan(sheet !== null);
        controls.CaptureCursor(sheet !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /** `sizeSheet` (sch_drawing_tools.cpp:3603): size \a aSheet to reach \a aPos, at least the minimum. */
  sizeSheet(aSheet: SCH_SHEET, aPos: VECTOR2I): void {
    const pos = aSheet.GetPosition();
    const size = { x: aPos.x - pos.x, y: aPos.y - pos.y };

    size.x = Math.max(size.x, schIUScale.milsToIU(MIN_SHEET_WIDTH));
    size.y = Math.max(size.y, schIUScale.milsToIU(MIN_SHEET_HEIGHT));

    const grid = this.m_frame!.GetNearestGridPosition({ x: pos.x + size.x, y: pos.y + size.y });
    aSheet.Resize({ x: grid.x - pos.x, y: grid.y - pos.y });
  }

  /**
   * `doSyncSheetsPins` (sch_drawing_tools.cpp:3616): DIALOG_SYNC_SHEET_PINS over \a aSheetPaths.
   * The dialog and its SHEET_SYNCHRONIZATION_AGENT are the window's.
   */
  private doSyncSheetsPins(
    aSheetPaths: SCH_SHEET_PATH[],
    aInitialSheet: SCH_SHEET | null = null,
  ): number {
    if (aSheetPaths.length === 0) return 0;

    void this.m_frame!.ShowModalDialog('DIALOG_SYNC_SHEET_PINS', [], {
      sheetPaths: aSheetPaths,
      initialSheet: aInitialSheet,
    });
    return 0;
  }

  *SyncSheetsPins(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const front = this.m_selectionTool!.GetSelection().Front();
    let sheet = front instanceof SCH_SHEET ? front : null;

    if (!sheet) {
      const cursorPos = this.controls().GetMousePosition();
      const i: { value: EDA_ITEM | null } = { value: null };

      yield* this.m_selectionTool!.SelectPoint(cursorPos, [KICAD_T.SCH_SHEET_T], i);

      if (i.value) sheet = i.value instanceof SCH_SHEET ? i.value : null;
    }

    if (sheet) {
      const current = this.m_frame!.GetCurrentSheet().Clone();
      current.push_back(sheet);
      return this.doSyncSheetsPins([current]);
    }

    return 0;
  }

  /**
   * AutoPlaceAllSheetPins: a pin for every hierarchical label of the selected sheet that has none.
   * The work after the selection is autoPlaceSheetPins, which the AI calls with a sheet in hand.
   */
  AutoPlaceAllSheetPins(_aEvent: TOOL_EVENT): number {
    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const front = this.m_selectionTool!.GetSelection().Front();
      const sheet = front instanceof SCH_SHEET ? front : null;

      if (!sheet) return 0;

      if (this.importHierLabels(sheet).length === 0) {
        // m_statusPopup "No new hierarchical labels found." for 2 s: the infobar here.
        this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view?.ClearPreview();
        return 0;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.autoPlaceSheetPins(sheet);
      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /**
   * AutoPlaceAllSheetPins' body from the commit on (sch_drawing_tools.cpp:3744-3818): pins for
   * \a aSheet's unmatched hierarchical labels, outputs down the right edge and the rest down the
   * left, stacked below the pins already there, the sheet grown to fit. Returns how many.
   */
  autoPlaceSheetPins(aSheet: SCH_SHEET): number {
    const labels = this.importHierLabels(aSheet);

    if (labels.length === 0) return 0;

    const commit = this.m_toolMgr ? new SCH_COMMIT(this.m_toolMgr) : new SCH_COMMIT(this.m_frame!);
    commit.Modify(aSheet, this.m_frame!.GetScreen());

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
        pin.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);
      }
    };

    placeColumn(leftLabels, leftX, leftY);
    placeColumn(rightLabels, rightX, rightY);

    commit.Push('Auto-place Sheet Pins');
    return labels.length;
  }

  SyncAllSheetsPins(_aEvent: TOOL_EVENT): number {
    const getSheetChildren = (
      aPaths: SCH_SHEET_PATH[],
      aScene: SCH_SCREEN | null,
      aVisited: Set<SCH_SCREEN>,
      aCurPath: SCH_SHEET_PATH,
    ): void => {
      if (!aScene || aVisited.has(aScene)) return;

      const sheetChildren: SCH_ITEM[] = [];
      aScene.GetSheets(sheetChildren);
      aVisited.add(aScene);

      for (const child of sheetChildren) {
        const cp = aCurPath.Clone();
        const sheet = child as SCH_SHEET;
        cp.push_back(sheet);
        aPaths.push(cp);
        getSheetChildren(aPaths, sheet.GetScreen(), aVisited, cp);
      }
    };

    const sheetPaths: SCH_SHEET_PATH[] = [];
    const visited = new Set<SCH_SCREEN>();

    // Build sheet paths for each top-level sheet (don't include virtual root in paths)
    const topLevelSheets = this.schematic().GetTopLevelSheets();

    for (const topSheet of topLevelSheets) {
      if (topSheet?.GetScreen()) {
        const current = new SCH_SHEET_PATH();
        current.push_back(topSheet);
        getSheetChildren(sheetPaths, topSheet.GetScreen(), visited, current);
      }
    }

    if (sheetPaths.length === 0) {
      this.m_frame!.ShowInfoBarMsg('No sub schematic found in the current project');
      return 0;
    }

    // If a sheet is currently selected, pre-select its tab in the dialog
    const front = this.m_selectionTool!.GetSelection().Front();
    const selectedSheet = front instanceof SCH_SHEET ? front : null;

    return this.doSyncSheetsPins(sheetPaths, selectedSheet);
  }

  /** `importHierLabel` (sch_drawing_tools.cpp:3873): the first, by name, without a pin yet. */
  importHierLabel(aSheet: SCH_SHEET): SCH_HIERLABEL | null {
    if (!aSheet.GetScreen()) return null;

    const labels = [
      ...aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T),
    ] as SCH_HIERLABEL[];

    labels.sort((label1, label2) => strNumCmp(label1.GetText(), label2.GetText(), true));

    for (const label of labels) {
      if (!aSheet.HasPin(label.GetText())) return label;
    }

    return null;
  }

  /** `importHierLabels` (sch_drawing_tools.cpp:3902): every one without a pin yet. */
  importHierLabels(aSheet: SCH_SHEET): SCH_HIERLABEL[] {
    if (!aSheet.GetScreen()) return [];

    const labels: SCH_HIERLABEL[] = [];

    for (const item of aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
      const label = item as SCH_HIERLABEL;

      if (!aSheet.HasPin(label.GetText())) labels.push(label);
    }

    return labels;
  }

  protected override setTransitions(): void {
    // clang-format off
    // PlaceSymbol, PlaceNextSymbolUnit, ImportSheet, DrawShape, DrawRuleArea, DrawTable,
    // PlaceImage and ImportGraphics follow (S5-5b, S5-5c).
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeNoConnect.MakeEvent());
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeJunction.MakeEvent());
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeBusWireEntry.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeClassLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeHierLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeGlobalLabel.MakeEvent());
    this.Go(this.DrawSheet, SCH_ACTIONS.drawSheet.MakeEvent());
    this.Go(this.DrawSheet, SCH_ACTIONS.drawSheetFromFile.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSheetPin.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSchematicText.MakeEvent());
    this.Go(this.SyncSheetsPins, SCH_ACTIONS.syncSheetPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.SyncAllSheetsPins), SCH_ACTIONS.syncAllSheetsPins.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.AutoPlaceAllSheetPins),
      SCH_ACTIONS.autoplaceAllSheetPins.MakeEvent(),
    );
    // clang-format on
  }
}
