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
 * panning would reveal gaps. So recording runs against a nominally enormous
 * canvas, which keeps the cull from removing anything, and the GPU does the
 * culling afterwards for nothing.
 *
 * ### It is zoom-independent, and that is the whole point
 *
 * Everything `renderer.ts` derives from the view scale is a width, and a
 * minimum width belongs to the view rather than to a vertex: the shader clamps
 * with `max(halfWidth * scale, minPx)`, which is what KiCad's
 * `u_minLinePixelWidth` does. So panning and zooming never re-record.
 *
 * They used to. The recorder classified widths against the recording scale and
 * stored a scale-derived floor, which made 98% of segments differ between one
 * zoom octave and the next, so the buffer was keyed on the octave and rebuilt
 * whenever the zoom crossed one. Each rebuild cost 50 to 100 ms, and for eight
 * consecutive octaves it produced byte-identical output. That hitch was the
 * zoom lag.
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

/**
 * Half the world extent recording covers, in internal units. Two metres each
 * way, which is larger than any sheet KiCad will draw, so the viewport cull in
 * `renderer.ts` keeps the whole document whatever the recording scale.
 */
const WORLD_HALF = 2e9;

/** Everything whose change means the geometry has to be recorded again. */
export interface ContentKey {
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

/**
 * The items being dragged, drawn over an untouched base.
 *
 * `doc` is the document with the move applied; `ids` are the items that moved,
 * which the base was recorded *without*. The two are exact complements, so
 * nothing is drawn twice and nothing goes missing.
 */
export interface PreviewSpec {
  doc: Schematic;
  ids: ReadonlySet<string>;
}

export interface GlViewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export class SchematicGl {
  private readonly scene = new Scene();
  /** The items being dragged, re-recorded on every pointer move. */
  private readonly previewScene = new Scene();
  private previewActive = false;
  private recorded: ContentKey | null = null;
  /** Timing of the last record, for the diagnostics overlay and for tests. */
  lastRecordMs = 0;

  private constructor(private readonly device: GlDevice) {}

  static create(canvas: HTMLCanvasElement): SchematicGl | null {
    const device = createGlDevice(canvas);
    return device ? new SchematicGl(device) : null;
  }

  /**
   * Draw the schematic, re-recording first if the content or the zoom octave
   * changed.
   *
   * Pan is never a reason to re-record, and neither is a zoom inside the
   * current octave, which is what makes a wheel gesture cost nothing.
   */
  render(content: ContentKey, view: GlViewport, preview?: PreviewSpec | null): void {
    if (!sameContent(this.recorded, content)) {
      const t0 = performance.now();
      this.record(content, view.scale);
      this.device.upload(this.scene);
      this.recorded = content;
      this.lastRecordMs = performance.now() - t0;
    }

    // The preview is re-recorded and re-uploaded every frame, and it never
    // touches the base. That is what makes a drag cost what the dragged items
    // cost: KiCad's `VIEW::AddToPreview` group over an untouched cached view.
    if (preview) {
      recordSchematicScene(
        this.previewScene,
        {
          ...content,
          doc: preview.doc,
          // A preview group *is* the moving selection, so it draws what
          // `SCH_PAINTER::draw( SCH_FIELD )` draws for a moving field: the
          // umbilical back to its parent, rather than the anchor cross.
          //
          //     if( aField->IsMoving() && !parentMoving && m_schematic )
          //         m_gal->DrawLine( aField->GetPosition(), parentPos );
          //
          // Only the Canvas2D drag path set this, and the GL path is the
          // default renderer — so dragging a field showed no umbilical at all.
          opts: { ...content.opts, onlyItems: preview.ids, movingSelection: true },
        },
        view.scale,
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

  private record(content: ContentKey, viewScale: number): void {
    recordSchematicScene(this.scene, content, viewScale);
  }

  /**
   * Blank the layer, for a frame the Canvas2D path is painting instead.
   *
   * The recorded buffer is kept, so the next GL frame costs a draw and not a
   * re-record. Only what is on screen goes.
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
 * Record a schematic into `scene` as it should look at `viewScale`.
 *
 * Exported and free-standing so the tests exercise *this*, not a copy of it.
 * A test with its own recording setup checks the recorder and misses the thing
 * most likely to go wrong, which is how this function calls it: recording at
 * the wrong scale is exactly the bug that made selection halos and field
 * umbilicals invisible, and a duplicated test could not have caught it.
 */
export function recordSchematicScene(scene: Scene, content: ContentKey, viewScale: number): void {
  scene.clear();
  // Record *through* the real view scale, so everything `renderer.ts` derives
  // from it (the selection halo, a field's umbilical, a selected field's anchor
  // cross) comes out at the size it should be. `worldScale` divides the scale
  // back out, leaving world units in the buffer.
  const scale = viewScale > 0 && Number.isFinite(viewScale) ? viewScale : 1;
  const extent = 2 * WORLD_HALF * scale;
  const rec = new GlRecorder(scene, {
    referenceScale: scale,
    worldScale: scale,
    devicePixelRatio: 1, // the canvas is already sized in device pixels
    skipFirstFillRect: true,
    // Recording runs through a shifted view so nothing at a negative coordinate
    // is culled; the origin takes the shift back out.
    originX: extent / 2,
    originY: extent / 2,
  });
  // Stroke text as raw segments. The canvas fast path builds a Path2D, which is
  // opaque to anything that is not a real 2D context.
  setVectorText(true);
  try {
    renderSchematic(
      // The same cast `plot.ts` uses for the SVG, DXF and PostScript backends:
      // `renderSchematic` declares the full context type but uses 26 members.
      rec as unknown as CanvasRenderingContext2D,
      content.doc,
      { scale, offsetX: extent / 2, offsetY: extent / 2 },
      content.theme,
      extent,
      extent,
      content.selection,
      content.highlight,
      // The grid is left to the 2D layer below. It is genuinely zoom-dependent
      // (its spacing adapts and it is drawn in device space), so it does not
      // belong in a buffer whose value is not being rebuilt.
      //
      // The selection and net-highlight halos go with it, for exactly the same
      // reason: `getShadowWidth` is a fixed number of *screen pixels* plus a
      // small world width, so a halo recorded at one zoom is the wrong width at
      // every other one, and this buffer is deliberately never re-recorded on a
      // zoom. The 2D layer draws them per frame, underneath this one.
      //
      // `halos` is defaulted rather than forced so a caller can record the
      // halo pass on its own and measure it; nothing in the app does, and the
      // GL buffer therefore always gets 'skip'.
      {
        ...content.opts,
        grid: { ...content.opts.grid, show: false },
        halos: content.opts.halos ?? 'skip',
      },
    );
  } finally {
    setVectorText(false);
  }
}
