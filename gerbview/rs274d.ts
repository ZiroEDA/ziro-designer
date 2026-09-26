// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/rs274d.cpp`: the RS274D commands of a Gerber file — the G codes
 * (`Execute_G_Command`) and the D codes (`Execute_DCODE_Command`: select a
 * tool, draw, move, flash), and the helpers that fill a GERBER_DRAW_ITEM for
 * a flash, a line, an arc, or an arc inside a region.
 *
 *   G01 linear, G02/G03 circular CW/CCW, G04 comment (and, as `G04 #@!`, an X2
 *   attribute), G36/G37 region on/off, G54 tool select (outdated), G70/G71
 *   inch/mm, G74/G75 90/360 degree arcs, G90/G91 absolute/relative.
 *   D01 draw, D02 move, D03 flash, D10.. tool select.
 *
 * The GERBER_FILE_IMAGE methods here take the image as their first argument;
 * see gerber_file_image.ts.
 */
import { ANGLE_360, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { GetArcToSegmentCount } from '@ziroeda/kimath/src/geometry/geometry_utils.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNorm, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { APERTURE_T, type D_CODE, FIRST_DCODE } from './dcode.js';
import { GBR_BASIC_SHAPE_TYPE, GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import { GERBER_BUFZ, GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { Gerb_GCommand, Gerb_Interpolation, gerbIUScale } from './gerbview.js';
import { CHAR_PTR, LINE_BUFFER, NUL, strncmp0, strtol10 } from './libc.js';

const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * `fillFlashedGBRITEM`: initialize a GERBER_DRAW_ITEM as a flash of
 * `aAperture` at `aPos`.
 */
export function fillFlashedGBRITEM(
  aGbrItem: GERBER_DRAW_ITEM,
  aAperture: APERTURE_T,
  Dcode_index: number,
  aPos: VECTOR2I,
  aSize: VECTOR2I,
  aLayerNegative: boolean,
): void {
  aGbrItem.m_Size = { ...aSize };
  aGbrItem.m_Start = { ...aPos };
  aGbrItem.m_End = { ...aGbrItem.m_Start };
  aGbrItem.m_DCode = Dcode_index;
  aGbrItem.SetLayerPolarity(aLayerNegative);
  aGbrItem.m_Flashed = true;
  aGbrItem.SetNetAttributes((aGbrItem.m_GerberImageFile as GERBER_FILE_IMAGE).m_NetAttributeDict);

  switch (aAperture) {
    case APERTURE_T.APT_POLYGON: // flashed regular polygon
      aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY;
      break;

    case APERTURE_T.APT_CIRCLE:
      aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE;
      aGbrItem.m_Size.y = aGbrItem.m_Size.x;
      break;

    case APERTURE_T.APT_OVAL:
      aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL;
      break;

    case APERTURE_T.APT_RECT:
      aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT;
      break;

    case APERTURE_T.APT_MACRO: {
      aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO;

      // Cache the bounding box for aperture macros
      const macro = (aGbrItem.GetDcodeDescr() as D_CODE).GetMacro();
      macro?.GetApertureMacroShape(aGbrItem, aPos);
      break;
    }
  }
}

/** `fillLineGBRITEM`: initialize a GERBER_DRAW_ITEM as a line. */
export function fillLineGBRITEM(
  aGbrItem: GERBER_DRAW_ITEM,
  Dcode_index: number,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aPenSize: VECTOR2I,
  aLayerNegative: boolean,
): void {
  aGbrItem.m_Flashed = false;

  aGbrItem.m_Size = { ...aPenSize };

  aGbrItem.m_Start = { ...aStart };
  aGbrItem.m_End = { ...aEnd };

  aGbrItem.m_DCode = Dcode_index;
  aGbrItem.SetLayerPolarity(aLayerNegative);

  aGbrItem.SetNetAttributes((aGbrItem.m_GerberImageFile as GERBER_FILE_IMAGE).m_NetAttributeDict);
}

/**
 * `fillArcGBRITEM`: initialize a GERBER_DRAW_ITEM as an arc.
 *
 * In multi-quadrant mode `aRelCenter` is the center relative to the start
 * point. In single-quadrant mode (0 to 90 degrees, one quadrant) it is given
 * in ABSOLUTE VALUE, and the signs are recovered from the quadrant the arc
 * end is in.
 */
export function fillArcGBRITEM(
  aGbrItem: GERBER_DRAW_ITEM,
  Dcode_index: number,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  aRelCenter: VECTOR2I,
  aPenSize: VECTOR2I,
  aClockwise: boolean,
  aMultiquadrant: boolean,
  aLayerNegative: boolean,
): void {
  let center: VECTOR2I;

  aGbrItem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_ARC;
  aGbrItem.m_Size = { ...aPenSize };
  aGbrItem.m_Flashed = false;

  if (aGbrItem.m_GerberImageFile)
    aGbrItem.SetNetAttributes(aGbrItem.m_GerberImageFile.m_NetAttributeDict);

  if (aMultiquadrant) {
    center = add(aStart, aRelCenter);
  } else {
    // in single quadrant mode the relative coordinate aRelCenter is always >= 0
    // So we must recalculate the actual sign of aRelCenter.x and aRelCenter.y
    center = { ...aRelCenter };

    // calculate arc end coordinate relative to the starting point,
    // because center is relative to the center point
    const delta = sub(aEnd, aStart);

    // now calculate the relative to aStart center position, for a draw function
    // that use trigonometric arc angle (or counter-clockwise)
    /* Quadrants:
     *    Y
     *  2 | 1
     * -------X
     *  3 | 4
     * C = actual relative arc center, S = arc start (axis origin) E = relative arc end
     */
    if (delta.x >= 0 && delta.y >= 0) {
      /* Quadrant 1 (trigo or cclockwise):
       *  C | E
       * ---S---
       *  3 | 4
       */
      center.x = -center.x;
    } else if (delta.x >= 0 && delta.y < 0) {
      /* Quadrant 4 (trigo or cclockwise):
       *  2 | C
       * ---S---
       *  3 | E
       */
      // Nothing to do
    } else if (delta.x < 0 && delta.y >= 0) {
      /* Quadrant 2 (trigo or cclockwise):
       *  E | 1
       * ---S---
       *  C | 4
       */
      center.x = -center.x;
      center.y = -center.y;
    } else {
      /* Quadrant 3 (trigo or cclockwise):
       *  2 | 1
       * ---S---
       *  E | C
       */
      center.y = -center.y;
    }

    // Due to your draw arc function, we need this:
    if (!aClockwise) center = { x: -center.x, y: -center.y };

    // Calculate actual arc center coordinate:
    center = add(center, aStart);
  }

  if (aClockwise) {
    aGbrItem.m_Start = { ...aStart };
    aGbrItem.m_End = { ...aEnd };
  } else {
    aGbrItem.m_Start = { ...aEnd };
    aGbrItem.m_End = { ...aStart };
  }

  aGbrItem.m_ArcCentre = { x: center.x + 0, y: center.y + 0 };

  aGbrItem.m_DCode = Dcode_index;
  aGbrItem.SetLayerPolarity(aLayerNegative);
}

/**
 * `static GERBER_DRAW_ITEM dummyGbrItem( nullptr )` of fillArcPOLY: one item,
 * reused, only its geometry read.
 */
let dummyGbrItem: GERBER_DRAW_ITEM | null = null;

/**
 * `fillArcPOLY`: an arc G code found in a region outline, appended to the
 * region's polygon as segments (5 microns max error).
 */
function fillArcPOLY(
  aGbrItem: GERBER_DRAW_ITEM,
  aStart: VECTOR2I,
  aEnd: VECTOR2I,
  rel_center: VECTOR2I,
  aClockwise: boolean,
  aMultiquadrant: boolean,
  aLayerNegative: boolean,
): void {
  /* in order to calculate arc parameters, we use fillArcGBRITEM
   * so we muse create a dummy track and use its geometric parameters
   */
  if (dummyGbrItem === null) dummyGbrItem = new GERBER_DRAW_ITEM(null);

  aGbrItem.SetLayerPolarity(aLayerNegative);

  fillArcGBRITEM(
    dummyGbrItem,
    0,
    aStart,
    aEnd,
    rel_center,
    { x: 0, y: 0 },
    aClockwise,
    aMultiquadrant,
    aLayerNegative,
  );

  aGbrItem.SetNetAttributes((aGbrItem.m_GerberImageFile as GERBER_FILE_IMAGE).m_NetAttributeDict);

  const center = { ...dummyGbrItem.m_ArcCentre };

  // Calculate coordinates relative to arc center;
  const start = sub(dummyGbrItem.m_Start, center);
  const end = sub(dummyGbrItem.m_End, center);

  /* Calculate angle arc
   * angle is trigonometrical (counter-clockwise),
   * and axis is the X,Y gerber coordinates
   */
  const start_angle = EDA_ANGLE.fromVector(start);
  let end_angle = EDA_ANGLE.fromVector(end);

  // dummyTrack has right geometric parameters, but
  // fillArcGBRITEM calculates arc parameters for a draw function that expects
  // start_angle < end_angle. So ensure this is the case here:
  // Due to the fact atan2 returns angles between -180 to + 180 degrees,
  // this is not always the case ( a modulo 360.0 degrees can be lost )
  //
  // Note also an arc with same start and end angle is a circle (360 deg arc)
  // in gerber files
  if (start_angle.ge(end_angle)) end_angle = end_angle.add(ANGLE_360);

  const arc_angle = start_angle.sub(end_angle);

  // Approximate arc by segments with a approximation error = err_max
  // a max err = 5 microns looks good
  const approx_err_max = KiROUND(0.005 * gerbIUScale.IU_PER_MM);
  // `VECTOR2I( aStart - rel_center ).EuclideanNorm()`, into an int: KiROUND'd.
  const radius = KiROUND(EuclideanNorm(sub(aStart, rel_center)));
  const count = GetArcToSegmentCount(radius, approx_err_max, arc_angle);
  const increment_angle = arc_angle.abs().divide(count);

  if (aGbrItem.m_ShapeAsPolygon.OutlineCount() === 0) aGbrItem.m_ShapeAsPolygon.NewOutline();

  // calculate polygon corners
  // when arc is counter-clockwise, dummyGbrItem arc goes from end to start
  // and we must always create a polygon from start to end.
  for (let ii = 0; ii <= count; ii++) {
    let rot: EDA_ANGLE;
    let end_arc = { ...start };

    if (aClockwise) rot = increment_angle.multiply(ii);
    else rot = increment_angle.multiply(count - ii);

    if (ii < count) end_arc = RotatePoint(end_arc, rot.negate());
    // last point
    else end_arc = aClockwise ? { ...end } : { ...start };

    aGbrItem.m_ShapeAsPolygon.Append(add(end_arc, center));
  }
}

/** `GERBER_FILE_IMAGE::CodeNumber`: the number after the command letter. */
export function CodeNumber(aText: CHAR_PTR): number {
  // retval = strtol( aText + 1, &endptr, 10 );
  const r = strtol10(aText.buf.s, aText.i + 1);

  // `if( endptr == aText || errno != 0 ) return 0;` - strtol leaves endptr at
  // its own argument, aText + 1, when nothing converts, so this never fires
  // and the cursor still moves past the letter.

  // wxCHECK_MSG( retval < std::numeric_limits<int>::max(), 0, _( "Invalid Code Number" ) );
  if (r.value >= 0x7fffffff) return 0;

  aText.i = r.end;

  return r.value;
}

/** `GERBER_FILE_IMAGE::Execute_G_Command`. */
export function Execute_G_Command(
  self: GERBER_FILE_IMAGE,
  text: CHAR_PTR,
  G_command: number,
): boolean {
  switch (G_command) {
    case Gerb_GCommand.GC_PHOTO_MODE: // can starts a D03 flash command: redundant, can be safely ignored.
      break;

    case Gerb_GCommand.GC_LINEAR_INTERPOL_1X:
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X;
      break;

    case Gerb_GCommand.GC_CIRCLE_NEG_INTERPOL:
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_ARC_NEG;
      break;

    case Gerb_GCommand.GC_CIRCLE_POS_INTERPOL:
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_ARC_POS;
      break;

    case Gerb_GCommand.GC_COMMENT:
      // Skip comment, but only if the line does not start by "G04 #@! "
      // which is a metadata, i.e. a X2 command inside the comment.
      // this comment is called a "structured comment"
      if (strncmp0(text, ' #@! ', 5)) {
        text.inc(5);

        // The string starting at text is the same as the X2 attribute,
        // but a X2 attribute ends by '%'. So we build the X2 attribute string
        let x2buf = '';

        while (text.c() !== NUL && text.c() !== '*') {
          x2buf += text.c();
          text.inc();
        }

        // add the end of X2 attribute string
        x2buf += '*%';

        const x2line = new LINE_BUFFER();
        x2line.s = x2buf;
        const cptr = new CHAR_PTR(x2line);
        const code_command = self.ReadXCommandID(cptr);
        self.ExecuteRS274XCommand(code_command, null, 0, cptr);
      }

      self.GetEndOfBlock(GERBER_FILE_IMAGE.m_LineBuffer, GERBER_BUFZ, text, self.m_Current_File);

      break;

    case Gerb_GCommand.GC_SELECT_TOOL: {
      const D_commande = self.CodeNumber(text);

      if (D_commande < FIRST_DCODE) return false;

      self.m_Current_Tool = D_commande;
      const pt_Dcode = self.GetDCODE(D_commande);

      if (pt_Dcode) pt_Dcode.m_InUse = true;

      break;
    }

    case Gerb_GCommand.GC_SPECIFY_INCHES:
      self.m_GerbMetric = false; // false = Inches, true = metric
      break;

    case Gerb_GCommand.GC_SPECIFY_MILLIMETERS:
      self.m_GerbMetric = true; // false = Inches, true = metric
      break;

    case Gerb_GCommand.GC_TURN_OFF_360_INTERPOL: // disable Multi cadran arc and Arc interpol
      self.m_360Arc_enbl = false;
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // not sure it should be done
      self.m_AsArcG74G75Cmd = true;
      break;

    case Gerb_GCommand.GC_TURN_ON_360_INTERPOL:
      self.m_360Arc_enbl = true;
      self.m_AsArcG74G75Cmd = true;
      break;

    case Gerb_GCommand.GC_SPECIFY_ABSOLUES_COORD:
      self.m_Relative = false; // false = absolute Coord, true = relative Coord
      break;

    case Gerb_GCommand.GC_SPECIFY_RELATIVEES_COORD:
      self.m_Relative = true; // false = absolute Coord, true = relative Coord
      break;

    case Gerb_GCommand.GC_TURN_ON_POLY_FILL:
      self.m_PolygonFillMode = true;
      self.m_Exposure = false;
      break;

    case Gerb_GCommand.GC_TURN_OFF_POLY_FILL: {
      const gbritem = self.GetLastItemInList();

      if (self.m_Exposure && gbritem) {
        // End of polygon
        if (gbritem.m_ShapeAsPolygon.VertexCount())
          gbritem.m_ShapeAsPolygon.Append({ ...gbritem.m_ShapeAsPolygon.CVertex(0) });

        self.StepAndRepeatItem(gbritem);
      }

      self.m_Exposure = false;
      self.m_PolygonFillMode = false;
      self.m_PolygonFillModeState = 0;
      self.m_Iterpolation = Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X; // not sure it should be done
      break;
    }

    default: {
      // GC_MOVE: Non existent
      // `wxT( "G%0.2d command not handled" )`
      const digits = `${Math.abs(G_command)}`.padStart(2, '0');
      const msg = `G${G_command < 0 ? '-' : ''}${digits} command not handled`;
      self.AddMessageToList(msg);
      return false;
    }
  }

  return true;
}

/** `GERBER_FILE_IMAGE::Execute_DCODE_Command`. */
export function Execute_DCODE_Command(
  self: GERBER_FILE_IMAGE,
  _text: CHAR_PTR,
  D_commande: number,
): boolean {
  let size: VECTOR2I = { x: 15, y: 15 };

  let aperture: APERTURE_T = APERTURE_T.APT_CIRCLE;
  let gbritem: GERBER_DRAW_ITEM;

  let dcode = 0;
  let tool: D_CODE | null = null;

  if (D_commande >= FIRST_DCODE) {
    // This is a "Set tool" command
    // remember which tool is selected, nothing is done with it in this
    // call
    self.m_Current_Tool = D_commande;

    const pt_Dcode = self.GetDCODE(D_commande);

    if (pt_Dcode) pt_Dcode.m_InUse = true;
    else self.m_Has_MissingDCode = true;

    return true;
  }

  // D_commande = 0..9:  this is a pen command (usually D1, D2 or D3)
  self.m_Last_Pen_Command = D_commande;

  if (self.m_PolygonFillMode) {
    // Enter a polygon description:
    switch (D_commande) {
      case 1: // code D01 Draw line, exposure ON
        if (!self.m_Exposure) {
          // Start a new polygon outline:
          self.m_Exposure = true;
          gbritem = new GERBER_DRAW_ITEM(self);
          self.AddItemToList(gbritem);
          gbritem.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_POLYGON;
          gbritem.m_Flashed = false;
          gbritem.m_DCode = 0; // No DCode for a Polygon (Region in Gerber dialect)

          if (gbritem.m_GerberImageFile) {
            gbritem.SetNetAttributes(gbritem.m_GerberImageFile.m_NetAttributeDict);
            gbritem.m_AperFunction = gbritem.m_GerberImageFile.m_AperFunction;
          }
        }

        switch (self.m_Iterpolation) {
          case Gerb_Interpolation.GERB_INTERPOL_ARC_NEG:
          case Gerb_Interpolation.GERB_INTERPOL_ARC_POS:
            // Before any arc command, a G74 or G75 command must be set.
            // Otherwise the Gerber file is invalid
            if (!self.m_AsArcG74G75Cmd) {
              self.AddMessageToList('Invalid Gerber file: missing G74 or G75 arc command');

              // Disable further warning messages:
              self.m_AsArcG74G75Cmd = true;
            }

            gbritem = self.GetLastItemInList() as GERBER_DRAW_ITEM;

            fillArcPOLY(
              gbritem,
              self.m_PreviousPos,
              self.m_CurrentPos,
              self.m_IJPos,
              self.m_Iterpolation !== Gerb_Interpolation.GERB_INTERPOL_ARC_NEG,
              self.m_360Arc_enbl,
              self.GetLayerParams().m_LayerNegative,
            );
            break;

          default:
            gbritem = self.GetLastItemInList() as GERBER_DRAW_ITEM;

            gbritem.m_Start = { ...self.m_PreviousPos }; // m_Start is used as temporary storage

            if (gbritem.m_ShapeAsPolygon.OutlineCount() === 0) {
              gbritem.m_ShapeAsPolygon.NewOutline();
              gbritem.m_ShapeAsPolygon.Append({ ...gbritem.m_Start });
            }

            gbritem.m_End = { ...self.m_CurrentPos }; // m_End is used as temporary storage
            gbritem.m_ShapeAsPolygon.Append({ ...gbritem.m_End });
            break;
        }

        self.m_PreviousPos = { ...self.m_CurrentPos };
        self.m_PolygonFillModeState = 1;
        break;

      case 2: {
        // code D2: exposure OFF (i.e. "move to")
        const last = self.GetLastItemInList();

        if (self.m_Exposure && last) {
          // End of polygon
          last.m_ShapeAsPolygon.Append({ ...last.m_ShapeAsPolygon.CVertex(0) });
          self.StepAndRepeatItem(last);
        }

        self.m_Exposure = false;
        self.m_PreviousPos = { ...self.m_CurrentPos };
        self.m_PolygonFillModeState = 0;
        break;
      }

      default:
        return false;
    }
  } else {
    switch (D_commande) {
      case 1: // code D01 Draw line, exposure ON
        self.m_Exposure = true;

        tool = self.GetDCODE(self.m_Current_Tool);

        if (tool) {
          size = { ...tool.m_Size };
          dcode = tool.m_Num_Dcode;
          aperture = tool.m_ApertType;
        }

        switch (self.m_Iterpolation) {
          case Gerb_Interpolation.GERB_INTERPOL_LINEAR_1X:
            gbritem = new GERBER_DRAW_ITEM(self);
            self.AddItemToList(gbritem);

            fillLineGBRITEM(
              gbritem,
              dcode,
              self.m_PreviousPos,
              self.m_CurrentPos,
              size,
              self.GetLayerParams().m_LayerNegative,
            );
            self.StepAndRepeatItem(gbritem);
            break;

          case Gerb_Interpolation.GERB_INTERPOL_ARC_NEG:
          case Gerb_Interpolation.GERB_INTERPOL_ARC_POS:
            gbritem = new GERBER_DRAW_ITEM(self);
            self.AddItemToList(gbritem);

            if (self.m_LastCoordIsIJPos) {
              fillArcGBRITEM(
                gbritem,
                dcode,
                self.m_PreviousPos,
                self.m_CurrentPos,
                self.m_IJPos,
                size,
                self.m_Iterpolation !== Gerb_Interpolation.GERB_INTERPOL_ARC_NEG,
                self.m_360Arc_enbl,
                self.GetLayerParams().m_LayerNegative,
              );
              self.m_LastCoordIsIJPos = false;
            } else {
              fillLineGBRITEM(
                gbritem,
                dcode,
                self.m_PreviousPos,
                self.m_CurrentPos,
                size,
                self.GetLayerParams().m_LayerNegative,
              );
            }

            self.StepAndRepeatItem(gbritem);

            break;

          default:
            self.AddMessageToList(
              `RS274D: DCODE Command: interpol error (type ${self.m_Iterpolation.toString(16).toUpperCase()})`,
            );
            break;
        }

        self.m_PreviousPos = { ...self.m_CurrentPos };
        break;

      case 2: // code D2: exposure OFF (i.e. "move to")
        self.m_Exposure = false;
        self.m_PreviousPos = { ...self.m_CurrentPos };
        break;

      case 3: // code D3: flash aperture
        tool = self.GetDCODE(self.m_Current_Tool);

        if (tool) {
          size = { ...tool.m_Size };
          dcode = tool.m_Num_Dcode;
          aperture = tool.m_ApertType;
        }

        gbritem = new GERBER_DRAW_ITEM(self);
        self.AddItemToList(gbritem);
        fillFlashedGBRITEM(
          gbritem,
          aperture,
          dcode,
          self.m_CurrentPos,
          size,
          self.GetLayerParams().m_LayerNegative,
        );
        self.StepAndRepeatItem(gbritem);
        self.m_PreviousPos = { ...self.m_CurrentPos };
        break;

      default:
        return false;
    }
  }

  return true;
}
