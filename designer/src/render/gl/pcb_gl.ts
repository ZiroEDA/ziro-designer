// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Drawing a board with the WebGL backend.
 *
 * ### This is a backend, not a second renderer
 *
 * `renderBoard.ts` is two thousand lines of carefully matched KiCad painting —
 * layer order, theme colours, selection and highlight emphasis, high-contrast
 * alpha, zone opacity, minimum pen width. Re-expressing that against a graphics
 * API would be rewriting the part most worth keeping, and every rule restated is
 * a chance to diverge from the Canvas2D output invisibly.
 *
 * It does not need rewriting. `buildDrawSteps` already draws through a small
 * 2D-context surface — 15 members, counted from the source — and `GlRecorder`
 * implements all of them. So the board is drawn by handing `buildDrawSteps` a
 * recorder instead of a canvas, exactly as the schematic port did with
 * `renderer.ts`. Every colour and ordering rule comes along for free, and the
 * two backends can be run over the same `BoardScene` and compared, which is how
 * visual parity gets checked.
 *
 * The one thing that had to change: the board is compiled into retained
 * `Path2D` objects *before* it is drawn, so `buildDrawSteps` calls
 * `ctx.fill(path)` and `ctx.stroke(path)` with an explicit path. `GlRecorder`
 * now takes one (`recorder.ts`), and the scene must be built with
 * `GL_PATH_FACTORY` so those paths still have their vertices.
 *
 * ### Recording is rare, drawing is constant
 *
 * Recording walks the whole board and tessellates it. Drawing is one uniform and
 * three draw calls whatever is on the board, so pan and zoom never re-record —
 * the property the schematic port established and the reason any of this is
 * worth doing. See `scene.ts`.
 *
 * ### What is deliberately left to the 2D canvas
 *
 * The grid and the drawing sheet. Both are genuinely view-dependent — the grid's
 * spacing adapts to the zoom and both are drawn in device space — so neither
 * belongs in a buffer whose whole value is not being rebuilt. `PcbEditor.tsx`
 * already paints them on the live canvas beneath the raster, so the GL layer
 * stays transparent over them.
 */

import {
  buildDrawSteps,
  DEFAULT_DRAW_OPTIONS,
  type BoardScene,
  type Emphasis,
  type PcbDrawOptions,
  type PcbViewTransform,
} from '../../editors/pcb/renderBoard.js';
import { createGlDevice, type GlDevice } from './device.js';
import { Scene } from './scene.js';
import { GlRecorder } from './recorder.js';

/**
 * Half the world extent recording covers, in internal units. Two metres each
 * way in pcbnew's 1 nm units, comfortably past any board outline, so nothing is
 * dropped whatever the recording scale.
 */
const WORLD_HALF = 2e9;

/** Everything whose change means the geometry has to be recorded again. */
export interface BoardContentKey {
  scene: BoardScene;
  visible: ReadonlySet<string>;
  opts: PcbDrawOptions;
  emphasis: Emphasis;
}

/**
 * Compared by reference on purpose, and every field must be memoised by the
 * caller.
 *
 * A fresh `Set` or options object per frame re-records the whole board and shows
 * up only as "it is still slow" — the trap the schematic port hit and the reason
 * this is spelled out rather than left to a deep compare, which would cost more
 * than the record it saves on a board this size.
 */
const sameContent = (a: BoardContentKey | null, b: BoardContentKey): boolean =>
  a !== null &&
  a.scene === b.scene &&
  a.visible === b.visible &&
  a.opts === b.opts &&
  a.emphasis === b.emphasis;

/**
 * The items being dragged, drawn over an untouched base.
 *
 * The base is recorded *without* them and this holds only them, so the two are
 * exact complements: nothing is drawn twice and nothing goes missing. This is
 * what makes a drag cost what is moving rather than what is on the board.
 */
export interface BoardPreviewSpec {
  scene: BoardScene;
  emphasis?: Emphasis;
}

export class PcbGl {
  // Ordered, unlike the schematic's. A board is painted layer by layer through
  // `PCB_PAINT_ORDER`, so an inner-layer track belongs *under* the front copper
  // pour; a scene that keeps order only within each primitive kind draws every
  // stroke after every fill and lifts every inner-layer track out on top of
  // every pour. See the note on `Scene`.
  private readonly scene = new Scene(true);
  private readonly previewScene = new Scene(true);
  private previewActive = false;
  private recorded: BoardContentKey | null = null;
  /** Timing of the last record, for `?perf=1` and for tests. */
  lastRecordMs = 0;
  /**
   * How many times the board has been recorded.
   *
   * The number `?perf=1` exists to show. Recording is the expensive half, and
   * the claim this whole backend rests on is that it happens on an edit and not
   * on a pan, a zoom or a pointer move — which is a claim about a count, not
   * about a duration. Timing the last record cannot distinguish "recorded once"
   * from "recorded every frame at the same cost".
   */
  recordCount = 0;

  private constructor(private readonly device: GlDevice) {}

  static create(canvas: HTMLCanvasElement): PcbGl | null {
    const device = createGlDevice(canvas);
    return device ? new PcbGl(device) : null;
  }

