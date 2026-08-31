// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GetMsgPanelInfo` for every board item, and `PCB_CONTROL::UpdateMessagePanel`
 * which chooses between them.
 *
 * Counterparts, one per section below:
 *   - `BOARD::GetMsgPanelInfo`            pcbnew/board.cpp:2285
 *   - `FOOTPRINT::GetMsgPanelInfo`        pcbnew/footprint.cpp:2131
 *   - `PAD::GetMsgPanelInfo`              pcbnew/pad.cpp:1886
 *   - `PCB_TRACK::GetMsgPanelInfo`        pcbnew/pcb_track.cpp:2329
 *   - `PCB_VIA::GetMsgPanelInfo`          pcbnew/pcb_track.cpp:2427
 *   - `ZONE::GetMsgPanelInfo`             pcbnew/zone.cpp:929
 *   - `PCB_TEXT::GetMsgPanelInfo`         pcbnew/pcb_text.cpp:296
 *   - `PCB_SHAPE::GetMsgPanelInfo`        pcbnew/pcb_shape.cpp:699
 *     + `EDA_SHAPE::ShapeGetMsgPanelInfo` common/eda_shape.cpp:1289
 *     + `STROKE_PARAMS::GetMsgPanelInfo`  common/stroke_params.cpp:276
 *   - `PCB_CONTROL::UpdateMessagePanel`   pcbnew/tools/pcb_control.cpp:2377
 *
 * **Why this is one module in `pcbnew/` and not a `useMemo` in the editor.**
 * Upstream every one of these is a virtual on the item, so the board editor,
 * the footprint editor, the footprint viewer, the router and cross-probing all
 * get the same rows without any of them owning a row list. We had the list
 * inline in `PcbEditor.tsx`, which is why the footprint editor could not share
 * it and why the rows drifted: pcbnew shows a pad's shape as "Rounded
 * rectangle" and its attribute as "Conn", ours printed "Roundrect" and
 * "Connector"; pcbnew counts a board's nets by walking the netcodes its tracks
 * and pads actually use, ours took `nets.size - 1`.
 *
 * **Every value goes through `MessageTextFromValue` with its unit label.**
 * `UNITS_PROVIDER::MessageTextFromValue` defaults `aAddUnitLabel` to true
 * (`include/units_provider.h:127`) and no `GetMsgPanelInfo` overrides it, which
 * is the whole reason upstream's rows read `0.25 mm` and ours read `0.25`.
 *
 * ## Rows that need machinery we have not wired to the panel yet
 *
 * These are stated here rather than approximated, because a row with a wrong
 * number is worse than a row that is not there:
 *
 *   - `Routed Length` / `Pad To Die Length` / `Full Length` and the delay
 *     equivalents (`pcb_track.cpp:2364-2402`) need `BOARD::GetTrackLength`,
 *     the connectivity walk over the whole net.
 *   - `Copper Area` (`:2404-2407`) needs `TransformShapeToPolySet`, which we
 *     have no port of.
 *   - `Min Clearance` / `Min Annular Width` / `Width Constraints` /
 *     `DP Gap Constraints` (`:2409-2422`, `pad.cpp:2003-2012`,
 *     `zone.cpp:1027-1035`, `pcb_control.cpp:2443-2596`) need the DRC engine's
 *     `GetCachedOwnClearance`, which resolves a rule *and* names its source.
 *     `drc/drc_rules_engine.ts` can answer both, but nothing hands the panel a
 *     built engine yet.
 *   - `Component Class` (`footprint.cpp:2205-2209`) — we have no component
 *     classes at all.
 *   - `Selected 2D Length` / `Selected 2D … Area` on a multi-selection
 *     (`pcb_control.cpp:2712-2863`) — same two gaps as above.
 *
 * Each is left out of the list, never replaced by something else.
 */

import {
  messageTextFromAngle,
  messageTextFromValue,
  pcbIUScale,
  type EdaDataType,
  type EdaUnits,
  formatG,
  unescapeString,
} from '@ziroeda/common';
import { type BoardItemRef, parseBoardItemId } from './edit-board.js';
import { GetLayerName } from './layer_ids.js';
import type {
  Board,
  PcbArcTrack,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbTrack,
  PcbVia,
  PcbZone,
} from './types.js';

/** One `MSG_PANEL_ITEM` (include/widgets/msgpanel.h): the label row and the value row. */
export interface MsgPanelItem {
  /** `m_UpperText`. */
  upper: string;
  /** `m_LowerText`. */
  lower: string;
}

/**
 * Which frame is asking. `GetMsgPanelInfo` branches on
 * `aFrame->GetName() == PCB_EDIT_FRAME_NAME` in five places and on
 * `aFrame->IsType( FRAME_FOOTPRINT_… )` in `FOOTPRINT::GetMsgPanelInfo`, so
 * the rows a footprint editor shows are genuinely a different list, not a
 * subset.
 */
export type PcbMsgPanelFrame =
  | 'pcb_edit'
  | 'footprint_edit'
  | 'footprint_viewer'
  /**
   * FRAME_CVPCB_DISPLAY — CVPCB's footprint viewer.
   *
   * It reads the BOARD EDITOR's rows, not the viewer's.
   * `FOOTPRINT::GetMsgPanelInfo`'s early return names three frame types and
   * this is not one of them:
   *
   *     if( aFrame->IsType( FRAME_FOOTPRINT_VIEWER )
   *         || aFrame->IsType( FRAME_FOOTPRINT_CHOOSER )
   *         || aFrame->IsType( FRAME_FOOTPRINT_EDITOR ) )
   *                                            pcbnew/footprint.cpp:2143-2159
   *
   * so DISPLAY_FOOTPRINTS_FRAME falls through to Rotation / Status /
   * Attributes / Footprint / 3D-Shape, which is what a real cvpcb viewer
   * shows. Reading the branch as "anything that is not the board editor is a
   * viewer" gets this one frame backwards.
   */
  | 'cvpcb_display';

