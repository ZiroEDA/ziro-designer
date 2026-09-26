// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `bitmap2component/bitmap2component.cpp` + `.h`: `BITMAPCONV_INFO`, which
 * traces a 1-bit bitmap with potrace and writes the result as a symbol
 * library, a footprint, a PostScript file or a drawing sheet — byte for byte
 * the text KiCad writes, bar two things:
 *
 * - `(generator ...)` / `(generator_version ...)` name us, not
 *   `bitmap2component` / KiCad's version (`common/generator.ts` says why);
 * - the uuids are fresh, as `KIID()` makes them.
 *
 * The file-format versions are KiCad's own frozen ones, `(version 20221018)`
 * for the footprint, `20220914` for the symbol library and `20220228` for the
 * drawing sheet: bitmap2component hardcodes them, and pcbnew, eeschema and
 * pl_editor all read that dialect.
 */
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { KiROUND, toInt } from '@ziroeda/kimath/src/math/util.js';
import { PCB_IU_PER_MM, PL_IU_PER_MM, SCH_IU_PER_MM } from '@ziroeda/common/eda_units.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/generator.js';
import { newKiid } from '@ziroeda/common/kiid.js';
import { fixed, formatG, shortest } from '@ziroeda/common/plotters/fmt.js';
import { RPT_SEVERITY_ERROR, type Reporter } from '@ziroeda/common/reporter.js';
import {
  POTRACE_CORNER,
  POTRACE_CURVETO,
  POTRACE_STATUS_OK,
  bm_free,
  potrace_param_default,
  potrace_param_free,
  potrace_state_free,
  potrace_trace,
  type potrace_bitmap_t,
  type potrace_dpoint_t,
  type potrace_path_t,
} from '@ziroeda/potrace';

export enum OUTPUT_FMT_ID {
  SYMBOL_FMT,
  /** This does not include the header information */
  SYMBOL_PASTE_FMT,
  FOOTPRINT_FMT,
  POSTSCRIPT_FMT,
  DRAWING_SHEET_FMT,
}

export const { SYMBOL_FMT, SYMBOL_PASTE_FMT, FOOTPRINT_FMT, POSTSCRIPT_FMT, DRAWING_SHEET_FMT } =
  OUTPUT_FMT_ID;

/** `std::string&`: the caller's buffer, which the converter appends to. */
export interface STRING_BUFFER {
  value: string;
}

/**
 * `strerror( errno )` after a failed allocation, the only way either
 * potracelib call can fail here. [data: glibc's ENOMEM text]
 */
const ENOMEM_TEXT = 'Cannot allocate memory';

/** "The polygon outline thickness is fixed here to 0.01 ( 0.0 is the default thickness)" [data] */
const SCH_LINE_THICKNESS_MM = 0.01;

/**
 * Helper class to handle useful info to convert a bitmap image to a polygonal
 * object description.
 */
export class BITMAPCONV_INFO {
  /** File format */
  private m_Format: OUTPUT_FMT_ID;
  private m_PixmapWidth: number;
  /** the bitmap size in pixels */
  private m_PixmapHeight: number;
  private m_ScaleX: number;
  /** the conversion scale */
  private m_ScaleY: number;
  /** the list of paths, from potrace (list of lines and bezier curves) */
  private m_Paths: potrace_path_t | null;
  /** The string used as cmp/footprint name */
  private m_CmpName: string;
  /** the buffer containing the conversion */
  private m_Data: STRING_BUFFER;
  private m_reporter: Reporter;

  constructor(aData: STRING_BUFFER, aReporter: Reporter) {
    this.m_Data = aData;
    this.m_reporter = aReporter;
    this.m_Format = POSTSCRIPT_FMT;
    this.m_PixmapWidth = 0;
    this.m_PixmapHeight = 0;
    this.m_ScaleX = 1.0;
    this.m_ScaleY = 1.0;
    this.m_Paths = null;
    this.m_CmpName = 'LOGO';
  }

