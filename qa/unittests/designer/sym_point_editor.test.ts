// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The point editor in the symbol editor, and "Keep pins attached when dragging
 * edges" — the last row on Preferences > Symbol Editor > Editing Options that
 * stored a value nothing read.
 *
 * The coupling is upstream's and worth stating, because it is what decides the
 * shape of this port: `SCH_POINT_EDITOR` is ONE class registered by BOTH frames
 * — `sch_edit_frame.cpp:705` and `symbol_edit_frame.cpp:431` — over one
 * `pointEditorTypes` list, and the symbol-only behaviour sits INSIDE it behind
 * a frame check (`sch_point_editor.cpp:646-654`). So a rectangle carries the
 * same eight handles in either editor and the geometry is shared, rather than
 * a symbol-side copy that would drift.
 *
 * `dragPinsOnEdge` is narrower than its label suggests, in three ways a
 * plausible port gets wrong, and each is mutation-checked below:
 *
 *  1. only an EDGE drag moves pins. Corner drags deliberately do not, and
 *     upstream gives the reason (`:583-586`): it is "an escape hatch to avoid
 *     moving pins", and it dodges pins falling off the end of one of the two
 *     segments a corner drag moves;
 *  2. a pin is caught by its ROOT — the body end — not by its connection point,
 *     which is at the other end of the pin and never touches the outline;
 *  3. the ends of the segment are EXCLUDED (`aIncludeEnds = false`), so a pin
 *     sitting exactly on a corner is not dragged by either edge that meets
 *     there.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibPin, LibSymbol } from '@ziroeda/eeschema';
import { ArcEditMode } from '@ziroeda/eeschema/src/tools/arc_edit.js';
import { graphicHandles, pinRoot, pinRootOnSeg } from '@ziroeda/eeschema/src/tools/point_editor.js';
import { dragSymbolHandle, symbolEditHandles } from '@ziroeda/designer/src/editors/symbol/edits.js';
import { mmToIU } from '@ziroeda/common';

/**
 * A symbol with one rectangle from (-10,-10) to (10,10) in mm, and pins the
 * caller places. The rectangle's LEFT edge is x = -10.
 */
