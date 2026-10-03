// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GRAPHICS_IMPORTER_PCBNEW builds live PCB_SHAPEs and PCB_TEXTs. The import
 * tests were written against the plain records it used to emit, and their
 * expectations are literals derived from the C++; this reads each live item
 * back through its own accessors into that record, so those literals keep
 * pinning what the importer builds. Nothing here computes an expectation.
 */
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/eda_text.js';
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import type { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LINE_STYLE } from '@ziroeda/common/stroke_params.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import { joinJustify } from '@ziroeda/pcbnew/dialogs/dialog_textbox_properties.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';

export interface SHAPE_RECORD {
  kind: 'line' | 'circle' | 'arc' | 'poly' | 'curve' | 'rect';
  start?: Vec2;
  end?: Vec2;
  center?: Vec2;
  mid?: Vec2;
  pts?: Vec2[];
  width: number;
  strokeType: string;
  fillMode: 'solid' | 'none';
  layer: string;
}

export interface TEXT_RECORD {
  kind: 'user';
  text: string;
  at: Vec2;
  angle: number;
  layer: string;
  size: Vec2;
  thickness: number;
  justify: string[];
}

export type IMPORTED_RECORD =
  | { type: 'shape'; shape: SHAPE_RECORD }
  | { type: 'text'; text: TEXT_RECORD };

/** `LINE_STYLE` as the board file spells it. */
export function strokeTypeOf(aStyle: LINE_STYLE): string {
  switch (aStyle) {
    case LINE_STYLE.DEFAULT:
      return 'default';
    case LINE_STYLE.SOLID:
      return 'solid';
    case LINE_STYLE.DASH:
      return 'dash';
    case LINE_STYLE.DOT:
      return 'dot';
    case LINE_STYLE.DASHDOT:
      return 'dash_dot';
    case LINE_STYLE.DASHDOTDOT:
      return 'dash_dot_dot';
  }
}

const pt = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });

function shapeRecord(s: PCB_SHAPE): SHAPE_RECORD {
  const base = {
    width: s.GetStroke().GetWidth(),
    strokeType: strokeTypeOf(s.GetStroke().GetLineStyle()),
    fillMode: s.IsSolidFill() ? ('solid' as const) : ('none' as const),
    layer: LSET_Name(s.GetLayer()),
  };

  switch (s.GetShape()) {
    case SHAPE_T.SEGMENT:
      return { kind: 'line', start: pt(s.GetStart()), end: pt(s.GetEnd()), ...base };
    case SHAPE_T.CIRCLE:
      return { kind: 'circle', center: pt(s.GetStart()), end: pt(s.GetEnd()), ...base };
    case SHAPE_T.ARC:
      return {
        kind: 'arc',
        start: pt(s.GetStart()),
        mid: pt(s.GetArcMid()),
        end: pt(s.GetEnd()),
        ...base,
      };
    case SHAPE_T.POLY:
      return { kind: 'poly', pts: s.GetPolyShape().COutline(0).CPoints().map(pt), ...base };
    case SHAPE_T.BEZIER:
      return {
        kind: 'curve',
        pts: [s.GetStart(), s.GetBezierC1(), s.GetBezierC2(), s.GetEnd()].map(pt),
        ...base,
      };
    default:
      return { kind: 'rect', start: pt(s.GetStart()), end: pt(s.GetEnd()), ...base };
  }
}

function textRecord(t: PCB_TEXT): TEXT_RECORD {
  const h = t.GetHorizJustify();
  const v = t.GetVertJustify();

  return {
    kind: 'user',
    text: t.GetText(),
    at: pt(t.GetTextPos()),
    angle: t.GetTextAngle().AsDegrees(),
    layer: LSET_Name(t.GetLayer()),
    size: pt(t.GetTextSize()),
    thickness: t.GetTextThickness(),
    justify: joinJustify(
      h === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT
        ? 'left'
        : h === GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_RIGHT
          ? 'right'
          : 'center',
      v === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP
        ? 'top'
        : v === GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
          ? 'bottom'
          : 'center',
      false,
    ),
  };
}

/** Each imported item, read back as the record the tests were written against. */
export function importedRecords(aItems: readonly BOARD_ITEM[]): IMPORTED_RECORD[] {
  return aItems.map((i) =>
    i instanceof PCB_TEXT
      ? { type: 'text' as const, text: textRecord(i) }
      : { type: 'shape' as const, shape: shapeRecord(i as PCB_SHAPE) },
  );
}

/** A layer map written in layer names, as the source formats' layer tables read. */
export function layerMap(aMap: Map<string, string | null>): Map<string, PCB_LAYER_ID | null> {
  return new Map(
    [...aMap].map(([k, v]) => [k, v === null ? null : (LSET_NameToLayer(v) as PCB_LAYER_ID)]),
  );
}