  /**
   * Run the conversion of the bitmap.
   */
  ConvertBitmap(
    aPotrace_bitmap: potrace_bitmap_t,
    aFormat: OUTPUT_FMT_ID,
    aDpi_X: number,
    aDpi_Y: number,
    aLayer: string,
  ): number {
    // set tracing parameters, starting from defaults
    const param = potrace_param_default();

    if (!param) {
      this.m_reporter.report(`Error allocating parameters: ${ENOMEM_TEXT}\n`, RPT_SEVERITY_ERROR);
      return 1;
    }

    // For parameters: see http://potrace.sourceforge.net/potracelib.pdf
    param.turdsize = 0; // area (in pixels) of largest path to be ignored. Potrace default is 2
    param.opttolerance = 0.2; // curve optimization tolerance. Potrace default is 0.2

    // convert the bitmap to curves
    const st = potrace_trace(param, aPotrace_bitmap);

    if (!st || st.status !== POTRACE_STATUS_OK) {
      if (st) potrace_state_free(st);

      potrace_param_free(param);

      this.m_reporter.report(`Error tracing bitmap: ${ENOMEM_TEXT}\n`, RPT_SEVERITY_ERROR);
      return 1;
    }

    this.m_PixmapWidth = aPotrace_bitmap.w;
    this.m_PixmapHeight = aPotrace_bitmap.h; // the bitmap size in pixels
    this.m_Paths = st.plist;
    this.m_Format = aFormat;

    switch (aFormat) {
      case DRAWING_SHEET_FMT:
        this.m_ScaleX = (PL_IU_PER_MM * 25.4) / aDpi_X; // the conversion scale from PPI to micron
        this.m_ScaleY = (PL_IU_PER_MM * 25.4) / aDpi_Y; // Y axis is top to bottom
        this.createOutputData();
        break;

      case POSTSCRIPT_FMT:
        this.m_ScaleX = 1.0; // the conversion scale
        this.m_ScaleY = this.m_ScaleX;
        this.createOutputData();
        break;

      case SYMBOL_FMT:
      case SYMBOL_PASTE_FMT:
        this.m_ScaleX = (SCH_IU_PER_MM * 25.4) / aDpi_X; // the conversion scale from PPI to eeschema iu
        this.m_ScaleY = (-SCH_IU_PER_MM * 25.4) / aDpi_Y; // Y axis is bottom to Top for components in libs
        this.createOutputData();
        break;

      case FOOTPRINT_FMT:
        this.m_ScaleX = (PCB_IU_PER_MM * 25.4) / aDpi_X; // the conversion scale from PPI to IU
        this.m_ScaleY = (PCB_IU_PER_MM * 25.4) / aDpi_Y; // Y axis is top to bottom in Footprint Editor
        this.createOutputData(aLayer);
        break;
    }

    bm_free(aPotrace_bitmap);
    potrace_state_free(st);
    potrace_param_free(param);

    return 0;
  }

