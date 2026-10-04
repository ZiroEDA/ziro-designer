// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_EDIT_TOOL` (eeschema/tools/sch_edit_tool.{h,cpp}): rotate, mirror, swap, delete, repeat,
 * the properties dialogs, field edits, text-type conversion, justification, attributes and the
 * edit half of every context menu, on the live model.
 *
 * Every dialog KiCad constructs here is the window's: `SCH_EDIT_FRAME::ShowModalDialog` names the
 * C++ class and hands over the live items, and with no window every dialog is cancelled.
 */
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { CHANGE_TYPE } from '@ziroeda/common/commit.js';
import { type EDA_ITEM, IGNORE_PARENT_GROUP, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  ENDPOINT,
  IS_NEW,
  SELECTED_BY_DRAG,
  STARTPOINT,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import {
  GetFlippedHAlignment,
  GetFlippedVAlignment,
  GR_TEXT_H_ALIGN_T,
} from '@ziroeda/common/font/text_attributes.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { NET_SETTINGS } from '@ziroeda/common/project/net_settings.js';
import {
  AccumulateDescriptions,
  ESCAPE_CONTEXT,
  EscapeString,
  titleCaps as TitleCaps,
  unescapeString as UnescapeString,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T, GetDefaultFieldName } from '@ziroeda/common/template_fieldnames.js';
import { NULL_REPORTER } from '@ziroeda/common/reporter.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { ACTION_CONDITIONS } from '@ziroeda/common/tool/action_manager.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { CONDITIONAL_MENU } from '@ziroeda/common/tool/conditional_menu.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  SELECTION_CONDITIONS,
  type SELECTION_CONDITION,
} from '@ziroeda/common/tool/selection_conditions.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER, type TOOL_INTERACTIVE } from '@ziroeda/common/tool/tool_interactive.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import {
  ANGLE_90,
  ANGLE_HORIZONTAL,
  ANGLE_VERTICAL,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { id_eeschema_frm } from '../eeschema_id.js';
import { SCH_COLLECTOR, CollectOtherUnits } from '../sch_collectors.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import type { SCH_GROUP } from '../sch_group.js';
import { AUTOPLACE_ALGO, SCH_ITEM } from '../sch_item.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../sch_label.js';
import type { SCH_LINE } from '../sch_line.js';
import type { SCH_MARKER } from '../sch_marker.js';
import type { SCH_NO_CONNECT } from '../sch_no_connect.js';
import { SCH_PIN } from '../sch_pin.js';
import type { SCH_RULE_AREA } from '../sch_rule_area.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { SCH_SCREENS } from '../sch_screen.js';
import {
  type ANNOTATE_ALGO_T,
  type ANNOTATE_ORDER_T,
  ANNOTATE_SCOPE_T,
} from '../sch_reference_list.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_LIST, SYMBOL_FILTER } from '../sch_sheet_path.js';
import type { SCH_SHEET_PATH } from '../sch_sheet_path.js';
import { SCH_SHEET_PIN } from '../sch_sheet_pin.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import type { SCH_TABLE } from '../sch_table.js';
import type { SCH_TABLECELL } from '../sch_tablecell.js';
import { SCH_TEXT } from '../sch_text.js';
import { SCH_TEXTBOX } from '../sch_textbox.js';
import { SYMBOL_ORIENTATION_T } from '../symbol.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_SELECTION } from './sch_selection.js';
import { SCH_CONDITIONS, SCH_SELECTION_TOOL } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import {
  GetSameSymbolMultiUnitSelection,
  GetSheetNamesFromPaths,
  GetUnplacedUnitsForSymbol,
  SwapPinGeometry,
  SymbolHasSheetInstances,
} from './sch_tool_utils.js';

/** `SYMBOL_PROPS_RETVALUE` (dialogs/dialog_symbol_properties.h): why the dialog closed. */
export enum SYMBOL_PROPS_RETVALUE {
  SYMBOL_PROPS_WANT_UPDATE_SYMBOL,
  SYMBOL_PROPS_WANT_EXCHANGE_SYMBOL,
  SYMBOL_PROPS_EDIT_OK,
  SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL,
  SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL,
}

/** `DIALOG_CHANGE_SYMBOLS::MODE` (dialogs/dialog_change_symbols.h). */
export enum DIALOG_CHANGE_SYMBOLS_MODE {
  UPDATE,
  CHANGE,
}

/** `DIALOG_TABLECELL_PROPERTIES::TABLECELL_PROPS_EDIT_TABLE` (dialog_tablecell_properties.h). */
export const TABLECELL_PROPS_EDIT_TABLE = 4;

const same = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

class SYMBOL_UNIT_MENU extends ACTION_MENU {
  constructor() {
    super(true);
    this.SetIcon(BITMAPS.component_select_unit);
    this.SetTitle('Symbol Unit');
  }

  protected override create(): ACTION_MENU {
    return new SYMBOL_UNIT_MENU();
  }

  protected override update(): void {
    const selTool = this.getToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    const front = selection.Front();
    const symbol = front instanceof SCH_SYMBOL ? front : null;

    this.Clear();

    if (!symbol) return; // wxCHECK

    const unit = symbol.GetUnit();
    const nUnits = symbol.GetLibSymbolRef()!.GetUnitCount();
    const missingUnits = GetUnplacedUnitsForSymbol(symbol);
    const ID = id_eeschema_frm;

    for (let ii = 0; ii < nUnits; ii++) {
      let unit_text = symbol.GetUnitDisplayName(ii + 1, false);

      if (!missingUnits.has(ii + 1)) unit_text += ' (already placed)';

      const item = this.Append(
        ID.ID_POPUP_SCH_SELECT_UNIT1 + ii,
        unit_text,
        '',
        1 /* wxITEM_CHECK */,
      );

      if (unit === ii + 1) item.Check(true);

      // The ID max for these submenus is ID_POPUP_SCH_SELECT_UNIT_END
      // See eeschema_id to modify this value.
      if (ii >= ID.ID_POPUP_SCH_SELECT_UNIT_END - ID.ID_POPUP_SCH_SELECT_UNIT1) break; // We have used all IDs for these submenus
    }

    if (missingUnits.size > 0) {
      this.AppendSeparator();

      for (const unitNumber of [...missingUnits].sort((a, b) => a - b)) {
        const placeText = `Place unit ${symbol.GetUnitDisplayName(unitNumber, false)}`;
        this.Append(ID.ID_POPUP_SCH_PLACE_UNIT1 + unitNumber - 1, placeText);
      }
    }
  }
}

class BODY_STYLE_MENU extends ACTION_MENU {
  constructor() {
    super(true);
    this.SetIcon(BITMAPS.body_style);
    this.SetTitle('Body Style');
  }

  protected override create(): ACTION_MENU {
    return new BODY_STYLE_MENU();
  }

  protected override update(): void {
    const selTool = this.getToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    const front = selection.Front();
    const symbol = front instanceof SCH_SYMBOL ? front : null;
    const ID = id_eeschema_frm;

    this.Clear();

    if (!symbol) return; // wxCHECK

    if (symbol.HasDeMorganBodyStyles()) {
      let item = this.Append(
        ID.ID_POPUP_SCH_SELECT_BODY_STYLE,
        'Standard',
        '',
        1 /* wxITEM_CHECK */,
      );
      item.Check(symbol.GetBodyStyle() === 1 /* BODY_STYLE::BASE */);

      item = this.Append(ID.ID_POPUP_SCH_SELECT_BODY_STYLE1, 'Alternate', '', 1 /* wxITEM_CHECK */);
      item.Check(symbol.GetBodyStyle() !== 1 /* BODY_STYLE::BASE */);
    } else if (symbol.IsMultiBodyStyle()) {
      for (let i = 0; i < symbol.GetBodyStyleCount(); i++) {
        const item = this.Append(
          ID.ID_POPUP_SCH_SELECT_BODY_STYLE + i,
          symbol.GetBodyStyleDescription(i + 1, true),
          '',
          1 /* wxITEM_CHECK */,
        );
        item.Check(symbol.GetBodyStyle() === i + 1);
      }
    }
  }
}

class ALT_PIN_FUNCTION_MENU extends ACTION_MENU {
  constructor() {
    super(true);
    this.SetIcon(BITMAPS.component_select_unit);
    this.SetTitle('Pin Function');
  }

  protected override create(): ACTION_MENU {
    return new ALT_PIN_FUNCTION_MENU();
  }

  protected override update(): void {
    const selTool = this.getToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    const front = selection.Front();
    const pin = front instanceof SCH_PIN ? front : null;
    const libPin = pin ? pin.GetLibPin() : null;
    const ID = id_eeschema_frm;

    this.Clear();

    if (!pin || !libPin) return; // wxCHECK

    let item = this.Append(
      ID.ID_POPUP_SCH_ALT_PIN_FUNCTION,
      libPin.GetName(),
      '',
      1 /* wxITEM_CHECK */,
    );

    if (pin.GetAlt() === '' || pin.GetAlt() === libPin.GetName()) item.Check(true);

    let ii = 1;

    for (const [name] of libPin.GetAlternates()) {
      // The default pin name is set above, avoid setting it again.
      if (name === libPin.GetName()) continue;

      item = this.Append(ID.ID_POPUP_SCH_ALT_PIN_FUNCTION + ii, name, '', 1 /* wxITEM_CHECK */);

      if (name === pin.GetAlt()) item.Check(true);

      // The ID max for these submenus is ID_POPUP_SCH_ALT_PIN_FUNCTION_END
      // See eeschema_id to modify this value.
      if (++ii >= ID.ID_POPUP_SCH_ALT_PIN_FUNCTION_END - ID.ID_POPUP_SCH_SELECT_UNIT) break; // We have used all IDs for these submenus
    }
  }
}

class PIN_TRICKS_MENU extends ACTION_MENU {
  constructor() {
    super(true);
    this.SetIcon(BITMAPS.pin);
    this.SetTitle('Pin Helpers');
  }

  protected override create(): ACTION_MENU {
    return new PIN_TRICKS_MENU();
  }

  protected override update(): void {
    const selTool = this.getToolManager()!.GetTool(SCH_SELECTION_TOOL)!;
    const selection = selTool.GetSelection();
    const front = selection.Front();
    const pin = front instanceof SCH_PIN ? front : null;
    const sheetPin = front instanceof SCH_SHEET_PIN ? front : null;
    const ID = id_eeschema_frm;

    this.Clear();

    if (!pin && !sheetPin) return;

    this.Add('Wire', ID.ID_POPUP_SCH_PIN_TRICKS_WIRE, BITMAPS.add_line);
    this.Add('No Connect', ID.ID_POPUP_SCH_PIN_TRICKS_NO_CONNECT, BITMAPS.noconn);
    this.Add('Net Label', ID.ID_POPUP_SCH_PIN_TRICKS_NET_LABEL, BITMAPS.add_label);
    this.Add(
      'Hierarchical Label',
      ID.ID_POPUP_SCH_PIN_TRICKS_HIER_LABEL,
      BITMAPS.add_hierarchical_label,
    );
    this.Add('Global Label', ID.ID_POPUP_SCH_PIN_TRICKS_GLOBAL_LABEL, BITMAPS.add_glabel);
  }
}

/** `swapFieldPositionsWithMatching` (sch_edit_tool.cpp:1519). */
function swapFieldPositionsWithMatching(
  aAFields: SCH_FIELD[],
  aBFields: SCH_FIELD[],
  aFallbackRotationsCCW: number,
): void {
  const handledKeys = new Set<string>();

  const swapFieldTextProps = (aField: SCH_FIELD, bField: SCH_FIELD) => {
    const aParent = aField.GetParentPosition();
    const bParent = bField.GetParentPosition();
    const aRelPos = {
      x: aField.GetPosition().x - aParent.x,
      y: aField.GetPosition().y - aParent.y,
    };
    const aTextJustifyH = aField.GetHorizJustify();
    const aTextJustifyV = aField.GetVertJustify();
    const aTextAngle = aField.GetTextAngle();

    const bRelPos = {
      x: bField.GetPosition().x - bParent.x,
      y: bField.GetPosition().y - bParent.y,
    };
    const bTextJustifyH = bField.GetHorizJustify();
    const bTextJustifyV = bField.GetVertJustify();
    const bTextAngle = bField.GetTextAngle();

    aField.SetPosition({ x: aParent.x + bRelPos.x, y: aParent.y + bRelPos.y });
    aField.SetHorizJustify(bTextJustifyH);
    aField.SetVertJustify(bTextJustifyV);
    aField.SetTextAngle(bTextAngle);

    bField.SetPosition({ x: bParent.x + aRelPos.x, y: bParent.y + aRelPos.y });
    bField.SetHorizJustify(aTextJustifyH);
    bField.SetVertJustify(aTextJustifyV);
    bField.SetTextAngle(aTextAngle);
  };

  for (const aField of aAFields) {
    const name = aField.GetCanonicalName();
    const bField = aBFields.find((f) => f.GetCanonicalName() === name);

    if (bField) {
      // We have a field with the same key in both labels
      swapFieldTextProps(aField, bField);
    } else {
      // We only have this field in A, so just rotate it
      for (let ii = 0; ii < aFallbackRotationsCCW; ii++)
        aField.Rotate(aField.GetParentPosition(), true);
    }

    // And keep track that we did this one
    handledKeys.add(name);
  }

  // Any fields in B that weren't in A weren't handled and need to be rotated
  // in reverse
  for (const bField of aBFields) {
    const bName = bField.GetCanonicalName();

    if (!handledKeys.has(bName)) {
      for (let ii = 0; ii < aFallbackRotationsCCW; ii++)
        bField.Rotate(bField.GetParentPosition(), false);
    }
  }
}

/** `findSingleNetLabelForPin` (sch_edit_tool.cpp:1906). */
function findSingleNetLabelForPin(
  aPin: SCH_PIN | null,
  aGraph: ReturnType<ReturnType<SCH_EDIT_FRAME['Schematic']>['ConnectionGraph']> | null,
  aSheetPath: SCH_SHEET_PATH,
): SCH_LABEL_BASE | null {
  if (!aGraph || !aPin) return null;

  const sg = aGraph.GetSubgraphForItem(aPin);

  if (!sg) return null;

  const items = sg.GetItems();

  let pinCount = 0;
  let label: SCH_LABEL_BASE | null = null;

  for (const item of items) {
    if (item.Type() === KICAD_T.SCH_PIN_T) pinCount++;

    switch (item.Type()) {
      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T: {
        const conn = item.Connection(aSheetPath);

        if (conn?.IsNet()) {
          if (label) return null; // more than one label

          label = item as SCH_LABEL_BASE;
        }

        break;
      }
      default:
        break;
    }
  }

  if (pinCount !== 1) return null;

  return label;
}

export class SCH_EDIT_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  static readonly RotatableItems: readonly KICAD_T[] = [
    KICAD_T.SCH_SHAPE_T,
    KICAD_T.SCH_RULE_AREA_T,
    KICAD_T.SCH_TEXT_T,
    KICAD_T.SCH_TEXTBOX_T,
    KICAD_T.SCH_TABLE_T,
    KICAD_T.SCH_TABLECELL_T, // will be promoted to parent table(s)
    KICAD_T.SCH_LABEL_T,
    KICAD_T.SCH_GLOBAL_LABEL_T,
    KICAD_T.SCH_GROUP_T,
    KICAD_T.SCH_HIER_LABEL_T,
    KICAD_T.SCH_DIRECTIVE_LABEL_T,
    KICAD_T.SCH_FIELD_T,
    KICAD_T.SCH_SYMBOL_T,
    KICAD_T.SCH_SHEET_PIN_T,
    KICAD_T.SCH_SHEET_T,
    KICAD_T.SCH_BITMAP_T,
    KICAD_T.SCH_BUS_BUS_ENTRY_T,
    KICAD_T.SCH_BUS_WIRE_ENTRY_T,
    KICAD_T.SCH_LINE_T,
    KICAD_T.SCH_JUNCTION_T,
    KICAD_T.SCH_NO_CONNECT_T,
  ];

  static readonly SwappableItems: readonly KICAD_T[] = [
    KICAD_T.SCH_SHAPE_T,
    KICAD_T.SCH_RULE_AREA_T,
    KICAD_T.SCH_TEXT_T,
    KICAD_T.SCH_TEXTBOX_T,
    KICAD_T.SCH_LABEL_T,
    KICAD_T.SCH_SHEET_PIN_T,
    KICAD_T.SCH_GLOBAL_LABEL_T,
    KICAD_T.SCH_HIER_LABEL_T,
    KICAD_T.SCH_DIRECTIVE_LABEL_T,
    KICAD_T.SCH_FIELD_T,
    KICAD_T.SCH_SYMBOL_T,
    KICAD_T.SCH_SHEET_T,
    KICAD_T.SCH_BITMAP_T,
    KICAD_T.SCH_JUNCTION_T,
    KICAD_T.SCH_NO_CONNECT_T,
  ];

  constructor() {
    super('eeschema.InteractiveEdit');
    this.m_pickerItem = null;
  }

  override Init(): boolean {
    super.Init();

    const S_C = SCH_CONDITIONS;
    const { And, Or } = SELECTION_CONDITIONS;

    // SCH_DRAWING_TOOLS is not on the TOOL_MANAGER yet; its menu half lands with it.
    const drawingTools = this.m_toolMgr!.FindTool(
      'eeschema.InteractiveDrawing',
    ) as TOOL_INTERACTIVE | null;
    const moveTool = this.m_toolMgr!.FindTool(
      'eeschema.InteractiveMove',
    ) as TOOL_INTERACTIVE | null;

    const attribTypes = [KICAD_T.SCH_SYMBOL_T, KICAD_T.SCH_SHEET_T, KICAD_T.SCH_RULE_AREA_T];
    const sheetTypes = [KICAD_T.SCH_SHEET_T];

    const sheetSelection = And(S_C.Count(1), S_C.OnlyTypes(sheetTypes));

    const sheetHasUndefinedPins: SELECTION_CONDITION = (aSel) => {
      if (aSel.Size() === 1 && aSel.Front()!.Type() === KICAD_T.SCH_SHEET_T)
        return (aSel.Front() as SCH_SHEET).HasUndefinedPins();

      return false;
    };

    // attribDNPCond and its three siblings: checked when every attributable item has the flag.
    const attribCond =
      (
        aGet: (aItem: SCH_ITEM, aSheet: SCH_SHEET_PATH, aVariant: string) => boolean,
      ): SELECTION_CONDITION =>
      (aSel) => {
        const sheet = this.m_frame!.GetCurrentSheet();
        const variant = this.m_frame!.Schematic().GetCurrentVariant();
        let checked = 0;
        let unchecked = 0;

        for (const item of aSel.GetItems()) {
          switch (item.Type()) {
            case KICAD_T.SCH_SYMBOL_T:
            case KICAD_T.SCH_SHEET_T:
            case KICAD_T.SCH_RULE_AREA_T:
              if (aGet(item as SCH_ITEM, sheet, variant)) checked++;
              else unchecked++;

              break;

            default:
              break;
          }
        }

        return checked > 0 && unchecked === 0;
      };

    const attribDNPCond = attribCond((i, s, v) => i.GetDNP(s, v));
    const attribExcludeFromSimCond = attribCond((i, s, v) => i.GetExcludedFromSim(s, v));
    const attribExcludeFromBOMCond = attribCond((i, s, v) => i.GetExcludedFromBOM(s, v));
    const attribExcludeFromBoardCond = attribCond((i, s, v) => i.GetExcludedFromBoard(s, v));

    const attribExcludeFromPosFilesCond: SELECTION_CONDITION = (aSel) => {
      const sheet = this.m_frame!.GetCurrentSheet();
      const variant = this.m_frame!.Schematic().GetCurrentVariant();
      let checked = 0;
      let unchecked = 0;

      for (const item of aSel.GetItems()) {
        if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
          if ((item as SCH_SYMBOL).GetExcludedFromPosFiles(sheet, variant)) checked++;
          else unchecked++;
        }
      }

      return checked > 0 && unchecked === 0;
    };

    const haveHighlight: SELECTION_CONDITION = () =>
      this.m_frame!.GetHighlightedConnection() !== '';

    const anyTextTool: SELECTION_CONDITION = () =>
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.placeLabel) ||
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.placeClassLabel) ||
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.placeGlobalLabel) ||
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.placeHierLabel) ||
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.placeSchematicText);

    const duplicateCondition: SELECTION_CONDITION = (aSel) => {
      if (SCH_LINE_WIRE_BUS_TOOL.IsDrawingLineWireOrBus(aSel)) return false;

      return true;
    };

    const orientCondition: SELECTION_CONDITION = (aSel) => {
      if (SCH_LINE_WIRE_BUS_TOOL.IsDrawingLineWireOrBus(aSel)) return false;

      return SELECTION_CONDITIONS.HasTypes(SCH_EDIT_TOOL.RotatableItems)(aSel);
    };

    const swapSelectionCondition = And(
      S_C.OnlyTypes(SCH_EDIT_TOOL.SwappableItems),
      SELECTION_CONDITIONS.MoreThan(1),
    );

    const propertiesCondition: SELECTION_CONDITION = (aSel) => {
      if (aSel.GetSize() === 0) {
        if (this.getView()!.IsLayerVisible(SCH_LAYER_ID.LAYER_SCHEMATIC_DRAWINGSHEET)) {
          const ds = this.m_frame!.GetCanvas()?.GetView().GetDrawingSheet() ?? null;
          const cursor = this.getViewControls()!.GetCursorPosition(false);

          if (ds?.HitTestDrawingSheetItems(this.getView()!, cursor)) return true;
        }

        return false;
      }

      const firstItem = aSel.Front() instanceof SCH_ITEM ? (aSel.Front() as SCH_ITEM) : null;
      const eeSelection = aSel instanceof SCH_SELECTION ? aSel : null;

      if (!firstItem || !eeSelection) return false;

      switch (firstItem.Type()) {
        case KICAD_T.SCH_SYMBOL_T:
        case KICAD_T.SCH_SHEET_T:
        case KICAD_T.SCH_SHEET_PIN_T:
        case KICAD_T.SCH_TEXT_T:
        case KICAD_T.SCH_TEXTBOX_T:
        case KICAD_T.SCH_TABLE_T:
        case KICAD_T.SCH_TABLECELL_T:
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        case KICAD_T.SCH_RULE_AREA_T:
        case KICAD_T.SCH_FIELD_T:
        case KICAD_T.SCH_SHAPE_T:
        case KICAD_T.SCH_BITMAP_T:
        case KICAD_T.SCH_GROUP_T:
          return aSel.GetSize() === 1;

        case KICAD_T.SCH_LINE_T:
        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
        case KICAD_T.SCH_JUNCTION_T: {
          const items = aSel.GetItems();

          if (
            items.every(
              (item) => item.Type() === KICAD_T.SCH_LINE_T && (item as SCH_LINE).IsGraphicLine(),
            )
          ) {
            return true;
          } else if (items.every((item) => item.Type() === KICAD_T.SCH_JUNCTION_T)) {
            return true;
          } else if (
            items.every((item) => {
              const schItem = item instanceof SCH_ITEM ? item : null;

              if (!schItem) return false; // wxCHECK

              return (
                (schItem.HasLineStroke() && schItem.IsConnectable()) ||
                item.Type() === KICAD_T.SCH_JUNCTION_T
              );
            })
          ) {
            return true;
          }

          return false;
        }

        default:
          return false;
      }
    };

    const autoplaceCondition: SELECTION_CONDITION = (aSel) => {
      for (const item of aSel.GetItems()) {
        if (item.IsType(SCH_COLLECTOR.FieldOwners)) return true;
      }

      return false;
    };

    // allTextTypes does not include SCH_SHEET_PIN_T because one cannot convert other
    // types to/from this type, living only in a SHEET
    const allTextTypes = [
      KICAD_T.SCH_LABEL_T,
      KICAD_T.SCH_DIRECTIVE_LABEL_T,
      KICAD_T.SCH_GLOBAL_LABEL_T,
      KICAD_T.SCH_HIER_LABEL_T,
      KICAD_T.SCH_TEXT_T,
      KICAD_T.SCH_TEXTBOX_T,
    ];

    const toChangeCondition = S_C.OnlyTypes(allTextTypes);

    const convertCond = (aTypes: KICAD_T[]) =>
      Or(
        And(S_C.Count(1), S_C.OnlyTypes(aTypes)),
        And(S_C.MoreThan(1), S_C.OnlyTypes(allTextTypes)),
      );

    const T = KICAD_T;
    const toLabelCondition = convertCond([
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_TEXT_T,
      T.SCH_TEXTBOX_T,
    ]);
    const toCLabelCondition = convertCond([
      T.SCH_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_TEXT_T,
      T.SCH_TEXTBOX_T,
    ]);
    const toHLabelCondition = convertCond([
      T.SCH_LABEL_T,
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_TEXT_T,
      T.SCH_TEXTBOX_T,
    ]);
    const toGLabelCondition = convertCond([
      T.SCH_LABEL_T,
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_TEXT_T,
      T.SCH_TEXTBOX_T,
    ]);
    const toTextCondition = convertCond([
      T.SCH_LABEL_T,
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_TEXTBOX_T,
    ]);
    const toTextBoxCondition = convertCond([
      T.SCH_LABEL_T,
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_TEXT_T,
    ]);

    const registerSubMenu = (tool: TOOL_INTERACTIVE, menu: ACTION_MENU) => {
      menu.SetTool(tool);
      tool.GetToolMenu().RegisterSubMenu(menu);
      return menu;
    };

    const makeSymbolUnitMenu = (tool: TOOL_INTERACTIVE) =>
      registerSubMenu(tool, new SYMBOL_UNIT_MENU());
    const makeBodyStyleMenu = (tool: TOOL_INTERACTIVE) =>
      registerSubMenu(tool, new BODY_STYLE_MENU());
    const makePinFunctionMenu = (tool: TOOL_INTERACTIVE) =>
      registerSubMenu(tool, new ALT_PIN_FUNCTION_MENU());
    const makePinTricksMenu = (tool: TOOL_INTERACTIVE) =>
      registerSubMenu(tool, new PIN_TRICKS_MENU());

    const makeTransformMenu = () => {
      const menu = new CONDITIONAL_MENU(moveTool);
      menu.SetUntranslatedTitle('Transform Selection');

      menu.AddItem(SCH_ACTIONS.rotateCCW, orientCondition);
      menu.AddItem(SCH_ACTIONS.rotateCW, orientCondition);
      menu.AddItem(SCH_ACTIONS.mirrorV, orientCondition);
      menu.AddItem(SCH_ACTIONS.mirrorH, orientCondition);

      return menu;
    };

    const makeAttributesMenu = () => {
      const menu = new CONDITIONAL_MENU(moveTool);
      menu.SetUntranslatedTitle('Attributes');

      menu.AddCheckItem(SCH_ACTIONS.setExcludeFromSim, S_C.ShowAlways);
      menu.AddCheckItem(SCH_ACTIONS.setExcludeFromBOM, S_C.ShowAlways);
      menu.AddCheckItem(SCH_ACTIONS.setExcludeFromBoard, S_C.ShowAlways);
      menu.AddCheckItem(SCH_ACTIONS.setExcludeFromPosFiles, S_C.HasType(KICAD_T.SCH_SYMBOL_T));
      menu.AddCheckItem(SCH_ACTIONS.setDNP, S_C.ShowAlways);

      return menu;
    };

    const makeEditFieldsMenu = () => {
      const menu = new CONDITIONAL_MENU(this.m_selectionTool);
      menu.SetUntranslatedTitle('Edit Main Fields');

      menu.AddItem(SCH_ACTIONS.editReference, S_C.SingleSymbol, 200);
      menu.AddItem(SCH_ACTIONS.editValue, S_C.SingleSymbol, 200);
      menu.AddItem(SCH_ACTIONS.editFootprint, S_C.SingleSymbol, 200);

      return menu;
    };

    const makeConvertToMenu = () => {
      const menu = new CONDITIONAL_MENU(this.m_selectionTool);
      menu.SetUntranslatedTitle('Change To');
      menu.SetIcon(BITMAPS.right);

      menu.AddItem(SCH_ACTIONS.toLabel, toLabelCondition);
      menu.AddItem(SCH_ACTIONS.toDLabel, toCLabelCondition);
      menu.AddItem(SCH_ACTIONS.toHLabel, toHLabelCondition);
      menu.AddItem(SCH_ACTIONS.toGLabel, toGLabelCondition);
      menu.AddItem(SCH_ACTIONS.toText, toTextCondition);
      menu.AddItem(SCH_ACTIONS.toTextBox, toTextBoxCondition);

      return menu;
    };

    const canCopyText = SCH_CONDITIONS.OnlyTypes([
      T.SCH_TEXT_T,
      T.SCH_TEXTBOX_T,
      T.SCH_FIELD_T,
      T.SCH_LABEL_T,
      T.SCH_HIER_LABEL_T,
      T.SCH_GLOBAL_LABEL_T,
      T.SCH_DIRECTIVE_LABEL_T,
      T.SCH_SHEET_PIN_T,
      T.SCH_PIN_T,
      T.SCH_TABLE_T,
      T.SCH_TABLECELL_T,
    ]);

    // clang-format off
    //
    // Add edit actions to the move tool menu
    //
    if (moveTool) {
      const moveMenu = moveTool.GetToolMenu().GetMenu();

      moveMenu.AddSeparator();
      moveMenu.AddMenu(makeSymbolUnitMenu(moveTool), S_C.SingleMultiUnitSymbol, 1);
      moveMenu.AddMenu(makeBodyStyleMenu(moveTool), S_C.SingleMultiBodyStyleSymbol, 1);

      moveMenu.AddMenu(makeTransformMenu(), orientCondition, 200);
      moveMenu.AddMenu(makeAttributesMenu(), S_C.HasTypes(attribTypes), 200);
      moveMenu.AddItem(SCH_ACTIONS.swap, swapSelectionCondition, 200);
      moveMenu.AddItem(SCH_ACTIONS.properties, propertiesCondition, 200);
      moveMenu.AddMenu(makeEditFieldsMenu(), S_C.SingleSymbol, 200);

      moveMenu.AddSeparator();
      moveMenu.AddItem(ACTIONS.cut, S_C.IdleSelection);
      moveMenu.AddItem(ACTIONS.copy, S_C.IdleSelection);
      moveMenu.AddItem(ACTIONS.copyAsText, And(canCopyText, S_C.IdleSelection));
      moveMenu.AddItem(ACTIONS.doDelete, S_C.NotEmpty);
      moveMenu.AddItem(ACTIONS.duplicate, duplicateCondition);
    }

    //
    // Add editing actions to the drawing tool menu
    //
    if (drawingTools) {
      const drawMenu = drawingTools.GetToolMenu().GetMenu();

      drawMenu.AddItem(SCH_ACTIONS.clearHighlight, And(haveHighlight, S_C.Idle), 1);
      drawMenu.AddSeparator(And(haveHighlight, S_C.Idle), 1);

      drawMenu.AddItem(SCH_ACTIONS.enterSheet, And(sheetSelection, S_C.Idle), 1);
      drawMenu.AddSeparator(And(sheetSelection, S_C.Idle), 1);

      drawMenu.AddMenu(makeSymbolUnitMenu(drawingTools), S_C.SingleMultiUnitSymbol, 1);
      drawMenu.AddMenu(makeBodyStyleMenu(drawingTools), S_C.SingleMultiBodyStyleSymbol, 1);

      drawMenu.AddMenu(makeTransformMenu(), orientCondition, 200);
      drawMenu.AddMenu(makeAttributesMenu(), S_C.HasTypes(attribTypes), 200);
      drawMenu.AddItem(SCH_ACTIONS.properties, propertiesCondition, 200);
      drawMenu.AddMenu(makeEditFieldsMenu(), S_C.SingleSymbol, 200);
      drawMenu.AddItem(SCH_ACTIONS.autoplaceFields, autoplaceCondition, 200);

      drawMenu.AddItem(SCH_ACTIONS.editWithLibEdit, And(S_C.SingleSymbolOrPower, S_C.Idle), 200);

      drawMenu.AddItem(SCH_ACTIONS.toLabel, And(anyTextTool, S_C.Idle), 200);
      drawMenu.AddItem(SCH_ACTIONS.toHLabel, And(anyTextTool, S_C.Idle), 200);
      drawMenu.AddItem(SCH_ACTIONS.toGLabel, And(anyTextTool, S_C.Idle), 200);
      drawMenu.AddItem(SCH_ACTIONS.toText, And(anyTextTool, S_C.Idle), 200);
      drawMenu.AddItem(SCH_ACTIONS.toTextBox, And(anyTextTool, S_C.Idle), 200);
    }

    //
    // Add editing actions to the selection tool menu
    //
    const selTool = this.m_selectionTool!;
    const selToolMenu = selTool.GetToolMenu().GetMenu();

    selToolMenu.AddMenu(makeSymbolUnitMenu(selTool), S_C.SingleMultiUnitSymbol, 1);
    selToolMenu.AddMenu(makeBodyStyleMenu(selTool), S_C.SingleMultiBodyStyleSymbol, 1);
    selToolMenu.AddMenu(makePinFunctionMenu(selTool), S_C.SingleMultiFunctionPin, 1);
    selToolMenu.AddMenu(makePinTricksMenu(selTool), S_C.AllPinsOrSheetPins, 1);

    selToolMenu.AddMenu(makeTransformMenu(), orientCondition, 200);
    selToolMenu.AddMenu(makeAttributesMenu(), S_C.HasTypes(attribTypes), 200);
    selToolMenu.AddItem(SCH_ACTIONS.swap, swapSelectionCondition, 200);
    selToolMenu.AddItem(SCH_ACTIONS.properties, propertiesCondition, 200);
    selToolMenu.AddMenu(makeEditFieldsMenu(), S_C.SingleSymbol, 200);
    selToolMenu.AddItem(SCH_ACTIONS.autoplaceFields, autoplaceCondition, 200);

    selToolMenu.AddItem(SCH_ACTIONS.editWithLibEdit, And(S_C.SingleSymbolOrPower, S_C.Idle), 200);
    selToolMenu.AddItem(SCH_ACTIONS.changeSymbol, S_C.SingleSymbolOrPower, 200);
    selToolMenu.AddItem(SCH_ACTIONS.updateSymbol, S_C.SingleSymbolOrPower, 200);
    selToolMenu.AddItem(SCH_ACTIONS.changeSymbols, S_C.MultipleSymbolsOrPower, 200);
    selToolMenu.AddItem(SCH_ACTIONS.updateSymbols, S_C.MultipleSymbolsOrPower, 200);
    selToolMenu.AddMenu(makeConvertToMenu(), toChangeCondition, 200);

    selToolMenu.AddItem(SCH_ACTIONS.cleanupSheetPins, sheetHasUndefinedPins, 250);

    selToolMenu.AddSeparator(300);
    selToolMenu.AddItem(ACTIONS.cut, S_C.IdleSelection, 300);
    selToolMenu.AddItem(ACTIONS.copy, S_C.IdleSelection, 300);
    selToolMenu.AddItem(ACTIONS.copyAsText, And(canCopyText, S_C.IdleSelection), 300);
    selToolMenu.AddItem(ACTIONS.paste, S_C.Idle, 300);
    selToolMenu.AddItem(ACTIONS.pasteSpecial, S_C.Idle, 300);
    selToolMenu.AddItem(ACTIONS.doDelete, S_C.NotEmpty, 300);
    selToolMenu.AddItem(ACTIONS.duplicate, duplicateCondition, 300);

    selToolMenu.AddSeparator(400);
    selToolMenu.AddItem(ACTIONS.selectAll, S_C.ShowAlways, 400);
    selToolMenu.AddItem(ACTIONS.unselectAll, S_C.ShowAlways, 400);

    const mgr = this.m_toolMgr!.GetActionManager();

    mgr.SetConditions(SCH_ACTIONS.setDNP, new ACTION_CONDITIONS().Check(attribDNPCond));
    mgr.SetConditions(
      SCH_ACTIONS.setExcludeFromSim,
      new ACTION_CONDITIONS().Check(attribExcludeFromSimCond),
    );
    mgr.SetConditions(
      SCH_ACTIONS.setExcludeFromBOM,
      new ACTION_CONDITIONS().Check(attribExcludeFromBOMCond),
    );
    mgr.SetConditions(
      SCH_ACTIONS.setExcludeFromBoard,
      new ACTION_CONDITIONS().Check(attribExcludeFromBoardCond),
    );
    mgr.SetConditions(
      SCH_ACTIONS.setExcludeFromPosFiles,
      new ACTION_CONDITIONS().Check(attribExcludeFromPosFilesCond),
    );
    // clang-format on

    return true;
  }

  /** `if( !commit ) commit = &localCommit;` */
  private eventCommit(aEvent: TOOL_EVENT, aLocal: SCH_COMMIT): SCH_COMMIT {
    const c = aEvent.Commit();
    return c instanceof SCH_COMMIT ? c : aLocal;
  }

  private lwbTool(): SCH_LINE_WIRE_BUS_TOOL {
    return this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
  }

  Rotate(aEvent: TOOL_EVENT): number {
    const clockwise = aEvent.Matches(SCH_ACTIONS.rotateCW.MakeEvent());
    const selection = this.m_selectionTool!.RequestSelection(
      SCH_EDIT_TOOL.RotatableItems,
      true,
      false,
    );

    if (selection.GetSize() === 0) return 0;

    let head: SCH_ITEM | null = null;
    let principalItemCount = 0; // User-selected items (as opposed to connected wires)
    let rotPoint: VECTOR2I = { x: 0, y: 0 };
    let moving = false;
    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);
    const screen = this.m_frame!.GetScreen()!;

    let noConnects = new Map<SCH_SHEET_PIN, SCH_NO_CONNECT>();

    const items = selection.GetItems() as SCH_ITEM[];

    for (const item of items) {
      if (item.HasFlag(SELECTED_BY_DRAG)) continue;

      principalItemCount++;

      if (!head) head = item;
    }

    if (head?.IsMoving()) moving = true;

    if (principalItemCount === 1) {
      head = head!;

      if (moving && selection.HasReferencePoint()) rotPoint = selection.GetReferencePoint();
      else if (head.IsConnectable()) rotPoint = head.GetPosition();
      else rotPoint = this.m_frame!.GetNearestHalfGridPosition(head.GetBoundingBox().GetCenter());

      if (!moving) commit.Modify(head, screen, RECURSE_MODE.RECURSE);

      switch (head.Type()) {
        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = head as SCH_SYMBOL;

          symbol.Rotate(rotPoint, !clockwise);

          if (this.m_frame!.eeconfig()?.autoplace_fields.enable) {
            const fieldsAutoplaced = symbol.GetFieldsAutoplaced();

            if (
              fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
              fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
            )
              symbol.AutoplaceFields(screen, fieldsAutoplaced);
          }

          break;
        }

        case KICAD_T.SCH_TEXT_T:
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
          const textItem = head as SCH_TEXT;
          textItem.Rotate90(clockwise);
          break;
        }

        case KICAD_T.SCH_SHEET_PIN_T: {
          // Rotate pin within parent sheet
          const pin = head as SCH_SHEET_PIN;
          const sheet = pin.GetParent()!;

          for (const ncItem of screen
            .Items()
            .Overlapping(KICAD_T.SCH_NO_CONNECT_T, pin.GetTextPos()))
            noConnects.set(pin, ncItem as SCH_NO_CONNECT);

          pin.Rotate(sheet.GetBoundingBox().GetCenter(), !clockwise);

          break;
        }

        case KICAD_T.SCH_LINE_T:
        case KICAD_T.SCH_JUNCTION_T:
        case KICAD_T.SCH_NO_CONNECT_T:
        case KICAD_T.SCH_BUS_BUS_ENTRY_T:
        case KICAD_T.SCH_BUS_WIRE_ENTRY_T: {
          if (head.Type() === KICAD_T.SCH_LINE_T) {
            const line = head as SCH_LINE;

            // Equal checks for both and neither. We need this because on undo
            // the item will have both flags cleared, but will be selected, so it is possible
            // for the user to get a selected line with neither endpoint selected. We
            // set flags to make sure Rotate() works when we call it.
            if (line.HasFlag(STARTPOINT) === line.HasFlag(ENDPOINT)) {
              line.SetFlags(STARTPOINT | ENDPOINT);

              // When we allow off grid items, the rotPoint should be set to the midpoint
              // of the line to allow rotation around the center, and the next if
              // should become an else-if
            }

            if (line.HasFlag(STARTPOINT)) rotPoint = line.GetEndPoint();
            else if (line.HasFlag(ENDPOINT)) rotPoint = line.GetStartPoint();
          }

          // KI_FALLTHROUGH
          head.Rotate(rotPoint, !clockwise);

          break;
        }

        case KICAD_T.SCH_FIELD_T: {
          const field = head as SCH_FIELD;

          if (field.GetTextAngle().IsHorizontal()) field.SetTextAngle(ANGLE_VERTICAL);
          else field.SetTextAngle(ANGLE_HORIZONTAL);

          // Now that we're moving a field, they're no longer autoplaced.
          (head.GetParent() as SCH_ITEM).SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

          break;
        }

        case KICAD_T.SCH_RULE_AREA_T:
        case KICAD_T.SCH_SHAPE_T:
        case KICAD_T.SCH_TEXTBOX_T:
          head.Rotate(rotPoint, !clockwise);

          break;

        case KICAD_T.SCH_GROUP_T: {
          // Rotate the group on itself. Groups do not have an anchor point.
          const group = head as SCH_GROUP;
          rotPoint = this.m_frame!.GetNearestHalfGridPosition(group.GetPosition());

          group.Rotate(rotPoint, !clockwise);

          const after = this.m_frame!.GetNearestHalfGridPosition(group.GetPosition());
          group.Move({ x: rotPoint.x - after.x, y: rotPoint.y - after.y });

          break;
        }

        case KICAD_T.SCH_TABLE_T: {
          // Rotate the table on itself. Tables do not have an anchor point.
          const table = head as SCH_TABLE;
          rotPoint = this.m_frame!.GetNearestHalfGridPosition(table.GetCenter());

          table.Rotate(rotPoint, !clockwise);

          const after = this.m_frame!.GetNearestHalfGridPosition(table.GetCenter());
          table.Move({ x: rotPoint.x - after.x, y: rotPoint.y - after.y });

          break;
        }

        case KICAD_T.SCH_BITMAP_T:
          head.Rotate(rotPoint, clockwise);

          // The bitmap is cached in Opengl: clear the cache to redraw
          this.getView()!.RecacheAllItems();
          break;

        case KICAD_T.SCH_SHEET_T: {
          // Rotate the sheet on itself. Sheets do not have an anchor point.
          const sheet = head as SCH_SHEET;

          noConnects = sheet.GetNoConnects();

          rotPoint = this.m_frame!.GetNearestHalfGridPosition(sheet.GetRotationCenter());
          sheet.Rotate(rotPoint, !clockwise);

          break;
        }

        default:
          throw new Error(`SCH_EDIT_TOOL::Rotate: unimplemented for ${head.GetClass()}`);
      }

      this.m_frame!.UpdateItem(head, false, true);
    } else {
      if (moving && selection.HasReferencePoint()) rotPoint = selection.GetReferencePoint();
      else rotPoint = this.m_frame!.GetNearestHalfGridPosition(selection.GetCenter());
    }

    for (const item of items) {
      // We've already rotated the user selected item if there was only one.  We're just
      // here to rotate the ends of wires that were attached to it.
      if (principalItemCount === 1 && !item.HasFlag(SELECTED_BY_DRAG)) continue;

      if (!moving) commit.Modify(item, screen, RECURSE_MODE.RECURSE);

      if (item.Type() === KICAD_T.SCH_LINE_T) {
        const line = item as SCH_LINE;

        line.Rotate(rotPoint, !clockwise);
      } else if (item.Type() === KICAD_T.SCH_SHEET_PIN_T) {
        if (item.GetParent()!.IsSelected()) {
          // parent will rotate us
        } else {
          // rotate within parent
          const pin = item as SCH_SHEET_PIN;
          const sheet = pin.GetParent()!;

          for (const ncItem of screen
            .Items()
            .Overlapping(KICAD_T.SCH_NO_CONNECT_T, pin.GetTextPos()))
            noConnects.set(pin, ncItem as SCH_NO_CONNECT);

          pin.Rotate(sheet.GetBodyBoundingBox().GetCenter(), !clockwise);
        }
      } else if (item.Type() === KICAD_T.SCH_FIELD_T) {
        if (item.GetParent()!.IsSelected()) {
          // parent will rotate us
        } else {
          const field = item as SCH_FIELD;

          field.Rotate(rotPoint, !clockwise);

          // Now that we're moving a field, they're no longer autoplaced.
          (field.GetParent() as SCH_ITEM).SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);
        }
      } else if (item.Type() === KICAD_T.SCH_TABLE_T) {
        const table = item as SCH_TABLE;
        let beforeCenter = table.GetCenter();

        table.Rotate(rotPoint, !clockwise);
        beforeCenter = RotatePoint(
          beforeCenter,
          rotPoint,
          clockwise ? ANGLE_90.negate() : ANGLE_90,
        );

        const center = table.GetCenter();
        table.Move({ x: beforeCenter.x - center.x, y: beforeCenter.y - center.y });
      } else if (item.Type() === KICAD_T.SCH_SHEET_T) {
        const sheet = item as SCH_SHEET;

        noConnects = sheet.GetNoConnects();

        sheet.Rotate(rotPoint, !clockwise);
      } else {
        item.Rotate(rotPoint, !clockwise);
      }

      this.m_frame!.UpdateItem(item, false, true);
      this.updateItem(item, true);
    }

    if (moving) {
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else {
      for (const [sheetPin, noConnect] of noConnects) {
        if (!same(noConnect.GetPosition(), sheetPin.GetTextPos())) {
          commit.Modify(noConnect, screen);
          noConnect.SetPosition(sheetPin.GetTextPos());
          this.updateItem(noConnect, true);
        }
      }

      const selectionCopy = new SCH_SELECTION().assign(selection);

      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      const lwbTool = this.lwbTool();
      lwbTool.TrimOverLappingWires(commit, selectionCopy);
      lwbTool.AddJunctionsIfNeeded(commit, selectionCopy);

      this.m_frame!.Schematic().CleanUp(commit);

      if (!localCommit.Empty()) localCommit.Push('Rotate');
    }

    return 0;
  }

  Mirror(aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection(
      SCH_EDIT_TOOL.RotatableItems,
      false,
      false,
    );

    if (selection.GetSize() === 0) return 0;

    const vertical = aEvent.Matches(SCH_ACTIONS.mirrorV.MakeEvent());
    let item = selection.Front() as SCH_ITEM;
    let connections = false;
    const moving = item.IsMoving();
    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);
    const screen = this.m_frame!.GetScreen()!;

    let noConnects = new Map<SCH_SHEET_PIN, SCH_NO_CONNECT>();

    if (selection.GetSize() === 1) {
      if (!moving) commit.Modify(item, screen, RECURSE_MODE.RECURSE);

      switch (item.Type()) {
        case KICAD_T.SCH_SYMBOL_T: {
          const symbol = item as SCH_SYMBOL;

          if (vertical) symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_X);
          else symbol.SetOrientation(SYMBOL_ORIENTATION_T.SYM_MIRROR_Y);

          symbol.SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);
          break;
        }

        case KICAD_T.SCH_TEXT_T:
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T:
        case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
          const textItem = item as SCH_TEXT;
          textItem.MirrorSpinStyle(!vertical);
          break;
        }

        case KICAD_T.SCH_SHEET_PIN_T: {
          // mirror within parent sheet
          const pin = item as SCH_SHEET_PIN;
          const sheet = pin.GetParent()!;

          for (const ncItem of screen
            .Items()
            .Overlapping(KICAD_T.SCH_NO_CONNECT_T, pin.GetTextPos()))
            noConnects.set(pin, ncItem as SCH_NO_CONNECT);

          if (vertical) pin.MirrorVertically(sheet.GetBoundingBox().GetCenter().y);
          else pin.MirrorHorizontally(sheet.GetBoundingBox().GetCenter().x);

          break;
        }

        case KICAD_T.SCH_FIELD_T: {
          const field = item as SCH_FIELD;

          if (vertical) field.SetVertJustify(GetFlippedVAlignment(field.GetVertJustify()));
          else field.SetHorizJustify(GetFlippedHAlignment(field.GetHorizJustify()));

          // Now that we're re-justifying a field, they're no longer autoplaced.
          (field.GetParent() as SCH_ITEM).SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);

          break;
        }

        case KICAD_T.SCH_BITMAP_T:
          if (vertical) item.MirrorVertically(item.GetPosition().y);
          else item.MirrorHorizontally(item.GetPosition().x);

          // The bitmap is cached in Opengl: clear the cache to redraw
          this.getView()!.RecacheAllItems();
          break;

        case KICAD_T.SCH_SHEET_T: {
          noConnects = (item as SCH_SHEET).GetNoConnects();

          // Mirror the sheet on itself. Sheets do not have a anchor point.
          const mirrorPoint = this.m_frame!.GetNearestHalfGridPosition(
            item.GetBoundingBox().Centre(),
          );

          if (vertical) item.MirrorVertically(mirrorPoint.y);
          else item.MirrorHorizontally(mirrorPoint.x);

          break;
        }

        default:
          if (vertical) item.MirrorVertically(item.GetPosition().y);
          else item.MirrorHorizontally(item.GetPosition().x);

          break;
      }

      connections = item.IsConnectable();
      this.m_frame!.UpdateItem(item, false, true);
    } else if (selection.GetSize() > 1) {
      const mirrorPoint = this.m_frame!.GetNearestHalfGridPosition(selection.GetCenter());

      for (const edaItem of selection.GetItems()) {
        item = edaItem as SCH_ITEM;

        if (!moving) commit.Modify(item, screen, RECURSE_MODE.RECURSE);

        if (item.Type() === KICAD_T.SCH_SHEET_PIN_T) {
          if (item.GetParent()!.IsSelected()) {
            // parent will mirror us
          } else {
            // mirror within parent sheet
            const pin = item as SCH_SHEET_PIN;
            const sheet = pin.GetParent()!;

            if (vertical) pin.MirrorVertically(sheet.GetBoundingBox().GetCenter().y);
            else pin.MirrorHorizontally(sheet.GetBoundingBox().GetCenter().x);
          }
        } else if (item.Type() === KICAD_T.SCH_FIELD_T) {
          const field = item as SCH_FIELD;

          if (vertical) field.SetVertJustify(GetFlippedVAlignment(field.GetVertJustify()));
          else field.SetHorizJustify(GetFlippedHAlignment(field.GetHorizJustify()));

          // Now that we're re-justifying a field, they're no longer autoplaced.
          (field.GetParent() as SCH_ITEM).SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);
        } else {
          if (vertical) item.MirrorVertically(mirrorPoint.y);
          else item.MirrorHorizontally(mirrorPoint.x);
        }

        connections ||= item.IsConnectable();
        this.m_frame!.UpdateItem(item, false, true);
      }
    }

    // Update R-Tree for modified items
    for (const selected of selection.GetItems()) this.updateItem(selected, true);

    if (item.IsMoving()) {
      this.m_toolMgr!.RunAction(ACTIONS.refreshPreview);
    } else {
      for (const [sheetPin, noConnect] of noConnects) {
        if (!same(noConnect.GetPosition(), sheetPin.GetTextPos())) {
          commit.Modify(noConnect, screen);
          noConnect.SetPosition(sheetPin.GetTextPos());
          this.updateItem(noConnect, true);
        }
      }

      const selectionCopy = new SCH_SELECTION().assign(selection);

      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (connections) {
        const lwbTool = this.lwbTool();
        lwbTool.TrimOverLappingWires(commit, selectionCopy);
        lwbTool.AddJunctionsIfNeeded(commit, selectionCopy);

        this.m_frame!.Schematic().CleanUp(commit);
      }

      if (!localCommit.Empty()) localCommit.Push('Mirror');
    }

    return 0;
  }

  Swap(aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection(SCH_EDIT_TOOL.SwappableItems);
    const sorted = selection.GetItemsSortedBySelectionOrder();

    if (selection.Size() < 2) return 0;

    // Sheet pins are special, we need to make sure if we have any sheet pins,
    // that we only have sheet pins, and that they have the same parent
    if (selection.CountType(KICAD_T.SCH_SHEET_PIN_T) > 0) {
      if (!selection.OnlyContains([KICAD_T.SCH_SHEET_PIN_T])) return 0;

      const parent = selection.Front()!.GetParent();

      for (const item of selection.GetItems()) {
        if (item.GetParent() !== parent) return 0;
      }
    }

    const moving = selection.Front()!.IsMoving();
    let connections = false;

    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i] as SCH_ITEM;
      const b = sorted[(i + 1) % sorted.length] as SCH_ITEM;

      if (!moving) {
        commit.Modify(a, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
        commit.Modify(b, this.m_frame!.GetScreen(), RECURSE_MODE.RECURSE);
      }

      // std::swap( aPos, bPos )
      const aPos = b.GetPosition();
      const bPos = a.GetPosition();

      // Sheet pins need to have their sides swapped before we change their
      // positions
      if (a.Type() === KICAD_T.SCH_SHEET_PIN_T) {
        const aPin = a as SCH_SHEET_PIN;
        const bPin = b as SCH_SHEET_PIN;
        const aSide = bPin.GetSide();
        const bSide = aPin.GetSide();
        aPin.SetSide(aSide);
        bPin.SetSide(bSide);
      }

      a.SetPosition(aPos);
      b.SetPosition(bPos);

      if (a.Type() === b.Type()) {
        switch (a.Type()) {
          case KICAD_T.SCH_LABEL_T:
          case KICAD_T.SCH_GLOBAL_LABEL_T:
          case KICAD_T.SCH_HIER_LABEL_T:
          case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
            const aLabelBase = a as SCH_LABEL_BASE;
            const bLabelBase = b as SCH_LABEL_BASE;

            const aSpinStyle = aLabelBase.GetSpinStyle();
            const bSpinStyle = bLabelBase.GetSpinStyle();
            const aVertJustify = aLabelBase.GetVertJustify();
            const bVertJustify = bLabelBase.GetVertJustify();

            // First, swap the label orientations
            aLabelBase.SetSpinStyle(bSpinStyle);
            bLabelBase.SetSpinStyle(aSpinStyle);
            aLabelBase.SetVertJustify(bVertJustify);
            bLabelBase.SetVertJustify(aVertJustify);

            // And swap the fields as best we can
            const aFields = aLabelBase.GetFields();
            const bFields = bLabelBase.GetFields();

            const rotationsAtoB = aSpinStyle.CCWRotationsTo(bSpinStyle);

            swapFieldPositionsWithMatching(aFields, bFields, rotationsAtoB);
            break;
          }
          case KICAD_T.SCH_TEXT_T:
          case KICAD_T.SCH_TEXTBOX_T: {
            const aText =
              a instanceof SCH_TEXT || a instanceof SCH_TEXTBOX ? (a as unknown as EDA_TEXT) : null;
            const bText =
              b instanceof SCH_TEXT || b instanceof SCH_TEXTBOX ? (b as unknown as EDA_TEXT) : null;

            if (!aText || !bText) break;

            const aHorizJustify = aText.GetHorizJustify();
            const aVertJustify = aText.GetVertJustify();
            const bHorizJustify = bText.GetHorizJustify();
            const bVertJustify = bText.GetVertJustify();

            aText.SetHorizJustify(bHorizJustify);
            aText.SetVertJustify(bVertJustify);
            bText.SetHorizJustify(aHorizJustify);
            bText.SetVertJustify(aVertJustify);
            break;
          }
          case KICAD_T.SCH_SYMBOL_T: {
            const aSymbol = a as SCH_SYMBOL;
            const bSymbol = b as SCH_SYMBOL;

            // Only swap orientations when both symbols are the same library symbol.
            // Different symbols (e.g. LED vs resistor) have different default orientations,
            // so swapping their orientations leads to unexpected visual results.
            if (aSymbol.GetLibId().equals(bSymbol.GetLibId())) {
              const aOrient = bSymbol.GetOrientation();
              const bOrient = aSymbol.GetOrientation();
              aSymbol.SetOrientation(aOrient);
              bSymbol.SetOrientation(bOrient);
            }

            break;
          }
          default:
            break;
        }
      }

      connections ||= a.IsConnectable();
      connections ||= b.IsConnectable();
      this.m_frame!.UpdateItem(a, false, true);
      this.m_frame!.UpdateItem(b, false, true);
    }

    if (moving) {
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else {
      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (connections) this.m_frame!.TestDanglingEnds();
      this.m_frame!.OnModify();

      if (!localCommit.Empty()) localCommit.Push('Swap');
    }

    return 0;
  }

  /*
   * This command always works on the instance owned by the schematic, never directly on the
   * external library file. Pins that still reference their library definition are swapped by
   * touching that shared lib pin first; afterwards we call UpdatePins() so the schematic now owns
   * a cached copy with the new geometry. Pins that already have an instance-local copy simply
   * swap in place. In both cases the undo stack captures the modified pins (and the parent
   * symbol) so the user can revert the change.
   */
  SwapPins(aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0; // wxCHECK

    if (!this.m_frame.eeconfig()?.input.allow_unconstrained_pin_swaps) return 0;

    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_PIN_T]);
    const sorted = selection.GetItemsSortedBySelectionOrder();

    if (selection.Size() < 2) return 0;

    const parent = selection.Front()!.GetParent();

    if (!parent || parent.Type() !== KICAD_T.SCH_SYMBOL_T) return 0;

    const parentSymbol = parent as SCH_SYMBOL;

    // All pins need to be on the same symbol
    for (const item of selection.GetItems()) {
      if (item.GetParent() !== parent) return 0;
    }

    const sharedSheetPaths = new Set<string>();
    const sharedProjectNames = new Set<string>();

    if (
      SymbolHasSheetInstances(
        parentSymbol,
        this.m_frame.Prj().GetProjectName(),
        sharedSheetPaths,
        sharedProjectNames,
      )
    ) {
      // This will give us nice names for our project, but not when the sheet is shared across
      // multiple projects. But, in that case we bail early and just list the project names so it
      // isn't an issue.
      let friendlySheets = new Set<string>();

      if (sharedSheetPaths.size > 0)
        friendlySheets = GetSheetNamesFromPaths(sharedSheetPaths, this.m_frame.Schematic());

      if (sharedProjectNames.size > 0) {
        const projects = AccumulateDescriptions(sharedProjectNames);

        if (projects === '') {
          this.m_frame.ShowInfoBarError(
            'Pin swaps are disabled for symbols shared across other projects. ' +
              'Duplicate the sheet to edit pins independently.',
          );
        } else {
          this.m_frame.ShowInfoBarError(
            `Pin swaps are disabled for symbols shared across other projects (${projects}). ` +
              'Duplicate the sheet to edit pins independently.',
          );
        }
      } else if (friendlySheets.size > 0) {
        const sheets = AccumulateDescriptions(friendlySheets);

        this.m_frame.ShowInfoBarError(
          `Pin swaps are disabled for symbols used by multiple sheet instances (${sheets}). ` +
            'Duplicate the sheet to edit pins independently.',
        );
      } else {
        this.m_frame.ShowInfoBarError(
          'Pin swaps are disabled for shared symbols. Duplicate the sheet to edit pins independently.',
        );
      }

      return 0;
    }

    let connections = false;

    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);

    // Stage the parent symbol so undo/redo captures the cache copy that UpdatePins() may rebuild
    // after we touch any shared library pins.
    commit.Modify(parentSymbol, this.m_frame.GetScreen(), RECURSE_MODE.RECURSE); // RECURSE is harmless here

    let swappedLibPins = false;

    for (let i = 0; i < sorted.length - 1; i++) {
      const aPin = sorted[i] as SCH_PIN;
      const bPin = sorted[(i + 1) % sorted.length] as SCH_PIN;

      // Record both pins in the commit and swap their geometry.  SwapPinGeometry returns true
      // if it had to operate on the shared library pins (meaning the schematic instance still
      // referenced them), in which case UpdatePins() below promotes the symbol to an instance
      // copy that reflects the new pin order.
      commit.Modify(aPin, this.m_frame.GetScreen(), RECURSE_MODE.RECURSE);
      commit.Modify(bPin, this.m_frame.GetScreen(), RECURSE_MODE.RECURSE);

      swappedLibPins = SwapPinGeometry(aPin, bPin) || swappedLibPins;

      connections ||= aPin.IsConnectable();
      connections ||= bPin.IsConnectable();
      this.m_frame.UpdateItem(aPin, false, true);
      this.m_frame.UpdateItem(bPin, false, true);
    }

    if (swappedLibPins) parentSymbol.UpdatePins(); // clone the library data into the schematic cache with new geometry

    // Refresh changed symbol in screen R-Tree / lib caches
    this.m_frame.UpdateItem(parentSymbol, false, true);

    const selectionCopy = new SCH_SELECTION().assign(selection);

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    // Reconcile any wiring that was connected to the swapped pins so the schematic stays tidy
    // and the undo stack captures the resulting edits to wires and junctions.
    const lwbTool = this.lwbTool();
    lwbTool.TrimOverLappingWires(commit, selectionCopy);
    lwbTool.AddJunctionsIfNeeded(commit, selectionCopy);

    this.m_frame.Schematic().CleanUp(commit);

    if (connections) this.m_frame.TestDanglingEnds();

    this.m_frame.OnModify();

    if (!localCommit.Empty()) localCommit.Push('Swap Pins');

    return 0;
  }

  SwapPinLabels(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_PIN_T]);
    const orderedPins = selection.GetItemsSortedBySelectionOrder();

    if (orderedPins.length < 2) return 0;

    const connectionGraph = this.m_frame!.Schematic().ConnectionGraph();

    const sheetPath = this.m_frame!.GetCurrentSheet();

    const labels: SCH_LABEL_BASE[] = [];

    for (const item of orderedPins) {
      const pin = item as SCH_PIN;
      const label = findSingleNetLabelForPin(pin, connectionGraph, sheetPath);

      if (!label) {
        this.m_frame!.ShowInfoBarError(
          'Each selected pin must have exactly one attached net label and no other pin connections.',
        );
        return 0;
      }

      labels.push(label);
    }

    if (labels.length >= 2) {
      const commit = new SCH_COMMIT(this.m_frame!);

      for (const lb of labels) commit.Modify(lb, this.m_frame!.GetScreen());

      for (let i = 0; i < labels.length - 1; ++i) {
        const a = labels[i]!;
        const b = labels[(i + 1) % labels.length]!;
        const aText = a.GetText();
        const bText = b.GetText();
        a.SetText(bText);
        b.SetText(aText);
      }

      commit.Push('Swap Pin Labels');
    }

    return 0;
  }

  SwapUnitLabels(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T]);
    const selectedUnits = GetSameSymbolMultiUnitSelection(selection);

    if (selectedUnits.length < 2) return 0;

    const connectionGraph = this.m_frame!.Schematic().ConnectionGraph();

    const sheetPath = this.m_frame!.GetCurrentSheet();

    // Build ordered label vectors (sorted by pin X/Y) for each selected unit
    const symbolLabelVectors: SCH_LABEL_BASE[][] = [];

    for (const symbol of selectedUnits) {
      const byPos: [VECTOR2I, SCH_LABEL_BASE][] = [];

      for (const pin of symbol.GetPins(sheetPath)) {
        const label = findSingleNetLabelForPin(pin, connectionGraph, sheetPath);

        if (!label) {
          this.m_frame!.ShowInfoBarError(
            'Each pin of selected units must have exactly one attached net label and ' +
              'no other pin connections.',
          );
          return 0;
        }

        byPos.push([pin.GetPosition(), label]);
      }

      // Sort labels by pin position (X, then Y); std::sort is not stable, but equal keys are
      // pins on the same spot, which a unit does not have.
      byPos.sort((a, b) => (a[0].x !== b[0].x ? a[0].x - b[0].x : a[0].y - b[0].y));

      // Discard position, just keep the order
      symbolLabelVectors.push(byPos.map((pr) => pr[1]));
    }

    // All selected units are guaranteed to have identical pin counts by
    // GetSameSymbolMultiUnitSelection()
    const pinCount = symbolLabelVectors[0]!.length;

    // Perform cyclic swap of labels across all selected symbols, per pin index
    const commit = new SCH_COMMIT(this.m_frame!);

    for (let pin = 0; pin < pinCount; pin++) {
      for (const vec of symbolLabelVectors) commit.Modify(vec[pin]!, this.m_frame!.GetScreen());

      let carry = symbolLabelVectors[symbolLabelVectors.length - 1]![pin]!.GetText();

      for (const vec of symbolLabelVectors) {
        const lbl = vec[pin]!;
        const next = lbl.GetText();
        lbl.SetText(carry);
        carry = next;
      }
    }

    if (!commit.Empty()) commit.Push('Swap Unit Labels');

    return 0;
  }

  RepeatDrawItem(_aEvent: TOOL_EVENT): number {
    const sourceItems = this.m_frame!.GetRepeatItems();

    if (sourceItems.length === 0) return 0;

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const selectionTool = this.m_toolMgr!.GetTool(SCH_SELECTION_TOOL)!;
    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const newItems = new SCH_SELECTION();
    const cfg = this.m_frame!.eeconfig();

    for (const item of sourceItems) {
      const newItem = item.Duplicate(IGNORE_PARENT_GROUP) as SCH_ITEM;
      let restore_state = false;

      // Ensure newItem has a suitable parent: the current screen, because an item from
      // a list of items to repeat must be attached to this current screen
      newItem.SetParent(this.m_frame!.GetScreen());

      const enteredGroup = selectionTool.GetEnteredGroup();

      if (enteredGroup) {
        if (newItem.IsGroupableType()) {
          commit.Modify(enteredGroup, this.m_frame!.GetScreen(), RECURSE_MODE.NO_RECURSE);
          enteredGroup.AddItem(newItem);
        }
      }

      if (newItem instanceof SCH_LABEL_BASE) {
        // If incrementing tries to go below zero, tell user why the value is repeated
        if (cfg) {
          if (!newItem.IncrementLabel(cfg.drawing.repeat_label_increment))
            this.m_frame!.ShowInfoBarWarning('Label value cannot go below zero', true);
        }
      }

      // If cloning a symbol then put into 'move' mode.
      if (newItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const cursorPos = this.getViewControls()!.GetCursorPosition(true);
        const pos = newItem.GetPosition();
        newItem.Move({ x: cursorPos.x - pos.x, y: cursorPos.y - pos.y });
      } else if (cfg) {
        newItem.Move({
          x: schIUScale.milsToIU(cfg.drawing.default_repeat_offset_x),
          y: schIUScale.milsToIU(cfg.drawing.default_repeat_offset_y),
        });
      }

      // If cloning a sheet, check that we aren't going to create recursion
      if (newItem.Type() === KICAD_T.SCH_SHEET_T) {
        const currentSheet = this.m_frame!.GetCurrentSheet();
        const sheet = newItem as SCH_SHEET;

        if (this.m_frame!.CheckSheetForRecursion(sheet, currentSheet)) {
          // Clear out the filename so that the user can pick a new one
          const originalFileName = sheet.GetFileName();
          const originalScreenFileName = sheet.GetScreen()!.GetFileName();

          sheet.SetFileName('');
          sheet.GetScreen()!.SetFileName('');
          restore_state = !this.m_frame!.EditSheetProperties(sheet, currentSheet);

          if (restore_state) {
            sheet.SetFileName(originalFileName);
            sheet.GetScreen()!.SetFileName(originalScreenFileName);
          }
        }
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectItem, newItem as EDA_ITEM);
      newItem.SetFlags(IS_NEW);
      this.m_frame!.AddToScreen(newItem, this.m_frame!.GetScreen());
      commit.Added(newItem, this.m_frame!.GetScreen());

      if (newItem.Type() === KICAD_T.SCH_SYMBOL_T) {
        const projSettings = this.m_frame!.Schematic().Settings();
        const annotateStartNum = projSettings.m_AnnotateStartNum;
        const annotateOrder = projSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T;
        const annotateAlgo = projSettings.m_AnnotateMethod as ANNOTATE_ALGO_T;

        if (cfg?.annotation.automatic) {
          (newItem as SCH_SYMBOL).ClearAnnotation(null, false);
          this.m_frame!.AnnotateSymbols(
            commit,
            ANNOTATE_SCOPE_T.ANNOTATE_SELECTION,
            annotateOrder,
            annotateAlgo,
            true /* recursive */,
            annotateStartNum,
            false,
            false,
            false,
            NULL_REPORTER.GetInstance(),
            SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
          );
        }

        // Annotation clears the selection so re-add the item
        this.m_toolMgr!.RunAction(ACTIONS.selectItem, newItem as EDA_ITEM);

        restore_state = !this.m_toolMgr!.RunSynchronousAction(SCH_ACTIONS.move, commit);
      }

      if (restore_state) {
        commit.Revert();
      } else {
        newItems.Add(newItem);
      }
    }

    if (!newItems.Empty()) {
      const lwbTool = this.lwbTool();
      lwbTool.TrimOverLappingWires(commit, newItems);
      lwbTool.AddJunctionsIfNeeded(commit, newItems);

      this.m_frame!.Schematic().CleanUp(commit);
      commit.Push('Repeat Item');

      const added = newItems.GetItems() as SCH_ITEM[];
      this.m_frame!.SaveCopyForRepeatItem(added[0]!);

      for (let ii = 1; ii < added.length; ++ii) this.m_frame!.AddCopyForRepeatItem(added[ii]!);
    }

    return 0;
  }

  DoDelete(_aEvent: TOOL_EVENT): number {
    const screen = this.m_frame!.GetScreen()!;
    const items = [
      ...this.m_selectionTool!.RequestSelection(SCH_COLLECTOR.DeletableItems).GetItems(),
    ];
    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const pts: VECTOR2I[] = [];
    let updateHierarchy = false;

    if (items.length === 0) return 0;

    // Don't leave a freed pointer in the selection
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    for (const item of items) item.ClearFlags(STRUCT_DELETED);

    for (const item of items) {
      const sch_item = item instanceof SCH_ITEM ? item : null;

      if (!sch_item) continue;

      if (sch_item.IsConnectable()) pts.push(...sch_item.GetConnectionPoints());

      if (sch_item.Type() === KICAD_T.SCH_JUNCTION_T) {
        sch_item.SetFlags(STRUCT_DELETED);
        // clean up junctions at the end
      } else if (sch_item.Type() === KICAD_T.SCH_SHEET_PIN_T) {
        const pin = sch_item as SCH_SHEET_PIN;
        const sheet = pin.GetParent()!;

        if (!items.includes(sheet)) {
          commit.Modify(sheet, this.m_frame!.GetScreen());
          sheet.RemovePin(pin);
        }
      } else if (sch_item.Type() === KICAD_T.SCH_FIELD_T) {
        // Hide field
        commit.Modify(item, this.m_frame!.GetScreen());
        (sch_item as SCH_FIELD).SetVisible(false);
      } else if (sch_item.Type() === KICAD_T.SCH_TABLECELL_T) {
        // Clear contents of table cell
        commit.Modify(item, this.m_frame!.GetScreen());
        (sch_item as SCH_TABLECELL).SetText('');
      } else if (sch_item.Type() === KICAD_T.SCH_RULE_AREA_T) {
        sch_item.SetFlags(STRUCT_DELETED);
        commit.Remove(item, this.m_frame!.GetScreen());
      } else if (sch_item.Type() === KICAD_T.SCH_GROUP_T) {
        // Groups need to delete their children
        sch_item.RunOnChildren((aChild: SCH_ITEM) => {
          aChild.SetFlags(STRUCT_DELETED);
          commit.Remove(aChild, this.m_frame!.GetScreen());
        }, RECURSE_MODE.RECURSE);

        sch_item.SetFlags(STRUCT_DELETED);
        commit.Remove(sch_item, this.m_frame!.GetScreen());
      } else {
        sch_item.SetFlags(STRUCT_DELETED);
        commit.Remove(item, this.m_frame!.GetScreen());
        updateHierarchy ||= sch_item.Type() === KICAD_T.SCH_SHEET_T;
      }
    }

    for (const point of pts) {
      const junction = screen.GetItem(point, 0, KICAD_T.SCH_JUNCTION_T);

      if (!junction) continue;

      if (junction.HasFlag(STRUCT_DELETED) || !screen.IsExplicitJunction(point))
        this.m_frame!.DeleteJunction(commit, junction);
    }

    commit.Push('Delete');

    if (updateHierarchy) this.m_frame!.UpdateHierarchyNavigator();

    return 0;
  }

  private editFieldText(aField: SCH_FIELD): void {
    const parentType = aField.GetParent() ? aField.GetParent()!.Type() : KICAD_T.SCHEMATIC_T;
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    // Save old symbol in undo list if not already in edit, or moving.
    if (aField.GetEditFlags() === 0)
      // i.e. not edited, or moved
      commit.Modify(aField, this.m_frame!.GetScreen());

    if (parentType === KICAD_T.SCH_SYMBOL_T && aField.GetId() === FIELD_T.REFERENCE)
      (aField.GetParent() as SCH_ITEM).SetConnectivityDirty();

    let caption: string;

    // Use title caps for mandatory fields.  "Edit Sheet name Field" looks dorky.
    if (aField.IsMandatory()) {
      const fieldName = GetDefaultFieldName(aField.GetId(), true /* DO_TRANSLATE */);
      caption = `Edit ${TitleCaps(fieldName)} Field`;
    } else {
      caption = `Edit '${aField.GetName()}' Field`;
    }

    // DIALOG_FIELD_PROPERTIES dlg( m_frame, caption, aField ): the footprint field dialog can
    // invoke a KIWAY_PLAYER so KiCad uses a quasi-modal. UpdateField( &commit, … ) is the
    // window's, applied to this commit.
    if (
      this.m_frame!.ShowModalDialog('DIALOG_FIELD_PROPERTIES', [aField], { caption, commit }) !==
      wxID_OK
    )
      return;

    if (this.m_frame!.eeconfig()?.autoplace_fields.enable || parentType === KICAD_T.SCH_SHEET_T) {
      const parent = aField.GetParent() as SCH_ITEM;
      const fieldsAutoplaced = parent.GetFieldsAutoplaced();

      if (
        fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
        fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
      )
        parent.AutoplaceFields(this.m_frame!.GetScreen(), fieldsAutoplaced);
    }

    if (!commit.Empty()) commit.Push(caption);
  }

  EditField(aEvent: TOOL_EVENT): number {
    const sel = this.m_selectionTool!.RequestSelection([
      KICAD_T.SCH_FIELD_T,
      KICAD_T.SCH_SYMBOL_T,
      KICAD_T.SCH_PIN_T,
    ]);

    if (sel.Size() !== 1) return 0;

    let clearSelection = sel.IsHover();
    let item: EDA_ITEM | null = sel.Front()!;

    if (item.Type() === KICAD_T.SCH_FIELD_T) {
      const field = item as SCH_FIELD;

      if (
        (aEvent.IsAction(SCH_ACTIONS.editReference) && field.GetId() !== FIELD_T.REFERENCE) ||
        (aEvent.IsAction(SCH_ACTIONS.editValue) && field.GetId() !== FIELD_T.VALUE) ||
        (aEvent.IsAction(SCH_ACTIONS.editFootprint) && field.GetId() !== FIELD_T.FOOTPRINT)
      ) {
        item = field.GetParentSymbol();

        this.m_selectionTool!.ClearSelection(true);

        // If the field to edit is not a symbol field, we cannot edit the ref, value or footprint
        if (item === null) return 0;

        this.m_selectionTool!.AddItemToSel(item);
      }
    }

    const editSymbolField = (symbol: SCH_SYMBOL) => {
      if (aEvent.IsAction(SCH_ACTIONS.editReference)) {
        this.editFieldText(symbol.GetField(FIELD_T.REFERENCE)!);
      } else if (aEvent.IsAction(SCH_ACTIONS.editValue)) {
        this.editFieldText(symbol.GetField(FIELD_T.VALUE)!);
      } else if (aEvent.IsAction(SCH_ACTIONS.editFootprint)) {
        if (!symbol.IsPower()) this.editFieldText(symbol.GetField(FIELD_T.FOOTPRINT)!);
      }
    };

    if (item.Type() === KICAD_T.SCH_SYMBOL_T) {
      editSymbolField(item as SCH_SYMBOL);
    } else if (item.Type() === KICAD_T.SCH_FIELD_T) {
      const field = item as SCH_FIELD;

      this.editFieldText(field);

      if (!field.IsVisible()) clearSelection = true;
    } else if (item.Type() === KICAD_T.SCH_PIN_T) {
      const parent = item.GetParent();

      if (parent instanceof SCH_SYMBOL) editSymbolField(parent);
    }

    if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  AutoplaceFields(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection(SCH_EDIT_TOOL.RotatableItems);
    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const head = selection.Front() as SCH_ITEM | null;
    const moving = !!head && head.IsMoving();

    if (selection.Empty()) return 0;

    const autoplaceItems: SCH_ITEM[] = [];

    for (const item of selection.GetItems() as SCH_ITEM[]) {
      if (item.IsType(SCH_COLLECTOR.FieldOwners)) autoplaceItems.push(item);
      else if (item.GetParent()?.IsType(SCH_COLLECTOR.FieldOwners))
        autoplaceItems.push(item.GetParent() as SCH_ITEM);
    }

    for (const sch_item of autoplaceItems) {
      if (!moving && !sch_item.IsNew()) commit.Modify(sch_item, this.m_frame!.GetScreen());

      sch_item.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_MANUAL);

      this.updateItem(sch_item, true);
    }

    if (moving) {
      this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
    } else {
      if (!commit.Empty()) commit.Push('Autoplace Fields');

      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
    }

    return 0;
  }

  ChangeSymbols(aEvent: TOOL_EVENT): number {
    let selectedSymbol: SCH_SYMBOL | null = null;
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T]);

    if (!selection.Empty()) {
      const front = selection.Front();
      selectedSymbol = front instanceof SCH_SYMBOL ? front : null;
    }

    let mode = DIALOG_CHANGE_SYMBOLS_MODE.UPDATE;

    if (aEvent.IsAction(SCH_ACTIONS.changeSymbol) || aEvent.IsAction(SCH_ACTIONS.changeSymbols))
      mode = DIALOG_CHANGE_SYMBOLS_MODE.CHANGE;

    // QuasiModal required to invoke symbol browser
    this.m_frame!.ShowModalDialog(
      'DIALOG_CHANGE_SYMBOLS',
      selectedSymbol ? [selectedSymbol] : [],
      mode,
    );

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  CycleBodyStyle(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T]);

    if (selection.Empty()) return 0;

    const symbol = selection.Front() as SCH_SYMBOL;
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    if (!symbol.IsNew()) commit.Modify(symbol, this.m_frame!.GetScreen());

    let nextBodyStyle = symbol.GetBodyStyle() + 1;

    if (nextBodyStyle > symbol.GetBodyStyleCount()) nextBodyStyle = 1;

    this.m_frame!.SelectBodyStyle(symbol, nextBodyStyle);

    if (symbol.IsNew()) this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

    if (!commit.Empty()) commit.Push('Change Body Style');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  Properties(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection();
    const clearSelection = selection.IsHover();

    if (selection.Empty()) {
      if (this.getView()!.IsLayerVisible(SCH_LAYER_ID.LAYER_SCHEMATIC_DRAWINGSHEET)) {
        const ds = this.m_frame!.GetCanvas()?.GetView().GetDrawingSheet() ?? null;
        const cursorPos = this.getViewControls()!.GetCursorPosition(false);

        if (ds?.HitTestDrawingSheetItems(this.getView()!, cursorPos))
          this.m_toolMgr!.PostAction(ACTIONS.pageSettings);
      }

      return 0;
    }

    let curr_item = selection.Front()!;

    // If a single pin is selected, promote to its parent symbol
    if (selection.GetSize() === 1 && curr_item.Type() === KICAD_T.SCH_PIN_T) {
      const parent = curr_item.GetParent()!;

      if (parent.Type() === KICAD_T.SCH_SYMBOL_T) curr_item = parent;
    }

    switch (curr_item.Type()) {
      case KICAD_T.SCH_LINE_T:
      case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
      case KICAD_T.SCH_JUNCTION_T:
        if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.SCH_ITEM_LOCATE_GRAPHIC_LINE_T])(selection)) {
          this.m_frame!.ShowModalDialog('DIALOG_LINE_PROPERTIES', selection.Items());
        } else if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.SCH_JUNCTION_T])(selection)) {
          this.m_frame!.ShowModalDialog('DIALOG_JUNCTION_PROPS', selection.Items());
        } else if (
          SELECTION_CONDITIONS.OnlyTypes([
            KICAD_T.SCH_ITEM_LOCATE_WIRE_T,
            KICAD_T.SCH_ITEM_LOCATE_BUS_T,
            KICAD_T.SCH_BUS_WIRE_ENTRY_T,
            KICAD_T.SCH_JUNCTION_T,
          ])(selection)
        ) {
          this.m_frame!.ShowModalDialog('DIALOG_WIRE_BUS_PROPERTIES', selection.Items());
        } else {
          return 0;
        }

        break;

      case KICAD_T.SCH_MARKER_T:
        if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.SCH_MARKER_T])(selection)) {
          const inspectionTool = this.m_toolMgr!.FindTool('eeschema.InspectionTool') as unknown as {
            CrossProbe(aMarker: SCH_MARKER): void;
          } | null;

          if (inspectionTool) inspectionTool.CrossProbe(selection.Front() as SCH_MARKER);
        }
        break;

      case KICAD_T.SCH_TABLECELL_T:
        if (SELECTION_CONDITIONS.OnlyTypes([KICAD_T.SCH_TABLECELL_T])(selection)) {
          const cells = selection.Items() as SCH_TABLECELL[];

          // QuasiModal required for syntax help and Scintilla auto-complete
          const ret = this.m_frame!.ShowModalDialog('DIALOG_TABLECELL_PROPERTIES', cells);

          if (ret === TABLECELL_PROPS_EDIT_TABLE) {
            const table = cells[0]!.GetParent() as SCH_TABLE;
            this.m_frame!.ShowModalDialog('DIALOG_TABLE_PROPERTIES', [table]);
          }
        }

        break;

      default:
        if (selection.Size() > 1) return 0;

        this.EditProperties(curr_item);
    }

    if (clearSelection) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  EditProperties(aItem: EDA_ITEM): void {
    switch (aItem.Type()) {
      case KICAD_T.SCH_SYMBOL_T: {
        const symbol = aItem as SCH_SYMBOL;

        // This dialog itself subsequently can invoke a KIWAY_PLAYER as a quasimodal frame.
        const retval = this.m_frame!.ShowModalDialog('DIALOG_SYMBOL_PROPERTIES', [symbol]);

        if (retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_OK) {
          if (this.m_frame!.eeconfig()?.autoplace_fields.enable) {
            const fieldsAutoplaced = symbol.GetFieldsAutoplaced();

            if (
              fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_AUTO ||
              fieldsAutoplaced === AUTOPLACE_ALGO.AUTOPLACE_MANUAL
            )
              symbol.AutoplaceFields(this.m_frame!.GetScreen(), fieldsAutoplaced);
          }

          this.m_frame!.OnModify();
        } else if (
          retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL ||
          retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_LIBRARY_SYMBOL
        ) {
          // Kiway().Player( FRAME_SCH_SYMBOL_EDITOR, true ) then LoadSymbolFromSchematic /
          // LoadSymbol: opening the symbol editor is the window's, as the dialog's return says.
          // The broken library symbol link indicator cannot be edited.
          if (
            retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_EDIT_SCHEMATIC_SYMBOL &&
            symbol.IsMissingLibSymbol()
          )
            return;
        } else if (retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_WANT_UPDATE_SYMBOL) {
          this.m_frame!.ShowModalDialog(
            'DIALOG_CHANGE_SYMBOLS',
            [symbol],
            DIALOG_CHANGE_SYMBOLS_MODE.UPDATE,
          );
        } else if (retval === SYMBOL_PROPS_RETVALUE.SYMBOL_PROPS_WANT_EXCHANGE_SYMBOL) {
          this.m_frame!.ShowModalDialog(
            'DIALOG_CHANGE_SYMBOLS',
            [symbol],
            DIALOG_CHANGE_SYMBOLS_MODE.CHANGE,
          );
        }

        break;
      }

      case KICAD_T.SCH_SHEET_T: {
        const sheet = aItem as SCH_SHEET;

        // Keep track of existing sheet paths. EditSheet() can modify this list.
        // Note that we use the validity checking/repairing version here just to make sure
        // we've got a valid hierarchy to begin with.
        const originalHierarchy = new SCH_SHEET_LIST();
        originalHierarchy.BuildSheetList(this.m_frame!.Schematic().Root(), true);

        const commit = new SCH_COMMIT(this.m_toolMgr!);
        commit.Modify(sheet, this.m_frame!.GetScreen());
        const result = this.m_frame!.EditSheetProperties(sheet, this.m_frame!.GetCurrentSheet());
        const okPressed = result !== null;

        if (result) {
          if (result.isUndoable) {
            commit.Push('Edit Sheet Properties');
          } else {
            // The sheet file change invalidated the undo/redo list.
            this.m_frame!.ClearUndoRedoList();

            const items: SCH_ITEM[] = [sheet];
            this.m_frame!.Schematic().OnItemsRemoved(items);
            this.m_frame!.Schematic().OnItemsAdded(items);
            this.m_frame!.OnModify();
            this.m_frame!.Schematic().RefreshHierarchy();
            this.m_frame!.UpdateHierarchyNavigator();
          }
        }

        // If the sheet file is changed and new sheet contents are loaded then we have to
        // clear the annotations on the new content (as it may have been set from some other
        // sheet path reference)
        if (result?.clearAnnotation) {
          const screensList = new SCH_SCREENS(this.m_frame!.Schematic().Root());

          // We clear annotation of new sheet paths here:
          screensList.ClearAnnotationOfNewSheetPaths(originalHierarchy);

          // Clear annotation of g_CurrentSheet itself, because its sheetpath is not a new
          // path, but symbols managed by its sheet path must have their annotation cleared
          // because they are new:
          sheet.GetScreen()!.ClearAnnotation(this.m_frame!.GetCurrentSheet(), false);
        }

        if (okPressed) this.m_frame!.GetCanvas()?.Refresh();

        if (result?.updateHierarchyNavigator) this.m_frame!.UpdateHierarchyNavigator();

        break;
      }

      case KICAD_T.SCH_SHEET_PIN_T:
        // QuasiModal required for help dialog
        this.m_frame!.ShowModalDialog('DIALOG_SHEET_PIN_PROPERTIES', [aItem]);
        break;

      case KICAD_T.SCH_TEXT_T:
      case KICAD_T.SCH_TEXTBOX_T:
        // QuasiModal required for syntax help and Scintilla auto-complete
        this.m_frame!.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [aItem]);
        break;

      case KICAD_T.SCH_TABLE_T:
        // QuasiModal required for Scintilla auto-complete
        this.m_frame!.ShowModalDialog('DIALOG_TABLE_PROPERTIES', [aItem]);
        break;

      case KICAD_T.SCH_LABEL_T:
      case KICAD_T.SCH_GLOBAL_LABEL_T:
      case KICAD_T.SCH_HIER_LABEL_T:
      case KICAD_T.SCH_DIRECTIVE_LABEL_T:
        // QuasiModal for syntax help and Scintilla auto-complete
        this.m_frame!.ShowModalDialog('DIALOG_LABEL_PROPERTIES', [aItem], false);
        break;

      case KICAD_T.SCH_FIELD_T: {
        const field = aItem as SCH_FIELD;

        this.editFieldText(field);

        if (!field.IsVisible()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

        break;
      }

      case KICAD_T.SCH_SHAPE_T:
        this.m_frame!.ShowModalDialog('DIALOG_SHAPE_PROPERTIES', [aItem]);
        break;

      case KICAD_T.SCH_BITMAP_T:
        if (this.m_frame!.ShowModalDialog('DIALOG_IMAGE_PROPERTIES', [aItem]) === wxID_OK) {
          // The bitmap is cached in Opengl: clear the cache in case it has become invalid
          this.getView()!.RecacheAllItems();
        }

        break;

      case KICAD_T.SCH_RULE_AREA_T:
        // dlg.SetTitle( _( "Rule Area Properties" ) )
        this.m_frame!.ShowModalDialog('DIALOG_SHAPE_PROPERTIES', [aItem], 'Rule Area Properties');
        break;

      case KICAD_T.SCH_NO_CONNECT_T:
      case KICAD_T.SCH_PIN_T:
        break;

      case KICAD_T.SCH_GROUP_T:
        this.m_toolMgr!.RunAction(ACTIONS.groupProperties, aItem as SCH_GROUP);

        break;

      default: // Unexpected item
        throw new Error(`Cannot edit schematic item type ${aItem.GetClass()}`);
    }

    this.updateItem(aItem, true);
  }

  ChangeTextType(aEvent: TOOL_EVENT): number {
    const convertTo = aEvent.Parameter<KICAD_T>();
    const selection = new SCH_SELECTION().assign(
      this.m_selectionTool!.RequestSelection([
        KICAD_T.SCH_LABEL_LOCATE_ANY_T,
        KICAD_T.SCH_TEXT_T,
        KICAD_T.SCH_TEXTBOX_T,
      ]),
    );
    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);
    const screen = this.m_frame!.GetScreen();

    for (const selItem of selection.GetItems()) {
      const item = selItem instanceof SCH_ITEM ? selItem : null;

      if (!item || item.Type() === convertTo) continue;

      const sourceText =
        item instanceof SCH_TEXT || item instanceof SCH_TEXTBOX
          ? (item as unknown as EDA_TEXT)
          : null;
      const selected = item.IsSelected();
      let newtext: SCH_ITEM | null = null;
      let position = item.GetPosition();
      let txt = '';
      let href = '';
      let spinStyle = new SPIN_STYLE(SPIN_STYLE.RIGHT);
      let shape = LABEL_FLAG_SHAPE.L_UNSPECIFIED;

      if (!sourceText) continue; // wxCHECK2

      switch (item.Type()) {
        case KICAD_T.SCH_LABEL_T:
        case KICAD_T.SCH_GLOBAL_LABEL_T:
        case KICAD_T.SCH_HIER_LABEL_T: {
          const label = item as SCH_LABEL_BASE;

          txt = UnescapeString(label.GetText());
          spinStyle = label.GetSpinStyle();
          shape = label.GetShape();
          href = label.GetHyperlink();
          break;
        }

        case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
          const dirlabel = item as SCH_DIRECTIVE_LABEL;

          // a SCH_DIRECTIVE_LABEL has no text
          txt = '<empty>';

          spinStyle = dirlabel.GetSpinStyle();
          href = dirlabel.GetHyperlink();
          break;
        }

        case KICAD_T.SCH_TEXT_T: {
          const text = item as SCH_TEXT;

          txt = text.GetText();
          href = text.GetHyperlink();
          break;
        }

        case KICAD_T.SCH_TEXTBOX_T: {
          const textbox = item as SCH_TEXTBOX;
          const bbox = textbox.GetBoundingBox();

          bbox.SetOrigin(
            bbox.GetLeft() + textbox.GetMarginLeft(),
            bbox.GetTop() + textbox.GetMarginTop(),
          );
          bbox.SetEnd(
            bbox.GetRight() - textbox.GetMarginRight(),
            bbox.GetBottom() - textbox.GetMarginBottom(),
          );

          if (
            convertTo === KICAD_T.SCH_LABEL_T ||
            convertTo === KICAD_T.SCH_HIER_LABEL_T ||
            convertTo === KICAD_T.SCH_GLOBAL_LABEL_T
          ) {
            const textSize = sourceText.GetTextSize().y;
            bbox.Inflate(KiROUND(item.Schematic()!.Settings().m_LabelSizeRatio * textSize));
          }

          txt = textbox.GetText();

          if (textbox.GetTextAngle().IsVertical()) {
            if (textbox.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT) {
              spinStyle = new SPIN_STYLE(SPIN_STYLE.BOTTOM);
              position = { x: bbox.Centre().x, y: bbox.GetOrigin().y };
            } else {
              spinStyle = new SPIN_STYLE(SPIN_STYLE.UP);
              position = { x: bbox.Centre().x, y: bbox.GetEnd().y };
            }
          } else {
            if (textbox.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT) {
              spinStyle = new SPIN_STYLE(SPIN_STYLE.LEFT);
              position = { x: bbox.GetEnd().x, y: bbox.Centre().y };
            } else {
              spinStyle = new SPIN_STYLE(SPIN_STYLE.RIGHT);
              position = { x: bbox.GetOrigin().x, y: bbox.Centre().y };
            }
          }

          position = this.m_frame!.GetNearestGridPosition(position);
          href = textbox.GetHyperlink();
          break;
        }

        default:
          throw new Error(`SCH_EDIT_TOOL::ChangeTextType: unimplemented for ${item.GetClass()}`);
      }

      const getValidNetname = (aText: string): string => {
        let local_txt = aText;
        local_txt = local_txt.replaceAll('\n', '_');
        local_txt = local_txt.replaceAll('\r', '_');
        local_txt = local_txt.replaceAll('\t', '_');

        // Bus groups can have spaces; bus vectors and signal names cannot
        if (!NET_SETTINGS.ParseBusGroup(aText, null, null))
          local_txt = local_txt.replaceAll(' ', '_');

        // label strings are "escaped" i.e. a '/' is replaced by "{slash}"
        local_txt = EscapeString(local_txt, ESCAPE_CONTEXT.CTX_NETNAME);

        if (local_txt === '') return '<empty>';
        else return local_txt;
      };

      // The global / hierarchical / local label conversions mirror the new label the way its
      // spin faces, so a flag that pointed one way still does.
      const mirrorAsSource = (aNewLabel: SCH_LABEL_BASE) => {
        const spin = Number((item as SCH_LABEL_BASE).GetSpinStyle());

        if (spin === SPIN_STYLE.UP) aNewLabel.MirrorVertically(position.y);
        else if (spin === SPIN_STYLE.BOTTOM) aNewLabel.MirrorVertically(position.y);
        else if (spin === SPIN_STYLE.LEFT) aNewLabel.MirrorHorizontally(position.x);
        else if (spin === SPIN_STYLE.RIGHT) aNewLabel.MirrorHorizontally(position.x);
      };

      switch (convertTo) {
        case KICAD_T.SCH_LABEL_T: {
          const new_label = new SCH_LABEL(position, getValidNetname(txt));

          new_label.SetShape(shape);
          new_label.SetAttributes(sourceText, false);
          new_label.SetSpinStyle(spinStyle);
          new_label.SetHyperlink(href);

          if (
            item.Type() === KICAD_T.SCH_GLOBAL_LABEL_T ||
            item.Type() === KICAD_T.SCH_HIER_LABEL_T
          )
            mirrorAsSource(new_label);

          newtext = new_label;
          break;
        }

        case KICAD_T.SCH_GLOBAL_LABEL_T: {
          const new_label = new SCH_GLOBALLABEL(position, getValidNetname(txt));

          new_label.SetShape(shape);
          new_label.SetAttributes(sourceText, false);
          new_label.SetSpinStyle(spinStyle);
          new_label.SetHyperlink(href);

          if (item.Type() === KICAD_T.SCH_LABEL_T) mirrorAsSource(new_label);

          newtext = new_label;
          break;
        }

        case KICAD_T.SCH_HIER_LABEL_T: {
          const new_label = new SCH_HIERLABEL(position, getValidNetname(txt));

          new_label.SetShape(shape);
          new_label.SetAttributes(sourceText, false);
          new_label.SetSpinStyle(spinStyle);
          new_label.SetHyperlink(href);

          if (item.Type() === KICAD_T.SCH_LABEL_T) mirrorAsSource(new_label);

          newtext = new_label;
          break;
        }

        case KICAD_T.SCH_DIRECTIVE_LABEL_T: {
          const new_label = new SCH_DIRECTIVE_LABEL(position);

          // A SCH_DIRECTIVE_LABEL usually has at least one field containing the net class
          // name.  If we're copying from a text object assume the text is the netclass
          // name.  Otherwise, we'll just copy the fields which will either have a netclass
          // or not.
          if (!(item instanceof SCH_LABEL_BASE)) {
            const netclass = new SCH_FIELD(new_label, FIELD_T.USER, 'Netclass');
            netclass.SetText(txt);
            netclass.SetTextPos(position);
            new_label.GetFields().push(netclass);
          }

          new_label.SetShape(LABEL_FLAG_SHAPE.F_ROUND);
          new_label.SetAttributes(sourceText, false);
          new_label.SetSpinStyle(spinStyle);
          new_label.SetHyperlink(href);
          newtext = new_label;
          break;
        }

        case KICAD_T.SCH_TEXT_T: {
          const new_text = new SCH_TEXT(position, txt);

          new_text.SetAttributes(sourceText, false);
          new_text.SetHyperlink(href);
          newtext = new_text;
          break;
        }

        case KICAD_T.SCH_TEXTBOX_T: {
          const new_textbox = new SCH_TEXTBOX(SCH_LAYER_ID.LAYER_NOTES, 0, FILL_T.NO_FILL, txt);
          const bbox = item.GetBoundingBox();

          if (item instanceof SCH_LABEL_BASE) bbox.Inflate(-item.GetLabelBoxExpansion());

          new_textbox.SetAttributes(sourceText, false);

          bbox.SetOrigin(
            bbox.GetLeft() - new_textbox.GetMarginLeft(),
            bbox.GetTop() - new_textbox.GetMarginTop(),
          );
          bbox.SetEnd(
            bbox.GetRight() + new_textbox.GetMarginRight(),
            bbox.GetBottom() + new_textbox.GetMarginBottom(),
          );

          const topLeft = { ...bbox.GetPosition() };
          const botRight = { ...bbox.GetEnd() };

          // Add 1/20 of the margin at the end to reduce line-breaking changes.
          const slop = Math.trunc(new_textbox.GetLegacyTextMargin() / 20);

          if (sourceText.GetTextAngle().equals(ANGLE_VERTICAL)) {
            if (sourceText.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
              botRight.y += slop;
            else topLeft.y -= slop;
          } else {
            if (sourceText.GetHorizJustify() === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT)
              topLeft.x -= slop;
            else botRight.x += slop;
          }

          new_textbox.SetPosition(topLeft);
          new_textbox.SetEnd(botRight);

          new_textbox.SetHyperlink(href);
          newtext = new_textbox;
          break;
        }

        default:
          throw new Error(`SCH_EDIT_TOOL::ChangeTextType: unimplemented for ${convertTo}.`);
      }

      // Copy the old text item settings to the new one.  Justifications are not copied
      // because they are not used in labels.  Justifications will be set to default value
      // in the new text item type.
      //
      newtext.SetFlags(item.GetEditFlags());

      const eda_text = sourceText;
      const new_eda_text = newtext as unknown as EDA_TEXT;

      new_eda_text.SetFont(eda_text.GetFont());
      new_eda_text.SetTextSize(eda_text.GetTextSize());
      new_eda_text.SetTextThickness(eda_text.GetTextThickness());

      // Must be after SetTextSize()
      new_eda_text.SetBold(eda_text.IsBold());
      new_eda_text.SetItalic(eda_text.IsItalic());

      newtext.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

      const label = item instanceof SCH_LABEL_BASE ? item : null;
      const new_label = newtext instanceof SCH_LABEL_BASE ? newtext : null;

      if (label && new_label) {
        new_label.AddFields(label.GetFields());

        // A SCH_GLOBALLABEL has a specific field for intersheet references that has
        // no meaning for other labels
        const fields = new_label.GetFields();

        for (let ii = fields.length - 1; ii >= 0; ii--) {
          if (
            fields[ii]!.GetId() === FIELD_T.INTERSHEET_REFS &&
            new_label.Type() !== KICAD_T.SCH_GLOBAL_LABEL_T
          )
            fields.splice(ii, 1);
        }
      }

      if (selected) this.m_toolMgr!.RunAction(ACTIONS.unselectItem, item as EDA_ITEM);

      this.m_frame!.RemoveFromScreen(item, screen);

      if (commit.GetStatus(item, screen) === CHANGE_TYPE.CHT_ADD) commit.Unstage(item, screen);
      else commit.Removed(item, screen);

      this.m_frame!.AddToScreen(newtext, screen);
      commit.Added(newtext, screen);

      if (selected) this.m_toolMgr!.RunAction(ACTIONS.selectItem, newtext as EDA_ITEM);
    }

    if (!localCommit.Empty()) localCommit.Push('Change To');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  JustifyText(aEvent: TOOL_EVENT): number {
    const justifiableItems = [
      KICAD_T.SCH_FIELD_T,
      KICAD_T.SCH_TEXT_T,
      KICAD_T.SCH_TEXTBOX_T,
      KICAD_T.SCH_LABEL_T,
    ];

    const selection = this.m_selectionTool!.RequestSelection(justifiableItems);

    if (selection.GetSize() === 0) return 0;

    let item = selection.Front() as SCH_ITEM;
    const moving = item.IsMoving();
    const localCommit = new SCH_COMMIT(this.m_toolMgr!);
    const commit = this.eventCommit(aEvent, localCommit);

    const setJustify = (aTextItem: EDA_TEXT) => {
      if (aEvent.Matches(ACTIONS.leftJustify.MakeEvent()))
        aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT);
      else if (aEvent.Matches(ACTIONS.centerJustify.MakeEvent()))
        aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
      else aTextItem.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT);
    };

    for (const edaItem of selection.GetItems()) {
      item = edaItem as SCH_ITEM;

      if (!moving) commit.Modify(item, this.m_frame!.GetScreen());

      if (item.Type() === KICAD_T.SCH_FIELD_T) {
        setJustify(item as SCH_FIELD as unknown as EDA_TEXT);

        // Now that we're re-justifying a field, they're no longer autoplaced.
        (item.GetParent() as SCH_ITEM).SetFieldsAutoplaced(AUTOPLACE_ALGO.AUTOPLACE_NONE);
      } else if (item.Type() === KICAD_T.SCH_TEXT_T) {
        setJustify(item as SCH_TEXT as unknown as EDA_TEXT);
      } else if (item.Type() === KICAD_T.SCH_TEXTBOX_T) {
        setJustify(item as SCH_TEXTBOX as unknown as EDA_TEXT);
      } else if (item.Type() === KICAD_T.SCH_LABEL_T) {
        const label = item as SCH_LABEL;

        if (label.GetTextAngle().equals(ANGLE_HORIZONTAL)) setJustify(label as unknown as EDA_TEXT);
      }

      this.m_frame!.UpdateItem(item, false, true);
    }

    // Update R-Tree for modified items
    for (const selected of selection.GetItems()) this.updateItem(selected, true);

    if (item.IsMoving()) {
      this.m_toolMgr!.RunAction(ACTIONS.refreshPreview);
    } else {
      if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (!localCommit.Empty()) {
        if (aEvent.Matches(ACTIONS.leftJustify.MakeEvent())) localCommit.Push('Left Justify');
        else if (aEvent.Matches(ACTIONS.centerJustify.MakeEvent()))
          localCommit.Push('Center Justify');
        else localCommit.Push('Right Justify');
      }
    }

    return 0;
  }

  CleanupSheetPins(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SHEET_T]);
    const sheet = selection.Front() as SCH_SHEET | null;
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    if (!sheet || !sheet.HasUndefinedPins()) return 0;

    if (!this.m_frame!.IsOK('Do you wish to delete the unreferenced pins from this sheet?'))
      return 0;

    commit.Modify(sheet, this.m_frame!.GetScreen());

    sheet.CleanupSheet();

    this.updateItem(sheet, true);

    commit.Push('Cleanup Sheet Pins');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  EditPageNumber(_aEvent: TOOL_EVENT): number {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SHEET_T]);

    if (selection.GetSize() > 1) return 0;

    let sheet = selection.Front() as SCH_SHEET | null;

    const instance = this.m_frame!.GetCurrentSheet().Clone();

    let screen: SCH_SCREEN;

    if (sheet) {
      // When changing the page number of a selected sheet, the current screen owns the sheet.
      screen = this.m_frame!.GetScreen()!;

      instance.push_back(sheet);
    } else {
      const prevInstance = instance.Clone();

      // When change the page number in the screen, the previous screen owns the sheet.
      if (prevInstance.size()) {
        prevInstance.pop_back();
        screen = prevInstance.LastScreen()!;
      } else {
        // The root sheet and root screen are effectively the same thing.
        screen = this.m_frame!.GetScreen()!;
      }

      sheet = this.m_frame!.GetCurrentSheet().Last();
    }

    const sheetPath = instance.PathHumanReadable(false);
    const pageNumber = instance.GetPageNumber();

    const msg = `Enter page number for sheet path${sheetPath.length > 20 ? `\n${sheetPath}` : ` ${sheetPath}`}`;

    // dlg.SetTextValidator( wxFILTER_ALPHANUMERIC ): no white space.
    const value = this.m_frame!.TextEntryDialog(msg, 'Edit Sheet Page Number', pageNumber);

    if (value === null || value === instance.GetPageNumber()) return 0;

    const commit = new SCH_COMMIT(this.m_frame!);

    commit.Modify(sheet!, screen);

    instance.SetPageNumber(value);

    if (instance.equals(this.m_frame!.GetCurrentSheet())) {
      this.m_frame!.GetScreen()!.SetPageNumber(value);
      this.m_frame!.OnPageSettingsChange();
    }

    commit.Push('Change Sheet Page Number');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  DdAppendFile(aEvent: TOOL_EVENT): number {
    return this.m_toolMgr!.RunAction(SCH_ACTIONS.importSheet, aEvent.Parameter<string>()) ? 1 : 0;
  }

  SetAttribute(aEvent: TOOL_EVENT): number {
    const selection = aEvent.IsAction(SCH_ACTIONS.setExcludeFromPosFiles)
      ? this.m_selectionTool!.RequestSelection([KICAD_T.SCH_SYMBOL_T])
      : this.m_selectionTool!.RequestSelection([
          KICAD_T.SCH_SYMBOL_T,
          KICAD_T.SCH_SHEET_T,
          KICAD_T.SCH_RULE_AREA_T,
        ]);

    // std::set<std::pair<SCH_ITEM*, SCH_SCREEN*>>: keyed on the pair, so an item reached from
    // two screens is collected twice.
    const collectedItems: [SCH_ITEM, SCH_SCREEN | null][] = [];
    const collect = (aItem: SCH_ITEM, aScreen: SCH_SCREEN | null) => {
      if (!collectedItems.some(([i, s]) => i === aItem && s === aScreen))
        collectedItems.push([aItem, aScreen]);
    };

    for (const item of selection.GetItems()) {
      if (item instanceof SCH_SYMBOL) {
        const symbol = item;
        collect(symbol, this.m_frame!.GetScreen());

        // The attributes should be kept in sync in multi-unit parts.
        // Of course the symbol must be annotated to collect other units.
        if (symbol.IsAnnotated(this.m_frame!.GetCurrentSheet())) {
          const ref = symbol.GetRef(this.m_frame!.GetCurrentSheet());
          const unit = symbol.GetUnit();
          const libId = symbol.GetLibId();

          for (const sheet of this.m_frame!.Schematic().Hierarchy()) {
            const screen = sheet.LastScreen();
            const otherUnits: SCH_SYMBOL[] = [];

            CollectOtherUnits(ref, unit, libId, sheet, otherUnits);

            for (const otherUnit of otherUnits) collect(otherUnit, screen);
          }
        }
      } else if (item.Type() === KICAD_T.SCH_SHEET_T || item.Type() === KICAD_T.SCH_RULE_AREA_T) {
        collect(item as SCH_SHEET | SCH_RULE_AREA, this.m_frame!.GetScreen());
      }
    }

    const commit = new SCH_COMMIT(this.m_toolMgr!);
    const sheet = this.m_frame!.GetCurrentSheet();
    const variant = this.m_frame!.Schematic().GetCurrentVariant();
    let new_state = false;

    for (const [item] of collectedItems) {
      if (
        (aEvent.IsAction(SCH_ACTIONS.setDNP) && !item.GetDNP(sheet, variant)) ||
        (aEvent.IsAction(SCH_ACTIONS.setExcludeFromSim) &&
          !item.GetExcludedFromSim(sheet, variant)) ||
        (aEvent.IsAction(SCH_ACTIONS.setExcludeFromBOM) &&
          !item.GetExcludedFromBOM(sheet, variant)) ||
        (aEvent.IsAction(SCH_ACTIONS.setExcludeFromBoard) &&
          !item.GetExcludedFromBoard(sheet, variant)) ||
        (aEvent.IsAction(SCH_ACTIONS.setExcludeFromPosFiles) &&
          !item.GetExcludedFromPosFiles(sheet, variant))
      ) {
        new_state = true;
        break;
      }
    }

    for (const [item, screen] of collectedItems) {
      commit.Modify(item, screen);

      if (aEvent.IsAction(SCH_ACTIONS.setDNP)) item.SetDNP(new_state, sheet, variant);

      if (aEvent.IsAction(SCH_ACTIONS.setExcludeFromSim))
        item.SetExcludedFromSim(new_state, sheet, variant);

      if (aEvent.IsAction(SCH_ACTIONS.setExcludeFromBOM))
        item.SetExcludedFromBOM(new_state, sheet, variant);

      if (aEvent.IsAction(SCH_ACTIONS.setExcludeFromBoard))
        item.SetExcludedFromBoard(new_state, sheet, variant);

      if (aEvent.IsAction(SCH_ACTIONS.setExcludeFromPosFiles))
        item.SetExcludedFromPosFiles(new_state, sheet, variant);
    }

    if (!commit.Empty()) commit.Push('Toggle Attribute');

    if (selection.IsHover()) this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    return 0;
  }

  /** `GlobalEdit` (dialogs/dialog_global_edit_text_and_graphics.cpp:539). */
  GlobalEdit(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ShowModalDialog('DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS', []);
    return 0;
  }

  protected override setTransitions(): void {
    // clang-format off
    this.Go(SYNC_HANDLER(this.RepeatDrawItem), SCH_ACTIONS.repeatDrawItem.MakeEvent());
    this.Go(SYNC_HANDLER(this.Rotate), SCH_ACTIONS.rotateCW.MakeEvent());
    this.Go(SYNC_HANDLER(this.Rotate), SCH_ACTIONS.rotateCCW.MakeEvent());
    this.Go(SYNC_HANDLER(this.Mirror), SCH_ACTIONS.mirrorV.MakeEvent());
    this.Go(SYNC_HANDLER(this.Mirror), SCH_ACTIONS.mirrorH.MakeEvent());
    this.Go(SYNC_HANDLER(this.Swap), SCH_ACTIONS.swap.MakeEvent());
    this.Go(SYNC_HANDLER(this.SwapPinLabels), SCH_ACTIONS.swapPinLabels.MakeEvent());
    this.Go(SYNC_HANDLER(this.SwapUnitLabels), SCH_ACTIONS.swapUnitLabels.MakeEvent());
    this.Go(SYNC_HANDLER(this.SwapPins), SCH_ACTIONS.swapPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.DoDelete), ACTIONS.doDelete.MakeEvent());
    this.Go(SYNC_HANDLER(this.InteractiveDelete), ACTIONS.deleteTool.MakeEvent());

    this.Go(SYNC_HANDLER(this.Increment), ACTIONS.increment.MakeEvent());
    this.Go(SYNC_HANDLER(this.Increment), ACTIONS.incrementPrimary.MakeEvent());
    this.Go(SYNC_HANDLER(this.Increment), ACTIONS.decrementPrimary.MakeEvent());
    this.Go(SYNC_HANDLER(this.Increment), ACTIONS.incrementSecondary.MakeEvent());
    this.Go(SYNC_HANDLER(this.Increment), ACTIONS.decrementSecondary.MakeEvent());

    this.Go(SYNC_HANDLER(this.Properties), SCH_ACTIONS.properties.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditField), SCH_ACTIONS.editReference.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditField), SCH_ACTIONS.editValue.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditField), SCH_ACTIONS.editFootprint.MakeEvent());
    this.Go(SYNC_HANDLER(this.AutoplaceFields), SCH_ACTIONS.autoplaceFields.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeSymbols), SCH_ACTIONS.changeSymbols.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeSymbols), SCH_ACTIONS.updateSymbols.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeSymbols), SCH_ACTIONS.changeSymbol.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeSymbols), SCH_ACTIONS.updateSymbol.MakeEvent());
    this.Go(SYNC_HANDLER(this.CycleBodyStyle), SCH_ACTIONS.cycleBodyStyle.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toLabel.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toHLabel.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toGLabel.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toDLabel.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toText.MakeEvent());
    this.Go(SYNC_HANDLER(this.ChangeTextType), SCH_ACTIONS.toTextBox.MakeEvent());
    this.Go(SYNC_HANDLER(this.JustifyText), ACTIONS.leftJustify.MakeEvent());
    this.Go(SYNC_HANDLER(this.JustifyText), ACTIONS.centerJustify.MakeEvent());
    this.Go(SYNC_HANDLER(this.JustifyText), ACTIONS.rightJustify.MakeEvent());

    this.Go(SYNC_HANDLER(this.SetAttribute), SCH_ACTIONS.setDNP.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetAttribute), SCH_ACTIONS.setExcludeFromBOM.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetAttribute), SCH_ACTIONS.setExcludeFromBoard.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetAttribute), SCH_ACTIONS.setExcludeFromPosFiles.MakeEvent());
    this.Go(SYNC_HANDLER(this.SetAttribute), SCH_ACTIONS.setExcludeFromSim.MakeEvent());

    this.Go(SYNC_HANDLER(this.CleanupSheetPins), SCH_ACTIONS.cleanupSheetPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.GlobalEdit), SCH_ACTIONS.editTextAndGraphics.MakeEvent());
    this.Go(SYNC_HANDLER(this.EditPageNumber), SCH_ACTIONS.editPageNumber.MakeEvent());

    this.Go(SYNC_HANDLER(this.DdAppendFile), SCH_ACTIONS.ddAppendFile.MakeEvent());
    // DdAddImage (SCH_BITMAP::ReadImageFile from a dropped path) needs the drawing tool's
    // placeImage, which is not on the TOOL_MANAGER yet.
    // clang-format on
  }
}
