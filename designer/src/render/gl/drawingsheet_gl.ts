// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor on the shared GL layer — the fourth adapter, and the
 * thinnest of them, for the reason KiCad's is thinnest too.
 *
 * ## Why there is no painter here
 *
 * Upstream, `PL_DRAW_PANEL_GAL`'s constructor is three lines of substance:
 *
 *     m_painter = std::make_unique<KIGFX::DS_PAINTER>( m_gal );
 *     m_painter->GetSettings()->LoadColors( ::GetColorSettings( … ) );
 *     m_view->SetPainter( m_painter.get() );
 *                                    pagelayout_editor/pl_draw_panel_gal.cpp:55-61
 *
 * `DS_PAINTER` is not pl_editor's. It lives in `common/drawing_sheet/` and is
 * the same painter eeschema, pcbnew and gerbview reach through
 * `DS_PROXY_VIEW_ITEM` — so pl_editor is not an editor with its own drawing-sheet
 * renderer, it is the editor whose canvas holds *only* the shared one.
 *
 * Ours matches that: `drawDrawingSheetItems` (wksRender) is the painter and it
 * already serves all four canvases, and `GlRecorder` / `Scene` / `GlDevice` are
 * the shared GAL. This file only wires the two together, which is why it carries
 * no geometry decisions at all — the three other adapters each hold their
 * editor's own painter logic, and there is none to hold here.
 *
 * ## Why the sheet was soft everywhere else it is crisp
 *
 * The schematic records its whole render — drawing sheet included — through
 * `GlRecorder` (`schematic_gl.ts`), so its title block is GPU geometry. The
 * Drawing Sheet Editor was the one canvas still rasterising with Canvas2D,
 * which antialiases a one-pixel stroke across two pixels whenever it lands off
 * the pixel grid. Snapping fixed the rectangles; it was never going to fix the
 * glyph stems, which run at every angle and would deform.
 *
 * ## What stays on the 2D canvas
 *
 * The background, the grid, the page rectangle with its origin marker, and every
 * overlay (selection boxes, point-editor handles, the crosshair). All of them
 * are drawn in device space or at a fixed pixel size, so a recorded buffer would
 * be wrong at every zoom but the one it was recorded at — the same division
 * `schematic_gl` and `pcb_gl` make, and for the same reason.
 */

import { drawDrawingSheetItems, type RenderOpts } from '@ziroeda/common';
import type { DsDrawItem } from '@ziroeda/common';
import { createGlDevice, type GlDevice, type GlView } from './device.js';
import { GlRecorder } from './recorder.js';
import { Scene } from './scene.js';

/** Everything whose change means the geometry has to be recorded again. */
export interface DrawingSheetGlContent {
  draws: readonly DsDrawItem[];
  selection: ReadonlySet<number>;
  /** The delete picker's hovered item, drawn brightened. */
  brightened?: number;
}

export interface DrawingSheetGlView {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Ordered, because later items paint over earlier ones and a selected item must
 * not end up under its neighbours.
 *
 * The sheet is ~31 primitives, so the extra runs an ordered scene costs are not
 * worth trading paint order for — the opposite of the gerbview case, where the
 * ordering had to be argued for against thousands of items.
 */
export const createDrawingSheetScene = (): Scene => new Scene(true);

/**
 * Record the sheet into `scene`, in true world (page IU) coordinates.
 *
 * `minWidth` is **0**, and that is the whole point. The 2D caller passes
 * `1 / scale` — one device pixel expressed in world units — because Canvas2D
 * has no shader to floor a width with. Recording that would bake the zoom into
 * the vertices and force a re-record on every zoom step, which is exactly what
 * this backend exists to avoid. Here the width recorded is the item's own and
 * `hairlines: 'solid'` has the shader floor it at one device pixel per frame,
 * which is what KiCad's `u_minLinePixelWidth` does and what keeps a hairline
 * crisp at any zoom.
 *
 * Zero is safe rather than merely convenient: `layoutDrawingSheet` resolves
 * every item's pen before it gets here — a `(linewidth 0)` in the .kicad_wks
 * means "use the sheet default" and comes out as `setup.lineWidth`, 0.15 mm —
 * so nothing reaches this function with a zero width to be rescued by a
 * minimum. Measured on the built-in stationery: every primitive is 1500 IU and
 * none is 0, which is why changing this constant to 1 changes no pixel and
 * kills no test. Recorded here rather than papered over with an assertion that
 * would only be pinning an arbitrary number.
 */
export function recordDrawingSheetScene(scene: Scene, content: DrawingSheetGlContent): void {
  scene.clear();
  const rec = new GlRecorder(scene, {
    // Raw world coordinates: nothing has applied a view, so there is no view
    // scale to divide back out (unlike pcb_gl, which records through one).
    worldScale: 1,
    devicePixelRatio: 1,
    hairlines: 'solid',
  });
  const opts: RenderOpts = { minWidth: 0 };
  if (content.brightened !== undefined) opts.brightened = content.brightened;
  drawDrawingSheetItems(
    // The cast `plot.ts` and the other adapters use: the painter declares the
    // full 2D context type and touches a couple of dozen members.
    rec as unknown as CanvasRenderingContext2D,
    content.draws as DsDrawItem[],
    content.selection,
    opts,
  );
  scene.closeItem();
}

export class DrawingSheetGl {
  private readonly scene = createDrawingSheetScene();
  private recorded: DrawingSheetGlContent | null = null;
  /** Timing of the last record, for `?perf=1` and for tests. */
  lastRecordMs = 0;
  /**
   * How many times the sheet has been recorded. The claim this backend rests on
   * is that a pan or a zoom records nothing, and that is a claim about a count
   * rather than about a duration.
   */
  recordCount = 0;

  private constructor(private readonly device: GlDevice) {}

  static create(canvas: HTMLCanvasElement): DrawingSheetGl | null {
    const device = createGlDevice(canvas);
    return device ? new DrawingSheetGl(device) : null;
  }

  get isLost(): boolean {
    return this.device.isLost;
  }

  render(content: DrawingSheetGlContent, view: DrawingSheetGlView): void {
    if (this.recorded === null || !sameContent(this.recorded, content)) {
      const t0 = performance.now();
      recordDrawingSheetScene(this.scene, content);
      this.device.upload(this.scene);
      this.recorded = content;
      this.lastRecordMs = performance.now() - t0;
      this.recordCount++;
    }
    const glView: GlView = {
      // Page IU run the same way as screen coordinates here — y down — so
      // neither axis is negated, unlike gerbview's.
      scaleX: view.scale,
      scaleY: view.scale,
      offsetX: view.tx,
      offsetY: view.ty,
    };
    // Transparent: the 2D canvas below has already painted the paper, the grid
    // and the page rectangle.
    this.device.draw(glView, null);
  }

  clear(): void {
    this.device.clear();
  }

  dispose(): void {
    this.device.dispose();
  }
}

/**
 * Whether two content keys describe the same picture.
 *
 * Field by field, never by reference: the canvas rebuilds this object inside a
 * `useMemo` whose dependencies move on a pointer event, so a reference check
 * here re-records every frame and looks exactly like "GL did not help".
 */
function sameContent(a: DrawingSheetGlContent, b: DrawingSheetGlContent): boolean {
  if (a.draws !== b.draws || a.brightened !== b.brightened) return false;
  if (a.selection === b.selection) return true;
  if (a.selection.size !== b.selection.size) return false;
  for (const s of a.selection) if (!b.selection.has(s)) return false;
  return true;
}