const sym = (pins: string): LibSymbol =>
  readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "qa")
      (symbol "U" (pin_names (offset 0))
        (property "Reference" "U" (at 0 0 0))
        (property "Value" "U" (at 0 0 0))
        (symbol "U_1_1"
          (rectangle (start -10 10) (end 10 -10)
            (stroke (width 0.254) (type default)) (fill (type none)))
          ${pins})))`),
  )[0] as LibSymbol;

/** A pin whose ROOT lands on the left edge at y, pointing right into the body. */
const leftPin = (yMM: number, n: string): string =>
  `(pin input line (at -12.7 ${yMM} 0) (length 2.7)
     (name "P${n}" (effects (font (size 1.27 1.27))))
     (number "${n}" (effects (font (size 1.27 1.27)))))`;

const rect = (s: LibSymbol) => s.units.flatMap((u) => u.graphics)[0]!;
/** The rectangle's left edge, x of `start`. Narrowed once, not per assertion. */
const rectStartX = (s: LibSymbol): number => {
  const g = rect(s);
  expect(g.kind).toBe('rectangle');
  return g.kind === 'rectangle' ? g.start.x : Number.NaN;
};
const pins = (s: LibSymbol): LibPin[] => s.units.flatMap((u) => u.pins);
const opts = (dragPins: boolean) => ({
  arcMode: ArcEditMode.KeepCenterAdjustAngleRadius,
  dragPins,
});

describe('the handles are the shared behaviour’s, not a second set', () => {
  it('a rectangle gets the same eight in the symbol editor as in the schematic', () => {
    // Four corners, a centre, and four edge lines — `rectHandles`, which is
    // `RECTANGLE_POINT_EDIT_BEHAVIOR::MakePoints`.
    const s = sym('');
    const mine = symbolEditHandles(s, 'gfx:0:0');
    expect(mine).toEqual(graphicHandles(rect(s)));
    expect(mine.filter((h) => h.kind === 'point').length).toBe(5);
    expect(mine.filter((h) => h.kind === 'line').length).toBe(4);
  });

  it('is empty for an id that is not a shape', () => {
    expect(symbolEditHandles(sym(leftPin(0, '1')), 'pin:0:0')).toEqual([]);
    expect(symbolEditHandles(sym(''), 'gfx:0:9')).toEqual([]);
  });
});

describe('GetPinRoot', () => {
  it('is the BODY end, opposite the connection point', () => {
    // A right-facing pin at x with length L connects at x and roots at x+L.
    expect(pinRoot({ at: { x: 0, y: 0 }, angle: 0, length: 100 })).toEqual({ x: 100, y: 0 });
    expect(pinRoot({ at: { x: 0, y: 0 }, angle: 180, length: 100 })).toEqual({ x: -100, y: 0 });
    expect(pinRoot({ at: { x: 0, y: 0 }, angle: 90, length: 100 })).toEqual({ x: 0, y: -100 });
    expect(pinRoot({ at: { x: 0, y: 0 }, angle: 270, length: 100 })).toEqual({ x: 0, y: 100 });
  });
});

describe('getPinsOnSeg excludes the segment ends', () => {
  const seg: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ];

  it('takes a root strictly between the ends', () => {
    expect(pinRootOnSeg({ x: 0, y: 50 }, seg)).toBe(true);
  });

  it('refuses one exactly on either end, which is the corner case', () => {
    // `aIncludeEnds = false`: a pin on a corner would otherwise be dragged by
    // both of the edges meeting there.
    expect(pinRootOnSeg({ x: 0, y: 0 }, seg)).toBe(false);
    expect(pinRootOnSeg({ x: 0, y: 100 }, seg)).toBe(false);
  });

  it('refuses one off the line, and one past the end', () => {
    expect(pinRootOnSeg({ x: 5, y: 50 }, seg)).toBe(false);
    expect(pinRootOnSeg({ x: 0, y: 150 }, seg)).toBe(false);
  });
});

describe('dragging the LEFT edge', () => {
  // The left edge line is handle index 3 (RECT_LEFT) of kind 'line'.
  const leftEdge = (s: LibSymbol) =>
    symbolEditHandles(s, 'gfx:0:0').find((h) => h.kind === 'line' && h.index === 3)!;

  it('carries a pin whose root sits on it, by the same vector', () => {
    const s = sym(leftPin(0, '1'));
    const before = pins(s)[0]!;
    // Drag the left edge from x = -10mm out to x = -15mm.
    const out = dragSymbolHandle(s, 'gfx:0:0', leftEdge(s), { x: mmToIU(-15), y: 0 }, opts(true));
    const after = pins(out)[0]!;
    expect(after.at.x).toBe(before.at.x + mmToIU(-5));
    expect(after.at.y).toBe(before.at.y);
    // ...and the rectangle really did move, so this is not a no-op passing.
    expect(rectStartX(out)).toBe(mmToIU(-15));
  });

  it('leaves the pin alone when the setting is off', () => {
    // The whole of what the checkbox does: the shape still resizes.
    const s = sym(leftPin(0, '1'));
    const before = pins(s)[0]!;
    const out = dragSymbolHandle(s, 'gfx:0:0', leftEdge(s), { x: mmToIU(-15), y: 0 }, opts(false));
    expect(pins(out)[0]!.at).toEqual(before.at);
    expect(rectStartX(out)).toBe(mmToIU(-15));
  });

  it('leaves a pin on the TOP edge alone — wrong segment, not just wrong axis', () => {
    // Root on the top edge (y = +10mm in the file's frame), so the left-edge
    // drag must not touch it even though both are "on the outline".
    const s = sym(
      `(pin input line (at 0 12.7 270) (length 2.7)
         (name "T" (effects (font (size 1.27 1.27))))
         (number "9" (effects (font (size 1.27 1.27)))))`,
    );
    const before = pins(s)[0]!;
    const out = dragSymbolHandle(s, 'gfx:0:0', leftEdge(s), { x: mmToIU(-15), y: 0 }, opts(true));
    expect(pins(out)[0]!.at).toEqual(before.at);
  });

  it('does nothing when the edge did not actually move', () => {
    // `if( aMoveVecs[i] == VECTOR2I( 0, 0 ) … ) continue;`
    //
    // Asserted by IDENTITY, not by value: moving a pin by (0,0) produces an
    // equal pin, so `toEqual` cannot tell the guard from its absence. The
    // guard's observable effect is that the pin objects are not rebuilt at all.
    const s = sym(leftPin(0, '1'));
    const before = pins(s)[0]!;
    const out = dragSymbolHandle(s, 'gfx:0:0', leftEdge(s), { x: mmToIU(-10), y: 0 }, opts(true));
    expect(pins(out)[0]).toBe(before);
  });
});

describe('a CORNER drag never moves pins', () => {
  it('resizes the shape and leaves every pin where it was', () => {
    // `:583-586` — the escape hatch, and the reason it exists.
    //
    // The pin is on the TOP edge, not the left one, and that is deliberate:
    // RECT_TOPLEFT and RECT_TOP are both index 0, differing only in `kind`. A
    // `draggedRectEdge` that forgets to check `kind` reads this corner as the
    // top EDGE — so a test whose pin sits on the left edge passes either way
    // and proves nothing.
    const s = sym(
      `(pin input line (at 0 12.7 270) (length 2.7)
         (name "T" (effects (font (size 1.27 1.27))))
         (number "9" (effects (font (size 1.27 1.27)))))`,
    );
    const before = pins(s)[0]!;
    const topLeft = symbolEditHandles(s, 'gfx:0:0').find(
      (h) => h.kind === 'point' && h.index === 0,
    )!;
    const out = dragSymbolHandle(
      s,
      'gfx:0:0',
      topLeft,
      { x: mmToIU(-15), y: mmToIU(15) },
      opts(true),
    );
    expect(pins(out)[0]!.at).toEqual(before.at);
    expect(rectStartX(out)).toBe(mmToIU(-15));
  });
});

describe('a pin exactly on a corner', () => {
  it('is not dragged by the edge that ends there', () => {
    // Root at (-10, +10) mm, the top-left corner: on both the left and the top
    // segment, and excluded from each by `aIncludeEnds = false`.
    const s = sym(
      `(pin input line (at -12.7 10 0) (length 2.7)
         (name "C" (effects (font (size 1.27 1.27))))
         (number "8" (effects (font (size 1.27 1.27)))))`,
    );
    const before = pins(s)[0]!;
    const leftEdge = symbolEditHandles(s, 'gfx:0:0').find(
      (h) => h.kind === 'line' && h.index === 3,
    )!;
    const out = dragSymbolHandle(s, 'gfx:0:0', leftEdge, { x: mmToIU(-15), y: 0 }, opts(true));
    expect(pins(out)[0]!.at).toEqual(before.at);
  });
});

describe('one tool, both frames — the coupling upstream has', () => {
  const read = (rel: string): string =>
    readFileSync(join(fileURLToPath(new URL('../../../', import.meta.url)), rel), 'utf8');

  it('the symbol canvas uses the shared behaviours, not a second set', () => {
    // `SCH_POINT_EDITOR` is ONE class registered by both frames. A symbol-side
    // reimplementation of the handle geometry is the thing this asserts against
    // — it would be two answers to "where are a rectangle's handles".
    const edits = read('designer/src/editors/symbol/edits.ts');
    expect(edits).toContain("from '@ziroeda/eeschema/src/tools/point_editor.js'");
    expect(edits).toContain('graphicHandles(');
    expect(edits).toContain('dragGraphic(');
    // Nothing symbol-side may compute a handle position of its own.
    expect(edits, 'symbol-side rectHandles').not.toMatch(/function\s+rectHandles\b/);
  });

  it('the symbol-only branch lives in the shared tool, where upstream keeps it', () => {
    // `dragPinsOnEdge` is a private method of SCH_POINT_EDITOR behind a
    // `m_frame.IsType( FRAME_SCH_SYMBOL_EDITOR )` check, not a separate tool.
    const pe = read('eeschema/src/tools/point_editor.ts');
    expect(pe).toContain('export function draggedRectEdge');
    expect(pe).toContain('export function pinRootOnSeg');
    expect(pe).toContain('export function pinRoot');
  });

  it('the checkbox is no longer greyed, and the canvas reads it', () => {
    const page = read('designer/src/editors/symbol/prefs/PanelSymbolEditorEditingOptions.tsx');
    const at = page.indexOf('label="Keep pins attached when dragging edges"');
    expect(at).toBeGreaterThan(-1);
    expect(page.slice(at, page.indexOf('/>', at))).not.toContain('disabled');
    expect(read('designer/src/editors/symbol/SymbolCanvas.tsx')).toContain(
      'symCfg.drag_pins_along_with_edges',
    );
  });
});
