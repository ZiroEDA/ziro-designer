// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `EXCELLON_WRITER` — `pcbnew/exporters/gendrill_excellon_writer.cpp` and
 * `.h`: the Excellon drill files, one per drill span, and through
 * GENDRILL_WRITER_BASE the drill maps and the drill report.
 *
 * The header's two program lines (`; DRILL file …` and
 * `TF.GenerationSoftware`) name us, not KiCad, for the reason
 * `common/generator.ts` gives.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import {
  GBR_NC_STRING_FORMAT,
  GbrMakeCreationDateAttributeString,
} from '@ziroeda/common/gbr_metadata.js';
import { GENERATOR_APPLICATION, GENERATOR_VENDOR } from '@ziroeda/common/generator.js';
import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { fixed } from '@ziroeda/common/plotters/fmt.js';
import { type Reporter, RPT_SEVERITY_ACTION, RPT_SEVERITY_INFO } from '@ziroeda/common/reporter.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import type { BOARD } from '../board.js';
import { PAD_DRILL_POST_MACHINING_MODE } from '../padstack.js';
import {
  DRILL_SPAN,
  GENDRILL_WRITER_BASE,
  HOLE_ATTRIBUTE,
  type HOLE_INFO,
  joinPath,
  iso8601DateTime,
  splitFileName,
  TYPE_FILE,
  USE_ATTRIB_FOR_HOLES,
  ZEROS_FMT,
} from './gendrill_writer_base.js';

/** `FILEEXT::DrillFileExtension`. */
export const DrillFileExtension = 'drl';

/** `{:.Nf}` with the trailing zeros trimmed back to one after the point. */
function trimZeros(aText: string): string {
  let s = aText;

  //Remove useless trailing 0
  while (s.endsWith('0')) s = s.slice(0, -1);

  if (s.endsWith('.'))
    // however keep a trailing 0 after the floating point separator
    s += '0';

  return s;
}

/** `wxString::Printf( "%0*d", pad, v )`. */
function zeroPad(aValue: number, aWidth: number): string {
  const negative = aValue < 0;
  const digits = String(Math.abs(aValue));
  const body = digits.padStart(negative ? aWidth - 1 : aWidth, '0');
  return negative ? `-${body}` : body;
}

/**
 * Create Excellon drill, drill map, and drill report files.
 */
export class EXCELLON_WRITER extends GENDRILL_WRITER_BASE {
  private m_out = ''; // The output file
  private m_minimalHeader = false; // True to use minimal header
  private m_mirror = false;
  private m_useRouteModeForOval = true; // True to use a route command for oval holes
  // False to use a G85 canned mode for oval holes
  private m_mantissaLenght = 3; // Max number of digits printed in float numbers

  constructor(aPcb: BOARD) {
    super(aPcb);
    this.m_zeroFormat = ZEROS_FMT.DECIMAL_FORMAT;
    this.m_conversionUnits = 0.0001;
    this.m_mirror = false;
    this.m_merge_PTH_NPTH = false;
    this.m_minimalHeader = false;
    this.m_drillFileExtension = DrillFileExtension;
    this.m_useRouteModeForOval = true;
    this.m_mantissaLenght = 3; // suitable to print coordinates in mm
  }

  override GetOffset(): VECTOR2I {
    return this.m_offset;
  }

  SetRouteModeForOvalHoles(aUseRouteModeForOvalHoles: boolean): void {
    this.m_useRouteModeForOval = aUseRouteModeForOvalHoles;
  }