/**
 * The frames `FOOTPRINT::GetMsgPanelInfo` returns the short list for
 * (`pcbnew/footprint.cpp:2143-2146`). Named as a set rather than tested by
 * negation so a frame added later has to say which side it is on.
 */
const FOOTPRINT_ONLY_FRAMES: ReadonlySet<PcbMsgPanelFrame> = new Set<PcbMsgPanelFrame>([
  'footprint_edit',
  'footprint_viewer',
]);

/** What the row builders need from the frame, in the shape upstream reads it. */
export interface PcbMsgPanelContext {
  board: Board;
  /** The frame's display units — `UNITS_PROVIDER::GetUserUnits()`. */
  units: EdaUnits;
  frame: PcbMsgPanelFrame;
  /**
   * `BOARD_CONNECTED_ITEM::GetEffectiveNetClass()->GetHumanReadableName()`,
   * by net code. A net with no entry resolves to `Default`, which is what
   * `NETCLASS::Default` is called.
   */
  netClassOf?: ReadonlyMap<number, string>;
  /**
   * `GetConnectivity()->GetUnconnectedCount( true )`, for the `Unrouted` row.
   * The connectivity engine lives in the editor, so the count is handed in the
   * way `BOARD::GetMsgPanelInfo` reads it off the board's.
   */
  unconnectedCount?: number;
}

const DEFAULT_NETCLASS = 'Default';

/** `UNITS_PROVIDER::MessageTextFromValue`, with the unit label upstream leaves on. */
function fmt(ctx: PcbMsgPanelContext, iu: number, type: EdaDataType = 'distance'): string {
  return messageTextFromValue(pcbIUScale, ctx.units, iu, true, type);
}

function netName(ctx: PcbMsgPanelContext, code: number | undefined): string {
  return unescapeString(ctx.board.nets.get(code ?? 0) ?? '');
}

function netClass(ctx: PcbMsgPanelContext, code: number | undefined): string {
  return unescapeString(ctx.netClassOf?.get(code ?? 0) ?? DEFAULT_NETCLASS);
}

const layerName = (ctx: PcbMsgPanelContext, layer: string): string =>
  GetLayerName(ctx.board.layers, layer);

// ---------------------------------------------------------------------------
// BOARD_ITEM::LayerMaskDescribe (pcbnew/board_item.cpp:210)
// ---------------------------------------------------------------------------

const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);

/**
 * `LSET::AllTechMask()` = `BackTechMask() | FrontTechMask()`
 * (common/lset.cpp:648-680) — silkscreen, mask, adhesive, paste, courtyard
 * and fab, both sides. **Data**, from those two sets.
 */
const TECH_LAYERS = [
  'F.SilkS',
  'B.SilkS',
  'F.Mask',
  'B.Mask',
  'F.Adhes',
  'B.Adhes',
  'F.Paste',
  'B.Paste',
  'F.CrtYd',
  'B.CrtYd',
  'F.Fab',
  'B.Fab',
];

/**
 * `PCB_LAYER_ID`'s own values (include/layer_ids.h:64-118), which is the order
 * `LayerMaskDescribe` walks — it loops `bit` from `PCBNEW_LAYER_ID_START`
 * upwards and returns the first set one.
 *
 * **Data**, and it is not the order the `.kicad_pcb` `(layers …)` block uses:
 * the file writes the legacy ordinals (`39 "F.Mask"`), where the enum has
 * `F_Mask = 1`. Sorting by `PcbLayerDef.id` would put B.Adhesive first where
 * KiCad puts F.Mask, so the id in the file cannot stand in for this.
 */
const PCB_LAYER_ID_VALUE: Readonly<Record<string, number>> = {
  'F.Cu': 0,
  'F.Mask': 1,
  'B.Cu': 2,
  'B.Mask': 3,
  'F.SilkS': 5,
  'B.SilkS': 7,
  'F.Adhes': 9,
  'B.Adhes': 11,
  'F.Paste': 13,
  'B.Paste': 15,
  'Dwgs.User': 17,
  'Cmts.User': 19,
  'Eco1.User': 21,
  'Eco2.User': 23,
  'Edge.Cuts': 25,
  Margin: 27,
  'B.CrtYd': 29,
  'F.CrtYd': 31,
  'B.Fab': 33,
  'F.Fab': 35,
  Rescue: 37,
};

/** `In<n>.Cu = 2 + 2n` (layer_ids.h:66-95); everything else is a User.<n>. */
function layerIdValue(layer: string): number {
  const known = PCB_LAYER_ID_VALUE[layer];
  if (known !== undefined) return known;

  const inner = /^In(\d+)\.Cu$/.exec(layer);
  if (inner) return 2 + 2 * Number(inner[1]);

  const user = /^User\.(\d+)$/.exec(layer);
  if (user) return 37 + 2 * Number(user[1]);

  return Number.MAX_SAFE_INTEGER;
}

const byLayerId = (a: string, b: string): number => layerIdValue(a) - layerIdValue(b);

/** The copper layers a board has enabled, in stack order. */
function boardCopperLayers(board: Board): string[] {
  return board.layers.map((l) => l.name).filter(isCopper);
}

/**
 * `(layers "*.Cu" "*.Mask")` and friends: a pad's layer list may be a wildcard,
 * which `LSET` stores expanded. Expanding here keeps the describe below reading
 * like the C++, which works on an already-expanded LSET.
 */
function expandLayers(board: Board, layers: readonly string[]): string[] {
  const out: string[] = [];

  for (const l of layers) {
    if (l === '*.Cu') out.push(...boardCopperLayers(board));
    else if (l.startsWith('*.')) out.push(`F.${l.slice(2)}`, `B.${l.slice(2)}`);
    else out.push(l);
  }

  return [...new Set(out)];
}

/**
 * `BOARD_ITEM::LayerMaskDescribe`: "all copper layers", else the first layer of
 * the copper set, then of the technical set, then of everything — with
 * "and others" appended when that set holds more than one.
 */
