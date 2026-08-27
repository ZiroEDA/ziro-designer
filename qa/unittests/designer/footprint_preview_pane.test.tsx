// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What the chooser's footprint preview pane actually paints.
 *
 * Two things it was not painting, both decided by
 * `pcbnew/footprint_preview_panel.cpp`:
 *
 *   - **the grid.** `FOOTPRINT_PREVIEW_PANEL::New` ends with
 *     `panel->GetGAL()->SetGridVisibility( gridCfg.show )` and
 *     `SetGridSize( … gridCfg.grids[last_size_idx] … )` read off
 *     `PCBNEW_SETTINGS::m_Window.grid`. Its defaults are `show = true`
 *     (`common/settings/app_settings.cpp:555-556`) and grid index 15 of the
 *     non-eeschema list — "0.50 mm" (`app_settings.cpp:462-481`). Ours drew no
 *     grid at all.
 *   - **the right fit.** `fitToCurrentFootprint` fits
 *     `m_currentFootprint->GetBoundingBox( m_currentFootprint->TextOnly() )` —
 *     the footprint's own box, with its **text excluded** for anything that is
 *     not pure text — then `SetScale( GetScale() * 0.7 )` for the margin. Ours
 *     fitted the whole scene's box instead.
 *
 * Rendered rather than grepped, because the paint order and the numbers are the
 * point: a `drawGrid` call sitting behind a condition that is false, or one
 * handed the schematic grid pitch, reads the same as the fix to a source scan.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { FootprintPreviewWidget } from '@ziroeda/designer/src/widgets/footprint_preview_widget.js';
import { parseFootprint } from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';
import { layerColor, PCB_GRID } from '@ziroeda/designer/src/editors/pcb/pcbTheme.js';

afterEach(cleanup);

const MM = 1e6;

/**
 * `Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal`, the footprint in the report,
 * trimmed to the items that decide the framing: its two fields, its courtyard
 * (the outermost non-text ink), its silkscreen body and its two pads. Verbatim
 * from `/usr/share/kicad/footprints/Diode_THT.pretty/` except for the omissions.
 */
const DIODE = `(footprint "D_DO-41_SOD81_P10.16mm_Horizontal"
	(version 20260206) (generator "kicad-footprint-generator") (layer "F.Cu")
	(property "Reference" "REF**" (at 5.08 -2.47 0) (layer "F.SilkS")
		(effects (font (size 1 1) (thickness 0.15))))
	(property "Value" "D_DO-41_SOD81_P10.16mm_Horizontal" (at 5.08 2.47 0) (layer "F.Fab")
		(effects (font (size 1 1) (thickness 0.15))))
	(attr through_hole)
	(fp_rect (start 2.36 -1.47) (end 7.8 1.47)
		(stroke (width 0.12) (type solid)) (fill no) (layer "F.SilkS"))
	(fp_rect (start -1.35 -1.6) (end 11.51 1.6)
		(stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))
	(pad "1" thru_hole roundrect (at 0 0) (size 2.2 2.2) (drill 1.1)
		(layers "*.Cu" "*.Mask") (roundrect_rratio 0.113636))
	(pad "2" thru_hole circle (at 10.16 0) (size 2.2 2.2) (drill 1.1)
		(layers "*.Cu" "*.Mask")))`;

// The pane the preview is given, in device pixels (dpr 1).
const PANE_W = 400;
const PANE_H = 300;

/**
 * The scale `fitToCurrentFootprint` arrives at for {@link DIODE} in a
 * {@link PANE_W}×{@link PANE_H} pane, derived from the file rather than from
 * the code: the text-excluded box is the courtyard rectangle,
 * (-1.35, -1.6) … (11.51, 1.6), so 12.86 mm × 3.2 mm. `SetViewport` takes
 * min(400/12.86, 300/3.2) = 31.104 px/mm and the margin multiplies it by 0.7.
 */