  /**
   * Initialize internal parameters to match the given format.
   *
   * @param aLeftDigits / aRightDigits <= 0 (default) choose a suitable value for the units.
   */
  SetFormat(
    aMetric: boolean,
    aZerosFmt = ZEROS_FMT.DECIMAL_FORMAT,
    aLeftDigits = 0,
    aRightDigits = 0,
  ): void {
    this.m_unitsMetric = aMetric;
    this.m_zeroFormat = aZerosFmt;

    /* Set conversion scale depending on drill file units */
    if (this.m_unitsMetric)
      this.m_conversionUnits = 1.0 / pcbIUScale.IU_PER_MM; // EXCELLON units = mm
    else this.m_conversionUnits = 0.001 / pcbIUScale.IU_PER_MILS; // EXCELLON units = in

    // Set the zero counts. if aZerosFmt == DECIMAL_FORMAT, these values
    // will be set, but not used.
    let left = aLeftDigits;
    let right = aRightDigits;

    if (left <= 0) left = this.m_unitsMetric ? 3 : 2;

    if (right <= 0) right = this.m_unitsMetric ? 3 : 4;

    this.m_precision.m_Lhs = left;
    this.m_precision.m_Rhs = right;
  }

  /**
   * Initialize internal parameters to match drill options.
   *
   * @param aMirror set to true to create mirrored coordinates (Y coordinates negated).
   * @param aMinimalHeader set to true to use a minimal header (no comments, no info).
   * @param aOffset is the drill coordinates offset.
   * @param aMerge_PTH_NPTH set to true to create only one file containing PTH and NPTH.
   */
  SetOptions(
    aMirror: boolean,
    aMinimalHeader: boolean,
    aOffset: VECTOR2I,
    aMerge_PTH_NPTH: boolean,
  ): void {
    this.m_mirror = aMirror;
    this.m_offset = { ...aOffset };
    this.m_minimalHeader = aMinimalHeader;
    this.m_merge_PTH_NPTH = aMerge_PTH_NPTH;
  }

  private print(aText: string): void {
    this.m_out += aText;
  }

  /**
   * Create the full set of Excellon drill file for the board.
   *
   * File names are computed from the board name and layer ID.
   */
  CreateDrillandMapFilesSet(
    aPlotDirectory: string,
    aGenDrill: boolean,
    aGenMap: boolean,
    aReporter: Reporter | null = null,
  ): boolean {
    let success = true;

    const hole_sets = this.getUniqueLayerPairs();

    if (!this.m_merge_PTH_NPTH)
      hole_sets.push(new DRILL_SPAN(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu, false, true));

    for (const span of hole_sets) {
      const doing_npth = this.m_merge_PTH_NPTH ? false : span.m_IsNonPlatedFile;

      this.buildHolesList(span, doing_npth);

      const through = span.Pair()[0] === PCB_LAYER_ID.F_Cu && span.Pair()[1] === PCB_LAYER_ID.B_Cu;

      // The file is created if it has holes, or if it is the non plated drill file to be
      // sure the NPTH file is up to date in separate files mode.
      // Also a PTH drill/map file is always created, to be sure at least one plated hole
      // drill file is created (do not create any PTH drill file can be seen as not working
      // drill generator).
      if (this.getHolesCount() > 0 || doing_npth || through) {
        const fullFilename = joinPath(
          aPlotDirectory,
          this.getDrillFileName(span, doing_npth, this.m_merge_PTH_NPTH),
        );

        if (aGenDrill) {
          aReporter?.report(`Created file '${fullFilename}'`, RPT_SEVERITY_ACTION);

          let file_type = TYPE_FILE.PTH_FILE;

          if (through && !span.m_IsBackdrill) {
            if (this.m_merge_PTH_NPTH) file_type = TYPE_FILE.MIXED_FILE;
            else if (doing_npth) file_type = TYPE_FILE.NPTH_FILE;
          } else if (span.m_IsBackdrill) {
            file_type = TYPE_FILE.NPTH_FILE;
          }

          this.createDrillFile(fullFilename, span, file_type);

          if (span.m_IsBackdrill && this.getHolesCount() > 0) {
            if (!this.writeBackdrillLayerPairFile(aPlotDirectory, aReporter, span)) {
              success = false;
              break;
            }
          }
        }
      }
    }

    if (aGenMap) success = this.CreateMapFilesSet(aPlotDirectory, aReporter) && success;

    aReporter?.reportTail('Done.', RPT_SEVERITY_INFO);

    return success;
  }