export function layerMaskDescribe(ctx: PcbMsgPanelContext, rawLayers: readonly string[]): string {
  const enabled = new Set(ctx.board.layers.map((l) => l.name));
  const layers = expandLayers(ctx.board, rawLayers)
    .filter((l) => enabled.has(l))
    .sort(byLayerId);
  const copper = layers.filter(isCopper);
  const tech = layers.filter((l) => TECH_LAYERS.includes(l));

  if (copper.length === boardCopperLayers(ctx.board).length && copper.length > 0)
    return 'all copper layers';

  for (const set of [copper, tech, layers]) {
    const first = set[0];
    if (first === undefined) continue;
    return set.length > 1 ? `${layerName(ctx, first)} and others` : layerName(ctx, first);
  }

  return 'no layers';
}

// ---------------------------------------------------------------------------
// BOARD::GetMsgPanelInfo (pcbnew/board.cpp:2285)
// ---------------------------------------------------------------------------

/**
 * The five rows a board editor shows with nothing selected.
 *
 * `Nets` is the number of *distinct netcodes greater than zero* that the
 * board's tracks, vias and pads actually use — not the size of the net table.
 * A board whose netlist declares a net nothing is routed to does not count it.
 */
export function boardMsgPanelInfo(ctx: PcbMsgPanelContext): MsgPanelItem[] {
  const { board } = ctx;
  const netCodes = new Set<number>();
  let padCount = 0;

  for (const t of [...board.tracks, ...board.arcs, ...board.vias]) {
    if (t.net > 0) netCodes.add(t.net);
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      padCount++;
      if ((pad.net ?? 0) > 0) netCodes.add(pad.net ?? 0);
    }
  }

  return [
    { upper: 'Pads', lower: String(padCount) },
    { upper: 'Vias', lower: String(board.vias.length) },
    { upper: 'Track Segments', lower: String(board.tracks.length + board.arcs.length) },
    { upper: 'Nets', lower: String(netCodes.size) },
    { upper: 'Unrouted', lower: String(ctx.unconnectedCount ?? 0) },
  ];
}

// ---------------------------------------------------------------------------
// FOOTPRINT (pcbnew/footprint.cpp:2131)
// ---------------------------------------------------------------------------

/** `LSET::SideSpecificMask()` — a layer that belongs to one side of the board. */
const isSideSpecific = (layer: string): boolean => /^[FB]\./.test(layer);

/**
 * The frames whose BOARD is a `BOARD_USE::FPHOLDER` — a board that exists only
 * to hold one footprint for viewing or editing. The footprint editor
 * (`footprint_edit_frame.cpp`), pcbnew's footprint viewer, the chooser's
 * preview panel (`footprint_preview_panel.cpp`) and CVPCB's viewer
 * (`display_footprints_frame.cpp:83`, `SetBoardUse( BOARD_USE::FPHOLDER )`)
 * all set it. Only the board editor's board is a real board.
 */
const FPHOLDER_FRAMES: ReadonlySet<PcbMsgPanelFrame> = new Set<PcbMsgPanelFrame>([
  'footprint_edit',
  'footprint_viewer',
  'cvpcb_display',
]);

/**
 * `FOOTPRINT::GetSide` (footprint.cpp:2217): the footprint's own layer, but
 * only once something in it actually sits on a side-specific layer. A footprint
 * of user-layer graphics alone is unsided and gets no Board Side row at all.
 *
 * A footprint-holder board short-circuits the whole test:
 *
 *     if( const BOARD* board = GetBoard() )
 *         if( board->IsFootprintHolder() )
 *             return UNDEFINED_LAYER;
 *
 * which is why CVPCB's viewer shows no Board Side row even though it takes the
 * board editor's branch for every other row.
 */
export function footprintSide(ctx: PcbMsgPanelContext, fp: PcbFootprint): string | null {
  if (FPHOLDER_FRAMES.has(ctx.frame)) return null;

  const sided =
    fp.pads.some((p) => expandLayers(ctx.board, p.layers).some(isSideSpecific)) ||
    fp.shapes.some((s) => isSideSpecific(s.layer)) ||
    fp.texts.some((t) => isSideSpecific(t.layer));

  return sided ? fp.layer : null;
}

/**
 * `FOOTPRINT::GetPadCount( DO_NOT_INCLUDE_NPTH )` (footprint.cpp:2514).
 *
 * The Pads row skips non-plated through holes, so a footprint with mounting
 * holes reports fewer pads than it has. `pads.length` is
 * `GetPadCount( INCLUDE_NPTH )`, a different question.
 */
export function padCountForDisplay(fp: PcbFootprint): number {
  return fp.pads.filter((p) => p.type !== 'np_thru_hole').length;
}

/** The `(attr …)` tokens, in the order `FOOTPRINT::GetMsgPanelInfo` adds them. */
const ATTRIBUTE_LABELS: [string, string][] = [
  ['board_only', 'not in schematic'],
  ['exclude_from_pos_files', 'exclude from pos files'],
  ['exclude_from_bom', 'exclude from BOM'],
  ['dnp', 'DNP'],
];

export function footprintMsgPanelInfo(ctx: PcbMsgPanelContext, fp: PcbFootprint): MsgPanelItem[] {
  const list: MsgPanelItem[] = [
    // "Don't use GetShownText(); we want to see the variable references here."
    { upper: unescapeString(fp.reference ?? ''), lower: unescapeString(fp.value ?? '') },
  ];

  const [nickname = '', itemName = ''] = splitFpid(fp.lib);

  if (FOOTPRINT_ONLY_FRAMES.has(ctx.frame)) {
    list.push(
      { upper: 'Library', lower: nickname },
      { upper: 'Footprint Name', lower: itemName },
      { upper: 'Pads', lower: String(padCountForDisplay(fp)) },
      { upper: `Doc: ${fp.descr ?? ''}`, lower: `Keywords: ${fp.tags ?? ''}` },
    );
    return list;
  }

  const side = footprintSide(ctx, fp);

  if (side === 'F.Cu') list.push({ upper: 'Board Side', lower: 'Front' });
  else if (side === 'B.Cu') list.push({ upper: 'Board Side', lower: 'Back (Flipped)' });

  // wxString::Format( "%.4g", GetOrientation().AsDegrees() ).
  list.push({ upper: 'Rotation', lower: formatG(fp.angle, 4) });

  const status: string[] = [];
  const attrs: string[] = [];

  if (fp.locked) status.push('Locked');
  // IsPlaced() is the autoplacer's flag; it has no file token and nothing in
  // this port sets it, so the "autoplaced" token can never appear.

  for (const [token, label] of ATTRIBUTE_LABELS) {
    if (fp.attributes?.includes(token)) attrs.push(label);
  }

  list.push({ upper: `Status: ${status.join(', ')}`, lower: `Attributes: ${attrs.join(', ')}` });

  const model = fp.models.find((m) => m.path !== '');
  list.push({
    upper: `Footprint: ${fp.lib}`,
    lower: `3D-Shape: ${model ? model.path : '<none>'}`,
  });
  list.push({ upper: `Doc: ${fp.descr ?? ''}`, lower: `Keywords: ${fp.tags ?? ''}` });

  return list;
}

