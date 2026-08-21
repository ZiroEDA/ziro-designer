// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * GerbView on the shared GL layer - the third adapter beside `schematic_gl`
 * and `pcb_gl`, and a thin one for the same reason KiCad's is.
 *
 * Upstream, GerbView's canvas is `EDA_DRAW_PANEL_GAL` with a `KIGFX::VIEW` and
 * an `OPENGL_GAL`, all of which pcbnew uses unchanged; the only gerbview-
 * specific pieces are `GERBVIEW_PAINTER` and `GERBVIEW_RENDER_SETTINGS`. So
 * this file records, and `gerberPaint.ts` decides what a shape looks like.
 *
 * ## The scene is ordered, and that is not a preference
 *
 * `GERBVIEW_DRAW_PANEL_GAL::SetTopLayer` gives every gerber layer an explicit
 * rendering order and then hoists the active one:
 *
 *     for( int i = 0; i < GERBER_DRAWLAYERS_COUNT; ++i )
 *     {
 *         SetLayerOrder( GERBER_DCODE_LAYER( GERBER_DRAW_LAYER( i ) ),
 *                        GERBER_DRAW_LAYER( 2 * i ) );
 *         SetLayerOrder( GERBER_DRAW_LAYER( i ), GERBER_DRAW_LAYER( 2 * i + 1 ) );
 *     }
 *     SetTopLayer( aLayer );
 *     SetTopLayer( GERBER_DCODE_LAYER( aLayer ) );
 *                                gerbview/gerbview_draw_panel_gal.cpp:181-199
 *
 * Layers carry their own colours and, in forced-opacity mode, their own alpha,
 * so what is on top is visible. An unordered scene keeps order only within
 * each primitive kind and would draw every disc after every triangle, which
 * puts every flashed pad on top of every pour regardless of layer. So
 * `new Scene(true)`, and one run boundary per layer - asserted in
 * `gerbview_gl_record.test.ts` rather than left as a comment, because Node
 * cannot see compositing and this bug class ships green.
 *
 * ## What is deliberately absent
 *
 * No viewport culling. Gerber work is constant zoom out and back in, and a
 * view-dependent scene means a re-record on every zoom - which is what made
 * the 2D path cost 250 ms a frame. The scene holds true world coordinates and
 * only the view uniform changes, so a pan is one uniform write.
 *
 * No erase compositing. `OPENGL_GAL::SetNegativeDrawMode` is an empty override
 * (`include/gal/opengl/opengl_gal.h:273`) and StartNegativesLayer /
 * EndNegativesLayer exist only on CAIRO_GAL, so on GerbView's default canvas a
 * clear object is handed `COLOR4D( 0, 0, 0, 0 )` by GetColor and contributes
 * nothing. Holes *inside* a flash survive, because those are polygon holes cut
 * by a boolean in `GetApertureMacroShape`, not by compositing.
 */

import { GBR_BASIC_SHAPE, type GERBER_DRAW_ITEM, type GERBER_FILE_IMAGE } from '@ziroeda/gerbview';
import {
  paintItemGeometry,
  type GerberPaintOptions,
  type SURFACE,
} from '../../editors/gerbview/gerberPaint.js';
import { createGlDevice, type GlDevice, type GlView } from './device.js';
import { GlRecorder } from './recorder.js';
import { Scene } from './scene.js';
import { GBR_ARC_TOLERANCE } from './tessellate.js';

/** One gerber layer, in the order it is to be drawn (bottom first). */
export interface GerberGlLayer {
  image: GERBER_FILE_IMAGE;
  /** The layer's colour, already carrying its alpha. */
  color: string;
  /** `LAYER_NEGATIVE_OBJECTS`, for the show-negative-objects ghost. */
  negativeColor: string;
  visible: boolean;
  /** Brightened colour for a highlighted item, `Brightened( 0.5 )`. */
  highlightColor: string;
}

export interface GerberGlContent extends GerberPaintOptions {
  /** Bottom-to-top, active layer last, as the frame orders them. */
  layers: readonly GerberGlLayer[];
  /** `gvconfig()->m_Appearance.show_negative_objects`. */
  showNegativeObjects: boolean;
  /** Per-item highlight predicate, or null. */
  highlightTest: ((item: GERBER_DRAW_ITEM) => boolean) | null;
}

export interface GerberGlView {
  scale: number;
  tx: number;
  ty: number;
  /** "Flip view", which mirrors X exactly as SetMirror does. */
  flipX: boolean;
}

