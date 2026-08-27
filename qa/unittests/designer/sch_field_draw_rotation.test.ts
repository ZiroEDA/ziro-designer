// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The schematic painter draws a symbol field at `SCH_FIELD::GetDrawRotation()`,
 * never at its stored angle.
 *
 * `SCH_PAINTER::draw( const SCH_FIELD* )` asks the field how it is *drawn*
 * (sch_field.cpp:446-465), and that flips horizontal to vertical whenever the
 * parent symbol's transform has `y1 != 0`:
 *
 *     if( parentSymbol->GetTransform().y1 )   // Rotate symbol 90 degrees.
 *     {
 *         if( orient.IsHorizontal() ) orient = ANGLE_VERTICAL;
 *         else                        orient = ANGLE_HORIZONTAL;
 *     }
 *
 * The flip is why the autoplacer stores 90 on a 90°/270° symbol "to counteract
 * the transform and produce horizontal display" (autoplace_fields.cpp:119-121),
 * and it is what makes the stored angle a lie on its own: 90 stored draws level,
 * 0 stored draws on its side. A painter that reached for `field.angle`
 * (the symbol *editor*'s `drawField` does, correctly, because a library symbol
 * has no placement transform) would invert both cases.
 *
 * So this is a painting-path test, not an engine one: it drives
 * `renderSchematic` and reads the rotation it actually issues.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  renderSchematic,
  DEFAULT_RENDER_OPTS,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';

interface Call {
  op: string;
  args: unknown[];
}

function recorder(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        return (...args: unknown[]) => calls.push({ op: String(prop), args });
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D & { __calls: Call[] };
}

class FakePath2D {
  rect(): void {}
  moveTo(): void {}
  lineTo(): void {}
}

/**
 * One resistor turned 90°, with a single visible field whose *stored* angle is
 * the parameter. Value is emptied so exactly one field is painted.
 */
const SRC = (fieldAngle: 0 | 90): string => `(kicad_sch (version 20250114) (lib_symbols
  (symbol "Device:R"
    (symbol "R_0_1"
      (rectangle (start -1.02 2.54) (end 1.02 -2.54)
        (stroke (width 0.254) (type default)) (fill (type none))))))
  (symbol (lib_id "Device:R") (at 100 100 90) (unit 1) (uuid "r1")
    (property "Reference" "R1" (at 103 100 ${fieldAngle})
      (effects (font (size 1.27 1.27))))
    (property "Value" "" (at 103 102 0) (effects (font (size 1.27 1.27)))))
)`;

/**
 * Every `rotate` the painter issues, in radians.
 *
 * An empty list is the *expected* answer for the level case, so this also
 * checks the run painted something at all — a culled symbol would give an empty
 * list too, and the level assertion would pass without a field on screen.
 */
function rotations(fieldAngle: 0 | 90): number[] {
  const doc = readSchematic(parse(SRC(fieldAngle)));
  expect(doc.symbols[0]!.angle).toBe(90);
  expect(doc.symbols[0]!.fields[0]!.angle).toBe(fieldAngle);
  const ctx = recorder();
  const scale = 0.002;
  const orig = globalThis.Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
  try {
    renderSchematic(
      ctx,
      doc,
      { scale, offsetX: 400 - 1_000_000 * scale, offsetY: 300 - 1_000_000 * scale },
      KICAD_DEFAULT,
      800,
      600,
      new Set(),
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        showPageLimits: false,
        showDrawingSheet: false,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
      },
    );
  } finally {
    (globalThis as { Path2D?: unknown }).Path2D = orig;
  }
  // `drawText` translates to the anchor for every run it paints; if the symbol
  // and its field had been culled there would be none.
  expect(ctx.__calls.filter((c) => c.op === 'translate').length).toBeGreaterThanOrEqual(2);
  return ctx.__calls.filter((c) => c.op === 'rotate').map((c) => c.args[0] as number);
}

const QUARTER = Math.PI / 2;

describe('a symbol field on a 90° symbol', () => {
  it('draws a field stored at 90 level, because the transform flips it back', () => {
    // What the autoplacer produces, and what the user must see: the reference
    // of a rotated symbol still reads left-to-right.
    expect(rotations(90)).toEqual([]);
  });

  it('draws a field stored at 0 on its side, because the transform flips it', () => {
    // The other half of the same rule. A painter using the stored angle would
    // get this one right by accident and the one above wrong.
    expect(rotations(0)).toEqual([-QUARTER]);
  });
});