  /**
   * Function outputDataHeader: write to file the header depending on file format.
   */
  private outputDataHeader(aBrdLayerName: string): void {
    let Ypos = (this.m_PixmapHeight / 2.0) * this.m_ScaleY; // fields Y position in mm
    let fieldSize: number; // fields text size in mm

    switch (this.m_Format) {
      case POSTSCRIPT_FMT:
        this.m_Data.value += '%!PS-Adobe-3.0 EPSF-3.0\n';
        this.m_Data.value += `%%BoundingBox: 0 0 ${this.m_PixmapWidth} ${this.m_PixmapHeight}\n`;
        this.m_Data.value += 'gsave\n';
        break;

      case FOOTPRINT_FMT:
        // fields text size = 1.5 mm
        // fields text thickness = 1.5 / 5 = 0.3mm
        this.m_Data.value +=
          `(footprint "${this.m_CmpName}" (version 20221018) (generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")\n` +
          '  (layer "F.Cu")\n';

        this.m_Data.value += '  (attr board_only exclude_from_pos_files exclude_from_bom)\n';
        this.m_Data.value +=
          `  (fp_text reference "G***" (at 0 0) (layer "${aBrdLayerName}")\n` +
          '      (effects (font (size 1.5 1.5) (thickness 0.3)))\n' +
          `    (uuid ${newKiid()})\n  )\n`;

        this.m_Data.value +=
          `  (fp_text value "${this.m_CmpName}" (at 0.75 0) (layer "${aBrdLayerName}") hide\n` +
          '      (effects (font (size 1.5 1.5) (thickness 0.3)))\n' +
          `    (uuid ${newKiid()})\n  )\n`;
        break;

      case DRAWING_SHEET_FMT:
        this.m_Data.value += `(kicad_wks (version 20220228) (generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")\n`;
        this.m_Data.value += '  (setup (textsize 1.5 1.5)(linewidth 0.15)(textlinewidth 0.15)\n';
        this.m_Data.value +=
          '  (left_margin 10)(right_margin 10)(top_margin 10)(bottom_margin 10))\n';
        this.m_Data.value += '  (polygon (name "") (pos 0 0) (linewidth 0.01)\n';
        break;

      case SYMBOL_FMT:
      case SYMBOL_PASTE_FMT:
        if (this.m_Format === SYMBOL_FMT)
          this.m_Data.value += `(kicad_symbol_lib (version 20220914) (generator "${GENERATOR}") (generator_version "${GENERATOR_VERSION}")\n`;

        // KI_FALLTHROUGH
        fieldSize = 1.27; // fields text size in mm (= 50 mils)
        Ypos /= SCH_IU_PER_MM;
        Ypos += fieldSize / 2;
        this.m_Data.value += `  (symbol "${this.m_CmpName}" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)\n`;

        this.m_Data.value +=
          `    (property "Reference" "#G" (at 0 ${formatG(-Ypos)} 0)\n` +
          `      (effects (font (size ${formatG(fieldSize)} ${formatG(fieldSize)})) hide)\n    )\n`;

        this.m_Data.value +=
          `    (property "Value" "${this.m_CmpName}" (at 0 ${formatG(Ypos)} 0)\n` +
          `      (effects (font (size ${formatG(fieldSize)} ${formatG(fieldSize)})) hide)\n    )\n`;

        this.m_Data.value +=
          '    (property "Footprint" "" (at 0 0 0)\n' +
          `      (effects (font (size ${formatG(fieldSize)} ${formatG(fieldSize)})) hide)\n    )\n`;

        this.m_Data.value +=
          '    (property "Datasheet" "" (at 0 0 0)\n' +
          `      (effects (font (size ${formatG(fieldSize)} ${formatG(fieldSize)})) hide)\n    )\n`;

        this.m_Data.value += `    (symbol "${this.m_CmpName}_0_0"\n`;
        break;
    }
  }

  /**
   * Function outputDataEnd: write to file the last strings depending on file format.
   */
  private outputDataEnd(): void {
    switch (this.m_Format) {
      case POSTSCRIPT_FMT:
        this.m_Data.value += 'grestore\n';
        this.m_Data.value += '%%EOF\n';
        break;

      case FOOTPRINT_FMT:
        this.m_Data.value += ')\n';
        break;

      case DRAWING_SHEET_FMT:
        this.m_Data.value += '  )\n)\n';
        break;

      case SYMBOL_PASTE_FMT:
        this.m_Data.value += '    )\n'; // end symbol_0_0
        this.m_Data.value += '  )\n'; // end symbol
        break;

      case SYMBOL_FMT:
        this.m_Data.value += '    )\n'; // end symbol_0_0
        this.m_Data.value += '  )\n'; // end symbol
        this.m_Data.value += ')\n'; // end lib
        break;
    }
  }

