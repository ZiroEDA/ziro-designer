// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `BOARD_INSPECTION_TOOL` (`pcbnew/tools/board_inspection_tool.cpp`,
 * `board_inspection_tool.h`), on the live BOARD: net highlighting (the
 * cursor's net, the selection's, the last one, the toggle, a cross-probed
 * item), the local ratsnest (the picker tool, and the dynamic ratsnest of a
 * selection on the move), hiding and showing a net's ratsnest, the Net
 * Inspection Tools submenu its Init adds, and Board Statistics.
 *
 * TRANSITIONAL (#636 stage 3): InspectClearance, InspectConstraints,
 * InspectDRCError and DiffFootprint are not ported yet; the frame still
 * builds those reports from the view board through the functions in the
 * second half of this file (from `describeSelected` down).
 */
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import { type EDA_DRAW_FRAME_LIKE, type EDA_ITEM, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  type DIALOG_BOOK_REPORTER,
  WX_HTML_REPORT_BOX_REPORTER,
} from '@ziroeda/common/dialogs/dialog_book_reporter.js';
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { MALFORMED_COURTYARDS } from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { RC_ITEM } from '@ziroeda/common/rc_item.js';
import { Reporter } from '@ziroeda/common/reporter.js';
import { STATUS_TEXT_POPUP } from '@ziroeda/common/status_popup.js';
import * as KIPLATFORM_UI from '@ziroeda/common/kiplatform/ui.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { IsCopperLayer, IsFrontLayer } from '@ziroeda/common/layer_id.js';
import type { PCB_GROUP } from '../pcb_group.js';
import type { ZONE } from '../zone.js';
import { ZONE_CONNECTION } from '../zones.js';
import { LSET } from '@ziroeda/common/lset.js';
import { RENDER_TARGET } from '@ziroeda/common/gal/definitions.js';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { pickerEndState } from '@ziroeda/common/tool/picker_tool.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import type { RESET_REASON } from '@ziroeda/common/tool/tool_base.js';
import type { TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { Vec2 as VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from '../board.js';
import type { BOARD_CONNECTED_ITEM } from '../board_connected_item.js';
import type { BOARD_ITEM } from '../board_item.js';
import { GENERAL_COLLECTOR } from '../collectors.js';
import { CONNECTIVITY_DATA } from '../connectivity/connectivity_data.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PAD } from '../pad.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_RENDER_SETTINGS } from '../pcb_painter.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import { EDIT_TOOL } from './edit_tool.js';
import { PCB_ACTIONS } from './pcb_actions.js';
import type { PCB_PICKER_TOOL } from './pcb_picker_tool.js';
import type { PCB_SELECTION_TOOL } from './pcb_selection_tool.js';
import { PCB_TOOL_BASE } from './pcb_tool_base.js';
import { DRC_ENGINE } from '../drc/drc_engine.js';
import { PCB_DRC_CODE } from '../drc/drc_item.js';
import { type DRC_CONSTRAINT, DRC_CONSTRAINT_T } from '../drc/drc_rule.js';
import { PAD_ATTRIB } from '../padstack.js';
import { EscapeHTML } from '@ziroeda/common/string_utils.js';

/**
 * What BOARD_INSPECTION_TOOL asks of `PCB_EDIT_FRAME` beyond PCB_BASE_EDIT_FRAME.
 */
export interface BOARD_INSPECTION_TOOL_FRAME {
  /** `DIALOG_BOARD_STATISTICS dialog( m_frame ); dialog.ShowModal()`. */
  ShowBoardStatisticsDialog(): void;
  /** `PCB_EDIT_FRAME::SendCrossProbeItem` (cross-probing.cpp:426). */
  SendCrossProbeItem(aSyncItem: BOARD_ITEM | null): void;
  /** `PCB_EDIT_FRAME::SendCrossProbeNetName` (cross-probing.cpp:405). */
  SendCrossProbeNetName(aNetName: string): void;
  /** `PCB_EDIT_FRAME::m_ProbingSchToPcb`: the recursion guard. */
  m_ProbingSchToPcb: boolean;
  /** `PCB_EDIT_FRAME::GetInspectDrcErrorDialog()`: "Violation Report", made on first use. */
  GetInspectDrcErrorDialog(): DIALOG_BOOK_REPORTER;
  /** `PCB_EDIT_FRAME::GetInspectClearanceDialog()`: "Clearance Report". */
  GetInspectClearanceDialog(): DIALOG_BOOK_REPORTER;
  /** `PCB_EDIT_FRAME::GetInspectConstraintsDialog()`: "Constraints Report". */
  GetInspectConstraintsDialog(): DIALOG_BOOK_REPORTER;
  /** `EDA_BASE_FRAME::ShowInfoBarError`. */
  ShowInfoBarError(aErrorMsg: string): void;
  /** `DIALOG_FOOTPRINT_ASSOCIATIONS dlg( m_frame, aFootprint ); dlg.ShowModal()`. */
  ShowFootprintAssociationsDialog(aFootprint: FOOTPRINT): void;
  /** `PCB_EDIT_FRAME::GetDesignRulesPath()`. */
  GetDesignRulesPath(): string;
  /** The rules file's text, which `InitEngine` reads here in place of the path. */
  GetDesignRulesText(): string | null;
}

type FRAME = PCB_BASE_EDIT_FRAME & BOARD_INSPECTION_TOOL_FRAME;

/** The appearance panel's two calls `doHideRatsnestNet` makes. */
interface NET_VISIBILITY_PANEL {
  IsTogglingNetclassRatsnestVisibility?(): boolean;
  OnNetVisibilityChanged?(aNetCode: number, aVisibility: boolean): void;
}

class NET_CONTEXT_MENU extends ACTION_MENU {
  constructor() {
    super(true);

    this.SetIcon(BITMAPS.show_ratsnest);
    this.SetTitle('Net Inspection Tools');

    this.Add(PCB_ACTIONS.showNetInRatsnest);
    this.Add(PCB_ACTIONS.hideNetInRatsnest);
    this.AppendSeparator();
    this.Add(PCB_ACTIONS.highlightNetSelection);
    this.Add(PCB_ACTIONS.clearHighlight);
  }

  protected override create(): ACTION_MENU {
    return new NET_CONTEXT_MENU();
  }
}

/** `dynamic_cast<BOARD_CONNECTED_ITEM*>`: BOARD_ITEM::IsConnected() is that test. */
const asConnected = (aItem: EDA_ITEM): BOARD_CONNECTED_ITEM | null =>
  aItem.IsBOARD_ITEM() && (aItem as BOARD_ITEM).IsConnected()
    ? (aItem as unknown as BOARD_CONNECTED_ITEM)
    : null;

function isNPTHPad(aItem: BOARD_ITEM): boolean {
  return (
    aItem.Type() === KICAD_T.PCB_PAD_T &&
    (aItem as unknown as PAD).GetAttribute() === PAD_ATTRIB.NPTH
  );
}

/** `reportMin( aFrame, aConstraint )`: the frame's StringFromValue is `aStr`. */
function reportMin(aStr: (aValue: number) => string, aConstraint: DRC_CONSTRAINT): string {
  if (aConstraint.m_Value.HasMin()) return aStr(aConstraint.m_Value.Min());
  else return '<i>undefined</i>';
}

function reportOpt(aStr: (aValue: number) => string, aConstraint: DRC_CONSTRAINT): string {
  if (aConstraint.m_Value.HasOpt()) return aStr(aConstraint.m_Value.Opt());
  else return '<i>undefined</i>';
}

function reportMax(aStr: (aValue: number) => string, aConstraint: DRC_CONSTRAINT): string {
  if (aConstraint.m_Value.HasMax()) return aStr(aConstraint.m_Value.Max());
  else return '<i>undefined</i>';
}

/** The anonymous VECTOR_REPORTER: keeps every line, for a page drawn later. */
class VECTOR_REPORTER extends Reporter {
  get m_messages(): string[] {
    return this.lines.map((l) => l.message);
  }
}

export class BOARD_INSPECTION_TOOL extends PCB_TOOL_BASE {
  private m_frame: FRAME | null = null; // Pointer to the currently used edit frame.
  private m_currentlyHighlighted = new Set<number>(); // Active net being highlighted, or -1 when off
  private m_lastHighlighted = new Set<number>(); // For toggling between last two highlighted nets
  private m_dynamicData: CONNECTIVITY_DATA | null = null; // Cached connectivity data from the selection

  /** The net submenu Init registers, for the window's context menu (TRANSITIONAL). */
  private m_netSubMenu: NET_CONTEXT_MENU | null = null;

  constructor() {
    super('pcbnew.InspectionTool');
  }

  private selTool(): PCB_SELECTION_TOOL {
    return this.m_toolMgr!.FindTool('common.InteractiveSelection') as unknown as PCB_SELECTION_TOOL;
  }

  private renderSettings(): PCB_RENDER_SETTINGS {
    return this.m_toolMgr!.GetView()!.GetPainter()!.GetSettings() as PCB_RENDER_SETTINGS;
  }

  override Init(): boolean {
    const selectionTool = this.selTool();

    const netSubMenu = new NET_CONTEXT_MENU();
    netSubMenu.SetTool(this);
    this.m_netSubMenu = netSubMenu;

    // Only show the net menu if all items in the selection are connectable
    const showNetMenuFunc = (aSelection: SELECTION): boolean => {
      if (aSelection.Empty()) return false;

      for (const item of aSelection) {
        switch (item.Type()) {
          case KICAD_T.PCB_TRACE_T:
          case KICAD_T.PCB_ARC_T:
          case KICAD_T.PCB_VIA_T:
          case KICAD_T.PCB_PAD_T:
          case KICAD_T.PCB_ZONE_T:
            continue;

          case KICAD_T.PCB_SHAPE_T: {
            if (!(item as unknown as PCB_SHAPE).IsOnCopperLayer()) return false;
            else continue;
          }

          default:
            return false;
        }
      }

      return true;
    };

    const menu = selectionTool.GetToolMenu().GetMenu();

    selectionTool.GetToolMenu().RegisterSubMenu(netSubMenu);

    menu.AddMenu(netSubMenu, showNetMenuFunc, 100);

    return true;
  }

  /** The submenu Init built (TRANSITIONAL: the window's context menu draws it). */
  GetNetSubMenu(): ACTION_MENU | null {
    return this.m_netSubMenu;
  }

  override Reset(_aReason: RESET_REASON): void {
    this.m_frame = this.getEditFrame<FRAME>();
  }

  /**
   * Show dialog with board statistics.
   */
  ShowBoardStatistics(_aEvent: TOOL_EVENT): number {
    this.m_frame!.ShowBoardStatisticsDialog();
    return 0;
  }

  /**
   * A DRC_ENGINE of its own over the frame's board, rules compiled from the
   * project's rules file, with the zone and courtyard caches the providers
   * read. A rules file that does not parse is reported, not thrown.
   */
  private makeDRCEngine(aErrors: { compile: boolean; courtyard: boolean } | null): DRC_ENGINE {
    const board = this.m_frame!.GetBoard()!;
    const engine = new DRC_ENGINE(board, board.GetDesignSettings());

    try {
      // `InitEngine( m_frame->GetDesignRulesPath() )`: the text is read here.
      engine.InitEngine(this.m_frame!.GetDesignRulesText(), this.m_frame!.GetDesignRulesPath());
    } catch (e) {
      if (!(e instanceof PARSE_ERROR)) throw e;
      if (aErrors) aErrors.compile = true;
    }

    for (const zone of board.Zones()) zone.CacheBoundingBox();

    for (const footprint of board.Footprints()) {
      for (const zone of footprint.Zones()) zone.CacheBoundingBox();

      footprint.BuildCourtyardCaches();

      if (aErrors && (footprint.GetFlags() & MALFORMED_COURTYARDS) !== 0) aErrors.courtyard = true;
    }

    return engine;
  }

  private getItemDescription(aItem: BOARD_ITEM | null): string {
    // Null items have no description
    if (!aItem) return '';

    let msg = aItem.GetItemDescription(this.m_frame!.GetUnitsProvider(), true);

    if (aItem.IsConnected() && !isNPTHPad(aItem)) {
      const cItem = aItem as unknown as BOARD_CONNECTED_ITEM;

      msg += ` [netclass ${cItem.GetEffectiveNetClass().GetHumanReadableName()}]`;
    }

    return msg;
  }

  private reportCompileError(r: Reporter): void {
    r.report('');
    r.report(
      'Report incomplete: could not compile custom design rules.' +
        '&nbsp;&nbsp;' +
        "<a href='$CUSTOM_RULES'>" +
        'Show design rules.' +
        '</a>',
    );
  }

  /** The three `reportHeader` overloads: one item; two; two on a named layer. */
  private reportHeader(
    aTitle: string,
    a: BOARD_ITEM | null,
    b: BOARD_ITEM | null | undefined,
    aLayer: PCB_LAYER_ID | undefined,
    r: Reporter,
  ): void {
    r.report(`<h7>${EscapeHTML(aTitle)}</h7>`);

    if (b === undefined) {
      r.report(`<ul><li>${EscapeHTML(this.getItemDescription(a))}</li></ul>`);
    } else if (aLayer === undefined) {
      r.report(
        `<ul><li>${EscapeHTML(this.getItemDescription(a))}</li>` +
          `<li>${EscapeHTML(this.getItemDescription(b))}</li></ul>`,
      );
    } else {
      const layerStr = `Layer ${this.m_frame!.GetBoard()!.GetLayerName(aLayer)}`;

      r.report(
        `<ul><li>${EscapeHTML(layerStr)}</li>` +
          `<li>${EscapeHTML(this.getItemDescription(a))}</li>` +
          `<li>${EscapeHTML(this.getItemDescription(b))}</li></ul>`,
      );
    }
  }

  /** The DRC dialog's row-menu label for inspecting a violation, or '' for none. */
  InspectDRCErrorMenuText(aDRCItem: RC_ITEM): string {
    const code = aDRCItem.GetErrorCode();

    if (
      code === PCB_DRC_CODE.DRCE_CLEARANCE ||
      code === PCB_DRC_CODE.DRCE_EDGE_CLEARANCE ||
      code === PCB_DRC_CODE.DRCE_HOLE_CLEARANCE ||
      code === PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE ||
      code === PCB_DRC_CODE.DRCE_STARVED_THERMAL
    ) {
      return this.m_frame!.GetRunMenuCommandDescription(PCB_ACTIONS.inspectClearance);
    } else if (
      code === PCB_DRC_CODE.DRCE_TEXT_HEIGHT ||
      code === PCB_DRC_CODE.DRCE_TEXT_THICKNESS ||
      code === PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG ||
      code === PCB_DRC_CODE.DRCE_TRACK_WIDTH ||
      code === PCB_DRC_CODE.DRCE_TRACK_ANGLE ||
      code === PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH ||
      code === PCB_DRC_CODE.DRCE_VIA_DIAMETER ||
      code === PCB_DRC_CODE.DRCE_ANNULAR_WIDTH ||
      code === PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE ||
      code === PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE ||
      code === PCB_DRC_CODE.DRCE_CONNECTION_WIDTH ||
      code === PCB_DRC_CODE.DRCE_ASSERTION_FAILURE
    ) {
      return this.m_frame!.GetRunMenuCommandDescription(PCB_ACTIONS.inspectConstraints);
    }

    // TRANSITIONAL (#636 stage 3): upstream's DRCE_LIB_FOOTPRINT_MISMATCH row
    // runs DiffFootprint, which is not ported yet; until it is, no row is
    // offered rather than one that does nothing.
    return '';
  }

  /** The DRC dialog's "inspect" row: the resolution report for one violation. */
  InspectDRCError(aDRCItem: RC_ITEM): void {
    if (!this.m_frame) return;

    const board = this.m_frame.GetBoard()!;
    const a = board.ResolveItem(aDRCItem.GetMainItemID());
    const b = board.ResolveItem(aDRCItem.GetAuxItemID());
    const ac = a?.IsConnected() ? (a as unknown as BOARD_CONNECTED_ITEM) : null;
    let bc = b?.IsConnected() ? (b as unknown as BOARD_CONNECTED_ITEM) : null;
    let layer = this.m_frame.GetActiveLayer();

    // TRANSITIONAL (#636 stage 3): DRCE_LIB_FOOTPRINT_MISMATCH goes to
    // DiffFootprint, not ported yet; InspectDRCErrorMenuText offers no row for it.
    if (aDRCItem.GetErrorCode() === PCB_DRC_CODE.DRCE_LIB_FOOTPRINT_MISMATCH) return;

    const dialog = this.m_frame.GetInspectDrcErrorDialog();

    dialog.DeleteAllPages();

    const errors = { compile: false, courtyard: false };
    const drcEngine = this.makeDRCEngine(errors);
    const compileError = errors.compile;

    let r: Reporter | null = null;
    let constraint: DRC_CONSTRAINT;
    let clearance = 0;
    let clearanceStr = '';
    const str = (aValue: number): string =>
      this.m_frame!.GetUnitsProvider().StringFromValue(aValue, true);

    switch (aDRCItem.GetErrorCode()) {
      case PCB_DRC_CODE.DRCE_DIFF_PAIR_UNCOUPLED_LENGTH_TOO_LONG: {
        for (const id of aDRCItem.GetIDs()) {
          const resolved = board.ResolveItem(id, true);
          bc = resolved?.IsConnected() ? (resolved as unknown as BOARD_CONNECTED_ITEM) : null;

          if (ac && bc && ac.GetNetCode() !== bc.GetNetCode()) break;
        }

        r = dialog.AddHTMLPage('Uncoupled Length');
        this.reportHeader(
          'Diff pair uncoupled length resolution for:',
          ac as unknown as BOARD_ITEM | null,
          bc as unknown as BOARD_ITEM | null,
          undefined,
          r,
        );

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(`Resolved max uncoupled length: ${reportMax(str, constraint)}.`);
        break;
      }

      case PCB_DRC_CODE.DRCE_TEXT_HEIGHT:
        r = dialog.AddHTMLPage('Text Height');
        this.reportHeader('Text height resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved height constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_TEXT_THICKNESS:
        r = dialog.AddHTMLPage('Text Thickness');
        this.reportHeader('Text thickness resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );

        r.report('');
        r.report(
          `Resolved thickness constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_TRACK_WIDTH:
        r = dialog.AddHTMLPage('Track Width');
        this.reportHeader('Track width resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved width constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_TRACK_ANGLE:
        r = dialog.AddHTMLPage('Track Angle');
        this.reportHeader('Track Angle resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.TRACK_ANGLE_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved angle constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_TRACK_SEGMENT_LENGTH:
        r = dialog.AddHTMLPage('Track Segment Length');
        this.reportHeader('Track segment length resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.TRACK_SEGMENT_LENGTH_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );

        r.report('');
        r.report(
          `Resolved segment length constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_CONNECTION_WIDTH:
        r = dialog.AddHTMLPage('Connection Width');
        this.reportHeader('Connection width resolution for:', a, b, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.CONNECTION_WIDTH_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );

        r.report('');
        r.report(`Resolved min connection width: ${reportMin(str, constraint)}.`);
        break;

      case PCB_DRC_CODE.DRCE_VIA_DIAMETER:
        r = dialog.AddHTMLPage('Via Diameter');
        this.reportHeader('Via diameter resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved diameter constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_ANNULAR_WIDTH:
        r = dialog.AddHTMLPage('Via Annulus');
        this.reportHeader('Via annular width resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved annular width constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_DRILL_OUT_OF_RANGE:
      case PCB_DRC_CODE.DRCE_MICROVIA_DRILL_OUT_OF_RANGE:
        r = dialog.AddHTMLPage('Hole Size');
        this.reportHeader('Hole size resolution for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT, a, b, layer, r);

        r.report('');
        r.report(
          `Resolved hole size constraints: min ${reportMin(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );
        break;

      case PCB_DRC_CODE.DRCE_HOLE_CLEARANCE:
        r = dialog.AddHTMLPage('Hole Clearance');
        this.reportHeader('Hole clearance resolution for:', a, b, undefined, r);

        if (compileError) this.reportCompileError(r);

        if (ac && bc && ac.GetNetCode() === bc.GetNetCode()) {
          r.report('');
          r.report('Items belong to the same net. Clearance is 0.');
        } else {
          constraint = drcEngine.EvalRules(
            DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
            a,
            b,
            layer,
            r,
          );
          clearance = constraint.m_Value.Min();
          clearanceStr = str(clearance);

          r.report('');
          r.report(`Resolved min clearance: ${clearanceStr}.`);
        }

        r.report('');
        r.report('');
        r.report('');
        this.reportHeader('Physical hole clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();
        clearanceStr = str(clearance);

        if (
          !drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT)
        ) {
          r.report('');
          r.report("No 'physical_hole_clearance' constraints defined.");
        } else {
          r.report('');
          r.report(`Resolved min clearance: ${clearanceStr}.`);
        }

        break;

      case PCB_DRC_CODE.DRCE_DRILLED_HOLES_TOO_CLOSE:
        r = dialog.AddHTMLPage('Hole to Hole');
        this.reportHeader('Hole-to-hole clearance resolution for:', a, b, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT,
          a,
          b,
          PCB_LAYER_ID.UNDEFINED_LAYER,
          r,
        );
        clearance = constraint.m_Value.Min();
        clearanceStr = str(clearance);

        r.report('');
        r.report(`Resolved min clearance: ${clearanceStr}.`);
        break;

      case PCB_DRC_CODE.DRCE_EDGE_CLEARANCE:
        r = dialog.AddHTMLPage('Edge Clearance');
        this.reportHeader('Edge clearance resolution for:', a, b, undefined, r);

        if (compileError) this.reportCompileError(r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();
        clearanceStr = str(clearance);

        r.report('');
        r.report(`Resolved min clearance: ${clearanceStr}.`);
        break;

      case PCB_DRC_CODE.DRCE_CLEARANCE:
        if (a!.Type() === KICAD_T.PCB_TRACE_T || a!.Type() === KICAD_T.PCB_ARC_T) {
          layer = a!.GetLayer();
        } else if (b!.Type() === KICAD_T.PCB_TRACE_T || b!.Type() === KICAD_T.PCB_ARC_T) {
          layer = b!.GetLayer();
        } else if (
          a!.Type() === KICAD_T.PCB_PAD_T &&
          (a as unknown as PAD).GetAttribute() === PAD_ATTRIB.SMD
        ) {
          const pad = a as unknown as PAD;

          if (pad.IsOnLayer(PCB_LAYER_ID.F_Cu)) layer = PCB_LAYER_ID.F_Cu;
          else layer = PCB_LAYER_ID.B_Cu;
        } else if (
          b!.Type() === KICAD_T.PCB_PAD_T &&
          // Upstream tests `a`'s attribute here, not `b`'s (board_inspection_tool.cpp:803).
          (a as unknown as PAD).GetAttribute() === PAD_ATTRIB.SMD
        ) {
          const pad = b as unknown as PAD;

          if (pad.IsOnLayer(PCB_LAYER_ID.F_Cu)) layer = PCB_LAYER_ID.F_Cu;
          else layer = PCB_LAYER_ID.B_Cu;
        }

        r = dialog.AddHTMLPage('Clearance');
        this.reportHeader('Clearance resolution for:', a, b, layer, r);

        if (compileError) this.reportCompileError(r);

        if (ac && bc && ac.GetNetCode() === bc.GetNetCode()) {
          r.report('');
          r.report('Items belong to the same net. Clearance is 0.');
        } else {
          constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, a, b, layer, r);
          clearance = constraint.m_Value.Min();
          clearanceStr = str(clearance);

          r.report('');
          r.report(`Resolved min clearance: ${clearanceStr}.`);
        }

        r.report('');
        r.report('');
        r.report('');
        this.reportHeader('Physical clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();
        clearanceStr = str(clearance);

        if (!drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT)) {
          r.report('');
          r.report("No 'physical_clearance' constraints defined.");
        } else {
          r.report('');
          r.report(`Resolved min clearance: ${clearanceStr}.`);
        }

        break;

      case PCB_DRC_CODE.DRCE_ASSERTION_FAILURE:
        r = dialog.AddHTMLPage('Assertions');
        this.reportHeader('Assertions for:', a, undefined, undefined, r);

        if (compileError) this.reportCompileError(r);

        drcEngine.ProcessAssertions(a!, () => {}, r);
        break;

      default:
        return;
    }

    (r as WX_HTML_REPORT_BOX_REPORTER).Flush();

    // `KIPLATFORM::UI::ReparentWindow( dialog, drcTool->GetDRCDialog() )` keeps
    // the report above the DRC dialog on GTK; the frame's window stacking does
    // that here.
    dialog.Show(true);
  }

  /**
   * `filterCollectorForInspection` (board_inspection_tool.cpp:220-285): a
   * group gives way to its children under the point, and a footprint to the
   * pad or track it shares the point with.
   */
  private filterCollectorForInspection(aCollector: GENERAL_COLLECTOR, aPos: VECTOR2I): void {
    const toAdd: BOARD_ITEM[] = [];

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      if (aCollector.At(i)!.Type() === KICAD_T.PCB_GROUP_T) {
        const group = aCollector.At(i) as unknown as PCB_GROUP;

        group.RunOnChildren((child: BOARD_ITEM) => {
          if (child.Type() === KICAD_T.PCB_GROUP_T) return;

          if (!child.HitTest(aPos)) return;

          toAdd.push(child);

          if (child.Type() === KICAD_T.PCB_FOOTPRINT_T) {
            for (const pad of (child as unknown as FOOTPRINT).Pads()) {
              if (pad.HitTest(aPos)) toAdd.push(pad);
            }
          }
        }, RECURSE_MODE.RECURSE);
      }
    }

    for (const item of toAdd) aCollector.Append(item);

    let hasPadOrTrack = false;

    for (let i = 0; i < aCollector.GetCount(); ++i) {
      const type = aCollector.At(i)!.Type();

      if (
        type === KICAD_T.PCB_PAD_T ||
        type === KICAD_T.PCB_VIA_T ||
        type === KICAD_T.PCB_TRACE_T ||
        type === KICAD_T.PCB_ARC_T ||
        type === KICAD_T.PCB_ZONE_T
      ) {
        hasPadOrTrack = true;
        break;
      }
    }

    for (let i = aCollector.GetCount() - 1; i >= 0; --i) {
      const item = aCollector.At(i)!;

      if (hasPadOrTrack && item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        aCollector.Remove(i);
        continue;
      }

      if (item.Type() === KICAD_T.PCB_GROUP_T) aCollector.Remove(i);
    }
  }

  /** `pickItemForInspection` (board_inspection_tool.cpp:288-412). */
  private *pickItemForInspection(
    aEvent: TOOL_EVENT,
    aPrompt: string,
    aTypes: readonly KICAD_T[],
    aLockedHighlight: BOARD_ITEM | null,
  ): COROUTINE_BODY<BOARD_ITEM | null> {
    const selTool = this.selTool();
    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;
    const statusPopup = new STATUS_TEXT_POPUP();
    let pickedItem: BOARD_ITEM | null = null;
    let highlightedItem: BOARD_ITEM | null = null;
    let done = false;

    statusPopup.SetText(aPrompt);

    picker.SetCursor(KICURSOR.BULLSEYE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    // `m_frame->GetCollectorsGuide()`, as the selection tool builds it.
    const collectAt = (aPoint: VECTOR2I): GENERAL_COLLECTOR => {
      const guide = selTool.getCollectorsGuide();
      const collector = new GENERAL_COLLECTOR();

      collector.Collect(this.m_frame!.GetBoard()!, aTypes, aPoint, guide);

      for (let i = collector.GetCount() - 1; i >= 0; --i) {
        if (!selTool.Selectable(collector.At(i) as unknown as BOARD_ITEM)) collector.Remove(i);
      }

      this.filterCollectorForInspection(collector, aPoint);

      if (collector.GetCount() > 1) selTool.GuessSelectionCandidates(collector, aPoint);

      return collector;
    };

    picker.SetClickHandler((aPoint: VECTOR2I): boolean => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      const collector = collectAt(aPoint);

      if (collector.GetCount() === 0) return true;

      pickedItem = collector.At(0) as unknown as BOARD_ITEM;
      statusPopup.Hide();

      return false;
    });

    picker.SetMotionHandler((aPos: VECTOR2I): void => {
      const at = KIPLATFORM_UI.GetMousePosition();
      statusPopup.Move({ x: at.x + 20, y: at.y - 50 });

      const collector = collectAt(aPos);
      const item = collector.GetCount() >= 1 ? (collector.At(0) as unknown as BOARD_ITEM) : null;

      if (highlightedItem !== item) {
        if (highlightedItem && highlightedItem !== aLockedHighlight)
          selTool.UnbrightenItem(highlightedItem);

        highlightedItem = item;

        if (highlightedItem && highlightedItem !== aLockedHighlight)
          selTool.BrightenItem(highlightedItem);
      }
    });

    picker.SetCancelHandler((): void => {
      if (highlightedItem && highlightedItem !== aLockedHighlight)
        selTool.UnbrightenItem(highlightedItem);

      highlightedItem = null;
      statusPopup.Hide();
      done = true;
    });

    picker.SetFinalizeHandler((_aFinalState: number): void => {
      if (highlightedItem && highlightedItem !== aLockedHighlight)
        selTool.UnbrightenItem(highlightedItem);

      highlightedItem = null;

      if (!pickedItem) done = true;
    });

    const at = KIPLATFORM_UI.GetMousePosition();
    statusPopup.Move({ x: at.x + 20, y: at.y - 50 });
    statusPopup.Popup();
    this.m_frame!.GetCanvas()?.SetStatusPopup({
      HasFocus: () => {
        const panel = statusPopup.GetPanel();
        return !!panel && typeof document !== 'undefined' && panel.contains(document.activeElement);
      },
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    while (!done && !pickedItem) {
      const evt = yield* this.Wait();

      if (evt) evt.SetPassEvent();
      else break;
    }

    picker.ClearHandlers();
    this.m_frame!.GetCanvas()?.SetStatusPopup(null);

    return pickedItem;
  }

  /** `InspectClearance` (board_inspection_tool.cpp:895-968). */
  *InspectClearance(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_frame) return 0;

    const selTool = this.selTool();
    const selection = selTool.GetSelection();
    let firstItem: BOARD_ITEM | null = null;
    let secondItem: BOARD_ITEM | null = null;

    if (selection.Size() === 2) {
      if (!selection.GetItem(0)!.IsBOARD_ITEM() || !selection.GetItem(1)!.IsBOARD_ITEM()) return 0;

      firstItem = selection.GetItem(0) as unknown as BOARD_ITEM;
      secondItem = selection.GetItem(1) as unknown as BOARD_ITEM;

      this.reportClearance(firstItem, secondItem);
      return 0;
    }

    // Selection size is not 2, so we need to use picker mode.
    // If there is one item selected, use it as the first item.
    if (selection.Size() === 1 && selection.GetItem(0)!.IsBOARD_ITEM())
      firstItem = selection.GetItem(0) as unknown as BOARD_ITEM;

    const clearanceTypes: readonly KICAD_T[] = [
      KICAD_T.PCB_PAD_T,
      KICAD_T.PCB_VIA_T,
      KICAD_T.PCB_TRACE_T,
      KICAD_T.PCB_ARC_T,
      KICAD_T.PCB_ZONE_T,
      KICAD_T.PCB_SHAPE_T,
      KICAD_T.PCB_FOOTPRINT_T,
      KICAD_T.PCB_GROUP_T,
    ];

    this.Activate();

    if (!firstItem) {
      firstItem = yield* this.pickItemForInspection(
        aEvent,
        'Select first item for clearance resolution...',
        clearanceTypes,
        null,
      );

      if (!firstItem) return 0;
    }

    // Keep the first item highlighted while selecting the second
    selTool.BrightenItem(firstItem);

    secondItem = yield* this.pickItemForInspection(
      aEvent,
      'Select second item for clearance resolution...',
      clearanceTypes,
      firstItem,
    );

    selTool.UnbrightenItem(firstItem);

    if (!secondItem) return 0;

    if (firstItem === secondItem) {
      this.m_frame.ShowInfoBarError('Select two different items for clearance resolution.');
      return 0;
    }

    this.reportClearance(firstItem, secondItem);

    return 0;
  }

  /** `reportClearance` (board_inspection_tool.cpp:971-1636). */
  private reportClearance(aItemA: BOARD_ITEM, aItemB: BOARD_ITEM): void {
    if (!this.m_frame) return;

    const frame = this.m_frame;
    const board = frame.GetBoard()!;
    const str = (aValue: number): string => frame.GetUnitsProvider().StringFromValue(aValue, true);
    let a: BOARD_ITEM | null = aItemA;
    let b: BOARD_ITEM | null = aItemB;

    if (a.Type() === KICAD_T.PCB_GROUP_T) {
      const ag = a as unknown as PCB_GROUP;

      if (ag.GetItems().size === 0) {
        frame.ShowInfoBarError('Cannot generate clearance report on empty group.');
        return;
      }

      a = ag.GetItems().values().next().value as unknown as BOARD_ITEM;
    }

    if (b.Type() === KICAD_T.PCB_GROUP_T) {
      const bg = b as unknown as PCB_GROUP;

      if (bg.GetItems().size === 0) {
        frame.ShowInfoBarError('Cannot generate clearance report on empty group.');
        return;
      }

      b = bg.GetItems().values().next().value as unknown as BOARD_ITEM;
    }

    if (!a || !b) return;

    const checkFootprint = (footprint: FOOTPRINT): BOARD_ITEM => {
      let foundPad: PAD | null = null;

      for (const pad of footprint.Pads()) {
        if (!foundPad || pad.SameLogicalPadAs(foundPad)) foundPad = pad;
        else return footprint;
      }

      if (!foundPad) return footprint;

      return foundPad;
    };

    if (a.Type() === KICAD_T.PCB_FOOTPRINT_T) a = checkFootprint(a as unknown as FOOTPRINT);

    if (b.Type() === KICAD_T.PCB_FOOTPRINT_T) b = checkFootprint(b as unknown as FOOTPRINT);

    if (!a || !b) return;

    const dialog = frame.GetInspectClearanceDialog();

    dialog.DeleteAllPages();

    if (a.Type() !== KICAD_T.PCB_ZONE_T && b.Type() === KICAD_T.PCB_ZONE_T) [a, b] = [b, a];
    else if (!a.IsConnected() && b.IsConnected()) [a, b] = [b, a];

    let r: Reporter | null = null;
    const active = frame.GetActiveLayer();
    const layerIntersection = a.GetLayerSet().and(b.GetLayerSet());
    const copperIntersection = layerIntersection.and(LSET.AllCuMask());
    const ac = a.IsConnected() ? (a as unknown as BOARD_CONNECTED_ITEM) : null;
    const bc = b.IsConnected() ? (b as unknown as BOARD_CONNECTED_ITEM) : null;
    const zone = a.Type() === KICAD_T.PCB_ZONE_T ? (a as unknown as ZONE) : null;
    const pad = b.Type() === KICAD_T.PCB_PAD_T ? (b as unknown as PAD) : null;
    const aFP = a.Type() === KICAD_T.PCB_FOOTPRINT_T ? (a as unknown as FOOTPRINT) : null;
    const bFP = b.Type() === KICAD_T.PCB_FOOTPRINT_T ? (b as unknown as FOOTPRINT) : null;
    let constraint: DRC_CONSTRAINT;
    let clearance = 0;

    const errors = { compile: false, courtyard: false };
    const drcEngine = this.makeDRCEngine(errors);
    const compileError = errors.compile;

    if (copperIntersection.any() && zone && pad && zone.GetNetCode() === pad.GetNetCode()) {
      let layer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;

      if (zone.IsOnLayer(active)) layer = active;
      else if (zone.GetLayerSet().count() > 0) layer = zone.GetLayerSet().Seq()[0]!;

      r = dialog.AddHTMLPage('Zone');
      this.reportHeader('Zone connection resolution for:', a, b, layer, r);

      constraint = drcEngine.EvalZoneConnection(pad, zone, layer, r);

      if (constraint.m_ZoneConnection === ZONE_CONNECTION.THERMAL) {
        r.report('');
        r.report('');
        this.reportHeader('Thermal-relief gap resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_RELIEF_GAP_CONSTRAINT,
          pad,
          zone,
          layer,
          r,
        );
        const gap = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved thermal relief gap: ${str(gap)}.`);

        r.report('');
        r.report('');
        this.reportHeader('Thermal-relief spoke width resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.THERMAL_SPOKE_WIDTH_CONSTRAINT,
          pad,
          zone,
          layer,
          r,
        );
        const width = constraint.m_Value.Opt();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved spoke width: ${str(width)}.`);

        r.report('');
        r.report('');
        this.reportHeader('Thermal-relief min spoke count resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.MIN_RESOLVED_SPOKES_CONSTRAINT,
          pad,
          zone,
          layer,
          r,
        );
        const minSpokes = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min spoke count: ${minSpokes}.`);
      } else if (constraint.m_ZoneConnection === ZONE_CONNECTION.NONE) {
        r.report('');
        r.report('');
        this.reportHeader('Zone clearance resolution for:', a, b, layer, r);

        clearance = zone.GetLocalClearance()!;
        r.report('');
        r.report(`Zone clearance: ${str(clearance)}.`);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
          pad,
          zone,
          layer,
          r,
        );

        if (constraint.m_Value.Min() > clearance) {
          clearance = constraint.m_Value.Min();

          r.report('');
          r.report(
            `Overridden by larger physical clearance from ${EscapeHTML(constraint.GetName())};` +
              `clearance: ${str(clearance)}.`,
          );
        }

        if (!pad.FlashLayer(layer)) {
          constraint = drcEngine.EvalRules(
            DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
            pad,
            zone,
            layer,
            r,
          );

          if (constraint.m_Value.Min() > clearance) {
            clearance = constraint.m_Value.Min();

            r.report('');
            r.report(
              'Overridden by larger physical hole clearance ' +
                `from ${EscapeHTML(constraint.GetName())}; clearance: ${str(clearance)}.`,
            );
          }
        }

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);
      } else {
        r.report('');
        r.report('');
        this.reportHeader('Zone clearance resolution for:', a, b, layer, r);

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(0)}.`);
      }

      (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
    } else if (copperIntersection.any() && !aFP && !bFP) {
      const sameNet = !!ac && !!bc && ac.GetNetCode() > 0 && ac.GetNetCode() === bc.GetNetCode();

      const layers: PCB_LAYER_ID[] = [];

      if (copperIntersection.test(active)) layers.push(active);

      for (const layer of copperIntersection.Seq()) {
        if (layer !== active) layers.push(layer);
      }

      const fillReport = (layer: PCB_LAYER_ID, rep: Reporter): void => {
        this.reportHeader('Clearance resolution for:', a, b, layer, rep);

        if (sameNet) {
          rep.report('Items belong to the same net. Min clearance is 0.');
          return;
        }

        constraint = drcEngine.EvalRules(DRC_CONSTRAINT_T.CLEARANCE_CONSTRAINT, a, b, layer, rep);
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(rep);

        rep.report('');

        if (constraint.IsNull()) {
          rep.report('Min clearance is 0.');
        } else if (clearance < 0) {
          rep.report(`Resolved clearance: ${str(clearance)}; clearance will not be tested.`);
        } else {
          rep.report(`Resolved min clearance: ${str(clearance)}.`);
        }
      };

      if (layers.length === 1) {
        const layer = layers[0]!;

        const page = dialog.AddHTMLPage(board.GetLayerName(layer));
        r = page;
        fillReport(layer, page);
        page.Flush();
      } else {
        const perLayerMessages: string[][] = [];

        for (const layer of layers) {
          const tmp = new VECTOR_REPORTER();
          fillReport(layer, tmp);
          perLayerMessages.push(tmp.m_messages);
        }

        const panel = dialog.AddBlankPage('Clearance');

        panel.AddStaticText('Layer:');
        const choice = panel.AddChoice();

        for (const layer of layers) choice.Append(board.GetLayerName(layer));

        choice.SetSelection(0);

        const reportBox = panel.AddReportBox();

        const refresh = (sel: number): void => {
          reportBox.clear();

          if (sel >= 0 && sel < perLayerMessages.length) {
            for (const line of perLayerMessages[sel]!) reportBox.report(line);
          }

          reportBox.Flush();
        };

        choice.Bind((aSelection) => refresh(aSelection));

        refresh(0);
      }
    }

    if (ac && bc) {
      const refNet = ac.GetNet()!;

      const dp = DRC_ENGINE.MatchDpSuffix(refNet.GetNetname());

      if (dp.polarity !== 0 && bc.GetNetname() === dp.complementNet) {
        const dpIntersection = ac.GetLayerSet().and(bc.GetLayerSet()).and(LSET.AllCuMask());
        let dpLayer = active;

        if (!dpIntersection.test(dpLayer) && dpIntersection.any())
          dpLayer = dpIntersection.Seq()[0]!;

        r = dialog.AddHTMLPage('Diff Pair');
        this.reportHeader(
          'Diff-pair gap resolution for:',
          ac as unknown as BOARD_ITEM,
          bc as unknown as BOARD_ITEM,
          dpLayer,
          r,
        );

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.DIFF_PAIR_GAP_CONSTRAINT,
          ac as unknown as BOARD_ITEM,
          bc as unknown as BOARD_ITEM,
          dpLayer,
          r,
        );

        r.report('');
        r.report(
          `Resolved gap constraints: min ${reportMin(str, constraint)}; ` +
            `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
        );

        r.report('');
        r.report('');
        r.report('');
        this.reportHeader(
          'Diff-pair max uncoupled length resolution for:',
          ac as unknown as BOARD_ITEM,
          bc as unknown as BOARD_ITEM,
          dpLayer,
          r,
        );

        if (!drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT)) {
          r.report('');
          r.report("No 'diff_pair_uncoupled' constraints defined.");
        } else {
          constraint = drcEngine.EvalRules(
            DRC_CONSTRAINT_T.MAX_UNCOUPLED_CONSTRAINT,
            ac as unknown as BOARD_ITEM,
            bc as unknown as BOARD_ITEM,
            dpLayer,
            r,
          );

          r.report('');
          r.report(`Resolved max uncoupled length: ${reportMax(str, constraint)}.`);
        }

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }
    }

    const isOnCorrespondingLayer = (
      aItem: BOARD_ITEM,
      aLayer: PCB_LAYER_ID,
      aWarning: { value: string },
    ): boolean => {
      if (aItem.IsOnLayer(aLayer)) return true;

      const correspondingMask = IsFrontLayer(aLayer) ? PCB_LAYER_ID.F_Mask : PCB_LAYER_ID.B_Mask;
      const correspondingCopper = IsFrontLayer(aLayer) ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;

      if (aItem.IsOnLayer(aLayer)) return true;

      if (aItem.IsOnLayer(correspondingMask)) return true;

      if (aItem.IsTented(correspondingMask) && aItem.IsOnLayer(correspondingCopper)) {
        aWarning.value = `Note: ${this.getItemDescription(aItem)} is tented; clearance will only be applied to holes.`;
        return true;
      }

      return false;
    };

    for (const layer of [PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.B_SilkS]) {
      const warning = { value: '' };

      if (
        (a.IsOnLayer(layer) && isOnCorrespondingLayer(b, layer, warning)) ||
        (b.IsOnLayer(layer) && isOnCorrespondingLayer(a, layer, warning))
      ) {
        r = dialog.AddHTMLPage(board.GetLayerName(layer));
        this.reportHeader('Silkscreen clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.SILK_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');

        if (warning.value !== '') r.report(warning.value);

        r.report(`Resolved min clearance: ${str(clearance)}.`);

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }
    }

    for (const layer of [PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd]) {
      const aCourtyard = !!aFP && !aFP.GetCourtyard(layer).IsEmpty();
      const bCourtyard = !!bFP && !bFP.GetCourtyard(layer).IsEmpty();

      if (aCourtyard && bCourtyard) {
        r = dialog.AddHTMLPage(board.GetLayerName(layer));
        this.reportHeader('Courtyard clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.COURTYARD_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }
    }

    if (a.HasHole() || b.HasHole()) {
      let layer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
      let pageAdded = false;

      if (a.HasHole() && b.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
      else if (b.HasHole() && a.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
      else if (a.HasHole() && b.IsOnCopperLayer()) layer = b.GetLayer();
      else if (b.HasHole() && a.IsOnCopperLayer()) layer = a.GetLayer();

      if (layer >= 0) {
        r = dialog.AddHTMLPage('Hole');
        pageAdded = true;

        this.reportHeader('Hole clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.HOLE_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }

      if (a.HasDrilledHole() || b.HasDrilledHole()) {
        if (!pageAdded || !r) {
          r = dialog.AddHTMLPage('Hole');
          pageAdded = true;
        } else {
          r.report('');
          r.report('');
          r.report('');
        }

        this.reportHeader('Hole-to-hole clearance resolution for:', a, b, undefined, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.HOLE_TO_HOLE_CONSTRAINT,
          a,
          b,
          PCB_LAYER_ID.UNDEFINED_LAYER,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }
    }

    for (const edgeLayer of [PCB_LAYER_ID.Edge_Cuts, PCB_LAYER_ID.Margin]) {
      let layer: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;

      if (a.IsOnLayer(edgeLayer) && b.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
        if (b.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
        else if (IsCopperLayer(b.GetLayer())) layer = b.GetLayer();
      } else if (b.IsOnLayer(edgeLayer) && a.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
        if (a.IsOnLayer(active) && IsCopperLayer(active)) layer = active;
        else if (IsCopperLayer(a.GetLayer())) layer = a.GetLayer();
      }

      if (layer >= 0) {
        const layerName = board.GetLayerName(edgeLayer);
        r = dialog.AddHTMLPage(`${layerName} Clearance`);
        this.reportHeader('Edge clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.EDGE_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (compileError) this.reportCompileError(r);

        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);

        (r as WX_HTML_REPORT_BOX_REPORTER).Flush();
      }
    }

    const physical = dialog.AddHTMLPage('Physical Clearances');
    r = physical;

    if (compileError) {
      this.reportCompileError(r);
    } else if (
      !drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT)
    ) {
      r.report('');
      r.report("No 'physical_clearance' constraints defined.");
    } else {
      const reportLayers = new LSET(layerIntersection);
      let reported = false;

      if (a.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) {
        const edgeInteractingLayers = bFP
          ? new LSET([PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd])
          : new LSET(b.GetLayerSet().and(LSET.PhysicalLayersMask()));
        reportLayers.orAssign(edgeInteractingLayers);
      }

      if (b.IsOnLayer(PCB_LAYER_ID.Edge_Cuts)) {
        const edgeInteractingLayers = aFP
          ? new LSET([PCB_LAYER_ID.F_CrtYd, PCB_LAYER_ID.B_CrtYd])
          : new LSET(a.GetLayerSet().and(LSET.PhysicalLayersMask()));
        reportLayers.orAssign(edgeInteractingLayers);
      }

      for (const layer of reportLayers.Seq()) {
        reported = true;
        this.reportHeader('Physical clearance resolution for:', a, b, layer, r);

        constraint = drcEngine.EvalRules(
          DRC_CONSTRAINT_T.PHYSICAL_CLEARANCE_CONSTRAINT,
          a,
          b,
          layer,
          r,
        );
        clearance = constraint.m_Value.Min();

        if (constraint.IsNull()) {
          r.report('');
          r.report(
            `No 'physical_clearance' constraints in effect on ${board.GetLayerName(layer)}.`,
          );
        } else {
          r.report('');
          r.report(`Resolved min clearance: ${str(clearance)}.`);
        }

        r.report('');
        r.report('');
        r.report('');
      }

      if (!reported) {
        this.reportHeader('Physical clearance resolution for:', a, b, undefined, r);
        r.report('');
        r.report(
          "Items share no relevant layers.  No 'physical_clearance' constraints will be applied.",
        );
      }
    }

    if (a.HasHole() || b.HasHole()) {
      let layer: PCB_LAYER_ID;

      if (a.HasHole() && b.IsOnLayer(active)) layer = active;
      else if (b.HasHole() && a.IsOnLayer(active)) layer = active;
      else if (a.HasHole()) layer = b.GetLayer();
      else layer = a.GetLayer();

      this.reportHeader('Physical hole clearance resolution for:', a, b, layer, r);

      constraint = drcEngine.EvalRules(
        DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT,
        a,
        b,
        layer,
        r,
      );
      clearance = constraint.m_Value.Min();

      if (compileError) {
        this.reportCompileError(r);
      } else if (
        !drcEngine.HasRulesForConstraintType(DRC_CONSTRAINT_T.PHYSICAL_HOLE_CLEARANCE_CONSTRAINT)
      ) {
        r.report('');
        r.report("No 'physical_hole_clearance' constraints defined.");
      } else {
        r.report('');
        r.report(`Resolved min clearance: ${str(clearance)}.`);
      }
    }

    physical.Flush();

    dialog.Show(true);
  }

  /** `InspectConstraints` (board_inspection_tool.cpp:1639-1904). */
  *InspectConstraints(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (!this.m_frame) return 0;

    const frame = this.m_frame;
    const selTool = this.selTool();
    const selection = selTool.GetSelection();
    let item: BOARD_ITEM | null = null;
    const str = (aValue: number): string => frame.GetUnitsProvider().StringFromValue(aValue, true);

    if (selection.Size() === 1 && selection.GetItem(0)!.IsBOARD_ITEM()) {
      item = selection.GetItem(0) as unknown as BOARD_ITEM;
    } else if (selection.Size() === 0) {
      const constraintTypes: readonly KICAD_T[] = [
        KICAD_T.PCB_PAD_T,
        KICAD_T.PCB_VIA_T,
        KICAD_T.PCB_TRACE_T,
        KICAD_T.PCB_ARC_T,
        KICAD_T.PCB_ZONE_T,
        KICAD_T.PCB_SHAPE_T,
        KICAD_T.PCB_FOOTPRINT_T,
        KICAD_T.PCB_FIELD_T,
        KICAD_T.PCB_TEXT_T,
        KICAD_T.PCB_TEXTBOX_T,
        KICAD_T.PCB_GROUP_T,
      ];

      this.Activate();

      item = yield* this.pickItemForInspection(
        aEvent,
        'Select item for constraints resolution...',
        constraintTypes,
        null,
      );

      if (!item) return 0;
    } else {
      frame.ShowInfoBarError('Select a single item for a constraints resolution report.');
      return 0;
    }

    const dialog = frame.GetInspectConstraintsDialog();

    dialog.DeleteAllPages();
    let constraint: DRC_CONSTRAINT;

    const errors = { compile: false, courtyard: false };
    const drcEngine = this.makeDRCEngine(errors);
    const compileError = errors.compile;
    const courtyardError = errors.courtyard;

    const EVAL_RULES = (
      aConstraint: DRC_CONSTRAINT_T,
      a: BOARD_ITEM,
      b: BOARD_ITEM | null,
      aLayer: PCB_LAYER_ID,
      r: Reporter,
    ): DRC_CONSTRAINT => drcEngine.EvalRules(aConstraint, a, b, aLayer, r);

    let r: WX_HTML_REPORT_BOX_REPORTER;

    if (item.Type() === KICAD_T.PCB_TRACE_T) {
      r = dialog.AddHTMLPage('Track Width');
      this.reportHeader('Track width resolution for:', item, undefined, undefined, r);

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.TRACK_WIDTH_CONSTRAINT,
        item,
        null,
        item.GetLayer(),
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved width constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.Flush();
    }

    if (item.Type() === KICAD_T.PCB_VIA_T) {
      r = dialog.AddHTMLPage('Via Diameter');
      this.reportHeader('Via diameter resolution for:', item, undefined, undefined, r);

      // PADSTACKS TODO: once we have padstacks we'll need to run this per-layer....
      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.VIA_DIAMETER_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved diameter constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.Flush();

      r = dialog.AddHTMLPage('Via Annular Width');
      this.reportHeader('Via annular width resolution for:', item, undefined, undefined, r);

      // PADSTACKS TODO: once we have padstacks we'll need to run this per-layer....
      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.ANNULAR_WIDTH_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved annular width constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.Flush();
    }

    if (
      (item.Type() === KICAD_T.PCB_PAD_T && (item as unknown as PAD).GetDrillSize().x > 0) ||
      item.Type() === KICAD_T.PCB_VIA_T
    ) {
      r = dialog.AddHTMLPage('Hole Size');
      this.reportHeader('Hole size resolution for:', item, undefined, undefined, r);

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.HOLE_SIZE_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved hole size constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.Flush();
    }

    // dynamic_cast<PCB_TRACK*>: a track, an arc or a via.
    const isTrack =
      item.Type() === KICAD_T.PCB_TRACE_T ||
      item.Type() === KICAD_T.PCB_ARC_T ||
      item.Type() === KICAD_T.PCB_VIA_T;

    if (item.Type() === KICAD_T.PCB_PAD_T || item.Type() === KICAD_T.PCB_SHAPE_T || isTrack) {
      r = dialog.AddHTMLPage('Solder Mask');
      this.reportHeader('Solder mask expansion resolution for:', item, undefined, undefined, r);

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.SOLDER_MASK_EXPANSION_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(`Resolved solder mask expansion: ${reportOpt(str, constraint)}.`);

      r.Flush();
    }

    if (item.Type() === KICAD_T.PCB_PAD_T) {
      r = dialog.AddHTMLPage('Solder Paste');
      this.reportHeader(
        'Solder paste absolute clearance resolution for:',
        item,
        undefined,
        undefined,
        r,
      );

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.SOLDER_PASTE_ABS_MARGIN_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(`Resolved solder paste absolute clearance: ${reportOpt(str, constraint)}.`);

      this.reportHeader(
        'Solder paste relative clearance resolution for:',
        item,
        undefined,
        undefined,
        r,
      );

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.SOLDER_PASTE_REL_MARGIN_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report('');
      r.report('');
      r.report(`Resolved solder paste relative clearance: ${reportOpt(str, constraint)}.`);

      r.Flush();
    }

    if (
      item.Type() === KICAD_T.PCB_FIELD_T ||
      item.Type() === KICAD_T.PCB_TEXT_T ||
      item.Type() === KICAD_T.PCB_TEXTBOX_T
    ) {
      r = dialog.AddHTMLPage('Text Size');
      this.reportHeader('Text height resolution for:', item, undefined, undefined, r);

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.TEXT_HEIGHT_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved height constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.report('');
      r.report('');
      r.report('');
      this.reportHeader('Text thickness resolution for:', item, undefined, undefined, r);

      constraint = EVAL_RULES(
        DRC_CONSTRAINT_T.TEXT_THICKNESS_CONSTRAINT,
        item,
        null,
        PCB_LAYER_ID.UNDEFINED_LAYER,
        r,
      );

      if (compileError) this.reportCompileError(r);

      r.report('');
      r.report(
        `Resolved thickness constraints: min ${reportMin(str, constraint)}; ` +
          `opt ${reportOpt(str, constraint)}; max ${reportMax(str, constraint)}.`,
      );

      r.Flush();
    }

    const courtyardWarning =
      'Report may be incomplete: some footprint courtyards are malformed.' +
      '&nbsp;&nbsp;' +
      "<a href='$DRC'>" +
      'Run DRC for a full analysis.' +
      '</a>';

    r = dialog.AddHTMLPage('Keepouts');
    this.reportHeader('Keepout resolution for:', item, undefined, undefined, r);

    constraint = EVAL_RULES(DRC_CONSTRAINT_T.DISALLOW_CONSTRAINT, item, null, item.GetLayer(), r);

    if (compileError) this.reportCompileError(r);

    if (courtyardError) {
      r.report('');
      r.report(courtyardWarning);
    }

    r.report('');

    if (constraint.m_DisallowFlags) r.report('Item <b>disallowed</b> at current location.');
    else r.report('Item allowed at current location.');

    r.Flush();

    r = dialog.AddHTMLPage('Assertions');
    this.reportHeader('Assertions for:', item, undefined, undefined, r);

    if (compileError) this.reportCompileError(r);

    if (courtyardError) {
      r.report('');
      r.report(courtyardWarning);
    }

    drcEngine.ProcessAssertions(item, () => {}, r);
    r.Flush();

    dialog.Show(true);
    return 0;
  }

  /** `ShowFootprintLinks` (board_inspection_tool.cpp:1937-1958). */
  ShowFootprintLinks(_aEvent: TOOL_EVENT): number {
    if (!this.m_frame) return 0;

    const selection = this.selTool().GetSelection();

    if (selection.Size() !== 1 || selection.Front()!.Type() !== KICAD_T.PCB_FOOTPRINT_T) {
      this.m_frame.ShowInfoBarError('Select a footprint for a footprint associations report.');
      return 0;
    }

    this.m_frame.ShowFootprintAssociationsDialog(selection.Front() as unknown as FOOTPRINT);

    return 0;
  }

  /** @return true if a net or nets to highlight have been set */
  IsNetHighlightSet(): boolean {
    return this.m_currentlyHighlighted.size > 0;
  }

  ///< Perform the appropriate action in response to an Eeschema cross-probe.
  HighlightItem(aEvent: TOOL_EVENT): number {
    const item = aEvent.Parameter<BOARD_ITEM | null>();

    this.m_frame!.m_ProbingSchToPcb = true; // recursion guard
    {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (item) this.m_toolMgr!.RunAction<EDA_ITEM>(ACTIONS.selectItem, item);
    }
    this.m_frame!.m_ProbingSchToPcb = false;

    let request3DviewRedraw = this.m_frame!.GetPcbNewSettings().m_Display.m_Live3DRefresh;

    if (item && item.Type() !== KICAD_T.PCB_FOOTPRINT_T) request3DviewRedraw = false;

    // Update 3D viewer highlighting
    if (request3DviewRedraw) this.m_frame!.Update3DView(false, true);

    return 0;
  }

  /**
   * Look for a #BOARD_CONNECTED_ITEM in a given spot and if one is found - it enables
   * highlight for its net.
   *
   * @param aPosition is the point where an item is expected (world coordinates).
   * @param aUseSelection is true if we should use the current selection to pick the netcode
   */
  private highlightNet(aPosition: VECTOR2I, aUseSelection: boolean): boolean {
    const board = this.m_toolMgr!.GetModel() as unknown as BOARD;
    const settings = this.renderSettings();
    const selectionTool = this.selTool();

    let net = -1;
    let enableHighlight = false;

    if (aUseSelection) {
      const selection = selectionTool.GetSelection();
      const netcodes = new Set<number>();

      for (const item of selection) {
        const ci = asConnected(item);
        if (ci) netcodes.add(ci.GetNetCode());
      }

      enableHighlight = netcodes.size > 0;

      if (enableHighlight && netcodes.size > 1) {
        // If we are doing a multi-highlight, cross-probing back and other stuff is not
        // yet supported
        settings.SetHighlight(netcodes);
        board.ResetNetHighLight();

        for (const multiNet of [...netcodes].sort((a, b) => a - b))
          board.SetHighLightNet(multiNet, true);

        board.HighLightON();
        this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
        this.m_currentlyHighlighted = new Set(netcodes);
        return true;
      } else if (enableHighlight) {
        // `*netcodes.begin()`: a std::set iterates in ascending order
        net = Math.min(...netcodes);
      }
    }

    // If we didn't get a net to highlight from the selection, use the cursor
    if (net < 0) {
      const guide = selectionTool.getCollectorsGuide();
      guide.SetIgnoreZoneFills(false);
      guide.SetIgnoreNoNets(true);

      const activeLayer = this.view()!.GetTopLayer() as PCB_LAYER_ID;
      guide.SetPreferredLayer(activeLayer);

      const collector = new GENERAL_COLLECTOR();
      collector.Collect(
        board,
        [
          KICAD_T.PCB_PAD_T,
          KICAD_T.PCB_VIA_T,
          KICAD_T.PCB_TRACE_T,
          KICAD_T.PCB_ARC_T,
          KICAD_T.PCB_SHAPE_T,
        ],
        aPosition,
        guide,
      );

      if (collector.GetCount() === 0)
        collector.Collect(board, [KICAD_T.PCB_ZONE_T], aPosition, guide);

      // Apply the active selection filter, except we want to allow picking locked items for
      // highlighting even if the user has disabled them for selection
      const filter = selectionTool.GetFilter();

      const saved = filter.lockedItems;
      filter.lockedItems = true;

      selectionTool.FilterCollectedItems(collector, true, null);

      filter.lockedItems = saved;

      const highContrast = settings.GetHighContrast();
      const contrastLayer = settings.GetPrimaryHighContrastLayer();

      for (let i = collector.GetCount() - 1; i >= 0; i--) {
        const itemLayers = (collector.At(i)! as BOARD_ITEM).GetLayerSet();

        if (
          itemLayers.and(LSET.AllCuMask()).none() ||
          (highContrast && !itemLayers.Contains(contrastLayer))
        ) {
          collector.Remove(i);
          continue;
        }
      }

      enableHighlight = collector.GetCount() > 0;

      // Obtain net code for the clicked item
      if (enableHighlight) {
        const targetItem = collector.At(0)! as unknown as BOARD_CONNECTED_ITEM;

        if (targetItem.Type() === KICAD_T.PCB_PAD_T) this.m_frame!.SendCrossProbeItem(targetItem);

        net = targetItem.GetNetCode();
      }
    }

    const netcodes = settings.GetHighlightNetCodes();

    // Toggle highlight when the same net was picked
    if (!aUseSelection && netcodes.size === 1 && netcodes.has(net))
      enableHighlight = !settings.IsHighlightEnabled();

    if (enableHighlight !== settings.IsHighlightEnabled() || !netcodes.has(net)) {
      if (netcodes.size > 0) this.m_lastHighlighted = new Set(netcodes);

      settings.SetHighlight(enableHighlight, net);
      this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
    }

    // Store the highlighted netcode in the current board (for dialogs for instance)
    if (enableHighlight && net >= 0) {
      this.m_currentlyHighlighted = new Set(netcodes);
      board.SetHighLightNet(net);
      board.HighLightON();

      const netinfo = board.FindNet(net);

      if (netinfo) {
        const items: MSG_PANEL_ITEM[] = [];
        netinfo.GetMsgPanelInfo(this.m_frame! as unknown as EDA_DRAW_FRAME_LIKE, items);
        this.m_frame!.SetMsgPanel(items);
        this.m_frame!.SendCrossProbeNetName(netinfo.GetNetname());
      }
    } else {
      this.m_currentlyHighlighted.clear();
      board.ResetNetHighLight();
      this.m_frame!.SetMsgPanel(board);
      this.m_frame!.SendCrossProbeNetName('');
    }

    return true;
  }

  ///< Highlight net belonging to the item under the cursor.
  HighlightNet(aEvent: TOOL_EVENT): number {
    const netcode = aEvent.Parameter<number | null>() ?? 0;

    const settings = this.renderSettings();
    const highlighted = settings.GetHighlightNetCodes();

    if (netcode > 0) {
      this.m_lastHighlighted = new Set(highlighted);
      settings.SetHighlight(true, netcode);
      this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
      this.m_currentlyHighlighted.clear();
      this.m_currentlyHighlighted.add(netcode);
    } else if (aEvent.IsAction(PCB_ACTIONS.highlightNetSelection)) {
      // Highlight selection (cursor position will be ignored)
      this.highlightNet(this.getViewControls()!.GetMousePosition(), true);
    } else if (aEvent.IsAction(PCB_ACTIONS.toggleLastNetHighlight)) {
      const temp = new Set(highlighted);
      settings.SetHighlight(this.m_lastHighlighted);
      this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
      this.m_currentlyHighlighted = this.m_lastHighlighted;
      this.m_lastHighlighted = temp;
    } else if (aEvent.IsAction(PCB_ACTIONS.toggleNetHighlight)) {
      const turnOn = highlighted.size === 0 && this.m_currentlyHighlighted.size > 0;
      settings.SetHighlight(this.m_currentlyHighlighted, turnOn);
      this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
    } else {
      // Highlight the net belonging to the item under the cursor
      this.highlightNet(this.getViewControls()!.GetMousePosition(), false);
    }

    return 0;
  }

  ///< Clear all board highlights
  ClearHighlight(_aEvent: TOOL_EVENT): number {
    const board = this.m_toolMgr!.GetModel() as unknown as BOARD;
    const settings = this.renderSettings();

    this.m_currentlyHighlighted.clear();
    this.m_lastHighlighted.clear();

    board.ResetNetHighLight();
    settings.SetHighlight(false);
    this.m_toolMgr!.GetView()!.UpdateAllLayersColor();
    this.m_frame!.SetMsgPanel(board);
    this.m_frame!.SendCrossProbeNetName('');
    return 0;
  }

  ///< Show local ratsnest of a component.
  LocalRatsnestTool(aEvent: TOOL_EVENT): number {
    const picker = this.m_toolMgr!.FindTool(
      'pcbnew.InteractivePicker',
    ) as unknown as PCB_PICKER_TOOL;

    // Deactivate other tools; particularly important if another PICKER is currently running
    this.Activate();

    picker.SetCursor(KICURSOR.BULLSEYE);
    picker.SetSnapping(false);
    picker.ClearHandlers();

    const resetToGlobal = (): void => {
      for (const fp of this.getModel<BOARD>().Footprints()) {
        for (const pad of fp.Pads())
          pad.SetLocalRatsnestVisible(this.displayOptions().m_ShowGlobalRatsnest);
      }
    };

    picker.SetClickHandler(() => {
      const selectionTool = this.selTool();

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      this.m_toolMgr!.RunAction(ACTIONS.selectionCursor, EDIT_TOOL.PadFilter);

      let selection = selectionTool.GetSelection();

      if (selection.Empty()) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionCursor, EDIT_TOOL.FootprintFilter);
        selection = selectionTool.GetSelection();
      }

      if (selection.Empty()) {
        // Clear the previous local ratsnest if we click off all items
        resetToGlobal();
      } else {
        for (const item of selection) {
          if (item.Type() === KICAD_T.PCB_PAD_T) {
            const pad = item as unknown as PAD;
            pad.SetLocalRatsnestVisible(!pad.GetLocalRatsnestVisible());
          } else if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
            const fp = item as unknown as FOOTPRINT;

            if (fp.Pads().length > 0) {
              const enable = !fp.Pads()[0]!.GetLocalRatsnestVisible();

              for (const childPad of fp.Pads()) childPad.SetLocalRatsnestVisible(enable);
            }
          }
        }
      }

      this.m_toolMgr!.GetView()!.MarkTargetDirty(RENDER_TARGET.TARGET_OVERLAY);

      return true;
    });

    picker.SetFinalizeHandler((aCondition: number) => {
      if (aCondition !== pickerEndState.END_ACTIVATE) resetToGlobal();
    });

    this.m_toolMgr!.RunAction(ACTIONS.pickerTool, aEvent);

    return 0;
  }

  ///< Update ratsnest for selected items.
  UpdateLocalRatsnest(aEvent: TOOL_EVENT): number {
    const delta = aEvent.Parameter<VECTOR2I | null>() ?? { x: 0, y: 0 };

    if (delta.x === 0 && delta.y === 0) {
      // We can delete the existing map to force a recalculation
      this.m_dynamicData = null;
    }

    const selectionTool = this.selTool();
    const selection = selectionTool.GetSelection();
    const connectivity = this.getModel<BOARD>().GetConnectivity();

    if (selection.Empty()) {
      connectivity.ClearLocalRatsnest();
      this.m_dynamicData = null;
    } else {
      this.calculateSelectionRatsnest(delta);
    }

    return 0;
  }

  ///< Hide ratsnest for selected items. Called when there are no items selected.
  HideLocalRatsnest(_aEvent: TOOL_EVENT): number {
    this.getModel<BOARD>().GetConnectivity().ClearLocalRatsnest();
    this.m_dynamicData = null;

    return 0;
  }

  ///< Recalculate dynamic ratsnest for the current selection.
  private calculateSelectionRatsnest(aDelta: VECTOR2I): void {
    const selectionTool = this.selTool();
    const selection = selectionTool.GetSelection();
    const connectivity = this.board().GetConnectivity();
    const items: BOARD_ITEM[] = [];
    const queued_items: EDA_ITEM[] = [...selection];

    for (let i = 0; i < queued_items.length; ++i) {
      if (!queued_items[i]!.IsBOARD_ITEM()) continue;

      const item = queued_items[i] as BOARD_ITEM;

      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T) {
        for (const pad of (item as unknown as FOOTPRINT).Pads()) {
          if (pad.GetLocalRatsnestVisible() || this.displayOptions().m_ShowModuleRatsnest)
            items.push(pad);
        }
      } else if (item.Type() === KICAD_T.PCB_GROUP_T || item.Type() === KICAD_T.PCB_GENERATOR_T) {
        item.RunOnChildren((aItem: BOARD_ITEM) => {
          queued_items.push(aItem);
        }, RECURSE_MODE.RECURSE);
      } else {
        const boardItem = asConnected(item);

        if (
          boardItem &&
          (boardItem.GetLocalRatsnestVisible() || this.displayOptions().m_ShowModuleRatsnest)
        )
          items.push(boardItem);
      }
    }

    if (
      items.length === 0 ||
      !items.some(
        (aItem) =>
          aItem.Type() === KICAD_T.PCB_TRACE_T ||
          aItem.Type() === KICAD_T.PCB_PAD_T ||
          aItem.Type() === KICAD_T.PCB_ARC_T ||
          aItem.Type() === KICAD_T.PCB_ZONE_T ||
          aItem.Type() === KICAD_T.PCB_FOOTPRINT_T ||
          aItem.Type() === KICAD_T.PCB_VIA_T ||
          aItem.Type() === KICAD_T.PCB_SHAPE_T,
      )
    ) {
      return;
    }

    if (!this.m_dynamicData) {
      this.m_dynamicData = new CONNECTIVITY_DATA(this.board().GetConnectivity(), items, true);
      connectivity.BlockRatsnestItems(items);
    } else {
      this.m_dynamicData.Move(aDelta);
    }

    connectivity.ComputeLocalRatsnest(items, this.m_dynamicData);
  }

  ///< Hide the ratsnest for a given net.
  HideNetInRatsnest(aEvent: TOOL_EVENT): number {
    this.doHideRatsnestNet(aEvent.Parameter<number | null>() ?? 0, true);
    return 0;
  }

  ///< Show the ratsnest for a given net.
  ShowNetInRatsnest(aEvent: TOOL_EVENT): number {
    this.doHideRatsnestNet(aEvent.Parameter<number | null>() ?? 0, false);
    return 0;
  }

  private doHideRatsnestNet(aNetCode: number, aHide: boolean): void {
    const rs = this.renderSettings();

    const selectionTool = this.selTool();
    const selection = selectionTool.GetSelection();

    if (aNetCode <= 0 && !selection.Empty()) {
      for (const item of selection) {
        const bci = asConnected(item);

        if (bci) {
          if (bci.GetNetCode() > 0) this.doHideRatsnestNet(bci.GetNetCode(), aHide);
        }
      }

      return;
    }

    if (aHide) rs.GetHiddenNets().add(aNetCode);
    else rs.GetHiddenNets().delete(aNetCode);

    const panel = this.m_frame!.GetAppearancePanel() as unknown as NET_VISIBILITY_PANEL | null;

    if (!panel?.IsTogglingNetclassRatsnestVisibility?.()) {
      this.m_frame!.GetCanvas()?.RedrawRatsnest();
      this.m_frame!.GetCanvas()?.Refresh();

      panel?.OnNetVisibilityChanged?.(aNetCode, !aHide);
    }
  }

  ///< Bind handlers to corresponding TOOL_ACTIONs.
  protected override setTransitions(): void {
    const S = SYNC_HANDLER;
    this.Go(S(this.LocalRatsnestTool), PCB_ACTIONS.localRatsnestTool.MakeEvent());
    this.Go(S(this.HideLocalRatsnest), PCB_ACTIONS.hideLocalRatsnest.MakeEvent());
    this.Go(S(this.UpdateLocalRatsnest), PCB_ACTIONS.updateLocalRatsnest.MakeEvent());

    this.Go(S(this.ShowBoardStatistics), PCB_ACTIONS.boardStatistics.MakeEvent());
    this.Go(this.InspectClearance, PCB_ACTIONS.inspectClearance.MakeEvent());
    this.Go(this.InspectConstraints, PCB_ACTIONS.inspectConstraints.MakeEvent());
    this.Go(S(this.ShowFootprintLinks), PCB_ACTIONS.showFootprintAssociations.MakeEvent());
    // TRANSITIONAL (#636 stage 3): inspectClearance, inspectConstraints,
    // diffFootprint and showFootprintAssociations are still the window's.

    this.Go(S(this.HighlightNet), PCB_ACTIONS.highlightNet.MakeEvent());
    this.Go(S(this.HighlightNet), PCB_ACTIONS.highlightNetSelection.MakeEvent());
    this.Go(S(this.HighlightNet), PCB_ACTIONS.toggleLastNetHighlight.MakeEvent());
    this.Go(S(this.ClearHighlight), PCB_ACTIONS.clearHighlight.MakeEvent());
    this.Go(S(this.HighlightNet), PCB_ACTIONS.toggleNetHighlight.MakeEvent());
    this.Go(S(this.HighlightItem), PCB_ACTIONS.highlightItem.MakeEvent());

    this.Go(S(this.HideNetInRatsnest), PCB_ACTIONS.hideNetInRatsnest.MakeEvent());
    this.Go(S(this.ShowNetInRatsnest), PCB_ACTIONS.showNetInRatsnest.MakeEvent());
  }
}
