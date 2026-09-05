// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `PCB_BARCODE`'s geometry: `ComputeBarcode`, `ComputeTextPoly`, `SetRect`
 * and `AssembleBarcode` (`pcbnew/pcb_barcode.cpp:324-537`).
 *
 * None of this is stored. The file holds the string, the symbology and the
 * error-correction level; `parsePCB_BARCODE` ends with `AssembleBarcode()` and
 * every load recomputes the modules from scratch, so this runs on read, on
 * every edit, and on every text-variable change.
 *
 * The four steps, in the order `AssembleBarcode` runs them:
 *
 *  1. `ComputeBarcode` encodes the text and turns the module grid into
 *     rectangles, centred on the origin.
 *  2. `SetRect` scales those to the item's own width and height — which is why
 *     the encoder's own units never matter — and centres them at its position.
 *  3. `ComputeTextPoly` lays the human-readable line out under the symbol.
 *  4. The two are unioned, the knockout inverted if asked for, the whole thing
 *     mirrored on a back layer and rotated.
 */
import { layoutText } from '@ziroeda/common/src/font/stroke_font.js';
import { penSizeForNormal } from '@ziroeda/common/src/font/text_box.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  CornerStrategy,
  booleanAdd,
  booleanSubtract,
  fracture,
  inflate,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { encodeBarcode } from './barcode/zint.js';
import { moduleIsSet, type ZintSymbol } from './barcode/common.js';
import type { BarcodeEcc, BarcodeKind, PcbBarcode } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * `SHAPE_POLY_SET`: a list of polygons, each an outline followed by its holes.
 * `Polygon` alone is one of those, so the set is `Polygon[]`.
 */
export type PolySet = Polygon[];

/** An axis-aligned box in IU, `BOX2I`. */
export interface BarcodeBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BarcodeGeometry {
  /**
   * `m_poly` — everything the painter fills, in board coordinates. Already
   * scaled, knocked out, mirrored and rotated.
   */
  poly: PolySet;
  /** `m_symbolPoly`, the modules alone, for the bounding hull. */
  symbolPoly: PolySet;
  /** `m_textPoly`, the human-readable line alone. */
  textPoly: PolySet;
  /** `m_bbox` — `m_poly`'s, which is what `GetBoundingBox` returns. */
  bbox: BarcodeBox;
  /** `m_lastError`; empty when the symbol encoded. */
  error: string;
}

const EMPTY_BOX: BarcodeBox = { x1: 0, y1: 0, x2: 0, y2: 0 };

/**
 * How finely `inflate` approximates the round cap on a text stroke. Upstream
 * passes `GetMaxError()` — a distance — where our `inflate` takes a segment
 * count; sixteen is its own default and about 0.02 mm of chord error on a
 * 1.27 mm glyph's pen, well under the 0.005 mm KiCad's default max error works
 * out to at this size but invisible either way, since this shape is only ever
 * filled or subtracted.
 */
const ARC_SEGS = 16;

/** `KiROUND`: half away from zero, unlike `Math.round`'s half up. */
const kiRound = (v: number): number => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

function boxOf(poly: PolySet): BarcodeBox {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;

  for (const rings of poly)
    for (const ring of rings)
      for (const p of ring) {
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }

  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : { ...EMPTY_BOX };
}

const boxCentre = (b: BarcodeBox): Vec2 => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

const movePoly = (poly: PolySet, d: Vec2): PolySet =>
  poly.map((rings) => rings.map((ring) => ring.map((p) => ({ x: p.x + d.x, y: p.y + d.y }))));

/**
 * `ComputeBarcode` (`pcb_barcode.cpp:412-537`): encode, then walk
 * `symbol->vector->rectangles`.
 *
 * Zint's vector stage merges horizontally adjacent set modules into one
 * rectangle per run (`vector.c:661-675`) and scales everything by
 * `symbol->scale * 2` (`vector.c:215`), which for the default scale of 1 makes
 * a module two units across. KiCad then multiplies by `symbol->scale` again —
 * by 1, so the modules come out two units wide.
 *
 * That unit is arbitrary and is about to be scaled away by `SetRect`; what it
 * buys is that every coordinate is an integer, so the `KiROUND` upstream
 * applies here rounds nothing.
 *
 * The hexagon loop that follows in `ComputeBarcode` is MaxiCode's, and none of
 * `BARCODE_T`'s five produce one.
 */
