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

import { IN_EDIT } from '@ziroeda/common/eda_item_flags.js';
import { SHAPE_T, UI_FILL_MODE } from '@ziroeda/common/eda_shape.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { LINE_STYLE, LINE_STYLE_NAMES } from '@ziroeda/common/stroke_params.js';
import { EVENTS } from '@ziroeda/common/tool/tool_event.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_EDIT_FRAME } from '../pcb_base_edit_frame.js';
import type { PCB_SHAPE } from '../pcb_shape.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { LineStyleToken } from '@ziroeda/common/stroke_params.js';

/** The shape the window names, SHAPE_T as the file spells it. */
export type ShapeKind = 'line' | 'arc' | 'circle' | 'rect' | 'poly' | 'curve';

/** The mask layer that pairs with a graphic's own layer, F.SilkS -> F.Mask. */
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
  kind: ShapeKind;
  lineWidth: number;
  strokeType: LineStyleToken;
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
export function shapePointsUsed(aShape: SHAPE_T): {
  start: boolean;
  end: boolean;
  mid: boolean;
  center: boolean;
} {
  switch (aShape) {
    case SHAPE_T.SEGMENT:
    case SHAPE_T.RECTANGLE:
      return { start: true, end: true, mid: false, center: false };
    case SHAPE_T.ARC:
      return { start: true, end: true, mid: true, center: false };
    case SHAPE_T.CIRCLE:
      return { start: false, end: true, mid: false, center: true };
    default:
      // A polygon or bezier is edited by the point editor, not this dialog.
      return { start: false, end: false, mid: false, center: false };
  }
}

/** Resolve a `shape:N` id, or null when the selection is not one shape. */
const ZERO: Vec2 = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// DIALOG_SHAPE_PROPERTIES over the live PCB_SHAPE (#636 stage 6)

const SHAPE_KIND: Partial<Record<SHAPE_T, ShapeKind>> = {
  [SHAPE_T.SEGMENT]: 'line',
  [SHAPE_T.RECTANGLE]: 'rect',
  [SHAPE_T.ARC]: 'arc',
  [SHAPE_T.CIRCLE]: 'circle',
  [SHAPE_T.POLY]: 'poly',
  [SHAPE_T.BEZIER]: 'curve',
};

/**
 * `m_fillCtrl`'s selection, `UI_FILL_MODE`, as the window holds it - a
 * board-file spelling, so `solid` where the file writes FILLED_WITH_COLOR.
 */
export type PcbFillMode = 'none' | 'solid' | 'hatch' | 'reverse_hatch' | 'cross_hatch';

/** `m_fillCtrl`'s entries in UI_FILL_MODE order; their labels are FILL_MODE_NAMES. */
export const FILL_MODES: readonly PcbFillMode[] = [
  'none',
  'solid',
  'hatch',
  'reverse_hatch',
  'cross_hatch',
];

/**
 * `DIALOG_SHAPE_PROPERTIES` (dialog_shape_properties.cpp) on a live
 * PCB_SHAPE. The geometry controls are the GEOM_SYNCERs' — start/end for a
 * segment or rectangle, start/mid/end for an arc, centre and a rim point for
 * a circle, none for a polygon or curve — and OK is one BOARD_COMMIT,
 * "Edit Shape Properties", after `Validate()`.
 *
 * The C++ dialog never changes the shape's type: `kind` is reported, and a
 * different one in the values is ignored.
 */
export class DIALOG_SHAPE_PROPERTIES {
  private readonly m_parent: PCB_BASE_EDIT_FRAME;
  private readonly m_item: PCB_SHAPE;

  constructor(aParent: PCB_BASE_EDIT_FRAME, aShape: PCB_SHAPE) {
    this.m_parent = aParent;
    this.m_item = aShape;
  }

  /** `m_item->GetShape()`, which decides the dialog's controls (the constructor's switch). */
  GetShape(): SHAPE_T {
    return this.m_item.GetShape();
  }

  TransferDataToWindow(): ShapeValues {
    const item = this.m_item;
    const style = item.GetStroke().GetLineStyle();
    const shape = item.GetShape();

    return {
      start: item.GetStart(),
      end: item.GetEnd(),
      mid: shape === SHAPE_T.ARC ? item.GetArcMid() : ZERO,
      center: shape === SHAPE_T.ARC || shape === SHAPE_T.CIRCLE ? item.GetCenter() : ZERO,
      kind: SHAPE_KIND[shape] ?? 'line',
      lineWidth: item.GetStroke().GetWidth(),
      // `style >= 0 && style < lineTypeNames.size()`, else the first entry
      strokeType: LINE_STYLE_NAMES.find((d) => d.style === style)?.value ?? 'solid',
      cornerRadius: shape === SHAPE_T.RECTANGLE ? item.GetCornerRadius() : 0,
      fillMode: FILL_MODES[item.GetFillModeProp()] ?? 'none',
      layer: LSET_Name(item.GetLayer()),
      // `if( net >= 0 ) SetSelectedNetcode( net )`, else indeterminate
      net: Math.max(item.GetNetCode(), 0),
      hasMask: item.HasSolderMask(),
      maskMargin: item.GetLocalSolderMaskMargin() ?? null,
      locked: item.IsLocked(),
    };
  }

