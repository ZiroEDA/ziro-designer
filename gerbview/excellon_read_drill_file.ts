// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/excellon_read_drill_file.cpp` + `excellon_image.h`:
 * `EXCELLON_IMAGE`, a drill (Excellon) file read into a GERBER_FILE_IMAGE —
 * "there is a lot of likeness between EXCELLON files and GERBER files. DCode
 * apertures are also similar to T Codes": holes are flashed round apertures,
 * routed slots and outlines are lines and arcs.
 *
 *     M48                 ;DRILL file {PCBnew ...}
 *     FMAT,2
 *     INCH,TZ
 *     T1C0.02
 *     %
 *     G90
 *     G05
 *     T1
 *     X1.580Y-1.360
 *     M30
 *
 * `GERBVIEW_FRAME::Read_EXCELLON_File` is the frame's half and waits with it.
 * Browser divergence: `LoadFile` and `TestFileIsExcellon` take the file's
 * text, a file on a disk being text in memory here.
 */
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import { APERTURE_T, D_CODE, FIRST_DCODE, LAST_DCODE } from './dcode.js';
import {
  EXCELLON_DEFAULTS,
  FMT_INTEGER_INCH,
  FMT_INTEGER_MM,
  FMT_MANTISSA_INCH,
  FMT_MANTISSA_MM,
} from './excellon_defaults.js';
import { GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import { GERBER_FILE_IMAGE, LAST_EXTRA_ARC_DATA_TYPE } from './gerber_file_image.js';
import { Gerb_Interpolation, gerbIUScale } from './gerbview.js';
import {
  CHAR_PTR,
  FILE,
  LINE_BUFFER,
  NUL,
  StrPurge,
  ToCDoubleOk,
  isdigit,
  strncasecmp0,
} from './libc.js';
import { fillArcGBRITEM, fillFlashedGBRITEM, fillLineGBRITEM } from './rs274d.js';
import { ReadDouble, ReadInt } from './rs274_read_XY_and_IJ_coordinates.js';
import { X2_ATTRIBUTE, X2_ATTRIBUTE_FILEFUNCTION } from './X2_gerber_attributes.js';
import { ReadFileText } from './files.js';
import type { GERBVIEW_FRAME } from './gerbview_frame.js';

/** `drill_M_code_t`. */
export enum drill_M_code_t {
  DRILL_M_UNKNOWN,
  DRILL_M_END,
  /** tool down (starting a routed hole) */
  DRILL_M_TOOL_DOWN,
  /** tool up (ending a routed hole) */
  DRILL_M_TOOL_UP,
  DRILL_M_ENDFILE,
  DRILL_M_MESSAGE,
  DRILL_M_LONGMESSAGE,
  DRILL_M_HEADER,
  DRILL_M_ENDHEADER,
  DRILL_M_BEGINPATTERN,
  DRILL_M_ENDPATTERN,
  DRILL_M_CANNEDTEXT,
  DRILL_M_TIPCHECK,
  DRILL_M_METRIC,
  DRILL_M_IMPERIAL,
  DRILL_METRIC_HEADER,
  DRILL_IMPERIAL_HEADER,
  DRILL_DETECT_BROKEN,
  DRILL_INCREMENTALHEADER,
  DRILL_REWIND_STOP,
  DRILL_TOOL_CHANGE_STOP,
  DRILL_AUTOMATIC_SPEED,
  DRILL_AXIS_VERSION,
  DRILL_RESET_CMD,
  DRILL_AUTOMATIC_TOOL_CHANGE,
  DRILL_FMT,
  DRILL_FORMAT_ALTIUM,
  DRILL_HEADER_SKIP,
  DRILL_SKIP,
  DRILL_TOOL_INFORMATION,
  /** not used: sentinel */
  DRILL_M_END_LIST,
}

/** `drill_G_code_t`, numbered on from the M codes. */
export enum drill_G_code_t {
  DRILL_G_UNKNOWN = drill_M_code_t.DRILL_M_END_LIST + 1, // Use next available value
  DRILL_G_ABSOLUTE,
  DRILL_G_INCREMENTAL,
  DRILL_G_ZEROSET,
  DRILL_G_ROUT,
  DRILL_G_DRILL,
  DRILL_G_SLOT,
  DRILL_G_ZERO_SET,
  DRILL_G_LINEARMOVE,
  DRILL_G_CWMOVE,
  DRILL_G_CCWMOVE,
}

/** `EXCELLON_CMD`: a helper struct to analyze Excellon commands. */
interface EXCELLON_CMD {
  /** key string */
  m_Name: string;
  /** internal code, used as id in functions */
  m_Code: number;
  /** 0 = no param, -1 = skip params, 1 = read params */
  m_asParams: number;
}

/** `ROUTE_CCW`. */
export const ROUTE_CCW = 1;
/** `ROUTE_CW`. */
export const ROUTE_CW = -1;

/** `EXCELLON_ROUTE_COORD`: a point of a routed path. */
export class EXCELLON_ROUTE_COORD {
  m_x = 0; // X coordinate
  m_y = 0; // y coordinate
  m_cx = 0; // center X coordinate in circular routing mode (when the IJ command is used)
  m_cy = 0; // center y coordinate in circular routing mode (when the IJ command is used)
  m_radius = 0; // radius in circular routing mode (when the A## command is used)
  m_rmode = 0; // routing mode: 0 = circular, ROUTE_CCW (1) = ccw, ROUTE_CW (-1) = cw
  m_arc_type_info = 0; // arc using radius or center coordinates

  /**
   * `EXCELLON_ROUTE_COORD( aPos )`, `( aPos, aCenter, aMode )` or
   * `( aPos, aRadius, aMode )`.
   */
  constructor(aPos?: VECTOR2I, aCenterOrRadius?: VECTOR2I | number, aMode?: number) {
    if (!aPos) return;

    this.m_x = aPos.x;
    this.m_y = aPos.y;

    if (aCenterOrRadius === undefined) {
      this.m_arc_type_info = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
    } else if (typeof aCenterOrRadius === 'number') {
      this.m_radius = aCenterOrRadius;
      this.m_rmode = aMode ?? 0;
      this.m_arc_type_info = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_RADIUS;
    } else {
      this.m_cx = aCenterOrRadius.x;
      this.m_cy = aCenterOrRadius.y;
      this.m_rmode = aMode ?? 0;
      this.m_arc_type_info = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER;
    }
  }

  GetPos(): VECTOR2I {
    return { x: this.m_x, y: this.m_y };
  }
}

/**
 * Gerber X2 files have a file attribute which specify the type of image.
 * Excellon drill files do not, so, "just to identify the image, in gerbview,
 * we add this attribute, similar to a Gerber drill file". [data]
 */
const file_attribute = '.FileFunction,Other,Drill*';

/** `excellonHeaderCmdList`. [data] */
const excellonHeaderCmdList: readonly EXCELLON_CMD[] = [
  { m_Name: 'M0', m_Code: drill_M_code_t.DRILL_M_END, m_asParams: -1 }, // End of Program - No Rewind
  { m_Name: 'M00', m_Code: drill_M_code_t.DRILL_M_END, m_asParams: -1 }, // End of Program - No Rewind
  { m_Name: 'M15', m_Code: drill_M_code_t.DRILL_M_TOOL_DOWN, m_asParams: 0 }, // tool down (starting a routed hole)
  { m_Name: 'M16', m_Code: drill_M_code_t.DRILL_M_TOOL_UP, m_asParams: 0 }, // tool up (ending a routed hole)
  { m_Name: 'M17', m_Code: drill_M_code_t.DRILL_M_TOOL_UP, m_asParams: 0 }, // tool up similar to M16 for a viewer
  { m_Name: 'M30', m_Code: drill_M_code_t.DRILL_M_ENDFILE, m_asParams: -1 }, // End of File (last line of NC drill)
  { m_Name: 'M47', m_Code: drill_M_code_t.DRILL_M_MESSAGE, m_asParams: -1 }, // Operator Message
  { m_Name: 'M45', m_Code: drill_M_code_t.DRILL_M_LONGMESSAGE, m_asParams: -1 }, // Long Operator message (use more than one line)
  { m_Name: 'M48', m_Code: drill_M_code_t.DRILL_M_HEADER, m_asParams: 0 }, // beginning of a header
  { m_Name: 'M95', m_Code: drill_M_code_t.DRILL_M_ENDHEADER, m_asParams: 0 }, // End of the header
  { m_Name: 'METRIC', m_Code: drill_M_code_t.DRILL_METRIC_HEADER, m_asParams: 1 },
  { m_Name: 'INCH', m_Code: drill_M_code_t.DRILL_IMPERIAL_HEADER, m_asParams: 1 },
  { m_Name: 'M71', m_Code: drill_M_code_t.DRILL_M_METRIC, m_asParams: 1 },
  { m_Name: 'M72', m_Code: drill_M_code_t.DRILL_M_IMPERIAL, m_asParams: 1 },
  { m_Name: 'M25', m_Code: drill_M_code_t.DRILL_M_BEGINPATTERN, m_asParams: 0 }, // Beginning of Pattern
  { m_Name: 'M01', m_Code: drill_M_code_t.DRILL_M_ENDPATTERN, m_asParams: 0 }, // End of Pattern
  { m_Name: 'M97', m_Code: drill_M_code_t.DRILL_M_CANNEDTEXT, m_asParams: -1 },
  { m_Name: 'M98', m_Code: drill_M_code_t.DRILL_M_CANNEDTEXT, m_asParams: -1 },
  { m_Name: 'DETECT', m_Code: drill_M_code_t.DRILL_DETECT_BROKEN, m_asParams: -1 },
  { m_Name: 'ICI', m_Code: drill_M_code_t.DRILL_INCREMENTALHEADER, m_asParams: 1 },
  { m_Name: 'FMAT', m_Code: drill_M_code_t.DRILL_FMT, m_asParams: 1 }, // Use Format command
  { m_Name: ';FILE_FORMAT', m_Code: drill_M_code_t.DRILL_FORMAT_ALTIUM, m_asParams: 1 }, // Use Format command
  { m_Name: ';', m_Code: drill_M_code_t.DRILL_HEADER_SKIP, m_asParams: 0 }, // Other ; hints that we don't implement
  { m_Name: 'ATC', m_Code: drill_M_code_t.DRILL_AUTOMATIC_TOOL_CHANGE, m_asParams: 0 },
  { m_Name: 'TCST', m_Code: drill_M_code_t.DRILL_TOOL_CHANGE_STOP, m_asParams: 0 }, // Tool Change Stop
  { m_Name: 'AFS', m_Code: drill_M_code_t.DRILL_AUTOMATIC_SPEED, m_asParams: 0 }, // Automatic Feeds and Speeds
  { m_Name: 'VER', m_Code: drill_M_code_t.DRILL_AXIS_VERSION, m_asParams: 1 }, // Selection of X and Y Axis Version
  { m_Name: 'R', m_Code: drill_M_code_t.DRILL_RESET_CMD, m_asParams: -1 }, // Reset commands
  { m_Name: '%', m_Code: drill_M_code_t.DRILL_REWIND_STOP, m_asParams: -1 }, // Rewind stop. End of the header
  { m_Name: '/', m_Code: drill_M_code_t.DRILL_SKIP, m_asParams: -1 }, // Clear Tool Linking. End of the header
  // Keep this item after all commands starting by 'T':
  { m_Name: 'T', m_Code: drill_M_code_t.DRILL_TOOL_INFORMATION, m_asParams: 0 }, // Tool Information
  { m_Name: '', m_Code: drill_M_code_t.DRILL_M_UNKNOWN, m_asParams: 0 }, // last item in list
];

/** `excellon_G_CmdList`. [data] */
const excellon_G_CmdList: readonly EXCELLON_CMD[] = [
  { m_Name: 'G90', m_Code: drill_G_code_t.DRILL_G_ABSOLUTE, m_asParams: 0 }, // Absolute Mode
  { m_Name: 'G91', m_Code: drill_G_code_t.DRILL_G_INCREMENTAL, m_asParams: 0 }, // Incremental Input Mode
  { m_Name: 'G90', m_Code: drill_G_code_t.DRILL_G_ZEROSET, m_asParams: 0 }, // Absolute Mode
  { m_Name: 'G00', m_Code: drill_G_code_t.DRILL_G_ROUT, m_asParams: 1 }, // Route Mode
  { m_Name: 'G05', m_Code: drill_G_code_t.DRILL_G_DRILL, m_asParams: 0 }, // Drill Mode
  { m_Name: 'G85', m_Code: drill_G_code_t.DRILL_G_SLOT, m_asParams: 0 }, // Canned Mode slot (oval holes)
  { m_Name: 'G01', m_Code: drill_G_code_t.DRILL_G_LINEARMOVE, m_asParams: 1 }, // Linear (Straight Line) routing Mode
  { m_Name: 'G02', m_Code: drill_G_code_t.DRILL_G_CWMOVE, m_asParams: 1 }, // Circular CW Mode
  { m_Name: 'G03', m_Code: drill_G_code_t.DRILL_G_CCWMOVE, m_asParams: 1 }, // Circular CCW Mode
  { m_Name: 'G93', m_Code: drill_G_code_t.DRILL_G_ZERO_SET, m_asParams: 1 }, // Zero Set (XnnYmm and coordinates origin)
  { m_Name: '', m_Code: drill_G_code_t.DRILL_G_UNKNOWN, m_asParams: 0 }, // last item in list
];

/** `std::string::compare( 0, len, text, len ) == 0`: the name starts the text. */
const startsWith = (text: CHAR_PTR, name: string): boolean =>
  text.buf.s.slice(text.i, text.i + name.length) === name;

/**
 * `computeCenter`: the centre of an arc known by its two ends, its radius and
 * its direction. "Arc angles are <= 180 degrees in circular interpol."
 * `aRadius` is adjusted (returned in `.radius`) when it is too small.
 */
function computeCenter(
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aRadius: { value: number },
  aRotCCW: boolean,
): VECTOR2I {
  const center: VECTOR2I = { x: 0, y: 0 };
  const end = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };

  // Be sure aRadius/2 > dist between aStart and aEnd
  const min_radius = Math.hypot(end.x, end.y) * 2;

  if (min_radius <= aRadius.value) {
    // Adjust the radius and the arc center for a 180 deg arc between end points
    aRadius.value = KiROUND(min_radius);
    center.x = Math.trunc((aStart.x + aEnd.x + 1) / 2);
    center.y = Math.trunc((aStart.y + aEnd.y + 1) / 2);
    return center;
  }

  /* to compute the centers position easily:
   * rotate the segment (0,0 to end.x,end.y) to make it horizontal (end.y = 0).
   * the X center position is end.x/2
   * the Y center positions are on the vertical line starting at end.x/2, 0
   * and solve aRadius^2 = X^2 + Y^2  (2 values)
   */
  const seg_angle = EDA_ANGLE.fromVector(end);
  const h_segm = RotatePointD(end, seg_angle);
  const cX = h_segm.x / 2;
  const cY1 = Math.sqrt(aRadius.value * aRadius.value - cX * cX);
  const cY2 = -cY1;
  const center1 = RotatePointD({ x: cX, y: cY1 }, seg_angle.negate());
  let arc_angle1 = EDA_ANGLE.fromVector({ x: end.x - center1.x, y: end.y - center1.y }).sub(
    EDA_ANGLE.fromVector({ x: 0.0 - center1.x, y: 0.0 - center1.y }),
  );
  const center2 = RotatePointD({ x: cX, y: cY2 }, seg_angle.negate());
  let arc_angle2 = EDA_ANGLE.fromVector({ x: end.x - center2.x, y: end.y - center2.y }).sub(
    EDA_ANGLE.fromVector({ x: 0.0 - center2.x, y: 0.0 - center2.y }),
  );

  if (!aRotCCW) {
    if (arc_angle1.lt(ANGLE_0)) arc_angle1 = arc_angle1.add(ANGLE_360);

    if (arc_angle2.lt(ANGLE_0)) arc_angle2 = arc_angle2.add(ANGLE_360);
  } else {
    if (arc_angle1.gt(ANGLE_0)) arc_angle1 = arc_angle1.sub(ANGLE_360);

    if (arc_angle2.gt(ANGLE_0)) arc_angle2 = arc_angle2.sub(ANGLE_360);
  }

  // Arc angle must be <= 180.0 degrees.
  // So choose the center that create a arc angle <= 180.0
  if (arc_angle1.abs().le(ANGLE_180)) {
    center.x = KiROUND(center1.x);
    center.y = KiROUND(center1.y);
  } else {
    center.x = KiROUND(center2.x);
    center.y = KiROUND(center2.y);
  }

  return { x: center.x + aStart.x, y: center.y + aStart.y };
}

