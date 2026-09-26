// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/rs274x.cpp`: the RS274X extended commands, the `%…%` blocks —
 * format (FS), units (MO), axes and image transforms (AS, MI, OF, SF, IO, IR,
 * IJ, IN, IP), layer parameters (LP, SR, RO, KO, LN), apertures (AD, AM) and
 * the X2 attributes (TF, TA, TO, TD).
 *
 * "Y and Y are logical coordinates, A and B are plotter coordinates. Usually
 * A = X, B = Y, but we can have A = Y, B = X and/or offset, mirror, scale."
 *
 * An aperture block (`%AB`) is not among them: KiCad 10.0.5 does not read it,
 * and neither does this.
 *
 * The GERBER_FILE_IMAGE methods here take the image as their first argument;
 * see gerber_file_image.ts.
 */
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { AM_PARAM } from './am_param.js';
import { AM_PRIMITIVE, AM_PRIMITIVE_ID } from './am_primitive.js';
import { APERTURE_MACRO } from './aperture_macro.js';
import { APERTURE_DEF_HOLETYPE, APERTURE_T } from './dcode.js';
import { FormatStringFromGerber, GBR_NETINFO_TYPE } from './gbr_netlist_metadata.js';
import { GERBER_BUFZ, GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { Gerb_Analyse_Cmd, Gerb_Interpolation, gerbIUScale } from './gerbview.js';
import {
  type CHAR_PTR,
  type FILE,
  type LINE_BUFFER,
  NUL,
  isdigit,
  isspace,
  strncasecmp0,
} from './libc.js';
import { ReadDouble, ReadInt } from './rs274_read_XY_and_IJ_coordinates.js';
import { X2_ATTRIBUTE, X2_ATTRIBUTE_FILEFUNCTION } from './X2_gerber_attributes.js';

/** `CODE( x, y )`: two chars as a 16-bit command identifier. */
const CODE = (x: string, y: string): number => (x.charCodeAt(0) << 8) + y.charCodeAt(0);

/**
 * `RS274X_PARAMETERS` (rs274xrevd_e.pdf, table 1). `IMAGE_NAME` and `INCH`
 * are both `IN`: the enum names one value twice, and the switch reaches the
 * `IMAGE_NAME` case.
 */
const RS274X = {
  // Directive parameters: single usage recommended
  // Must be at the beginning of the file
  AXIS_SELECT: CODE('A', 'S'), // Default: A=X, B=Y
  FORMAT_STATEMENT: CODE('F', 'S'), // no default: this command must exists
  MIRROR_IMAGE: CODE('M', 'I'), // Default: mo mirror
  MODE_OF_UNITS: CODE('M', 'O'), // Default:  inch
  INCH: CODE('I', 'N'),
  MILLIMETER: CODE('M', 'M'),
  OFFSET: CODE('O', 'F'), // Default: A = 0, B = 0
  SCALE_FACTOR: CODE('S', 'F'), // Default:  A = 1.0, B = 1.0

  // Image parameters:
  // commands used only once at the beginning of the file, and are deprecated
  IMAGE_JUSTIFY: CODE('I', 'J'), // Default: no justification
  IMAGE_NAME: CODE('I', 'N'), // Default: void
  IMAGE_OFFSET: CODE('I', 'O'), // Default: A = 0, B = 0
  IMAGE_POLARITY: CODE('I', 'P'), // Default: Positive
  IMAGE_ROTATION: CODE('I', 'R'), // Default: 0

  // Aperture parameters:
  // Usually for the whole file
  AP_DEFINITION: CODE('A', 'D'),
  AP_MACRO: CODE('A', 'M'),

  // X2 extension attribute commands
  FILE_ATTRIBUTE: CODE('T', 'F'),
  NET_ATTRIBUTE: CODE('T', 'O'),
  APERTURE_ATTRIBUTE: CODE('T', 'A'),
  REMOVE_APERTURE_ATTRIBUTE: CODE('T', 'D'),

  // Layer specific parameters
  // May be used singly or may be layer specific
  // These parameters are at the beginning of the file or layer
  // and reset some layer parameters (like interpolation)
  KNOCKOUT: CODE('K', 'O'), // Default: off
  STEP_AND_REPEAT: CODE('S', 'R'), //  Default: A = 1, B = 1
  ROTATE: CODE('R', 'O'), //  Default: 0

  LOAD_POLARITY: CODE('L', 'P'), //LPC or LPD. Default: Dark (LPD)
  LOAD_NAME: CODE('L', 'N'), // Deprecated: equivalent to G04
} as const;

/**
 * `GERBER_FILE_IMAGE::ReadXCommandID`: two bytes assembled into an int, the
 * first in the most significant byte. -1 at the end of the text.
 */
export function ReadXCommandID(text: CHAR_PTR): number {
  let result: number;
  let currbyte: number;

  if (text.c() !== NUL) {
    currbyte = text.next().charCodeAt(0);
    result = (currbyte & 0xff) << 8;
  } else return -1;

  if (text.c() !== NUL) {
    currbyte = text.next().charCodeAt(0);
    result += currbyte & 0xff;
  } else return -1;

  return result;
}

/** `GERBER_FILE_IMAGE::ReadRS274XCommand`: a single RS274X command terminated with a %. */
export function ReadRS274XCommand(
  self: GERBER_FILE_IMAGE,
  aBuff: LINE_BUFFER,
  aBuffSize: number,
  aText: CHAR_PTR,
): boolean {
  let ok = true;
  let code_command: number;

  aText.inc();

  for (;;) {
    while (aText.c() !== NUL) {
      switch (aText.c()) {
        case '%': // end of command
          aText.inc();
          self.m_CommandState = Gerb_Analyse_Cmd.CMD_IDLE;
          return ok; // success completion

        case ' ':
        case '\r':
        case '\n':
          aText.inc();
          break;

        case '*':
          aText.inc();
          break;

        default:
          code_command = ReadXCommandID(aText);
          ok = self.ExecuteRS274XCommand(code_command, aBuff, aBuffSize, aText);

          if (!ok) return ok;

          break;
      }
    }

    // end of current line, read another one.
    if ((self.m_Current_File as FILE).fgets(aBuff, aBuffSize) === null) {
      // end of file
      ok = false;
      break;
    }

    self.m_LineNum++;
    aText.reset(aBuff);
  }

  return ok;
}

/** `GERBER_FILE_IMAGE::ExecuteRS274XCommand`. */
export function ExecuteRS274XCommand(
  self: GERBER_FILE_IMAGE,
  aCommand: number,
  aBuff: LINE_BUFFER | null,
  aBuffSize: number,
  aText: CHAR_PTR,
): boolean {
  let code: number;
  let ok = true;
  let msg: string;
  let fcoord: number;
  let x_fmt_known = false;
  let y_fmt_known = false;

  // conv_scale = scaling factor from inch to Internal Unit
  let conv_scale = gerbIUScale.IU_PER_MILS * 1000;

  const dummy = new X2_ATTRIBUTE();
  const lineNum = { value: self.m_LineNum };
  const syncLine = (): void => {
    self.m_LineNum = lineNum.value;
  };

  if (self.m_GerbMetric) conv_scale /= 25.4;

  switch (aCommand) {
    case RS274X.FORMAT_STATEMENT:
      // seq_len = 2; (not used, just provided)

      while (aText.c() !== '*') {
        switch (aText.c()) {
          case ' ':
            aText.inc();
            break;

          // biome-ignore lint/suspicious/noFallthroughSwitchClause: KI_FALLTHROUGH in the C++
          case 'D': // Non-standard option for all zeros (leading + tailing)
            self.AddMessageToList(
              `RS274X: Invalid GERBER format command 'D' at line ${self.m_LineNum}: '${aBuff?.s ?? ''}'`,
            );
            self.AddMessageToList(`GERBER file '${self.m_FileName}' may not display as intended.`);
          // KI_FALLTHROUGH
          case 'L': // No Leading 0
            self.m_NoTrailingZeros = false;
            aText.inc();
            break;

          case 'T': // No trailing 0
            self.m_NoTrailingZeros = true;
            aText.inc();
            break;

          case 'A': // Absolute coord
            self.m_Relative = false;
            aText.inc();
            break;

          case 'I': // Relative coord
            self.m_Relative = true;
            aText.inc();
            break;

          case 'G':
          case 'N': // Sequence code (followed by one digit: the sequence len)
            // (sometimes found before the X,Y sequence)
            // Obscure option
            aText.inc();
            aText.next(); // seq_char, sets the unused seq_len
            break;

          case 'M': // Sequence code (followed by one digit: the sequence len)
            // (sometimes found after the X,Y sequence)
            // Obscure option
            aText.inc();

            if (isdigit(aText.c())) aText.inc(); // skip the digit

            break;

          case 'X':
          case 'Y': {
            const coord = aText.next();
            const ctmp = aText.next().charCodeAt(0) - 48; // - '0'

            if (coord === 'X') {
              x_fmt_known = true;
              // number of digits after the decimal point (0 to 7 allowed)
              self.m_FmtScale.x = aText.c().charCodeAt(0) - 48;
              self.m_FmtLen.x = ctmp + self.m_FmtScale.x;

              // m_FmtScale is 0 to 7
              // (Old Gerber specification was 0 to 6)
              if (self.m_FmtScale.x < 0) self.m_FmtScale.x = 0;

              if (self.m_FmtScale.x > 7) self.m_FmtScale.x = 7;
            } else {
              y_fmt_known = true;
              self.m_FmtScale.y = aText.c().charCodeAt(0) - 48;
              self.m_FmtLen.y = ctmp + self.m_FmtScale.y;

              if (self.m_FmtScale.y < 0) self.m_FmtScale.y = 0;

              if (self.m_FmtScale.y > 7) self.m_FmtScale.y = 7;
            }

            aText.inc();
            break;
          }

          case '*':
            break;

          default:
            self.AddMessageToList(`Unknown id (${aText.c()}) in FS command`);
            self.GetEndOfBlock(aBuff as LINE_BUFFER, aBuffSize, aText, self.m_Current_File);
            ok = false;
            break;
        }

        // Upstream loops forever when the block ends in '%' without a '*'
        // (the default case's GetEndOfBlock stops on the '%' every time), or
        // runs off the end of the file. Both stop here instead.
        if (aText.c() === NUL || aText.c() === '%') break;
      }

      if (!x_fmt_known || !y_fmt_known)
        self.AddMessageToList('RS274X: Format Statement (FS) without X or Y format');

      break;

    case RS274X.AXIS_SELECT: // command ASAXBY*% or %ASAYBX*%
      self.m_SwapAxis = false;

      if (strncasecmp0(aText, 'AYBX', 4)) self.m_SwapAxis = true;

      break;

    case RS274X.MIRROR_IMAGE: // command %MIA0B0*%, %MIA0B1*%, %MIA1B0*%, %MIA1B1*%
      self.m_MirrorA = false;
      self.m_MirrorB = false;

      while (aText.c() !== NUL && aText.c() !== '*') {
        switch (aText.c()) {
          case 'A': // Mirror A axis ?
            aText.inc();

            if (aText.c() === '1') self.m_MirrorA = true;

            break;

          case 'B': // Mirror B axis ?
            aText.inc();

            if (aText.c() === '1') self.m_MirrorB = true;

            break;

          default:
            aText.inc();
            break;
        }
      }
      break;

    case RS274X.MODE_OF_UNITS:
      code = ReadXCommandID(aText);

      if (code === RS274X.INCH) self.m_GerbMetric = false;
      else if (code === RS274X.MILLIMETER) self.m_GerbMetric = true;

      conv_scale = self.m_GerbMetric ? gerbIUScale.IU_PER_MILS / 25.4 : gerbIUScale.IU_PER_MILS;
      break;

    case RS274X.FILE_ATTRIBUTE: // Command %TF ...
      dummy.ParseAttribCmd(self.m_Current_File, aBuff, aBuffSize, aText, lineNum);
      syncLine();

      if (dummy.IsFileFunction()) {
        self.m_FileFunction = new X2_ATTRIBUTE_FILEFUNCTION(dummy);

        // Don't set this until we get a file function; other code expects m_IsX2_file == true
        // to mean that we have a valid m_FileFunction
        self.m_IsX2_file = true;
      } else if (dummy.IsFileMD5()) {
        self.m_MD5_value = dummy.GetPrm(1);
      } else if (dummy.IsFilePart()) {
        self.m_PartString = dummy.GetPrm(1);
      }

      break;

    case RS274X.APERTURE_ATTRIBUTE: // Command %TA
      dummy.ParseAttribCmd(self.m_Current_File, aBuff, aBuffSize, aText, lineNum);
      syncLine();

      if (dummy.GetAttribute() === '.AperFunction') {
        self.m_AperFunction = dummy.GetPrm(1);

        // A few function values can have other parameters. Add them
        for (let ii = 2; ii < dummy.GetPrmCount(); ii++)
          self.m_AperFunction += `,${dummy.GetPrm(ii)}`;
      }

      break;

    case RS274X.NET_ATTRIBUTE: // Command %TO currently %TO.P %TO.N and %TO.C
      dummy.ParseAttribCmd(self.m_Current_File, aBuff, aBuffSize, aText, lineNum);
      syncLine();

      if (dummy.GetAttribute() === '.N') {
        self.m_NetAttributeDict.m_NetAttribType |= GBR_NETINFO_TYPE.GBR_NETINFO_NET;
        self.m_NetAttributeDict.m_Netname = FormatStringFromGerber(dummy.GetPrm(1));
      } else if (dummy.GetAttribute() === '.C') {
        self.m_NetAttributeDict.m_NetAttribType |= GBR_NETINFO_TYPE.GBR_NETINFO_CMP;
        self.m_NetAttributeDict.m_Cmpref = FormatStringFromGerber(dummy.GetPrm(1));
      } else if (dummy.GetAttribute() === '.P') {
        self.m_NetAttributeDict.m_NetAttribType |= GBR_NETINFO_TYPE.GBR_NETINFO_PAD;
        self.m_NetAttributeDict.m_Cmpref = FormatStringFromGerber(dummy.GetPrm(1));
        self.m_NetAttributeDict.m_Padname.SetField(
          FormatStringFromGerber(dummy.GetPrm(2)),
          true,
          true,
        );

        if (dummy.GetPrmCount() > 3) {
          self.m_NetAttributeDict.m_PadPinFunction.SetField(
            FormatStringFromGerber(dummy.GetPrm(3)),
            true,
            true,
          );
        } else {
          self.m_NetAttributeDict.m_PadPinFunction.Clear();
        }
      }

      break;

    case RS274X.REMOVE_APERTURE_ATTRIBUTE: // Command %TD ...
      dummy.ParseAttribCmd(self.m_Current_File, aBuff, aBuffSize, aText, lineNum);
      syncLine();
      self.RemoveAttribute(dummy);

      break;

    case RS274X.OFFSET: // command: OFAnnBnn (nn = float number) = layer Offset
      self.m_Offset = { x: 0, y: 0 };

      while (aText.c() !== '*') {
        switch (aText.c()) {
          case 'A': // A axis offset in current unit (inch or mm)
            aText.inc();
            fcoord = ReadDouble(aText);
            self.m_Offset.x = KiROUND(fcoord * conv_scale);
            break;

          case 'B': // B axis offset in current unit (inch or mm)
            aText.inc();
            fcoord = ReadDouble(aText);
            self.m_Offset.y = KiROUND(fcoord * conv_scale);
            break;

          default:
            // No default upstream: any other char loops forever. Step over it.
            aText.inc();
            break;
        }

        // No default upstream, so any other char, or a block ending in '%',
        // loops forever; here it is stepped over and the '%' ends the loop.
        if (aText.c() === NUL || aText.c() === '%') break;
      }

      break;

    case RS274X.SCALE_FACTOR:
      self.m_Scale = { x: 1, y: 1 };

      while (aText.c() !== '*') {
        switch (aText.c()) {
          case 'A': // A axis scale
            aText.inc();
            // `m_Scale` is a VECTOR2I: the double is truncated to an int.
            self.m_Scale.x = Math.trunc(ReadDouble(aText));
            break;

          case 'B': // B axis scale
            aText.inc();
            self.m_Scale.y = Math.trunc(ReadDouble(aText));
            break;

          default:
            aText.inc();
            break;
        }

        // No default upstream, so any other char, or a block ending in '%',
        // loops forever; here it is stepped over and the '%' ends the loop.
        if (aText.c() === NUL || aText.c() === '%') break;
      }

      break;

    case RS274X.IMAGE_OFFSET: // command: IOAnnBnn (nn = float number) = Image Offset
      self.m_ImageOffset = { x: 0, y: 0 };

      while (aText.c() !== '*') {
        switch (aText.c()) {
          case 'A': // A axis offset in current unit (inch or mm)
            aText.inc();
            fcoord = ReadDouble(aText);
            self.m_ImageOffset.x = KiROUND(fcoord * conv_scale);
            break;

          case 'B': // B axis offset in current unit (inch or mm)
            aText.inc();
            fcoord = ReadDouble(aText);
            self.m_ImageOffset.y = KiROUND(fcoord * conv_scale);
            break;

          default:
            aText.inc();
            break;
        }

        // No default upstream, so any other char, or a block ending in '%',
        // loops forever; here it is stepped over and the '%' ends the loop.
        if (aText.c() === NUL || aText.c() === '%') break;
      }

      break;

    case RS274X.IMAGE_ROTATION: // command IR0* or IR90* or IR180* or IR270*
      if (strncasecmp0(aText, '0*', 2)) self.m_ImageRotation = 0;
      else if (strncasecmp0(aText, '90*', 3)) self.m_ImageRotation = 90;
      else if (strncasecmp0(aText, '180*', 4)) self.m_ImageRotation = 180;
      else if (strncasecmp0(aText, '270*', 4)) self.m_ImageRotation = 270;
      else self.AddMessageToList('RS274X: Command "IR" rotation value not allowed');

      break;

    case RS274X.STEP_AND_REPEAT: {
      // command SR, like %SRX3Y2I5.0J2*%
      // Close any previously active SR block before starting a new one
      self.FinishStepAndRepeatBlock();

      const params = self.GetLayerParams();
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // Start a new Gerber layer
      params.m_StepForRepeat.x = 0.0;
      params.m_StepForRepeat.y = 0.0; // offset for Step and Repeat command
      params.m_XRepeatCount = 1;
      params.m_YRepeatCount = 1; // The repeat count
      params.m_StepForRepeatMetric = self.m_GerbMetric; // the step units

      while (aText.c() !== NUL && aText.c() !== '*') {
        switch (aText.c()) {
          case 'I': // X axis offset
            aText.inc();
            params.m_StepForRepeat.x = ReadDouble(aText);
            break;

          case 'J': // Y axis offset
            aText.inc();
            params.m_StepForRepeat.y = ReadDouble(aText);
            break;

          case 'X': // X axis repeat count
            aText.inc();
            params.m_XRepeatCount = ReadInt(aText);
            break;

          case 'Y': // Y axis offset
            aText.inc();
            params.m_YRepeatCount = ReadInt(aText);
            break;

          default:
            aText.inc();
            break;
        }
      }

      // If repeat count > 1 on either axis, begin collecting items for
      // block-level replication per Gerber spec section 4.12
      if (params.m_XRepeatCount > 1 || params.m_YRepeatCount > 1) {
        self.m_SRBlockCollecting = true;
        self.m_SRBlockStartIdx = self.m_drawings.length;
      }

      break;
    }

    case RS274X.IMAGE_JUSTIFY: // Command IJAnBn*
      self.m_ImageJustifyXCenter = false; // Image Justify Center on X axis (default = false)
      self.m_ImageJustifyYCenter = false; // Image Justify Center on Y axis (default = false)
      self.m_ImageJustifyOffset = { x: 0, y: 0 }; // Image Justify Offset on XY axis (default = 0,0)

      while (aText.c() !== NUL && aText.c() !== '*') {
        // IJ command is (for A or B axis) AC or AL or A<coordinate>
        switch (aText.c()) {
          case 'A': // A axis justify
            aText.inc();

            if (aText.c() === 'C') {
              self.m_ImageJustifyXCenter = true;
              aText.inc();
            } else if (aText.c() === 'L') {
              self.m_ImageJustifyXCenter = true;
              aText.inc();
            } else {
              self.m_ImageJustifyOffset.x = KiROUND(ReadDouble(aText) * conv_scale);
            }

            break;

          case 'B': // B axis justify
            aText.inc();

            if (aText.c() === 'C') {
              self.m_ImageJustifyYCenter = true;
              aText.inc();
            } else if (aText.c() === 'L') {
              self.m_ImageJustifyYCenter = true;
              aText.inc();
            } else {
              self.m_ImageJustifyOffset.y = KiROUND(ReadDouble(aText) * conv_scale);
            }

            break;

          default:
            aText.inc();
            break;
        }
      }

      if (self.m_ImageJustifyXCenter) self.m_ImageJustifyOffset.x = 0;

      if (self.m_ImageJustifyYCenter) self.m_ImageJustifyOffset.y = 0;

      break;

    case RS274X.KNOCKOUT:
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // Start a new Gerber layer
      msg = 'RS274X: Command KNOCKOUT ignored by GerbView';
      self.AddMessageToList(msg);
      break;

    case RS274X.ROTATE: // Layer rotation: command like %RO45*%
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // Start a new Gerber layer
      self.m_LocalRotation = ReadDouble(aText); // Store layer rotation in degrees
      break;

    case RS274X.IMAGE_NAME:
      self.m_ImageName = '';

      while (aText.c() !== '*') {
        if (aText.c() === NUL) break; // appends NULs upstream until a '*' turns up
        self.m_ImageName += aText.next();
      }

      break;

    case RS274X.LOAD_NAME:
      // %LN is a (deprecated) equivalentto G04: a comment
      while (aText.c() !== NUL && aText.c() !== '*') aText.inc(); // Skip text

      break;

    case RS274X.IMAGE_POLARITY:
      // Note: these commands IPPOS and IPNEG are deprecated since 2012.
      if (strncasecmp0(aText, 'NEG', 3)) {
        self.m_ImageNegative = true;
        // IPPOS Gerber command is deprecated since 2012.
        // in Gerber doc 2024, the advice is: warn user and skip it.
        self.AddMessageToList('IPNEG Gerber command is deprecated since 2012. Skip it');
      } else {
        self.m_ImageNegative = false;
        // IPPOS Gerber command is deprecated since 2012.
        // However this is the default for a Gerber file, and does not have
        // actual effect. Just skip it.
      }

      break;

    case RS274X.LOAD_POLARITY:
      if (aText.c() === 'C') self.GetLayerParams().m_LayerNegative = true;
      else self.GetLayerParams().m_LayerNegative = false;

      break;

    case RS274X.AP_MACRO: // lines like %AMMYMACRO*
      // 5,1,8,0,0,1.08239X$1,22.5*
      // %
      /*ok = */ self.ReadApertureMacro(aBuff as LINE_BUFFER, aBuffSize, aText, self.m_Current_File);
      break;

    case RS274X.AP_DEFINITION: {
      /* input example:  %ADD30R,0.081800X0.101500*%
       * Aperture definition has 4 options: C, R, O, P
       * (Circle, Rect, Oval, regular Polygon)
       * and shapes can have a hole (round or rectangular).
       * All optional parameters values start by X
       * at this point, text points to 2nd 'D'
       */
      if (aText.next() !== 'D') {
        ok = false;
        break;
      }

      self.m_Has_DCode = true;

      code = ReadInt(aText);

      const dcode = self.GetDCODEOrCreate(code);

      if (dcode === null) break;

      dcode.m_AperFunction = self.m_AperFunction;

      // at this point, text points to character after the ADD<num>,
      // i.e. R in example above.  If aText[0] is one of the usual
      // apertures: (C,R,O,P), there is a comma after it.
      if (aText.at(1) === ',') {
        const stdAperture = aText.c();

        aText.inc(2); // skip "C," for example

        // First parameter is the size X:
        dcode.m_Size.x = KiROUND(ReadDouble(aText) * conv_scale);
        dcode.m_Size.y = dcode.m_Size.x;

        switch (stdAperture) {
          // Aperture desceiption has optional parameters. Read them
          case 'C': // Circle
            dcode.m_ApertType = APERTURE_T.APT_CIRCLE;
            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_Drill.x = KiROUND(ReadDouble(aText) * conv_scale);
              dcode.m_Drill.y = dcode.m_Drill.x;
              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_ROUND_HOLE;
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_Drill.y = KiROUND(ReadDouble(aText) * conv_scale);

              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_RECT_HOLE;
            }

            dcode.m_Defined = true;
            break;

          case 'O': // oval
          case 'R': // rect
            dcode.m_ApertType = stdAperture === 'O' ? APERTURE_T.APT_OVAL : APERTURE_T.APT_RECT;

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              // Second parameter: size Y
              aText.inc();
              dcode.m_Size.y = KiROUND(ReadDouble(aText) * conv_scale);
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              // third parameter: drill size (or drill size X)
              aText.inc();
              dcode.m_Drill.x = KiROUND(ReadDouble(aText) * conv_scale);
              dcode.m_Drill.y = dcode.m_Drill.x;
              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_ROUND_HOLE;
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              // fourth parameter: drill size Y
              aText.inc();
              dcode.m_Drill.y = KiROUND(ReadDouble(aText) * conv_scale);
              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_RECT_HOLE;
            }

            dcode.m_Defined = true;
            break;

          case 'P':
            /* Regular polygon: a command line like %ADD12P,0.040X10X25X0.025X0.025X0.0150*%
             * params are: <diameter>, X<edge count>, X<Rotation>, X<X hole dim>, X<Y hole dim>
             */
            dcode.m_ApertType = APERTURE_T.APT_POLYGON;

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_EdgesCount = ReadInt(aText);
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_Rotation = new EDA_ANGLE(ReadDouble(aText), EDA_ANGLE_T.DEGREES_T);
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_Drill.x = KiROUND(ReadDouble(aText) * conv_scale);
              dcode.m_Drill.y = dcode.m_Drill.x;
              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_ROUND_HOLE;
            }

            while (aText.c() === ' ') aText.inc();

            if (aText.c() === 'X') {
              aText.inc();
              dcode.m_Drill.y = KiROUND(ReadDouble(aText) * conv_scale);
              dcode.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_RECT_HOLE;
            }

            dcode.m_Defined = true;
            break;
        }
      } else {
        // aText[0] starts an aperture macro name
        const am_lookup = new APERTURE_MACRO();

        while (aText.c() !== NUL && aText.c() !== '*' && aText.c() !== ',')
          am_lookup.m_AmName += aText.next();

        // When an aperture definition is like %AMLINE2* 22,1,$1,$2,0,0,-45*
        // the ADDxx<MACRO_NAME> command has parameters, like %ADD14LINE2,0.8X0.5*%
        if (aText.c() === ',') {
          // Read aperture macro parameters and store them
          aText.inc(); // aText points the first parameter

          while (aText.c() !== NUL && aText.c() !== '*') {
            const param = ReadDouble(aText);
            dcode.AppendParam(param);

            if (
              !(isspace(aText.c()) || aText.c() === 'X' || aText.c() === 'x' || aText.c() === '*')
            ) {
              self.AddMessageToList(
                `RS274X: aperture macro ${am_lookup.m_AmName} has invalid template parameters\n`,
              );
              ok = false;
              break;
            }

            while (isspace(aText.c())) aText.inc();

            // Skip 'X' separator:
            if (aText.c() === 'X' || aText.c() === 'x') aText.inc();
          }
        }

        // lookup the aperture macro here.
        const pam = self.FindApertureMacro(am_lookup);

        if (!pam) {
          self.AddMessageToList(`RS274X: aperture macro ${am_lookup.m_AmName} not found\n`);
          ok = false;
          break;
        }

        dcode.m_ApertType = APERTURE_T.APT_MACRO;
        dcode.SetMacro(pam);
        dcode.m_Defined = true;
      }

      break;
    }

    default:
      ok = false;
      break;
  }

  if (!self.GetEndOfBlock(aBuff as LINE_BUFFER, aBuffSize, aText, self.m_Current_File)) ok = false;

  return ok;
}