const FIT_PX_PER_MM = Math.min(PANE_W / 12.86, PANE_H / 3.2) * 0.7;

/** Everything the widget's paint does to its 2D context, in order. */
interface Recorder {
  calls: string[];
  /** `setTransform` arguments, so the fitted view can be read back. */
  transforms: number[][];
  /** Each `fill(path)` as [fillStyle, the path's recorded ops]. */
  fills: [string, string[]][];
  /** The `strokeStyle` of every `stroke()`, in order. */
  strokeStyles: string[];
}

class FakePath {
  ops: string[] = [];
  rects: number[][] = [];
  moveTo(): void {
    this.ops.push('moveTo');
  }
  lineTo(): void {
    this.ops.push('lineTo');
  }
  arc(): void {
    this.ops.push('arc');
  }
  arcTo(): void {
    this.ops.push('arcTo');
  }
  rect(...a: number[]): void {
    this.ops.push('rect');
    this.rects.push(a);
  }
  roundRect(): void {
    this.ops.push('roundRect');
  }
  closePath(): void {
    this.ops.push('closePath');
  }
  addPath(o: FakePath): void {
    this.ops.push(...o.ops);
    this.rects.push(...o.rects);
  }
}

class FakeMatrix {
  translate(): FakeMatrix {
    return this;
  }
  rotate(): FakeMatrix {
    return this;
  }
}

/** Paint the widget once against a recording context and report what happened. */
async function paint(): Promise<{ rec: Recorder; gridFill: FakePath | null }> {
  const rec: Recorder = { calls: [], transforms: [], fills: [], strokeStyles: [] };
  let gridFill: FakePath | null = null;

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    setTransform: (...a: number[]) => {
      // A non-unit first term is the world transform, i.e. the board itself.
      rec.calls.push(a[0] === 1 ? 'setTransform' : 'setTransform:world');
      rec.transforms.push(a);
    },
    translate: () => rec.calls.push('translate'),
    scale: () => rec.calls.push('scale'),
    save: () => rec.calls.push('save'),
    restore: () => rec.calls.push('restore'),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    setLineDash: () => {},
    strokeRect: () => {},
    drawImage: () => {},
    clearRect: () => {},
    fillRect: () => rec.calls.push('fillRect'),
    fill: (p?: FakePath) => {
      rec.calls.push('fill');
      if (p) {
        rec.fills.push([ctx.fillStyle, p.ops]);
        if (ctx.fillStyle === PCB_GRID) gridFill = p;
      }
    },
    stroke: () => {
      rec.calls.push('stroke');
      rec.strokeStyles.push(ctx.strokeStyle);
    },
  };

  const win = globalThis as unknown as {
    Path2D: unknown;
    DOMMatrix: unknown;
    ResizeObserver: unknown;
    devicePixelRatio: number;
  };
  const saved = { P: win.Path2D, M: win.DOMMatrix, R: win.ResizeObserver };
  win.Path2D = FakePath;
  win.DOMMatrix = FakeMatrix;
  win.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  win.devicePixelRatio = 1;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: unknown;
    getBoundingClientRect: unknown;
  };
  const savedGet = proto.getContext;
  const savedRect = proto.getBoundingClientRect;
  proto.getContext = () => ctx;
  proto.getBoundingClientRect = () => ({
    width: PANE_W,
    height: PANE_H,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
  });

  const fp = parseFootprint(DIODE);
  try {
    await act(async () => {
      render(
        <FootprintPreviewWidget
          footprint="Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal"
          statusText=""
          resolve={async () => fp}
        />,
      );
    });
  } finally {
    proto.getContext = savedGet;
    proto.getBoundingClientRect = savedRect;
    win.Path2D = saved.P;
    win.DOMMatrix = saved.M;
    win.ResizeObserver = saved.R;
  }
  return { rec, gridFill };
}