/** `EXCELLON_STATE`. */
enum EXCELLON_STATE {
  /** When we are in this state, we are reading header */
  READ_HEADER_STATE,
  /** When we are in this state, we are reading drill data */
  READ_PROGRAM_STATE,
}

/** `EXCELLON_IMAGE`: a drill image, a GERBER_FILE_IMAGE whose D codes are T codes. */
export class EXCELLON_IMAGE extends GERBER_FILE_IMAGE {
  /** State of excellon file analysis. */
  private m_State: EXCELLON_STATE = EXCELLON_STATE.READ_HEADER_STATE;
  /** true during an oblong drill definition by G85 (canned slot) command. */
  private m_SlotOn = false;
  /** true during a route mode (for instance a oval hole) or a cutout. */
  private m_RouteModeOn = false;
  /** The list of points in a route mode. */
  private m_RoutePositions: EXCELLON_ROUTE_COORD[] = [];
  /**
   * Excellon files do not state the coordinate format; Altium files have a
   * comment for it (";FILE_FORMAT="), and this is true once it is found.
   */
  private m_hasFormat = false;

  constructor(layer: number) {
    super(layer);
    this.m_State = EXCELLON_STATE.READ_HEADER_STATE;
    this.m_SlotOn = false;
    this.m_RouteModeOn = false;
    this.m_hasFormat = false;
  }

