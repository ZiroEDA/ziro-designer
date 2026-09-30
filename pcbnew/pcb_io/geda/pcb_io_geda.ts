// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/geda/pcb_io_geda.cpp` / `.h`: gEDA / Lepton EDA PCB — a
 * board file (`.pcb`) and a footprint library directory (`*.fp`).
 *
 * A library is a directory; there is no file system here, so the directory
 * is listed through `SetDirectoryLister` (the file names in it) and each
 * file read through the plugin's file reader. A library cannot be written:
 * `IsLibraryWritable` is false and `FootprintDelete` / `DeleteLibrary`
 * refuse. `GetLibraryTimestamp` is 0.
 *
 * `wxLogError` / `wxLogTrace` text is not kept.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { IO_FILE_DESC } from '@ziroeda/common/io/io_base.js';
import { IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ToCDouble, strtol10 } from '@ziroeda/common/libc/stdlib.js';
import { LSET } from '@ziroeda/common/lset.js';
import { PAGE_INFO } from '@ziroeda/common/page_info.js';
import { LINE_READER } from '@ziroeda/common/richio.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { wxCmpNoCase } from '@ziroeda/common/wx/wxstring.js';
import { IGNORE_PARENT_GROUP } from '@ziroeda/common/eda_item.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_180,
  ANGLE_360,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { BOARD } from '../../board.js';
import { ADD_MODE } from '../../board_item_container.js';
import { FOOTPRINT } from '../../footprint.js';
import { NETINFO_ITEM } from '../../netinfo_item.js';
import { NETINFO_LIST } from '../../netinfo_list.js';
import { PAD } from '../../pad.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../../padstack.js';
import { PCB_SHAPE } from '../../pcb_shape.js';
import { PCB_TEXT } from '../../pcb_text.js';
import { PCB_ARC, PCB_TRACK, PCB_VIA } from '../../pcb_track.js';
import { VIATYPE } from '../../pcb_track_types.js';
import { ZONE } from '../../zone.js';
import { PCB_IO, type PCB_IO_PROJECT, type PCB_IO_PROPERTIES } from '../pcb_io.js';

/** `FILEEXT::GedaPcbFootprintLibFileExtension`. */
const GedaPcbFootprintLibFileExtension = 'fp';

/** `std::numeric_limits<double>::max()`. */
const DBL_MAX = Number.MAX_VALUE;

/**
 * Parse a gEDA dimension: a bare number is in `aScalar` units, a `mm` or `mil`
 * suffix scales it.
 */
/** `parseInt` (a static in the C++; renamed so as not to shadow the global). */
function parseGedaInt(aValue: string, aScalar: number): number {
  let value = DBL_MAX;

  if (aValue.endsWith('mm')) aScalar *= 100000.0 / 25.4;
  else if (aValue.endsWith('mil')) aScalar *= 100;

  // Note: This currently fails if there is a units suffix: ToCDouble reads
  // the prefix and leaves `value` alone only when nothing converts.
  value = ToCDouble(aValue, value);

  if (value === DBL_MAX) throw new IO_ERROR(`Cannot convert '${aValue}' to an integer.`);

  return KiROUND(value * aScalar);
}

// Old version unit conversion: 1 mil = 1 unit, new: 1 unit = 0.01 mil
const TEXT_DEFAULT_SIZE = 40 * pcbIUScale.IU_PER_MILS;
const OLD_GPCB_UNIT_CONV = pcbIUScale.IU_PER_MILS;
const NEW_GPCB_UNIT_CONV = 0.01 * pcbIUScale.IU_PER_MILS;

/** `wxString::ToLong( &v )`: the prefix's value, and `v` left alone when nothing converts (probed). */
function ToLongPrev(aText: string, aPrev: number): number {
  const r = strtol10(aText, 0);

  return r.end === 0 ? aPrev : r.value;
}

/** `wxString::ToLong( &v, 16 )`: whether the whole text is one hex number, and its value. */
function ToLongHex(aText: string): { ok: boolean; value: bigint } {
  let i = 0;

  while (i < aText.length && ' \t\n\r\f\v'.includes(aText[i]!)) i++;

  let neg = false;

  if (aText[i] === '+' || aText[i] === '-') {
    neg = aText[i] === '-';
    i++;
  }

  // strtol( …, 16 ) accepts a 0x prefix when a hex digit follows it
  if (aText[i] === '0' && (aText[i + 1] === 'x' || aText[i + 1] === 'X')) {
    if (/[0-9a-fA-F]/.test(aText[i + 2] ?? '')) i += 2;
  }

  const start = i;

  while (i < aText.length && /[0-9a-fA-F]/.test(aText[i]!)) i++;

  if (i === start) return { ok: false, value: 0n };

  const v = BigInt(`0x${aText.slice(start, i)}`);

  return { ok: i === aText.length, value: neg ? -v : v };
}

/**
 * `wxString::Append( char )`: a byte of 0x80 or more is not a character in
 * the libc conversion wx uses for a lone `char`, and becomes '?'.
 */
const byteChar = (b: number): string => (b < 0x80 ? String.fromCharCode(b) : '?');

/** `GPCB_FPL_CACHE::testFlags` / `PCB_IO_GEDA::testFlags`. */
function testFlags(aFlag: string, aMask: number, aName: string): boolean {
  let number: string | null = null;

  if (aFlag.startsWith('0x') || aFlag.startsWith('0X')) number = aFlag.slice(2);

  if (number !== null) {
    const r = ToLongHex(number);

    if (r.ok && (r.value & BigInt(aMask)) !== 0n) return true;
  } else if (aFlag.includes(aName)) {
    return true;
  }

  return false;
}

/**
 * `parseParameters`: split what follows into parameters, reading on through
 * line ends until a closing `]` or `)` (or a line that opens with one).
 * The library cache's copy does not check for the end of the file after a
 * line end (it would dereference null); `aStopAtEnd` is the board's check.
 */