/**
 * The scene GerbView records into.
 *
 * A factory rather than a `new Scene(true)` at each site, because the scene's
 * orderedness and the draw path are one decision and must not be able to
 * disagree: a scene built unordered records no runs, the device silently falls
 * back to three draws by primitive kind, and the result is a plausible picture
 * with every flashed pad lifted on top of every pour. Tests build their scene
 * through here too, so a mutation of this line reaches them.
 */
export const createGerberScene = (): Scene => new Scene(true);

/** The run-list mark naming where layer `i` begins. */
export const layerMark = (i: number): string => `gbr:layer:${i}`;

/**
 * Rank an item by the primitive kind its shape records as.
 *
 * Only the grouping matters, not the ranking's order: items that record the
 * same kind must end up adjacent so the run list stays short.
 */
const KIND_TRI = 0;
const KIND_SEG = 1;
const KIND_MIXED = 2;

/**
 * Which primitive kind an aperture flashes as, cached per D-code.
 *
 * Not guessable from the aperture type, because it depends on how the painter
 * draws it rather than on what it is: `fillCircle` and `fillPolygon` go
 * through `fill()`, which the recorder triangulates, so a round pad records as
 * **triangles**; `fillCapsule` goes through `stroke()`, so an obround pad
 * records as segments. A macro can be both, and those go last.
 */
const flashKindCache = new WeakMap<object, number>();

function flashKind(item: GERBER_DRAW_ITEM): number {
  const code = item.dcode;
  if (code) {
    const hit = flashKindCache.get(code);
    if (hit !== undefined) return hit;
  }
  let seg = false;
  let other = false;
  for (const sh of item.resolveFlashShapes()) {
    if (!sh.exposure) continue;
    if (sh.kind === 'segment') seg = true;
    else other = true;
  }
  const kind = seg && other ? KIND_MIXED : seg ? KIND_SEG : KIND_TRI;
  if (code) flashKindCache.set(code, kind);
  return kind;
}

/**
 * Rank an item by the primitive kind it records as, so items recording the
 * same kind end up adjacent and the run list stays short.
 */
function kindRank(item: GERBER_DRAW_ITEM): number {
  switch (item.shape) {
    case GBR_BASIC_SHAPE.GBR_POLYGON:
      return KIND_TRI;
    case GBR_BASIC_SHAPE.GBR_SEGMENT:
    case GBR_BASIC_SHAPE.GBR_ARC:
    case GBR_BASIC_SHAPE.GBR_CIRCLE:
      return KIND_SEG;
    default:
      return flashKind(item);
  }
}

/**
 * The order items are recorded in *within* one layer.
 *
 * Recording in file order is what made a frame 3482 draw calls: the primitive
 * kind alternates almost every item - a pad is a disc, the track leaving it a
 * segment, the pour under it triangles - and `Scene.note` opens a new run on
 * every change. pcbnew avoids this without trying, because `buildDrawSteps`
 * walks layer by layer and bucket by bucket, so all of a layer's fills are
 * recorded before any of its strokes; its run count is 6-8 on a real board.
 *
 * Reordering inside a layer is safe, and that is a claim about KiCad rather
 * than about blending: `VIEW::redrawRect` gives a layer one depth and one
 * `SetLayerDepth`, the items on it are queried from an R-tree in no defined
 * order, and they share a colour - so which of two same-layer items is drawn
 * first is not observable. What *is* observable is a highlighted item, which
 * takes `m_layerColorsHi` and must not be buried under its neighbours, so
 * those are recorded last within their own layer.
 *
 * Nothing is reordered *across* layers: that order is KiCad's own
 * `SetLayerOrder` and is the whole reason the scene is ordered at all.
 */
function orderWithinLayer(
  items: readonly GERBER_DRAW_ITEM[],
  highlightTest: ((item: GERBER_DRAW_ITEM) => boolean) | null,
): { plain: readonly GERBER_DRAW_ITEM[]; mixed: readonly GERBER_DRAW_ITEM[] } {
  // Decorate-sort-undecorate on indices, so the sort is stable and the
  // predicate runs once per item rather than once per comparison.
  const keyed = items.map((item, index) => ({
    item,
    index,
    hi: highlightTest?.(item) === true ? 1 : 0,
    kind: kindRank(item),
    dcode: item.dcodeNum,
  }));
  // Kind first. Sorting by D-code within the flash group was the first attempt
  // and it is what left ~85 runs a layer: consecutive apertures alternate
  // between round (filled, so triangles) and obround (stroked, so segments),
  // so every D-code opened a run. The D-code is now only a tiebreak *inside*
  // one kind, where it costs nothing and keeps identical geometry together.
  keyed.sort((a, b) => a.hi - b.hi || a.kind - b.kind || a.dcode - b.dcode || a.index - b.index);
  return {
    plain: keyed.filter((k) => k.kind !== KIND_MIXED).map((k) => k.item),
    mixed: keyed.filter((k) => k.kind === KIND_MIXED).map((k) => k.item),
  };
}

