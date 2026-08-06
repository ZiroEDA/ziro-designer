// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Drawing a schematic with the WebGL backend: when to re-record, and how to
 * draw.
 *
 * The whole benefit of the backend lives in the split this class makes, so it
 * is worth stating plainly.
 *
 * **Recording is expensive and rare.** It runs `renderer.ts` over the entire
 * document and tessellates the result, which on a real KiCad demo sheet costs
 * about 165 ms and produces roughly 1.2 MB of vertices. It must happen only
 * when what is drawn changes: a different document, theme, selection,
 * highlight, or set of display options.
 *
 * **Drawing is cheap and constant.** One uniform and three draw calls,
 * regardless of how much is on the sheet. Panning and zooming only draw.
 *
 * Today, by contrast, the Canvas2D path repaints the whole sheet after every
 * zoom gesture settles, in a single unchunked task of about 70 ms
 * (`startSceneRender` in `SchematicCanvas.tsx`), and that task is what makes
 * the wheel feel like it stutters (#449).
 *
 * ### Recording covers the document, not the view
 *
 * `renderer.ts` culls to the visible rect, which is right for an immediate
 * renderer and wrong for a retained one: the buffer has to hold everything, or
 * panning would reveal gaps. So recording runs at scale 1 against a nominally
 * enormous canvas, which keeps the cull from removing anything, and the GPU
 * does the culling afterwards for nothing.
 */

import {
  renderSchematic,
  setVectorText,
  type RenderOpts,
} from '../../editors/schematic/render/renderer.js';
import type { Schematic } from '@ziroeda/eeschema/src/types.js';
import type { Theme } from '../../editors/schematic/theme.js';
import { createGlDevice, type GlDevice } from './device.js';
import { Scene } from './scene.js';
import { GlRecorder } from './recorder.js';

/** Big enough that `renderer.ts`'s viewport cull keeps the whole document. */
const RECORD_EXTENT = 1e9;

/** Everything whose change means the geometry has to be recorded again. */
interface ContentKey {
  doc: Schematic;
  theme: Theme;
  opts: RenderOpts;
  selection: ReadonlySet<string> | undefined;
  highlight: ReadonlySet<string> | undefined;
}

const sameContent = (a: ContentKey | null, b: ContentKey): boolean =>
  a !== null &&
  a.doc === b.doc &&
  a.theme === b.theme &&
  a.opts === b.opts &&
  a.selection === b.selection &&
  a.highlight === b.highlight;

export interface GlViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export class SchematicGl {
  private readonly scene = new Scene();
  private recorded: ContentKey | null = null;
  /** Timing of the last record, for the diagnostics overlay and for tests. */
  lastRecordMs = 0;

  private constructor(private readonly device: GlDevice) {}

  static create(canvas: HTMLCanvasElement): SchematicGl | null {
    const device = createGlDevice(canvas);
    return device ? new SchematicGl(device) : null;
  }

  /**
   * Draw the schematic. Re-records first if the content changed.
   *
   * The view is not part of the content key on purpose: that is the entire
   * point, and `gl_scene_invariant.test.ts` pins the fact that the recorded
   * bytes are identical across zoom levels.
   */
  render(content: ContentKey, view: GlViewport): void {
    if (!sameContent(this.recorded, content)) {
      const t0 = performance.now();
      this.record(content, view.scale);
      this.device.upload(this.scene);
      this.recorded = content;
      this.lastRecordMs = performance.now() - t0;
    }
    this.device.draw(
      {
        scaleX: view.scale,
        scaleY: view.scale,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
      },
      // Transparent: the 2D canvas underneath has already painted the
      // background and the grid.
      null,
    );
  }

  private record(content: ContentKey, referenceScale: number): void {
    this.scene.clear();
    const rec = new GlRecorder(this.scene, {
      // What the caller's `1 / scale` hairline requests were computed against.
      // Recording at one zoom and viewing at another stays correct because the
      // shader re-derives the width; this only has to be a sane starting point.
      referenceScale,
      devicePixelRatio: 1, // the canvas is already sized in device pixels
      skipFirstFillRect: true,
      // Recording runs through a shifted view so nothing at a negative
      // coordinate is culled; this takes the shift back out, leaving true world
      // coordinates in the buffer.
      originX: RECORD_EXTENT / 2,
      originY: RECORD_EXTENT / 2,
    });
    // Stroke text as raw segments. The canvas fast path builds a Path2D, which
    // is opaque to anything that is not a real 2D context.
    setVectorText(true);
    try {
      renderSchematic(
        // The same cast `plot.ts` uses for the SVG, DXF and PostScript
        // backends: `renderSchematic` declares the full context type but uses
        // 26 of its members.
        rec as unknown as CanvasRenderingContext2D,
        content.doc,
        { scale: 1, offsetX: RECORD_EXTENT / 2, offsetY: RECORD_EXTENT / 2 },
        content.theme,
        RECORD_EXTENT,
        RECORD_EXTENT,
        content.selection,
        content.highlight,
        // The grid is left to the 2D layer below. It is genuinely
        // zoom-dependent (its spacing adapts and it is drawn in device space),
        // so it does not belong in a buffer whose value is not being rebuilt.
        { ...content.opts, grid: { ...content.opts.grid, show: false } },
      );
    } finally {
      setVectorText(false);
    }
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
