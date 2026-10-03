// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Text and Shape properties for board graphics (DIALOG_TEXT_PROPERTIES,
 * DIALOG_SHAPE_PROPERTIES).
 */
import { describe, it, expect } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { parse } from '@ziroeda/sexpr/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { textAt, type TextValues } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import {
  shapePointsUsed,
  type ShapeValues,
} from '@ziroeda/pcbnew/dialogs/dialog_shape_properties.js';
import type { Board, PcbShape } from '@ziroeda/pcbnew/types.js';
import { U, emptyBoard, flatText, writtenItems, writtenNodes } from './support/written_node.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
/** The written items, one line, header excluded. */
const flat = (b: Board): string => writtenItems(b);

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (gr_text "hello" (at 10 20 30) (layer "F.SilkS") (uuid "${U('x1')}")
    (effects (font (size 1.5 1) (thickness 0.2) (bold yes)) (justify left)))
  (gr_line (start 0 0) (end 10 0) (stroke (width 0.15) (type dash)) (layer "F.SilkS") (uuid "${U('s1')}"))
  (gr_circle (center 30 30) (end 35 30) (stroke (width 0.1) (type solid)) (fill solid)
    (layer "B.SilkS") (uuid "${U('s2')}"))
  (gr_arc (start 40 40) (mid 45 45) (end 50 40) (stroke (width 0.1) (type solid))
    (layer "Edge.Cuts") (uuid "${U('s3')}"))
)`;

describe('shapePointsUsed', () => {
  it('names the points each kind owns', () => {
    expect(shapePointsUsed(SHAPE_T.SEGMENT)).toEqual({
      start: true,
      end: true,
      mid: false,
      center: false,
    });
    expect(shapePointsUsed(SHAPE_T.ARC)).toEqual({
      start: true,
      end: true,
      mid: true,
      center: false,
    });
    expect(shapePointsUsed(SHAPE_T.CIRCLE)).toEqual({
      start: false,
      end: true,
      mid: false,
      center: true,
    });
    expect(shapePointsUsed(SHAPE_T.POLY)).toEqual({
      start: false,
      end: false,
      mid: false,
      center: false,
    });
  });
});