function parseParameters(
  aParameterList: string[],
  aLineReader: LINE_READER,
  aStopAtEnd: boolean,
): void {
  let tmp = '';
  let line: Uint8Array | null = aLineReader.Line();
  let pos = 0;

  const add = (s: string) => aParameterList.push(s);

  // Parse every parameter that are separated by spaces or double quotes
  while (line && line[pos] !== 0 && pos < line.length) {
    const key = line[pos]!;
    pos++;

    switch (key) {
      case 0x5b: // '['
      case 0x28: // '('
        if (tmp !== '') {
          add(tmp);
          tmp = '';
        }

        tmp += byteChar(key);
        add(tmp);
        tmp = '';

        // Opening delimiter "(" after Element statement.  Any other occurrence is part
        // of a keyword definition.
        if (aParameterList.length === 1) return;

        break;

      case 0x5d: // ']'
      case 0x29: // ')'
        if (tmp !== '') {
          add(tmp);
          tmp = '';
        }

        tmp += byteChar(key);
        add(tmp);
        return;

      case 0x0a: // '\n'
      case 0x0d: // '\r'
        line = aLineReader.ReadLine();
        pos = 0;

        // The library cache's copy reads on regardless; a null line ends it here.
        if (!line) {
          if (aStopAtEnd) return;

          if (tmp !== '') add(tmp);

          return;
        }

        // KI_FALLTHROUGH into the blank case
        if (tmp !== '') {
          add(tmp);
          tmp = '';
        }

        break;

      case 0x09: // '\t'
      case 0x20: // ' '
        if (tmp !== '') {
          add(tmp);
          tmp = '';
        }

        break;

      case 0x22: // '"'
        // Handle empty quotes.
        if (line[pos] === 0x22) {
          pos++;
          tmp = '';
          add('');
          break;
        }

        while (line[pos] !== 0 && pos < line.length) {
          const c = line[pos]!;
          pos++;

          if (c === 0x22) {
            add(tmp);
            tmp = '';
            break;
          } else {
            tmp += byteChar(c);
          }
        }

        break;

      case 0x23: // '#'
        line = aLineReader.ReadLine();
        pos = 0;

        if (!line) return;

        break;

      default:
        tmp += byteChar(key);
        break;
    }
  }
}

const eqNoCase = (a: string, b: string): boolean => wxCmpNoCase(a, b) === 0;

/** Lists the file names in a directory, or null when it cannot be opened. */
export type GEDA_DIRECTORY_LISTER = (aDirectory: string) => string[] | null;

class GPCB_FPL_CACHE_ENTRY {
  constructor(
    private readonly m_filename: string,
    private readonly m_footprint: FOOTPRINT,
  ) {}

  GetFileName(): string {
    return this.m_filename;
  }

  GetFootprint(): FOOTPRINT {
    return this.m_footprint;
  }
}

class GPCB_FPL_CACHE {
  private readonly m_lib_path: string;
  /** `boost::ptr_map<std::string, …>`: keyed by UTF-8 name, iterated in byte order. */
  private readonly m_footprints = new Map<string, GPCB_FPL_CACHE_ENTRY>();

  constructor(
    private readonly m_owner: PCB_IO_GEDA,
    aLibraryPath: string,
  ) {
    this.m_lib_path = aLibraryPath;
  }

  GetPath(): string {
    return this.m_lib_path;
  }

  IsWritable(): boolean {
    return false;
  }

  /** The footprints in name order (`ptr_map` iteration). */
  GetFootprints(): [string, GPCB_FPL_CACHE_ENTRY][] {
    const enc = new TextEncoder();
    const cmp = (a: string, b: string): number => {
      const x = enc.encode(a);
      const y = enc.encode(b);
      const n = Math.min(x.length, y.length);

      for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;

      return x.length - y.length;
    };

    return [...this.m_footprints.entries()].sort((a, b) => cmp(a[0], b[0]));
  }

  Find(aName: string): GPCB_FPL_CACHE_ENTRY | undefined {
    return this.m_footprints.get(aName);
  }

  Load(): void {
    const files = this.m_owner.ListDirectory(this.m_lib_path);

    if (files === null) throw new IO_ERROR(`Footprint library '${this.m_lib_path}' not found.`);

    let cacheErrorMsg = '';

    for (const fullName of files) {
      // wxDir::GetFirst( …, "*.fp" )
      const dot = fullName.lastIndexOf('.');

      if (dot < 0 || fullName.slice(dot + 1) !== GedaPcbFootprintLibFileExtension) continue;

      const name = fullName.slice(0, dot);
      const fullPath = `${this.m_lib_path}/${fullName}`;

      try {
        const data = this.m_owner.ReadFile(fullPath);

        if (!data) throw new IO_ERROR(`Unable to open file '${fullPath}'.`);

        const reader = new LINE_READER(data, fullPath);
        const footprint = this.parseFOOTPRINT(reader);

        // The footprint name is the file name without the extension.
        footprint.SetFPID(new LIB_ID('', name));

        // ptr_map::insert keeps an existing entry
        if (!this.m_footprints.has(name))
          this.m_footprints.set(name, new GPCB_FPL_CACHE_ENTRY(fullPath, footprint));
      } catch (e) {
        if (!(e instanceof Error)) throw e;

        if (cacheErrorMsg !== '') cacheErrorMsg += '\n\n';

        cacheErrorMsg += e.message;
      }
    }

    if (cacheErrorMsg !== '') throw new IO_ERROR(cacheErrorMsg);
  }