/**
 * `GERBER_FILE_IMAGE::GetEndOfBlock`: move to the next '*' or '%', reading
 * lines as needed. False at the end of the file.
 */
export function GetEndOfBlock(
  self: GERBER_FILE_IMAGE,
  aBuff: LINE_BUFFER | null,
  aBuffSize: number,
  aText: CHAR_PTR,
  gerber_file: FILE | null,
): boolean {
  for (;;) {
    // `(aText < aBuff + aBuffSize) && *aText`: within the line buffer.
    while (aText.c() !== NUL) {
      if (aText.c() === '*') return true;

      if (aText.c() === '%') return true;

      aText.inc();
    }

    // fgets( aBuff, aBuffSize, gerber_file ): a G04 #@! comment passes no
    // buffer, and the file read then fails upstream the same way.
    if (aBuff === null || gerber_file === null || gerber_file.fgets(aBuff, aBuffSize) === null)
      break;

    self.m_LineNum++;
    aText.reset(aBuff);
  }

  return false;
}

/**
 * `GERBER_FILE_IMAGE::GetNextLine`: skip blanks and line ends; at the end of
 * the text read a new line.
 *
 * @return a pointer to the beginning of the next line, or null at the end of
 *         the file.
 */
export function GetNextLine(
  self: GERBER_FILE_IMAGE,
  aBuff: LINE_BUFFER,
  aBuffSize: number,
  aText: CHAR_PTR,
  aFile: FILE | null,
): CHAR_PTR | null {
  const p = aText.clone();

  for (;;) {
    switch (p.c()) {
      case ' ': // skip blanks
      case '\n':
      case '\r': // Skip line terminators
        p.inc();
        break;

      case NUL: // End of text found in aBuff: Read a new string
        if (aFile === null || aFile.fgets(aBuff, aBuffSize) === null) return null;

        self.m_LineNum++;
        p.reset(aBuff);
        return p;

      default:
        return p;
    }
  }
}