/**
 * Record every visible layer into one ordered scene.
 *
 * Exported so the run partitioning can be asserted from Node, which is the one
 * property of a GL renderer that Node *can* check: 7264 tests passed with the
 * board's layer order inverted, and the tell was never a pixel.
 */
export function recordGerberScene(scene: Scene, content: GerberGlContent, viewScale: number): void {
  scene.clear();
  const scale = viewScale > 0 && Number.isFinite(viewScale) ? viewScale : 1;
  const rec = new GlRecorder(scene, {
    // `referenceScale` is the scale the caller's `1 / scale` width requests
    // were computed against, so the recorder can turn them into "at least k
    // device pixels" and let the shader apply the floor at the real zoom.
    referenceScale: scale,
    // `worldScale` is 1, NOT the view scale, and the difference is not
    // cosmetic. pcb_gl passes the view scale because `renderer.ts` records
    // *through* a scaled view and the scale has to be divided back out. This
    // painter records raw world coordinates - nothing has applied a view - so
    // dividing would shrink the whole scene by the zoom factor and, worse,
    // make the buffers view-dependent, which is exactly the re-record-on-zoom
    // this backend exists to avoid. Caught by the test that records the same
    // content at scale 1 and scale 8 and compares the buffers.
    worldScale: 1,
    devicePixelRatio: 1,
    // m_outlineWidth is 1 IU, a hairline; KiCad's shader clamps it to a pixel
    // and draws it solid rather than fading it, which is what keeps a sketch
    // outline readable at every zoom.
    hairlines: 'solid',
  });
  // Stated even though it is currently a no-op: our gerbview engine works in
  // board IU, so GBR_ARC_TOLERANCE and the recorder's default are the same
  // number and a mutation removing this line kills no test. It is kept because
  // the two are equal by coincidence of scale, not by definition - see
  // gl_arc_tolerance.test.ts, which pins that. The alternative, deleting it,
  // would leave the gerbview path silently inheriting the board's constant.
  rec.arcTolerance = GBR_ARC_TOLERANCE;
  const surface = rec as unknown as SURFACE;

  /**
   * `m_gerbviewSettings.m_outlineWidth`, which is **1 IU**
   * (`common/render_settings.cpp:43`) - a true world width, not a screen one.
   *
   * This was `1 / scale` first, copying what the 2D painter has to do because
   * Canvas2D has no shader to clamp with. On the GL path that is the mistake
   * this port was warned about before it started: a minimum line width belongs
   * to the view, not to a vertex. Baking the zoom into a recorded width makes
   * the buffer view-dependent, which forces a re-record on every zoom - and it
   * showed up here as the same content recording two different segment widths
   * at scale 1 and scale 8.
   *
   * Stored true, clamped in the shader: `hairlines: 'solid'` above is KiCad's
   * `u_minLinePixelWidth` path, which floors a stroke at one device pixel and
   * draws it solid rather than fading it. That clamp is why a KiCad hairline
   * stays visible at every zoom.
   */
  const worldPen = 1;

  for (let i = 0; i < content.layers.length; i++) {
    const layer = content.layers[i]!;
    if (!layer.visible || layer.image.items.length === 0) continue;

    // A run boundary per layer. `mark` also breaks the open run, so nothing
    // from the layer below can be folded into this one's range.
    scene.mark(layerMark(i));

    const ordered = orderWithinLayer(layer.image.items, content.highlightTest);
    // The mixed-kind flashes are painted twice, fills then strokes, so the
    // whole bucket is two runs instead of two per item. `paint` is the same
    // call in both cases; only the filter differs.
    const passes: (undefined | 'fill' | 'stroke')[] =
      ordered.mixed.length > 0 ? [undefined, 'fill', 'stroke'] : [undefined];

    for (const only of passes) {
      const list = only === undefined ? ordered.plain : ordered.mixed;
      for (const item of list) {
        // GERBVIEW_RENDER_SETTINGS::GetColor, in upstream's own branch order:
        // polarity is tested BEFORE the highlight (`gerbview_painter.cpp:122`
        // vs `:135`), so a clear object that also matches the highlight is
        // drawn as a negative object, or not at all, rather than brightened.
        const clear = !item.layerPolarity;
        let color: string;
        if (clear) {
          // COLOR4D( 0, 0, 0, 0 ) with the toggle off: nothing is recorded at
          // all, which is what the OpenGL GAL draws.
          if (!content.showNegativeObjects) continue;
          color = layer.negativeColor;
        } else if (content.highlightTest?.(item) === true) {
          color = layer.highlightColor;
        } else {
          color = layer.color;
        }

        surface.fillStyle = color;
        surface.strokeStyle = color;
        paintItemGeometry(surface, item, content, worldPen, only);
      }
    }
  }
  scene.closeItem();
}