  /**
   * Function outputOnePolygon: write one polygon to output file. Polygon
   * coordinates are expected scaled by the polygon extraction function.
   */
  private outputOnePolygon(aPolygon: SHAPE_LINE_CHAIN, aBrdLayerName: string): void {
    // write one polygon to output file.
    // coordinates are expected in target unit.
    let ii: number;
    let jj: number;
    let currpoint: { x: number; y: number };
    const offsetX = KiROUND((this.m_PixmapWidth / 2.0) * this.m_ScaleX);
    let offsetY = KiROUND((this.m_PixmapHeight / 2.0) * this.m_ScaleY);

    const startpoint = aPolygon.CPoint(0);

    switch (this.m_Format) {
      case POSTSCRIPT_FMT:
        offsetY = toInt(this.m_PixmapHeight * this.m_ScaleY);
        this.m_Data.value += `newpath\n${startpoint.x} ${offsetY - startpoint.y} moveto\n`;
        jj = 0;

        for (ii = 1; ii < aPolygon.PointCount(); ii++) {
          currpoint = aPolygon.CPoint(ii);
          this.m_Data.value += ` ${currpoint.x} ${offsetY - currpoint.y} lineto`;

          if (jj++ > 6) {
            jj = 0;
            this.m_Data.value += '\n';
          }
        }

        this.m_Data.value += '\nclosepath fill\n';
        break;

      case FOOTPRINT_FMT:
        this.m_Data.value += '  (fp_poly\n    (pts\n';

        for (ii = 0; ii < aPolygon.PointCount(); ii++) {
          currpoint = aPolygon.CPoint(ii);
          this.m_Data.value += `      (xy ${shortest((currpoint.x - offsetX) / PCB_IU_PER_MM)} ${shortest((currpoint.y - offsetY) / PCB_IU_PER_MM)})\n`;
        }
        // No need to close polygon

        this.m_Data.value += '    )\n\n';
        this.m_Data.value += `    (stroke (width ${fixed(0.0, 6)}) (type solid)) (fill solid) (layer "${aBrdLayerName}") (uuid ${newKiid()}))\n`;
        break;

      case DRAWING_SHEET_FMT:
        this.m_Data.value += '    (pts';

        // Internal units = micron, file unit = mm
        jj = 1;

        for (ii = 0; ii < aPolygon.PointCount(); ii++) {
          currpoint = aPolygon.CPoint(ii);
          this.m_Data.value += ` (xy ${fixed((currpoint.x - offsetX) / PL_IU_PER_MM, 3)} ${fixed((currpoint.y - offsetY) / PL_IU_PER_MM, 3)})`;

          if (jj++ > 4) {
            jj = 0;
            this.m_Data.value += '\n     ';
          }
        }

        // Close polygon
        this.m_Data.value += ` (xy ${fixed((startpoint.x - offsetX) / PL_IU_PER_MM, 3)} ${fixed((startpoint.y - offsetY) / PL_IU_PER_MM, 3)}) )\n`;
        break;

      case SYMBOL_FMT:
      case SYMBOL_PASTE_FMT:
        this.m_Data.value += '      (polyline\n        (pts\n';

        for (ii = 0; ii < aPolygon.PointCount(); ii++) {
          currpoint = aPolygon.CPoint(ii);
          this.m_Data.value += `          (xy ${fixed((currpoint.x - offsetX) / SCH_IU_PER_MM, 6)} ${fixed((currpoint.y - offsetY) / SCH_IU_PER_MM, 6)})\n`;
        }

        // Close polygon
        this.m_Data.value += `          (xy ${fixed((startpoint.x - offsetX) / SCH_IU_PER_MM, 6)} ${fixed((startpoint.y - offsetY) / SCH_IU_PER_MM, 6)})\n`;
        this.m_Data.value += '        )\n'; // end pts

        this.m_Data.value +=
          `        (stroke (width ${formatG(SCH_LINE_THICKNESS_MM)}) (type default))\n` +
          '        (fill (type outline))\n';
        this.m_Data.value += '      )\n'; // end polyline
        break;
    }
  }