  private parseFOOTPRINT(aLineReader: LINE_READER): FOOTPRINT {
    let paramCnt: number;
    let conv_unit = NEW_GPCB_UNIT_CONV; // GPCB unit = 0.01 mils and Pcbnew 0.1.
    let parameters: string[] = [];
    const footprint = new FOOTPRINT(null);

    if (aLineReader.ReadLine() === null)
      throw new IO_ERROR(`${aLineReader.GetSource()}: empty file`);

    parseParameters(parameters, aLineReader, false);
    paramCnt = parameters.length;

    const parseError = (msg: string): never => {
      throw new IO_ERROR(
        `${msg} in '${aLineReader.GetSource()}', line ${aLineReader.LineNumber()}`,
      );
    };

    /* From the Geda PCB documentation, valid Element definitions:
     *   Element [SFlags "Desc" "Name" "Value" MX MY TX TY TDir TScale TSFlags]
     *   Element (NFlags "Desc" "Name" "Value" MX MY TX TY TDir TScale TNFlags)
     *   Element (NFlags "Desc" "Name" "Value" TX TY TDir TScale TNFlags)
     *   Element (NFlags "Desc" "Name" TX TY TDir TScale TNFlags)
     *   Element ("Desc" "Name" TX TY TDir TScale TNFlags)
     */
    if (wxCmpNoCase(parameters[0] ?? '', 'Element') !== 0)
      parseError(`Unknown token '${parameters[0] ?? ''}'`);

    if (paramCnt < 10 || paramCnt > 14)
      parseError(`Element token contains ${paramCnt} parameters.`);

    // Test symbol after "Element": if [ units = 0.01 mils, and if ( units = 1 mil
    if (parameters[1] === '(') conv_unit = OLD_GPCB_UNIT_CONV;

    if (paramCnt > 10) {
      footprint.SetLibDescription(parameters[3]!);
      footprint.SetReference(parameters[4]!);
    } else {
      footprint.SetLibDescription(parameters[2]!);
      footprint.SetReference(parameters[3]!);
    }

    // Read value
    if (paramCnt > 10) footprint.SetValue(parameters[5]!);

    // With gEDA/pcb, value is meaningful after instantiation, only, so it's
    // often empty in bare footprints.
    if (footprint.Value().GetText() === '') footprint.Value().SetText('VAL**');

    if (footprint.Reference().GetText() === '') footprint.Reference().SetText('REF**');

    while (aLineReader.ReadLine()) {
      parameters = [];
      parseParameters(parameters, aLineReader, false);

      if (parameters.length === 0 || parameters[0] === '(') continue;

      if (parameters[0] === ')') break;

      paramCnt = parameters.length;

      // Test units value for a string line param (more than 3 parameters : ident [ xx ] )
      if (paramCnt > 3) {
        if (parameters[1] === '(') conv_unit = OLD_GPCB_UNIT_CONV;
        else conv_unit = NEW_GPCB_UNIT_CONV;
      }

      // Parse a line with format: ElementLine [X1 Y1 X2 Y2 Thickness]
      if (eqNoCase(parameters[0]!, 'ElementLine')) {
        if (paramCnt !== 8) parseError(`ElementLine token contains ${paramCnt} parameters.`);

        elementLine(footprint, parameters, conv_unit);
        continue;
      }

      // Parse an arc with format: ElementArc [X Y Width Height StartAngle DeltaAngle Thickness]
      if (eqNoCase(parameters[0]!, 'ElementArc')) {
        if (paramCnt !== 10) parseError(`ElementArc token contains ${paramCnt} parameters.`);

        elementArc(footprint, parameters, conv_unit);
        continue;
      }

      // Parse a Pad with no hole with format:
      //   Pad [rX1 rY1 rX2 rY2 Thickness Clearance Mask "Name" "Number" SFlags]
      //   Pad (rX1 rY1 rX2 rY2 Thickness Clearance Mask "Name" "Number" NFlags)
      //   Pad (aX1 aY1 aX2 aY2 Thickness "Name" "Number" NFlags)
      //   Pad (aX1 aY1 aX2 aY2 Thickness "Name" NFlags)
      if (eqNoCase(parameters[0]!, 'Pad')) {
        if (paramCnt < 10 || paramCnt > 13)
          parseError(`Pad token contains ${paramCnt} parameters.`);

        elementPad(footprint, parameters, conv_unit);
        continue;
      }

      // Parse a Pin with through hole with format:
      //   Pin [rX rY Thickness Clearance Mask Drill "Name" "Number" SFlags]
      //   Pin (rX rY Thickness Clearance Mask Drill "Name" "Number" NFlags)
      //   Pin (aX aY Thickness Drill "Name" "Number" NFlags)
      //   Pin (aX aY Thickness Drill "Name" NFlags)
      //   Pin (aX aY Thickness "Name" NFlags)
      if (eqNoCase(parameters[0]!, 'Pin')) {
        if (paramCnt < 8 || paramCnt > 12) parseError(`Pin token contains ${paramCnt} parameters.`);

        elementPin(footprint, parameters, conv_unit);
        continue;
      }
    }

    // Recalculate the bounding box
    footprint.AutoPositionFields();
    return footprint;
  }
}

// ---------------------------------------------------------------------------
// the element items, shared by the library and the board (the two C++ copies
// are identical past their parameter-count checks)

function elementLine(footprint: FOOTPRINT, parameters: string[], conv_unit: number): void {
  const shape = new PCB_SHAPE(footprint, SHAPE_T.SEGMENT);
  shape.SetLayer(PCB_LAYER_ID.F_SilkS);
  shape.SetStart({
    x: parseGedaInt(parameters[2]!, conv_unit),
    y: parseGedaInt(parameters[3]!, conv_unit),
  });
  shape.SetEnd({
    x: parseGedaInt(parameters[4]!, conv_unit),
    y: parseGedaInt(parameters[5]!, conv_unit),
  });
  shape.SetStroke(new STROKE_PARAMS(parseGedaInt(parameters[6]!, conv_unit), LINE_STYLE.SOLID));

  shape.Rotate({ x: 0, y: 0 }, footprint.GetOrientation());
  shape.Move(footprint.GetPosition());

  footprint.Add(shape);
}

function elementArc(footprint: FOOTPRINT, parameters: string[], conv_unit: number): void {
  const shape = new PCB_SHAPE(footprint, SHAPE_T.ARC);
  shape.SetLayer(PCB_LAYER_ID.F_SilkS);
  footprint.Add(shape);

  // for and arc: ibuf[3] = ibuf[4]. KiCad does not handle elliptical arcs
  // `( long + long ) / 2`: integer division
  const radius = Math.trunc(
    (parseGedaInt(parameters[4]!, conv_unit) + parseGedaInt(parameters[5]!, conv_unit)) / 2,
  );

  const centre: VECTOR2I = {
    x: parseGedaInt(parameters[2]!, conv_unit),
    y: parseGedaInt(parameters[3]!, conv_unit),
  };

  // Pcbnew start angles are inverted and 180 degrees from Geda PCB angles.
  let start_angle = new EDA_ANGLE(
    parseGedaInt(parameters[6]!, -10.0) | 0,
    EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T,
  );
  start_angle = start_angle.add(ANGLE_180);

  // Pcbnew delta angle direction is the opposite of Geda PCB delta angles.
  const sweep_angle = new EDA_ANGLE(
    parseGedaInt(parameters[7]!, -10.0) | 0,
    EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T,
  );

  // Geda PCB does not support circles.
  if (sweep_angle.equals(ANGLE_360.negate())) {
    shape.SetShape(SHAPE_T.CIRCLE);
    shape.SetCenter(centre);
    shape.SetEnd({ x: centre.x + radius, y: centre.y });
  } else {
    // Calculate start point coordinate of arc
    const arcStart = RotatePoint({ x: radius, y: 0 }, start_angle.negate());
    shape.SetCenter(centre);
    shape.SetStart({ x: arcStart.x + centre.x, y: arcStart.y + centre.y });

    // Angle value is clockwise in gpcb and Pcbnew.
    shape.SetArcAngleAndEnd(sweep_angle, true);
  }

  shape.SetStroke(new STROKE_PARAMS(parseGedaInt(parameters[8]!, conv_unit), LINE_STYLE.SOLID));

  shape.Rotate({ x: 0, y: 0 }, footprint.GetOrientation());
  shape.Move(footprint.GetPosition());
}