  /** Set all parameters to a default value, before reading a file. */
  override ResetDefaultValues(): void {
    super.ResetDefaultValues();
    this.SelectUnits(false, null); // Default unit = inch
    this.m_hasFormat = false; // will be true if a Altium file containing
    // the nn:mm file format is read

    // Files using non decimal can use No Trailing zeros or No leading Zeros
    // Unfortunately, the identifier (INCH,TZ or INCH,LZ for instance) is not
    // always set in drill files.
    // The option leading zeros looks like more frequent, so use this default
    this.m_NoTrailingZeros = true;
  }

  /**
   * "Original function derived from drill_file_p() of gerbv 2.7.0": a
   * heuristics-based check of whether the text is an Excellon drill file.
   *
   * Two things are ported as they stand, surprising as they are:
   *
   * **`foundPercent` can never become true.** `%` counts only when a `\r` or
   * `\n` follows it, but the line has been through `StrPurge`, which strips
   * exactly those. So `foundM30`, gated on it, is dead too, and so is the
   * "pathological case" return; and a drill file with no holes at all (a real
   * header and tool list, no coordinates) is refused, as GerbView refuses it.
   *
   * **The `T` branch's `foundT = false`** can only run when it already is.
   */
  static TestFileIsExcellon(aFileText: string): boolean {
    let foundM48 = false;
    let foundM30 = false;
    let foundPercent = false;
    let foundT = false;
    let foundX = false;
    let foundY = false;

    const reader = new FILE(aFileText);
    const buf = new LINE_BUFFER();

    while (reader.fgets(buf, Number.MAX_SAFE_INTEGER) !== null) {
      // Remove all whitespace from the beginning and end
      let line = StrPurge(new CHAR_PTR(buf)).rest();

      // Skip empty lines
      if (line.length === 0) continue;

      // Check that file is not binary (non-printing chars)
      for (let i = 0; i < line.length; i++) {
        if (line.charCodeAt(i) > 127) return false; // !isascii( line[i] )
      }

      // We don't want to look for any commands after a comment so
      // just end the line early if we find a comment
      const semi = line.indexOf(';');
      if (semi !== -1) line = line.slice(0, semi);

      // Check for M48 = start of drill header
      if (line.includes('M48')) foundM48 = true;

      // Check for M30 = end of drill program
      if (line.includes('M30')) if (foundPercent) foundM30 = true; // Found M30 after % = good

      // Check for % on its own line at end of header
      let letter = line.indexOf('%');
      if (letter !== -1) {
        const next = line[letter + 1] ?? NUL;
        if (next === '\r' || next === '\n') foundPercent = true;
      }

      // Check for T<number>
      letter = line.indexOf('T');
      if (letter !== -1) {
        if (!foundT && (foundX || foundY)) foundT = false; /* Found first T after X or Y */
        else if (ToCDoubleOk(line.slice(letter + 1))) foundT = true;
      }

      // look for X<number> or Y<number>
      letter = line.indexOf('X');
      if (letter !== -1) {
        if (ToCDoubleOk(line.slice(letter + 1))) foundX = true;
      }

      letter = line.indexOf('Y');
      if (letter !== -1) {
        if (ToCDoubleOk(line.slice(letter + 1))) foundY = true;
      }
    }

    /* Now form logical expression determining if this is a drill file */
    if ((foundX || foundY) && foundT && (foundM48 || (foundPercent && foundM30))) return true;
    if (foundM48 && foundT && foundPercent && foundM30)
      /* Pathological case of drill file with valid header
         and EOF but no drill XY locations. */
      return true;

    return false;
  }