  /** Write a comment string giving the hole attribute. */
  private writeHoleAttribute(aAttribute: HOLE_ATTRIBUTE): void {
    // Hole attributes are comments (lines starting by ';') in the drill files
    // For tools (file header), they are similar to X2 apertures attributes.
    // for attributes added in coordinate list, they are just comments.
    if (this.m_minimalHeader) return;

    switch (aAttribute) {
      case HOLE_ATTRIBUTE.HOLE_VIA_THROUGH:
        this.print('; #@! TA.AperFunction,Plated,PTH,ViaDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_VIA_BURIED:
        this.print('; #@! TA.AperFunction,Plated,Buried,ViaDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_VIA_BACKDRILL:
        this.print('; #@! TA.AperFunction,NonPlated,BackDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_PAD:
        this.print('; #@! TA.AperFunction,Plated,PTH,ComponentDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_PAD_CASTELLATED:
        this.print('; #@! TA.AperFunction,Plated,PTH,CastelletedDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_PAD_PRESSFIT:
        this.print('; #@! TA.AperFunction,Plated,PTH,ComponentDrill,PressFit\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_MECHANICAL:
        this.print('; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill\n');
        break;

      case HOLE_ATTRIBUTE.HOLE_UNKNOWN:
        this.print('; #@! TD\n');
        break;
    }
  }

  /** Create an Excellon drill file; returns the hole count. */
  private createDrillFile(
    aFullFilename: string,
    aSpan: DRILL_SPAN,
    aHolesType: TYPE_FILE,
    aTagBackdrillHit = false,
  ): number {
    // if units are mm, the resolution is 0.001 mm (3 digits in mantissa)
    // if units are inches, the resolution is 0.1 mil (4 digits in mantissa)
    this.m_mantissaLenght = this.m_unitsMetric ? 3 : 4;

    this.m_out = '';

    this.writeEXCELLONHeader(aSpan, aHolesType);

    let holes_count = 0;

    /* Write the tool list */
    for (let ii = 0; ii < this.m_toolListBuffer.length; ii++) {
      const tool_descr = this.m_toolListBuffer[ii]!;

      if (USE_ATTRIB_FOR_HOLES) this.writeHoleAttribute(tool_descr.m_HoleAttribute);

      this.print(
        `T${ii + 1}C${fixed(tool_descr.m_Diameter * this.m_conversionUnits, this.m_mantissaLenght)}\n`,
      );

      if (!this.m_minimalHeader) {
        if (tool_descr.m_IsBackdrill) {
          const formatStub = (aStubLength: number): string => {
            const stubMM = pcbIUScale.iuToMM(aStubLength);
            const stubInches = stubMM / 25.4;
            return `${fixed(stubMM, 3)}mm (${fixed(stubInches, 4)}")`;
          };

          let comment = '; Backdrill';

          if (tool_descr.m_MinStubLength !== undefined) {
            comment += ' stub ';
            comment += formatStub(tool_descr.m_MinStubLength);

            if (
              tool_descr.m_MaxStubLength !== undefined &&
              tool_descr.m_MaxStubLength !== tool_descr.m_MinStubLength
            ) {
              comment += ' to ';
              comment += formatStub(tool_descr.m_MaxStubLength);
            }
          }

          if (tool_descr.m_HasPostMachining) comment += ', post-machining';

          comment += '\n';
          this.print(comment);
        } else if (tool_descr.m_HasPostMachining) {
          this.print('; Post-machining\n');
        }
      }
    }

    this.print('%\n'); // End of header info
    this.print('G90\n'); // Absolute mode
    this.print('G05\n'); // Drill mode

    /* Read the hole list and generate data for normal holes (oblong
     * holes will be created later) */
    let tool_reference = -2;

    for (const hole_descr of this.m_holeListBuffer) {
      if (hole_descr.m_Hole_Shape) continue; // oblong holes will be created later

      if (tool_reference !== hole_descr.m_Tool_Reference) {
        tool_reference = hole_descr.m_Tool_Reference;
        this.print(`T${tool_reference}\n`);
      }

      const x0 = hole_descr.m_Hole_Pos.x - this.m_offset.x;
      let y0 = hole_descr.m_Hole_Pos.y - this.m_offset.y;

      if (!this.m_mirror) y0 *= -1;

      const xt = x0 * this.m_conversionUnits;
      const yt = y0 * this.m_conversionUnits;
      this.writeHoleComments(hole_descr, aTagBackdrillHit);
      this.print(this.writeCoordinates(xt, yt));
      holes_count++;
    }

    /* Read the hole list and generate data for oblong holes
     */
    tool_reference = -2; // set to a value not used for
    // m_holeListBuffer[ii].m_Tool_Reference

    for (const hole_descr of this.m_holeListBuffer) {
      if (hole_descr.m_Hole_Shape === 0) continue; // wait for oblong holes

      if (tool_reference !== hole_descr.m_Tool_Reference) {
        tool_reference = hole_descr.m_Tool_Reference;
        this.print(`T${tool_reference}\n`);
      }

      const diam = Math.min(hole_descr.m_Hole_Size.x, hole_descr.m_Hole_Size.y);

      if (diam === 0) continue;

      /* Compute the hole coordinates: */
      const xc = hole_descr.m_Hole_Pos.x - this.m_offset.x;
      const yc = hole_descr.m_Hole_Pos.y - this.m_offset.y;
      let p0 = { x: xc, y: yc };
      let pf = { x: xc, y: yc };

      /* Compute the start and end coordinates for the shape */
      if (hole_descr.m_Hole_Size.x < hole_descr.m_Hole_Size.y) {
        const delta = Math.trunc((hole_descr.m_Hole_Size.y - hole_descr.m_Hole_Size.x) / 2);
        p0.y -= delta;
        pf.y += delta;
      } else {
        const delta = Math.trunc((hole_descr.m_Hole_Size.x - hole_descr.m_Hole_Size.y) / 2);
        p0.x -= delta;
        pf.x += delta;
      }

      p0 = RotatePoint(p0, { x: xc, y: yc }, hole_descr.m_Hole_Orient);
      pf = RotatePoint(pf, { x: xc, y: yc }, hole_descr.m_Hole_Orient);

      if (!this.m_mirror) {
        p0.y *= -1;
        pf.y *= -1;
      }

      let xt = p0.x * this.m_conversionUnits;
      let yt = p0.y * this.m_conversionUnits;
      this.writeHoleComments(hole_descr, aTagBackdrillHit);

      if (this.m_useRouteModeForOval) this.print('G00'); // Select the routing mode

      let line = this.writeCoordinates(xt, yt);

      if (!this.m_useRouteModeForOval) {
        /* remove the '\n' from end of line, because we must add the "G85"
         * command to the line: */
        const end = [...line].findIndex((c) => c < ' ');
        if (end >= 0) line = line.slice(0, end);

        this.print(line);
        this.print('G85'); // add the "G85" command
      } else {
        this.print(line);
        this.print('M15\nG01'); // tool down and linear routing from last coordinates
      }

      xt = pf.x * this.m_conversionUnits;
      yt = pf.y * this.m_conversionUnits;
      this.print(this.writeCoordinates(xt, yt));

      if (this.m_useRouteModeForOval) this.print('M16\n'); // Tool up (end routing)

      this.print('G05\n'); // Select drill mode
      holes_count++;
    }

    this.writeEXCELLONEndOfFile(aFullFilename);

    return holes_count;
  }

  /** Create a line like according to the selected format. */
  private writeCoordinates(aCoordX: number, aCoordY: number): string {
    let x = aCoordX;
    let y = aCoordY;
    let xpad = this.m_precision.m_Lhs + this.m_precision.m_Rhs;
    let ypad = xpad;

    // if units are mm, the resolution is 0.001 mm (3 digits in mantissa)
    // if units are inches, the resolution is 0.1 mil (4 digits in mantissa)
    // in DECIMAL_FORMAT we could use more digits.

    switch (this.m_zeroFormat) {
      case ZEROS_FMT.SUPPRESS_LEADING:
        for (let i = 0; i < this.m_precision.m_Rhs; i++) {
          x *= 10;
          y *= 10;
        }

        return `X${KiROUND(x)}Y${KiROUND(y)}\n`;

      case ZEROS_FMT.SUPPRESS_TRAILING: {
        for (let i = 0; i < this.m_precision.m_Rhs; i++) {
          x *= 10;
          y *= 10;
        }

        if (x < 0) xpad++;

        if (y < 0) ypad++;

        let xs = zeroPad(KiROUND(x), xpad);
        let ys = zeroPad(KiROUND(y), ypad);

        // `while( xs[j] == '0' && j ) xs.Truncate( j-- );`
        while (xs.length > 1 && xs.endsWith('0')) xs = xs.slice(0, -1);
        while (ys.length > 1 && ys.endsWith('0')) ys = ys.slice(0, -1);

        return `X${xs}Y${ys}\n`;
      }

      case ZEROS_FMT.KEEP_ZEROS:
        for (let i = 0; i < this.m_precision.m_Rhs; i++) {
          x *= 10;
          y *= 10;
        }

        if (x < 0) xpad++;

        if (y < 0) ypad++;

        return `X${zeroPad(KiROUND(x), xpad)}Y${zeroPad(KiROUND(y), ypad)}\n`;

      default: {
        // DECIMAL_FORMAT
        /* In Excellon files, resolution is 1/1000 mm or 1/10000 inch (0.1 mil)
         * Although in decimal format, Excellon specifications do not specify
         * clearly the resolution. However it seems to be usually 1/1000mm or 0.1 mil
         * like in non decimal formats, so we trunk coordinates to m_mantissaLenght in mantissa
         * Decimal format just prohibit useless leading 0:
         * 0.45 or .45 is right, but 00.54 is incorrect.
         */
        const xs = trimZeros(fixed(x, this.m_mantissaLenght));
        const ys = trimZeros(fixed(y, this.m_mantissaLenght));

        return `X${xs}Y${ys}\n`;
      }
    }
  }

  /** Print the DRILL file header. */
  private writeEXCELLONHeader(aSpan: DRILL_SPAN, aHolesType: TYPE_FILE): void {
    this.print('M48\n'); // The beginning of a header

    if (!this.m_minimalHeader) {
      // The next lines in EXCELLON files are comments:
      const now = this.now();
      this.print(
        `; DRILL file ${GENERATOR_APPLICATION} ${GetBuildVersion()} date ${iso8601DateTime(now)}\n`,
      );

      let msg = '; FORMAT={';

      // Print precision:
      // Note in decimal format the precision is not used.
      // the floating point notation has higher priority than the precision.
      if (this.m_zeroFormat !== ZEROS_FMT.DECIMAL_FORMAT)
        msg += this.m_precision.GetPrecisionString();
      else msg += '-:-'; // in decimal format the precision is irrelevant

      msg += '/ absolute / ';
      msg += this.m_unitsMetric ? 'metric' : 'inch';

      /* Adding numbers notation format.
       * this is same as m_Choice_Zeros_Format strings, but NOT translated
       * because some EXCELLON parsers do not like non ASCII values
       * so we use ONLY English (ASCII) strings.
       */
      msg += ' / ';

      const zero_fmt = [
        'decimal',
        'suppress leading zeros',
        'suppress trailing zeros',
        'keep zeros',
      ];

      msg += `${zero_fmt[this.m_zeroFormat]}}\n`;
      this.print(msg);

      // add the structured comment TF.CreationDate:
      // The attribute value must conform to the full version of the ISO 8601
      this.print(
        `${GbrMakeCreationDateAttributeString(GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_NCDRILL, now)}\n`,
      );

      // Add the application name that created the drill file
      this.print(
        `; #@! TF.GenerationSoftware,${GENERATOR_VENDOR},${GENERATOR_APPLICATION},${GetBuildVersion()}\n`,
      );

      // Add the standard X2 FileFunction for drill files
      // TF.FileFunction,Plated[NonPlated],layer1num,layer2num,PTH[NPTH]
      this.print(`${this.BuildFileFunctionAttributeString(aSpan, aHolesType, true)}\n`);

      this.print('FMAT,2\n'); // Use Format 2 commands (version used since 1979)
    }

    this.print(this.m_unitsMetric ? 'METRIC' : 'INCH');

    switch (this.m_zeroFormat) {
      case ZEROS_FMT.DECIMAL_FORMAT:
        this.print('\n');
        break;

      case ZEROS_FMT.SUPPRESS_LEADING:
        this.print(',TZ\n');
        break;

      case ZEROS_FMT.SUPPRESS_TRAILING:
        this.print(',LZ\n');
        break;

      case ZEROS_FMT.KEEP_ZEROS:
        // write nothing, but TZ is acceptable when all zeros are kept
        this.print('\n');
        break;
    }
  }

  private writeEXCELLONEndOfFile(aFullFilename: string): void {
    // add if minimal here
    this.print('M30\n');
    this.writeFile(aFullFilename, this.m_out);
    this.m_out = '';
  }

  private getBackdrillLayerPairFileName(aSpan: DRILL_SPAN): string {
    const fn = splitFileName(this.m_pcb.GetFileName());

    return `${fn.name}-${this.layerPairName(aSpan.Pair())}-backdrill.${this.m_drillFileExtension}`;
  }

  private writeBackdrillLayerPairFile(
    aPlotDirectory: string,
    aReporter: Reporter | null,
    aSpan: DRILL_SPAN,
  ): boolean {
    const fullFilename = joinPath(aPlotDirectory, this.getBackdrillLayerPairFileName(aSpan));

    aReporter?.report(`Created file '${fullFilename}'`, RPT_SEVERITY_ACTION);

    this.createDrillFile(fullFilename, aSpan, TYPE_FILE.NPTH_FILE, true);

    return true;
  }

  private writeHoleComments(aHole: HOLE_INFO, aTagBackdrillHit: boolean): void {
    if (aTagBackdrillHit && aHole.m_IsBackdrill) this.print('; backdrill\n');

    this.writePostMachiningComment(
      aHole.m_FrontPostMachining,
      aHole.m_FrontPostMachiningSize,
      aHole.m_FrontPostMachiningDepth,
      aHole.m_FrontPostMachiningAngle,
      'front',
    );

    this.writePostMachiningComment(
      aHole.m_BackPostMachining,
      aHole.m_BackPostMachiningSize,
      aHole.m_BackPostMachiningDepth,
      aHole.m_BackPostMachiningAngle,
      'back',
    );
  }

  private writePostMachiningComment(
    aMode: PAD_DRILL_POST_MACHINING_MODE,
    aSizeIU: number,
    aDepthIU: number,
    aAngleDeciDegree: number,
    aSideLabel: string,
  ): void {
    if (
      aMode !== PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE &&
      aMode !== PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK
    )
      return;

    let comment = `; Post-machining ${aSideLabel} ${
      aMode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK ? 'countersink' : 'counterbore'
    }`;

    const sizeStr = this.formatLinearValue(aSizeIU);

    if (sizeStr !== '') comment += ` dia ${sizeStr}`;

    const depthStr = this.formatLinearValue(aDepthIU);

    if (depthStr !== '') comment += ` depth ${depthStr}`;

    if (aMode === PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK && aAngleDeciDegree > 0) {
      const angle = aAngleDeciDegree / 10.0;
      const angleStr =
        aAngleDeciDegree % 10 === 0 ? `${fixed(angle, 0)}deg` : `${fixed(angle, 1)}deg`;

      comment += ` angle ${angleStr}`;
    }

    comment += '\n';
    this.print(comment);
  }

  private formatLinearValue(aValueIU: number): string {
    if (aValueIU <= 0) return '';

    const converted = aValueIU * this.m_conversionUnits;

    return `${fixed(converted, this.m_mantissaLenght)}${this.m_unitsMetric ? 'mm' : 'in'}`;
  }
}
