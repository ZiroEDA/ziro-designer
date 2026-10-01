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
import type { Reporter } from '@ziroeda/common/reporter.js';
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
import { pcbIuToMM as iuToMM } from '@ziroeda/common/eda_units.js';
import { EscapeHTML, unescapeString } from '@ziroeda/common/string_utils.js';
import type { DrcConstraintType, DrcRuleSet } from '../drc/drc_rule_view.js';
import {
  buildDrcRuleEngine,
  type DrcEvalItem,
  type DrcItemType,
  type DrcRuleEngine,
  reportDrcConstraint,
} from '../drc/drc_rules_engine.js';
import { parseBoardItemId } from '../edit-board.js';
import type { Board } from '../types.js';

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

function reportMax(aStr: (aValue: number) => string, aConstraint: DRC_CONSTRAINT): string {
  if (aConstraint.m_Value.HasMax()) return aStr(aConstraint.m_Value.Max());
  else return '<i>undefined</i>';
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

// ---------------------------------------------------------------------------
// TRANSITIONAL (#636 stage 3): the view-board report builders the frame still
// uses for Clearance / Constraints Resolution, until InspectClearance and
// InspectConstraints are ported on the live BOARD.
// ---------------------------------------------------------------------------

/** What a selection key resolves to, before it becomes an InspectItem. */
interface Described {
  desc: string;
  type: DrcItemType;
  layer: string;
  net: number;
}

/**
 * The board item behind a selection key, described the way the report names
 * it. Kinds with no copper to resolve a clearance against — graphics, text,
 * groups — return nothing rather than a section that could say nothing useful.
 */
export function describeSelected(board: Board, id: string): Described | null {
  const ref = parseBoardItemId(id);
  if (!ref) return null;

  // Unescaped, like every other net name a person reads: `{slash}` is the file's
  // encoding of a `/` inside a label name, not part of what the net is called
  // (issue #626).
  const netName = (net: number): string =>
    unescapeString(board.nets.get(net) ?? '') || `net ${net}`;

  switch (ref.kind) {
    case 'track':
    case 'arc': {
      const t = ref.kind === 'track' ? board.tracks[ref.index] : board.arcs[ref.index];
      if (!t) return null;
      return {
        desc: `Track [${netName(t.net)}] on ${t.layer}`,
        type: ref.kind === 'track' ? 'Track' : 'Arc',
        layer: t.layer,
        net: t.net,
      };
    }

    case 'via': {
      const v = board.vias[ref.index];
      if (!v) return null;
      return { desc: `Via [${netName(v.net)}]`, type: 'Via', layer: v.layers[0], net: v.net };
    }

    case 'pad': {
      const fp = board.footprints[ref.index];
      const pad = fp?.pads[ref.sub ?? 0];
      if (!fp || !pad) return null;
      return {
        desc: `Pad ${pad.number} of ${fp.reference ?? fp.lib}`,
        type: 'Pad',
        layer: pad.layers[0] ?? 'F.Cu',
        net: pad.net ?? 0,
      };
    }

    case 'zone': {
      const z = board.zones[ref.index];
      if (!z) return null;
      return {
        desc: z.name ? `Zone '${z.name}'` : `Zone [${netName(z.net)}]`,
        type: 'Zone',
        layer: z.layers[0] ?? 'F.Cu',
        net: z.net,
      };
    }

    default:
      return null;
  }
}

/**
 * The report for a selection: two items give a clearance resolution, one gives
 * a constraints resolution, anything else gives nothing.
 *
 * Upstream lets a user pick the items interactively when the selection is not
 * already a pair; here the menu entries are simply disabled until it is, which
 * says the same thing without a modal picker.
 */
export function inspectSelection(
  board: Board,
  selection: Iterable<string>,
  rules: DrcRuleSet,
  netClassesOf: (netName: string) => readonly string[],
): InspectSection[] {
  const picked: Described[] = [];

  for (const id of selection) {
    const d = describeSelected(board, id);
    if (d) picked.push(d);
  }

  const toItem = (d: Described): InspectItem => ({
    desc: d.desc,
    eval: {
      type: d.type,
      layer: d.layer,
      netName: board.nets.get(d.net),
      netClasses: [...netClassesOf(board.nets.get(d.net) ?? '')],
    },
  });

  if (picked.length === 2)
    return buildClearanceReport(rules, toItem(picked[0]!), toItem(picked[1]!), picked[0]!.layer);

  if (picked.length === 1)
    return buildConstraintsReport(rules, toItem(picked[0]!), picked[0]!.layer);

  return [];
}

/**
 * The selection as the DIALOG_BOOK_REPORTER BOARD_INSPECTION_TOOL fills:
 * PCB_EDIT_FRAME::GetInspectClearanceDialog is titled "Clearance Report" and
 * GetInspectConstraintsDialog "Constraints Report" (pcb_edit_frame.cpp:3318,
 * :3330), and each constraint goes on its upstream page (`inspectPages`).
 * `null` when the selection is neither one item nor a pair.
 */
export function inspectReport(
  board: Board,
  selection: Iterable<string>,
  rules: DrcRuleSet,
  netClassesOf: (netName: string) => readonly string[],
): { title: string; pages: InspectPage[] } | null {
  const ids = [...selection];
  const sections = inspectSelection(board, ids, rules, netClassesOf);
  if (sections.length === 0) return null;
  const pair = ids.filter((id) => describeSelected(board, id) !== null).length === 2;
  const layer = describeSelected(board, ids.find((id) => describeSelected(board, id))!)!.layer;
  return pair
    ? { title: 'Clearance Report', pages: inspectPages(sections, 'clearance', layer) }
    : { title: 'Constraints Report', pages: inspectPages(sections, 'constraints', layer) };
}

/** One headed block of the report, as a dialog renders one page. */
export interface InspectSection {
  /** The constraint this section reports, which names its notebook page. */
  type: DrcConstraintType;
  /** "Clearance resolution for:" and the like. */
  title: string;
  /** The layer and the item descriptions the question was asked about. */
  subjects: string[];
  /** The engine's reasoning, one line per step. */
  lines: string[];
}

export interface InspectItem {
  /** How the item is named in the report. */
  desc: string;
  /** What the rule engine matches against. */
  eval: DrcEvalItem;
}

const mm = (iu: number): string =>
  `${iuToMM(iu).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} mm`;

/**
 * The constraints upstream reports for a pair of items, in its order.
 *
 * A pad against a zone is the case with the most to say: the zone connection
 * decides whether the other three are even meaningful, so it comes first.
 */
function constraintsFor(a: InspectItem, b: InspectItem): DrcConstraintType[] {
  const kinds = [a.eval.type, b.eval.type];
  const padToZone = kinds.includes('Pad') && kinds.includes('Zone');

  if (padToZone)
    return [
      'zone_connection',
      'thermal_relief_gap',
      'thermal_spoke_width',
      'min_resolved_spokes',
      'clearance',
    ];

  return ['clearance'];
}

/** The human title for each constraint's section. */
/** reportHeader's titles in InspectConstraints (board_inspection_tool.cpp:1701-1824). */
const CONSTRAINT_TITLES: Partial<Record<DrcConstraintType, string>> = {
  track_width: 'Track width resolution for:',
  via_diameter: 'Via diameter resolution for:',
  annular_width: 'Via annular width resolution for:',
  hole_size: 'Hole size resolution for:',
  text_height: 'Text height resolution for:',
  text_thickness: 'Text thickness resolution for:',
  track_angle: 'Track Angle resolution for:',
  track_segment_length: 'Track segment length resolution for:',
  clearance: 'Clearance resolution for:',
};

const TITLES: Partial<Record<DrcConstraintType, string>> = {
  clearance: 'Clearance resolution for:',
  zone_connection: 'Zone connection resolution for:',
  thermal_relief_gap: 'Thermal-relief gap resolution for:',
  thermal_spoke_width: 'Thermal-relief spoke width resolution for:',
  min_resolved_spokes: 'Thermal-relief min spoke count resolution for:',
  hole_clearance: 'Hole clearance resolution for:',
  edge_clearance: 'Edge clearance resolution for:',
  physical_clearance: 'Physical clearance resolution for:',
};

/**
 * `reportClearance`: why these two items resolve to the clearance they do.
 *
 * `localOverride` is the item's own clearance, which wins outright — the
 * report says so and stops, because consulting rules whose answer cannot be
 * used would suggest they were involved.
 */
export function buildClearanceReport(
  rules: DrcRuleSet | DrcRuleEngine,
  a: InspectItem,
  b: InspectItem,
  layer: string,
  localOverride?: number,
): InspectSection[] {
  const engine = 'byType' in rules ? rules : buildDrcRuleEngine([], rules);
  const subjects = [`Layer ${layer}`, a.desc, b.desc];

  return constraintsFor(a, b).map((type) => {
    const { lines } = reportDrcConstraint(
      engine,
      type,
      a.eval,
      b.eval,
      layer,
      type === 'clearance' ? localOverride : undefined,
    );

    return { title: TITLES[type] ?? `${type} resolution for:`, subjects, lines, type };
  });
}

/**
 * `InspectConstraints`: what every constraint resolves to for one item.
 *
 * Unlike the clearance report this asks about a single item, so the
 * constraints are the ones an item can carry on its own — the pairwise ones
 * have no second item to be measured against and are left out rather than
 * reported against nothing.
 */
export function buildConstraintsReport(
  rules: DrcRuleSet | DrcRuleEngine,
  item: InspectItem,
  layer: string,
): InspectSection[] {
  const engine = 'byType' in rules ? rules : buildDrcRuleEngine([], rules);
  const subjects = [`Layer ${layer}`, item.desc];

  const single: DrcConstraintType[] =
    item.eval.type === 'Via'
      ? ['via_diameter', 'hole_size', 'annular_width']
      : item.eval.type === 'Track' || item.eval.type === 'Arc'
        ? ['track_width', 'track_segment_length', 'track_angle']
        : item.eval.type === 'Text'
          ? ['text_height', 'text_thickness']
          : ['clearance'];

  return single.map((type) => {
    const { lines } = reportDrcConstraint(engine, type, item.eval, undefined, layer);
    return { title: CONSTRAINT_TITLES[type] ?? `${type} resolution for:`, subjects, lines, type };
  });
}

/** The report as plain text, for a console, a clipboard or a snapshot. */
export function formatInspectReport(sections: readonly InspectSection[]): string {
  return sections
    .map((s) =>
      [s.title, ...s.subjects.map((x) => `  - ${x}`), ...s.lines.map((x) => `  ${x}`)].join('\n'),
    )
    .join('\n\n');
}

export { mm as formatInspectValue };

/** One DIALOG_BOOK_REPORTER page: its tab caption and what was Report()ed. */
export interface InspectPage {
  title: string;
  messages: string[];
}

/**
 * The notebook page each constraint is reported on, as
 * BOARD_INSPECTION_TOOL::InspectClearance (board_inspection_tool.cpp:1035-1530)
 * and InspectConstraints (:1686-1900) name them. A copper clearance goes on a
 * page named for its layer (`AddHTMLPage( GetLayerName( layer ) )`), and the
 * four zone checks share the one "Zone" page.
 *
 * `track_angle` and `track_segment_length` are not on upstream's constraints
 * report; they are InspectDRCError's pages (:638, :653), whose captions they
 * keep.
 */
function pageTitle(
  type: DrcConstraintType,
  report: 'clearance' | 'constraints',
  layerName: string,
): string {
  switch (type) {
    case 'clearance':
      return layerName;
    case 'zone_connection':
    case 'thermal_relief_gap':
    case 'thermal_spoke_width':
    case 'min_resolved_spokes':
      return 'Zone';
    case 'hole_clearance':
      return 'Hole';
    case 'edge_clearance':
      return `${layerName} Clearance`;
    case 'physical_clearance':
      return 'Physical Clearances';
    case 'track_width':
      return 'Track Width';
    case 'via_diameter':
      return 'Via Diameter';
    case 'annular_width':
      return report === 'constraints' ? 'Via Annular Width' : 'Via Annulus';
    case 'hole_size':
      return 'Hole Size';
    case 'text_height':
    case 'text_thickness':
      return report === 'constraints'
        ? 'Text Size'
        : type === 'text_height'
          ? 'Text Height'
          : 'Text Thickness';
    case 'track_angle':
      return 'Track Angle';
    case 'track_segment_length':
      return 'Track Segment Length';
    default:
      return type;
  }
}

/**
 * The sections as BOARD_INSPECTION_TOOL writes them into the dialog: one
 * page per caption (sections sharing a caption share its page, in order), each
 * opened by `reportHeader` - `<h7>title</h7>` and the subjects as a `<ul>` -
 * then a blank line and the engine's reasoning. Every piece of text is
 * EscapeHTML()'d, as upstream escapes each item description: a net or
 * reference name is the board's, not markup.
 */
export function inspectPages(
  sections: readonly InspectSection[],
  report: 'clearance' | 'constraints',
  layerName: string,
): InspectPage[] {
  const pages: InspectPage[] = [];
  for (const s of sections) {
    const title = pageTitle(s.type, report, layerName);
    let page = pages.find((p) => p.title === title);
    if (!page) {
      page = { title, messages: [] };
      pages.push(page);
    }
    page.messages.push(`<h7>${EscapeHTML(s.title)}</h7>`);
    page.messages.push(`<ul>${s.subjects.map((x) => `<li>${EscapeHTML(x)}</li>`).join('')}</ul>`);
    page.messages.push('');
    for (const line of s.lines) page.messages.push(EscapeHTML(line));
    page.messages.push('');
  }
  return pages;
}