  /**
   * Read and load a drill (EXCELLON format) file. When the file cannot be
   * loaded, warning and info messages are stored in m_Messages.
   *
   * @param aDefaults the values used when not found in the file.
   * @param aFileText the file's contents; null for a file that cannot be
   *        opened.
   */
  LoadFile(aFullFileName: string, aDefaults: EXCELLON_DEFAULTS, aFileText: string | null): boolean {
    // Set the default parameter values:
    this.ResetDefaultValues();
    this.ClearMessageList();

    if (aFileText === null) return false;

    this.m_Current_File = new FILE(aFileText);

    // Initial format setting, usualy defined in file, but not always...
    this.m_NoTrailingZeros = aDefaults.m_LeadingZero;
    this.m_GerbMetric = aDefaults.m_UnitsMM;

    this.m_FileName = aFullFileName;

    // FILE_LINE_READER will close the file.
    const excellonReader = this.m_Current_File;
    const line = new LINE_BUFFER();

    while (true) {
      if (excellonReader.fgets(line, Number.MAX_SAFE_INTEGER) === null) break;

      const text = StrPurge(new CHAR_PTR(line));

      if (text.c() === NUL) continue; // Skip empty lines

      if (this.m_State === EXCELLON_STATE.READ_HEADER_STATE) {
        this.Execute_HEADER_And_M_Command(text);

        // Now units (inch/mm) are known, set the coordinate format
        this.SelectUnits(this.m_GerbMetric, aDefaults);
      } else {
        switch (text.c()) {
          case ';':
          case 'M':
            this.Execute_HEADER_And_M_Command(text);
            break;

          case 'G': // Line type Gxx : command
            this.Execute_EXCELLON_G_Command(text);
            break;

          case 'R': // Repeat hole command R#(X#Y#)
            this.Execute_Repeat_Command(text);
            break;

          case 'X':
          case 'Y': // command like X12550Y19250
            this.Execute_Drill_Command(text);
            break;

          case 'I':
          case 'J' /* Auxiliary Move command */:
            this.m_IJPos = this.ReadIJCoord(text);
            if (text.c() === '*') {
              // command like X35142Y15945J504
              this.Execute_Drill_Command(text);
            }
            break;

          case 'T': // Select Tool command (can also create
            // the tool with an embedded definition)
            this.Select_Tool(text);
            break;

          case '%':
            break;

          default: {
            const ch = text.c();
            const hex = (ch.charCodeAt(0) & 0xff).toString(16).toUpperCase().padStart(2, '0');
            this.AddMessageToList(`Unexpected symbol 0x${hex} &lt;${ch}&gt;`);
            break;
          }
        } // End switch
      }
    }

    // Add our file attribute, to identify the drill file
    const dummy = new X2_ATTRIBUTE();
    const attrLine = new LINE_BUFFER();
    attrLine.s = file_attribute;
    dummy.ParseAttribCmd(null, null, 0, new CHAR_PTR(attrLine), { value: 0 });
    this.m_FileFunction = new X2_ATTRIBUTE_FILEFUNCTION(dummy);

    this.m_InUse = true;

    return true;
  }

