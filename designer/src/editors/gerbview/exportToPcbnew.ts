// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GBR_TO_PCB_EXPORTER` (`gerbview/export_to_pcbnew.cpp`), GerbView's "Export
 * to Pcbnew".
 *
 * `ExportPcb` (`:58-147`) runs four passes over the loaded images, and the
 * order matters:
 *
 *  1. **holes** — every Excellon image's items, and any gerber the mapping put
 *     on `UNDEFINED_LAYER` (the dialog's "Hole Data" row), go to
 *     `collect_hole`, which sorts them into `m_vias` and `m_slots`.
 *  2. **non-copper layers** — `export_non_copper_item`, which writes graphics:
 *     `gr_line`, `gr_arc`, `gr_circle`, `gr_poly`.
 *  3. **copper layers** — `export_copper_item`, which writes *tracks*:
 *     `segment` and `arc` with `(net 0)`, plus filled `gr_poly` / `gr_circle`
 *     for regions and flashed pads. A copper layer does not produce graphics.
 *  4. the collected vias and slots.
 *
 * Pass 1 has to precede pass 3 because `export_flashed_copper_item` (`:497-508`)
 * looks for a via already sitting exactly under a round flash and swallows the
 * flash into it, growing the via to the pad's diameter — that is how a plated
 * through-hole pad comes out as one via rather than a via inside a circle.
 *
 * Coordinates: Gerber Y is up and board Y is down, so every Y is negated on the
 * way out. Upstream reaches the same place by a longer route — `GetABPosition`
 * negates Y itself (`gerber_draw_item.cpp:236-237`), `writePcbPolygon` negates
 * the point it is given, and the flashed-shape callers pre-mirror to cancel it —
 * but our `GERBER_DRAW_ITEM` already holds absolute Gerber-frame IU with the
 * image transform applied, so one negation at the point of writing is the whole
 * job.
 *
 * Which board layer each image lands on is `mapGerberLayersToPcb`, the
 * automatic half of the mapping dialog we do not have.
 */

import { EDA_ANGLE, EDA_ANGLE_T, RotatePoint, type VECTOR2I } from '@ziroeda/kimath';
import { formatDouble2Str } from '@ziroeda/common/src/plotters/fmt.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import {
  APERTURE_T,
  GBR_BASIC_SHAPE,
  GERBER_FORMAT,
  IU_PER_MM,
  type GERBER_DRAW_ITEM,
  type GERBER_FILE_IMAGE,
} from '@ziroeda/gerbview';
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
} from '@ziroeda/pcbnew/src/layer_ids.js';
import { mapGerberLayersToPcb } from './mapGerberLayersToPcb.js';

interface ExportLayer {
  image: GERBER_FILE_IMAGE;
  name: string;
}

/** `struct EXPORT_VIA` (`gerbview/export_to_pcbnew.h:44-56`). */
interface ExportVia {
  pos: VECTOR2I;
  size: number;
  drill: number;
}

/** `struct EXPORT_SLOT` (`gerbview/export_to_pcbnew.h:31-42`). */
interface ExportSlot {
  start: VECTOR2I;
  end: VECTOR2I;
  width: number;
}

/** What {@link exportLayersToPcb} answers. */
export interface PcbExportResult {
  /** The `.kicad_pcb` text. */
  text: string;
  /**
   * The Gerber layer names that no mapping table claimed and that were placed
   * on a user drawing layer instead. Upstream would have shown these as "Do
   * not export" and waited for the user; we have no dialog, so the caller
   * reports them rather than letting the export be silently approximate.
   */
  fallbackLayers: string[];
}

/** `GBR_TO_PCB_EXPORTER::MapToPcbUnits` (`export_to_pcbnew.h:201-204`). */
const mapToPcbUnits = (aValue: number): number => aValue / IU_PER_MM;

/**
 * `FormatDouble2Str( MapToPcbUnits( … ) )`, the form every coordinate takes.
 *
 * The `-0` guard has no counterpart upstream and needs none: every coordinate
 * there is a `VECTOR2I` component, and negating the integer 0 gives 0, so the
 * division that follows can only produce `+0.0`. Ours are JS numbers, where
 * `-0` survives negation and `{:.10g}` would print it — a `(start 0 -0)` that
 * differs from KiCad's output in text while meaning the same point.
 */
