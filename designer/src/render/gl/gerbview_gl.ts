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

import {
  APERTURE_DEF_HOLETYPE,
  APERTURE_T,
  GBR_BASIC_SHAPE_TYPE,
  type GERBER_DRAW_ITEM,
  type GERBER_FILE_IMAGE,
} from '@ziroeda/gerbview';
import { GERBER_DRAW_LAYER } from '@ziroeda/common/layer_id.js';
import { SURFACE_GAL, type SURFACE } from '../../editors/gerbview/gerber_surface_gal.js';
import { GERBER_DCODE_COLOR, GERBER_NEGATIVE_COLOR } from '../../editors/gerbview/gerberColors.js';
import {
  gerberPainter,
  syncGerbviewSettings,
  type GerberHighlight,
} from '../../editors/gerbview/gerberRender.js';
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
}

export interface GerberGlContent {
  /** Bottom-to-top, active layer last, as the frame orders them. */
  layers: readonly GerberGlLayer[];
  /** `!m_DisplayFlashedItemsFill`. */
  flashedSketch: boolean;
  /** `!m_DisplayLinesFill`. */
  linesSketch: boolean;
  /** `!m_DisplayPolygonsFill`. */
  polygonsSketch: boolean;
  /** `gvconfig()->m_Appearance.show_negative_objects`. */
  showNegativeObjects: boolean;
  /** GERBVIEW_RENDER_SETTINGS' highlight selections. */
  highlight: GerberHighlight;
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
 * Rank an item by the primitive kind it records as, so items recording the
 * same kind end up adjacent and the run list stays short.
 *
 * Read off what GERBVIEW_PAINTER asks the GAL for: a filled circle, rectangle
 * or polygon goes through `fill()`, which the recorder triangulates; a segment,
 * an arc, an oval flash (`DrawSegment`) and every outline in sketch mode go
 * through `stroke()`. Only the grouping matters, not the ranking's order.
 */
const KIND_TRI = 0;
const KIND_SEG = 1;

function kindRank(item: GERBER_DRAW_ITEM, content: GerberGlContent): number {
  switch (item.m_ShapeType) {
    case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
      return content.polygonsSketch ? KIND_SEG : KIND_TRI;

    case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT: {
      const code = item.GetDcodeDescr();
      if (code && code.m_ApertType === APERTURE_T.APT_RECT)
        return content.linesSketch ? KIND_SEG : KIND_TRI;
      return KIND_SEG;
    }

    case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
      return KIND_SEG;

    case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
      // The painter sets no fill mode for a circle: the GAL keeps its default.
      return KIND_TRI;

    case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL: {
      if (content.flashedSketch) return KIND_SEG;
      const code = item.GetDcodeDescr();
      return code && code.m_DrillShape !== APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE
        ? KIND_TRI
        : KIND_SEG;
    }

    default:
      return content.flashedSketch ? KIND_SEG : KIND_TRI;
  }
}

/**
 * Whether GERBVIEW_RENDER_SETTINGS::GetColor would give this item its layer's
 * highlight colour — its four highlight branches, in its order.
 */
function isHighlighted(item: GERBER_DRAW_ITEM, hl: GerberHighlight): boolean {
  const net = item.GetNetAttributes();
  const code = item.GetDcodeDescr();

  if (hl.net !== '' && hl.net === net.m_Netname) return true;
  if (hl.component !== '' && hl.component === net.m_Cmpref) return true;
  if (hl.attribute !== '' && code && hl.attribute === code.m_AperFunction) return true;
  if (hl.dcode > 0 && code && hl.dcode === code.m_Num_Dcode) return true;
  return false;
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
  content: GerberGlContent,
): readonly GERBER_DRAW_ITEM[] {
  // Decorate-sort-undecorate on indices, so the sort is stable and the
  // predicate runs once per item rather than once per comparison.
  const keyed = items.map((item, index) => ({
    item,
    index,
    hi: isHighlighted(item, content.highlight) ? 1 : 0,
    kind: kindRank(item, content),
    dcode: item.m_DCode,
  }));
  // Kind first. Sorting by D-code within the flash group was the first attempt
  // and it is what left ~85 runs a layer: consecutive apertures alternate
  // between round (filled, so triangles) and obround (stroked, so segments),
  // so every D-code opened a run. The D-code is now only a tiebreak *inside*
  // one kind, where it costs nothing and keeps identical geometry together.
  keyed.sort((a, b) => a.hi - b.hi || a.kind - b.kind || a.dcode - b.dcode || a.index - b.index);
  return keyed.map((k) => k.item);
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
   * Stored true, clamped in the shader: `hairlines: 'solid'` above is KiCad's
   * `u_minLinePixelWidth` path, which floors a stroke at one device pixel and
   * draws it solid rather than fading it. Baking the zoom into a recorded
   * width would make the buffer view-dependent and force a re-record per zoom.
   */
  const worldPen = 1;

  syncGerbviewSettings(content);
  const painter = gerberPainter(
    content.layers.map((l) => l.color),
    content.layers[0]?.negativeColor ?? GERBER_NEGATIVE_COLOR,
    GERBER_DCODE_COLOR,
    content.highlight,
  );
  painter.SetGAL(new SURFACE_GAL(surface, worldPen));

  for (let i = 0; i < content.layers.length; i++) {
    const layer = content.layers[i]!;
    if (!layer.visible || layer.image.GetItemsCount() === 0) continue;

    // A run boundary per layer. `mark` also breaks the open run, so nothing
    // from the layer below can be folded into this one's range.
    scene.mark(layerMark(i));

    // GERBVIEW_RENDER_SETTINGS::GetColor decides each item's colour; a clear
    // item with the negative toggle off is COLOR4D( 0, 0, 0, 0 ) and records
    // nothing, which is what the OpenGL GAL draws.
    const drawLayer = GERBER_DRAW_LAYER(i);
    for (const item of orderWithinLayer(layer.image.GetItems(), content))
      painter.Draw(item, drawLayer);
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
    a.highlight.net !== b.highlight.net ||
    a.highlight.component !== b.highlight.component ||
    a.highlight.attribute !== b.highlight.attribute ||
    a.highlight.dcode !== b.highlight.dcode ||
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
      x.negativeColor !== y.negativeColor
    ) {
      return false;
    }
  }
  return true;
}
