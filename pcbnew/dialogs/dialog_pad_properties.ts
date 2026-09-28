// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Properties (board side), headless.
 * Counterpart: `pcbnew/dialogs/dialog_pad_properties.cpp`.
 *
 * The wrinkle that is specific to the board editor: this model stores a pad's
 * position **board-absolute** (the reader bakes the footprint transform in),
 * but the file stores it **footprint-local**. So editing the position means
 * converting back through the parent's rotation and anchor before patching
 * `(at …)`. The angle needs no conversion — the file already holds a
 * board-frame absolute value, as `parsePAD` notes.
 *
 * The decision logic lives here so it can be tested without a UI.
 */

import { parseBoardItemId } from './edit-board.js';
import { rotatePcb } from './read-board.js';
import type { Board, PadShape, PadType, PcbFootprint, PcbPad } from './types.js';
import { defaultTeardropParameters } from './teardrop.js';
import type { TeardropParams } from './types.js';

/** `BOARD_CONNECTED_ITEM::GetTeardropParams()`: the item's own, or the defaults. */
const teardropParamsOf = (pad: PcbPad): TeardropParams =>
  pad.teardrops ?? defaultTeardropParameters();
import { unconnectedLayerModeOf } from './unused_pad_layers.js';
import type { UnconnectedLayerMode } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Where a pad lives: which footprint, and which pad within it. */
export interface PadRef {
  footprint: number;
  pad: number;
}

/** Every field the dialog edits. */
export interface PadValues {
  number: string;
  net: number;
  type: PadType;
  shape: PadShape;
  /** Board-absolute anchor, IU — the dialog shows it relative to the footprint. */
  x: number;
  y: number;
  /** Degrees, board-frame absolute. */
  orientation: number;
  sizeX: number;
  sizeY: number;
  /** `(roundrect_rratio …)`, a fraction of the pad's smaller side. */
  roundrectRatio: number;
  /** `(rect_delta …)`, the trapezoid's taper. */
  deltaX: number;
  deltaY: number;
  /** Hole: absent for an SMD pad. */
  hasHole: boolean;
  holeOblong: boolean;
  holeW: number;
  holeH: number;
  holeOffsetX: number;
  holeOffsetY: number;
  layers: string[];
  /** Overrides; null is blank, meaning inherit. Zero is a real override. */
  localClearance: number | null;
  localSolderMaskMargin: number | null;
  localSolderPasteMargin: number | null;
  localSolderPasteMarginRatio: number | null;
  zoneConnection: NonNullable<PcbPad['zoneConnection']>;
  /**
   * `(pinfunction …)` / `(pintype …)` — the schematic's pin name and electrical
   * type, pushed onto the pad by the netlist. DIALOG_PAD_PROPERTIES shows them
   * and does not edit them; PAD_DESC registers both with real setters
   * (pad.cpp:3462-3478), so the Properties panel does.
   */
  pinFunction: string;
  pinType: string;
  /**
   * `UNCONNECTED_LAYER_MODE`, PAD_DESC's "Copper Layers" enum
   * (pad.cpp:3757-3759): which copper layers a through-hole pad keeps where it
   * is not connected. Not a layer LIST — that is `layers`.
   */
  unconnectedLayerMode: UnconnectedLayerMode;
  thermalBridgeWidth: number | null;
  thermalGap: number | null;
  padToDieLength: number | null;
  /**
   * `(teardrops …)`, the per-item TEARDROP_PARAMETERS `BOARD_CONNECTED_ITEM`
   * carries. DIALOG_PAD_PROPERTIES has no teardrop page — these are the
   * Properties panel's rows (board_connected_item.cpp's `groupTeardrops`), whose
   * setters are BOARD_CONNECTED_ITEM's own and so apply to a pad exactly as they
   * do to a via.
   */
  teardrops: TeardropParams;
}

