// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reader: `.kicad_pcb` / `.kicad_mod` text -> the typed `Board` view.
 *
 * `PCB_IO_KICAD_SEXPR_PARSER` (pcb_io/kicad_sexpr/) builds the BOARD; the
 * `Board` returned here is its view (`boardFromBOARD`). Footprint children are
 * stored board-absolute in the view: `fpPos + RotatePoint(local, fpAngle)`,
 * with RotatePoint (libs/kimath/src/trigo.cpp): x' = x·cos + y·sin,
 * y' = y·cos − x·sin.
 */

import { head, type SList } from '@ziroeda/sexpr/src/types.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';
import type { BOARD } from './board.js';
import type { FOOTPRINT } from './footprint.js';
import {
  boardFromBOARD,
  footprintViewOfBoard,
  footprintViewOfLibrary,
} from './pcb_io/kicad_sexpr/board_view.js';
import { PCB_IO_KICAD_SEXPR_PARSER } from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { KICAD_T } from '@ziroeda/core/src/typeinfo.js';
import type { Board, PcbFootprint } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** KiCad RotatePoint (trigo.cpp): screen coords, angle in degrees. */
export function rotatePcb(p: Vec2, angleDeg: number): Vec2 {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const x = Math.round(p.y * s + p.x * c);
  const y = Math.round(p.y * c - p.x * s);
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** `DEFAULT_PT_SIZE_MM` (`pcb_point.cpp:41`), the size of a `PCB_POINT` built without one. */
export const DEFAULT_POINT_SIZE = mmToIU(1.0);

/** Sample a 3-point arc into a polyline (~5° steps), endpoints exact. */
export function tessellateArc(start: Vec2, mid: Vec2, end: Vec2): Vec2[] {
  const c = arcCenter(start, mid, end);
  if (!c) return [start, mid, end];
  const r = Math.hypot(start.x - c.x, start.y - c.y);
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  // Sweep from a0 through am to a1: pick the direction that passes mid.
  const ccwSweep = (from: number, to: number): number => {
    let d = to - from;
    while (d < 0) d += Math.PI * 2;
    return d;
  };
  const sweepCCW = ccwSweep(a0, a1);
  const midCCW = ccwSweep(a0, am);
  const useCCW = midCCW <= sweepCCW;
  const sweep = useCCW ? sweepCCW : sweepCCW - Math.PI * 2;
  const steps = Math.max(2, Math.min(96, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));
  const pts: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    pts.push({ x: Math.round(c.x + r * Math.cos(a)), y: Math.round(c.y + r * Math.sin(a)) });
  }
  pts[0] = start;
  pts[pts.length - 1] = end;
  return pts;
}

/** Circumcentre of three points, or null when collinear. */
export function arcCenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

/**
 * Read a standalone `.kicad_mod` file (a top-level `(footprint …)` node) into a
 * footprint in its own LOCAL frame, the form the Footprint Editor works in.
 * A library footprint carries no board placement, so children keep their stored
 * (footprint-relative) coordinates: no transform is baked in and the anchor sits
 * at the origin. This is the library-cache load path of KiCad's
 * `PCB_IO_KICAD_SEXPR_PARSER::parseFOOTPRINT` (the footprint is not re-based onto
 * a board), as opposed to `readBoardFootprint`, which bakes children to board coords.
 */
export function readFootprintFile(input: string | SList): PcbFootprint | null {
  if (typeof input !== 'string') {
    const h = head(input);
    if (h !== 'footprint' && h !== 'module') return null;
  }
  const text = typeof input === 'string' ? input : serialize(input);
  try {
    return footprintViewOfLibrary(ParseFootprintFile(text));
  } catch {
    return null;
  }
}

/**
 * A `(footprint …)` node read in BOARD context: children are baked from
 * footprint-local to board coordinates through the node's `(at …)` placement, the
 * same path the board reader takes. This is how a library footprint becomes a
 * board footprint (KiCad's `LoadFootprintFromProject` + `FOOTPRINT::SetPosition`,
 * used by BOARD_NETLIST_UPDATER::addNewFootprint).
 */
export function readBoardFootprint(input: string | SList): PcbFootprint | null {
  if (typeof input !== 'string') {
    const h = head(input);
    if (h !== 'footprint' && h !== 'module') return null;
  }
  const text = typeof input === 'string' ? input : serialize(input);
  try {
    return footprintViewOfBoard(ParseFootprintFile(text));
  } catch {
    return null;
  }
}

/**
 * Read a `.kicad_pcb` document. The KiCad parser builds the model and the
 * Board is its view. A pre-parsed tree is accepted for the callers that still
 * hold one; it is serialised and read again.
 */
export function readBoard(input: string | SList): Board {
  const text = typeof input === 'string' ? input : serialize(input);
  return boardFromBOARD(ParseBoard(text));
}

/** `PCB_IO_KICAD_SEXPR::LoadBoard` for a string: the parser over it, a BOARD back. */
export function ParseBoard(text: string, source = 'board'): BOARD {
  const item = new PCB_IO_KICAD_SEXPR_PARSER(text, source).Parse();
  if (item.Type() !== KICAD_T.PCB_T) throw new Error('Not a board file');
  return item as BOARD;
}

/**
 * `PCB_IO_KICAD_SEXPR::ImportFootprint` for a string: a `(footprint …)` file
 * parsed on its own, no board.
 */
export function ParseFootprintFile(text: string, source = 'footprint'): FOOTPRINT {
  const item = new PCB_IO_KICAD_SEXPR_PARSER(text, source).Parse();
  if (item.Type() !== KICAD_T.PCB_FOOTPRINT_T) throw new Error('Not a footprint file');
  return item as FOOTPRINT;
}