/** `LIB_ID`: `nickname:item`, and an id with no colon is all item name. */
function splitFpid(fpid: string): [string, string] {
  const at = fpid.indexOf(':');
  return at < 0 ? ['', fpid] : [fpid.slice(0, at), fpid.slice(at + 1)];
}

// ---------------------------------------------------------------------------
// PAD (pcbnew/pad.cpp:1886)
// ---------------------------------------------------------------------------

/** `PAD::ShowPadShape` (pad.cpp:2164). Data — KiCad's own strings. */
const PAD_SHAPE_LABEL: Record<string, string> = {
  circle: 'Circle',
  oval: 'Oval',
  rect: 'Rectangle',
  trapezoid: 'Trapezoid',
  roundrect: 'Rounded rectangle',
  chamfered_rect: 'Chamfered rectangle',
  custom: 'Custom shape',
};

/** `PAD::ShowPadAttr` (pad.cpp:2202). Note "Conn", not "Connector". */
const PAD_ATTR_LABEL: Record<string, string> = {
  thru_hole: 'PTH',
  smd: 'SMD',
  connect: 'Conn',
  np_thru_hole: 'NPTH',
};

/** `PAD_PROP`'s names, in the switch's order (pad.cpp:1937-1948). */
const PAD_PROPERTY_LABEL: Record<string, string> = {
  pad_prop_bga: 'BGA',
  pad_prop_fiducial_glob: 'Fiducial global',
  pad_prop_fiducial_loc: 'Fiducial local',
  pad_prop_testpoint: 'Test point',
  pad_prop_heatsink: 'Heat sink',
  pad_prop_castellated: 'Castellated',
  pad_prop_mechanical: 'Mechanical',
  pad_prop_pressfit: 'Press-fit',
};

/** `EDA_ANGLE::Normalize180` — into ]-180, 180]. */
function normalize180(deg: number): number {
  let a = deg;
  while (a <= -180) a += 360;
  while (a > 180) a -= 360;
  return a;
}

export function padMsgPanelInfo(
  ctx: PcbMsgPanelContext,
  pad: PcbPad,
  parent: PcbFootprint | undefined,
): MsgPanelItem[] {
  const list: MsgPanelItem[] = [];
  const boardEditor = ctx.frame === 'pcb_edit';

  if (boardEditor && parent) list.push({ upper: 'Footprint', lower: parent.reference ?? '' });

  list.push({ upper: 'Pad', lower: pad.number });

  if (pad.pinFunction) list.push({ upper: 'Pin Name', lower: pad.pinFunction });
  if (pad.pinType) list.push({ upper: 'Pin Type', lower: pad.pinType });

  if (boardEditor) {
    list.push({ upper: 'Net', lower: netName(ctx, pad.net) });
    list.push({ upper: 'Resolved Netclass', lower: netClass(ctx, pad.net) });
    // A pad carries no `(locked …)` of its own in the file format, so the
    // Status row upstream adds for a locked pad has nothing to read here.
  }

  // Only an SMD or connector pad gets a Layer row (pad.cpp:1917-1918).
  if (pad.type === 'smd' || pad.type === 'connect')
    list.push({ upper: 'Layer', lower: layerMaskDescribe(ctx, pad.layers) });

  // The footprint editor's "Area" row needs GetEffectivePolygon; see the
  // deferred list at the top of this file.

  let props = PAD_ATTR_LABEL[pad.type] ?? '???';
  const property = pad.padProperty ? PAD_PROPERTY_LABEL[pad.padProperty] : undefined;
  if (property !== undefined) props += `,${property}`;

  list.push({ upper: PAD_SHAPE_LABEL[pad.shape] ?? '???', lower: props });

  if ((pad.shape === 'circle' || pad.shape === 'oval') && pad.size.x === pad.size.y) {
    list.push({ upper: 'Diameter', lower: fmt(ctx, pad.size.x) });
  } else {
    list.push({ upper: 'Width', lower: fmt(ctx, pad.size.x) });
    list.push({ upper: 'Height', lower: fmt(ctx, pad.size.y) });
  }

  // pad.cpp:1968-1978: relative to the footprint when the footprint is turned,
  // absolute when it is not. Both through wxT( "%g" ), whose default precision
  // is six significant digits.
  const fpOrient = parent?.angle ?? 0;
  const padOrient = normalize180(pad.angle - fpOrient);
  list.push({
    upper: 'Rotation',
    lower:
      fpOrient !== 0
        ? `${formatG(padOrient, 6)}(+ ${formatG(fpOrient, 6)})`
        : formatG(pad.angle, 6),
  });

  if (pad.padToDieLength)
    list.push({ upper: 'Length in Package', lower: fmt(ctx, pad.padToDieLength) });

  if (pad.drill && (pad.drill.w > 0 || pad.drill.h > 0)) {
    if (pad.drill.oblong) {
      list.push({
        upper: 'Hole X / Y',
        lower: `${fmt(ctx, pad.drill.w)} / ${fmt(ctx, pad.drill.h)}`,
      });
    } else {
      list.push({ upper: 'Hole', lower: fmt(ctx, pad.drill.w) });
    }
  }

  return list;
}