const f = (aValue: number): string =>
  formatDouble2Str(Object.is(aValue, -0) ? 0 : mapToPcbUnits(aValue));

/**
 * `GERBER_DRAW_ITEM::m_Size`, the aperture's outer size in IU.
 *
 * Upstream stores it on the item: `fillFlashedGBRITEM` and `fillLineGBRITEM`
 * (`gerbview/rs274d.cpp:107`, `:62`) both copy the D_CODE's size onto every
 * item they make, so `m_Size.x` is there on flashes and strokes alike. Our
 * parser keeps only the x component, and only on stroked shapes
 * (`GERBER_DRAW_ITEM.width`), so the pair is read back off the aperture — the
 * same place upstream copied it from. `D_CODE.size` is in file units with the
 * scale that was current when it was defined, hence the multiply.
 *
 * The `width` fallback is not dead: an Excellon routed slot is emitted with a
 * width but no D_CODE (`gerbview/src/excellon.ts:110-119`), and it is exactly
 * the item `collect_hole` turns into a slot.
 */
function itemSize(item: GERBER_DRAW_ITEM): VECTOR2I {
  const d = item.dcode;
  if (d) return { x: d.size.x * d.iuScale, y: d.size.y * d.iuScale };
  return { x: item.width, y: item.width };
}

/**
 * `D_CODE::m_ApertType`, with upstream's `static D_CODE dummyD_CODE( 0 )`
 * standing in when the item has no aperture — a default-constructed D_CODE is
 * `APT_CIRCLE`, which is why a region never takes the rectangular branch.
 */
function apertureType(item: GERBER_DRAW_ITEM): APERTURE_T {
  return item.dcode?.shape ?? APERTURE_T.APT_CIRCLE;
}

/**
 * Exported so a caller can drive it with an explicit lookup table, which is
 * what `DIALOG_MAP_GERBER_LAYERS_TO_PCB` hands upstream's `ExportPcb`
 * (`gerbview/tools/gerbview_control.cpp:146`). `exportLayersToPcb` below uses
 * the automatic mapping instead, and that mapping cannot produce every table
 * upstream's dialog can — there, a user may point a drill file at a real
 * board layer, and `ExportPcb` still has to collect its holes. The class is
 * the unit those cases are reachable through.
 */
export class GbrToPcbExporter {
  private out: string[] = [];
  private vias: ExportVia[] = [];
  private slots: ExportSlot[] = [];
  /** `m_pcbCopperLayersCount`, 2 until `ExportPcb` is given the real count. */
  private pcbCopperLayersCount = 2;

  private w(text: string): void {
    this.out.push(text);
  }

  /** `m_pcbCopperLayersCount = aCopperLayers;`, `ExportPcb`'s second argument. */
  setCopperLayersCount(count: number): void {
    this.pcbCopperLayersCount = count;
  }

  /**
   * `GBR_TO_PCB_EXPORTER::ExportPcb` (`:58-147`).
   *
   * `aLayerLookUpTable` is indexed by image, exactly as upstream's is.
   */
  ExportPcb(images: readonly GERBER_FILE_IMAGE[], aLayerLookUpTable: readonly number[]): string {
    this.writePcbHeader();

    // "First collect all the holes.  We'll use these to generate pads, vias, etc."
    for (let layer = 0; layer < images.length; ++layer) {
      const image = images[layer]!;
      const pcbLayerNumber = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;

      if (image.format === GERBER_FORMAT.EXCELLON) {
        for (const item of image.items) this.collect_hole(item);
      } else if (pcbLayerNumber === UNDEFINED_LAYER) {
        // "PCB_LAYER_ID doesn't have an entry for Hole Data, but the dialog
        // returns UNDEFINED_LAYER for it"
        for (const item of image.items) this.collect_hole(item);
      }
    }

    // "Next: non copper layers"
    for (let layer = 0; layer < images.length; ++layer) {
      const image = images[layer]!;
      const pcbLayerNumber = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;

      if (!IsPcbLayer(pcbLayerNumber) || IsCopperLayer(pcbLayerNumber)) continue;

      for (const item of image.items) this.export_non_copper_item(item, pcbLayerNumber);
    }

    // "Copper layers"
    for (let layer = 0; layer < images.length; ++layer) {
      const image = images[layer]!;
      const pcbLayerNumber = aLayerLookUpTable[layer] ?? UNDEFINED_LAYER;

      if (!IsCopperLayer(pcbLayerNumber)) continue;

      for (const item of image.items) this.export_copper_item(item, pcbLayerNumber);
    }

    // "Now write out the holes we collected earlier as vias"
    for (const via of this.vias) this.export_via(via);

    for (const slot of this.slots) this.export_slot(slot);

    this.w(')\n');

    return this.out.join('');
  }