  private Execute_HEADER_And_M_Command(text: CHAR_PTR): boolean {
    let cmd: EXCELLON_CMD | null = null;

    // Search command in list
    for (let ii = 0; ; ii++) {
      const candidate = excellonHeaderCmdList[ii] as EXCELLON_CMD;
      const len = candidate.m_Name.length;

      if (len === 0) break; // End of list reached

      if (startsWith(text, candidate.m_Name)) {
        // found.
        cmd = candidate;
        text.inc(len);
        break;
      }
    }

    if (!cmd) {
      this.AddMessageToList(`Unknown Excellon command &lt;${text.rest()}&gt;`);
      while (text.c() !== NUL) text.inc();

      return false;
    }

    // Execute command
    // some do nothing
    switch (cmd.m_Code) {
      case drill_M_code_t.DRILL_SKIP:
      case drill_M_code_t.DRILL_M_UNKNOWN:
        break;

      case drill_M_code_t.DRILL_M_END:
      case drill_M_code_t.DRILL_M_ENDFILE:
        // if a route command is in progress, finish it
        if (this.m_RouteModeOn) this.FinishRouteCommand();

        break;

      case drill_M_code_t.DRILL_M_MESSAGE:
        break;

      case drill_M_code_t.DRILL_M_LONGMESSAGE:
        break;

      case drill_M_code_t.DRILL_M_HEADER:
        this.m_State = EXCELLON_STATE.READ_HEADER_STATE;
        break;

      case drill_M_code_t.DRILL_M_ENDHEADER:
        this.m_State = EXCELLON_STATE.READ_PROGRAM_STATE;
        break;

      case drill_M_code_t.DRILL_REWIND_STOP: // End of header. No action in a viewer
        this.m_State = EXCELLON_STATE.READ_PROGRAM_STATE;
        break;

      case drill_M_code_t.DRILL_FORMAT_ALTIUM:
        this.readFileFormat(text);
        break;

      case drill_M_code_t.DRILL_HEADER_SKIP:
        break;

      case drill_M_code_t.DRILL_M_METRIC:
        this.SelectUnits(true, null);
        break;

      case drill_M_code_t.DRILL_IMPERIAL_HEADER: // command like INCH,TZ or INCH,LZ
      case drill_M_code_t.DRILL_METRIC_HEADER: // command like METRIC,TZ or METRIC,LZ
        this.SelectUnits(cmd.m_Code === drill_M_code_t.DRILL_METRIC_HEADER, null);

        if (text.c() !== ',') {
          // No TZ or LZ specified. Should be a decimal format
          // but this is not always the case. Use our default setting
          break;
        }

        text.inc(); // skip separator
        if (text.c() === 'T') this.m_NoTrailingZeros = false;
        else this.m_NoTrailingZeros = true;
        break;

      case drill_M_code_t.DRILL_M_BEGINPATTERN:
        break;

      case drill_M_code_t.DRILL_M_ENDPATTERN:
        break;

      case drill_M_code_t.DRILL_M_CANNEDTEXT:
        break;

      case drill_M_code_t.DRILL_M_TIPCHECK:
        break;

      case drill_M_code_t.DRILL_DETECT_BROKEN:
        break;

      case drill_M_code_t.DRILL_INCREMENTALHEADER:
        if (text.c() !== ',') {
          this.AddMessageToList('ICI command has no parameter');
          break;
        }
        text.inc(); // skip separator
        // Parameter should be ON or OFF
        if (strncasecmp0(text, 'OFF', 3)) this.m_Relative = false;
        else if (strncasecmp0(text, 'ON', 2)) this.m_Relative = true;
        else this.AddMessageToList('ICI command has incorrect parameter');
        break;

      case drill_M_code_t.DRILL_TOOL_CHANGE_STOP:
        break;

      case drill_M_code_t.DRILL_AUTOMATIC_SPEED:
        break;

      case drill_M_code_t.DRILL_AXIS_VERSION:
        break;

      case drill_M_code_t.DRILL_RESET_CMD:
        break;

      case drill_M_code_t.DRILL_AUTOMATIC_TOOL_CHANGE:
        break;

      case drill_M_code_t.DRILL_FMT:
        break;

      case drill_M_code_t.DRILL_TOOL_INFORMATION:
        this.readToolInformation(text);
        break;

      case drill_M_code_t.DRILL_M_TOOL_DOWN: // tool down (starting a routed hole or polyline)
        // Only the last position is useful:
        if (this.m_RoutePositions.length > 1)
          this.m_RoutePositions.splice(0, this.m_RoutePositions.length - 1);

        break;

      case drill_M_code_t.DRILL_M_TOOL_UP: // tool up (ending a routed polyline)
        this.FinishRouteCommand();
        break;
    }

    while (text.c() !== NUL) text.inc();

    return true;
  }