export function symbolRects(symbol: ZintSymbol): PolySet {
  const SCALE = 2; // `symbol->scale * 2.0`, with scale left at its default 1.
  const out: PolySet = [];

  // `row_height[r] ? row_height[r] : large_bar_height` (`vector.c:662`): a
  // linear symbology leaves every row height at zero and the output stage
  // shares `symbol->height` among them, which for one row is all of it.
  // `rowHeight` is left EMPTY by the linear encoders rather than filled with
  // zeroes, so this counts by row index rather than over the array — a
  // `slice(0, rows)` of an empty array is empty, and every bar would come out
  // zero-height.
  let zeroRows = 0;
  let fixed = 0;
  for (let r = 0; r < symbol.rows; r++) {
    const h = symbol.rowHeight[r] ?? 0;
    if (h) fixed += h;
    else zeroRows++;
  }
  const largeBar = zeroRows ? (symbol.height - fixed) / zeroRows : 0;

  let yposn = 0;

  for (let r = 0; r < symbol.rows; r++) {
    const rowHeight = symbol.rowHeight[r] || largeBar;

    for (let i = 0; i < symbol.width; ) {
      const fill = moduleIsSet(symbol, r, i);
      let blockWidth = 1;
      while (i + blockWidth < symbol.width && moduleIsSet(symbol, r, i + blockWidth) === fill)
        blockWidth++;

      if (fill) {
        // "Round using absolute edges to avoid cumulative rounding drift
        // across modules" (`pcb_barcode.cpp:495`).
        const x1 = kiRound(i * SCALE);
        const x2 = kiRound((i + blockWidth) * SCALE);
        const y1 = kiRound(yposn * SCALE);
        const y2 = kiRound((yposn + rowHeight) * SCALE);

        out.push([
          [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ],
        ]);
      }

      i += blockWidth;
    }

    yposn += rowHeight;
  }

  // "Set the position of the barcode to the center of the symbol polygon".
  if (out.length) {
    const c = boxCentre(boxOf(out));
    return movePoly(out, { x: -kiRound(c.x), y: -kiRound(c.y) });
  }

  return out;
}

/**
 * `SetRect` (`pcb_barcode.cpp:592-625`): scale the symbol polygon so its
 * bounding box is exactly `width` x `height`, and centre it at `at`.
 *
 * This is what makes the encoder's units irrelevant, and it is also why a
 * linear barcode fills its box: one row of full-height bars stretches to
 * whatever height the item was given.
 */
export function setRect(symbolPoly: PolySet, at: Vec2, width: number, height: number): PolySet {
  if (symbolPoly.length === 0) return symbolPoly;

  const bbox = boxOf(symbolPoly);
  const oldW = bbox.x2 - bbox.x1;
  const oldH = bbox.y2 - bbox.y1;

  // "Guard against zero/negative sizes from interactive edits."
  const minIU = Math.max(1, mmToIU(0.01));
  const newW = Math.max(width, minIU);
  const newH = Math.max(height, minIU);

  const scaleX = oldW ? newW / oldW : 1;
  const scaleY = oldH ? newH / oldH : 1;
  const oldCentre = boxCentre(bbox);

  const scaled = symbolPoly.map((rings) =>
    rings.map((ring) =>
      ring.map((p) => ({
        x: kiRound((p.x - oldCentre.x) * scaleX + oldCentre.x),
        y: kiRound((p.y - oldCentre.y) * scaleY + oldCentre.y),
      })),
    ),
  );

  const newCentre = boxCentre(boxOf(scaled));
  return movePoly(scaled, { x: at.x - kiRound(newCentre.x), y: at.y - kiRound(newCentre.y) });
}

/**
 * `ComputeTextPoly` (`pcb_barcode.cpp:382-410`): the human-readable line,
 * centred under the symbol with a 1 mm gap.
 *
 * Upstream builds it with `PCB_TEXT::TransformTextToPolySet`, which strokes
 * the glyphs and inflates each stroke by the pen width into a filled outline.
 * We lay the same stroke font out and inflate the same way, because the
 * knockout below has to subtract a real polygon — for the ordinary filled case
 * the two are the same shape.
 */
export function textPoly(text: string, textHeight: number, symbolPoly: PolySet): PolySet {
  if (text === '' || symbolPoly.length === 0) return [];

  // `SetTextSize` sets both axes to the height and the thickness to
  // `GetPenSizeForNormal` (`pcb_barcode.cpp:270-276`).
  const size = Math.max(1, textHeight);
  const penWidth = Math.max(1, penSizeForNormal(size));
  const { strokes } = layoutText(text, size);

  if (strokes.length === 0) return [];

  // Each stroke inflated by half the pen on both sides — a stadium per
  // segment, which is what `TransformTextToPolySet` produces.
  let poly: PolySet = [];
  for (const stroke of strokes) {
    // A single-point stroke is a dot; Clipper needs two coincident points for
    // the offset to produce a disc rather than nothing.
    const seg: PolySet = [[stroke.length === 1 ? [stroke[0]!, stroke[0]!] : stroke]];
    poly = booleanAdd(poly, inflate(seg, penWidth / 2, CornerStrategy.ROUND_ALL_CORNERS, ARC_SEGS));
  }

  if (poly.length === 0) return [];

  const textBox = boxOf(poly);
  const symbolBox = boxOf(symbolPoly);
  const textOffset = mmToIU(1);

  return movePoly(poly, {
    x: boxCentre(symbolBox).x - boxCentre(textBox).x,
    y: symbolBox.y2 - textBox.y1 + textOffset,
  });
}

