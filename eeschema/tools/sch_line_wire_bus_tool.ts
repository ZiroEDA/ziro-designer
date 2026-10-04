// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Interactive wire/bus drawing logic. Mirrors kicad/eeschema/tools/
 * sch_line_wire_bus_tool.cpp (SCH_LINE_WIRE_BUS_TOOL): the two-segment
 * break-point coercion for the 90°/45° line modes, posture switching, the
 * backtrack simplification pass, terminal-point detection (a click on a pin,
 * junction, label or wire ends the run) and the finishing commit with
 * automatic junctions.
 *
 * The UI event loop lives in the canvas; everything here is the pure model
 * side so it can be unit-tested.
 *
 * The functions above are the record model's (TRANSITIONAL, S7). The live model's
 * SCH_LINE_WIRE_BUS_TOOL, the C++ class itself, is at the end of the file.
 */
import { BITMAPS } from '@ziroeda/common/bitmaps/bitmaps_list.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  IS_BROKEN,
  IS_CHANGED,
  IS_MOVING,
  IS_NEW,
  SKIP_STRUCT,
} from '@ziroeda/common/eda_item_flags.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ACTION_MENU } from '@ziroeda/common/tool/action_menu.js';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { ANCHOR_FLAGS, GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import {
  type SELECTION_CONDITION,
  SELECTION_CONDITIONS,
} from '@ziroeda/common/tool/selection_conditions.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  CONTEXT_MENU_TRIGGER,
  MD_SHIFT,
  TA_CHOICE_MENU_CHOICE,
  TA_CHOICE_MENU_CLOSED,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { IsPointOnSegment } from '@ziroeda/kimath/src/trigo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 as VECTOR2D, VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { id_eeschema_frm } from '../eeschema_id.js';