  /**
   * `writePcbHeader` (`:562-587`).
   *
   * "Note: the .kicad_pcb version used here is after layers_id changes" — the
   * 20240928 numbering, where copper is even and F.Mask is 1, not the pre-v9
   * table (F.Cu = 0, B.Cu = 31, B.Adhes = 32 …) this file used to write.
   *
   * The one divergence is the `(generator …)` pair. Upstream writes
   * `"gerbview"` and `GetMajorMinorVersion()`; we write the two central values
   * from `common/src/generator.ts`, which every other writer in this tree uses
   * and which exist because ZiroEDA is one application rather than
   * KiCad's eight separate ones.
   *
   * Upstream writes no `(general …)` and no `(paper …)`, and neither do we.
   */
  private writePcbHeader(): void {
    this.w('(kicad_pcb (version 20240928)\n');
    this.w(`\t(generator "${GENERATOR}")\n\t(generator_version "${GENERATOR_VERSION}")\n\n`);

    this.w('\t(layers \n');

    // `LSET::AllCuMask( m_pcbCopperLayersCount ) | LSET::AllTechMask() | LSET::UserMask()`,
    // walked with the LSET's copper and non-copper iterators — which is where
    // the order comes from: B.Cu last among the copper rows, and the
    // non-copper rows in ascending layer id.
    for (const cu of AllCuMask(this.pcbCopperLayersCount))
      this.w(`\t\t(${cu} ${LSET_Name(cu)} signal)\n`);

    const nonCu = [...AllTechMask, ...UserMask].sort((a, b) => a - b);

    for (const layer of nonCu) this.w(`\t\t(${layer} ${LSET_Name(layer)} user)\n`);

    this.w('\t)\n\n');
  }

  /**
   * `collect_hole` (`:304-310`).
   *
   * "We use vias to mimic holes, with the loss of any hole shape (as we only
   * have round holes in vias at present). We start out with a via size
   * minimally larger than the hole" — hence `m_Size.x + 1`, one IU wider.
   */
  private collect_hole(item: GERBER_DRAW_ITEM): void {
    const size = itemSize(item);

    if (item.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE)
      this.vias.push({ pos: item.start, size: size.x + 1, drill: size.x });
    else if (item.shape === GBR_BASIC_SHAPE.GBR_SEGMENT)
      this.slots.push({ start: item.start, end: item.end, width: size.x });
  }

  /** `export_via` (`:313-330`). "Layers are Front to Back". */
  private export_via(via: ExportVia): void {
    const pos = { x: via.pos.x, y: -via.pos.y };

    this.w(`\t(via (at ${f(pos.x)} ${f(pos.y)}) (size ${f(via.size)}) (drill ${f(via.drill)})`);
    this.w(` (layers ${LSET_Name(F_Cu)} ${LSET_Name(B_Cu)}))\n`);
  }