function elementPad(footprint: FOOTPRINT, parameters: string[], conv_unit: number): void {
  const paramCnt = parameters.length;
  const ALL = PADSTACK.ALL_LAYERS;
  const pad = new PAD(footprint);

  const pad_front = new LSET([PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.F_Paste]);
  const pad_back = new LSET([PCB_LAYER_ID.B_Cu, PCB_LAYER_ID.B_Mask, PCB_LAYER_ID.B_Paste]);

  pad.SetShape(ALL, PAD_SHAPE.RECTANGLE);
  pad.SetAttribute(PAD_ATTRIB.SMD);
  pad.SetLayerSet(pad_front);

  if (testFlags(parameters[paramCnt - 2]!, 0x0080, 'onsolder')) pad.SetLayerSet(pad_back);

  // Set the pad name:
  // Pcbnew pad name is used for electrical connection calculations.
  // Accordingly it should be mapped to gEDA's pin/pad number,
  // which is used for the same purpose.
  // gEDA also features a pin/pad "name", which is an arbitrary string
  // and set to the pin name of the netlist on instantiation. Many gEDA
  // bare footprints use identical strings for name and number, so this
  // can be a bit confusing.
  pad.SetNumber(parameters[paramCnt - 3]!);

  const x1 = parseGedaInt(parameters[2]!, conv_unit);
  const x2 = parseGedaInt(parameters[4]!, conv_unit);
  const y1 = parseGedaInt(parameters[3]!, conv_unit);
  const y2 = parseGedaInt(parameters[5]!, conv_unit);
  const width = parseGedaInt(parameters[6]!, conv_unit);
  const delta: VECTOR2I = { x: x2 - x1, y: y2 - y1 };
  const angle = Math.atan2(delta.y, delta.x);

  // Get the pad clearance and the solder mask clearance.
  if (paramCnt === 13) {
    const clearance = parseGedaInt(parameters[7]!, conv_unit);
    // One of gEDA's oddities is that clearance between pad and polygon
    // is given as the gap on both sides of the pad together, so for
    // KiCad it has to halfed.
    pad.SetLocalClearance(Math.trunc(clearance / 2));

    // In GEDA, the mask value is the size of the hole in this
    // solder mask. In Pcbnew, it is a margin, therefore the distance
    // between the copper and the mask
    let maskMargin = parseGedaInt(parameters[8]!, conv_unit);
    maskMargin = Math.trunc((maskMargin - width) / 2);
    pad.SetLocalSolderMaskMargin(maskMargin);
  }

  // Negate angle (due to Y reversed axis)
  pad.SetOrientation(new EDA_ANGLE(-angle, EDA_ANGLE_T.RADIANS_T));

  const padPos: VECTOR2I = { x: Math.trunc((x1 + x2) / 2), y: Math.trunc((y1 + y2) / 2) };

  pad.SetSize(ALL, { x: EuclideanNormI(delta) + width, y: width });

  const fpPos = footprint.GetPosition();
  pad.SetPosition({ x: padPos.x + fpPos.x, y: padPos.y + fpPos.y });

  if (!testFlags(parameters[paramCnt - 2]!, 0x0100, 'square')) {
    if (pad.GetSize(ALL).x === pad.GetSize(ALL).y) pad.SetShape(ALL, PAD_SHAPE.CIRCLE);
    else pad.SetShape(ALL, PAD_SHAPE.OVAL);
  }

  // Invalid zero-sized pad ignored
  if (pad.GetSizeX() > 0 && pad.GetSizeY() > 0) footprint.Add(pad);
}

function elementPin(footprint: FOOTPRINT, parameters: string[], conv_unit: number): void {
  const paramCnt = parameters.length;
  const ALL = PADSTACK.ALL_LAYERS;
  const pad = new PAD(footprint);

  pad.SetShape(ALL, PAD_SHAPE.CIRCLE);

  const pad_set = LSET.AllCuMask().or(
    new LSET([PCB_LAYER_ID.F_SilkS, PCB_LAYER_ID.F_Mask, PCB_LAYER_ID.B_Mask]),
  );

  pad.SetLayerSet(pad_set);

  if (testFlags(parameters[paramCnt - 2]!, 0x0100, 'square'))
    pad.SetShape(ALL, PAD_SHAPE.RECTANGLE);

  // Set the pad name:
  // Pcbnew pad name is used for electrical connection calculations.
  // Accordingly it should be mapped to gEDA's pin/pad number,
  // which is used for the same purpose.
  pad.SetNumber(parameters[paramCnt - 3]!);

  const padPos: VECTOR2I = {
    x: parseGedaInt(parameters[2]!, conv_unit),
    y: parseGedaInt(parameters[3]!, conv_unit),
  };

  const padSize = parseGedaInt(parameters[4]!, conv_unit);

  pad.SetSize(ALL, { x: padSize, y: padSize });

  let drillSize = 0;

  // Get the pad clearance, solder mask clearance, and drill size.
  if (paramCnt === 12) {
    const clearance = parseGedaInt(parameters[5]!, conv_unit);
    // One of gEDA's oddities is that clearance between pad and polygon
    // is given as the gap on both sides of the pad together, so for
    // KiCad it has to halfed.
    pad.SetLocalClearance(Math.trunc(clearance / 2));

    // In GEDA, the mask value is the size of the hole in this
    // solder mask. In Pcbnew, it is a margin, therefore the distance
    // between the copper and the mask
    let maskMargin = parseGedaInt(parameters[6]!, conv_unit);
    maskMargin = Math.trunc((maskMargin - padSize) / 2);
    pad.SetLocalSolderMaskMargin(maskMargin);

    drillSize = parseGedaInt(parameters[7]!, conv_unit);
  } else {
    drillSize = parseGedaInt(parameters[5]!, conv_unit);
  }

  pad.SetDrillSize({ x: drillSize, y: drillSize });

  const fpPos = footprint.GetPosition();
  pad.SetPosition({ x: padPos.x + fpPos.x, y: padPos.y + fpPos.y });

  if (pad.GetShape(ALL) === PAD_SHAPE.CIRCLE && pad.GetSize(ALL).x !== pad.GetSize(ALL).y)
    pad.SetShape(ALL, PAD_SHAPE.OVAL);

  footprint.Add(pad);
}

// ---------------------------------------------------------------------------

export class PCB_IO_GEDA extends PCB_IO {
  private m_cache: GPCB_FPL_CACHE | null = null;
  private m_ctl: number;
  private m_listDir: GEDA_DIRECTORY_LISTER = () => null;
  private m_cachedFootprints: FOOTPRINT[] = [];
  /** `std::map<wxString, NETINFO_ITEM*>`. */
  private m_netMap = new Map<string, NETINFO_ITEM>();
  private m_numCopperLayers = 2;