import { PreviewJunctions } from '../junction_helpers.js';
import { SCH_BUS_WIRE_ENTRY } from '../sch_bus_entry.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { CONNECTION_TYPE, SCH_CONNECTION } from '../sch_connection.js';
import { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import type { SCH_GROUP } from '../sch_group.js';
import { type DANGLING_END_ITEM, DANGLING_END_ITEM_HELPER, SCH_ITEM } from '../sch_item.js';
import { SCH_JUNCTION } from '../sch_junction.js';
import { SCH_LABEL, SPIN_STYLE } from '../sch_label.js';
import { SCH_LINE } from '../sch_line.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import type { SCH_SHEET } from '../sch_sheet.js';
import { type SCH_SHEET_PIN, SHEET_SIDE } from '../sch_sheet_pin.js';
import type { SCHEMATIC } from '../schematic.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { type DRAW_SEGMENT_EVENT_PARAMS, LINE_MODE, SCH_ACTIONS } from './sch_actions.js';
import type { SCH_SELECTION } from './sch_selection.js';
import { SCH_CONDITIONS } from './sch_selection_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import type { LibSymbol, Schematic, SchLine, Vec2 } from '../types.js';
import { symbolTransform, localToWorld } from '@ziroeda/kimath/src/transform.js';
import { addItems } from './mutate.js';
import { needsJunction } from './mutate.js';
import { makeWire, makeBus, makeJunction } from './build.js';
import type { EditCommand } from './command.js';
import { schSymbolLibraryName } from '../lib_symbol.js';

/** EESCHEMA_SETTINGS m_Drawing.line_mode (sch_line.h LINE_MODE). */
export type WireLineMode = 'free' | '90' | '45';

/** One segment of the chain being drawn (upstream m_wires entries). */
export interface WireSeg {
  a: Vec2;
  b: Vec2;
}

const eq = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

export const segIsNull = (s: WireSeg): boolean => eq(s.a, s.b);

/**
 * SCH_LINE_WIRE_BUS_TOOL::startSegments, the first click creates one
 * segment; in the 90°/45° modes a second chained segment is created at once
 * so the pair can bend orthogonally toward the cursor.
 */
export function startSegments(pos: Vec2, mode: WireLineMode): WireSeg[] {
  const wires: WireSeg[] = [{ a: { ...pos }, b: { ...pos } }];
  if (mode !== 'free') wires.push({ a: { ...pos }, b: { ...pos } });
  return wires;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::computeBreakPoint, coerce the live segment pair so
 * both reach `pos` while staying orthogonal (90) or orthogonal+diagonal (45).
 * The existing shape is maintained where possible: a first segment that was
 * vertical stays vertical. Wires starting on a left/right sheet pin are
 * forced horizontal, pushed one grid outside the sheet boundary.
 * Returns the (possibly adjusted) position.
 */
export function computeBreakPoint(
  segment: WireSeg,
  nextSegment: WireSeg,
  aPosition: Vec2,
  mode: WireLineMode,
  posture: boolean,
  sheetPinSide?: 'left' | 'right',
  gridSize = 1270000 / 100, // 50 mil in IU when the caller doesn't say
): Vec2 {
  const pos: { x: number; y: number } = { ...aPosition };
  const delta = { x: pos.x - segment.a.x, y: pos.y - segment.a.y };
  const xDir = delta.x > 0 ? 1 : -1;
  const yDir = delta.y > 0 ? 1 : -1;

  let preferHorizontal: boolean;
  let preferVertical: boolean;

  if (mode === '45' && posture) {
    preferHorizontal = nextSegment.b.x - nextSegment.a.x !== 0;
    preferVertical = nextSegment.b.y - nextSegment.a.y !== 0;
  } else {
    preferHorizontal = segment.b.x - segment.a.x !== 0;
    preferVertical = segment.b.y - segment.a.y !== 0;
  }

  // Times we need to force horizontal sheet pin connections.
  if (sheetPinSide) {
    if (pos.x === segment.a.x) {
      // push outside sheet boundary
      pos.x += gridSize * (sheetPinSide === 'left' ? -1 : 1);
      delta.x = pos.x - segment.a.x;
    }
    preferHorizontal = true;
    preferVertical = false;
  }

  const midPoint: { x: number; y: number } = { x: 0, y: 0 };

  const breakVertical = () => {
    if (mode === '45') {
      if (!posture) {
        midPoint.x = segment.a.x;
        midPoint.y = pos.y - yDir * Math.abs(delta.x);
      } else {
        midPoint.x = pos.x;
        midPoint.y = segment.a.y + yDir * Math.abs(delta.x);
      }
    } else {
      midPoint.x = segment.a.x;
      midPoint.y = pos.y;
    }
  };

  const breakHorizontal = () => {
    if (mode === '45') {
      if (!posture) {
        midPoint.x = pos.x - xDir * Math.abs(delta.y);
        midPoint.y = segment.a.y;
      } else {
        midPoint.x = segment.a.x + xDir * Math.abs(delta.y);
        midPoint.y = pos.y;
      }
    } else {
      midPoint.x = pos.x;
      midPoint.y = segment.a.y;
    }
  };

  // Maintain the current line shape if we can, e.g. if we were originally
  // moving vertically keep the first segment vertical.
  if (preferVertical) breakVertical();
  else if (preferHorizontal) breakHorizontal();

  // Reject 45° breaks that overshoot or reverse against the cursor delta.
  const deltaMidpoint = { x: midPoint.x - segment.a.x, y: midPoint.y - segment.a.y };
  const signbit = (v: number) => v < 0 || Object.is(v, -0);

  if (
    mode === '45' &&
    !posture &&
    (signbit(deltaMidpoint.x) !== signbit(delta.x) || signbit(deltaMidpoint.y) !== signbit(delta.y))
  ) {
    preferVertical = false;
    preferHorizontal = false;
  } else if (
    mode === '45' &&
    posture &&
    (Math.abs(deltaMidpoint.x) > Math.abs(delta.x) || Math.abs(deltaMidpoint.y) > Math.abs(delta.y))
  ) {
    preferVertical = false;
    preferHorizontal = false;
  }

  if (!preferHorizontal && !preferVertical) {
    if (Math.abs(delta.x) < Math.abs(delta.y)) breakVertical();
    else breakHorizontal();
  }

  segment.b = { ...midPoint };
  nextSegment.a = { ...midPoint };
  nextSegment.b = { ...pos };
  return pos;
}

/**
 * The posture-switch action (SCH_ACTIONS::switchSegmentPosture, '/'):
 * in 90° mode swap the two live segments' directions in place; in 45° mode
 * the caller flips the posture flag and recomputes the break point.
 */
export function switchPosture90(segment: WireSeg, nextSegment: WireSeg): void {
  const delta1 = { x: segment.b.x - segment.a.x, y: segment.b.y - segment.a.y };
  const delta2 = { x: nextSegment.b.x - nextSegment.a.x, y: nextSegment.b.y - nextSegment.a.y };
  nextSegment.a = { x: nextSegment.b.x - delta1.x, y: nextSegment.b.y - delta1.y };
  segment.b = { x: segment.a.x + delta2.x, y: segment.a.y + delta2.y };
}

/** Is `p` on segment a-b (endpoints included)? */
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot >= 0 && dot <= len2;
}

/** All pin positions of every placed symbol. */
function allPinPositions(sch: Schematic, libById: Map<string, LibSymbol>): Vec2[] {
  const out: Vec2[] = [];
  for (const sym of sch.symbols) {
    const lib = libById.get(schSymbolLibraryName(sym));
    if (!lib) continue;
    const t = symbolTransform(sym.angle, sym.mirror);
    for (const u of lib.units) {
      if (
        (u.unit !== 0 && u.unit !== sym.unit) ||
        (u.bodyStyle !== 0 && u.bodyStyle !== sym.bodyStyle)
      )
        continue;
      for (const pin of u.pins) out.push(localToWorld(sym.at, t, pin.at));
    }
  }
  return out;
}

/**
 * SCH_SCREEN::IsTerminalPoint, should a click here end the wire run?
 * For wires: a bus entry end, junction, symbol pin, another wire (anywhere
 * along it), a connected label, or a sheet pin. For buses: another bus,
 * a sheet pin, or a connected label.
 */
export function isTerminalPoint(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  pos: Vec2,
  kind: 'wire' | 'bus',
): boolean {
  const lineAt = (k: SchLine['kind']) =>
    sch.lines.some((l) => l.kind === k && onSegment(pos, l.start, l.end));

  if (kind === 'bus') {
    if (lineAt('bus')) return true;
  } else {
    if (
      sch.busEntries.some(
        (e) => eq(pos, e.at) || eq(pos, { x: e.at.x + e.size.x, y: e.at.y + e.size.y }),
      )
    )
      return true;
    if (sch.junctions.some((j) => eq(j.at, pos))) return true;
    if (allPinPositions(sch, libById).some((p) => eq(p, pos))) return true;
    if (lineAt('wire')) return true;
  }

  if (sch.labels.some((l) => eq(l.at, pos))) return true;

  for (const sheet of sch.sheets) {
    if (sheet.pins.some((p) => eq(p.at, pos))) return true;
  }

  return false;
}

/** The left/right sheet pin at `pos`, if any (forces horizontal wire starts). */
export function sheetPinSideAt(sch: Schematic, pos: Vec2): 'left' | 'right' | undefined {
  for (const sheet of sch.sheets) {
    for (const pin of sheet.pins) {
      if (!eq(pin.at, pos)) continue;
      // Side encoding: 0 = right, 90 = top, 180 = left, 270 = bottom.
      if (pin.angle === 180) return 'left';
      if (pin.angle === 0) return 'right';
    }
  }
  return undefined;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::simplifyWireList, drop zero-length segments and
 * merge consecutive collinear segments, which also removes backtracks
 * (a segment drawn back over the previous one).
 */
export function simplifyWireList(wires: readonly WireSeg[]): WireSeg[] {
  const out: WireSeg[] = [];
  for (const seg of wires) {
    if (segIsNull(seg)) continue;
    const prev = out[out.length - 1];
    if (prev) {
      const d1 = { x: prev.b.x - prev.a.x, y: prev.b.y - prev.a.y };
      const d2 = { x: seg.b.x - seg.a.x, y: seg.b.y - seg.a.y };
      if (d1.x * d2.y - d1.y * d2.x === 0 && eq(prev.b, seg.a)) {
        // Collinear continuation or backtrack: merge into one segment.
        prev.b = { ...seg.b };
        if (segIsNull(prev)) out.pop();
        continue;
      }
    }
    out.push({ a: { ...seg.a }, b: { ...seg.b } });
  }
  return out;
}

/**
 * SCH_LINE_WIRE_BUS_TOOL::finishSegments, commit the simplified chain as
 * wire/bus lines plus the junctions the new connections call for: at each
 * new wire end, and at existing connection points the new wires pass over.
 */
export function finishWires(
  sch: Schematic,
  libById: Map<string, LibSymbol>,
  wires: readonly WireSeg[],
  kind: 'wire' | 'bus',
): EditCommand | null {
  const simplified = simplifyWireList(wires);
  if (simplified.length === 0) return null;

  const lines = simplified.map((s) => (kind === 'bus' ? makeBus(s.a, s.b) : makeWire(s.a, s.b)));

  const withLines = addItems({ lines }).apply(sch);

  // Candidate junction spots: the new segments' own ends, plus any existing
  // connection point (pin/wire end/junction/label) that lies on a new segment.
  const candidates: Vec2[] = [];
  for (const s of simplified) {
    candidates.push(s.a, s.b);
  }

  const connections: Vec2[] = [
    ...allPinPositions(sch, libById),
    ...sch.lines.flatMap((l) => [l.start, l.end]),
    ...sch.labels.map((l) => l.at),
  ];

  for (const s of simplified) {
    for (const pt of connections) {
      if (onSegment(pt, s.a, s.b)) candidates.push(pt);
    }
  }

  const junctions: Vec2[] = [];
  for (const p of candidates) {
    if (junctions.some((q) => eq(p, q))) continue;
    if (needsJunction(withLines, p, libById)) junctions.push(p);
  }

  return addItems({ lines, junctions: junctions.map((p) => makeJunction(p)) });
}

// -----------------------------------------------------------------------------------------------
// SCH_LINE_WIRE_BUS_TOOL (eeschema/tools/sch_line_wire_bus_tool.{h,cpp}) on the live model
// -----------------------------------------------------------------------------------------------

type BUS_GETTER = () => SCH_LINE | null;

class BUS_UNFOLD_MENU extends ACTION_MENU {
  private m_showTitle = false;
  private m_busGetter: BUS_GETTER;

  /**
   * @param aBusGetter Function to get the bus to unfold, which will probably
   *                   be looking for a likely bus in a selection.
   */
  constructor(aBusGetter: BUS_GETTER) {
    super(true);
    this.m_busGetter = aBusGetter;
    this.SetIcon(BITMAPS.add_line2bus);
    this.SetTitle('Unfold from Bus');
  }

  SetShowTitle(): void {
    this.m_showTitle = true;
  }

  override PassHelpTextToHandler(): boolean {
    return true;
  }

  protected override create(): ACTION_MENU {
    return new BUS_UNFOLD_MENU(this.m_busGetter);
  }

  protected override update(): void {
    let bus = this.m_busGetter();
    this.Clear();
    // Pick up the pointer again because it may have been changed by SchematicCleanUp
    bus = this.m_busGetter();

    const ID = id_eeschema_frm.ID_POPUP_SCH_UNFOLD_BUS;

    if (!bus) {
      this.Append(ID, 'No bus selected', '');
      this.Enable(ID, false);
      return;
    }

    const connection = bus.Connection();

    if (!connection || !connection.IsBus() || connection.Members().length === 0) {
      this.Append(ID, 'Bus has no members', '');
      this.Enable(ID, false);
      return;
    }

    let idx = 0;

    if (this.m_showTitle) {
      this.Append(ID, 'Unfold from Bus', '');
      this.Enable(ID, false);
    }

    const diff_busses = new Map<string, ACTION_MENU>();
    const isDiff = (aName: string) =>
      aName.endsWith('+') || aName.endsWith('-') || aName.endsWith('P') || aName.endsWith('N');

    for (const member of connection.Members()) {
      let id = ID + idx++;
      let name = member.FullLocalName();

      if (member.Type() === CONNECTION_TYPE.BUS) {
        let submenu: ACTION_MENU | null = null;
        // If we are building the menu for suffixed bus vectors, we need to do some more massaging
        if (isDiff(name) && member.Members().length > 0) {
          const submenu_name = name.substring(0, name.length - 1);
          const bus_submenu = diff_busses.get(submenu_name);

          if (!bus_submenu) {
            submenu = new ACTION_MENU(true, this.m_tool);
            diff_busses.set(submenu_name, submenu);
            this.AppendSubMenu(submenu, SCH_CONNECTION.PrintBusForUI(submenu_name), submenu_name);
          } else {
            submenu = bus_submenu;
          }
        } else {
          // Otherwise we can set the submenu up like normal
          submenu = new ACTION_MENU(true, this.m_tool);
          this.AppendSubMenu(submenu, SCH_CONNECTION.PrintBusForUI(name), name);
        }

        for (const sub_member of member.Members()) {
          id = ID + idx++;
          name = sub_member.FullLocalName();

          if (isDiff(name)) {
            const submenu_name = name.substring(0, name.length - 1);
            const bus_submenu = diff_busses.get(submenu_name);

            let diff_submenu: ACTION_MENU;

            if (!bus_submenu) {
              diff_submenu = new ACTION_MENU(true, this.m_tool);
              diff_busses.set(submenu_name, diff_submenu);
              submenu.AppendSubMenu(
                diff_submenu,
                SCH_CONNECTION.PrintBusForUI(submenu_name),
                submenu_name,
              );
            } else {
              diff_submenu = bus_submenu;
            }

            diff_submenu.Append(id, SCH_CONNECTION.PrintBusForUI(name), name);
          } else {
            submenu.Append(id, SCH_CONNECTION.PrintBusForUI(name), name);
          }
        }
      } else {
        this.Append(id, SCH_CONNECTION.PrintBusForUI(name), name);
      }
    }
  }
}

/** Settings for bus unfolding that are persistent across invocations of the tool. */
const busUnfoldPersistentSettings = {
  label_spin_style: new SPIN_STYLE(SPIN_STYLE.RIGHT),
};

/** Data related to bus unfolding tool. */
interface BUS_UNFOLDING_T {
  in_progress: boolean; ///< True if bus unfold operation is running
  flipX: boolean; ///< True if the bus entry should be flipped in the x-axis
  flipY: boolean; ///< True if the bus entry should be flipped in the y-axis
  origin: VECTOR2I; ///< Origin (on the bus) of the unfold
  net_name: string; ///< Net label for the unfolding operation

  label_placed: boolean; ///< True if user has placed the net label

  entry: SCH_BUS_WIRE_ENTRY | null;
  label: SCH_LABEL | null;
}

const emptyBusUnfold = (): BUS_UNFOLDING_T => ({
  in_progress: false,
  flipX: false,
  flipY: false,
  origin: { x: 0, y: 0 },
  net_name: '',
  label_placed: false,
  entry: null,
  label: null,
});

/** `static bool posture` of doDrawSegments: the 45 degree posture, kept between calls. */
let posture = false;

/** Tools to draw wires, buses and graphic lines, and to unfold wires from buses. */
export class SCH_LINE_WIRE_BUS_TOOL extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  private m_inDrawingTool = false; // Reentrancy guard

  private m_busUnfold: BUS_UNFOLDING_T = emptyBusUnfold();
  private m_wires: SCH_LINE[] = []; // Lines being drawn

  constructor() {
    super('eeschema.InteractiveDrawingLineWireBus');
  }

  override Init(): boolean {
    super.Init();

    const busGetter = () => this.getBusForUnfolding();

    const busUnfoldMenu = new BUS_UNFOLD_MENU(busGetter);
    busUnfoldMenu.SetTool(this);
    this.m_menu.RegisterSubMenu(busUnfoldMenu);

    const selBusUnfoldMenu = new BUS_UNFOLD_MENU(busGetter);
    selBusUnfoldMenu.SetTool(this.m_selectionTool!);
    this.m_selectionTool!.GetToolMenu().RegisterSubMenu(selBusUnfoldMenu);

    const C = SCH_CONDITIONS;
    const { And, Or } = SELECTION_CONDITIONS;

    const wireOrBusTool: SELECTION_CONDITION = () =>
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.drawWire) ||
      this.m_frame!.IsCurrentTool(SCH_ACTIONS.drawBus);

    const lineTool: SELECTION_CONDITION = () => this.m_frame!.IsCurrentTool(SCH_ACTIONS.drawLines);

    const belowRootSheetCondition: SELECTION_CONDITION = () =>
      this.m_frame!.GetCurrentSheet().Last() !== this.m_frame!.Schematic().Root();

    const busSelection = And(C.MoreThan(0), C.OnlyTypes([KICAD_T.SCH_ITEM_LOCATE_BUS_T]));

    const haveHighlight: SELECTION_CONDITION = () =>
      this.m_frame instanceof SCH_EDIT_FRAME && this.m_frame.GetHighlightedConnection() !== '';

    const ctxMenu = this.m_menu.GetMenu();

    // Build the tool menu
    //
    ctxMenu.AddItem(SCH_ACTIONS.clearHighlight, And(haveHighlight, C.Idle), 1);
    ctxMenu.AddSeparator(1); // AddSeparator( haveHighlight && SCH_CONDITIONS::Idle, 1 )

    ctxMenu.AddSeparator(10);
    ctxMenu.AddItem(SCH_ACTIONS.drawWire, And(wireOrBusTool, C.Idle), 10);
    ctxMenu.AddItem(SCH_ACTIONS.drawBus, And(wireOrBusTool, C.Idle), 10);
    ctxMenu.AddItem(SCH_ACTIONS.drawLines, And(lineTool, C.Idle), 10);

    ctxMenu.AddItem(SCH_ACTIONS.undoLastSegment, C.ShowAlways, 10);
    ctxMenu.AddItem(SCH_ACTIONS.switchSegmentPosture, C.ShowAlways, 10);
    ctxMenu.AddItem(ACTIONS.finishInteractive, SCH_LINE_WIRE_BUS_TOOL.IsDrawingLineWireOrBus, 10);

    ctxMenu.AddMenu(busUnfoldMenu, C.Idle, 10);

    ctxMenu.AddSeparator(100);
    ctxMenu.AddItem(SCH_ACTIONS.placeJunction, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.placeLabel, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.placeClassLabel, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.placeGlobalLabel, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.placeHierLabel, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.breakWire, And(wireOrBusTool, C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.slice, And(Or(wireOrBusTool, lineTool), C.Idle), 100);
    ctxMenu.AddItem(SCH_ACTIONS.leaveSheet, belowRootSheetCondition, 150);

    ctxMenu.AddSeparator(200);
    ctxMenu.AddItem(SCH_ACTIONS.selectNode, And(wireOrBusTool, C.Idle), 200);
    ctxMenu.AddItem(SCH_ACTIONS.selectConnection, And(wireOrBusTool, C.Idle), 200);

    // Add bus unfolding to the selection tool
    //
    const selToolMenu = this.m_selectionTool!.GetToolMenu().GetMenu();

    selToolMenu.AddMenu(selBusUnfoldMenu, And(busSelection, C.Idle), 100);

    return true;
  }

  /** True when \a aSelection is a new line being drawn. */
  static IsDrawingLineWireOrBus(aSelection: SELECTION): boolean {
    // NOTE: for immediate hotkeys, it is NOT required that the line, wire or bus tool
    // be selected
    const item = aSelection.Front() as SCH_ITEM | null;
    return !!item && item.IsNew() && item.Type() === KICAD_T.SCH_LINE_T;
  }

  /** Handle the addition of wires, buses and graphic lines. */
  *DrawSegments(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inDrawingTool) return 0;

    this.m_inDrawingTool = true;

    try {
      const params = aEvent.Parameter<DRAW_SEGMENT_EVENT_PARAMS>();
      const commit = new SCH_COMMIT(this.m_toolMgr!);

      this.m_frame!.PushTool(aEvent);
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (aEvent.HasPosition()) {
        const grid = new EE_GRID_HELPER(this.m_toolMgr);
        const gridType =
          params.layer === SCH_LAYER_ID.LAYER_NOTES
            ? GRID_HELPER_GRIDS.GRID_GRAPHICS
            : GRID_HELPER_GRIDS.GRID_WIRES;

        grid.SetSnap(!aEvent.Modifier(MD_SHIFT));
        grid.SetUseGrid(
          this.getView()!.GetGAL()!.GetGridSnapping() && !aEvent.DisableGridSnapping(),
        );

        const cursorPos = grid.BestSnapAnchor(aEvent.Position(), gridType, null);
        this.startSegments(commit, params.layer, cursorPos, params.sourceSegment);
      }

      return yield* this.doDrawSegments(aEvent, commit, params.layer, params.quitOnDraw);
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /** Unfold a wire from the bus under the cursor (the net named, or chosen from a menu). */
  *UnfoldBus(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inDrawingTool) return 0;

    this.m_inDrawingTool = true;

    try {
      const commit = new SCH_COMMIT(this.m_toolMgr!);
      const netPtr = aEvent.HasParameter() ? aEvent.Parameter<string | null>() : null;
      let net = '';
      let segment: SCH_LINE | null = null;

      this.m_frame!.PushTool(aEvent);
      this.Activate();

      if (netPtr) {
        net = netPtr;
      } else {
        const busGetter = () => this.getBusForUnfolding();
        const unfoldMenu = new BUS_UNFOLD_MENU(busGetter);
        unfoldMenu.SetTool(this);
        unfoldMenu.SetShowTitle();

        this.SetContextMenu(unfoldMenu, CONTEXT_MENU_TRIGGER.CMENU_NOW);

        for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
          if (evt.Action() === TA_CHOICE_MENU_CHOICE) {
            const id = evt.GetCommandId();

            if (id !== undefined && id > 0) net = evt.Parameter<string>();

            break;
          } else if (evt.Action() === TA_CHOICE_MENU_CLOSED) {
            break;
          } else {
            evt.SetPassEvent();
          }
        }
      }

      // Break a wire for the given net out of the bus
      if (net !== '') segment = this.doUnfoldBus(commit, net);

      // If we have an unfolded wire to draw, then draw it
      if (segment) {
        return yield* this.doDrawSegments(aEvent, commit, SCH_LAYER_ID.LAYER_WIRE, false);
      } else {
        this.m_frame!.PopTool(aEvent);
        return 0;
      }
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  private getBusForUnfolding(): SCH_LINE | null {
    const selection = this.m_selectionTool!.RequestSelection([KICAD_T.SCH_ITEM_LOCATE_BUS_T]);
    return selection.Front() as SCH_LINE | null;
  }

  private doUnfoldBus(
    aCommit: SCH_COMMIT,
    aNet: string,
    aPos: VECTOR2I | null = null,
  ): SCH_LINE | null {
    const cfg = this.getModel<SCHEMATIC>()!.Settings();
    const screen = this.m_frame!.GetScreen()!;
    // use the same function as the menu selector, so we choose the same bus segment
    const bus = this.getBusForUnfolding();

    if (bus === null) {
      console.assert(false, `Couldn't find the originating bus line (but had a net: ${aNet} )`);
      return null;
    }

    let pos: VECTOR2I = aPos ?? this.controls().GetCursorPosition();

    // It is possible for the position to be near the bus, but not exactly on it, but
    // we need the bus entry to be on the bus exactly to connect.
    // If the bus segment is H or V, this will be on the selection grid, if it's not,
    // it might not be, but it won't be a broken connection (and the user asked for it!)
    pos = bus.GetSeg().NearestPoint(pos);

    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const entry = new SCH_BUS_WIRE_ENTRY(pos);
    this.m_busUnfold.entry = entry;
    entry.SetParent(screen);
    this.m_frame!.AddToScreen(entry, this.m_frame!.GetScreen());

    const label = new SCH_LABEL(entry.GetEnd(), aNet);
    this.m_busUnfold.label = label;
    label.SetTextSize({ x: cfg.m_DefaultTextSize, y: cfg.m_DefaultTextSize });
    label.SetSpinStyle(busUnfoldPersistentSettings.label_spin_style);
    label.SetParent(this.m_frame!.GetScreen());
    label.SetFlags(IS_NEW | IS_MOVING);

    this.m_busUnfold.in_progress = true;
    this.m_busUnfold.origin = pos;
    this.m_busUnfold.net_name = aNet;

    this.controls().SetCrossHairCursorPosition(entry.GetEnd(), false);

    const endPointsByType: DANGLING_END_ITEM[] = [];

    for (const item of screen.Items().Overlapping(entry.GetBoundingBox()))
      item.GetEndPoints(endPointsByType);

    const endPointsByPos = [...endPointsByType];
    DANGLING_END_ITEM_HELPER.sort_dangling_end_items(endPointsByType, endPointsByPos);
    entry.UpdateDanglingState(endPointsByType, endPointsByPos);
    entry.SetEndDangling(false);
    label.SetIsDangling(false);

    return this.startSegments(aCommit, SCH_LAYER_ID.LAYER_WIRE, entry.GetEnd());
  }

  /** Search for a sheet pin at a location. */
  private getSheetPin(aPosition: VECTOR2I): SCH_SHEET_PIN | null {
    const screen = this.m_frame!.GetScreen()!;

    for (const item of screen.Items().Overlapping(KICAD_T.SCH_SHEET_T, aPosition)) {
      const sheet = item as SCH_SHEET;

      for (const pin of sheet.GetPins()) {
        if (pin.GetPosition().x === aPosition.x && pin.GetPosition().y === aPosition.y) return pin;
      }
    }

    return null;
  }

  /**
   * Compute the middle coordinate for 2 segments from the start point to \a aPosition with the
   * segments kept in the horizontal or vertical axis only.
   */
  private computeBreakPoint(
    aSegments: [SCH_LINE, SCH_LINE],
    aPosition: VECTOR2I,
    mode: LINE_MODE,
    aPosture: boolean,
  ): void {
    const [segment, nextSegment] = aSegments;
    const midPoint: VECTOR2I = { x: 0, y: 0 };

    const delta = {
      x: aPosition.x - segment.GetStartPoint().x,
      y: aPosition.y - segment.GetStartPoint().y,
    };
    const xDir = delta.x > 0 ? 1 : -1;
    const yDir = delta.y > 0 ? 1 : -1;

    let preferHorizontal: boolean;
    let preferVertical: boolean;

    if (mode === LINE_MODE.LINE_MODE_45 && aPosture) {
      preferHorizontal = nextSegment.GetEndPoint().x - nextSegment.GetStartPoint().x !== 0;
      preferVertical = nextSegment.GetEndPoint().y - nextSegment.GetStartPoint().y !== 0;
    } else {
      preferHorizontal = segment.GetEndPoint().x - segment.GetStartPoint().x !== 0;
      preferVertical = segment.GetEndPoint().y - segment.GetStartPoint().y !== 0;
    }

    // Check for times we need to force horizontal sheet pin connections
    const connectedPin = this.getSheetPin(segment.GetStartPoint());
    const force = connectedPin ? connectedPin.GetSide() : SHEET_SIDE.UNDEFINED;

    if (force === SHEET_SIDE.LEFT || force === SHEET_SIDE.RIGHT) {
      if (aPosition.x === connectedPin!.GetPosition().x) {
        // push outside sheet boundary
        const direction = force === SHEET_SIDE.LEFT ? -1 : 1;
        aPosition.x += KiROUND(this.getView()!.GetGAL()!.GetGridSize().x * direction);
      }

      preferHorizontal = true;
      preferVertical = false;
    }

    const breakVertical = (): void => {
      switch (mode) {
        case LINE_MODE.LINE_MODE_45:
          if (!aPosture) {
            midPoint.x = segment.GetStartPoint().x;
            midPoint.y = aPosition.y - yDir * Math.abs(delta.x);
          } else {
            midPoint.x = aPosition.x;
            midPoint.y = segment.GetStartPoint().y + yDir * Math.abs(delta.x);
          }
          break;
        default:
          midPoint.x = segment.GetStartPoint().x;
          midPoint.y = aPosition.y;
      }
    };

    const breakHorizontal = (): void => {
      switch (mode) {
        case LINE_MODE.LINE_MODE_45:
          if (!aPosture) {
            midPoint.x = aPosition.x - xDir * Math.abs(delta.y);
            midPoint.y = segment.GetStartPoint().y;
          } else {
            midPoint.x = segment.GetStartPoint().x + xDir * Math.abs(delta.y);
            midPoint.y = aPosition.y;
          }
          break;
        default:
          midPoint.x = aPosition.x;
          midPoint.y = segment.GetStartPoint().y;
      }
    };

    // Maintain current line shape if we can, e.g. if we were originally moving
    // vertically keep the first segment vertical
    if (preferVertical) breakVertical();
    else if (preferHorizontal) breakHorizontal();

    // Check if our 45 degree angle is one of these shapes
    //    /
    //   /
    //  /
    // /__________
    const deltaMidpoint = {
      x: midPoint.x - segment.GetStartPoint().x,
      y: midPoint.y - segment.GetStartPoint().y,
    };
    const signbit = (v: number) => v < 0 || Object.is(v, -0);

    if (
      mode === LINE_MODE.LINE_MODE_45 &&
      !aPosture &&
      (signbit(deltaMidpoint.x) !== signbit(delta.x) ||
        signbit(deltaMidpoint.y) !== signbit(delta.y))
    ) {
      preferVertical = false;
      preferHorizontal = false;
    } else if (
      mode === LINE_MODE.LINE_MODE_45 &&
      aPosture &&
      (Math.abs(deltaMidpoint.x) > Math.abs(delta.x) ||
        Math.abs(deltaMidpoint.y) > Math.abs(delta.y))
    ) {
      preferVertical = false;
      preferHorizontal = false;
    }

    if (!preferHorizontal && !preferVertical) {
      if (Math.abs(delta.x) < Math.abs(delta.y)) breakVertical();
      else breakHorizontal();
    }

    segment.SetEndPoint({ ...midPoint });
    nextSegment.SetStartPoint({ ...midPoint });
    nextSegment.SetEndPoint({ ...aPosition });
  }

  private *doDrawSegments(
    aTool: TOOL_EVENT,
    aCommit: SCH_COMMIT,
    aTypeIn: number,
    aQuitOnDraw: boolean,
  ): COROUTINE_BODY<number> {
    let aType = aTypeIn;
    const screen = this.m_frame!.GetScreen()!;
    let segment: SCH_LINE | null = null;
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const gridType =
      aType === SCH_LAYER_ID.LAYER_NOTES
        ? GRID_HELPER_GRIDS.GRID_GRAPHICS
        : GRID_HELPER_GRIDS.GRID_WIRES;
    const controls = this.controls();
    let lastMode = this.m_frame!.eeconfig()!.drawing.line_mode as LINE_MODE;

    const setCursor = (): void => {
      if (aType === SCH_LAYER_ID.LAYER_WIRE)
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.LINE_WIRE);
      else if (aType === SCH_LAYER_ID.LAYER_BUS)
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.LINE_BUS);
      else if (aType === SCH_LAYER_ID.LAYER_NOTES)
        this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.LINE_GRAPHIC);
      else this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.LINE_WIRE);
    };

    const cleanup = (): void => {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_wires = [];
      segment = null;

      if (this.m_busUnfold.entry) this.m_frame!.RemoveFromScreen(this.m_busUnfold.entry, screen);

      if (this.m_busUnfold.label && !this.m_busUnfold.label_placed)
        this.m_selectionTool!.RemoveItemFromSel(this.m_busUnfold.label, true);

      if (this.m_busUnfold.label && this.m_busUnfold.label_placed)
        this.m_frame!.RemoveFromScreen(this.m_busUnfold.label, screen);

      this.m_busUnfold = emptyBusUnfold();

      this.m_view!.ClearPreview();
      this.m_view!.ShowPreview(false);
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    // Set initial cursor
    setCursor();

    // Add the new label to the selection so the rotate command operates on it
    if (this.m_busUnfold.label) this.m_selectionTool!.AddItemToSel(this.m_busUnfold.label, true);

    // Continue the existing wires if we've started (usually by immediate action preference)
    if (this.m_wires.length > 0) segment = this.m_wires[this.m_wires.length - 1]!;

    let contextMenuPos: VECTOR2I = { x: 0, y: 0 };

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      const currentMode = this.m_frame!.eeconfig()!.drawing.line_mode as LINE_MODE;
      const twoSegments = currentMode !== LINE_MODE.LINE_MODE_FREE;

      // The tool hotkey is interpreted as a click when drawing
      const isSyntheticClick =
        (!!segment || this.m_busUnfold.in_progress) &&
        evt.IsActivate() &&
        evt.HasPosition() &&
        evt.Matches(aTool);

      setCursor();
      grid.SetMask(ANCHOR_FLAGS.ALL);
      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

      if (segment) {
        if (segment.GetStartPoint().x === segment.GetEndPoint().x)
          grid.ClearMaskFlag(ANCHOR_FLAGS.VERTICAL);

        if (segment.GetStartPoint().y === segment.GetEndPoint().y)
          grid.ClearMaskFlag(ANCHOR_FLAGS.HORIZONTAL);
      }

      const eventPosition = evt.HasPosition() ? evt.Position() : controls.GetMousePosition();

      let cursorPos = grid.BestSnapAnchor(eventPosition, gridType, segment);
      controls.ForceCursorPosition(true, cursorPos);

      // Need to handle change in H/V mode while drawing
      if (currentMode !== lastMode) {
        // Need to delete extra segment if we have one
        if (segment && currentMode === LINE_MODE.LINE_MODE_FREE && this.m_wires.length >= 2) {
          this.m_wires.pop();
          this.m_selectionTool!.RemoveItemFromSel(segment);

          segment = this.m_wires[this.m_wires.length - 1]!;
          segment.SetEndPoint(cursorPos);
        }
        // Add a segment so we can move orthogonally/45
        else if (segment && lastMode === LINE_MODE.LINE_MODE_FREE) {
          segment.SetEndPoint(cursorPos);

          // Create a new segment, and chain it after the current segment.
          segment = segment.Duplicate(true, aCommit) as SCH_LINE;
          segment.SetFlags(IS_NEW | IS_MOVING);
          segment.SetStartPoint(cursorPos);
          this.m_wires.push(segment);

          this.m_selectionTool!.AddItemToSel(segment, true /*quiet mode*/);
        }

        lastMode = currentMode;
      }

      //------------------------------------------------------------------------
      // Handle cancel:
      //
      if (evt.IsCancelInteractive()) {
        this.m_frame!.GetInfoBar()?.Dismiss();

        if (segment || this.m_busUnfold.in_progress) {
          cleanup();

          if (aQuitOnDraw) {
            this.m_frame!.PopTool(aTool);
            break;
          }
        } else {
          this.m_frame!.PopTool(aTool);
          break;
        }
      } else if (evt.IsActivate() && !isSyntheticClick) {
        if (segment || this.m_busUnfold.in_progress) {
          this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel drawing.');
          evt.SetPassEvent(false);
          continue;
        }

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          this.m_frame!.PopTool(aTool);
          break;
        }
      }
      //------------------------------------------------------------------------
      // Handle finish:
      //
      else if (evt.IsAction(ACTIONS.finishInteractive)) {
        if (segment || this.m_busUnfold.in_progress) {
          this.finishSegments(aCommit);
          segment = null;

          aCommit.Push('Draw Wires');

          if (aQuitOnDraw) {
            this.m_frame!.PopTool(aTool);
            break;
          }
        }
      }
      //------------------------------------------------------------------------
      // Handle click:
      //
      else if (evt.IsClick(BUT_LEFT) || (segment && evt.IsDblClick(BUT_LEFT)) || isSyntheticClick) {
        // First click when unfolding places the label and wire-to-bus entry
        if (this.m_busUnfold.in_progress && !this.m_busUnfold.label_placed) {
          console.assert(aType === SCH_LAYER_ID.LAYER_WIRE);

          this.m_frame!.AddToScreen(this.m_busUnfold.label!, screen);
          this.m_selectionTool!.RemoveItemFromSel(this.m_busUnfold.label!, true);
          this.m_busUnfold.label_placed = true;
        }

        if (!segment) {
          segment = this.startSegments(aCommit, aType, cursorPos);
        }
        // Create a new segment if we're out of previously-created ones
        else if (
          !segment.IsNull() ||
          (twoSegments && !this.m_wires[this.m_wires.length - 2]!.IsNull())
        ) {
          // Terminate the command if the end point is on a pin, junction, label, or another
          // wire or bus.
          if (screen.IsTerminalPoint(cursorPos, segment.GetLayer())) {
            this.finishSegments(aCommit);
            segment = null;

            aCommit.Push('Draw Wires');

            if (aQuitOnDraw) {
              this.m_frame!.PopTool(aTool);
              break;
            }
          } else {
            let placedSegments = 1;

            // When placing lines with the forty-five degree end, the user is
            // targetting the endpoint with the angled portion, so it's more
            // intuitive to place both segments at the same time.
            if (currentMode === LINE_MODE.LINE_MODE_45) placedSegments++;

            segment.SetEndPoint(cursorPos);

            for (let i = 0; i < placedSegments; i++) {
              // Create a new segment, and chain it after the current segment.
              segment = segment!.Duplicate(true, aCommit) as SCH_LINE;
              segment.SetFlags(IS_NEW | IS_MOVING);
              segment.SetStartPoint(cursorPos);
              this.m_wires.push(segment);

              this.m_selectionTool!.AddItemToSel(segment, true /*quiet mode*/);
            }
          }
        }

        if (evt.IsDblClick(BUT_LEFT) && segment) {
          if (twoSegments && this.m_wires.length >= 2) {
            this.computeBreakPoint(
              [this.m_wires[this.m_wires.length - 2]!, segment],
              cursorPos,
              currentMode,
              posture,
            );
          }

          this.finishSegments(aCommit);
          segment = null;

          aCommit.Push('Draw Wires');

          if (aQuitOnDraw) {
            this.m_frame!.PopTool(aTool);
            break;
          }
        }
      }
      //------------------------------------------------------------------------
      // Handle motion:
      //
      else if (evt.IsMotion() || evt.IsAction(ACTIONS.refreshPreview)) {
        this.m_view!.ClearPreview();

        // Update the bus unfold posture based on the mouse movement
        if (this.m_busUnfold.in_progress && !this.m_busUnfold.label_placed) {
          const cursor_delta = {
            x: cursorPos.x - this.m_busUnfold.origin.x,
            y: cursorPos.y - this.m_busUnfold.origin.y,
          };
          const entry = this.m_busUnfold.entry!;

          const flipX = cursor_delta.x < 0;
          const flipY = cursor_delta.y < 0;

          // Erase and redraw if necessary
          if (flipX !== this.m_busUnfold.flipX || flipY !== this.m_busUnfold.flipY) {
            const size = { ...entry.GetSize() };
            const ySign = flipY ? -1 : 1;
            const xSign = flipX ? -1 : 1;

            size.x = Math.abs(size.x) * xSign;
            size.y = Math.abs(size.y) * ySign;
            entry.SetSize(size);

            this.m_busUnfold.flipY = flipY;
            this.m_busUnfold.flipX = flipX;

            this.m_frame!.UpdateItem(entry, false, true);
            this.m_wires[0]!.SetStartPoint(entry.GetEnd());
          }

          // Update the label "ghost" position
          this.m_busUnfold.label!.SetPosition(cursorPos);
          this.m_view!.AddToPreview(this.m_busUnfold.label!.Clone());

          // Ensure segment is non-null at the start of bus unfold
          if (!segment) segment = this.m_wires[this.m_wires.length - 1]!;
        }

        if (segment) {
          // Coerce the line to vertical/horizontal/45 as necessary
          if (twoSegments && this.m_wires.length >= 2) {
            this.computeBreakPoint(
              [this.m_wires[this.m_wires.length - 2]!, segment],
              cursorPos,
              currentMode,
              posture,
            );
          } else {
            segment.SetEndPoint(cursorPos);
          }
        }

        for (const wire of this.m_wires) {
          if (!wire.IsNull()) this.m_view!.AddToPreview(wire.Clone());
        }

        const previewItems: SCH_ITEM[] = [];

        for (const wire of this.m_wires) {
          if (!wire.IsNull()) previewItems.push(wire);
        }

        if (this.m_busUnfold.entry) previewItems.push(this.m_busUnfold.entry);

        for (const jct of PreviewJunctions(this.m_frame!.GetScreen()!, previewItems))
          this.m_view!.AddToPreview(jct, true);
      } else if (
        evt.IsAction(SCH_ACTIONS.undoLastSegment) ||
        evt.IsAction(ACTIONS.doDelete) ||
        evt.IsAction(ACTIONS.undo)
      ) {
        // ( LINE_MODE::LINE_MODE_90 && m_wires.size() > 2 ): the C++ tests the constant, not
        // currentMode, so any mode undoes with more than two segments.
        if (
          (currentMode === LINE_MODE.LINE_MODE_FREE && this.m_wires.length > 1) ||
          (LINE_MODE.LINE_MODE_90 && this.m_wires.length > 2)
        ) {
          this.m_view!.ClearPreview();

          this.m_wires.pop();
          this.m_selectionTool!.RemoveItemFromSel(segment!);

          segment = this.m_wires[this.m_wires.length - 1]!;
          cursorPos = segment.GetEndPoint();
          this.controls().WarpMouseCursor(cursorPos, true);

          // Find new bend point for current mode
          if (twoSegments && this.m_wires.length >= 2) {
            this.computeBreakPoint(
              [this.m_wires[this.m_wires.length - 2]!, segment],
              cursorPos,
              currentMode,
              posture,
            );
          } else {
            segment.SetEndPoint(cursorPos);
          }

          for (const wire of this.m_wires) {
            if (!wire.IsNull()) this.m_view!.AddToPreview(wire.Clone());
          }
        } else if (evt.IsAction(ACTIONS.undo)) {
          // Dispatch as normal undo event
          evt.SetPassEvent();
        } else {
          wxBell();
        }
      } else if (evt.IsAction(SCH_ACTIONS.switchSegmentPosture) && this.m_wires.length >= 2) {
        posture = !posture;

        // The 90 degree mode doesn't have a forced posture like
        // the 45 degree mode and computeBreakPoint maintains existing 90s' postures.
        // Instead, just swap the 90 angle here.
        if (currentMode === LINE_MODE.LINE_MODE_90) {
          this.m_view!.ClearPreview();

          const line2 = this.m_wires[this.m_wires.length - 1]!;
          const line1 = this.m_wires[this.m_wires.length - 2]!;

          const delta2 = {
            x: line2.GetEndPoint().x - line2.GetStartPoint().x,
            y: line2.GetEndPoint().y - line2.GetStartPoint().y,
          };
          const delta1 = {
            x: line1.GetEndPoint().x - line1.GetStartPoint().x,
            y: line1.GetEndPoint().y - line1.GetStartPoint().y,
          };

          line2.SetStartPoint({
            x: line2.GetEndPoint().x - delta1.x,
            y: line2.GetEndPoint().y - delta1.y,
          });
          line1.SetEndPoint({
            x: line1.GetStartPoint().x + delta2.x,
            y: line1.GetStartPoint().y + delta2.y,
          });

          for (const wire of this.m_wires) {
            if (!wire.IsNull()) this.m_view!.AddToPreview(wire.Clone());
          }
        } else {
          this.computeBreakPoint(
            [this.m_wires[this.m_wires.length - 2]!, segment!],
            cursorPos,
            currentMode,
            posture,
          );

          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
        }
      }
      //------------------------------------------------------------------------
      // Handle context menu:
      //
      else if (evt.IsClick(BUT_RIGHT)) {
        // Warp after context menu only if dragging...
        if (!segment) this.m_toolMgr!.VetoContextMenuMouseWarp();

        contextMenuPos = cursorPos;
        this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
      } else if (evt.Category() === TC_COMMAND && evt.Action() === TA_CHOICE_MENU_CHOICE) {
        const id = evt.GetCommandId() ?? -1;

        if (
          id >= id_eeschema_frm.ID_POPUP_SCH_UNFOLD_BUS &&
          id <= id_eeschema_frm.ID_POPUP_SCH_UNFOLD_BUS_END
        ) {
          console.assert(!segment, 'Bus unfold event received when already drawing!');

          aType = SCH_LAYER_ID.LAYER_WIRE;
          const net = evt.Parameter<string>();
          segment = this.doUnfoldBus(aCommit, net, contextMenuPos);
        }
      }
      //------------------------------------------------------------------------
      // Handle TOOL_ACTION special cases
      //
      else if (evt.IsAction(SCH_ACTIONS.rotateCW) || evt.IsAction(SCH_ACTIONS.rotateCCW)) {
        if (this.m_busUnfold.in_progress) {
          this.m_busUnfold.label!.Rotate90(evt.IsAction(SCH_ACTIONS.rotateCW));
          busUnfoldPersistentSettings.label_spin_style = this.m_busUnfold.label!.GetSpinStyle();

          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
        } else {
          wxBell();
        }
      } else if (evt.IsAction(ACTIONS.redo)) {
        wxBell();
      } else {
        evt.SetPassEvent();
      }

      // Enable autopanning and cursor capture only when there is a segment to be placed
      controls.SetAutoPan(segment !== null);
      controls.CaptureCursor(segment !== null);
    }

    controls.SetAutoPan(false);
    controls.CaptureCursor(false);
    this.m_frame!.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    controls.ForceCursorPosition(false);
    return 0;
  }

  private startSegments(
    aCommit: SCH_COMMIT,
    aType: number,
    aPos: VECTOR2D,
    aSegmentIn: SCH_LINE | null = null,
  ): SCH_LINE {
    let aSegment = aSegmentIn;
    const pos = { x: KiROUND(aPos.x), y: KiROUND(aPos.y) };

    if (!aSegment) aSegment = this.m_frame!.GetScreen()!.GetLine(pos, 0, aType);

    if (!aSegment) {
      switch (aType) {
        case SCH_LAYER_ID.LAYER_WIRE:
          aSegment = new SCH_LINE(pos, SCH_LAYER_ID.LAYER_WIRE);
          break;
        case SCH_LAYER_ID.LAYER_BUS:
          aSegment = new SCH_LINE(pos, SCH_LAYER_ID.LAYER_BUS);
          break;
        default:
          aSegment = new SCH_LINE(pos, SCH_LAYER_ID.LAYER_NOTES);
          break;
      }

      // Give segments a parent so they find the default line/wire/bus widths
      aSegment.SetParent(this.m_frame!.Schematic());
    } else {
      aSegment = aSegment.Duplicate(true, aCommit) as SCH_LINE;
      aSegment.SetStartPoint(pos);
    }

    aSegment.SetFlags(IS_NEW | IS_MOVING);
    this.m_wires.push(aSegment);

    this.m_selectionTool!.AddItemToSel(aSegment, true /*quiet mode*/);

    // We need 2 segments to go from a given start pin to an end point when the
    // horizontal and vertical lines only switch is on.
    if (this.m_frame!.eeconfig()!.drawing.line_mode) {
      aSegment = aSegment.Duplicate(true, aCommit) as SCH_LINE;
      aSegment.SetFlags(IS_NEW | IS_MOVING);
      this.m_wires.push(aSegment);

      this.m_selectionTool!.AddItemToSel(aSegment, true /*quiet mode*/);
    }

    return aSegment;
  }

  /**
   * In a contiguous list of wires, remove wires that backtrack over the previous
   * wire. Example:
   *
   * Wire is added:
   * ---------------------------------------->
   *
   * A second wire backtracks over it:
   * -------------------<====================>
   *
   * simplifyWireList is called:
   * ------------------->
   */
  private simplifyWireList(): void {
    for (let it = 0; it < this.m_wires.length; ) {
      const line = this.m_wires[it]!;

      if (line.IsNull()) {
        this.m_wires.splice(it, 1);
        continue;
      }

      const next_it = it + 1;

      if (next_it === this.m_wires.length) break;

      const next_line = this.m_wires[next_it]!;
      const merged = line.MergeOverlap(this.m_frame!.GetScreen(), next_line, false);

      if (merged) {
        this.m_wires.splice(it, 1);
        this.m_wires[it] = merged;
      }

      ++it;
    }
  }

  private finishSegments(aCommit: SCH_COMMIT): void {
    // Clear selection when done so that a new wire can be started.
    // NOTE: this must be done before simplifyWireList is called or we might end up with
    // freed selected items.
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const screen = this.m_frame!.GetScreen()!;

    // Remove segments backtracking over others
    this.simplifyWireList();

    // Collect the possible connection points for the new lines
    const connections = screen.GetConnections();
    const new_ends: VECTOR2I[] = [];

    // Check each new segment for possible junctions and add/split if needed
    for (const wire of this.m_wires) {
      if (wire.HasFlag(SKIP_STRUCT)) continue;

      const tmpends = wire.GetConnectionPoints();

      new_ends.push(...tmpends);

      for (const pt of connections) {
        if (IsPointOnSegment(wire.GetStartPoint(), wire.GetEndPoint(), pt)) new_ends.push(pt);
      }

      aCommit.Added(wire, screen);
    }

    if (this.m_busUnfold.in_progress && this.m_busUnfold.label_placed) {
      console.assert(!!this.m_busUnfold.entry && !!this.m_busUnfold.label);

      aCommit.Added(this.m_busUnfold.entry!, screen);
      this.m_frame!.SaveCopyForRepeatItem(this.m_busUnfold.entry!);

      aCommit.Added(this.m_busUnfold.label!, screen);
      this.m_frame!.AddCopyForRepeatItem(this.m_busUnfold.label!);
      this.m_busUnfold.label!.ClearEditFlags();

      if (this.m_wires.length > 0) this.m_frame!.AddCopyForRepeatItem(this.m_wires[0]!);
    } else if (this.m_wires.length > 0) {
      this.m_frame!.SaveCopyForRepeatItem(this.m_wires[0]!);
    }

    for (let ii = 1; ii < this.m_wires.length; ++ii)
      this.m_frame!.AddCopyForRepeatItem(this.m_wires[ii]!);

    // Add the new wires
    for (const wire of this.m_wires) {
      wire.ClearFlags(IS_NEW | IS_MOVING);
      this.m_frame!.AddToScreen(wire, screen);
    }

    this.m_wires = [];
    this.m_view!.ClearPreview();
    this.m_view!.ShowPreview(false);

    this.controls().CaptureCursor(false);
    this.controls().SetAutoPan(false);

    // Correct and remove segments that need to be merged.
    this.m_frame!.Schematic().CleanUp(aCommit);

    const symbols: SCH_ITEM[] = [
      ...this.m_frame!.GetScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T),
    ];

    for (const symbol of symbols) {
      const pts = symbol.GetConnectionPoints();

      if (pts.length > 2) continue;

      for (let pt = 0; pt < pts.length; pt++) {
        for (let secondPt = pt + 1; secondPt < pts.length; secondPt++)
          this.m_frame!.TrimWire(aCommit, pts[pt]!, pts[secondPt]!);
      }
    }

    for (const pt of new_ends) {
      if (this.m_frame!.GetScreen()!.IsExplicitJunctionNeeded(pt))
        this.AddJunction(aCommit, this.m_frame!.GetScreen()!, pt);
    }

    if (this.m_busUnfold.in_progress) this.m_busUnfold = emptyBusUnfold();

    for (const item of this.m_frame!.GetScreen()!.Items()) item.ClearEditFlags();
  }

  /**
   * Logic to remove wires when overlapping correct items: a wire that a non-wire item of the
   * selection meets at exactly two points loses the stretch between them.
   */
  TrimOverLappingWires(aCommit: SCH_COMMIT, aSelection: SCH_SELECTION): number {
    const sch = this.getModel<SCHEMATIC>()!;
    const screen = sch.CurrentSheet().LastScreen()!;

    const lines = new Set<SCH_LINE>();
    const bb = aSelection.GetBoundingBox();

    for (const item of screen.Items().Overlapping(KICAD_T.SCH_LINE_T, bb))
      lines.add(item as SCH_LINE);

    for (let ii = 0; ii < aSelection.GetSize(); ii++) {
      const item = aSelection.at(ii) instanceof SCH_ITEM ? (aSelection.at(ii) as SCH_ITEM) : null;

      if (!item || !item.IsConnectable() || item.Type() === KICAD_T.SCH_LINE_T) continue;

      const pts = item.GetConnectionPoints();

      /// If the line intersects with an item in the selection at only two points,
      /// then we can remove the line between the two points.
      for (const line of lines) {
        const conn_pts: VECTOR2I[] = [];

        for (const pt of pts) {
          if (IsPointOnSegment(line.GetStartPoint(), line.GetEndPoint(), pt)) conn_pts.push(pt);

          if (conn_pts.length > 2) break;
        }

        if (conn_pts.length === 2) this.m_frame!.TrimWire(aCommit, conn_pts[0]!, conn_pts[1]!);
      }
    }

    return 0;
  }

  /** Handle the addition of junctions to a selection of objects. */
  AddJunctionsIfNeeded(aCommit: SCH_COMMIT, aSelection: SCH_SELECTION): number {
    const screen = this.m_frame!.GetScreen()!;
    const allItems: EDA_ITEM[] = [];

    for (const item of aSelection.Items()) {
      allItems.push(item);

      if (item.Type() === KICAD_T.SCH_GROUP_T) {
        (item as SCH_GROUP).RunOnChildren((child: SCH_ITEM) => {
          allItems.push(child);
        }, RECURSE_MODE.RECURSE);
      }
    }

    for (const point of screen.GetNeededJunctions(allItems))
      this.AddJunction(aCommit, screen, point);

    return 0;
  }

  /**
   * Break a single segment into two at the specified point. The new segment is returned through
   * \a aNewSegment.
   */
  BreakSegment(
    aCommit: SCH_COMMIT,
    aSegment: SCH_LINE,
    aPoint: VECTOR2I,
    aNewSegment: { value: SCH_LINE | null },
    aScreen: SCH_SCREEN,
  ): void {
    // Save the copy of aSegment before breaking it
    aCommit.Modify(aSegment, aScreen);

    const newSegment = aSegment.BreakAt(aCommit, aPoint);

    aSegment.SetFlags(IS_CHANGED | IS_BROKEN);
    newSegment.SetFlags(IS_NEW | IS_BROKEN);
    this.m_frame!.AddToScreen(newSegment, aScreen);

    aCommit.Added(newSegment, aScreen);

    aNewSegment.value = newSegment;
  }

  /** Check every wire and bus for a intersection at \a aPoint and break into two segments. */
  BreakSegments(aCommit: SCH_COMMIT, aPos: VECTOR2I, aScreen: SCH_SCREEN): boolean {
    let brokenSegments = false;
    const new_line: { value: SCH_LINE | null } = { value: null };

    for (const wire of aScreen.GetBusesAndWires(aPos, true)) {
      this.BreakSegment(aCommit, wire, aPos, new_line, aScreen);
      brokenSegments = true;
    }

    return brokenSegments;
  }

  /** Test all junctions and bus entries in the schematic for intersections with wires and buses. */
  BreakSegmentsOnJunctions(aCommit: SCH_COMMIT, aScreen: SCH_SCREEN): boolean {
    let brokenSegments = false;

    // std::set<VECTOR2I>: std::less<VECTOR2I> orders x then y (vector2.cpp)
    const point_set = new Map<string, VECTOR2I>();
    const add = (p: VECTOR2I) => point_set.set(`${p.x},${p.y}`, p);

    for (const item of aScreen.Items().OfType(KICAD_T.SCH_JUNCTION_T)) add(item.GetPosition());

    for (const item of aScreen.Items().OfType(KICAD_T.SCH_BUS_WIRE_ENTRY_T)) {
      const entry = item as SCH_BUS_WIRE_ENTRY;
      add(entry.GetPosition());
      add(entry.GetEnd());
    }

    const ordered = [...point_set.values()].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

    for (const pt of ordered) {
      this.BreakSegments(aCommit, pt, aScreen);
      brokenSegments = true;
    }

    return brokenSegments;
  }

  /** A junction at \a aPos, breaking the wires and buses through it. */
  AddJunction(aCommit: SCH_COMMIT, aScreen: SCH_SCREEN, aPos: VECTOR2I): SCH_JUNCTION {
    const junction = new SCH_JUNCTION(aPos);

    if (aScreen.GetBus(aPos)) junction.SetLayer(SCH_LAYER_ID.LAYER_BUS_JUNCTION);

    this.m_frame!.AddToScreen(junction, aScreen);
    aCommit.Added(junction, aScreen);

    this.BreakSegments(aCommit, aPos, aScreen);

    return junction;
  }

  /** `getViewControls()`, with the VIEW_CONTROLS methods the TOOL_MANAGER's interface leaves out. */
  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  protected override setTransitions(): void {
    this.Go(this.DrawSegments, SCH_ACTIONS.drawWire.MakeEvent());
    this.Go(this.DrawSegments, SCH_ACTIONS.drawBus.MakeEvent());
    this.Go(this.DrawSegments, SCH_ACTIONS.drawLines.MakeEvent());

    this.Go(this.UnfoldBus, SCH_ACTIONS.unfoldBus.MakeEvent());
  }
}