// ---------------------------------------------------------------------------
// PCB_TRACK / PCB_ARC / PCB_VIA (pcbnew/pcb_track.cpp:2329, :2427)
// ---------------------------------------------------------------------------

/** `PCB_TRACK::GetMsgPanelInfoBase_Common` (pcb_track.cpp:2462). */
function trackCommon(
  ctx: PcbMsgPanelContext,
  net: number,
  locked: boolean | undefined,
): MsgPanelItem[] {
  const list: MsgPanelItem[] = [
    { upper: 'Net', lower: netName(ctx, net) },
    { upper: 'Resolved Netclass', lower: netClass(ctx, net) },
  ];

  if (ctx.frame === 'pcb_edit' && locked) list.push({ upper: 'Status', lower: 'Locked' });

  return list;
}

/** The layer set a track carries: its copper layer, plus a mask layer if it has one. */
const trackLayers = (t: { layer: string; maskLayer?: string }): string[] =>
  t.maskLayer ? [t.layer, t.maskLayer] : [t.layer];

export function trackMsgPanelInfo(ctx: PcbMsgPanelContext, t: PcbTrack): MsgPanelItem[] {
  const length = Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);

  return [
    // PCB_TRACK::GetFriendlyName (pcb_track.cpp:2317).
    { upper: 'Type', lower: 'Track' },
    ...trackCommon(ctx, t.net, t.locked),
    { upper: 'Layer', lower: layerMaskDescribe(ctx, trackLayers(t)) },
    { upper: 'Width', lower: fmt(ctx, t.width) },
    { upper: 'Segment Length', lower: fmt(ctx, length) },
  ];
}

/** Centre, radius and swept angle of a three-point arc (`PCB_ARC`'s geometry). */
export function arcGeometry(a: PcbArcTrack): { radius: number; angleDeg: number } {
  const { start: s, mid: m, end: e } = a;
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));

  if (d === 0) return { radius: 0, angleDeg: 0 };

  const s2 = s.x * s.x + s.y * s.y;
  const m2 = m.x * m.x + m.y * m.y;
  const e2 = e.x * e.x + e.y * e.y;
  const cx = (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d;
  const cy = (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d;
  const radius = Math.hypot(s.x - cx, s.y - cy);

  const a0 = Math.atan2(s.y - cy, s.x - cx);
  const a1 = Math.atan2(m.y - cy, m.x - cx);
  const a2 = Math.atan2(e.y - cy, e.x - cx);
  const norm = (v: number): number => (v < 0 ? v + 2 * Math.PI : v);
  const sweepMid = norm(a1 - a0);
  const sweepEnd = norm(a2 - a0);
  const ccw = sweepMid <= sweepEnd;
  const sweep = ccw ? sweepEnd : sweepEnd - 2 * Math.PI;

  return { radius, angleDeg: (sweep * 180) / Math.PI };
}

export function arcMsgPanelInfo(ctx: PcbMsgPanelContext, a: PcbArcTrack): MsgPanelItem[] {
  const { radius, angleDeg } = arcGeometry(a);
  const length = Math.abs((angleDeg * Math.PI) / 180) * radius;

  return [
    { upper: 'Type', lower: 'Track (arc)' },
    ...trackCommon(ctx, a.net, a.locked),
    { upper: 'Layer', lower: layerMaskDescribe(ctx, trackLayers(a)) },
    { upper: 'Width', lower: fmt(ctx, a.width) },
    { upper: 'Radius', lower: fmt(ctx, radius) },
    // wxString::Format( "%.2fdeg", … ) - no space before "deg" (pcb_track.cpp:2347).
    { upper: 'Angle', lower: `${angleDeg.toFixed(2)}deg` },
    { upper: 'Segment Length', lower: fmt(ctx, length) },
  ];
}

/** The `VIATYPE` switch at pcb_track.cpp:2431-2439. */
const VIA_TYPE_LABEL: Record<string, string> = {
  micro: 'Micro Via',
  blind: 'Blind Via',
  buried: 'Buried Via',
  through: 'Through Via',
};

export function viaMsgPanelInfo(ctx: PcbMsgPanelContext, v: PcbVia): MsgPanelItem[] {
  return [
    { upper: 'Type', lower: VIA_TYPE_LABEL[v.kind] ?? 'Via' },
    ...trackCommon(ctx, v.net, v.locked),
    // PCB_VIA::LayerMaskDescribe (pcb_track.cpp:2484) is the layer pair, not
    // BOARD_ITEM's describe: "F.Cu - B.Cu".
    { upper: 'Layer', lower: `${layerName(ctx, v.layers[0])} - ${layerName(ctx, v.layers[1])}` },
    { upper: 'Diameter', lower: fmt(ctx, v.size) },
    { upper: 'Hole', lower: fmt(ctx, v.drill) },
  ];
}

// ---------------------------------------------------------------------------
// ZONE (pcbnew/zone.cpp:929)
// ---------------------------------------------------------------------------

/** `ZONE::GetFriendlyName` (zone.cpp:1092). */
export function zoneFriendlyName(z: PcbZone): string {
  if (z.ruleArea) return 'Rule Area';
  if (z.teardropType) return 'Teardrop Area';
  return z.layers.some(isCopper) ? 'Copper Zone' : 'Non-copper Zone';
}

/** The `AccumulateDescription` list at zone.cpp:939-953, in its order. */
const KEEPOUT_LABELS: [keyof NonNullable<PcbZone['ruleArea']>, string][] = [
  ['vias', 'No vias'],
  ['tracks', 'No tracks'],
  ['pads', 'No pads'],
  ['copperPour', 'No zone fills'],
  ['footprints', 'No footprints'],
];

/** `SHAPE_POLY_SET::Area` — the shoelace sum over the filled outlines. */
function polygonArea(pts: readonly { x: number; y: number }[]): number {
  let sum = 0;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }

  return Math.abs(sum) / 2;
}