  constructor(aControlFlags = 0) {
    super('gEDA PCB');
    this.m_ctl = aControlFlags;
    this.init(null);
  }

  override GetBoardFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('gEDA / Lepton EDA PCB board file', ['pcb']);
  }

  override GetLibraryFileDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC('gEDA / Lepton EDA PCB footprint file', [
      GedaPcbFootprintLibFileExtension,
    ]);
  }

  GetLibraryDesc(): IO_FILE_DESC {
    return new IO_FILE_DESC(
      'gEDA / Lepton EDA PCB footprint library directory',
      [],
      [GedaPcbFootprintLibFileExtension],
      false,
    );
  }

  /** Where a library directory's file names come from (the browser has no `wxDir`). */
  SetDirectoryLister(aLister: GEDA_DIRECTORY_LISTER): void {
    this.m_listDir = aLister;
  }

  /** @internal the cache's `wxDir`. */
  ListDirectory(aDirectory: string): string[] | null {
    return this.m_listDir(aDirectory);
  }

  /** @internal the cache's `FILE_LINE_READER`. */
  ReadFile(aPath: string): Uint8Array | null {
    return this.m_readFile(aPath);
  }

  private init(aProperties: PCB_IO_PROPERTIES | null): void {
    this.m_props = aProperties;
  }

  private validateCache(aLibraryPath: string, _checkModified = true): void {
    // There is no modification time to compare: a cache of another path is
    // the only thing that is stale.
    if (!this.m_cache || this.m_cache.GetPath() !== aLibraryPath) {
      this.m_cache = new GPCB_FPL_CACHE(this, aLibraryPath);
      this.m_cache.Load();
    }
  }

  override ImportFootprint(
    aFootprintPath: string,
    aFootprintNameOut: { value: string },
    _aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    const data = this.m_readFile(aFootprintPath);

    if (!data) throw new IO_ERROR(`Unable to open file '${aFootprintPath}'.`);

    // WHITESPACE_FILTER_READER: the first line that is not blank or a comment
    const freader = new LINE_READER(data, aFootprintPath);
    let line: string | null = null;

    for (let l = freader.ReadLine(); l; l = freader.ReadLine()) {
      let s = 0;

      while (l[s] === 0x20 || l[s] === 0x09) s++;

      if (l[s] !== 0x23 && l[s] !== 0x0a && l[s] !== 0x0d && l[s] !== 0) {
        line = new TextDecoder('latin1').decode(l.subarray(s, l.length - 1));
        break;
      }
    }

    if (!line) return null;

    if (line.slice(0, 'Element'.length).toLowerCase() !== 'element') return null;

    const slash = aFootprintPath.lastIndexOf('/');
    const dir = slash < 0 ? '' : aFootprintPath.slice(0, slash);
    const file = aFootprintPath.slice(slash + 1);
    const dot = file.lastIndexOf('.');

    aFootprintNameOut.value = dot < 0 ? file : file.slice(0, dot);

    return this.FootprintLoad(dir, aFootprintNameOut.value);
  }

  override FootprintEnumerate(
    aFootprintNames: string[],
    aLibraryPath: string,
    aBestEfforts: boolean,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    let errorMsg = '';

    if (this.m_listDir(aLibraryPath) === null) {
      if (aBestEfforts) return;

      throw new IO_ERROR(`Footprint library '${aLibraryPath}' not found.`);
    }

    this.init(aProperties);

    try {
      this.validateCache(aLibraryPath);
    } catch (e) {
      if (!(e instanceof IO_ERROR)) throw e;

      errorMsg = e.message;
    }

    // Some of the files may have been parsed correctly so we want to add the valid files to
    // the library.
    for (const [name] of this.m_cache!.GetFootprints()) aFootprintNames.push(name);

    if (errorMsg !== '' && !aBestEfforts) throw new IO_ERROR(errorMsg);
  }

  private getFootprint(
    aLibraryPath: string,
    aFootprintName: string,
    aProperties: PCB_IO_PROPERTIES | null,
    checkModified: boolean,
  ): FOOTPRINT | null {
    this.init(aProperties);
    this.validateCache(aLibraryPath, checkModified);

    return this.m_cache!.Find(aFootprintName)?.GetFootprint() ?? null;
  }

  override FootprintLoad(
    aLibraryPath: string,
    aFootprintName: string,
    _aKeepUUID = false,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): FOOTPRINT | null {
    const footprint = this.getFootprint(aLibraryPath, aFootprintName, aProperties, true);

    if (footprint) {
      const copy = footprint.Duplicate(IGNORE_PARENT_GROUP) as FOOTPRINT;
      copy.SetParent(null);
      return copy;
    }

    return null;
  }

  override FootprintDelete(
    aLibraryPath: string,
    _aFootprintName: string,
    aProperties: PCB_IO_PROPERTIES | null = null,
  ): void {
    this.init(aProperties);
    this.validateCache(aLibraryPath);

    if (!this.m_cache!.IsWritable()) throw new IO_ERROR(`Library '${aLibraryPath}' is read only.`);
  }

  override DeleteLibrary(_aLibraryPath: string): boolean {
    // `wxFileName::DirExists()`: nothing here is a directory that can be removed
    return false;
  }

  GetLibraryTimestamp(_aLibraryPath: string): number {
    return 0;
  }

  override IsLibraryWritable(aLibraryPath: string): boolean {
    this.init(null);
    this.validateCache(aLibraryPath);

    return this.m_cache!.IsWritable();
  }

  override CanReadBoard(aFileName: string): boolean {
    if (!super.CanReadBoard(aFileName)) return false;

    const data = this.m_readFile(aFileName);

    if (!data) return false;

    // wxTextInputStream::ReadLine over the first 20 lines, stopping at the end
    const text = new TextDecoder('latin1').decode(data);
    let pos = 0;

    for (let i = 0; i < 20; i++) {
      if (pos >= text.length) return false;

      let end = pos;

      while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++;

      const line = text.slice(pos, end);

      if (text[end] === '\r' && text[end + 1] === '\n') end++;

      pos = end + 1;

      if (line.includes('PCB[') || line.includes('PCB(')) return true;
    }

    return false;
  }

  private mapLayer(aGedaLayer: number, aLayerName: string): PCB_LAYER_ID {
    const name = aLayerName.toLowerCase();
    const L = PCB_LAYER_ID;

    if (name.includes('outline') || name.includes('route')) return L.Edge_Cuts;

    if (name.includes('silk')) {
      if (name.includes('solder') || name.includes('bottom')) return L.B_SilkS;

      return L.F_SilkS;
    }

    if (name.includes('mask')) {
      if (name.includes('solder') || name.includes('bottom')) return L.B_Mask;

      return L.F_Mask;
    }

    if (name.includes('paste')) {
      if (name.includes('solder') || name.includes('bottom')) return L.B_Paste;

      return L.F_Paste;
    }

    if (name.includes('fab')) return L.F_Fab;

    if (
      name.includes('component') ||
      name.includes('top') ||
      (aGedaLayer === 1 && !name.includes('solder'))
    ) {
      return L.F_Cu;
    }

    if (name.includes('solder') || name.includes('bottom') || aGedaLayer === 2) return L.B_Cu;

    if (aGedaLayer >= 3 && aGedaLayer <= 16) {
      const innerIdx = aGedaLayer - 3;
      const innerLayers = [
        L.In1_Cu,
        L.In2_Cu,
        L.In3_Cu,
        L.In4_Cu,
        L.In5_Cu,
        L.In6_Cu,
        L.In7_Cu,
        L.In8_Cu,
        L.In9_Cu,
        L.In10_Cu,
        L.In11_Cu,
        L.In12_Cu,
        L.In13_Cu,
        L.In14_Cu,
      ];

      if (innerIdx < 14) return innerLayers[innerIdx]!;
    }

    return L.F_Cu;
  }

  private parseVia(aParameters: string[], aConvUnit: number): void {
    const board = this.m_board!;
    const paramCnt = aParameters.length;

    // Via[X Y Thickness Clearance Mask Drill "Name" SFlags]
    if (paramCnt < 10)
      throw new IO_ERROR(`Via token contains ${paramCnt} parameters, expected at least 10.`);

    const via = new PCB_VIA(board);

    const x = parseGedaInt(aParameters[2]!, aConvUnit);
    const y = parseGedaInt(aParameters[3]!, aConvUnit);
    const thickness = parseGedaInt(aParameters[4]!, aConvUnit);
    const drill = parseGedaInt(aParameters[7]!, aConvUnit);

    via.SetPosition({ x, y });
    via.SetWidth(PADSTACK.ALL_LAYERS, thickness);
    via.SetDrill(drill);
    via.SetViaType(VIATYPE.THROUGH);
    via.SetLayerPair(PCB_LAYER_ID.F_Cu, PCB_LAYER_ID.B_Cu);
    via.SetNet(NETINFO_LIST.OrphanedItem());

    board.Add(via, ADD_MODE.APPEND);
  }

  private parseElement(
    aParameters: string[],
    aLineReader: LINE_READER,
    aConvUnit: number,
  ): FOOTPRINT | null {
    let paramCnt = aParameters.length;
    let conv_unit = aConvUnit;

    const footprint = new FOOTPRINT(this.m_board);

    if (paramCnt < 10 || paramCnt > 14)
      throw new IO_ERROR(`Element token contains ${paramCnt} parameters.`);

    let descIdx: number;
    let nameIdx: number;
    let valueIdx: number;
    let mxIdx: number;

    if (paramCnt > 10) {
      descIdx = 3;
      nameIdx = 4;
      valueIdx = 5;
      mxIdx = 6;
    } else {
      descIdx = 2;
      nameIdx = 3;
      valueIdx = -1;
      mxIdx = -1;
    }

    footprint.SetLibDescription(aParameters[descIdx]!);
    footprint.SetReference(aParameters[nameIdx]!);

    if (valueIdx > 0) footprint.SetValue(aParameters[valueIdx]!);

    if (footprint.Value().GetText() === '') footprint.Value().SetText('VAL**');

    if (footprint.Reference().GetText() === '') footprint.Reference().SetText('REF**');

    if (mxIdx > 0 && paramCnt > 12) {
      const mx = parseGedaInt(aParameters[mxIdx]!, conv_unit);
      const my = parseGedaInt(aParameters[mxIdx + 1]!, conv_unit);
      footprint.SetPosition({ x: mx, y: my });
    }

    let parameters: string[] = [];

    while (aLineReader.ReadLine()) {
      parameters = [];
      parseParameters(parameters, aLineReader, true);

      if (parameters.length === 0 || parameters[0] === '(') continue;

      if (parameters[0] === ')') break;

      paramCnt = parameters.length;

      if (paramCnt > 3) {
        if (parameters[1] === '(') conv_unit = OLD_GPCB_UNIT_CONV;
        else conv_unit = NEW_GPCB_UNIT_CONV;
      }

      if (eqNoCase(parameters[0]!, 'ElementLine')) {
        if (paramCnt !== 8) continue;

        elementLine(footprint, parameters, conv_unit);
        continue;
      }

      if (eqNoCase(parameters[0]!, 'ElementArc')) {
        if (paramCnt !== 10) continue;

        elementArc(footprint, parameters, conv_unit);
        continue;
      }

      if (eqNoCase(parameters[0]!, 'Pad')) {
        if (paramCnt < 10 || paramCnt > 13) continue;

        elementPad(footprint, parameters, conv_unit);
        continue;
      }

      if (eqNoCase(parameters[0]!, 'Pin')) {
        if (paramCnt < 8 || paramCnt > 12) continue;

        elementPin(footprint, parameters, conv_unit);
        continue;
      }
    }

    // Handle onsolder flag -- flip footprint to back side
    const elementFlags = aParameters[2]!;

    if (elementFlags.includes('onsolder'))
      footprint.Flip(footprint.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);

    footprint.AutoPositionFields();
    return footprint;
  }

  private parseLayer(aParameters: string[], aLineReader: LINE_READER, aConvUnit: number): void {
    const board = this.m_board!;
    let paramCnt = aParameters.length;

    // Layer(N "name") or Layer(N "name" "type")
    if (paramCnt < 4) return;

    const layerNum = ToLongPrev(aParameters[2]!, 0);

    let layerName = '';

    if (paramCnt > 4) layerName = aParameters[3]!;

    const kicadLayer = this.mapLayer(layerNum | 0, layerName);
    const isCopperLayer = IsCopperLayer(kicadLayer);

    if (isCopperLayer) {
      const layerCount = layerNum | 0;

      if (layerCount > this.m_numCopperLayers) this.m_numCopperLayers = layerCount;
    }

    let parameters: string[] = [];
    let conv_unit = aConvUnit;

    while (aLineReader.ReadLine()) {
      parameters = [];
      parseParameters(parameters, aLineReader, true);

      if (parameters.length === 0 || parameters[0] === '(') continue;

      if (parameters[0] === ')') break;

      paramCnt = parameters.length;

      if (paramCnt > 3) {
        if (parameters[1] === '(') conv_unit = OLD_GPCB_UNIT_CONV;
        else conv_unit = NEW_GPCB_UNIT_CONV;
      }

      // Line[X1 Y1 X2 Y2 Thickness Clearance SFlags]
      if (eqNoCase(parameters[0]!, 'Line')) {
        if (paramCnt < 9) continue;

        const x1 = parseGedaInt(parameters[2]!, conv_unit);
        const y1 = parseGedaInt(parameters[3]!, conv_unit);
        const x2 = parseGedaInt(parameters[4]!, conv_unit);
        const y2 = parseGedaInt(parameters[5]!, conv_unit);
        const thickness = parseGedaInt(parameters[6]!, conv_unit);

        if (isCopperLayer) {
          const track = new PCB_TRACK(board);
          track.SetStart({ x: x1, y: y1 });
          track.SetEnd({ x: x2, y: y2 });
          track.SetWidth(thickness);
          track.SetLayer(kicadLayer);
          track.SetNet(NETINFO_LIST.OrphanedItem());
          board.Add(track, ADD_MODE.APPEND);
        } else {
          const shape = new PCB_SHAPE(board, SHAPE_T.SEGMENT);
          shape.SetStart({ x: x1, y: y1 });
          shape.SetEnd({ x: x2, y: y2 });
          shape.SetStroke(new STROKE_PARAMS(thickness, LINE_STYLE.SOLID));
          shape.SetLayer(kicadLayer);
          board.Add(shape, ADD_MODE.APPEND);
        }

        continue;
      }

      // Arc[X Y Width Height Thickness Clearance StartAngle DeltaAngle SFlags]
      if (eqNoCase(parameters[0]!, 'Arc')) {
        if (paramCnt < 11) continue;

        const cx = parseGedaInt(parameters[2]!, conv_unit);
        const cy = parseGedaInt(parameters[3]!, conv_unit);
        const arcWidth = parseGedaInt(parameters[4]!, conv_unit);
        const arcHeight = parseGedaInt(parameters[5]!, conv_unit);
        const thickness = parseGedaInt(parameters[6]!, conv_unit);
        const radius = Math.trunc((arcWidth + arcHeight) / 2);

        const centre: VECTOR2I = { x: cx, y: cy };

        let start_angle = new EDA_ANGLE(
          parseGedaInt(parameters[8]!, -10.0) | 0,
          EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T,
        );
        start_angle = start_angle.add(ANGLE_180);

        const sweep_angle = new EDA_ANGLE(
          parseGedaInt(parameters[9]!, -10.0) | 0,
          EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T,
        );

        if (isCopperLayer) {
          const arc = new PCB_ARC(board);
          arc.SetLayer(kicadLayer);
          arc.SetWidth(thickness);
          arc.SetNet(NETINFO_LIST.OrphanedItem());

          const arcStart = RotatePoint({ x: radius, y: 0 }, start_angle.negate());
          arc.SetStart({ x: arcStart.x + centre.x, y: arcStart.y + centre.y });

          const arcMid = RotatePoint(
            { x: radius, y: 0 },
            start_angle.negate().sub(sweep_angle.divide(2)),
          );
          arc.SetMid({ x: arcMid.x + centre.x, y: arcMid.y + centre.y });

          const arcEnd = RotatePoint({ x: radius, y: 0 }, start_angle.negate().sub(sweep_angle));
          arc.SetEnd({ x: arcEnd.x + centre.x, y: arcEnd.y + centre.y });

          board.Add(arc, ADD_MODE.APPEND);
        } else {
          const shape = new PCB_SHAPE(board, SHAPE_T.ARC);
          shape.SetLayer(kicadLayer);

          if (sweep_angle.equals(ANGLE_360.negate())) {
            shape.SetShape(SHAPE_T.CIRCLE);
            shape.SetCenter(centre);
            shape.SetEnd({ x: centre.x + radius, y: centre.y });
          } else {
            const arcStart = RotatePoint({ x: radius, y: 0 }, start_angle.negate());
            shape.SetCenter(centre);
            shape.SetStart({ x: arcStart.x + centre.x, y: arcStart.y + centre.y });
            shape.SetArcAngleAndEnd(sweep_angle, true);
          }

          shape.SetStroke(new STROKE_PARAMS(thickness, LINE_STYLE.SOLID));
          board.Add(shape, ADD_MODE.APPEND);
        }

        continue;
      }

      // Polygon(SFlags) ( [X Y] [X Y] ... )
      if (eqNoCase(parameters[0]!, 'Polygon')) {
        const zone = new ZONE(board);
        zone.SetLayer(kicadLayer);
        zone.SetNetCode(NETINFO_LIST.UNCONNECTED);
        zone.SetLocalClearance(0);
        zone.SetAssignedPriority(0);

        const outlineIdx = -1;
        let parsingPoints = false;

        while (aLineReader.ReadLine()) {
          const polyParams: string[] = [];
          parseParameters(polyParams, aLineReader, true);

          if (polyParams.length === 0) continue;

          if (polyParams[0] === ')') break;

          if (polyParams[0] === '(') {
            parsingPoints = true;
            continue;
          }

          if (!parsingPoints) continue;

          // Parse [X Y] pairs from the parameter list
          for (let i = 0; i < polyParams.length; i++) {
            if (polyParams[i] === '[' && i + 2 < polyParams.length) {
              const px = parseGedaInt(polyParams[i + 1]!, conv_unit);
              const py = parseGedaInt(polyParams[i + 2]!, conv_unit);
              zone.AppendCorner({ x: px, y: py }, outlineIdx);
              i += 3; // skip X, Y, and ]
            }
          }
        }

        if (zone.GetNumCorners() >= 3) {
          zone.SetIsFilled(false);
          board.Add(zone, ADD_MODE.APPEND);
        }

        continue;
      }

      // Text[X Y Direction Scale "String" SFlags]
      if (eqNoCase(parameters[0]!, 'Text')) {
        if (paramCnt < 8) continue;

        const text = new PCB_TEXT(board);
        text.SetLayer(kicadLayer);

        const tx = parseGedaInt(parameters[2]!, conv_unit);
        const ty = parseGedaInt(parameters[3]!, conv_unit);
        text.SetPosition({ x: tx, y: ty });

        const direction = ToLongPrev(parameters[4]!, 0);
        text.SetTextAngle(new EDA_ANGLE(direction * 90.0, EDA_ANGLE_T.DEGREES_T));

        const scale = ToLongPrev(parameters[5]!, 100);
        const textSize = KiROUND((TEXT_DEFAULT_SIZE * scale) / 100.0);
        text.SetTextSize({ x: textSize, y: textSize });

        text.SetText(parameters[6]!);
        board.Add(text, ADD_MODE.APPEND);
      }
    }
  }

  private parseNetList(aLineReader: LINE_READER): void {
    const board = this.m_board!;
    // Build a map of footprint reference -> FOOTPRINT* for quick lookup
    const fpByRef = new Map<string, FOOTPRINT>();

    for (const fp of board.Footprints()) fpByRef.set(fp.GetReference(), fp);

    let parameters: string[] = [];

    while (aLineReader.ReadLine()) {
      parameters = [];
      parseParameters(parameters, aLineReader, true);

      if (parameters.length === 0) continue;

      if (parameters[0] === ')') break;

      if (parameters[0] === '(') continue;

      // Net("name" "style")
      if (eqNoCase(parameters[0]!, 'Net')) {
        let netName = '';

        if (parameters.length > 3) netName = parameters[2]!;

        let netInfo = this.m_netMap.get(netName);

        if (!netInfo) {
          netInfo = new NETINFO_ITEM(board, netName);
          board.Add(netInfo);
          this.m_netMap.set(netName, netInfo);
        }

        // Parse Connect("refdes-pin") entries
        while (aLineReader.ReadLine()) {
          const netParams: string[] = [];
          parseParameters(netParams, aLineReader, true);

          if (netParams.length === 0) continue;

          if (netParams[0] === ')') break;

          if (netParams[0] === '(') continue;

          if (eqNoCase(netParams[0]!, 'Connect') && netParams.length > 3) {
            const connectStr = netParams[2]!;
            const lastDash = connectStr.lastIndexOf('-');

            if (lastDash < 0) continue;

            const refdes = connectStr.slice(0, lastDash);
            const pinNumber = connectStr.slice(lastDash + 1);

            const fp = fpByRef.get(refdes);

            if (!fp) continue;

            for (const pad of fp.Pads()) {
              if (pad.GetNumber() === pinNumber) {
                pad.SetNet(netInfo);
                break;
              }
            }
          }
        }
      }
    }
  }

  override LoadBoard(
    aFileName: string,
    aAppendToMe: BOARD | null,
    aProperties: PCB_IO_PROPERTIES | null = null,
    _aProject: PCB_IO_PROJECT | null = null,
  ): BOARD {
    this.init(aProperties);

    const board = aAppendToMe ?? new BOARD();
    this.m_board = board;

    // Give the filename to the board if it's new
    if (!aAppendToMe) board.SetFileName(aFileName);

    this.m_cachedFootprints = [];
    this.m_netMap.clear();
    this.m_numCopperLayers = 2;

    const data = this.m_readFile(aFileName);

    if (!data) throw new IO_ERROR(`Unable to open file '${aFileName}'.`);

    const reader = new LINE_READER(data, aFileName);
    let conv_unit = NEW_GPCB_UNIT_CONV;

    while (reader.ReadLine()) {
      const parameters: string[] = [];
      parseParameters(parameters, reader, true);

      if (parameters.length === 0) continue;

      const paramCnt = parameters.length;

      if (paramCnt > 3) {
        if (parameters[1] === '(') conv_unit = OLD_GPCB_UNIT_CONV;
        else conv_unit = NEW_GPCB_UNIT_CONV;
      }

      const p0 = parameters[0]!;

      // PCB["name" width height]
      if (eqNoCase(p0, 'PCB')) {
        if (paramCnt > 4) {
          const boardWidth = parseGedaInt(parameters[3]!, conv_unit);
          const boardHeight = parseGedaInt(parameters[4]!, conv_unit);

          const page = new PAGE_INFO();
          page.SetWidthMils(boardWidth / pcbIUScale.IU_PER_MILS);
          page.SetHeightMils(boardHeight / pcbIUScale.IU_PER_MILS);
          board.SetPageSettings(page);
        }

        continue;
      }

      if (eqNoCase(p0, 'FileVersion')) continue;

      // Skip Grid, Cursor, Thermal, DRC, Flags, Groups, Styles, Attribute
      if (
        eqNoCase(p0, 'Grid') ||
        eqNoCase(p0, 'Cursor') ||
        eqNoCase(p0, 'Thermal') ||
        eqNoCase(p0, 'DRC') ||
        eqNoCase(p0, 'Flags') ||
        eqNoCase(p0, 'Groups') ||
        eqNoCase(p0, 'Styles') ||
        eqNoCase(p0, 'Attribute')
      ) {
        continue;
      }

      if (eqNoCase(p0, 'Via')) {
        this.parseVia(parameters, conv_unit);
        continue;
      }

      if (eqNoCase(p0, 'Element')) {
        const fp = this.parseElement(parameters, reader, conv_unit);

        if (fp) {
          board.Add(fp, ADD_MODE.APPEND);

          const fpCopy = fp.Clone() as FOOTPRINT;
          fpCopy.SetParent(null);
          this.m_cachedFootprints.push(fpCopy);
        }

        continue;
      }

      if (eqNoCase(p0, 'Layer')) {
        this.parseLayer(parameters, reader, conv_unit);
        continue;
      }

      // Rat lines are just unrouted connections -- skip them
      if (eqNoCase(p0, 'Rat')) continue;

      if (eqNoCase(p0, 'NetList')) {
        this.parseNetList(reader);
        continue;
      }
    }

    // Set copper layer count
    const bds = board.GetDesignSettings();
    board.SetCopperLayerCount(Math.max(2, this.m_numCopperLayers));

    // Enable the layers we used
    const enabledLayers = bds.GetEnabledLayers();
    enabledLayers.set(PCB_LAYER_ID.F_Cu);
    enabledLayers.set(PCB_LAYER_ID.B_Cu);
    enabledLayers.set(PCB_LAYER_ID.F_SilkS);
    enabledLayers.set(PCB_LAYER_ID.B_SilkS);
    enabledLayers.set(PCB_LAYER_ID.F_Mask);
    enabledLayers.set(PCB_LAYER_ID.B_Mask);
    enabledLayers.set(PCB_LAYER_ID.Edge_Cuts);
    bds.SetEnabledLayers(enabledLayers);

    board.m_LegacyDesignSettingsLoaded = true;
    board.m_LegacyNetclassesLoaded = true;

    return board;
  }

  override GetImportedCachedLibraryFootprints(): FOOTPRINT[] {
    return this.m_cachedFootprints.map((fp) => fp.Clone() as FOOTPRINT);
  }
}