  /**
   * Read an Altium-specific `;FILE_FORMAT=X:X` that specifies the length and
   * mantissa of the numbers in the file. "Parse the rest strictly as
   * single_digit:single_digit like 4:4 or 2:4."
   */
  private readFileFormat(aText: CHAR_PTR): void {
    let mantissaDigits = 0;
    let characteristicDigits = 0;

    // Example String: ;FILE_FORMAT=4:4
    // The ;FILE_FORMAT potion will already be stripped off.
    // Parse the rest strictly as single_digit:single_digit like 4:4 or 2:4
    // Don't allow anything clever like spaces or multiple digits
    if (aText.c() !== '=') return;

    aText.inc();

    if (!isdigit(aText.c())) return;

    characteristicDigits = aText.c().charCodeAt(0) - 48;
    aText.inc();

    if (aText.c() !== ':') return;

    aText.inc();

    if (!isdigit(aText.c())) return;

    mantissaDigits = aText.c().charCodeAt(0) - 48;

    this.m_hasFormat = true;
    this.m_FmtLen = {
      x: characteristicDigits + mantissaDigits,
      y: characteristicDigits + mantissaDigits,
    };
    this.m_FmtScale = { x: mantissaDigits, y: mantissaDigits };
  }

  /**
   * Read a tool definition like T1C0.02 or T1F00S00C0.02 or T1C0.02F00S00 and
   * enter params in the TCODE list (the D_CODE list).
   */
  private readToolInformation(aText: CHAR_PTR): boolean {
    // Read a tool definition like T1C0.02 or T1F00S00C0.02 or T1C0.02F00S00
    // and enter the TCODE param in list (using the D_CODE param management, which
    // is similar to TCODE params.
    if (aText.c() === 'T')
      // This is the beginning of the definition
      aText.inc();

    // Read tool number:
    const iprm = ReadInt(aText, false);

    // Skip Feed rate and Spindle speed, if any here
    while (aText.c() !== NUL && (aText.c() === 'F' || aText.c() === 'S')) {
      aText.inc();
      ReadInt(aText, false);
    }

    // Read tool shape
    if (aText.c() === NUL) this.AddMessageToList('Tool definition shape not found');
    else if (aText.c() !== 'C')
      this.AddMessageToList(`Tool definition '${aText.c()}' not supported`);
    if (aText.c() !== NUL) aText.inc();

    //read tool diameter:
    const dprm = ReadDouble(aText, false);
    this.m_Has_DCode = true;

    // Initialize Dcode to handle this Tool
    // Remember: dcodes are >= FIRST_DCODE
    const dcode = this.GetDCODEOrCreate(iprm + FIRST_DCODE);

    if (dcode === null) return false;

    // conv_scale = scaling factor from inch to Internal Unit
    let conv_scale = gerbIUScale.IU_PER_MILS * 1000;

    if (this.m_GerbMetric) conv_scale /= 25.4;

    const size = KiROUND(dprm * conv_scale);
    dcode.m_Size = { x: size, y: size };
    dcode.m_ApertType = APERTURE_T.APT_CIRCLE;
    dcode.m_Defined = true;

    return true;
  }

  private Execute_Drill_Command(text: CHAR_PTR): boolean {
    let tool: D_CODE | null;
    let gbritem: GERBER_DRAW_ITEM;

    while (true) {
      switch (text.c()) {
        case 'X':
        case 'Y':
          this.ReadXYCoord(text, true);

          if (text.c() === 'I' || text.c() === 'J') this.ReadIJCoord(text);

          break;

        case 'G': // G85 is found here for oval holes
          this.m_PreviousPos = { ...this.m_CurrentPos };
          this.Execute_EXCELLON_G_Command(text);
          break;

        case NUL: {
          // E.O.L: execute command
          if (this.m_RouteModeOn) {
            // We are in routing mode, and this is an intermediate point.
            // So just store it
            let rmode = 0; // linear routing.

            if (this.m_Iterpolation === Gerb_Interpolation.GERB_INTERPOL_ARC_NEG) rmode = ROUTE_CW;
            else if (this.m_Iterpolation === Gerb_Interpolation.GERB_INTERPOL_ARC_POS)
              rmode = ROUTE_CCW;

            if (this.m_LastArcDataType === LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER) {
              this.m_RoutePositions.push(
                new EXCELLON_ROUTE_COORD(this.m_CurrentPos, { ...this.m_IJPos }, rmode),
              );
            } else {
              this.m_RoutePositions.push(
                new EXCELLON_ROUTE_COORD(this.m_CurrentPos, this.m_ArcRadius, rmode),
              );
            }
            return true;
          }

          tool = this.GetDCODE(this.m_Current_Tool);
          if (!tool) {
            this.AddMessageToList(`Tool ${this.m_Current_Tool} not defined`);
            return false;
          }

          gbritem = new GERBER_DRAW_ITEM(this);
          this.AddItemToList(gbritem);

          if (this.m_SlotOn) {
            // Oblong hole
            fillLineGBRITEM(
              gbritem,
              tool.m_Num_Dcode,
              this.m_PreviousPos,
              this.m_CurrentPos,
              tool.m_Size,
              false,
            );
            // the hole is made: reset the slot on command (G85)
            // (it is needed for each oblong hole)
            this.m_SlotOn = false;
          } else {
            fillFlashedGBRITEM(
              gbritem,
              tool.m_ApertType,
              tool.m_Num_Dcode,
              this.m_CurrentPos,
              tool.m_Size,
              false,
            );
          }

          this.StepAndRepeatItem(gbritem);
          this.m_PreviousPos = { ...this.m_CurrentPos };
          return true;
        }

        default:
          text.inc();
          break;
      }
    }
  }