export function zoneMsgPanelInfo(ctx: PcbMsgPanelContext, z: PcbZone): MsgPanelItem[] {
  const list: MsgPanelItem[] = [{ upper: 'Type', lower: zoneFriendlyName(z) }];
  const ruleArea = z.ruleArea;

  if (ruleArea) {
    const restrictions = KEEPOUT_LABELS.filter(([k]) => ruleArea[k]).map(([, label]) => label);

    // AccumulateDescription joins with ", " and the row is dropped when empty.
    if (restrictions.length > 0)
      list.push({ upper: 'Restrictions', lower: restrictions.join(', ') });

    if (z.placementArea?.enabled)
      list.push({ upper: 'Placement source', lower: unescapeString(z.placementArea.source) });
  } else if (z.layers.some(isCopper)) {
    if (ctx.frame === 'pcb_edit') {
      list.push({ upper: 'Net', lower: netName(ctx, z.net) });
      list.push({ upper: 'Resolved Netclass', lower: netClass(ctx, z.net) });
    }

    // ZONE::GetAssignedPriority, whose default is 0.
    list.push({ upper: 'Priority', lower: String(z.priority ?? 0) });
  }

  if (ctx.frame === 'pcb_edit' && z.locked) list.push({ upper: 'Status', lower: 'Locked' });

  list.push({ upper: 'Layer', lower: zoneLayerDescription(ctx, z.layers) });

  if (z.name) list.push({ upper: 'Name', lower: z.name });

  if (!ruleArea) {
    // ZONE_FILL_MODE: POLYGONS is "Solid", HATCH_PATTERN is "Hatched".
    list.push({
      upper: 'Fill Mode',
      lower:
        z.fillMode === 'hatch'
          ? 'Hatched'
          : z.fillMode === 'solid' || z.fillMode === undefined
            ? 'Solid'
            : 'Unknown',
    });

    // ZONE::CalculateFilledArea (zone.cpp:1630) sums the filled polygons.
    let area = 0;
    for (const fill of z.fills) {
      for (const poly of fill.polys) area += polygonArea(poly);
    }

    list.push({ upper: 'Filled Area', lower: fmt(ctx, area, 'area') });
  }

  let corners = 0;

  if (ruleArea) {
    const outlineArea = z.outline ? polygonArea(z.outline) : 0;
    list.push({ upper: 'Outline Area', lower: fmt(ctx, outlineArea, 'area') });
    corners = z.outline?.length ?? 0;
  } else {
    for (const fill of z.fills) {
      for (const poly of fill.polys) corners += poly.length;
    }
  }

  list.push({ upper: 'Corner Count', lower: String(corners) });

  return list;
}

/** zone.cpp:979-1006 — one, two, three layers spelled out, then "and %d more". */
export function zoneLayerDescription(ctx: PcbMsgPanelContext, layers: readonly string[]): string {
  const n = layers.map((l) => layerName(ctx, l));

  if (n.length === 1) return `${n[0]}`;
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  if (n.length > 3) return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
  return '';
}

// ---------------------------------------------------------------------------
// PCB_TEXT (pcbnew/pcb_text.cpp:296)
// ---------------------------------------------------------------------------

export function pcbTextMsgPanelInfo(
  ctx: PcbMsgPanelContext,
  t: PcbTextItem,
  parent: PcbFootprint | undefined,
): MsgPanelItem[] {
  const list: MsgPanelItem[] = [];

  if (parent && ctx.frame === 'pcb_edit')
    list.push({ upper: 'Footprint', lower: parent.reference ?? '' });

  // "Don't use GetShownText() here; we want to show the user the variable
  // references." KIUI::EllipsizeStatusText is left to CSS, as it is in
  // common/src/drawing_sheet/msg_panel.ts.
  list.push({ upper: parent ? 'Text' : 'PCB Text', lower: t.text });

  if (parent) {
    // PCB_FIELD::GetTextTypeDescription is the canonical field name for a
    // mandatory field; PCB_TEXT::GetTextTypeDescription is plain "Text".
    list.push({
      upper: 'Type',
      lower: t.kind === 'reference' ? 'Reference' : t.kind === 'value' ? 'Value' : 'Text',
    });
  }

  if (ctx.frame === 'pcb_edit' && t.locked) list.push({ upper: 'Status', lower: 'Locked' });

  list.push({ upper: 'Layer', lower: layerName(ctx, t.layer) });
  list.push({ upper: 'Mirror', lower: t.mirror ? 'Yes' : 'No' });
  // wxString::Format( "%g", GetTextAngle().AsDegrees() ).
  list.push({ upper: 'Angle', lower: formatG(t.angle, 6) });
  // GetFont() is never set on our text items, so it is always the stroke font.
  list.push({ upper: 'Font', lower: 'Default' });
  list.push({
    upper: 'Text Thickness',
    lower: t.thickness ? fmt(ctx, t.thickness) : 'Auto',
  });
  list.push({ upper: 'Width', lower: fmt(ctx, t.size.x) });
  list.push({ upper: 'Height', lower: fmt(ctx, t.size.y) });

  return list;
}

// ---------------------------------------------------------------------------
// PCB_SHAPE (pcbnew/pcb_shape.cpp:699) + EDA_SHAPE + STROKE_PARAMS
// ---------------------------------------------------------------------------

/** `EDA_SHAPE::getFriendlyName` (common/eda_shape.cpp:1262). */
const SHAPE_FRIENDLY_NAME: Record<string, string> = {
  circle: 'Circle',
  arc: 'Arc',
  curve: 'Curve',
  poly: 'Polygon',
  rect: 'Rectangle',
  line: 'Segment',
};

/** `lineTypeNames` (common/stroke_params.cpp:39). */
const LINE_STYLE_LABEL: Record<string, string> = {
  solid: 'Solid',
  dash: 'Dashed',
  dot: 'Dotted',
  dash_dot: 'Dash-Dot',
  dash_dot_dot: 'Dash-Dot-Dot',
};

