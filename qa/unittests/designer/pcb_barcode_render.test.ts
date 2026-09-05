// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What a `PCB_BARCODE` puts on the canvas.
 *
 * `PCB_PAINTER::draw( const PCB_BARCODE*, int )` (`pcb_painter.cpp:3061-3079`)
 * is five lines and one of them matters here:
 *
 *     m_gal->SetIsFill( true );
 *     m_gal->SetIsStroke( false );
 *     m_gal->SetFillColor( color );
 *     aBarcode->TransformShapeToPolySet( shape, aBarcode->GetLayer(), … );
 *     m_gal->DrawPolygon( shape );
 *
 * — `SetIsFill( true )` unconditionally, with no `outline_mode` branch. Every
 * other graphic consults `m_DisplayGraphicsFill`, and a barcode does not,
 * because an unfilled barcode does not scan. That is why it has a path of its
 * own here rather than sharing `gfxFill`.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type ScenePathFactory,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { PCB_LAYER_COLORS } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

interface Op {
  op: string;
  args: number[];
}

class RecordingPath {
  ops: Op[] = [];
  private push(op: string, args: number[]): void {
    this.ops.push({ op, args });
  }
  moveTo(...a: number[]): void {
    this.push('moveTo', a);
  }
  lineTo(...a: number[]): void {
    this.push('lineTo', a);
  }
  arc(...a: number[]): void {
    this.push('arc', a);
  }
  arcTo(...a: number[]): void {
    this.push('arcTo', a);
  }
  rect(...a: number[]): void {
    this.push('rect', a);
  }
  roundRect(...a: number[]): void {
    this.push('roundRect', a);
  }
  closePath(): void {
    this.push('closePath', []);
  }
  addPath(other: RecordingPath): void {
    this.ops.push(...other.ops);
  }
}
class RecordingMatrix {
  translate(): RecordingMatrix {
    return this;
  }
  rotate(): RecordingMatrix {
    return this;
  }
}
const FACTORY: ScenePathFactory = {
  path: () => new RecordingPath() as unknown as Path2D,
  matrix: () => new RecordingMatrix() as unknown as DOMMatrix,
};
const rec = (p: Path2D): RecordingPath => p as unknown as RecordingPath;

interface Fill {
  path: RecordingPath;
  style: string;
  rule: string;
}

/** Every `fill(path)` a pass made, with the style in force at the time. */
function fills(board: Board, opts = {}, visible = ['F.Cu', 'F.SilkS', 'Dwgs.User']): Fill[] {
  const scene = buildScene(board, {}, FACTORY);
  const out: Fill[] = [];
  let style = '';
  const ctx = {
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set fillStyle(v: string) {
      style = v;
    },
    set globalAlpha(_v: number) {},
    set font(_v: string) {},
    set lineCap(_v: string) {},
    set lineJoin(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    canvas: { width: 800, height: 600 },
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clearRect: () => {},
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 0 }),
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    drawImage: () => {},
    stroke: () => {},
    fill: (p?: Path2D | string, r?: string) => {
      if (p && typeof p !== 'string') out.push({ path: rec(p), style, rule: r ?? 'nonzero' });
    },
  } as unknown as CanvasRenderingContext2D;

  for (const step of buildDrawSteps(
    ctx,
    scene,
    { scale: 1, tx: 0, ty: 0, flipX: false },
    new Set(visible),
    800,
    600,
    { ...DEFAULT_DRAW_OPTIONS, drawingSheet: false, ...opts },
  ))
    step();
  return out;
}

const boardWith = (...items: string[]): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (37 "F.SilkS" user "F.Silkscreen") (44 "Dwgs.User" user))
  (net 0 "")
  ${items.join('\n  ')}
)`),
  );

const barcodeOn = (layer: string, knockout = false): string =>
  `(barcode (at 10 20 0) (layer "${layer}") (size 8 8) (text "ZIRO")
     (text_height 1.27) (type qr) (ecc_level L) (hide yes)
     (knockout ${knockout ? 'yes' : 'no'}))`;

/** A closed sub-path is one module run; a QR code has dozens. */
const closedSubPaths = (p: RecordingPath): number =>
  p.ops.filter((o) => o.op === 'closePath').length;

/** The barcode fill, identified by being the one with many closed sub-paths. */
const barcodeFill = (f: Fill[]): Fill | undefined => f.find((x) => closedSubPaths(x.path) > 10);

describe('the fill', () => {
  it('draws the modules as closed sub-paths in the layer’s colour', () => {
    const f = barcodeFill(fills(boardWith(barcodeOn('F.SilkS'))));

    expect(f).toBeDefined();
    expect(f!.style).toBe(PCB_LAYER_COLORS['F.SilkS']);
    // `DrawPolygon` with a fractured poly set: one ring per polygon, so the
    // nonzero rule is the right one and even-odd would cancel a knockout's
    // slits against its outline.
    expect(f!.rule).toBe('nonzero');
  });

  it('follows the barcode’s own layer, not the active one', () => {
    const f = barcodeFill(fills(boardWith(barcodeOn('Dwgs.User'))));

    expect(f!.style).toBe(PCB_LAYER_COLORS['Dwgs.User']);
  });

  it('is hidden with its layer', () => {
    expect(barcodeFill(fills(boardWith(barcodeOn('F.SilkS')), {}, ['F.Cu']))).toBeUndefined();
  });

  it('is NOT unfilled by "Sketch graphic items"', () => {
    // The one thing this file exists to pin. `graphicFill: false` is
    // `m_DisplayGraphicsFill` off, which hollows out every filled shape —
    // `draw( const PCB_BARCODE* )` never reads it, and a hollow barcode is
    // unreadable.
    const sketched = fills(boardWith(barcodeOn('F.SilkS')), { graphicFill: false });

    expect(barcodeFill(sketched)).toBeDefined();
  });

  it('and a filled graphic beside it IS', () => {
    // The control for the assertion above: same board, same switch, and the
    // rectangle does go hollow. Without this the previous test would pass on a
    // painter that ignored `graphicFill` everywhere.
    const rect = '(gr_rect (start 0 0) (end 5 5) (layer "F.SilkS") (fill yes) (width 0.1))';
    const filled = fills(boardWith(rect));
    const sketched = fills(boardWith(rect), { graphicFill: false });

    expect(filled.length).toBeGreaterThan(sketched.length);
  });

  it('draws a footprint’s barcode too', () => {
    // `FOOTPRINT::GraphicalItems()` holds it (`footprint.cpp:1450`), and the
    // footprint pass has to walk them — a board-level-only painter would drop
    // every barcode inside a component.
    const fp = `(footprint "L:B" (layer "F.Cu") (at 0 0) ${barcodeOn('F.SilkS')})`;

    expect(barcodeFill(fills(boardWith(fp)))).toBeDefined();
  });
});

describe('the knockout', () => {
  it('is one path with holes rather than many islands', () => {
    // Fractured: the inversion is a rectangle with the modules cut out, joined
    // to its outline by zero-width slits. It has far fewer sub-paths than the
    // solid version's one-per-module.
    const subPathsOf = (knockout: boolean): number => {
      const f = fills(boardWith(barcodeOn('F.SilkS', knockout))).filter(
        (x) => closedSubPaths(x.path) > 0,
      );
      // One fill per board here — the barcode's — so this is unambiguous.
      expect(f).toHaveLength(1);
      return closedSubPaths(f[0]!.path);
    };

    expect(subPathsOf(true)).toBeLessThan(subPathsOf(false));
  });
});