/** `RotatePoint` (trigo.cpp) in screen coordinates, degrees. */
function rotate(p: Vec2, centre: Vec2, angleDeg: number): Vec2 {
  if (angleDeg === 0) return p;
  const a = (angleDeg * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return {
    x: kiRound(dy * s + dx * c) + centre.x,
    y: kiRound(dy * c - dx * s) + centre.y,
  };
}

/** Whether a layer is on the back of the board, for the mirror step. */
const isBackLayer = (layer: string): boolean => layer.startsWith('B.');

/**
 * `AssembleBarcode` (`pcb_barcode.cpp:324-380`).
 *
 * The knockout margin is the one number here that is not simply read off the
 * item: at least 10% of the smaller side, rounded UP to the next 0.1 mm, and
 * the `(margins …)` values are a floor on top of that rather than the value
 * itself.
 */
export function barcodeGeometry(b: PcbBarcode): BarcodeGeometry {
  const { symbol, error } = encodeBarcode(b.kind, b.ecc, b.text);

  if (!symbol) return { poly: [], symbolPoly: [], textPoly: [], bbox: { ...EMPTY_BOX }, error };

  const symbolPoly = setRect(symbolRects(symbol), b.at, b.width, b.height);
  const tPoly = b.showText ? textPoly(b.text, b.textHeight, symbolPoly) : [];

  let poly: PolySet = booleanAdd(symbolPoly, tPoly);

  if (b.knockout && poly.length) {
    // "Enforce minimum margin: at least 10% of the smallest side of the
    // barcode, rounded up to the nearest 0.1 mm."
    const minSide = Math.min(b.width, b.height);
    const tenPercent = Math.floor((minSide + 9) / 10);
    const step = Math.max(1, mmToIU(0.1));
    const tenPercentRounded = Math.floor((tenPercent + step - 1) / step) * step;

    const box = boxOf(poly);
    const ix = Math.max(b.margin.x, tenPercentRounded);
    const iy = Math.max(b.margin.y, tenPercentRounded);
    const rect: PolySet = [
      [
        [
          { x: box.x1 - ix, y: box.y1 - iy },
          { x: box.x2 + ix, y: box.y1 - iy },
          { x: box.x2 + ix, y: box.y2 + iy },
          { x: box.x1 - ix, y: box.y2 + iy },
        ],
      ],
    ];

    poly = booleanSubtract(rect, poly);
  }

  // `IsSideSpecific() && GetBoard()->IsBackLayer( m_layer )`: a barcode on a
  // back layer is mirrored, so that it reads correctly from that side.
  if (isBackLayer(b.layer))
    poly = poly.map((rings) =>
      rings.map((ring) => ring.map((p) => ({ x: 2 * b.at.x - p.x, y: p.y }))),
    );

  if (b.angle !== 0)
    poly = poly.map((rings) => rings.map((ring) => ring.map((p) => rotate(p, b.at, b.angle))));

  // `m_poly.Fracture()`: each polygon's holes are joined to its outline by a
  // zero-width slit, so the painter can fill one ring per polygon. A knockout
  // is the case that needs it — it is a rectangle with the symbol cut out.
  poly = fracture(poly).map((ring) => [ring]);

  return { poly, symbolPoly, textPoly: tPoly, bbox: boxOf(poly), error };
}

/**
 * `GetBoundingHull` (`pcb_barcode.cpp:690-723`): two rectangles, one round the
 * symbol and one round the text, rather than the modules themselves — which is
 * what `HitTest` collides against, so clicking a light module inside a QR code
 * selects it.
 */
export function barcodeHullBoxes(g: BarcodeGeometry, b: PcbBarcode): BarcodeBox[] {
  const boxes: BarcodeBox[] = [];
  const hull = (poly: PolySet): void => {
    if (!poly.length) return;
    const box = boxOf(poly);
    const corners: Vec2[] = [
      { x: box.x1, y: box.y1 },
      { x: box.x2, y: box.y1 },
      { x: box.x2, y: box.y2 },
      { x: box.x1, y: box.y2 },
    ].map((p) => rotate(p, b.at, b.angle));
    boxes.push(boxOf([[corners]]));
  };

  hull(g.symbolPoly);
  hull(g.textPoly);
  return boxes;
}

/** Convenience for callers that only want the item's extent. */
export const barcodeBBox = (b: PcbBarcode): BarcodeBox => barcodeGeometry(b).bbox;

export type { BarcodeEcc, BarcodeKind };