  /**
   * Excellon repeat hole command R#(X#Y#): repeat the last hole # times,
   * adding the given incremental X and Y step each time, with the current tool.
   */
  private Execute_Repeat_Command(text: CHAR_PTR): boolean {
    const count = this.CodeNumber(text); // reads the count, advances past R and the digits

    if (count <= 0) return false;

    const startPos = { ...this.m_CurrentPos };
    const saveRelative = this.m_Relative;

    this.m_Relative = true;
    const read = this.ReadXYCoord(text, true);
    const step = { x: read.x - startPos.x, y: read.y - startPos.y };
    this.m_Relative = saveRelative;
    this.m_CurrentPos = { ...startPos };

    const tool = this.GetDCODE(this.m_Current_Tool);

    if (!tool) {
      this.AddMessageToList(`Tool ${this.m_Current_Tool} not defined`);
      return false;
    }

    for (let ii = 0; ii < count; ++ii) {
      this.m_CurrentPos = {
        x: this.m_CurrentPos.x + step.x,
        y: this.m_CurrentPos.y + step.y,
      };

      const gbritem = new GERBER_DRAW_ITEM(this);
      this.AddItemToList(gbritem);
      fillFlashedGBRITEM(
        gbritem,
        tool.m_ApertType,
        tool.m_Num_Dcode,
        this.m_CurrentPos,
        tool.m_Size,
        false,
      );
      this.StepAndRepeatItem(gbritem);
    }

    this.m_PreviousPos = { ...this.m_CurrentPos };
    return true;
  }

  /**
   * Select the tool from the command line Tn. "Because some drill file have
   * an embedded TCODE definition (like T1C.008F0S0) in tool selection command,
   * if the tool is not defined in list, and the definition is embedded, it
   * will be entered in list."
   */
  private Select_Tool(text: CHAR_PTR): boolean {
    const startline = text.clone(); // the tool id starts here.
    const tool_id = this.CodeNumber(text);

    // T0 is legal, but is not a selection tool. it is a special command
    if (tool_id >= 0) {
      let dcode_id = tool_id + FIRST_DCODE; // Remember: dcodes are >= FIRST_DCODE

      if (!D_CODE.IsValidDcodeValue(dcode_id)) dcode_id = LAST_DCODE;

      this.m_Current_Tool = dcode_id;
      let currDcode = this.GetDCODE(dcode_id);

      // if the tool does not exist, and the definition is embedded, create this tool
      if (currDcode === null && tool_id > 0) {
        text.i = startline.i; // text starts at the beginning of the command
        this.readToolInformation(text);
        currDcode = this.GetDCODE(dcode_id);
      }

      // If the Tool is still not existing, create a dummy tool
      if (!currDcode) currDcode = this.GetDCODEOrCreate(dcode_id, true);

      if (currDcode) currDcode.m_InUse = true;
    }

    while (text.c() !== NUL) text.inc();

    return tool_id >= 0;
  }

  private Execute_EXCELLON_G_Command(text: CHAR_PTR): boolean {
    let cmd: EXCELLON_CMD | null = null;
    let success = false;
    let id: number = drill_G_code_t.DRILL_G_UNKNOWN;

    // Search command in list
    const gcmd = text.rest(); // gcmd points the G command, for error messages.

    for (let ii = 0; ; ii++) {
      const candidate = excellon_G_CmdList[ii] as EXCELLON_CMD;
      const len = candidate.m_Name.length;
      if (len === 0) break; // End of list reached
      if (startsWith(text, candidate.m_Name)) {
        // found.
        cmd = candidate;
        text.inc(len);
        success = true;
        id = cmd.m_Code;
        break;
      }
    }

    switch (id) {
      case drill_G_code_t.DRILL_G_ZERO_SET:
        this.ReadXYCoord(text, true);
        this.m_Offset = { ...this.m_CurrentPos };
        break;

      case drill_G_code_t.DRILL_G_ROUT:
        this.m_SlotOn = false;

        if (this.m_RouteModeOn) this.FinishRouteCommand();

        this.m_RouteModeOn = true;
        this.m_RoutePositions = [];
        this.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
        this.ReadXYCoord(text, true);
        // This is the first point (starting point) of routing
        this.m_RoutePositions.push(new EXCELLON_ROUTE_COORD(this.m_CurrentPos));
        break;

      case drill_G_code_t.DRILL_G_DRILL:
        this.m_SlotOn = false;

        if (this.m_RouteModeOn) this.FinishRouteCommand();

        this.m_RouteModeOn = false;
        this.m_RoutePositions = [];
        this.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
        break;

      case drill_G_code_t.DRILL_G_SLOT:
        this.m_SlotOn = true;
        break;

      case drill_G_code_t.DRILL_G_LINEARMOVE:
        this.m_LastArcDataType = LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_NONE;
        this.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X;
        this.ReadXYCoord(text, true);
        this.m_RoutePositions.push(new EXCELLON_ROUTE_COORD(this.m_CurrentPos));
        break;

      case drill_G_code_t.DRILL_G_CWMOVE:
        this.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_ARC_NEG;
        this.ReadXYCoord(text, true);

        if (text.c() === 'I' || text.c() === 'J') this.ReadIJCoord(text);

        if (this.m_LastArcDataType === LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER)
          this.m_RoutePositions.push(
            new EXCELLON_ROUTE_COORD(this.m_CurrentPos, { ...this.m_IJPos }, ROUTE_CW),
          );
        else
          this.m_RoutePositions.push(
            new EXCELLON_ROUTE_COORD(this.m_CurrentPos, this.m_ArcRadius, ROUTE_CW),
          );

        break;

      case drill_G_code_t.DRILL_G_CCWMOVE:
        this.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_ARC_POS;
        this.ReadXYCoord(text, true);

        if (text.c() === 'I' || text.c() === 'J') this.ReadIJCoord(text);

        if (this.m_LastArcDataType === LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER)
          this.m_RoutePositions.push(
            new EXCELLON_ROUTE_COORD(this.m_CurrentPos, { ...this.m_IJPos }, ROUTE_CCW),
          );
        else
          this.m_RoutePositions.push(
            new EXCELLON_ROUTE_COORD(this.m_CurrentPos, this.m_ArcRadius, ROUTE_CCW),
          );

        break;

      case drill_G_code_t.DRILL_G_ABSOLUTE:
        this.m_Relative = false; // false = absolute coord
        break;

      case drill_G_code_t.DRILL_G_INCREMENTAL:
        this.m_Relative = true; // true = relative coord
        break;

      default:
        // DRILL_G_UNKNOWN
        this.AddMessageToList(`Unknown Excellon G Code: &lt;${gcmd}&gt;`);

        while (text.c() !== NUL) text.inc();

        return false;
    }

    return success;
  }