/**
 * `GERBER_FILE_IMAGE::ReadApertureMacro`: read an aperture macro and save it
 * in m_aperture_macros.
 */
export function ReadApertureMacro(
  self: GERBER_FILE_IMAGE,
  aBuff: LINE_BUFFER,
  aBuffSize: number,
  aText: CHAR_PTR,
  gerber_file: FILE | null,
): boolean {
  const am = new APERTURE_MACRO();

  // `aText = GetNextLine( ... )` rebinds the caller's char*&: copy back.
  const assign = (p: CHAR_PTR | null): boolean => {
    if (p === null) return false;
    aText.buf = p.buf;
    aText.i = p.i;
    return true;
  };

  // read macro name
  while (aText.c() !== NUL) {
    if (aText.c() === '*') {
      aText.inc();
      break;
    }

    am.m_AmName += aText.next();
  }

  // Read aperture macro parameters
  for (;;) {
    if (aText.c() === '*') aText.inc();

    if (!assign(self.GetNextLine(aBuff, aBuffSize, aText, gerber_file))) return false; // End of File

    // aText points the beginning of a new line.

    // Test for the last line in aperture macro lis:
    // last line is % or *% sometime found.
    if (aText.c() === '*') aText.inc();

    if (aText.c() === '%') break; // exit with aText still pointing at %

    let paramCount = 0; // will be set to the minimal parameters count,
    // depending on the actual primitive
    let primitive_type: number = AM_PRIMITIVE_ID.AMP_UNKNOWN;

    // Test for a valid symbol at the beginning of a description:
    // it can be: a parameter declaration like $1=$2/4
    // or a digit (macro primitive selection)
    // all other symbols are illegal.
    if (aText.c() === '$') {
      // local parameter declaration, inside the aperture macro
      am.AddLocalParamDefToStack();
      const param = am.GetLastLocalParamDefFromStack();

      if (!assign(self.GetNextLine(aBuff, aBuffSize, aText, gerber_file))) return false; // End of File

      param.ReadParamFromAmDef(aText);
      continue;
    } else if (!isdigit(aText.c())) {
      // Ill. symbol
      self.AddMessageToList(
        `RS274X: Aperture Macro "${am.m_AmName}": ill. symbol, line: "${aBuff.s}"`,
      );
      primitive_type = AM_PRIMITIVE_ID.AMP_COMMENT;
    } else {
      primitive_type = ReadInt(aText);
    }

    let is_comment = false;

    switch (primitive_type) {
      case AM_PRIMITIVE_ID.AMP_COMMENT: // lines starting by 0 are a comment
        paramCount = 0;
        is_comment = true;

        // Skip comment
        self.GetEndOfBlock(GERBER_FILE_IMAGE.m_LineBuffer, GERBER_BUFZ, aText, self.m_Current_File);

        break;

      case AM_PRIMITIVE_ID.AMP_CIRCLE:
        paramCount = 4; // minimal count. can have a optional parameter (rotation)
        break;

      case AM_PRIMITIVE_ID.AMP_LINE2:
      case AM_PRIMITIVE_ID.AMP_LINE20:
        paramCount = 7;
        break;

      case AM_PRIMITIVE_ID.AMP_LINE_CENTER:
      case AM_PRIMITIVE_ID.AMP_LINE_LOWER_LEFT:
        paramCount = 6;
        break;

      case AM_PRIMITIVE_ID.AMP_OUTLINE:
        paramCount = 4; // partial count. other parameters are vertices and rotation
        // Second parameter is vertice (coordinate pairs) count.
        break;

      case AM_PRIMITIVE_ID.AMP_POLYGON:
        paramCount = 6;
        break;

      case AM_PRIMITIVE_ID.AMP_MOIRE:
        paramCount = 9;
        break;

      case AM_PRIMITIVE_ID.AMP_THERMAL:
        paramCount = 6;
        break;

      default:
        self.AddMessageToList(
          `RS274X: Aperture Macro "${am.m_AmName}": Invalid primitive id code ${primitive_type}, ` +
            `line ${self.m_LineNum}: "${aBuff.s}"`,
        );
        return false;
    }

    if (is_comment) continue;

    const prim = new AM_PRIMITIVE(self.m_GerbMetric);
    prim.m_Primitive_id = primitive_type as AM_PRIMITIVE_ID;
    let ii: number;

    for (ii = 0; ii < paramCount && aText.c() !== NUL && aText.c() !== '*'; ++ii) {
      const param = new AM_PARAM();
      prim.m_Params.push(param);

      if (!assign(self.GetNextLine(aBuff, aBuffSize, aText, gerber_file))) return false; // End of File

      param.ReadParamFromAmDef(aText);
    }

    if (ii < paramCount) {
      // maybe some day we can throw an exception and track a line number
      self.AddMessageToList(
        `RS274X: read macro descr type ${prim.m_Primitive_id}: read ${ii} parameters, ` +
          'insufficient parameters\n',
      );
    }

    // there are more parameters to read if this is an AMP_OUTLINE
    if (prim.m_Primitive_id === AM_PRIMITIVE_ID.AMP_OUTLINE) {
      // so far we have read [0]:exposure, [1]:#points, [2]:X start, [3]: Y start
      // Now read all the points, plus trailing rotation in degrees.

      // m_Params[1] is a count of polygon points, so it must be given
      // in advance, i.e. be immediate.
      // wxASSERT( prim.m_Params[1].IsImmediate() );

      paramCount =
        Math.trunc((prim.m_Params[1] as AM_PARAM | undefined)?.GetValueFromMacro(null) ?? 0) * 2 +
        1;

      for (let jj = 0; jj < paramCount && aText.c() !== '*'; ++jj) {
        const param = new AM_PARAM();
        prim.m_Params.push(param);

        if (!assign(self.GetNextLine(aBuff, aBuffSize, aText, gerber_file))) return false; // End of File

        param.ReadParamFromAmDef(aText);
      }
    }

    // AMP_CIRCLE can have a optional parameter (rotation)
    if (prim.m_Primitive_id === AM_PRIMITIVE_ID.AMP_CIRCLE && aText.c() !== '*') {
      const param = new AM_PARAM();
      prim.m_Params.push(param);
      param.ReadParamFromAmDef(aText);
    }

    // The primitive description is now parsed: push it to the current aperture macro
    am.AddPrimitiveToList(prim);
  }

  // m_aperture_macros.insert( std::move( am ) ): a name already present keeps
  // the first definition.
  if (!self.m_aperture_macros.has(am.m_AmName)) self.m_aperture_macros.set(am.m_AmName, am);

  return true;
}