/** The world transform the paint settled on: [scale, tx, ty]. */
const worldTransform = (rec: Recorder): number[] => {
  const t = rec.transforms.find((a) => a[0] !== 1);
  if (!t) throw new Error('the board was never painted in world coordinates');
  return [t[0]!, t[4]!, t[5]!];
};

describe('the preview fits the footprint the way fitToCurrentFootprint does', () => {
  it('zooms to the text-excluded box, with upstream 0.7 margin', async () => {
    const { rec } = await paint();
    const [scale] = worldTransform(rec);

    // 21.77 device px per mm. Fitting the box *with* the text in it — the value
    // string is three times wider than the part — gives about 13, which is what
    // the pane was showing.
    expect(scale! * MM).toBeCloseTo(FIT_PX_PER_MM, 3);
  });

  it('centres that box in the pane', async () => {
    const { rec } = await paint();
    const [scale, tx, ty] = worldTransform(rec);

    // Centre of (-1.35, -1.6)…(11.51, 1.6) is (5.08, 0) mm.
    expect(tx).toBeCloseTo(PANE_W / 2 - 5.08 * MM * scale!, 3);
    expect(ty).toBeCloseTo(PANE_H / 2 - 0 * scale!, 3);
  });
});

describe('the preview canvas has pcbnew grid on it', () => {
  it('fills a lattice of dots in the board grid colour', async () => {
    const { rec, gridFill } = await paint();

    expect(rec.fills.some(([style]) => style === PCB_GRID)).toBe(true);
    expect((gridFill as FakePath | null)?.rects.length ?? 0).toBeGreaterThan(100);
  });

  it('spaces them at pcbnew default 0.50 mm, not some other editor default', async () => {
    const { rec, gridFill } = await paint();
    const [scale] = worldTransform(rec);
    const dots = (gridFill as FakePath | null)!.rects;

    // Distinct dot columns, in device pixels. Each mark is snapped to whole
    // device pixels one by one (`gridDotEdge`), so neighbouring gaps alternate
    // 10 and 11 px; the mean over the run is the pitch.
    const xs = [...new Set(dots.map((r) => r[0]!))].sort((a, b) => a - b);
    const pitch = (xs.at(-1)! - xs[0]!) / (xs.length - 1);

    // `last_size_idx` 15 of the pcbnew grid list is 0.50 mm; at the fitted
    // 21.77 px/mm that is 10.9 px, above `minSpacingPx` so it is not coarsened.
    // A schematic-sized grid (50 mil = 1.27 mm) would read 27.7 px here.
    expect(pitch).toBeCloseTo(0.5 * MM * scale!, 0);
  });

  it('paints it under the board, where GRID_DEPTH puts it', async () => {
    const { rec } = await paint();

    // The grid lattice goes down before the context ever moves to world
    // coordinates, so every board item lands on top of it.
    const grid = rec.calls.indexOf('fill');
    const board = rec.calls.indexOf('setTransform:world');
    expect(grid).toBeGreaterThanOrEqual(0);
    expect(board).toBeGreaterThan(grid);
  });
});

describe('the preview paints its pads the way pcbnew does', () => {
  it('draws the pad numbers', async () => {
    // At the fitted zoom a 2.2 mm pad is 48 px, so PAD::ViewGetLOD passes and
    // both numbers are stroked as glyphs. Zero strokes means the per-frame
    // netname pass was never scheduled at all — the bug this pane showed.
    const { rec } = await paint();

    expect(rec.strokeStyles.length).toBeGreaterThan(0);
  });

  it('draws no pad clearance ring, as a board with no design rules cannot', () => {
    // `GetOwnClearance` is 0 on the preview's dummy BOARD (no DRC engine), so
    // `draw( const PAD* )`'s `clearance > 0` never fires. The ring is the only
    // thing pcbnew *strokes* in a copper layer's own colour — pads are filled —
    // so a stroke in the F.Cu colour is exactly the ring coming back.
    return paint().then(({ rec }) => {
      expect(rec.strokeStyles).not.toContain(layerColor('F.Cu'));
    });
  });
});
