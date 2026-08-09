// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The marks eeschema puts on a sheet while a drag is running, and the sheet
 * background it fills.
 *
 * Three things upstream draws that we did not:
 *
 *  - a **cross** at a selected label's anchor (`SCH_PAINTER::draw( SCH_TEXT )`,
 *    "Draw anchor"), which is the row of plus signs that appears down a column
 *    of net labels when a part they feed is dragged;
 *  - a **square** on the anchored end of each wire the drag is stretching
 *    (`drawDanglingIndicator` with `aDangling` false), which lands exactly on
 *    each new elbow;
 *  - the **sheet background**, which was never filled at all because an unset
 *    fill colour was mistaken for an explicitly transparent one.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, refId } from '@ziroeda/eeschema';
import {
  DEFAULT_RENDER_OPTS,
  renderSchematic,
  setVectorText,
} from '@ziroeda/designer/src/editors/schematic/render/renderer.js';
import { KICAD_DEFAULT } from '@ziroeda/designer/src/editors/schematic/theme.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';
import type { Theme } from '@ziroeda/designer/src/editors/schematic/theme.js';

interface Seg {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

/** Records stroked segments and filled/stroked rectangles. */
function spy(): {
  segs: Seg[];
  strokeRects: { x: number; y: number; w: number; h: number }[];
  fillRects: { colour: string; x: number; y: number; w: number; h: number }[];
  ctx: CanvasRenderingContext2D;
} {
  const segs: Seg[] = [];
  const strokeRects: { x: number; y: number; w: number; h: number }[] = [];
  const fillRects: { colour: string; x: number; y: number; w: number; h: number }[] = [];
  const noop = (): void => {};
  const state = { fillStyle: '', strokeStyle: '' };
  let pen: { x: number; y: number } | null = null;
  let pending: Seg[] = [];
  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    beginPath: () => {
      pending = [];
      pen = null;
    },
    moveTo: (x: number, y: number) => {
      pen = { x, y };
    },
    lineTo: (x: number, y: number) => {
      if (pen) pending.push({ a: pen, b: { x, y } });
      pen = { x, y };
    },
    closePath: noop,
    rect: noop,
    arc: noop,
    bezierCurveTo: noop,
    fill: noop,
    fillText: noop,
    drawImage: noop,
    clip: noop,
    stroke: () => {
      segs.push(...pending);
      pending = [];
    },
    strokeRect: (x: number, y: number, w: number, h: number) => strokeRects.push({ x, y, w, h }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      fillRects.push({ colour: state.fillStyle, x, y, w, h }),
  };
  return { segs, strokeRects, fillRects, ctx: ctx as unknown as CanvasRenderingContext2D };
}

const paint = (
  doc: Schematic,
  selection: ReadonlySet<string> | undefined,
  extra: Partial<typeof DEFAULT_RENDER_OPTS> = {},
  theme: Theme = KICAD_DEFAULT,
): ReturnType<typeof spy> => {
  const s = spy();
  setVectorText(true);
  try {
    renderSchematic(
      s.ctx,
      doc,
      { scale: 0.0005, offsetX: 0, offsetY: 0 },
      theme,
      1200,
      900,
      selection,
      undefined,
      {
        ...DEFAULT_RENDER_OPTS,
        grid: { ...DEFAULT_RENDER_OPTS.grid, show: false },
        showDrawingSheet: false,
        ...extra,
      },
    );
  } finally {
    setVectorText(false);
  }
  return s;
};

/** Is there a small axis-aligned cross centred on `at`? */
const crossAt = (s: ReturnType<typeof spy>, at: { x: number; y: number }): boolean => {
  const h = s.segs.some(
    (g) =>
      g.a.y === at.y && g.b.y === at.y && g.a.x < at.x && g.b.x > at.x && g.b.x - g.a.x < mmToIU(2),
  );
  const v = s.segs.some(
    (g) =>
      g.a.x === at.x && g.b.x === at.x && g.a.y < at.y && g.b.y > at.y && g.b.y - g.a.y < mmToIU(2),
  );
  return h && v;
};

describe("a selected label's anchor cross", () => {
  // A wire with a label at each end: the left one connected (not dangling).
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET1" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1"))
      (label "LOOSE" (at 60 80 0) (effects (font (size 1.27 1.27))) (uuid "l2")))`),
  );
  const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

  it('is absent when nothing is selected', () => {
    expect(crossAt(paint(doc, undefined), at(60, 60))).toBe(false);
  });

  it('appears on a selected label that is attached to something', () => {
    expect(crossAt(paint(doc, new Set(['l1'])), at(60, 60))).toBe(true);
  });

  it('but not on a dangling one, which already has an indicator', () => {
    // "Don't clutter things up if we're already showing a dangling indicator."
    expect(crossAt(paint(doc, new Set(['l2'])), at(60, 80))).toBe(false);
  });
});

describe('the anchored end of a wire being stretched', () => {
  // Both ends carry a label, so neither is dangling: the only squares on the
  // sheet are the drag's own. (A dangling end gets its own, larger, indicator —
  // DANGLING_SYMBOL_SIZE 12 mils against UNSELECTED_END_SIZE 4.)
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "A" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "la"))
      (label "B" (at 100 60 0) (effects (font (size 1.27 1.27))) (uuid "lb")))`),
  );
  const near = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
    Math.abs(r.x + r.w / 2 - mmToIU(x)) < 100 && Math.abs(r.y + r.h / 2 - mmToIU(y)) < 100;

  it('is marked with a small square, on the end that is *not* moving', () => {
    const s = paint(doc, new Set(['w1']), {
      draggedEnds: { startMoving: new Set(['w1']), endMoving: new Set() },
    });
    // The start moves, so the mark goes on the end.
    expect(s.strokeRects.some((r) => near(r, 100, 60))).toBe(true);
    expect(s.strokeRects.some((r) => near(r, 60, 60))).toBe(false);
  });

  it('follows the other end when the other end is the one dragged', () => {
    const s = paint(doc, new Set(['w1']), {
      draggedEnds: { startMoving: new Set(), endMoving: new Set(['w1']) },
    });
    expect(s.strokeRects.some((r) => near(r, 60, 60))).toBe(true);
  });

  it('is absent for a wire moving whole, which has no anchored end', () => {
    const s = paint(doc, new Set(['w1']), {
      draggedEnds: { startMoving: new Set(['w1']), endMoving: new Set(['w1']) },
    });
    expect(s.strokeRects.some((r) => near(r, 60, 60) || near(r, 100, 60))).toBe(false);
  });

  it('and absent entirely outside a drag', () => {
    expect(paint(doc, new Set(['w1'])).strokeRects.length).toBe(0);
  });
});