  /**
   * Creates the data specified by m_Format.
   */
  private createOutputData(aLayer = 'F.SilkS'): void {
    const cornersBuffer: potrace_dpoint_t[] = [];

    // polyset_areas is a set of polygon to draw
    const polyset_areas = new SHAPE_POLY_SET();

    // polyset_holes is the set of holes inside polyset_areas outlines
    const polyset_holes = new SHAPE_POLY_SET();

    /* The layer name has meaning only for .kicad_mod files. For these files the
     * header creates 2 invisible texts: value and ref (needed but not useful) on
     * silk screen layer */
    this.outputDataHeader('F.SilkS');

    let main_outline = true;

    /* draw each as a polygon with no hole. Bezier curves are approximated by a
     * polyline */
    let paths = this.m_Paths; // the list of paths

    if (!this.m_Paths) {
      this.m_reporter.report(
        'No shape in black and white image to convert: no outline created.',
        RPT_SEVERITY_ERROR,
      );
    }

    while (paths !== null) {
      const cnt = paths.curve.n;
      const tag = paths.curve.tag;
      const c = paths.curve.c;
      let startpoint = c[cnt - 1]![2]!;

      for (let i = 0; i < cnt; i++) {
        switch (tag[i]) {
          case POTRACE_CORNER:
            cornersBuffer.push(c[i]![1]!);
            cornersBuffer.push(c[i]![2]!);
            startpoint = c[i]![2]!;
            break;

          case POTRACE_CURVETO:
            BezierToPolyline(cornersBuffer, startpoint, c[i]![0]!, c[i]![1]!, c[i]![2]!);
            startpoint = c[i]![2]!;
            break;
        }
      }

      // Store current path
      if (main_outline) {
        main_outline = false;

        // build the current main polygon
        polyset_areas.NewOutline();

        for (const pt of cornersBuffer)
          polyset_areas.Append(toInt(pt.x * this.m_ScaleX), toInt(pt.y * this.m_ScaleY));
      } else {
        // Add current hole in polyset_holes
        polyset_holes.NewOutline();

        for (const pt of cornersBuffer)
          polyset_holes.Append(toInt(pt.x * this.m_ScaleX), toInt(pt.y * this.m_ScaleY));
      }

      cornersBuffer.length = 0;

      // at the end of a group of a positive path and its negative children, fill.
      if (paths.next === null || paths.next.sign === '+') {
        polyset_areas.Simplify();
        polyset_holes.Simplify();
        polyset_areas.BooleanSubtract(polyset_holes);

        // Ensure there are no self intersecting polygons
        if (polyset_areas.NormalizeAreaOutlines()) {
          // Convert polygon with holes to a unique polygon
          polyset_areas.Fracture();

          // Output current resulting polygon(s)
          for (let ii = 0; ii < polyset_areas.OutlineCount(); ii++) {
            const poly = polyset_areas.Outline(ii);
            this.outputOnePolygon(poly, aLayer);
          }

          polyset_areas.RemoveAllContours();
          polyset_holes.RemoveAllContours();
          main_outline = true;
        }
      }

      paths = paths.next;
    }

    this.outputDataEnd();
  }
}

/** a helper function to calculate a square value */
function square(x: number): number {
  return x * x;
}

/** a helper function to calculate a cube value */
function cube(x: number): number {
  return x * x * x;
}

/**
 * Render a Bezier curve: approximate it by small line segments, the interval
 * size epsilon determined so that the distance between the true curve and its
 * approximation does not exceed the desired accuracy delta. p1 is the
 * starting point and is not emitted; p4 always is.
 */
export function BezierToPolyline(
  aCornersBuffer: potrace_dpoint_t[],
  p1: potrace_dpoint_t,
  p2: potrace_dpoint_t,
  p3: potrace_dpoint_t,
  p4: potrace_dpoint_t,
): void {
  const delta = 0.25; // desired accuracy, in pixels

  /* let dd = maximal value of 2nd derivative over curve - this must occur at an
   * endpoint. */
  const dd0 = square(p1.x - 2 * p2.x + p3.x) + square(p1.y - 2 * p2.y + p3.y);
  const dd1 = square(p2.x - 2 * p3.x + p4.x) + square(p2.y - 2 * p3.y + p4.y);
  const dd = 6 * Math.sqrt(Math.max(dd0, dd1));
  const e2 = 8 * delta <= dd ? (8 * delta) / dd : 1;
  const epsilon = Math.sqrt(e2); // necessary interval size

  for (let t = epsilon; t < 1; t += epsilon) {
    aCornersBuffer.push({
      x:
        p1.x * cube(1 - t) +
        3 * p2.x * square(1 - t) * t +
        3 * p3.x * (1 - t) * square(t) +
        p4.x * cube(t),
      y:
        p1.y * cube(1 - t) +
        3 * p2.y * square(1 - t) * t +
        3 * p3.y * (1 - t) * square(t) +
        p4.y * cube(t),
    });
  }

  aCornersBuffer.push(p4);
}