export function pcbShapeMsgPanelInfo(
  ctx: PcbMsgPanelContext,
  s: PcbShape,
  parent: PcbFootprint | undefined,
): MsgPanelItem[] {
  const list: MsgPanelItem[] = [];

  if (ctx.frame === 'pcb_edit' && parent)
    list.push({ upper: 'Footprint', lower: parent.reference ?? '' });

  list.push({ upper: 'Type', lower: 'Drawing' });

  if (ctx.frame === 'pcb_edit' && s.locked) list.push({ upper: 'Status', lower: 'Locked' });

  // ---- EDA_SHAPE::ShapeGetMsgPanelInfo ----
  list.push({ upper: 'Shape', lower: SHAPE_FRIENDLY_NAME[s.kind] ?? 'Unrecognized' });

  const start = s.start ?? { x: 0, y: 0 };
  const end = s.end ?? { x: 0, y: 0 };

  switch (s.kind) {
    case 'circle':
      list.push({ upper: 'Radius', lower: fmt(ctx, radiusOf(s)) });
      break;

    case 'arc': {
      const g = arcGeometry({ start, mid: s.mid ?? start, end } as PcbArcTrack);
      list.push({
        upper: 'Length',
        lower: fmt(ctx, Math.abs((g.angleDeg * Math.PI) / 180) * g.radius),
      });
      // The EDA_ANGLE overload of MessageTextFromValue: "%.1f°".
      list.push({ upper: 'Angle', lower: messageTextFromAngle(g.angleDeg) });
      list.push({ upper: 'Radius', lower: fmt(ctx, g.radius) });
      break;
    }

    case 'poly':
      list.push({ upper: 'Points', lower: String(s.pts?.length ?? 0) });
      break;

    case 'rect':
      list.push({ upper: 'Width', lower: fmt(ctx, Math.abs(end.x - start.x)) });
      list.push({ upper: 'Height', lower: fmt(ctx, Math.abs(end.y - start.y)) });
      break;

    case 'line':
      list.push({
        upper: 'Length',
        lower: fmt(ctx, Math.hypot(end.x - start.x, end.y - start.y)),
      });
      list.push({
        upper: 'Angle',
        // "angle counter-clockwise from 3'o-clock" (eda_shape.cpp:1329-1332).
        lower: messageTextFromAngle((Math.atan2(start.y - end.y, end.x - start.x) * 180) / Math.PI),
      });
      break;

    default:
      // BEZIER reports its Length, which needs the flattened curve; nothing
      // else in the switch matches, so the shape falls through with no rows.
      break;
  }

  // STROKE_PARAMS::GetMsgPanelInfo, both halves (its defaults are true/true).
  list.push({ upper: 'Line Style', lower: LINE_STYLE_LABEL[s.strokeType ?? 'solid'] ?? 'Default' });
  list.push({ upper: 'Line Width', lower: fmt(ctx, s.width) });

  list.push({ upper: 'Layer', lower: layerName(ctx, s.layer) });

  return list;
}

function radiusOf(s: PcbShape): number {
  const c = s.center ?? s.start ?? { x: 0, y: 0 };
  const e = s.end ?? c;
  return Math.hypot(e.x - c.x, e.y - c.y);
}

// ---------------------------------------------------------------------------
// PCB_CONTROL::UpdateMessagePanel (pcbnew/tools/pcb_control.cpp:2377)
// ---------------------------------------------------------------------------

/**
 * `EDA_ITEM::GetFriendlyName()` — the `ENUM_MAP<KICAD_T>` at
 * common/eda_item.cpp:446-471, for the types our board model has. **Data**:
 * KiCad's own table. Note that `PCB_ARC_T` is "Track", not "Arc": an arc
 * segment and a straight segment are the same thing to a selection summary.
 */
export const BOARD_ITEM_FRIENDLY_NAME: Record<string, string> = {
  footprint: 'Footprint',
  pad: 'Pad',
  shape: 'Graphic',
  fptext: 'Text',
  text: 'Text',
  textbox: 'Text Box',
  table: 'Table',
  track: 'Track',
  arc: 'Track',
  via: 'Via',
  dimension: 'Dimension',
  zone: 'Zone',
  group: 'Group',
  image: 'Reference Image',
};

/**
 * `KICAD_T`'s own order (include/core/typeinfo.h:86-113), for the kinds our
 * board model has. **Data**: the enum's declaration order, which is what a
 * `std::map<KICAD_T, int>` iterates in.
 */
const KICAD_T_ORDER: string[] = [
  'footprint',
  'pad',
  'shape',
  'image',
  'fptext',
  'text',
  'textbox',
  'table',
  'track',
  'via',
  'arc',
  'dimension',
  'zone',
  'group',
];

const kicadTypeOrder = (kind: string): number => {
  const at = KICAD_T_ORDER.indexOf(kind);
  return at < 0 ? KICAD_T_ORDER.length : at;
};

/** What the dispatcher needs to describe a selection it did not build. */
export interface PcbMsgPanelSelection {
  /** Board item ids, as `boardItemId` encodes them. */
  ids: readonly string[];
  /** `EDA_ITEM::GetItemDescription( frame, false )`, for the two-item pair row. */
  describe: (id: string) => string;
}

/** One selected item's rows, dispatched the way the virtual would be. */
export function boardItemMsgPanelInfo(ctx: PcbMsgPanelContext, ref: BoardItemRef): MsgPanelItem[] {
  const b = ctx.board;

  switch (ref.kind) {
    case 'footprint': {
      const fp = b.footprints[ref.index];
      return fp ? footprintMsgPanelInfo(ctx, fp) : [];
    }
    case 'pad': {
      const fp = b.footprints[ref.index];
      const pad = fp?.pads[ref.sub ?? 0];
      return pad ? padMsgPanelInfo(ctx, pad, fp) : [];
    }
    case 'track': {
      const t = b.tracks[ref.index];
      return t ? trackMsgPanelInfo(ctx, t) : [];
    }
    case 'arc': {
      const a = b.arcs[ref.index];
      return a ? arcMsgPanelInfo(ctx, a) : [];
    }
    case 'via': {
      const v = b.vias[ref.index];
      return v ? viaMsgPanelInfo(ctx, v) : [];
    }
    case 'zone': {
      const z = b.zones[ref.index];
      return z ? zoneMsgPanelInfo(ctx, z) : [];
    }
    case 'text': {
      const t = b.texts[ref.index];
      return t ? pcbTextMsgPanelInfo(ctx, t, undefined) : [];
    }
    case 'fptext': {
      const fp = b.footprints[ref.index];
      const t = fp?.texts[ref.sub ?? 0];
      return t ? pcbTextMsgPanelInfo(ctx, t, fp) : [];
    }
    case 'shape': {
      const s = b.shapes[ref.index];
      return s ? pcbShapeMsgPanelInfo(ctx, s, undefined) : [];
    }
    default:
      // PCB_TEXTBOX, PCB_TABLE, PCB_DIMENSION, PCB_REFERENCE_IMAGE and
      // PCB_GROUP each have their own GetMsgPanelInfo that is not ported yet.
      return [];
  }
}

