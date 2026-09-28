// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Shape properties for a board graphic, headless.
 * Counterpart: `pcbnew/dialogs/dialog_shape_properties.cpp`. Text properties,
 * which shared this file until they were split along KiCad's own dialog
 * boundary, are `dialog_text_properties.ts`.
 *
 * Single-item, so no three-state fold. Each applied field patches the item's
 * source node in step, since the writer emits a stored source verbatim.
 */

import { parseBoardItemId } from '../edit-board.js';
import type { PcbFillMode } from '../shape_fill.js';
import type { Board, PcbShape, StrokeType } from '../types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The mask layer that pairs with a graphic's own layer, F.SilkS -> F.Mask. */
const maskSideOf = (layer: string): string | undefined =>
  layer.startsWith('F.') ? 'F.Mask' : layer.startsWith('B.') ? 'B.Mask' : undefined;

/** Every field DIALOG_SHAPE_PROPERTIES edits, for a board graphic. */
export interface ShapeValues {
  /** The geometry points that apply to this shape kind. */
  start: Vec2;
  end: Vec2;
  mid: Vec2;
  center: Vec2;
  /**
   * `SHAPE_T`. Changing it is `EDA_SHAPE::SetShape`, which assigns the type and
   * leaves the points where they are — a segment becomes a rectangle on the same
   * two corners. The NODE has to be rebuilt for it, because the kind is the
   * node's head token.
   */
  kind: PcbShape['kind'];
  lineWidth: number;
  strokeType: StrokeType;
  /** `(radius …)`, a rounded rectangle's corner. Zero for every other kind. */
  cornerRadius: number;
  /**
   * `GetFillModeProp()` — UI_FILL_MODE, the five-way enum the Fill cell offers,
   * not a checkbox. `common/eda_shape.cpp:608-631` maps it onto FILL_T.
   */
  fillMode: PcbFillMode;
  layer: string;
  /**
   * `(net …)`, the net a COPPER graphic belongs to — PCB_SHAPE is a
   * BOARD_CONNECTED_ITEM. Zero is `<no net>`, and the token is dropped for it,
   * the way the writer only emits one when `GetNetCode() > 0`.
   */
  net: number;
  hasMask: boolean;
  /** null is blank: use the Board Setup value. */
  maskMargin: number | null;
  locked: boolean;
}

/** Which of the four points a shape kind actually uses. */
export function shapePointsUsed(kind: PcbShape['kind']): {
  start: boolean;
  end: boolean;
  mid: boolean;
  center: boolean;
} {
  switch (kind) {
    case 'line':
    case 'rect':
      return { start: true, end: true, mid: false, center: false };
    case 'arc':
      return { start: true, end: true, mid: true, center: false };
    case 'circle':
      return { start: false, end: true, mid: false, center: true };
    default:
      // A polygon or bezier is edited by the point editor, not this dialog.
      return { start: false, end: false, mid: false, center: false };
  }
}

/** Resolve a `shape:N` id, or null when the selection is not one shape. */
export function shapeAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;
  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'shape') continue;
    if (found !== null) return null;
    if (board.shapes[ref.index]) found = ref.index;
  }
  return found;
}

const ZERO: Vec2 = { x: 0, y: 0 };

/** DIALOG_SHAPE_PROPERTIES::TransferDataToWindow. */
export function collectShapeValues(s: PcbShape): ShapeValues {
  return {
    start: s.start ?? ZERO,
    end: s.end ?? ZERO,
    mid: s.mid ?? ZERO,
    center: s.center ?? ZERO,
    net: s.net ?? 0,
    kind: s.kind,
    lineWidth: s.width,
    cornerRadius: s.cornerRadius ?? 0,
    strokeType: s.strokeType ?? 'solid',
    fillMode: s.fillMode,
    layer: s.layer,
    hasMask: s.maskLayer !== undefined,
    maskMargin: s.solderMaskMargin ?? null,
    locked: s.locked ?? false,
  };
}

/** DIALOG_SHAPE_PROPERTIES::TransferDataFromWindow. */
export function applyShapeValues(board: Board, index: number, v: ShapeValues): Board {
  const s = board.shapes[index];
  if (!s) return board;

  const before = collectShapeValues(s);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const used = shapePointsUsed(v.kind);
  const next: PcbShape = { ...s, kind: v.kind };

  // `SetCornerRadius` clamps to half the shorter side for a RECTANGLE and takes
  // the value as given for anything else (eda_shape.cpp:508-522) — and only a
  // rectangle has the token at all.
  if (v.kind === 'rect') {
    const w = Math.abs(v.end.x - v.start.x);
    const h = Math.abs(v.end.y - v.start.y);
    const clamped = Math.min(Math.max(v.cornerRadius, 0), Math.trunc(Math.min(w, h) / 2));
    next.cornerRadius = clamped > 0 ? clamped : undefined;
  } else {
    next.cornerRadius = undefined;
  }

  // Only write back the points this kind owns: a circle has no `mid`, and
  // inventing one would put a token in the file that KiCad never wrote.
  if (used.start) next.start = v.start;
  if (used.end) next.end = v.end;
  if (used.mid) next.mid = v.mid;
  if (used.center) next.center = v.center;

  next.width = v.lineWidth;
  next.strokeType = v.strokeType;

  // `format( const PCB_SHAPE* )` (pcb_io_kicad_sexpr.cpp:1071-1097) writes the
  // fill for a POLY, a RECTANGLE or a CIRCLE and for those three always.
  next.fillMode = v.fillMode;

  next.layer = v.layer;
  next.maskLayer = v.hasMask ? maskSideOf(v.layer) : undefined;

  next.solderMaskMargin = v.maskMargin ?? undefined;

  // `(net …)` carries the NAME, not the code (`pcb_io_kicad_sexpr.cpp:1116`,
  // emitted only when `GetNetCode() > 0`), so the board's table is what names it.
  next.net = v.net > 0 ? v.net : undefined;
  next.netName = v.net > 0 ? (board.nets.get(v.net) ?? '') : undefined;

  next.locked = v.locked;

  return { ...board, shapes: board.shapes.map((x, i) => (i === index ? next : x)) };
}