export class GerbviewGl {
  private readonly scene = createGerberScene();
  private recorded: GerberGlContent | null = null;
  private recordedScale = 0;
  /** Timing of the last record, for `?perf=1` and for tests. */
  lastRecordMs = 0;
  /**
   * How many times the layers have been recorded.
   *
   * The claim this backend rests on is that recording happens when the files
   * change and not on a pan or a zoom, which is a claim about a count. Timing
   * alone cannot tell "recorded once" from "recorded every frame".
   */
  recordCount = 0;

  private constructor(private readonly device: GlDevice) {}

  static create(canvas: HTMLCanvasElement): GerbviewGl | null {
    const device = createGlDevice(canvas);
    return device ? new GerbviewGl(device) : null;
  }

  get isLost(): boolean {
    return this.device.isLost;
  }

  render(content: GerberGlContent, view: GerberGlView): void {
    // Re-record only when the content changed. The reference is compared
    // field by field: a fresh options object every frame would re-record
    // everything and show up only as "still slow".
    if (this.recorded === null || !sameContent(this.recorded, content)) {
      const t0 = performance.now();
      recordGerberScene(this.scene, content, view.scale);
      this.device.upload(this.scene);
      this.recorded = content;
      this.recordedScale = view.scale;
      this.lastRecordMs = performance.now() - t0;
      this.recordCount++;
    }

    const glView: GlView = {
      // Flip view mirrors X; gerber Y grows upwards, so the Y scale is negated
      // exactly as the 2D painter's setTransform does.
      scaleX: view.flipX ? -view.scale : view.scale,
      scaleY: -view.scale,
      offsetX: view.tx,
      offsetY: view.ty,
    };
    // Transparent: the 2D canvas underneath has already painted the background,
    // the grid and the axes.
    this.device.draw(glView, null);
  }

  /**
   * A census of the recorded run list, for `?perf=1`.
   *
   * The draw-call count a frame issues is exactly the run count, so this is
   * the number to look at when a GL frame is slow: 3482 draws on a 19-layer
   * board is a run list that alternates primitive kind, not a lot of geometry.
   */
  get runCensus(): { runs: number; byKind: Record<string, number>; longest: number } {
    const byKind: Record<string, number> = {};
    let longest = 0;
    for (const r of this.scene.runs) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      if (r.count > longest) longest = r.count;
    }
    return { runs: this.scene.runs.length, byKind, longest };
  }

  /** The first few runs, for `?perf=1` - the shape of the alternation. */
  get runHead(): { kind: string; count: number }[] {
    return this.scene.runs.slice(0, 24).map((r) => ({ kind: r.kind, count: r.count }));
  }

  /** The scale the current buffers were recorded at, for tests. */
  get scaleOfRecord(): number {
    return this.recordedScale;
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
 * Compared field by field rather than by reference, because the frame builds
 * this object in a `useMemo` whose dependencies include state that changes on
 * a pointer move. A reference comparison here is the "content keys compared by
 * reference" trap: correct-looking, and it re-records every frame.
 */
function sameContent(a: GerberGlContent, b: GerberGlContent): boolean {
  if (
    a.flashedSketch !== b.flashedSketch ||
    a.linesSketch !== b.linesSketch ||
    a.polygonsSketch !== b.polygonsSketch ||
    a.showNegativeObjects !== b.showNegativeObjects ||
    a.highlightTest !== b.highlightTest ||
    a.layers.length !== b.layers.length
  ) {
    return false;
  }
  for (let i = 0; i < a.layers.length; i++) {
    const x = a.layers[i]!;
    const y = b.layers[i]!;
    if (
      x.image !== y.image ||
      x.visible !== y.visible ||
      x.color !== y.color ||
      x.negativeColor !== y.negativeColor ||
      x.highlightColor !== y.highlightColor
    ) {
      return false;
    }
  }
  return true;
}
