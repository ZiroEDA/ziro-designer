// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `hash_fp_item` (`common/hash_eda.cpp`, `include/hash_eda.h`): a structural
 * hash of a footprint and its children, used to tell identical footprints,
 * pads and vias apart from different ones. Upstream keeps the file in
 * `common/` but builds it on pcbnew's classes; our `common/` never imports
 * pcbnew, so it sits here beside them.
 *
 * Upstream folds every field into a `size_t` with `hash_combine`; this port
 * folds the same fields, in the same order and under the same flags, into a
 * canonical string. Two items get equal strings exactly when they get equal
 * hashes (short of a 64-bit collision), which is every use the GenCAD and
 * IPC-2581 exporters make of it: IPC-2581 keys its dictionaries by the hash but
 * only looks them up, never walks them, so its numbering is insertion order.
 * The numbers themselves are not reproduced; a format that ordered its output
 * by hash value would need the numeric `std::hash` / `hash_combine` port.
 *
 * Kept from upstream as written: the start/end "sort" of a shape swaps when
 * `x` OR `y` is greater, which is not an ordering, so two lines drawn in
 * opposite directions can hash differently; a footprint sums its children's
 * hashes, so their order never matters (here: the sorted multiset).
 */

import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import type { LSET } from '@ziroeda/common/lset.js';
import type { STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD_ITEM } from './board_item.js';
import type { FOOTPRINT } from './footprint.js';
import { PAD, PAD_ATTRIB, PAD_SHAPE } from './pad.js';
import { PADSTACK } from './padstack.js';
import type { PCB_BARCODE } from './pcb_barcode.js';
import type { PCB_FIELD } from './pcb_field.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import type { PCB_TABLE } from './pcb_table.js';
import type { PCB_TEXT } from './pcb_text.js';
import type { PCB_TEXTBOX } from './pcb_textbox.js';
import type { PCB_VIA } from './pcb_track.js';

export enum HASH_FLAGS {
  HASH_POS = 0x01,
  /// Use coordinates relative to the parent object.
  REL_COORD = 0x02,
  /// Use coordinates relative to the shape position.
  REL_POS = 0x04,
  HASH_ROT = 0x08,
  HASH_LAYER = 0x10,
  HASH_NET = 0x20,
  HASH_REF = 0x40,
  HASH_VALUE = 0x80,
  HASH_ALL = 0xff,
}

/** One hashed value: `std::hash<double>` maps -0.0 and 0.0 to the same hash. */
const v = (aValue: number | boolean | string): string =>
  typeof aValue === 'number' ? String(aValue === 0 ? 0 : aValue) : String(aValue);

/** `hash_combine( seed, values... )`: the values appended in order. */
function combine(aSeed: string[], ...aValues: (number | boolean | string)[]): void {
  for (const value of aValues) aSeed.push(v(value));
}

const layerSetToken = (aSet: LSET): string => aSet.FmtHex();

/** `hash_board_item`: the layer set under HASH_LAYER, else 0. */
function hash_board_item(aItem: BOARD_ITEM, aFlags: number): string {
  if (aFlags & HASH_FLAGS.HASH_LAYER) return layerSetToken(aItem.GetLayerSet());

  return '0';
}

/** Point lists are combined as x, y pairs. */
function combinePoint(aSeed: string[], aPoint: VECTOR2I): void {
  combine(aSeed, aPoint.x, aPoint.y);
}

/**
 * Calculate a hash of an EDA_ITEM's structure.
 *
 * @param aItem is the item for which the hash will be computed.
 * @param aFlags are the HASH_FLAGS deciding what goes in.
 * @return the hash, as a canonical string.
 */