describe('a sheet whose stored fill is all zeroes', () => {
  // `COLOR4D::UNSPECIFIED` *is* `COLOR4D( 0, 0, 0, 0 )`, and that is what the
  // writer emits for a sheet with no background colour of its own — so it means
  // "unset", and upstream falls back to the theme. Reading it as an explicit
  // transparent colour meant the theme was never consulted and no sheet with a
  // KiCad-written fill was ever filled.
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (sheet (at 100 50) (size 40 30) (fill (color 0 0 0 0.0000)) (uuid "sh1")
        (property "Sheetname" "S" (at 100 49 0))
        (property "Sheetfile" "s.kicad_sch" (at 100 81 0))))`),
  );
  const SH = refId('sheet', 'sh1', 0);
  const themed: Theme = { ...KICAD_DEFAULT, sheetBackground: 'rgb(200, 220, 255)' };
  const body = (s: ReturnType<typeof spy>) =>
    s.fillRects.filter((r) => r.w === 400000 && r.h === 300000);

  it('falls back to the theme colour', () => {
    expect(body(paint(doc, undefined, {}, themed))[0]?.colour).toBe('rgb(200, 220, 255)');
  });

  it('and dims it when the sheet is selected', () => {
    expect(body(paint(doc, new Set([SH]), {}, themed))[0]?.colour).toBe('rgba(200, 220, 255, 0.5)');
  });

  it('still draws nothing when the theme leaves it transparent, as both builtins do', () => {
    // draw( SCH_SHEET ) gates on the *unselected* colour — "Only draw the
    // background if it has a visible alpha value" — so a sheet left on the
    // theme default stays unfilled even while it is selected. That is why a
    // KiCad sheet only turns colour once someone sets one in its properties.
    expect(body(paint(doc, new Set([SH])))).toHaveLength(0);
  });
});

describe("a selected sheet keeps its own colour's hue", () => {
  /**
   * Selection does not recolour a sheet. `getRenderColor` takes the sheet's own
   * background (falling back to the theme only when it is UNSPECIFIED) and then
   * forces the alpha:
   *
   *     else if( aItem->IsSelected() && isBackgroundLayer( aLayer ) )
   *         color = color.WithAlpha( 0.5 );
   *
   * `WithAlpha` *replaces* the alpha. Scaling it instead — which is what this
   * did — agrees only for a fully opaque colour, and makes a translucent one
   * fade when upstream makes it firmer.
   */
  const sheet = (fill: string): Schematic =>
    readSchematic(
      parse(`(kicad_sch (version 20250114) (lib_symbols)
        (sheet (at 100 50) (size 40 30) ${fill} (uuid "sh1")
          (property "Sheetname" "S" (at 100 49 0))
          (property "Sheetfile" "s.kicad_sch" (at 100 81 0))))`),
    );
  const SH = refId('sheet', 'sh1', 0);
  const body = (s: ReturnType<typeof spy>) =>
    s.fillRects.filter((r) => r.w === 400000 && r.h === 300000);

  it('at full strength when it is not selected', () => {
    const doc = sheet('(fill (color 170 230 255 1))');
    expect(body(paint(doc, undefined))[0]?.colour).toBe('rgb(170, 230, 255)');
  });

  it('and at half alpha — same hue — when it is', () => {
    const doc = sheet('(fill (color 170 230 255 1))');
    expect(body(paint(doc, new Set([SH])))[0]?.colour).toBe('rgba(170, 230, 255, 0.5)');
  });

  it('selecting a translucent one makes it firmer, not fainter', () => {
    const doc = sheet('(fill (color 170 230 255 0.25))');
    expect(body(paint(doc, undefined))[0]?.colour).toBe('rgba(170, 230, 255, 0.25)');
    // Scaling would have given 0.125.
    expect(body(paint(doc, new Set([SH])))[0]?.colour).toBe('rgba(170, 230, 255, 0.5)');
  });
});

describe('what counts as selected while a drag runs', () => {
  /**
   * `getConnectedDragItems` hands everything it picks up to
   * `m_selectionTool->AddItemToSel( item, QUIET_MODE )`, so the wires and
   * labels a drag grabbed are `IsSelected()` for the whole gesture — which is
   * why they carry the selection halo *and* the anchor cross in eeschema.
   *
   * The canvas only ever passed the app's selection, which during a symbol drag
   * is the symbol alone. No label could pass the gate, so the crosses could not
   * appear during a drag at all. `movingIds( spec )` is the equivalent set: the
   * selection plus the wire ends, riding labels, splits and stubs the plan
   * picked up.
   */
  const doc: Schematic = readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols)
      (wire (pts (xy 60 60) (xy 100 60)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET1" (at 60 60 0) (effects (font (size 1.27 1.27))) (uuid "l1")))`),
  );
  const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });

  it('a label the drag picked up gets its cross, though it was never selected', () => {
    // The symbol is what the user grabbed; the label came along for the ride.
    expect(crossAt(paint(doc, new Set(['some-symbol'])), at(60, 60))).toBe(false);
    expect(crossAt(paint(doc, new Set(['some-symbol', 'l1'])), at(60, 60))).toBe(true);
  });
});