/** Resolve a `pad:F:P` id, or null when the selection is not a single pad. */
export function padAt(board: Board, selection: Iterable<string>): PadRef | null {
  let found: PadRef | null = null;

  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'pad') continue;
    if (found !== null) return null;
    const fp = board.footprints[ref.index];
    if (fp?.pads[ref.sub ?? 0]) found = { footprint: ref.index, pad: ref.sub ?? 0 };
  }

  return found;
}

/** DIALOG_PAD_PROPERTIES::TransferDataToWindow. */
export function collectPadValues(pad: PcbPad): PadValues {
  return {
    number: pad.number,
    net: pad.net ?? 0,
    type: pad.type,
    shape: pad.shape,
    x: pad.at.x,
    y: pad.at.y,
    orientation: pad.angle,
    sizeX: pad.size.x,
    sizeY: pad.size.y,
    roundrectRatio: pad.roundrectRatio ?? 0.25,
    deltaX: pad.delta?.x ?? 0,
    deltaY: pad.delta?.y ?? 0,
    hasHole: pad.drill !== undefined,
    holeOblong: pad.drill?.oblong ?? false,
    holeW: pad.drill?.w ?? 0,
    holeH: pad.drill?.h ?? 0,
    holeOffsetX: pad.drill?.offset?.x ?? 0,
    holeOffsetY: pad.drill?.offset?.y ?? 0,
    layers: [...pad.layers],
    localClearance: pad.localClearance ?? null,
    localSolderMaskMargin: pad.localSolderMaskMargin ?? null,
    localSolderPasteMargin: pad.localSolderPasteMargin ?? null,
    localSolderPasteMarginRatio: pad.localSolderPasteMarginRatio ?? null,
    zoneConnection: pad.zoneConnection ?? 'inherited',
    pinFunction: pad.pinFunction ?? '',
    pinType: pad.pinType ?? '',
    unconnectedLayerMode: unconnectedLayerModeOf(pad),
    thermalBridgeWidth: pad.thermalBridgeWidth ?? null,
    thermalGap: pad.thermalGap ?? null,
    padToDieLength: pad.padToDieLength ?? null,
    teardrops: teardropParamsOf(pad),
  };
}

/**
 * A board-absolute point back into the parent footprint's frame — the inverse
 * of the reader's `toBoard`, which is what the file stores in `(at …)`.
 */
export function padLocalPos(fp: PcbFootprint, boardPos: Vec2): Vec2 {
  return rotatePcb({ x: boardPos.x - fp.at.x, y: boardPos.y - fp.at.y }, -fp.angle);
}

/**
 * DIALOG_PAD_PROPERTIES::TransferDataFromWindow. Returns the board unchanged
 * when nothing moved; the model takes the edit when the board is written.
 */
