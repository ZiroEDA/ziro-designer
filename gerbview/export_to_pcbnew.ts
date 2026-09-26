// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/export_to_pcbnew.h` + `.cpp`: `GBR_TO_PCB_EXPORTER`, GerbView's
 * "Export to Pcbnew", which writes the loaded images as a `.kicad_pcb`.
 *
 * `ExportPcb` runs four passes over the images, and the order matters:
 *
 *  1. **holes** — every Excellon image's items, and any gerber the mapping put
 *     on `UNDEFINED_LAYER` (the dialog's "Hole Data" row), go to
 *     `collect_hole`, which sorts them into `m_vias` and `m_slots`.
 *  2. **non-copper layers** — `export_non_copper_item`: graphics.
 *  3. **copper layers** — `export_copper_item`: tracks and arcs with
 *     `(net 0)`, plus filled polygons and circles for regions and flashes.
 *  4. the collected vias and slots.
 *
 * Pass 1 precedes pass 3 because `export_flashed_copper_item` swallows a round
 * flash sitting exactly on a via into that via.
 *
 * Coordinates: most items are written from their FILE coordinates with Y
 * negated (upstream's "Reverse Y axis"), so the image transforms (offset,
 * mirror, rotation...) are not applied; flashed shapes are placed at
 * `GetABPosition( m_Start )`, which is. That is upstream's, reproduced.
 *
 * Browser divergences: the board is returned as text rather than written to
 * `m_pcb_file_name`, and the image list is handed to the constructor rather
 * than read off the frame. The `(generator ...)` pair names this program
 * (`common/generator.ts`), which every writer here uses. `writePcbZoneItem`
 * sits behind an `#if 1 ... #else` upstream and is unreachable: not ported.
 */
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { formatDouble2Str } from '@ziroeda/common/plotters/fmt.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNorm, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { GetRotated } from '@ziroeda/kimath/src/trigo.js';
import {
  AllCuMask,
  AllTechMask,
  B_Cu,
  F_Cu,
  IsCopperLayer,
  IsPcbLayer,
  LSET_Name,
  UNDEFINED_LAYER,
  UserMask,
} from '@ziroeda/pcbnew/layer_ids.js';
import { APERTURE_T, D_CODE } from './dcode.js';
import { mapGerberLayersToPcb } from './dialogs/dialog_map_gerber_layers_to_pcb.js';
import { EXCELLON_IMAGE } from './excellon_read_drill_file.js';
import { GBR_BASIC_SHAPE_TYPE, type GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { gerbIUScale } from './gerbview.js';

/** `EXPORT_SLOT`. */
export class EXPORT_SLOT {
  constructor(
    public m_Start: VECTOR2I,
    public m_End: VECTOR2I,
    public m_Width: number,
  ) {}
}

/** `EXPORT_VIA`. */
export class EXPORT_VIA {
  constructor(
    public m_Pos: VECTOR2I,
    public m_Size: number,
    public m_Drill: number,
  ) {}
}

const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `static D_CODE dummyD_CODE( 0 )`: used when a D_CODE is not found. */
let s_dummyD_CODE: D_CODE | null = null;
const dummyD_CODE = (): D_CODE => {
  if (!s_dummyD_CODE) s_dummyD_CODE = new D_CODE(0);
  return s_dummyD_CODE;
};

export class GBR_TO_PCB_EXPORTER {
  /** The images, by graphic layer (`GetGerberLayout()->GetImagesList()`). */
  private m_images: readonly (GERBER_FILE_IMAGE | null)[];
  /** The board file (`FILE* m_fp`), as text. */
  private m_fp: string[] = [];
  private m_pcbCopperLayersCount = 2;
  private m_vias: EXPORT_VIA[] = [];
  private m_slots: EXPORT_SLOT[] = [];

  constructor(aImages: readonly (GERBER_FILE_IMAGE | null)[]) {
    this.m_images = aImages;
    this.m_pcbCopperLayersCount = 2;
  }

  private fprintf(aText: string): void {
    this.m_fp.push(aText);
  }

  /**
   * `MapToPcbUnits`: IU to millimetres. `+ 0` folds a `-0` (a negated int 0
   * in double arithmetic) into the only zero an int has, so it prints `0`.
   */
  private MapToPcbUnits(aValue: number): number {
    return aValue / gerbIUScale.IU_PER_MM + 0;
  }

  private f(aValue: number): string {
    return formatDouble2Str(this.MapToPcbUnits(aValue));
  }

  /**
   * Write the board. `aLayerLookUpTable` is indexed by image, as upstream's
   * is; `aCopperLayers` is the board's copper count.
   *
   * @return the `.kicad_pcb` text.
   */
  ExportPcb(aLayerLookUpTable: readonly number[], aCopperLayers: number): string {
    this.m_fp = [];
    this.m_pcbCopperLayersCount = aCopperLayers;

    this.writePcbHeader(aLayerLookUpTable);

    // First collect all the holes.  We'll use these to generate pads, vias, etc.
    for (let layer = 0; layer < this.m_images.length; ++layer) {
      const pcb_layer_number = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;
      const image = this.m_images[layer] ?? null;
      const excellon = image instanceof EXCELLON_IMAGE ? image : null;

      if (excellon) {
        for (const gerb_item of excellon.GetItems()) this.collect_hole(gerb_item);
      } else if (image && pcb_layer_number === UNDEFINED_LAYER) {
        // PCB_LAYER_ID doesn't have an entry for Hole Data,
        // but the dialog returns UNDEFINED_LAYER for it
        for (const gerb_item of image.GetItems()) this.collect_hole(gerb_item);
      }
    }

    // Next: non copper layers:
    for (let layer = 0; layer < this.m_images.length; ++layer) {
      const gerber = this.m_images[layer] ?? null;

      if (gerber === null) continue; // Graphic layer not yet used

      const pcb_layer_number = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;

      if (!IsPcbLayer(pcb_layer_number) || IsCopperLayer(pcb_layer_number)) continue;

      for (const gerb_item of gerber.GetItems())
        this.export_non_copper_item(gerb_item, pcb_layer_number);
    }

    // Copper layers
    for (let layer = 0; layer < this.m_images.length; ++layer) {
      const gerber = this.m_images[layer] ?? null;

      if (gerber === null) continue; // Graphic layer not yet used

      const pcb_layer_number = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;

      if (!IsCopperLayer(pcb_layer_number)) continue;

      for (const gerb_item of gerber.GetItems())
        this.export_copper_item(gerb_item, pcb_layer_number);
    }

    // Now write out the holes we collected earlier as vias
    for (const via of this.m_vias) this.export_via(via);

    for (const slot of this.m_slots) this.export_slot(slot);

    this.fprintf(')\n');

    return this.m_fp.join('');
  }

  private export_non_copper_item(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    if (aGbrItem.GetLayerPolarity()) return;

    const seg_start = { ...aGbrItem.m_Start };
    const seg_end = { ...aGbrItem.m_End };
    const d_codeDescr = aGbrItem.GetDcodeDescr() ?? dummyD_CODE();

    switch (aGbrItem.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
        this.writePcbPolygon(aGbrItem.m_ShapeAsPolygon, aLayer);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE: {
        const center = aGbrItem.GetABPosition(seg_start);
        const radius = Math.trunc(d_codeDescr.m_Size.x / 2);
        this.writePcbFilledCircle(center, radius, aLayer);
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO: {
        d_codeDescr.ConvertShapeToPolygon(aGbrItem);
        const polyshape = d_codeDescr.m_Polygon.CloneDropTriangulation();

        if (polyshape.OutlineCount() === 0) break;

        // Compensate the Y axis orientation ( writePcbPolygon invert the Y coordinate )
        polyshape.Outline(0).Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);
        this.writePcbPolygon(polyshape, aLayer, aGbrItem.GetABPosition(seg_start));
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
        this.export_non_copper_arc(aGbrItem, aLayer);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
        // Reverse Y axis:
        seg_start.y = -seg_start.y;
        seg_end.y = -seg_end.y;

        this.fprintf(
          `\t(gr_circle (start ${this.f(seg_start.x)} ${this.f(seg_start.y)}) ` +
            `(end ${this.f(seg_end.x)} ${this.f(seg_end.y)}) (layer ${LSET_Name(aLayer)})\n`,
        );
        this.export_stroke_info(aGbrItem.m_Size.x);
        this.fprintf('\t)\n');
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
        if (d_codeDescr.m_ApertType === APERTURE_T.APT_RECT) {
          // Using a rectangular aperture to draw a line is deprecated since 2020
          // However old gerber file can use it (rare case) and can generate
          // strange shapes, because the rect aperture is not rotated to match the
          // line orientation.
          // So draw this line as polygon
          const polyshape = new SHAPE_POLY_SET();
          aGbrItem.ConvertSegmentToPolygon(polyshape);
          this.writePcbPolygon(polyshape, aLayer);
        } else {
          // Reverse Y axis:
          seg_start.y = -seg_start.y;
          seg_end.y = -seg_end.y;

          this.fprintf(
            `\t(gr_line\n\t\t(start ${this.f(seg_start.x)} ${this.f(seg_start.y)}) ` +
              `(end ${this.f(seg_end.x)} ${this.f(seg_end.y)}) (layer ${LSET_Name(aLayer)})\n`,
          );

          this.export_stroke_info(aGbrItem.m_Size.x);
          this.fprintf('\t)\n');
        }

        break;
    }
  }

  private export_non_copper_arc(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    const a = Math.atan2(
      aGbrItem.m_Start.y - aGbrItem.m_ArcCentre.y,
      aGbrItem.m_Start.x - aGbrItem.m_ArcCentre.x,
    );
    let b = Math.atan2(
      aGbrItem.m_End.y - aGbrItem.m_ArcCentre.y,
      aGbrItem.m_End.x - aGbrItem.m_ArcCentre.x,
    );

    const arc_center = { ...aGbrItem.m_ArcCentre };
    const seg_start = { ...aGbrItem.m_Start };
    const seg_end = { ...aGbrItem.m_End };

    if (a > b) b += 2 * Math.PI;

    if (eq(seg_start, seg_end)) {
      // Reverse Y axis:
      arc_center.y = -arc_center.y;
      seg_end.y = -seg_end.y;

      this.fprintf(
        `\t(gr_circle\n\t\t(center ${this.f(arc_center.x)} ${this.f(arc_center.y)}) ` +
          `(end ${this.f(seg_end.x)} ${this.f(seg_end.y)}) (layer ${LSET_Name(aLayer)})\n`,
      );
      this.export_stroke_info(aGbrItem.m_Size.x);
      this.fprintf('\t)\n');
    } else {
      const seg_middle = GetRotated(
        seg_start,
        arc_center,
        new EDA_ANGLE((b - a) / 2, EDA_ANGLE_T.RADIANS_T).negate(),
      );

      // Reverse Y axis:
      seg_middle.y = -seg_middle.y;
      seg_start.y = -seg_start.y;
      seg_end.y = -seg_end.y;

      this.fprintf(
        `\t(gr_arc\n\t\t(start ${this.f(seg_start.x)} ${this.f(seg_start.y)}) ` +
          `(mid ${this.f(seg_middle.x)} ${this.f(seg_middle.y)}) ` +
          `(end ${this.f(seg_end.x)} ${this.f(seg_end.y)}) (layer ${LSET_Name(aLayer)})\n`,
      );

      this.export_stroke_info(aGbrItem.m_Size.x);
      this.fprintf('\t)\n');
    }
  }

  /**
   * "We use vias to mimic holes, with the loss of any hole shape (as we only
   * have round holes in vias at present). We start out with a via size
   * minimally larger than the hole."
   */
  private collect_hole(aGbrItem: GERBER_DRAW_ITEM): void {
    if (aGbrItem.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE)
      this.m_vias.push(
        new EXPORT_VIA({ ...aGbrItem.m_Start }, aGbrItem.m_Size.x + 1, aGbrItem.m_Size.x),
      );
    else if (aGbrItem.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT)
      this.m_slots.push(
        new EXPORT_SLOT({ ...aGbrItem.m_Start }, { ...aGbrItem.m_End }, aGbrItem.m_Size.x),
      );
  }

  private export_via(aVia: EXPORT_VIA): void {
    const via_pos = { ...aVia.m_Pos };

    // Reverse Y axis:
    via_pos.y = -via_pos.y;

    // Layers are Front to Back
    this.fprintf(
      `\t(via (at ${this.f(via_pos.x)} ${this.f(via_pos.y)}) (size ${this.f(aVia.m_Size)}) ` +
        `(drill ${this.f(aVia.m_Drill)})`,
    );

    this.fprintf(` (layers ${LSET_Name(F_Cu)} ${LSET_Name(B_Cu)}))\n`);
  }

  /** A routed slot becomes a one-pad footprint, because a via cannot be oval. */
  private export_slot(aSlot: EXPORT_SLOT): void {
    const start = { ...aSlot.m_Start };
    const end = { ...aSlot.m_End };

    // Reverse Y axis:
    start.y = -start.y;
    end.y = -end.y;

    const dir = { x: end.x - start.x, y: end.y - start.y };
    const minorAxis = aSlot.m_Width;
    // `dir.EuclideanNorm()` on a VECTOR2I is KiROUND'd into the int sum.
    const majorAxis = aSlot.m_Width + KiROUND(EuclideanNorm(dir));
    // `( start + end ) / 2` is integer division, which truncates toward zero.
    const center = { x: Math.trunc((start.x + end.x) / 2), y: Math.trunc((start.y + end.y) / 2) };

    this.fprintf(
      `\t(footprint "slot" (pad 1 thru_hole oval (at ${this.f(center.x)} ${this.f(center.y)} ` +
        `${formatDouble2Str(EDA_ANGLE.fromVector(dir).AsDegrees())}) ` +
        `(size ${this.f(majorAxis + 1)} ${this.f(minorAxis + 1)}) ` +
        `(drill oval ${this.f(majorAxis)} ${this.f(minorAxis)})))\n`,
    );
  }

  private export_copper_item(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    if (aGbrItem.GetLayerPolarity()) return;

    switch (aGbrItem.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
        this.export_flashed_copper_item(aGbrItem, aLayer);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
      case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
        this.export_segarc_copper_item(aGbrItem, aLayer);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
        // One can use a polygon or a zone to output a Gerber region.
        // none are perfect.
        // The current way is use a polygon, as the zone export
        // is experimental and only for tests.
        this.writePcbPolygon(aGbrItem.m_ShapeAsPolygon, aLayer);
        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT: {
        const code = aGbrItem.GetDcodeDescr();

        if (code && code.m_ApertType === APERTURE_T.APT_RECT) {
          if (aGbrItem.m_ShapeAsPolygon.OutlineCount() === 0) aGbrItem.ConvertSegmentToPolygon();

          this.writePcbPolygon(aGbrItem.m_ShapeAsPolygon, aLayer);
        } else {
          this.export_segline_copper_item(aGbrItem, aLayer);
        }

        break;
      }

      default:
        break;
    }
  }

  private export_segline_copper_item(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    const seg_start = { ...aGbrItem.m_Start };
    const seg_end = { ...aGbrItem.m_End };

    // Reverse Y axis:
    seg_start.y = -seg_start.y;
    seg_end.y = -seg_end.y;

    this.writeCopperLineItem(seg_start, seg_end, aGbrItem.m_Size.x, aLayer);
  }

  private writeCopperLineItem(
    aStart: VECTOR2I,
    aEnd: VECTOR2I,
    aWidth: number,
    aLayer: number,
  ): void {
    this.fprintf(
      `\t(segment (start ${this.f(aStart.x)} ${this.f(aStart.y)}) ` +
        `(end ${this.f(aEnd.x)} ${this.f(aEnd.y)}) (width ${this.f(aWidth)}) ` +
        `(layer ${LSET_Name(aLayer)}) (net 0))\n`,
    );
  }

  private export_stroke_info(aWidth: number): void {
    this.fprintf(`\t\t(stroke (width ${this.f(aWidth)}) (type solid))\n`);
  }

  private export_segarc_copper_item(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    const a = Math.atan2(
      aGbrItem.m_Start.y - aGbrItem.m_ArcCentre.y,
      aGbrItem.m_Start.x - aGbrItem.m_ArcCentre.x,
    );
    let b = Math.atan2(
      aGbrItem.m_End.y - aGbrItem.m_ArcCentre.y,
      aGbrItem.m_End.x - aGbrItem.m_ArcCentre.x,
    );

    if (a > b) b += 2 * Math.PI;

    const arc_center = { ...aGbrItem.m_ArcCentre };
    const seg_end = { ...aGbrItem.m_End };
    const seg_start = { ...aGbrItem.m_Start };

    const seg_middle = GetRotated(
      seg_start,
      arc_center,
      new EDA_ANGLE((b - a) / 2, EDA_ANGLE_T.RADIANS_T).negate(),
    );

    // Reverse Y axis:
    seg_end.y = -seg_end.y;
    seg_start.y = -seg_start.y;
    seg_middle.y = -seg_middle.y;

    this.fprintf(
      `\t(arc\n\t\t(start ${this.f(seg_start.x)} ${this.f(seg_start.y)}) ` +
        `(mid ${this.f(seg_middle.x)} ${this.f(seg_middle.y)}) ` +
        `(end ${this.f(seg_end.x)} ${this.f(seg_end.y)}) (layer ${LSET_Name(aLayer)})\n`,
    );

    this.fprintf(`\t\t(width ${this.f(aGbrItem.m_Size.x)}) (net 0 )\n`);
    this.fprintf('\t)\n');
  }

  private export_flashed_copper_item(aGbrItem: GERBER_DRAW_ITEM, aLayer: number): void {
    const d_codeDescr = aGbrItem.GetDcodeDescr() ?? dummyD_CODE();

    if (aGbrItem.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE) {
      // See if there's a via that we can enlarge to fit this flashed item
      for (const via of this.m_vias) {
        if (eq(via.m_Pos, aGbrItem.m_Start)) {
          via.m_Size = Math.max(via.m_Size, aGbrItem.m_Size.x);
          return;
        }
      }
    }

    const offset = aGbrItem.GetABPosition(aGbrItem.m_Start);

    if (
      aGbrItem.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE ||
      (aGbrItem.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL &&
        d_codeDescr.m_Size.x === d_codeDescr.m_Size.y)
    ) {
      // export it as filled circle
      const center = offset;
      const radius = Math.trunc(d_codeDescr.m_Size.x / 2);
      this.writePcbFilledCircle(center, radius, aLayer);
      return;
    }

    const macro = d_codeDescr.GetMacro();

    if (macro) {
      // export a GBR_SPOT_MACRO
      const macroShape = macro
        .GetApertureMacroShape(aGbrItem, { x: 0, y: 0 })
        .CloneDropTriangulation();

      if (macroShape.OutlineCount() === 0) return;

      // Compensate the Y axis orientation ( writePcbPolygon invert the Y coordinate )
      macroShape.Outline(0).Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);

      this.writePcbPolygon(macroShape, aLayer, offset);
    } else {
      // Should cover primitives: GBR_SPOT_RECT, GBR_SPOT_OVAL, GBR_SPOT_POLY
      d_codeDescr.ConvertShapeToPolygon(aGbrItem);
      this.writePcbPolygon(d_codeDescr.m_Polygon, aLayer, offset);
    }
  }

  private writePcbFilledCircle(aCenterPosition: VECTOR2I, aRadius: number, aLayer: number): void {
    this.fprintf(
      `\t(gr_circle\n\t\t(center ${this.f(aCenterPosition.x)} ${this.f(aCenterPosition.y)}) ` +
        `(end ${this.f(aCenterPosition.x + aRadius)} ${this.f(aCenterPosition.y)})\n`,
    );

    this.export_stroke_info(0);
    this.fprintf(`\t\t(fill yes) (layer ${LSET_Name(aLayer)})`);
    this.fprintf('\n\t)\n');
  }

  /**
   * The header: "the .kicad_pcb version used here is after layers_id
   * changes", and the layers of `LSET::AllCuMask( count ) | AllTechMask() |
   * UserMask()`, copper then non-copper in id order.
   */
  private writePcbHeader(_aLayerLookUpTable: readonly number[]): void {
    this.fprintf('(kicad_pcb (version 20240928)\n');
    this.fprintf(`\t(generator "${GENERATOR}")\n\t(generator_version "${GENERATOR_VERSION}")\n\n`);

    // Write layers section
    this.fprintf('\t(layers \n');

    for (const cu of AllCuMask(this.m_pcbCopperLayersCount))
      this.fprintf(`\t\t(${cu} ${LSET_Name(cu)} signal)\n`);

    const nonCu = [...AllTechMask, ...UserMask].sort((a, b) => a - b);

    for (const layer of nonCu) this.fprintf(`\t\t(${layer} ${LSET_Name(layer)} user)\n`);

    this.fprintf('\t)\n\n');
  }

  /**
   * A polygon, "expected having only one outline and no hole (because it
   * comes from a gerber file or is built from a aperture)": its first outline,
   * four points to a line, the last dropped when it repeats the first.
   */
  private writePcbPolygon(
    aPolys: SHAPE_POLY_SET,
    aLayer: number,
    aOffset: VECTOR2I = { x: 0, y: 0 },
  ): void {
    // Ensure the polygon is valid:
    if (aPolys.OutlineCount() < 1) return;

    const poly = aPolys.COutline(0);

    this.fprintf('\t(gr_poly\n\t\t(pts\n\t\t\t');

    const MAX_COORD_CNT = 4;
    let jj = MAX_COORD_CNT;
    let cnt_max = poly.PointCount() - 1;

    // Do not generate last corner, if it is the same point as the first point:
    if (eq(poly.CPoint(0), poly.CPoint(cnt_max))) cnt_max--;

    for (let ii = 0; ii <= cnt_max; ii++) {
      if (--jj === 0) {
        jj = MAX_COORD_CNT;
        this.fprintf('\n\t\t\t');
      }

      this.fprintf(
        ` (xy ${this.f(poly.CPoint(ii).x + aOffset.x)} ${this.f(-poly.CPoint(ii).y + aOffset.y)})`,
      );
    }

    this.fprintf(')');

    this.fprintf('\n');
    this.export_stroke_info(0);
    this.fprintf(`\t\t(fill yes) (layer ${LSET_Name(aLayer)})`);
    this.fprintf('\n\t)\n');
  }
}

/** What {@link exportLayersToPcb} answers. */
export interface PcbExportResult {
  /** The `.kicad_pcb` text. */
  text: string;
  /**
   * The Gerber layer names that no mapping table claimed and that were placed
   * on a user drawing layer instead. Upstream would have shown these as "Do
   * not export" and waited for the user; with no dialog, the caller reports
   * them rather than letting the export be silently approximate.
   */
  fallbackLayers: string[];
}

/**
 * `GERBVIEW_CONTROL::ExportToPcbnew`'s half (`gerbview_control.cpp:104-148`):
 * map the layers to board layers, then run the exporter over them.
 *
 * Upstream asks for a file name and opens DIALOG_MAP_GERBER_LAYERS_TO_PCB,
 * which hands `ExportPcb` the lookup table and the copper count; with no
 * dialog here yet, `mapGerberLayersToPcb` produces both. Goes to
 * `tools/gerbview_control` with the frame (STRUCTURE.md).
 */
export function exportLayersToPcb(
  layers: readonly { image: GERBER_FILE_IMAGE; name: string }[],
): PcbExportResult {
  const images = layers.map((l) => l.image);
  const map = mapGerberLayersToPcb(images);

  const exporter = new GBR_TO_PCB_EXPORTER(images);

  const text = exporter.ExportPcb(
    map.rows.map((r) => r.pcbLayer),
    map.copperLayerCount,
  );

  const fallbackLayers = layers.filter((_, i) => map.rows[i]?.fallback).map((l) => l.name);

  return { text, fallbackLayers };
}