  /** Switch unit selection, and the coordinate format (nn:mm) if not yet set. */
  private SelectUnits(aMetric: boolean, aDefaults: EXCELLON_DEFAULTS | null): void {
    /* Inches: Default fmt = 2.4 for X and Y axis: 6 digits with  0.0001 resolution
     * metric: Default fmt = 3.3 for X and Y axis: 6 digits, 1 micron resolution
     * However some drill files do not use standard values. */
    if (aMetric) {
      this.m_GerbMetric = true;

      if (!this.m_hasFormat) {
        if (aDefaults) {
          // number of digits in mantissa
          this.m_FmtScale = { x: aDefaults.m_MmMantissaLen, y: aDefaults.m_MmMantissaLen };
          // number of digits (mantissa+integer)
          const len = aDefaults.m_MmIntegerLen + aDefaults.m_MmMantissaLen;
          this.m_FmtLen = { x: len, y: len };
        } else {
          this.m_FmtScale = { x: FMT_MANTISSA_MM, y: FMT_MANTISSA_MM };
          const len = FMT_INTEGER_MM + FMT_MANTISSA_MM;
          this.m_FmtLen = { x: len, y: len };
        }
      }
    } else {
      this.m_GerbMetric = false;

      if (!this.m_hasFormat) {
        if (aDefaults) {
          this.m_FmtScale = { x: aDefaults.m_InchMantissaLen, y: aDefaults.m_InchMantissaLen };
          const len = aDefaults.m_InchIntegerLen + aDefaults.m_InchMantissaLen;
          this.m_FmtLen = { x: len, y: len };
        } else {
          this.m_FmtScale = { x: FMT_MANTISSA_INCH, y: FMT_MANTISSA_INCH };
          const len = FMT_INTEGER_INCH + FMT_MANTISSA_INCH;
          this.m_FmtLen = { x: len, y: len };
        }
      }
    }
  }

  /**
   * End a route command started by M15 or G01, G02 or G03; nothing when no
   * route is in progress.
   */
  private FinishRouteCommand(): void {
    if (!this.m_RouteModeOn) return;

    const tool = this.GetDCODE(this.m_Current_Tool);

    if (!tool) {
      this.AddMessageToList(`Unknown tool code ${this.m_Current_Tool}`);
      return;
    }

    for (let ii = 1; ii < this.m_RoutePositions.length; ii++) {
      const gbritem = new GERBER_DRAW_ITEM(this);
      const prev = this.m_RoutePositions[ii - 1] as EXCELLON_ROUTE_COORD;
      const curr = this.m_RoutePositions[ii] as EXCELLON_ROUTE_COORD;

      if (curr.m_rmode === 0) {
        // linear routing
        fillLineGBRITEM(
          gbritem,
          tool.m_Num_Dcode,
          prev.GetPos(),
          curr.GetPos(),
          tool.m_Size,
          false,
        );
      } else {
        // circular (cw or ccw) routing
        const rot_ccw = curr.m_rmode === ROUTE_CW;
        const radius = { value: curr.m_radius }; // Can be adjusted by computeCenter.
        let center: VECTOR2I;

        if (curr.m_arc_type_info === LAST_EXTRA_ARC_DATA_TYPE.ARC_INFO_TYPE_CENTER)
          center = { x: curr.m_cx, y: curr.m_cy };
        else center = computeCenter(prev.GetPos(), curr.GetPos(), radius, rot_ccw);

        const start = prev.GetPos();
        fillArcGBRITEM(
          gbritem,
          tool.m_Num_Dcode,
          start,
          curr.GetPos(),
          { x: center.x - start.x, y: center.y - start.y },
          tool.m_Size,
          !rot_ccw,
          true,
          false,
        );
      }

      this.AddItemToList(gbritem);

      this.StepAndRepeatItem(gbritem);
    }

    this.m_RoutePositions = [];
    this.m_RouteModeOn = false;
  }
}

/**
 * `GERBVIEW_FRAME::Read_EXCELLON_File` (excellon_read_drill_file.cpp:248-303):
 * read a drill file into the active layer, replacing what it held, with the
 * frame's Excellon defaults, and add its items to the view. Bound on the
 * frame (`gerbview_frame.ts`).
 */
export async function Read_EXCELLON_File(
  this: GERBVIEW_FRAME,
  aFullFileName: string,
): Promise<boolean> {
  let msg: string;
  let layerId = this.GetActiveLayer(); // current layer used in GerbView
  const images = this.GetGerberLayout().GetImagesList();
  const gerber_layer = images.GetGbrImage(layerId);

  // If the active layer contains old gerber or nc drill data, remove it
  if (gerber_layer) await this.Erase_Current_DrawLayer(false);

  const drill_layer_uptr = new EXCELLON_IMAGE(layerId);

  const nc_defaults = new EXCELLON_DEFAULTS();
  const cfg = this.config();
  cfg.GetExcellonDefaults(nc_defaults);

  // Read the Excellon drill file:
  const success = drill_layer_uptr.LoadFile(
    aFullFileName,
    nc_defaults,
    ReadFileText(aFullFileName),
  );

  if (!success) {
    msg = `File ${aFullFileName} not found.`;
    this.Host().InfoBarError(msg);
    return false;
  }

  const drill_layer = drill_layer_uptr;

  layerId = images.AddGbrImage(drill_layer, layerId);

  if (layerId < 0) {
    this.Host().InfoBarError('No empty layers to load file into.');
    return false;
  }

  // Display errors list
  if (drill_layer.GetMessages().length > 0)
    await this.Host().HtmlMessageBox(
      'Error reading EXCELLON drill file',
      drill_layer.GetMessages().join('\n'),
    );

  const canvas = this.GetCanvas();

  if (canvas) {
    for (const item of drill_layer.GetItems()) canvas.GetView().Add(item);
  }

  return success;
}