/**
 * The whole panel, as `PCB_CONTROL::UpdateMessagePanel` decides it:
 *
 *   - nothing selected → the BOARD's rows in the board editor, the footprint's
 *     own rows in the footprint editor (`:2397-2408`);
 *   - one item        → that item's `GetMsgPanelInfo` (`:2409-2416`);
 *   - two items       → the pair's descriptions, then the DRC-derived
 *     clearance rows we have not wired up (`:2461-2596`);
 *   - more            → a type summary, and the common net and netclass when
 *     every selected item shares one (`:2598-2710`).
 *
 * The rows are the *whole* panel, never an addition to it: `SetMsgPanel` calls
 * `EraseMsgBox()` first (`common/eda_draw_frame.cpp:955-964`).
 */
export function pcbMsgPanelInfo(
  ctx: PcbMsgPanelContext,
  selection: PcbMsgPanelSelection,
): MsgPanelItem[] {
  const ids = selection.ids;

  if (ids.length === 0) {
    if (ctx.frame === 'pcb_edit') return boardMsgPanelInfo(ctx);
    const fp = ctx.board.footprints[0];
    return fp ? footprintMsgPanelInfo(ctx, fp) : [];
  }

  if (ids.length === 1) {
    const ref = parseBoardItemId(ids[0] ?? '');
    return ref ? boardItemMsgPanelInfo(ctx, ref) : [];
  }

  if (ids.length === 2) {
    return [{ upper: selection.describe(ids[0] ?? ''), lower: selection.describe(ids[1] ?? '') }];
  }

  // msgItems is empty at this point for us, because every row upstream could
  // have added first comes from the DRC engine; so the type summary always
  // runs (`:2599-2600`).
  const refs = ids.map((id) => parseBoardItemId(id)).filter((r): r is BoardItemRef => r !== null);
  const counts = new Map<string, number>();

  for (const r of refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);

  const list: MsgPanelItem[] = [];
  const first = refs[0];

  if (counts.size === 1 && first) {
    // "Show 'Type: N' for homogeneous selections" - the friendly name is the
    // label and the count is the value.
    list.push({
      upper: BOARD_ITEM_FRIENDLY_NAME[first.kind] ?? first.kind,
      lower: String(ids.length),
    });

    if (first.kind === 'pad') {
      const pads = refs
        .map((r) => ctx.board.footprints[r.index]?.pads[r.sub ?? 0])
        .filter((p): p is PcbPad => p !== undefined);
      const layers = new Set(pads.map((p) => layerMaskDescribe(ctx, p.layers)));
      const shapes = new Set(pads.map((p) => p.shape));
      const sizes = new Set(pads.map((p) => `${p.size.x},${p.size.y}`));
      const firstPad = pads[0];

      if (layers.size === 1) list.push({ upper: 'Layer', lower: [...layers][0] ?? '' });

      if (shapes.size === 1 && firstPad)
        list.push({ upper: 'Pad Shape', lower: PAD_SHAPE_LABEL[firstPad.shape] ?? '???' });

      if (sizes.size === 1 && firstPad) {
        list.push({
          upper: 'Pad Size',
          lower: `${fmt(ctx, firstPad.size.x)} x ${fmt(ctx, firstPad.size.y)}`,
        });
      }
    }
  } else {
    // "Show type breakdown for mixed selections": "Type: N, Type: N". The
    // breakdown walks a std::map<KICAD_T, int>, so it comes out in KICAD_T
    // order, not selection order - which is why KICAD_T_ORDER below is
    // transcribed from the enum rather than reusing our own kind list.
    const breakdown = [...counts.entries()]
      .sort((a, b) => kicadTypeOrder(a[0]) - kicadTypeOrder(b[0]))
      .map(([kind, n]) => `${BOARD_ITEM_FRIENDLY_NAME[kind] ?? kind}: ${n}`)
      .join(', ');

    list.push({ upper: 'Selected Items', lower: `${ids.length} (${breakdown})` });
  }

  if (ctx.frame === 'pcb_edit') {
    const netNames = new Set<string>();
    const netClasses = new Set<string>();

    for (const r of refs) {
      const code = connectedNetCode(ctx, r);
      if (code === undefined || code <= 0) continue;
      netNames.add(netName(ctx, code));
      netClasses.add(netClass(ctx, code));
    }

    if (netNames.size === 1) list.push({ upper: 'Net', lower: [...netNames][0] ?? '' });

    if (netClasses.size === 1)
      list.push({ upper: 'Resolved Netclass', lower: [...netClasses][0] ?? '' });
  }

  return list;
}

/** `dynamic_cast<BOARD_CONNECTED_ITEM*>`: the net code, or undefined if it has none. */
function connectedNetCode(ctx: PcbMsgPanelContext, r: BoardItemRef): number | undefined {
  switch (r.kind) {
    case 'track':
      return ctx.board.tracks[r.index]?.net;
    case 'arc':
      return ctx.board.arcs[r.index]?.net;
    case 'via':
      return ctx.board.vias[r.index]?.net;
    case 'zone':
      return ctx.board.zones[r.index]?.net;
    case 'pad':
      return ctx.board.footprints[r.index]?.pads[r.sub ?? 0]?.net;
    default:
      return undefined;
  }
}