  render(
    content: BoardContentKey,
    view: PcbViewTransform,
    preview?: BoardPreviewSpec | null,
  ): void {
    if (!sameContent(this.recorded, content)) {
      const t0 = performance.now();
      recordBoardScene(this.scene, content, view.scale);
      this.device.upload(this.scene);
      this.recorded = content;
      this.lastRecordMs = performance.now() - t0;
      this.recordCount++;
    }

    if (preview) {
      recordBoardScene(
        this.previewScene,
        { ...content, scene: preview.scene, emphasis: preview.emphasis ?? 'selected' },
        view.scale,
        true,
      );
      this.device.uploadPreview(this.previewScene);
      this.previewActive = true;
    } else if (this.previewActive) {
      this.device.clearPreview();
      this.previewScene.clear();
      this.previewActive = false;
    }

    this.device.draw(
      {
        // A flipped board view negates the X scale, as SetMirror on X does.
        scaleX: view.flipX ? -view.scale : view.scale,
        scaleY: view.scale,
        offsetX: view.tx,
        offsetY: view.ty,
      },
      // Transparent: the 2D canvas underneath has painted the background, the
      // grid and the drawing sheet already.
      null,
    );
  }

  /**
   * Shift board items by (dx, dy) without re-recording anything.
   *
   * KiCad's `VIEW::Update` re-caches only the item that moved; this is the
   * same idea against our buffer. A drag was costing a full re-record — 1228 ms
   * on the coldfire demo — because the only way to take a footprint out of the
   * board was to rebuild the board. Now its vertices are found by id and moved
   * in place, which is a fraction of a millisecond and a few `bufferSubData`
   * calls.
   *
   * Returns whether anything moved: an item recorded before the ranges existed
   * (or one the builder never named, like a zone) has none, and the caller
   * falls back to the rebuild.
   */
  moveItems(ids: Iterable<string>, dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return true;
    let moved = false;
    for (const id of ids) {
      const ranges = this.scene.translateItem(id, dx, dy);
      if (!ranges) continue;
      this.device.updateItem(this.scene, ranges);
      moved = true;
    }
    return moved;
  }

  /** Whether every one of `ids` can be moved in place. */
  canMoveItems(ids: Iterable<string>): boolean {
    for (const id of ids) if (!this.scene.itemRanges.has(id)) return false;
    return true;
  }

  /**
   * Blank the layer for a frame the Canvas2D path is painting instead. The
   * recorded buffer survives, so the next GL frame is a draw and not a record.
   */
  clear(): void {
    this.device.clear();
  }

  /** Force a re-record on the next draw; for a context loss or a resize. */
  invalidate(): void {
    this.recorded = null;
  }

  get isLost(): boolean {
    return this.device.isLost;
  }

  get stats(): { segments: number; discs: number; triangles: number; recordMs: number } {
    return {
      segments: this.scene.segmentCount,
      discs: this.scene.discCount,
      triangles: this.scene.triangleVertexCount / 3,
      recordMs: this.lastRecordMs,
    };
  }

  dispose(): void {
    this.device.dispose();
  }
}

/**
 * Record a `BoardScene` into `scene` as it should look at `viewScale`.
 *
 * Exported and free-standing so tests exercise *this* and not a copy. The thing
 * most likely to go wrong is not the recorder but how it is set up here:
 * recording at the wrong scale is what made the schematic's selection halos
 * invisible, and a test with its own recording setup could not have caught it.
 *
 * The board scene must have been built with `GL_PATH_FACTORY`; built with the
 * default `Path2D` its buckets are opaque and everything silently records as
 * nothing.
 */
export function recordBoardScene(
  scene: Scene,
  content: BoardContentKey,
  viewScale: number,
  overlay = false,
): void {
  scene.clear();
  // Record *through* the real view scale so everything `buildDrawSteps` derives
  // from it — the minimum pen width above all — comes out at the size it should
  // be. `worldScale` divides the scale back out, leaving world units in the
  // buffer, which is what keeps it valid at every zoom.
  const scale = viewScale > 0 && Number.isFinite(viewScale) ? viewScale : 1;
  const extent = 2 * WORLD_HALF * scale;
  const rec = new GlRecorder(scene, {
    referenceScale: scale,
    worldScale: scale,
    devicePixelRatio: 1, // the canvas is already sized in device pixels
    skipFirstFillRect: true,
    // A board is lines. Every one of them is clamped to a device pixel and drawn
    // at full strength, which is what `computeLineCoords` does to a KiCad line
    // and the reason a courtyard rectangle or a silkscreen outline stays crisp
    // on a board zoomed out to fit. `buildDrawSteps` turns the fade back on
    // around the two passes that stand in for KiCad's bitmap text.
    hairlines: 'solid',
    // Recording runs through a shifted view so nothing at a negative coordinate
    // is culled; the origin takes the shift back out.
    originX: extent / 2,
    originY: extent / 2,
  });
  const steps = buildDrawSteps(
    // The same cast `plot.ts` uses for the SVG, DXF and PostScript backends:
    // the signature names the full context type, the body uses fifteen members.
    rec as unknown as CanvasRenderingContext2D,
    content.scene,
    { scale, tx: extent / 2, ty: extent / 2 },
    content.visible,
    extent,
    extent,
    {
      ...(content.opts ?? DEFAULT_DRAW_OPTIONS),
      // The grid and the drawing sheet stay on the 2D canvas; see the note at
      // the top of this file.
      drawingSheet: false,
      // Store true world widths. The default minimum pen is one device pixel at
      // the *current* zoom, which would bake the view into the geometry and
      // force a re-record on every zoom step; the shader applies the same floor
      // per frame instead. This one line is the difference between a retained
      // buffer and a very elaborate way of redrawing everything.
      minPenWidth: 0,
    },
    undefined,
    overlay,
    content.emphasis,
  );
  for (const step of steps) step();
  // Close the last item's ranges; nothing else marks the end of a recording.
  scene.closeItem();
}