  /**
   * `export_slot` (`:333-355`) — a routed slot becomes a one-pad footprint,
   * because a via cannot be oval.
   *
   * The pad is one IU larger than the drill in both axes, the same "minimally
   * larger" margin `collect_hole` gives a via. Note that the angle is measured
   * from the already-Y-negated endpoints, so it is a board angle.
   */
  private export_slot(slot: ExportSlot): void {
    const start = { x: slot.start.x, y: -slot.start.y };
    const end = { x: slot.end.x, y: -slot.end.y };

    const dir = { x: end.x - start.x, y: end.y - start.y };
    const minorAxis = slot.width;
    // `dir.EuclideanNorm()` on a VECTOR2I is `KiROUND( sqrt( … ) )`, and
    // `( start + end ) / 2` is integer division, which truncates toward zero.
    const majorAxis = slot.width + Math.round(Math.hypot(dir.x, dir.y));
    const center = {
      x: Math.trunc((start.x + end.x) / 2),
      y: Math.trunc((start.y + end.y) / 2),
    };

    this.w(
      `\t(footprint "slot" (pad 1 thru_hole oval (at ${f(center.x)} ${f(center.y)} ` +
        `${formatDouble2Str(EDA_ANGLE.fromVector(dir).AsDegrees())}) ` +
        `(size ${f(majorAxis + 1)} ${f(minorAxis + 1)}) ` +
        `(drill oval ${f(majorAxis)} ${f(minorAxis)})))\n`,
    );
  }