export function applyPadValues(board: Board, ref: PadRef, v: PadValues): Board {
  const fp = board.footprints[ref.footprint];
  const pad = fp?.pads[ref.pad];
  if (!fp || !pad) return board;

  const before = collectPadValues(pad);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const next: PcbPad = { ...pad };

  // Positional atoms: (pad "number" <type> <shape> …).
  if (v.number !== pad.number) {
    next.number = v.number;
  }
  if (v.type !== pad.type) {
    next.type = v.type;
  }
  if (v.shape !== pad.shape) {
    next.shape = v.shape;
  }

  // `(at …)` is footprint-local in the file but board-absolute in the model;
  // the angle stays absolute either way.
  const at = { x: v.x, y: v.y };
  if (at.x !== pad.at.x || at.y !== pad.at.y || v.orientation !== pad.angle) {
    next.at = at;
    next.angle = v.orientation;
  }

  if (v.sizeX !== pad.size.x || v.sizeY !== pad.size.y) {
    next.size = { x: v.sizeX, y: v.sizeY };
  }

  if (v.net !== (pad.net ?? 0)) {
    next.net = v.net;
  }

  if (v.layers.join() !== pad.layers.join()) {
    next.layers = [...v.layers];
  }

  // Shape extras only apply to the shape that owns them, so the others' tokens
  // are dropped: a pad switched from roundrect to rect keeping its rratio would
  // read back as a rounded rectangle the moment the shape changed again.
  if (v.shape === 'roundrect') {
    next.roundrectRatio = v.roundrectRatio;
  } else {
    next.roundrectRatio = undefined;
  }

  if (v.shape === 'trapezoid' && (v.deltaX !== 0 || v.deltaY !== 0)) {
    next.delta = { x: v.deltaX, y: v.deltaY };
  } else {
    next.delta = undefined;
  }

  if (v.hasHole && v.holeW > 0) {
    next.drill = {
      oblong: v.holeOblong,
      w: v.holeW,
      h: v.holeOblong ? v.holeH : v.holeW,
      offset:
        v.holeOffsetX !== 0 || v.holeOffsetY !== 0
          ? { x: v.holeOffsetX, y: v.holeOffsetY }
          : undefined,
    };
  } else {
    next.drill = undefined;
  }

  // Overrides: a blank box drops the token; zero is a real value.
  const override = (
    key:
      | 'localClearance'
      | 'localSolderMaskMargin'
      | 'localSolderPasteMargin'
      | 'thermalBridgeWidth'
      | 'thermalGap'
      | 'padToDieLength',
    token: string,
    value: number | null,
  ): void => {
    next[key] = value ?? undefined;
  };

  override('localClearance', 'clearance', v.localClearance);
  override('localSolderMaskMargin', 'solder_mask_margin', v.localSolderMaskMargin);
  override('localSolderPasteMargin', 'solder_paste_margin', v.localSolderPasteMargin);
  override('thermalBridgeWidth', 'thermal_bridge_width', v.thermalBridgeWidth);
  override('thermalGap', 'thermal_gap', v.thermalGap);
  override('padToDieLength', 'die_length', v.padToDieLength);

  next.localSolderPasteMarginRatio = v.localSolderPasteMarginRatio ?? undefined;

  // `(pinfunction …)` / `(pintype …)`: the writer emits each only when it is
  // non-empty (`format( const PAD* )`, pcb_io_kicad_sexpr.cpp:1862-1868), so
  // clearing the cell drops the token rather than writing an empty string.
  const text = (key: 'pinFunction' | 'pinType', token: string, value: string): void => {
    next[key] = value === '' ? undefined : value;
  };

  text('pinFunction', 'pinfunction', v.pinFunction);
  text('pinType', 'pintype', v.pinType);

  // UNCONNECTED_LAYER_MODE, written as the two booleans a PTH pad carries
  // (pcb_io_kicad_sexpr.cpp:1792-1798): `remove_unused_layers`, and
  // `keep_end_layers` only when the first is yes. A pad that is not PTH has
  // neither token — upstream writes them for PAD_ATTRIB::PTH alone.
  //
  if (v.type === 'thru_hole' && v.unconnectedLayerMode !== unconnectedLayerModeOf(pad)) {
    next.unconnectedLayerMode = v.unconnectedLayerMode;
  } else if (v.type !== 'thru_hole' && pad.unconnectedLayerMode !== undefined) {
    // The tokens belong to a PTH pad alone, so a pad changed to SMD loses them.
    next.unconnectedLayerMode = undefined;
  }

  // `(teardrops …)` is written only when it differs from the defaults, exactly
  // as the writer decides — so a pad left at the defaults keeps no token.
  const td = teardropParamsOf(pad);
  if (
    (Object.keys(v.teardrops) as (keyof TeardropParams)[]).some((k) => v.teardrops[k] !== td[k])
  ) {
    next.teardrops = v.teardrops;
  }

  next.zoneConnection = v.zoneConnection === 'inherited' ? undefined : v.zoneConnection;

  const pads = fp.pads.map((p, i) => (i === ref.pad ? next : p));
  return {
    ...board,
    footprints: board.footprints.map((f, i) => (i === ref.footprint ? { ...f, pads } : f)),
  };
}