  /** `Validate()`: the geometry syncer's checks and the type-specific ones. */
  Validate(v: ShapeValues): string[] {
    const errors: string[] = [];
    const shape = this.m_item.GetShape();
    const eq = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
    const filled = v.fillMode === 'solid';

    switch (shape) {
      case SHAPE_T.RECTANGLE:
        if (eq(v.start, v.end)) errors.push('Rectangle cannot be zero-sized.');
        break;
      case SHAPE_T.ARC:
        if (eq(v.start, v.mid) || eq(v.mid, v.end) || eq(v.start, v.end))
          errors.push('Arc must have 3 distinct points');
        break;
      case SHAPE_T.CIRCLE:
        if (eq(v.center, v.end)) errors.push('Radius must be greater than 0');
        break;
      default:
        break;
    }

    switch (shape) {
      case SHAPE_T.ARC:
      case SHAPE_T.SEGMENT:
        if (v.lineWidth <= 0) errors.push('Line width must be greater than zero.');
        break;
      case SHAPE_T.CIRCLE:
        if (!filled && v.lineWidth <= 0)
          errors.push('Line width must be greater than zero for an unfilled circle.');
        break;
      case SHAPE_T.RECTANGLE: {
        if (!filled && v.lineWidth <= 0)
          errors.push('Line width must be greater than zero for an unfilled rectangle.');

        const shortSide = Math.min(Math.abs(v.end.x - v.start.x), Math.abs(v.end.y - v.start.y));

        if (v.cornerRadius > 0 && v.cornerRadius * 2 > shortSide)
          errors.push('Corner radius must be less than or equal to half the smaller side.');
        break;
      }
      case SHAPE_T.POLY:
        if (!filled && v.lineWidth <= 0)
          errors.push('Line width must be greater than zero for an unfilled polygon.');
        break;
      case SHAPE_T.BEZIER:
        if (!filled && v.lineWidth <= 0)
          errors.push('Line width must be greater than zero for an unfilled curve.');
        break;
      default:
        break;
    }

    return errors;
  }

  TransferDataFromWindow(v: ShapeValues): TransferResult {
    const errors = this.Validate(v);

    if (errors.length > 0) return { ok: false, message: errors.join('\n') };

    const item = this.m_item;
    const layer = LSET_NameToLayer(v.layer);

    const commit = new BOARD_COMMIT(this.m_parent);
    commit.Modify(item);

    const pushCommit = item.GetEditFlags() === 0;

    if (!pushCommit) item.SetFlags(IN_EDIT);

    // *m_item = m_workingCopy: the geometry the syncers edited
    switch (item.GetShape()) {
      case SHAPE_T.SEGMENT:
      case SHAPE_T.RECTANGLE:
        item.SetStart(v.start);
        item.SetEnd(v.end);
        break;
      case SHAPE_T.ARC:
        item.SetArcGeometry(v.start, v.mid, v.end);
        break;
      case SHAPE_T.CIRCLE:
        item.SetCenter(v.center);
        item.SetEnd(v.end);
        break;
      default:
        break;
    }

    const wasLocked = item.IsLocked();

    if (item.GetShape() === SHAPE_T.RECTANGLE) item.SetCornerRadius(v.cornerRadius);

    item.SetFillModeProp(Math.max(FILL_MODES.indexOf(v.fillMode), 0) as UI_FILL_MODE);
    item.SetLocked(v.locked);

    item.SetWidth(v.lineWidth);

    const desc = LINE_STYLE_NAMES.find((d) => d.value === v.strokeType);
    item.SetLineStyle(desc ? desc.style : LINE_STYLE.SOLID);

    item.SetLayer(layer);

    item.SetHasSolderMask(v.hasMask);
    item.SetLocalSolderMaskMargin(v.maskMargin ?? undefined);

    item.RebuildBezierToSegmentsPointsList(item.GetMaxError());

    if (item.IsOnCopperLayer()) item.SetNetCode(v.net);
    else item.SetNetCode(-1);

    if (pushCommit) commit.Push('Edit Shape Properties');

    // Notify clients which treat locked and unlocked items differently (ie: POINT_EDITOR)
    if (wasLocked !== item.IsLocked())
      this.m_parent.GetToolManager()?.PostEvent(EVENTS.SelectedEvent);

    return { ok: true };
  }
}