  /**
   * `export_non_copper_item` (`:150-247`).
   *
   * `if( aGbrItem->GetLayerPolarity() ) return;` drops anything drawn while
   * `%LPC` was in force — `GetLayerPolarity()` is `m_LayerNegative`
   * (`gerber_draw_item.h:77`), and our `layerPolarity` is the opposite
   * convention (true = dark), so the test flips with it.
   */
  private export_non_copper_item(item: GERBER_DRAW_ITEM, aLayer: number): void {
    if (!item.layerPolarity) return;

    const size = itemSize(item);

    switch (item.shape) {
      case GBR_BASIC_SHAPE.GBR_POLYGON:
        this.writePcbPolygon(item.polyPoints, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE:
        this.writePcbFilledCircle(item.start, Math.trunc(size.x / 2), aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE.GBR_SPOT_MACRO:
        this.writeFlashedShape(item, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_ARC:
        this.export_non_copper_arc(item, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_CIRCLE:
        this.w(
          `\t(gr_circle (start ${f(item.start.x)} ${f(-item.start.y)}) ` +
            `(end ${f(item.end.x)} ${f(-item.end.y)}) (layer ${LSET_Name(aLayer)})\n`,
        );
        this.export_stroke_info(size.x);
        this.w('\t)\n');
        break;

      case GBR_BASIC_SHAPE.GBR_SEGMENT:
        if (apertureType(item) === APERTURE_T.APT_RECT) {
          // "Using a rectangular aperture to draw a line is deprecated since
          // 2020[.] However old gerber file can use it (rare case) and can
          // generate strange shapes, because the rect aperture is not rotated
          // to match the line orientation. So draw this line as polygon"
          this.writePcbPolygon(convertSegmentToPolygon(item, size), aLayer);
        } else {
          this.w(
            `\t(gr_line\n\t\t(start ${f(item.start.x)} ${f(-item.start.y)}) ` +
              `(end ${f(item.end.x)} ${f(-item.end.y)}) (layer ${LSET_Name(aLayer)})\n`,
          );
          this.export_stroke_info(size.x);
          this.w('\t)\n');
        }
        break;

      default:
        break;
    }
  }

  /** `export_non_copper_arc` (`:250-301`). */
  private export_non_copper_arc(item: GERBER_DRAW_ITEM, aLayer: number): void {
    const size = itemSize(item);

    if (item.start.x === item.end.x && item.start.y === item.end.y) {
      // A full circle: upstream writes the centre and one point on the rim.
      this.w(
        `\t(gr_circle\n\t\t(center ${f(item.arcCentre.x)} ${f(-item.arcCentre.y)}) ` +
          `(end ${f(item.end.x)} ${f(-item.end.y)}) (layer ${LSET_Name(aLayer)})\n`,
      );
      this.export_stroke_info(size.x);
      this.w('\t)\n');
      return;
    }

    const mid = arcMiddle(item);

    this.w(
      `\t(gr_arc\n\t\t(start ${f(item.start.x)} ${f(-item.start.y)}) ` +
        `(mid ${f(mid.x)} ${f(-mid.y)}) ` +
        `(end ${f(item.end.x)} ${f(-item.end.y)}) (layer ${LSET_Name(aLayer)})\n`,
    );
    this.export_stroke_info(size.x);
    this.w('\t)\n');
  }

  /** `export_copper_item` (`:358-413`). */
  private export_copper_item(item: GERBER_DRAW_ITEM, aLayer: number): void {
    if (!item.layerPolarity) return;

    switch (item.shape) {
      case GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE:
      case GBR_BASIC_SHAPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE.GBR_SPOT_MACRO:
        this.export_flashed_copper_item(item, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_CIRCLE:
      case GBR_BASIC_SHAPE.GBR_ARC:
        this.export_segarc_copper_item(item, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_POLYGON:
        // "One can use a polygon or a zone to output a Gerber region. none are
        // perfect. The current way is use a polygon, as the zone export is
        // experimental and only for tests." — `writePcbZoneItem` sits behind an
        // `#if 1 … #else` upstream and is not reachable, so it is not ported.
        this.writePcbPolygon(item.polyPoints, aLayer);
        break;

      case GBR_BASIC_SHAPE.GBR_SEGMENT:
        if (apertureType(item) === APERTURE_T.APT_RECT)
          this.writePcbPolygon(convertSegmentToPolygon(item, itemSize(item)), aLayer);
        else this.export_segline_copper_item(item, aLayer);
        break;

      default:
        break;
    }
  }

  /** `export_segline_copper_item` + `writeCopperLineItem` (`:416-441`). */
  private export_segline_copper_item(item: GERBER_DRAW_ITEM, aLayer: number): void {
    this.w(
      `\t(segment (start ${f(item.start.x)} ${f(-item.start.y)}) ` +
        `(end ${f(item.end.x)} ${f(-item.end.y)}) (width ${f(itemSize(item).x)}) ` +
        `(layer ${LSET_Name(aLayer)}) (net 0))\n`,
    );
  }

  /**
   * `export_segarc_copper_item` (`:451-485`).
   *
   * Note there is no `seg_start == seg_end` branch here, unlike
   * `export_non_copper_arc`: a full-circle copper arc comes out as an `arc`
   * whose start, mid and end are the same point. That is upstream's, and it is
   * reproduced rather than repaired — a repair would be an invention, and the
   * shape is degenerate in KiCad's own output too.
   */
  private export_segarc_copper_item(item: GERBER_DRAW_ITEM, aLayer: number): void {
    const mid = arcMiddle(item);

    this.w(
      `\t(arc\n\t\t(start ${f(item.start.x)} ${f(-item.start.y)}) ` +
        `(mid ${f(mid.x)} ${f(-mid.y)}) ` +
        `(end ${f(item.end.x)} ${f(-item.end.y)}) (layer ${LSET_Name(aLayer)})\n`,
    );
    this.w(`\t\t(width ${f(itemSize(item).x)}) (net 0 )\n`);
    this.w('\t)\n');
  }

  /** `export_flashed_copper_item` (`:488-543`). */
  private export_flashed_copper_item(item: GERBER_DRAW_ITEM, aLayer: number): void {
    const size = itemSize(item);

    if (item.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE) {
      // "See if there's a via that we can enlarge to fit this flashed item"
      for (const via of this.vias) {
        if (via.pos.x === item.start.x && via.pos.y === item.start.y) {
          via.size = Math.max(via.size, size.x);
          return;
        }
      }
    }

    if (
      item.shape === GBR_BASIC_SHAPE.GBR_SPOT_CIRCLE ||
      (item.shape === GBR_BASIC_SHAPE.GBR_SPOT_OVAL && size.x === size.y)
    ) {
      // "export it as filled circle"
      this.writePcbFilledCircle(item.start, Math.trunc(size.x / 2), aLayer);
      return;
    }

    this.writeFlashedShape(item, aLayer);
  }

  /**
   * The rest of `export_flashed_copper_item` and the `GBR_SPOT_*` arm of
   * `export_non_copper_item`: the aperture resolved into a filled outline.
   *
   * Upstream has two routes to it — `APERTURE_MACRO::GetApertureMacroShape` for
   * a macro, `D_CODE::ConvertShapeToPolygon` for the standard shapes — and
   * writes `COutline( 0 )`, the single outer contour, dropping the aperture's
   * hole. Ours is `resolveFlashShapes()`, which returns the same aperture as a
   * list of exposure-tagged primitives in absolute IU; the exposure-off ones
   * *are* the hole, and skipping them is where upstream's dropping of it
   * happens.
   *
   * **Divergence, deliberate.** A primitive that resolves to a capsule — an
   * obround aperture, a macro line primitive — is written as a stroked
   * `gr_line`, not as the polygonal approximation of a capsule that
   * `ConvertShapeToPolygon` builds out of `SEGS_CNT` segments. The rendered
   * result is the same shape with none of the faceting, and turning it back
   * into a polygon would be work spent to be less accurate. A macro that
   * resolves to several disjoint primitives is likewise written as several
   * shapes, where upstream unions them and keeps only the first outline.
   */
  private writeFlashedShape(item: GERBER_DRAW_ITEM, aLayer: number): void {
    for (const sh of item.resolveFlashShapes()) {
      if (!sh.exposure) continue;

      if (sh.kind === 'circle') {
        this.writePcbFilledCircle(sh.center, sh.radius, aLayer);
      } else if (sh.kind === 'segment') {
        this.w(
          `\t(gr_line\n\t\t(start ${f(sh.a.x)} ${f(-sh.a.y)}) ` +
            `(end ${f(sh.b.x)} ${f(-sh.b.y)}) (layer ${LSET_Name(aLayer)})\n`,
        );
        this.export_stroke_info(sh.width);
        this.w('\t)\n');
      } else {
        this.writePcbPolygon(sh.points, aLayer);
      }
    }
  }

  /** `export_stroke_info` (`:444-448`). */
  private export_stroke_info(aWidth: number): void {
    this.w(`\t\t(stroke (width ${f(aWidth)}) (type solid))\n`);
  }

  /** `writePcbFilledCircle` (`:546-559`). */
  private writePcbFilledCircle(aCenterPosition: VECTOR2I, aRadius: number, aLayer: number): void {
    this.w(
      `\t(gr_circle\n\t\t(center ${f(aCenterPosition.x)} ${f(-aCenterPosition.y)}) ` +
        `(end ${f(aCenterPosition.x + aRadius)} ${f(-aCenterPosition.y)})\n`,
    );
    this.export_stroke_info(0);
    this.w(`\t\t(fill yes) (layer ${LSET_Name(aLayer)})`);
    this.w('\n\t)\n');
  }

  /**
   * `writePcbPolygon` (`:590-631`), including its line breaking: a newline and
   * three tabs every `MAX_COORD_CNT` = 4 points, and the last corner dropped
   * when it repeats the first.
   */
  private writePcbPolygon(aPoly: readonly VECTOR2I[], aLayer: number): void {
    // "Ensure the polygon is valid" — an empty outline writes nothing.
    if (aPoly.length < 1) return;

    this.w('\t(gr_poly\n\t\t(pts\n\t\t\t');

    const MAX_COORD_CNT = 4;
    let jj = MAX_COORD_CNT;
    let cntMax = aPoly.length - 1;

    // "Do not generate last corner, if it is the same point as the first point"
    const first = aPoly[0]!;
    const last = aPoly[cntMax]!;
    if (first.x === last.x && first.y === last.y) cntMax--;

    for (let ii = 0; ii <= cntMax; ii++) {
      if (--jj === 0) {
        jj = MAX_COORD_CNT;
        this.w('\n\t\t\t');
      }

      const p = aPoly[ii]!;
      this.w(` (xy ${f(p.x)} ${f(-p.y)})`);
    }

    this.w(')');
    this.w('\n');
    this.export_stroke_info(0);
    this.w(`\t\t(fill yes) (layer ${LSET_Name(aLayer)})`);
    this.w('\n\t)\n');
  }
}

/**
 * The arc midpoint `export_non_copper_arc` and `export_segarc_copper_item`
 * both compute (`:252-262`, `:281-282` and `:453-466`):
 *
 *     a = atan2( start - centre );  b = atan2( end - centre );
 *     if( a > b ) b += 2 * M_PI;
 *     seg_middle = GetRotated( seg_start, arc_center, -EDA_ANGLE( (b-a)/2 ) );
 *
 * Note what it does *not* consult: the arc's own direction. `m_ArcCentre`,
 * `m_Start` and `m_End` are all it reads, and `a > b` is resolved by adding a
 * full turn to `b`. The previous version of this file used our `arcCcw` flag
 * and picked the arc that flag names; that was a repair, not a port, and it
 * put the mid point on the other side for a clockwise arc.
 */
function arcMiddle(item: GERBER_DRAW_ITEM): VECTOR2I {
  const a = Math.atan2(item.start.y - item.arcCentre.y, item.start.x - item.arcCentre.x);
  let b = Math.atan2(item.end.y - item.arcCentre.y, item.end.x - item.arcCentre.x);

  if (a > b) b += 2 * Math.PI;

  return RotatePoint(
    item.start,
    item.arcCentre,
    new EDA_ANGLE((b - a) / 2, EDA_ANGLE_T.RADIANS_T).negate(),
  );
}

/**
 * `GERBER_DRAW_ITEM::ConvertSegmentToPolygon` (`gerber_draw_item.cpp:392-452`),
 * the six-cornered hull a rectangular aperture sweeps along a segment.
 *
 * Upstream normalises so that `start.x < end.x` and `delta.y > 0`, builds the
 * shape for that quadrant, then mirrors top-to-bottom if it flipped delta.y and
 * moves the whole thing to `start`. Its own diagram of the corner order:
 *
 *     3 4
 *     2 5
 *     1 6
 */
function convertSegmentToPolygon(item: GERBER_DRAW_ITEM, size: VECTOR2I): VECTOR2I[] {
  let start = item.start;
  let end = item.end;

  // "make calculations more easy if ensure start.x < end.x"
  if (start.x > end.x) [start, end] = [end, start];

  const delta = { x: end.x - start.x, y: end.y - start.y };

  // "make delta.y > 0"
  const change = delta.y < 0;
  if (change) delta.y = -delta.y;

  const pts: VECTOR2I[] = [];
  // `VECTOR2I corner;` is zero-initialised, then shifted by half the aperture.
  const corner = { x: -Math.trunc(size.x / 2), y: -Math.trunc(size.y / 2) };
  const close = { ...corner };

  pts.push({ ...corner }); // (1) lower left, start point
  corner.y += size.y;
  pts.push({ ...corner }); // (2) upper left, start point

  if (delta.x || delta.y) {
    corner.x += delta.x;
    corner.y += delta.y;
    pts.push({ ...corner }); // (3) upper left, end point
  }

  corner.x += size.x;
  pts.push({ ...corner }); // (4) upper right, end point
  corner.y -= size.y;
  pts.push({ ...corner }); // (5) lower right, end point

  if (delta.x || delta.y) {
    corner.x -= delta.x;
    corner.y -= delta.y;
    pts.push({ ...corner }); // (6) lower left, start point
  }

  pts.push(close); // "close the shape"

  // `if( change ) Mirror( { 0, 0 }, TOP_BOTTOM ); Move( start );`
  return pts.map((p) => ({ x: p.x + start.x, y: (change ? -p.y : p.y) + start.y }));
}

/**
 * The app-side entry point: map the loaded layers to board layers, then run
 * the exporter over them.
 *
 * Upstream's equivalent is `GERBVIEW_CONTROL::ExportToPcbnew`
 * (`gerbview/tools/gerbview_control.cpp:104-148`), which asks for a file name,
 * opens `DIALOG_MAP_GERBER_LAYERS_TO_PCB`, and hands `ExportPcb` the lookup
 * table and the copper count the dialog produced. We have no dialog, so
 * `mapGerberLayersToPcb` produces both; see there for what that costs.
 */
export function exportLayersToPcb(layers: ExportLayer[]): PcbExportResult {
  const images = layers.map((l) => l.image);
  const map = mapGerberLayersToPcb(images);

  const exporter = new GbrToPcbExporter();
  exporter.setCopperLayersCount(map.copperLayerCount);

  const text = exporter.ExportPcb(
    images,
    map.rows.map((r) => r.pcbLayer),
  );

  const fallbackLayers = layers.filter((_, i) => map.rows[i]?.fallback).map((l) => l.name);

  return { text, fallbackLayers };
}
