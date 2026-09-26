// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/dcode.h` + `.cpp`: `D_CODE`, a Gerber aperture (a D code >= 10),
 * and its conversion to a polygon.
 *
 *   D01 ... D09 = command codes: D01 pen down, D02 pen up, D03 flash
 *   D10 ... = Identification Tool (Shape id)
 *
 * `DrawFlashedShape` and `DrawFlashedPolygon` are the legacy wxDC path
 * (`GERBER_DRAW_ITEM::Print`), which nothing in 10.0.5's GAL canvas or
 * printout reaches; not ported. GERBVIEW_PAINTER draws flashes.
 */
import {
  ANGLE_0,
  ANGLE_90,
  ANGLE_360,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import {
  ErrorLoc,
  transformCircleToPolygonSet,
} from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import type { APERTURE_MACRO } from './aperture_macro.js';
import type { GERBER_DRAW_ITEM } from './gerber_draw_item.js';
import { IU_PER_MM } from './gerbview.js';

/**
 * `APERTURE_T` (`dcode.h:48-55`), the standard aperture templates and the
 * macro reference. [data] KiCad's own character codes — including `'0'`
 * (zero) for the oval, where the `%AD` template letter is `O`.
 */
export enum APERTURE_T {
  /** Flashed shape: Circle with or without hole. */
  APT_CIRCLE = 'C',
  /** Flashed shape: Rectangle with or without hole. */
  APT_RECT = 'R',
  /** Flashed shape: Oval with or without hole. */
  APT_OVAL = '0',
  /** Flashed shape: Regular polygon (3 to 12 edges) with or without hole. */
  APT_POLYGON = 'P',
  /** Complex shape given by a macro definition (see AM_PRIMITIVE_ID). */
  APT_MACRO = 'M',
}

/** `APERTURE_DEF_HOLETYPE`: a round, oval or rectangular flash may have a hole. */
export enum APERTURE_DEF_HOLETYPE {
  APT_DEF_NO_HOLE = 0,
  APT_DEF_ROUND_HOLE,
  APT_DEF_RECT_HOLE,
}

/** `FIRST_DCODE`: D codes below this are commands (D01, D02, D03...). */
export const FIRST_DCODE = 10;
/** `LAST_DCODE`: "Revision I1 permits apertures up to 2^31-1". */
export const LAST_DCODE = 0x7fffffff;

/** `gerbIUScale.mmToIU( x )`. */
const mmToIU = (mm: number): number => KiROUND(mm * IU_PER_MM);

/** `DCODE_DEFAULT_SIZE`: 0.1 mm. [data] */
const DCODE_DEFAULT_SIZE = mmToIU(0.1);

/** `SEGS_CNT`: "number of segments to approximate a circle". [data] */
const SEGS_CNT = 64;

/** A Gerber DCODE (also called Aperture) definition. */
export class D_CODE {
  /** Horizontal and vertical dimensions. */
  m_Size: VECTOR2I = { x: 0, y: 0 };
  /** Aperture type (Line, rectangle, circle, oval poly, macro). */
  m_ApertType: APERTURE_T = APERTURE_T.APT_CIRCLE;
  /** D code value (>= 10). */
  m_Num_Dcode: number;
  /** Dimension of the hole (if any) (drill file). */
  m_Drill: VECTOR2I = { x: 0, y: 0 };
  /** Shape of the hole (0 = no hole, round = 1, rect = 2). */
  m_DrillShape: APERTURE_DEF_HOLETYPE = APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE;
  /** Shape rotation. */
  m_Rotation: EDA_ANGLE = ANGLE_0;
  /** In aperture definition Polygon only: number of edges for the polygon. */
  m_EdgesCount = 0;
  /** false if the aperture (previously defined) is not used to draw something. */
  m_InUse = false;
  /** false if the aperture is not defined in the header. */
  m_Defined = false;
  /** The aperture attribute (created by a %TA.AperFunction command). */
  m_AperFunction = '';
  /**
   * Polygon used to draw APT_POLYGON shape and some other complex shapes
   * which are converted to polygon (shapes with hole).
   */
  m_Polygon = new SHAPE_POLY_SET();

  /** No ownership, points to GERBER.m_aperture_macros element. */
  private m_Macro: APERTURE_MACRO | null = null;
  /** Parameters customizing the aperture macro this D_CODE references. */
  private m_am_params: number[] = [];

  constructor(num_dcode: number) {
    this.m_Num_Dcode = num_dcode;
    this.Clear_D_CODE_Data();
  }

  /**
   * True if aDcodeValue is valid (>= FIRST_DCODE). "Any value > 0x7FFFFFFF is
   * a negative value for a int and is not acceptable."
   */
  static IsValidDcodeValue(aDcodeValue: number): boolean {
    return aDcodeValue >= FIRST_DCODE;
  }

  Clear_D_CODE_Data(): void {
    this.m_Size = { x: DCODE_DEFAULT_SIZE, y: DCODE_DEFAULT_SIZE };
    this.m_ApertType = APERTURE_T.APT_CIRCLE;
    this.m_Drill = { x: 0, y: 0 };
    this.m_DrillShape = APERTURE_DEF_HOLETYPE.APT_DEF_NO_HOLE;
    this.m_InUse = false;
    this.m_Defined = false;
    this.m_Macro = null;
    this.m_Rotation = ANGLE_0;
    this.m_EdgesCount = 0;
    this.m_Polygon.RemoveAllContours();
  }

  /** Add a parameter to the list customizing the corresponding aperture macro. */
  AppendParam(aValue: number): void {
    this.m_am_params.push(aValue);
  }

  /** The number of parameters stored in the parameter list. */
  GetParamCount(): number {
    return this.m_am_params.length;
  }

  /**
   * Parameter `aIdx` of the list; "for n parameters from the Dcode
   * definition, aIdx = 1 .. n, not 0".
   */
  GetParam(aIdx: number): number {
    // wxASSERT( aIdx <= m_am_params.size() );
    if (aIdx <= this.m_am_params.length) return this.m_am_params[aIdx - 1] as number;
    return 0;
  }

  SetMacro(aMacro: APERTURE_MACRO | null): void {
    this.m_Macro = aMacro;
  }

  GetMacro(): APERTURE_MACRO | null {
    return this.m_Macro;
  }

  /** A character string telling what type of aperture type `aType` is. */
  static ShowApertureType(aType: APERTURE_T): string {
    switch (aType) {
      case APERTURE_T.APT_CIRCLE:
        return 'Round';
      case APERTURE_T.APT_RECT:
        return 'Rect';
      case APERTURE_T.APT_OVAL:
        return 'Oval';
      case APERTURE_T.APT_POLYGON:
        return 'Poly';
      case APERTURE_T.APT_MACRO:
        return 'Macro';
      default:
        return '???';
    }
  }

  /**
   * A value to size the D-Code text of an item: the diameter of the primitive,
   * or the width of a line.
   *
   * @return a dimension, or -1 if no dim to calculate.
   */
  GetShapeDim(aParent: GERBER_DRAW_ITEM): number {
    let dim = 0;

    switch (this.m_ApertType) {
      case APERTURE_T.APT_CIRCLE:
        dim = this.m_Size.x;
        break;

      case APERTURE_T.APT_RECT:
      case APERTURE_T.APT_OVAL:
        dim = Math.min(this.m_Size.x, this.m_Size.y);
        break;

      case APERTURE_T.APT_POLYGON:
        dim = Math.min(this.m_Size.x, this.m_Size.y);
        break;

      case APERTURE_T.APT_MACRO:
        if (this.m_Macro) {
          if (this.m_Polygon.OutlineCount() === 0) this.ConvertShapeToPolygon(aParent);

          const bbox = this.m_Polygon.BBox();
          dim = Math.min(bbox.GetWidth(), bbox.GetHeight());
        }
        break;

      default:
        break;
    }

    return dim;
  }

  /**
   * Convert the shape to an equivalent polygon in `m_Polygon`, arcs and circles
   * approximated by segments. `aParent` is used for APT_MACRO.
   */
  ConvertShapeToPolygon(aParent: GERBER_DRAW_ITEM): void {
    let initialpos: VECTOR2I = { x: 0, y: 0 };
    let currpos: VECTOR2I = { x: 0, y: 0 };

    this.m_Polygon.RemoveAllContours();

    switch (this.m_ApertType) {
      case APERTURE_T.APT_CIRCLE: {
        // creates only a circle with rectangular hole
        // Adjust the allowed approx error to convert arcs to segments:
        const arc_to_seg_error = mmToIU(0.005); // Allow 5 microns
        this.m_Polygon.NewOutline();
        for (const p of transformCircleToPolygonSet(
          initialpos,
          this.m_Size.x >> 1,
          arc_to_seg_error,
          ErrorLoc.ERROR_INSIDE,
        ))
          this.m_Polygon.Append(p);
        addHoleToPolygon(this.m_Polygon, this.m_DrillShape, this.m_Drill, initialpos);
        break;
      }

      case APERTURE_T.APT_RECT:
        this.m_Polygon.NewOutline();
        currpos.x = Math.trunc(this.m_Size.x / 2);
        currpos.y = Math.trunc(this.m_Size.y / 2);
        initialpos = { ...currpos };
        this.m_Polygon.Append({ ...currpos });
        currpos.x -= this.m_Size.x;
        this.m_Polygon.Append({ ...currpos });
        currpos.y -= this.m_Size.y;
        this.m_Polygon.Append({ ...currpos });
        currpos.x += this.m_Size.x;
        this.m_Polygon.Append({ ...currpos });
        currpos.y += this.m_Size.y;
        this.m_Polygon.Append({ ...currpos }); // close polygon
        this.m_Polygon.Append({ ...initialpos });

        addHoleToPolygon(this.m_Polygon, this.m_DrillShape, this.m_Drill, initialpos);
        break;

      case APERTURE_T.APT_OVAL: {
        this.m_Polygon.NewOutline();
        let delta: number;
        let radius: number;

        // we create an horizontal oval shape. then rotate if needed
        if (this.m_Size.x > this.m_Size.y) {
          // horizontal oval
          delta = Math.trunc((this.m_Size.x - this.m_Size.y) / 2);
          radius = Math.trunc(this.m_Size.y / 2);
        } else {
          // vertical oval
          delta = Math.trunc((this.m_Size.y - this.m_Size.x) / 2);
          radius = Math.trunc(this.m_Size.x / 2);
        }

        currpos.y = radius;
        initialpos = { ...currpos };
        this.m_Polygon.Append({ ...currpos });

        // build the right arc of the shape
        let ii = 0;

        for (; ii <= SEGS_CNT / 2; ii++) {
          currpos = RotatePoint(initialpos, ANGLE_360.multiply(ii).divide(SEGS_CNT));
          currpos.x += delta;
          this.m_Polygon.Append({ ...currpos });
        }

        // build the left arc of the shape
        for (ii = SEGS_CNT / 2; ii <= SEGS_CNT; ii++) {
          currpos = RotatePoint(initialpos, ANGLE_360.multiply(ii).divide(SEGS_CNT));
          currpos.x -= delta;
          this.m_Polygon.Append({ ...currpos });
        }

        this.m_Polygon.Append({ ...initialpos }); // close outline

        if (this.m_Size.y > this.m_Size.x)
          // vertical oval, rotate polygon.
          this.m_Polygon.Rotate(ANGLE_90);

        addHoleToPolygon(this.m_Polygon, this.m_DrillShape, this.m_Drill, initialpos);
        break;
      }

      case APERTURE_T.APT_POLYGON:
        this.m_Polygon.NewOutline();
        currpos.x = this.m_Size.x >> 1; // first point is on X axis
        initialpos = { ...currpos };

        // rs274x said: m_EdgesCount = 3 ... 12
        if (this.m_EdgesCount < 3) this.m_EdgesCount = 3;

        if (this.m_EdgesCount > 12) this.m_EdgesCount = 12;

        for (let ii = 0; ii < this.m_EdgesCount; ii++) {
          currpos = RotatePoint(initialpos, ANGLE_360.multiply(ii).divide(this.m_EdgesCount));
          this.m_Polygon.Append({ ...currpos });
        }

        addHoleToPolygon(this.m_Polygon, this.m_DrillShape, this.m_Drill, initialpos);

        if (!this.m_Rotation.IsZero())
          // rotate polygonal shape:
          this.m_Polygon.Rotate(this.m_Rotation.negate());

        break;

      case APERTURE_T.APT_MACRO: {
        const macro = this.GetMacro() as APERTURE_MACRO;
        const macroShape = macro.GetApertureMacroShape(aParent, initialpos);
        this.m_Polygon.Append(macroShape);
        break;
      }
    }
  }
}

/**
 * A helper function for D_CODE::ConvertShapeToPolygon(): add a hole to a
 * polygon.
 */
function addHoleToPolygon(
  aPolygon: SHAPE_POLY_SET,
  aHoleShape: APERTURE_DEF_HOLETYPE,
  aSize: VECTOR2I,
  _aAnchorPos: VECTOR2I,
): void {
  const currpos: VECTOR2I = { x: 0, y: 0 };
  const holeBuffer = new SHAPE_POLY_SET();

  if (aHoleShape === APERTURE_DEF_HOLETYPE.APT_DEF_ROUND_HOLE) {
    // Adjust the allowed approx error to convert arcs to segments:
    const arc_to_seg_error = mmToIU(0.005); // Allow 5 microns
    holeBuffer.NewOutline();
    for (const p of transformCircleToPolygonSet(
      { x: 0, y: 0 },
      Math.trunc(aSize.x / 2),
      arc_to_seg_error,
      ErrorLoc.ERROR_INSIDE,
    ))
      holeBuffer.Append(p);
  } else if (aHoleShape === APERTURE_DEF_HOLETYPE.APT_DEF_RECT_HOLE) {
    holeBuffer.NewOutline();
    currpos.x = Math.trunc(aSize.x / 2);
    currpos.y = Math.trunc(aSize.y / 2);
    holeBuffer.Append({ ...currpos }); // link to hole and begin hole
    currpos.x -= aSize.x;
    holeBuffer.Append({ ...currpos });
    currpos.y -= aSize.y;
    holeBuffer.Append({ ...currpos });
    currpos.x += aSize.x;
    holeBuffer.Append({ ...currpos });
    currpos.y += aSize.y;
    holeBuffer.Append({ ...currpos }); // close hole
  }

  aPolygon.BooleanSubtract(holeBuffer);
  aPolygon.Fracture();
}