export function hash_fp_item(aItem: EDA_ITEM, aFlags: number = HASH_FLAGS.HASH_ALL): string {
  const ret: string[] = [];

  switch (aItem.Type()) {
    case KICAD_T.PCB_FOOTPRINT_T: {
      const footprint = aItem as unknown as FOOTPRINT;
      ret.push(hash_board_item(footprint, aFlags));

      if (aFlags & HASH_FLAGS.HASH_POS)
        combine(ret, footprint.GetPosition().x, footprint.GetPosition().y);

      if (aFlags & HASH_FLAGS.HASH_ROT) combine(ret, footprint.GetOrientation().AsDegrees());

      const hashes: string[] = [];

      for (const item of footprint.GraphicalItems())
        hashes.push(hash_fp_item(item as unknown as EDA_ITEM, aFlags));

      for (const pad of footprint.Pads())
        hashes.push(hash_fp_item(pad as unknown as EDA_ITEM, aFlags));

      hashes.sort();

      for (const h of hashes) ret.push(`{${h}}`);

      break;
    }

    case KICAD_T.PCB_VIA_T: {
      const via = aItem as unknown as PCB_VIA;
      ret.push(v(via.GetDrillValue()));
      combine(ret, via.TopLayer());
      combine(ret, via.BottomLayer());

      via.GetLayerSet().RunOnLayers((layer) => {
        combine(ret, via.GetWidth(layer));
        combine(ret, via.FlashLayer(layer));
      });

      break;
    }

    case KICAD_T.PCB_PAD_T: {
      const pad = aItem as unknown as PAD;
      ret.push(v(pad.GetAttribute()));

      const hashPadLayer = (aLayer: number): void => {
        combine(ret, pad.GetShape(aLayer));
        combine(ret, pad.GetSize(aLayer).x, pad.GetSize(aLayer).y);
        combine(ret, pad.GetOffset(aLayer).x, pad.GetOffset(aLayer).y);

        switch (pad.GetShape(PADSTACK.ALL_LAYERS)) {
          case PAD_SHAPE.CHAMFERED_RECT:
            combine(ret, pad.GetChamferPositions(aLayer));
            combine(ret, pad.GetChamferRectRatio(aLayer));
            break;

          case PAD_SHAPE.ROUNDRECT:
            combine(ret, pad.GetRoundRectCornerRadius(aLayer));
            break;

          case PAD_SHAPE.TRAPEZOID:
            combine(ret, pad.GetDelta(aLayer).x, pad.GetDelta(aLayer).y);
            break;

          case PAD_SHAPE.CUSTOM: {
            const poly = pad.GetEffectivePolygon(aLayer, ERROR_LOC.ERROR_INSIDE);

            for (let ii = 0; ii < poly.VertexCount(); ++ii) {
              const vertex = poly.CVertex(ii);
              combinePoint(ret, {
                x: vertex.x - pad.GetPosition().x,
                y: vertex.y - pad.GetPosition().y,
              });
            }

            break;
          }

          default:
            break;
        }
      };

      pad.Padstack().ForEachUniqueLayer(hashPadLayer);

      if (pad.GetAttribute() === PAD_ATTRIB.PTH || pad.GetAttribute() === PAD_ATTRIB.NPTH) {
        combine(ret, pad.GetDrillSizeX(), pad.GetDrillSizeY());
        combine(ret, pad.GetDrillShape());

        pad.GetLayerSet().RunOnLayers((layer) => {
          combine(ret, pad.FlashLayer(layer));
        });
      }

      ret.push(hash_board_item(pad, aFlags));

      if (aFlags & HASH_FLAGS.HASH_POS) {
        if (aFlags & HASH_FLAGS.REL_COORD) combinePoint(ret, pad.GetFPRelativePosition());
        else combinePoint(ret, pad.GetPosition());
      }

      if (aFlags & HASH_FLAGS.HASH_ROT) combine(ret, pad.GetOrientation().AsDegrees());

      if (aFlags & HASH_FLAGS.HASH_NET) combine(ret, pad.GetNetCode());

      break;
    }

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH, as upstream
    case KICAD_T.PCB_FIELD_T: {
      const field = aItem as unknown as PCB_FIELD;

      if (!(aFlags & HASH_FLAGS.HASH_REF) && field.IsReference()) break;

      if (!(aFlags & HASH_FLAGS.HASH_VALUE) && field.IsValue()) break;
    }
    case KICAD_T.PCB_TEXT_T: {
      const text = aItem as unknown as PCB_TEXT;
      ret.push(hash_board_item(text, aFlags));
      combine(ret, JSON.stringify(text.GetText()));
      combine(ret, text.IsItalic());
      combine(ret, text.IsBold());
      combine(ret, text.IsMirrored());
      combine(ret, text.GetTextWidth());
      combine(ret, text.GetTextHeight());
      combine(ret, text.GetHorizJustify());
      combine(ret, text.GetVertJustify());

      if (aFlags & HASH_FLAGS.HASH_POS) {
        const pos =
          aFlags & HASH_FLAGS.REL_COORD ? text.GetFPRelativePosition() : text.GetPosition();
        combinePoint(ret, pos);
      }

      if (aFlags & HASH_FLAGS.HASH_ROT) combine(ret, text.GetTextAngle().AsDegrees());

      break;
    }

    case KICAD_T.PCB_BARCODE_T: {
      const barcode = aItem as unknown as PCB_BARCODE;
      ret.push(hash_board_item(barcode, aFlags));
      combine(ret, barcode.GetWidth(), barcode.GetHeight());
      combine(ret, barcode.GetPosition().x, barcode.GetPosition().y);
      combine(ret, barcode.GetMargin().x, barcode.GetMargin().y);
      combine(ret, JSON.stringify(barcode.Text().GetText()));
      combine(ret, barcode.Text().GetTextHeight());
      combine(ret, barcode.GetKind());
      combine(ret, barcode.GetAngle().AsDegrees());
      combine(ret, barcode.GetErrorCorrection());
      break;
    }

    case KICAD_T.PCB_SHAPE_T: {
      const shape = aItem as unknown as PCB_SHAPE;
      ret.push(hash_board_item(shape, aFlags));
      combine(ret, shape.GetShape());
      combine(ret, shape.GetWidth());
      combine(ret, shape.GetFillMode());
      combine(ret, shape.GetLineStyle());

      if (shape.GetShape() === SHAPE_T.ARC || shape.GetShape() === SHAPE_T.CIRCLE)
        combine(ret, shape.GetRadius());

      if (aFlags & HASH_FLAGS.HASH_POS) {
        let points: VECTOR2I[] = [];
        points.push(shape.GetStart());
        points.push(shape.GetEnd());

        if (shape.GetShape() === SHAPE_T.CIRCLE) points.push(shape.GetCenter());

        if (shape.GetShape() === SHAPE_T.ARC) points.push(shape.GetArcMid());

        const parentFP = shape.GetParentFootprint();

        if (shape.GetShape() === SHAPE_T.POLY) {
          for (const pt of shape.GetPolyShape().CIterateWithHoles()) points.push(pt);
        }

        if (shape.GetShape() === SHAPE_T.BEZIER) {
          points.push(shape.GetBezierC1());
          points.push(shape.GetBezierC2());
        }

        if (parentFP && aFlags & HASH_FLAGS.REL_COORD) {
          points = points.map((point) =>
            RotatePoint(
              { x: point.x - parentFP.GetPosition().x, y: point.y - parentFP.GetPosition().y },
              parentFP.GetOrientation().Invert(),
            ),
          );
        }

        if (aFlags & HASH_FLAGS.REL_POS) {
          const pos = shape.GetPosition();
          points = points.map((point) => ({ x: point.x - pos.x, y: point.y - pos.y }));
        }

        // Basic sort of start/end points to try to always draw the same direction (left to
        // right, down to up). The hashes are summed, so it doesn't matter what order the
        // lines are drawn, only that the same points are used
        if (points.length > 1) {
          if (points[0]!.x > points[1]!.x || points[0]!.y > points[1]!.y)
            [points[0], points[1]] = [points[1]!, points[0]!];
        }

        for (const point of points) combinePoint(ret, point);
      }

      break;
    }

    case KICAD_T.PCB_TABLECELL_T:
    case KICAD_T.PCB_TEXTBOX_T: {
      const textbox = aItem as unknown as PCB_TEXTBOX;
      ret.push(hash_board_item(textbox, aFlags));
      combine(ret, JSON.stringify(textbox.GetText()));
      combine(ret, textbox.IsItalic());
      combine(ret, textbox.IsBold());
      combine(ret, textbox.IsMirrored());
      combine(ret, textbox.GetTextWidth());
      combine(ret, textbox.GetTextHeight());
      combine(ret, textbox.GetHorizJustify());
      combine(ret, textbox.GetVertJustify());

      if (aFlags & HASH_FLAGS.HASH_ROT) combine(ret, textbox.GetTextAngle().AsDegrees());

      combine(ret, textbox.GetShape());
      combine(ret, textbox.GetWidth());
      combine(ret, textbox.GetLineStyle());

      if (aFlags & HASH_FLAGS.HASH_POS) {
        let start = textbox.GetStart();
        let end = textbox.GetEnd();
        const parentFP = textbox.GetParentFootprint();

        if (parentFP && aFlags & HASH_FLAGS.REL_COORD) {
          const pos = parentFP.GetPosition();
          const rot = parentFP.GetOrientation().Invert();
          start = RotatePoint({ x: start.x - pos.x, y: start.y - pos.y }, rot);
          end = RotatePoint({ x: end.x - pos.x, y: end.y - pos.y }, rot);
        }

        combine(ret, start.x);
        combine(ret, start.y);
        combine(ret, end.x);
        combine(ret, end.y);
      }

      break;
    }

    case KICAD_T.PCB_TABLE_T: {
      const table = aItem as unknown as PCB_TABLE;
      ret.push(hash_board_item(table, aFlags));
      combine(ret, table.StrokeExternal());
      combine(ret, table.StrokeHeaderSeparator());
      combine(ret, table.StrokeColumns());
      combine(ret, table.StrokeRows());

      const hash_stroke = (stroke: STROKE_PARAMS): void => {
        const c = stroke.GetColor();
        combine(ret, c.r, c.g, c.b, c.a);
        combine(ret, stroke.GetWidth());
        combine(ret, stroke.GetLineStyle());
      };

      hash_stroke(table.GetSeparatorsStroke());
      hash_stroke(table.GetBorderStroke());
      break;
    }

    default:
      // UNIMPLEMENTED_FOR( aItem->GetClass() ): an assert in a debug build, 0 otherwise.
      break;
  }

  // Upstream's result carries no type: a text box and a table cell with the
  // same content hash alike, and a skipped field is 0.
  return ret.length === 0 ? '0' : ret.join(',');
}
