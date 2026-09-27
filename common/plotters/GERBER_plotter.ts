// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `GERBER_PLOTTER`, the RS-274X / Gerber X2 plot back-end: KiCad's
 * `common/plotters/GERBER_plotter.cpp` with its headers
 * `include/plotters/plotter_gerber.h`, `gbr_plotter_apertures.h` (`APERTURE`,
 * `APER_MACRO_FREEPOLY`, `APER_MACRO_FREEPOLY_LIST`) and
 * `gbr_plotter_aperture_macros.h` (the `%AM` macro texts), one unit under the
 * `.cpp` name as common/STRUCTURE.md prescribes.
 *
 * Two deliberate differences from the C++:
 *
 * 1. **No temp file.** Upstream writes the body to a temporary `workFile`,
 *    then EndPlot copies it line by line into the real file and splices the
 *    aperture macros and the `%ADD` list in after the `G04 APERTURE LIST*`
 *    line. Here the body accumulates in memory and EndPlot runs the same
 *    line scan over it; `text()` / `bytes()` hand back the result.
 * 2. **Our name, not KiCad's**, on the `G04 Created by` comment, for the reason
 *    `common/generator.ts` gives. The clock StartPlot reads is `SetDate`'s, so
 *    that the comment and `AddGerberX2Header`'s `TF.CreationDate` agree and a
 *    test can pin both.
 *
 * `aData`, a `void*` upstream, is a {@link GBR_METADATA} or nothing.
 */

import { GBR_APERTURE_METADATA, GBR_METADATA, FormatNetAttribute } from '../gbr_metadata.js';
import type { GBR_NETLIST_METADATA } from '../gbr_netlist_metadata.js';
import type { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../eda_text.js';
import type { Color4d } from '../gal/color4d.js';
import { GENERATOR_APPLICATION } from '../generator.js';
import { GetBuildVersion } from '../build_version.js';
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0, ANGLE_90, ANGLE_180, EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import {
  SHAPE_POLY_SET,
  TransformRoundChamferedRectToPolygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { fixed } from './fmt.js';
import {
  DO_NOT_SET_LINE_WIDTH,
  FILL_T,
  type LINE_STYLE,
  PLOT_FORMAT,
  PLOTTER,
  type PLOTTER_FONT,
  type PLOTTER_TEXT_ATTRIBUTES,
  type PEN_PLUME,
  toVector2I,
  USE_DEFAULT_LINE_WIDTH,
} from './plotter.js';

// ---------------------------------------------------------------------------
// gbr_plotter_apertures.h
// ---------------------------------------------------------------------------

/** D_CODE < 10 is a command, D_CODE >= 10 is a tool. */
export const FIRST_DCODE_VALUE = 10;

/** `APERTURE::APERTURE_TYPE`. */
export enum APERTURE_TYPE {
  AT_CIRCLE = 1, // round aperture, to flash pads
  AT_RECT = 2, // rect aperture, to flash pads
  AT_PLOTTING = 3, // round aperture, to plot lines
  AT_OVAL = 4, // oval aperture, to flash pads
  AT_REGULAR_POLY = 5, // Regular polygon (n vertices, n = 3 .. 12, with rotation)
  AT_REGULAR_POLY3, // Regular polygon 3 vertices, with rotation
  AT_REGULAR_POLY4, // Regular polygon 4 vertices, with rotation
  AT_REGULAR_POLY5, // Regular polygon 5 vertices, with rotation
  AT_REGULAR_POLY6, // Regular polygon 6 vertices, with rotation
  AT_REGULAR_POLY7, // Regular polygon 7 vertices, with rotation
  AT_REGULAR_POLY8, // Regular polygon 8 vertices, with rotation
  AT_REGULAR_POLY9, // Regular polygon 9 vertices, with rotation
  AT_REGULAR_POLY10, // Regular polygon 10 vertices, with rotation
  AT_REGULAR_POLY11, // Regular polygon 11 vertices, with rotation
  AT_REGULAR_POLY12, // Regular polygon 12 vertices, with rotation
  AM_ROUND_RECT, // Aperture macro for round rect pads
  AM_ROT_RECT, // Aperture macro for rotated rect pads
  APER_MACRO_OUTLINE4P, // Aperture macro for trapezoid pads (outline with 4 corners)
  APER_MACRO_OUTLINE5P, // Aperture macro for pad polygons with 5 corners (chamfered pads)
  APER_MACRO_OUTLINE6P, // Aperture macro for pad polygons with 6 corners (chamfered pads)
  APER_MACRO_OUTLINE7P, // Aperture macro for pad polygons with 7 corners (chamfered pads)
  APER_MACRO_OUTLINE8P, // Aperture macro for pad polygons with 8 corners (chamfered pads)
  AM_ROTATED_OVAL, // Aperture macro for rotated oval pads
  // (not rotated uses a primitive)
  AM_FREE_POLYGON, // Aperture macro to create on the fly a free polygon, with
  // only one parameter: rotation
}

/** Class to handle a D_CODE when plotting a board using Standard Aperture Templates. */
export class APERTURE {
  static readonly AT_CIRCLE = APERTURE_TYPE.AT_CIRCLE;
  static readonly AT_RECT = APERTURE_TYPE.AT_RECT;
  static readonly AT_PLOTTING = APERTURE_TYPE.AT_PLOTTING;
  static readonly AT_OVAL = APERTURE_TYPE.AT_OVAL;

  // Type ( Line, rect , circulaire , ovale poly 3 to 12 vertices, aperture macro )
  m_Type: APERTURE_TYPE = APERTURE_TYPE.AT_CIRCLE;

  // horiz and Vert size
  m_Size: Vec2 = { x: 0, y: 0 };

  // list of corners for polygon shape
  m_Corners: Vec2[] = [];

  // Radius for polygon and round rect shape
  m_Radius = 0;

  // Rotation in degrees
  m_Rotation: EDA_ANGLE = ANGLE_0;

  // code number ( >= 10 )
  m_DCode = 0;

  // the attribute attached to this aperture
  // Only one attribute is allowed by aperture
  // 0 = no specific aperture attribute
  m_ApertureAttribute = 0;

  m_CustomAttribute = '';

  SetSize(aSize: Vec2): void {
    this.m_Size = aSize;
  }

  GetSize(): Vec2 {
    return this.m_Size;
  }

  SetDiameter(aDiameter: number): void {
    this.m_Radius = Math.trunc(aDiameter / 2);
  }

  GetDiameter(): number {
    // For round primitive, the diameter is the m_Size.x ot m_Size.y
    if (this.m_Type === APERTURE_TYPE.AT_CIRCLE || this.m_Type === APERTURE_TYPE.AT_PLOTTING)
      return this.m_Size.x;

    // For rounded shapes (macro apertures), return m_Radius * 2
    // but usually they use the radius (m_Radius)
    return this.m_Radius * 2;
  }

  SetRegPolyVerticeCount(aCount: number): void {
    let count = aCount;

    if (count < 3) count = 3;
    else if (count > 12) count = 12;

    this.m_Type = APERTURE_TYPE.AT_REGULAR_POLY3 - 3 + count;
  }

  GetRegPolyVerticeCount(): number {
    return this.m_Type - APERTURE_TYPE.AT_REGULAR_POLY3 + 3;
  }

  SetRotation(aRotation: EDA_ANGLE): void {
    this.m_Rotation = aRotation;
  }

  GetRotation(): EDA_ANGLE {
    return this.m_Rotation;
  }
}

const vecEq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

// A helper function to compare 2 polygons: polygons are similar if they have the same
// number of vertices and each vertex coordinate are similar, i.e. if the difference
// between coordinates is small ( <= margin to accept rounding issues coming from polygon
// geometric transforms like rotation
function polyCompare(aPolygon: readonly Vec2[], aTestPolygon: readonly Vec2[]): boolean {
  // fast test: polygon sizes must be the same:
  if (aTestPolygon.length !== aPolygon.length) return false;

  const margin = 2;

  for (let jj = 0; jj < aPolygon.length; jj++) {
    if (
      Math.abs(aPolygon[jj]!.x - aTestPolygon[jj]!.x) > margin ||
      Math.abs(aPolygon[jj]!.y - aTestPolygon[jj]!.y) > margin
    )
      return false;
  }

  return true;
}

const AM_FREEPOLY_BASENAME = 'FreePoly';

/** A class to define an aperture macros based on a free polygon, i.e. using a primitive 4. */
export class APER_MACRO_FREEPOLY {
  m_Corners: Vec2[];
  m_Id: number;

  constructor(aPolygon: readonly Vec2[], aId: number) {
    this.m_Corners = [...aPolygon];
    this.m_Id = aId;
  }

  /** True if aPolygon is the same as this, i.e. the same as m_Corners. */
  IsSamePoly(aPolygon: readonly Vec2[]): boolean {
    return polyCompare(this.m_Corners, aPolygon);
  }

  /**
   * Print the aperture macro definition.
   *
   * @param aIu2GbrMacroUnit is the scaling factor from coordinates value to
   * the Gerber file macros units (always mm or inches)
   */
  Format(aIu2GbrMacroUnit: number): string {
    let out = '';

    // Write aperture header
    out += `%AM${AM_FREEPOLY_BASENAME}${this.m_Id}*\n`;
    out += `4,1,${this.m_Corners.length},`;

    // Insert a newline after curr_line_count_max coordinates.
    let curr_line_corner_count = 0;
    const curr_line_count_max = 20; // <= 0 to disable newlines

    for (let ii = 0; ii <= this.m_Corners.length; ii++) {
      let jj = ii;

      if (ii >= this.m_Corners.length) jj = 0;

      // Note: parameter values are always mm or inches
      out += `${fixed(this.m_Corners[jj]!.x * aIu2GbrMacroUnit, 6)},${fixed((0 - this.m_Corners[jj]!.y) * aIu2GbrMacroUnit, 6)},`;

      if (curr_line_count_max >= 0 && ++curr_line_corner_count >= curr_line_count_max) {
        out += '\n';
        curr_line_corner_count = 0;
      }
    }

    // output rotation parameter
    out += '$1*%\n';

    return out;
  }

  CornersCount(): number {
    return this.m_Corners.length;
  }
}

export class APER_MACRO_FREEPOLY_LIST {
  m_AMList: APER_MACRO_FREEPOLY[] = [];

  ClearList(): void {
    this.m_AMList = [];
  }

  AmCount(): number {
    return this.m_AMList.length;
  }

  /** Append a new APER_MACRO_FREEPOLY containing the polygon aPolygon to the current list. */
  Append(aPolygon: readonly Vec2[]): void {
    this.m_AMList.push(new APER_MACRO_FREEPOLY(aPolygon, this.AmCount()));
  }

  /** The index in m_AMList of the APER_MACRO_FREEPOLY having the same polygon as aPolygon, or -1. */
  FindAm(aPolygon: readonly Vec2[]): number {
    for (let idx = 0; idx < this.AmCount(); idx++) {
      if (this.m_AMList[idx]!.IsSamePoly(aPolygon)) return idx;
    }

    return -1;
  }

  /** Print the aperture macro list. */
  Format(aIu2GbrMacroUnit: number): string {
    let out = '';

    for (let idx = 0; idx < this.AmCount(); idx++)
      out += this.m_AMList[idx]!.Format(aIu2GbrMacroUnit);

    return out;
  }
}

// ---------------------------------------------------------------------------
// gbr_plotter_aperture_macros.h
// ---------------------------------------------------------------------------

// A aperture macro to define a rounded rect pad shape
// In many gerber readers, the rotation of the full shape is broken
// so we are using primitives that does not need a rotation around aperture origin.
// Note also the primitive 1 (circle) can use 4 or 5 parameters
// the 5th parameter is the rotation (not used by Kicad ) around aperture origin and is
// a recent optional parameter and can create compatibility issues with old
// Gerber viewer, so it is not output (default = 0).
export const APER_MACRO_ROUNDRECT_NAME = 'RoundRect';

export const APER_MACRO_ROUNDRECT_HEADER =
  '%AMRoundRect*\n' +
  '0 Rectangle with rounded corners*\n' +
  '0 $1 Rounding radius*\n' +
  '0 $2 $3 $4 $5 $6 $7 $8 $9 X,Y pos of 4 corners*\n' +
  '0 Add a 4 corners polygon primitive as box body*\n' +
  '4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*\n' +
  '0 Add four circle primitives for the rounded corners*\n' +
  '1,1,$1+$1,$2,$3*\n' +
  '1,1,$1+$1,$4,$5*\n' +
  '1,1,$1+$1,$6,$7*\n' +
  '1,1,$1+$1,$8,$9*\n' +
  '0 Add four rect primitives between the rounded corners*\n' +
  '20,1,$1+$1,$2,$3,$4,$5,0*\n' +
  '20,1,$1+$1,$4,$5,$6,$7,0*\n' +
  '20,1,$1+$1,$6,$7,$8,$9,0*\n' +
  '20,1,$1+$1,$8,$9,$2,$3,0*' +
  '%\n';

// A aperture macro to define a rotated rect pad shape
export const APER_MACRO_ROT_RECT_NAME = 'RotRect';

export const APER_MACRO_ROT_RECT_HEADER =
  '%AMRotRect*\n' +
  '0 Rectangle, with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 $1 length*\n' +
  '0 $2 width*\n' +
  '0 $3 Rotation angle, in degrees counterclockwise*\n' +
  '0 Add horizontal line*\n' +
  '21,1,$1,$2,0,0,$3*%\n';

// A aperture macro to define a oval pad shape
// In many gerber readers, the rotation of the full shape is broken
// so we are using a primitive that does not need a rotation to be
// plotted
export const APER_MACRO_SHAPE_OVAL_NAME = 'HorizOval';

export const APER_MACRO_SHAPE_OVAL_HEADER =
  '%AMHorizOval*\n' +
  '0 Thick line with rounded ends*\n' +
  '0 $1 width*\n' +
  '0 $2 $3 position (X,Y) of the first rounded end (center of the circle)*\n' +
  '0 $4 $5 position (X,Y) of the second rounded end (center of the circle)*\n' +
  '0 Add line between two ends*\n' +
  '20,1,$1,$2,$3,$4,$5,0*\n' +
  '0 Add two circle primitives to create the rounded ends*\n' +
  '1,1,$1,$2,$3*\n' +
  '1,1,$1,$4,$5*%\n';

// A aperture macro to define a trapezoid (polygon) by 4 corners
// and a rotation angle
export const APER_MACRO_OUTLINE4P_NAME = 'Outline4P';

export const APER_MACRO_OUTLINE4P_HEADER =
  '%AMOutline4P*\n' +
  '0 Free polygon, 4 corners , with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 number of corners: always 4*\n' +
  '0 $1 to $8 corner X, Y*\n' +
  '0 $9 Rotation angle, in degrees counterclockwise*\n' +
  '0 create outline with 4 corners*\n' +
  '4,1,4,$1,$2,$3,$4,$5,$6,$7,$8,$1,$2,$9*%\n';

// A aperture macro to define a polygon by 5 corners
// and a rotation angle (useful for chamfered rect pads)
export const APER_MACRO_OUTLINE5P_NAME = 'Outline5P';

export const APER_MACRO_OUTLINE5P_HEADER =
  '%AMOutline5P*\n' +
  '0 Free polygon, 5 corners , with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 number of corners: always 5*\n' +
  '0 $1 to $10 corner X, Y*\n' +
  '0 $11 Rotation angle, in degrees counterclockwise*\n' +
  '0 create outline with 5 corners*\n' +
  '4,1,5,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$1,$2,$11*%\n';

// A aperture macro to define a polygon by 6 corners
// and a rotation angle (useful for chamfered rect pads)
export const APER_MACRO_OUTLINE6P_NAME = 'Outline6P';

export const APER_MACRO_OUTLINE6P_HEADER =
  '%AMOutline6P*\n' +
  '0 Free polygon, 6 corners , with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 number of corners: always 6*\n' +
  '0 $1 to $12 corner X, Y*\n' +
  '0 $13 Rotation angle, in degrees counterclockwise*\n' +
  '0 create outline with 6 corners*\n' +
  '4,1,6,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1,$2,$13*%\n';

// A aperture macro to define a polygon by 7 corners
// and a rotation angle (useful for chamfered rect pads)
export const APER_MACRO_OUTLINE7P_NAME = 'Outline7P';

export const APER_MACRO_OUTLINE7P_HEADER =
  '%AMOutline7P*\n' +
  '0 Free polygon, 7 corners , with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 number of corners: always 7*\n' +
  '0 $1 to $14 corner X, Y*\n' +
  '0 $15 Rotation angle, in degrees counterclockwise*\n' +
  '0 create outline with 7 corners*\n' +
  '4,1,7,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$1,$2,$15*%\n';

// A aperture macro to define a polygon by 8 corners
// and a rotation angle (useful for chamfered rect pads)
export const APER_MACRO_OUTLINE8P_NAME = 'Outline8P';

export const APER_MACRO_OUTLINE8P_HEADER =
  '%AMOutline8P*\n' +
  '0 Free polygon, 8 corners , with rotation*\n' +
  '0 The origin of the aperture is its center*\n' +
  '0 number of corners: always 8*\n' +
  '0 $1 to $16 corner X, Y*\n' +
  '0 $17 Rotation angle, in degrees counterclockwise*\n' +
  '0 create outline with 8 corners*\n' +
  '4,1,8,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$1,$2,$17*%\n';

// ---------------------------------------------------------------------------
// GERBER_plotter.cpp
// ---------------------------------------------------------------------------

// if GBR_USE_MACROS is defined, pads having a shape that is not a Gerber primitive
// will use a macro when possible
// Old code will be removed only after many tests
//
// Note also: setting m_gerberDisableApertMacros to true disable all aperture macros
// in Gerber files
//
// (GBR_USE_MACROS_FOR_CHAMFERED_ROUND_RECT, _CHAMFERED_RECT, _ROUNDRECT, _TRAPEZOID,
// _ROTATED_OVAL, _ROTATED_RECT and _CUSTOM_PAD are all defined upstream, so every
// `#ifdef` below is taken.)

// max count of corners to create a aperture macro for a custom shape.
// provided just in case a aperture macro type free polygon creates issues
// when the number of corners is too high.
// (1 corner = up to 24 chars)
// Gerber doc say max corners 5000. We use a slightly smaller value.
// if a custom shape needs more than GBR_MACRO_FOR_CUSTOM_PAD_MAX_CORNER_COUNT, it
// will be plot using a region.
const GBR_MACRO_FOR_CUSTOM_PAD_MAX_CORNER_COUNT = 4990;

const TEXT_ENCODER = new TextEncoder();

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `wxDateTime::FormatISOCombined( ' ' )`: local time, "YYYY-MM-DD HH:MM:SS". */
function formatISOCombined(aDate: Date): string {
  return (
    `${String(aDate.getFullYear()).padStart(4, '0')}-${pad2(aDate.getMonth() + 1)}-` +
    `${pad2(aDate.getDate())} ${pad2(aDate.getHours())}:${pad2(aDate.getMinutes())}:` +
    `${pad2(aDate.getSeconds())}`
  );
}

/** `aData` of every call below: a `GBR_METADATA*` or nothing. */
const asMetadata = (aData: unknown): GBR_METADATA | null =>
  aData instanceof GBR_METADATA ? aData : null;

export class GERBER_PLOTTER extends PLOTTER {
  // the attributes dictionary created/modified by %TO, attached to objects, when they are created
  // by D01, D03, G36/G37 commands
  // standard attributes are .P, .C and .N
  // this is used by gerber readers when creating a new object. Cleared by %TD command
  // Note: m_objectAttributesDictionary can store more than one attribute
  // the string stores the line(s) actually written to the gerber file
  // it can store a .P, .C or .N attribute, or 2 or 3 attributes, separated by a \n char (EOL)
  protected m_objectAttributesDictionary = '';

  // The last aperture attribute generated (only one aperture attribute can be set)
  protected m_apertureAttribute = 0;

  /** Upstream's `workFile`: the body, before EndPlot splices the aperture list in. */
  private m_work: string[] = [];
  /** Upstream's `finalFile`: the finished document. */
  private m_final = '';
  /** `wxDateTime::Now()` for the `G04 Created by` line; see the file comment. */
  private m_date: Date | null = null;

  protected m_apertures: APERTURE[] = []; // The list of available apertures
  protected m_currentApertureIdx = -1; // The index of the current aperture in m_apertures
  protected m_hasApertureRoundRect = false; // true is at least one round rect aperture is in use
  protected m_hasApertureRotOval = false; // true is at least one oval rotated aperture is in use
  protected m_hasApertureRotRect = false; // true is at least one rect. rotated aperture is in use
  protected m_hasApertureOutline4P = false; // true is at least one 4 corners outline (free polygon
  // with 4 corners) aperture is in use
  protected m_hasApertureChamferedRect = false; // true is at least one chamfered rect is in use
  // (with no rounded corner)

  // number of digits after the point (number of digits of the mantissa
  // Be careful: the Gerber coordinates are stored in an integer
  // so 6 digits (inches) or 5 digits (mm) is a good value
  // To avoid overflow, 7 digits (inches) or 6 digits is a max.
  // with lower values than 6 digits (inches) or 5 digits (mm),
  // Creating self-intersecting polygons from non-intersecting polygons
  // happen easily.
  protected m_gerberUnitInch = false; // true if the gerber units are inches, false for mm
  protected m_gerberUnitFmt = 6; // number of digits in mantissa.
  // usually 6 in Inches and 5 or 6  in mm
  protected m_gerberDisableApertMacros = false; // True to disable Aperture Macro (AM) command,
  // for broken Gerber Readers
  // Regions will be used instead of AM shapes
  protected m_useX2format = true; // Add X2 file header attributes.  If false, attributes
  // will be added as comments.
  protected m_useNetAttributes = true; // In recent gerber files, netlist info can be added.
  // It will be added if this param is true, using X2 or
  // X1 format

  // A list of aperture macros defined "on the fly" because the number of parameters is not
  // defined: this is the case of the macro using the primitive 4 to create a polygon.
  // The number of vertices is not known for free polygonal shapes, and an aperture macro
  // must be created for each specific polygon
  protected m_am_freepoly_list = new APER_MACRO_FREEPOLY_LIST();

  GetPlotterType(): PLOT_FORMAT {
    return PLOT_FORMAT.GERBER;
  }

  static GetDefaultFileExtension(): string {
    return 'gbr';
  }

  /** The clock StartPlot reads (upstream: `wxDateTime::Now()`). */
  SetDate(aDate: Date): void {
    this.m_date = aDate;
  }

  /** The plotted file, once EndPlot has run. */
  text(): string {
    return this.m_final;
  }

  bytes(): Uint8Array {
    return TEXT_ENCODER.encode(this.m_final);
  }

  /** `fmt::print( m_outputFile, … )`. */
  private print(aText: string): void {
    this.m_work.push(aText);
  }

  /** `fmt::println( m_outputFile, … )`. */
  private println(aText: string): void {
    this.m_work.push(`${aText}\n`);
  }

  // RS274X has no dashing, nor colors
  SetDash(_aLineWidth: number, _aLineStyle: LINE_STYLE): void {}

  SetColor(_aColor: Color4d): void {}

  // Currently, aScale and aMirror are not used in gerber plotter
  SetViewport(aOffset: Vec2, aIusPerDecimil: number, _aScale: number, _aMirror: boolean): void {
    // wxASSERT( aMirror == false );
    this.m_plotMirror = false;
    this.m_plotOffset = aOffset;
    // wxASSERT( aScale == 1 );              // aScale parameter is not used in Gerber
    this.m_plotScale = 1; // Plot scale is *always* 1.0

    this.m_IUsPerDecimil = aIusPerDecimil;

    // gives now a default value to iuPerDeviceUnit (because the units of the caller is now known)
    // which could be modified later by calling SetGerberCoordinatesFormat()
    this.m_iuPerDeviceUnit = 10.0 ** this.m_gerberUnitFmt / (this.m_IUsPerDecimil * 10000.0);

    // We don't handle the filmbox, and it's more useful to keep the
    // origin at the origin
    this.m_paperSize = { x: 0, y: 0 };
  }

  /**
   * Selection of Gerber units and resolution (number of digits in mantissa).
   *
   * Should be called only after SetViewport() is called.
   */
  override SetGerberCoordinatesFormat(aResolution: number, aUseInches = false): void {
    this.m_gerberUnitInch = aUseInches;
    this.m_gerberUnitFmt = aResolution;

    this.m_iuPerDeviceUnit = 10.0 ** this.m_gerberUnitFmt / (this.m_IUsPerDecimil * 10000.0);

    if (!this.m_gerberUnitInch) this.m_iuPerDeviceUnit *= 25.4; // gerber output in mm
  }

  UseX2format(aEnable: boolean): void {
    this.m_useX2format = aEnable;
  }

  UseX2NetAttributes(aEnable: boolean): void {
    this.m_useNetAttributes = aEnable;
  }

  /**
   * Disable Aperture Macro (AM) command, only for broken Gerber Readers.
   *
   * Regions will be used instead of AM shapes to draw complex shapes.
   */
  DisableApertMacros(aDisable: boolean): void {
    this.m_gerberDisableApertMacros = aDisable;
  }

  /**
   * Emit a D-Code record, using proper conversions to format a leading zero omitted gerber
   * coordinate.
   */
  protected emitDcode(pt: Vec2, dcode: number): void {
    this.println(`X${KiROUND(pt.x)}Y${KiROUND(pt.y)}D${pad2(dcode)}*`);
  }

  /**
   * Remove (clear) all attributes from object attributes dictionary (TO. and TA commands)
   * similar to clearNetAttribute(), this is an unconditional reset of TO. and TA. attributes.
   */
  ClearAllAttributes(): void {
    // Remove all attributes from object attributes dictionary (TO. and TA commands)
    if (this.m_useX2format) this.println('%TD*%');
    else this.println('G04 #@! TD*');

    this.m_objectAttributesDictionary = '';
  }

  /**
   * Clear a Gerber net attribute record (clear object attribute dictionary)
   * and output the clear object attribute dictionary command to gerber file
   * has effect only if a net attribute is stored in m_objectAttributesDictionary.
   */
  protected clearNetAttribute(): void {
    // disable a Gerber net attribute (exists only in X2 with net attributes mode).
    if (this.m_objectAttributesDictionary === '')
      // No net attribute or not X2 mode
      return;

    // Remove all net attributes from object attributes dictionary
    if (this.m_useX2format) this.println('%TD*%');
    else this.println('G04 #@! TD*');

    this.m_objectAttributesDictionary = '';
  }

  /**
   * Define the beginning of a group of drawing items (used in X2 format with netlist
   * attributes).
   */
  override StartBlock(aData?: unknown): void {
    // Currently, it is the same as EndBlock(): clear all aperture net attributes
    this.EndBlock(aData);
  }

  /** Define the end of a group of drawing items the group is started by StartBlock(). */
  override EndBlock(_aData?: unknown): void {
    // Remove all net attributes from object attributes dictionary
    this.clearNetAttribute();
  }

  /**
   * Print a Gerber net attribute object record.
   *
   * In a gerber file, a net attribute is owned by a graphic object formatNetAttribute must
   * be called before creating the object.  The generated string depends on the type of
   * netlist info.
   */
  protected formatNetAttribute(aData: GBR_NETLIST_METADATA | null): void {
    // print a Gerber net attribute record.
    // it is added to the object attributes dictionary
    // On file, only modified or new attributes are printed.
    if (aData === null) return;

    if (!this.m_useNetAttributes) return;

    const useX1StructuredComment = !this.m_useX2format;

    const clearDict = { value: false };
    const short_attribute_string = { value: '' };
    const dictionary = { value: this.m_objectAttributesDictionary };

    const formatted = FormatNetAttribute(
      short_attribute_string,
      dictionary,
      aData,
      clearDict,
      useX1StructuredComment,
    );

    this.m_objectAttributesDictionary = dictionary.value;

    if (!formatted) return;

    // FormatNetAttribute has already stored the new dictionary (upstream passes
    // m_objectAttributesDictionary by reference), so this prints `%TD*%` and
    // then empties the dictionary it just filled - as upstream does.
    if (clearDict.value) this.clearNetAttribute();

    if (short_attribute_string.value !== '') this.print(short_attribute_string.value);

    if (this.m_useX2format && aData.m_ExtraData !== '') this.print(aData.m_ExtraData);
  }

  StartPlot(_aPageNumber: string): boolean {
    this.m_hasApertureRoundRect = false; // true is at least one round rect aperture is in use
    this.m_hasApertureRotOval = false; // true is at least one oval rotated aperture is in use
    this.m_hasApertureRotRect = false; // true is at least one rect. rotated aperture is in use
    this.m_hasApertureOutline4P = false; // true is at least one rotated rect/trapezoid aperture
    // is in use
    this.m_hasApertureChamferedRect = false; // true is at least one chamfered rect is in use
    this.m_am_freepoly_list.ClearList();

    // wxASSERT( m_outputFile );
    if (!this.m_outputFile) return false;

    // The actual gerber file will be created later: the body goes to the work buffer.
    this.m_work = [];
    this.m_final = '';

    for (const line of this.m_headerExtraLines) {
      if (line !== '') this.println(line);
    }

    // Set coordinate format to 3.6 or 4.5 absolute, leading zero omitted
    // the number of digits for the integer part of coordinates is needed
    // in gerber format, but is not very important when omitting leading zeros
    // It is fixed here to 3 (inch) or 4 (mm), but is not actually used
    const leadingDigitCount = this.m_gerberUnitInch ? 3 : 4;

    this.println(
      `%FSLAX${leadingDigitCount}${this.m_gerberUnitFmt}Y${leadingDigitCount}${this.m_gerberUnitFmt}*%`,
    );
    this.println(
      `G04 Gerber Fmt ${leadingDigitCount}.${this.m_gerberUnitFmt}, Leading zero omitted, Abs format (unit ${this.m_gerberUnitInch ? 'inch' : 'mm'})*`,
    );

    const Title = `${this.m_creator} ${GetBuildVersion()}`;

    // In gerber files, ASCII7 chars only are allowed.
    // So use a ISO date format (using a space as separator between date and time),
    // not a localized date format
    const date = this.m_date ?? new Date();
    this.println(
      `G04 Created by ${GENERATOR_APPLICATION} (${Title}) date ${formatISOCombined(date)}*`,
    );

    /* Mass parameter: unit = IN/MM */
    if (this.m_gerberUnitInch) this.println('%MOIN*%');
    else this.println('%MOMM*%');

    // Be sure the usual dark polarity is selected:
    this.println('%LPD*%');

    // Set initial interpolation mode: always G01 (linear):
    this.println('G01*');

    // Add aperture list start point
    this.println('G04 APERTURE LIST*');

    // Give a minimal value to the default pen size, used to plot items in sketch mode
    if (this.m_renderSettings) {
      const pen_min = Math.trunc((0.1 * this.m_IUsPerDecimil * 10000) / 25.4); // for min width = 0.1 mm
      this.m_renderSettings.SetDefaultPenWidth?.(
        Math.max(this.m_renderSettings.GetDefaultPenWidth(), pen_min),
      );
    }

    return true;
  }

  EndPlot(): boolean {
    // wxASSERT( m_outputFile );

    /* Outfile is actually a temporary file i.e. workFile */
    this.println('M02*');

    const work = this.m_work.join('');
    this.m_work = [];

    let out = '';

    // Placement of apertures in RS274X. fgets() reads line by line, each line
    // keeping its '\n'.
    for (const line of work.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      out += line;

      // strtok( line, "\n\r" ): the first token, i.e. the line up to its first
      // CR or LF, skipping any leading ones.
      const substr = /[^\r\n]+/.exec(line)?.[0];

      if (substr === 'G04 APERTURE LIST*') {
        // Add aperture list macro:
        if (
          this.m_hasApertureRoundRect ||
          this.m_hasApertureRotOval ||
          this.m_hasApertureOutline4P ||
          this.m_hasApertureRotRect ||
          this.m_hasApertureChamferedRect ||
          this.m_am_freepoly_list.AmCount()
        ) {
          out += 'G04 Aperture macros list*\n';

          if (this.m_hasApertureRoundRect) out += APER_MACRO_ROUNDRECT_HEADER;

          if (this.m_hasApertureRotOval) out += APER_MACRO_SHAPE_OVAL_HEADER;

          if (this.m_hasApertureRotRect) out += APER_MACRO_ROT_RECT_HEADER;

          if (this.m_hasApertureOutline4P) out += APER_MACRO_OUTLINE4P_HEADER;

          if (this.m_hasApertureChamferedRect) {
            out += APER_MACRO_OUTLINE5P_HEADER;
            out += APER_MACRO_OUTLINE6P_HEADER;
            out += APER_MACRO_OUTLINE7P_HEADER;
            out += APER_MACRO_OUTLINE8P_HEADER;
          }

          if (this.m_am_freepoly_list.AmCount()) {
            // aperture sizes are in inch or mm, regardless the
            // coordinates format
            let fscale = (0.0001 * this.m_plotScale) / this.m_IUsPerDecimil; // inches

            if (!this.m_gerberUnitInch) fscale *= 25.4; // size in mm

            out += this.m_am_freepoly_list.Format(fscale);
          }

          out += 'G04 Aperture macros list end*\n';
        }

        out += this.writeApertureList();
        out += 'G04 APERTURE END LIST*\n';
      }
    }

    this.m_final = out;
    this.m_outputFile = false;

    return true;
  }

  SetCurrentLineWidth(aWidth: number, aData?: unknown): void {
    let width = aWidth;

    if (width === DO_NOT_SET_LINE_WIDTH) return;
    else if (width === USE_DEFAULT_LINE_WIDTH) width = this.renderSettings().GetDefaultPenWidth();

    // wxASSERT_MSG( aWidth >= 0, "Plotter called to set negative pen width" );

    const gbr_metadata = asMetadata(aData);
    let aperture_attribute = 0;
    let custom_attribute = '';

    if (gbr_metadata) {
      aperture_attribute = gbr_metadata.GetApertureAttrib();
      custom_attribute = gbr_metadata.GetCustomAttribute();
    }

    this.selectAperture(
      { x: width, y: width },
      0,
      ANGLE_0,
      APERTURE_TYPE.AT_PLOTTING,
      aperture_attribute,
      custom_attribute,
    );
    this.m_currentPenWidth = width;
  }

  /**
   * @return an index to the aperture in aperture list which meets the size and type of tool
   *         if the aperture does not exist, it is created and entered in aperture list.
   */
  GetOrCreateAperture(
    aSize: Vec2,
    aRadius: number,
    aRotation: EDA_ANGLE,
    aType: APERTURE_TYPE,
    aApertureAttribute: number,
    aCustomAttribute: string,
  ): number {
    let last_D_code = 9;

    // Search an existing aperture
    for (let idx = 0; idx < this.m_apertures.length; ++idx) {
      const tool = this.m_apertures[idx]!;
      last_D_code = tool.m_DCode;

      if (
        tool.m_Type === aType &&
        vecEq(tool.m_Size, aSize) &&
        tool.m_Radius === aRadius &&
        tool.m_Rotation.equals(aRotation) &&
        tool.m_ApertureAttribute === aApertureAttribute &&
        tool.m_CustomAttribute === aCustomAttribute
      ) {
        return idx;
      }
    }

    // Allocate a new aperture
    const new_tool = new APERTURE();
    new_tool.m_Size = { x: aSize.x, y: aSize.y };
    new_tool.m_Type = aType;
    new_tool.m_Radius = aRadius;
    new_tool.m_Rotation = aRotation;
    new_tool.m_DCode = last_D_code + 1;
    new_tool.m_ApertureAttribute = aApertureAttribute;
    new_tool.m_CustomAttribute = aCustomAttribute;

    this.m_apertures.push(new_tool);

    return this.m_apertures.length - 1;
  }

  /**
   * The polygon overload: an index to the aperture in aperture list which meets the data and
   * type of tool; if the aperture does not exist, it is created and entered in aperture list.
   */
  GetOrCreateApertureCorners(
    aCorners: readonly Vec2[],
    aRotation: EDA_ANGLE,
    aType: APERTURE_TYPE,
    aApertureAttribute: number,
    aCustomAttribute: string,
  ): number {
    let last_D_code = 9;

    // For APERTURE::AM_FREE_POLYGON aperture macros, we need to create the macro
    // on the fly, because due to the fact the vertex count is not a constant we
    // cannot create a static definition.
    if (APERTURE_TYPE.AM_FREE_POLYGON === aType) {
      const idx = this.m_am_freepoly_list.FindAm(aCorners);

      if (idx < 0) this.m_am_freepoly_list.Append(aCorners);
    }

    // Search an existing aperture
    for (let idx = 0; idx < this.m_apertures.length; ++idx) {
      const tool = this.m_apertures[idx]!;

      last_D_code = tool.m_DCode;

      if (
        tool.m_Type === aType &&
        tool.m_Corners.length === aCorners.length &&
        tool.m_Rotation.equals(aRotation) &&
        tool.m_ApertureAttribute === aApertureAttribute &&
        tool.m_CustomAttribute === aCustomAttribute
      ) {
        // A candidate is found. the corner lists must be similar
        const is_same = polyCompare(tool.m_Corners, aCorners);

        if (is_same) return idx;
      }
    }

    // Allocate a new aperture
    const new_tool = new APERTURE();

    new_tool.m_Corners = aCorners.map((c) => ({ x: c.x, y: c.y }));
    new_tool.m_Size = { x: 0, y: 0 }; // Not used
    new_tool.m_Type = aType;
    new_tool.m_Radius = 0; // Not used
    new_tool.m_Rotation = aRotation;
    new_tool.m_DCode = last_D_code + 1;
    new_tool.m_ApertureAttribute = aApertureAttribute;
    new_tool.m_CustomAttribute = aCustomAttribute;

    this.m_apertures.push(new_tool);

    return this.m_apertures.length - 1;
  }

  /**
   * Pick an existing aperture or create a new one, matching the size, type and attributes.
   *
   * Write the DCode selection on gerber file.
   */
  protected selectAperture(
    aSize: Vec2,
    aRadius: number,
    aRotation: EDA_ANGLE,
    aType: APERTURE_TYPE,
    aApertureAttribute: number,
    aCustomAttribute: string,
  ): void {
    const current = this.m_apertures[this.m_currentApertureIdx];

    let change =
      this.m_currentApertureIdx < 0 ||
      current!.m_Type !== aType ||
      !vecEq(current!.m_Size, aSize) ||
      current!.m_Radius !== aRadius ||
      !current!.m_Rotation.equals(aRotation);

    if (!change) {
      change =
        current!.m_ApertureAttribute !== aApertureAttribute ||
        current!.m_CustomAttribute !== aCustomAttribute;
    }

    if (change) {
      // Pick an existing aperture or create a new one
      this.m_currentApertureIdx = this.GetOrCreateAperture(
        aSize,
        aRadius,
        aRotation,
        aType,
        aApertureAttribute,
        aCustomAttribute,
      );
      this.println(`D${this.m_apertures[this.m_currentApertureIdx]!.m_DCode}*`);
    }
  }

  /**
   * Pick an existing aperture or create a new one, matching the corners, rotation,
   * type and attributes (the polygon overload).
   *
   * Write the DCode selection on gerber file.
   */
  protected selectApertureCorners(
    aCorners: readonly Vec2[],
    aRotation: EDA_ANGLE,
    aType: APERTURE_TYPE,
    aApertureAttribute: number,
    aCustomAttribute: string,
  ): void {
    const current = this.m_apertures[this.m_currentApertureIdx];

    let change =
      this.m_currentApertureIdx < 0 ||
      current!.m_Type !== aType ||
      current!.m_Corners.length !== aCorners.length ||
      !current!.m_Rotation.equals(aRotation);

    if (!change) {
      // Compare corner lists
      for (let ii = 0; ii < aCorners.length; ii++) {
        if (!vecEq(aCorners[ii]!, current!.m_Corners[ii]!)) {
          change = true;
          break;
        }
      }
    }

    if (!change) {
      change =
        current!.m_ApertureAttribute !== aApertureAttribute ||
        current!.m_CustomAttribute !== aCustomAttribute;
    }

    if (change) {
      // Pick an existing aperture or create a new one
      this.m_currentApertureIdx = this.GetOrCreateApertureCorners(
        aCorners,
        aRotation,
        aType,
        aApertureAttribute,
        aCustomAttribute,
      );
      this.println(`D${this.m_apertures[this.m_currentApertureIdx]!.m_DCode}*`);
    }
  }

  /** Pick an aperture or create a new one and emits the DCode. */
  protected selectApertureWithAttributes(
    aPos: Vec2,
    aGbrMetadata: GBR_METADATA | null,
    aSize: Vec2,
    aRadius: number,
    aAngle: EDA_ANGLE,
    aType: APERTURE_TYPE,
  ): void {
    const pos_dev = this.userToDeviceCoordinates(aPos);

    let aperture_attribute = 0;
    let custom_attribute = '';

    if (aGbrMetadata) {
      aperture_attribute = aGbrMetadata.GetApertureAttrib();
      custom_attribute = aGbrMetadata.GetCustomAttribute();
    }

    this.selectAperture(aSize, aRadius, aAngle, aType, aperture_attribute, custom_attribute);

    if (aGbrMetadata) this.formatNetAttribute(aGbrMetadata.m_NetlistMetadata);

    this.emitDcode(pos_dev, 3);
  }

  /** Generate the table of D codes. */
  protected writeApertureList(): string {
    let out = '';

    let useX1StructuredComment = false;

    if (!this.m_useX2format) useX1StructuredComment = true;

    // Init
    for (const tool of this.m_apertures) {
      // aperture sizes are in inch or mm, regardless the
      // coordinates format
      let fscale = (0.0001 * this.m_plotScale) / this.m_IUsPerDecimil; // inches

      if (!this.m_gerberUnitInch) fscale *= 25.4; // size in mm

      const attribute = tool.m_ApertureAttribute;

      if (attribute !== this.m_apertureAttribute) {
        out += GBR_APERTURE_METADATA.FormatAttribute(
          attribute,
          useX1StructuredComment,
          tool.m_CustomAttribute,
        );
      }

      out += `%ADD${tool.m_DCode}`;

      /* Please note: the Gerber specs for mass parameters say that
         exponential syntax is *not* allowed and the decimal point should
         also be always inserted. So the %g format is ruled out, but %f is fine
         (the # modifier forces the decimal point). Sadly the %f formatter
         can't remove trailing zeros but that's not a problem, since nothing
         forbid it (the file is only slightly longer) */
      const f = (v: number): string => fixed(v, 6);

      switch (tool.m_Type) {
        case APERTURE_TYPE.AT_CIRCLE:
          out += `C,${f(tool.GetDiameter() * fscale)}*%\n`;
          break;

        case APERTURE_TYPE.AT_RECT:
          out += `R,${f(tool.m_Size.x * fscale)}X${f(tool.m_Size.y * fscale)}*%\n`;
          break;

        case APERTURE_TYPE.AT_PLOTTING:
          out += `C,${f(tool.m_Size.x * fscale)}*%\n`;
          break;

        case APERTURE_TYPE.AT_OVAL:
          out += `O,${f(tool.m_Size.x * fscale)}X${f(tool.m_Size.y * fscale)}*%\n`;
          break;

        case APERTURE_TYPE.AT_REGULAR_POLY:
        case APERTURE_TYPE.AT_REGULAR_POLY3:
        case APERTURE_TYPE.AT_REGULAR_POLY4:
        case APERTURE_TYPE.AT_REGULAR_POLY5:
        case APERTURE_TYPE.AT_REGULAR_POLY6:
        case APERTURE_TYPE.AT_REGULAR_POLY7:
        case APERTURE_TYPE.AT_REGULAR_POLY8:
        case APERTURE_TYPE.AT_REGULAR_POLY9:
        case APERTURE_TYPE.AT_REGULAR_POLY10:
        case APERTURE_TYPE.AT_REGULAR_POLY11:
        case APERTURE_TYPE.AT_REGULAR_POLY12:
          out += `P,${f(tool.GetDiameter() * fscale)}X${tool.GetRegPolyVerticeCount()}X${f(tool.GetRotation().AsDegrees())}*%\n`;
          break;

        case APERTURE_TYPE.AM_ROUND_RECT: {
          // Aperture macro for round rect pads
          // The aperture macro needs coordinates of the centers of the 4 corners
          const half_size = {
            x: Math.trunc(tool.m_Size.x / 2) - tool.m_Radius,
            y: Math.trunc(tool.m_Size.y / 2) - tool.m_Radius,
          };

          // Ensure half_size.x and half_size.y > minimal value to avoid shapes
          // with null size (especially the rectangle with coordinates corners)
          // Because the minimal value for a non nul Gerber coord in 10nm
          // in format 4.5, use 10 nm as minimal value.
          // (Even in 4.6 format, use 10 nm, because gerber viewers can have
          // a internal unit bigger than 1 nm)
          const min_size_value = 10;
          half_size.x = Math.max(half_size.x, min_size_value);
          half_size.y = Math.max(half_size.y, min_size_value);

          // Rotate the corner coordinates:
          const corners: Vec2[] = [
            { x: -half_size.x, y: -half_size.y },
            { x: half_size.x, y: -half_size.y },
            { x: half_size.x, y: half_size.y },
            { x: -half_size.x, y: half_size.y },
          ].map((c) => RotatePoint(c, tool.m_Rotation.negate()));

          out += `${APER_MACRO_ROUNDRECT_NAME},${f(tool.m_Radius * fscale)}X`;

          // Add each corner
          for (let ii = 0; ii < 4; ii++)
            out += `${f(corners[ii]!.x * fscale)}X${f(corners[ii]!.y * fscale)}X`;

          out += '0*%\n';
          break;
        }

        case APERTURE_TYPE.AM_ROT_RECT: // Aperture macro for rotated rect pads
          out += `${APER_MACRO_ROT_RECT_NAME},${f(tool.m_Size.x * fscale)}X${f(tool.m_Size.y * fscale)}X${f(tool.m_Rotation.AsDegrees())}*%\n`;
          break;

        case APERTURE_TYPE.APER_MACRO_OUTLINE4P: // Aperture macro for trapezoid pads
        case APERTURE_TYPE.APER_MACRO_OUTLINE5P: // Aperture macro for chamfered rect pads
        case APERTURE_TYPE.APER_MACRO_OUTLINE6P: // Aperture macro for chamfered rect pads
        case APERTURE_TYPE.APER_MACRO_OUTLINE7P: // Aperture macro for chamfered rect pads
        case APERTURE_TYPE.APER_MACRO_OUTLINE8P: // Aperture macro for chamfered rect pads
          switch (tool.m_Type) {
            case APERTURE_TYPE.APER_MACRO_OUTLINE4P:
              out += APER_MACRO_OUTLINE4P_NAME;
              break;
            case APERTURE_TYPE.APER_MACRO_OUTLINE5P:
              out += APER_MACRO_OUTLINE5P_NAME;
              break;
            case APERTURE_TYPE.APER_MACRO_OUTLINE6P:
              out += APER_MACRO_OUTLINE6P_NAME;
              break;
            case APERTURE_TYPE.APER_MACRO_OUTLINE7P:
              out += APER_MACRO_OUTLINE7P_NAME;
              break;
            case APERTURE_TYPE.APER_MACRO_OUTLINE8P:
              out += APER_MACRO_OUTLINE8P_NAME;
              break;
            default:
              break;
          }

          // Add separator after aperture macro name
          out += ',';

          // Output all corners (should be 4 to 8 corners)
          // Remember: the Y coordinate must be negated, due to the fact in Pcbnew
          // the Y axis is from top to bottom
          // (`-corner.y` negates an int, so a zero stays a positive zero.)
          for (const corner of tool.m_Corners)
            out += `${f(corner.x * fscale)}X${f((0 - corner.y) * fscale)}X`;

          // close outline and output rotation
          out += `${f(tool.m_Rotation.AsDegrees())}*%\n`;
          break;

        case APERTURE_TYPE.AM_ROTATED_OVAL: {
          // Aperture macro for rotated oval pads
          // (not rotated is a primitive)
          // m_Size.x = full length; m_Size.y = width, and the macro aperture expects
          // the position of ends
          // the seg_len is the distance between the 2 circle centers
          const seg_len = tool.m_Size.x - tool.m_Size.y;

          // Center of the circle on the segment start point:
          const start = RotatePoint({ x: Math.trunc(seg_len / 2), y: 0 }, tool.m_Rotation);

          // Center of the circle on the segment end point:
          const end = RotatePoint({ x: -Math.trunc(seg_len / 2), y: 0 }, tool.m_Rotation);

          out +=
            `${APER_MACRO_SHAPE_OVAL_NAME},${f(tool.m_Size.y * fscale)}X` + // width
            `${f(start.x * fscale)}X${f((0 - start.y) * fscale)}X` + // X,Y corner start pos
            `${f(end.x * fscale)}X${f((0 - end.y) * fscale)}X0*%\n`; // X,Y corner end pos
          break;
        }

        case APERTURE_TYPE.AM_FREE_POLYGON: {
          // Find the aperture macro name in the list of aperture macro
          // created on the fly for this polygon:
          const idx = this.m_am_freepoly_list.FindAm(tool.m_Corners);

          // Write DCODE id ( "%ADDxx" is already in buffer) and rotation
          // the full line is something like :%ADD12FreePoly1,45.000000*%
          out += `${AM_FREEPOLY_BASENAME}${idx},${f(tool.m_Rotation.AsDegrees())}*%\n`;
          break;
        }
      }

      this.m_apertureAttribute = attribute;

      // Currently reset the aperture attribute. Perhaps a better optimization
      // is to store the last attribute
      if (attribute) {
        if (this.m_useX2format) out += '%TD*%\n';
        else out += 'G04 #@! TD*\n';

        this.m_apertureAttribute = 0;
      }
    }

    return out;
  }

  PenTo(aPos: Vec2, plume: PEN_PLUME): void {
    // wxASSERT( m_outputFile );
    const pos_dev = this.userToDeviceCoordinates(aPos);

    switch (plume) {
      case 'Z':
        break;

      case 'U':
        this.emitDcode(pos_dev, 2);
        break;

      case 'D':
        this.emitDcode(pos_dev, 1);
    }

    this.m_penState = plume;
  }

  // Note: do not use Rect() to plot rounded-corner rectangles.  Use PlotPolyAsRegion() instead.
  Rect(p1: Vec2, p2: Vec2, fill: FILL_T, width: number, _aCornerRadius = 0): void {
    // aCornerRadius > 0: wxFAIL_MSG( "GERBER_PLOTTER must use PlotPolyAsRegion() for
    // rounded-corner rectangles!" ), and the square corners are plotted regardless.
    const cornerList: Vec2[] = [];

    // Build corners list
    cornerList.push(p1);

    cornerList.push({ x: p1.x, y: p2.y });
    cornerList.push(p2);
    cornerList.push({ x: p2.x, y: p1.y });
    cornerList.push(p1);

    this.PlotPoly(cornerList, fill, width, null);
  }

  Circle(aCenter: Vec2, aDiameter: number, aFill: FILL_T, aWidth: number): void {
    const radius = Math.trunc(aDiameter / 2);

    this.Arc(aCenter, ANGLE_0, ANGLE_180, radius, aFill, aWidth);
    this.Arc(aCenter, ANGLE_180, ANGLE_180, radius, aFill, aWidth);
  }

  override Arc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aFill: FILL_T,
    aWidth: number,
  ): void {
    this.SetCurrentLineWidth(aWidth);

    const arcLength = Math.abs(aRadius * aAngle.AsRadians());

    if (arcLength < 100 || Math.abs(aAngle.AsDegrees()) < 0.1) {
      // Prevent plotting very short arcs as full circles, especially with 4.5 mm precision.
      // Also reduce the risk of integer overflow issues.
      this.polyArc(aCenter, aStartAngle, aAngle, aRadius, aFill, this.GetCurrentLineWidth());
    } else {
      const endAngle = aStartAngle.add(aAngle);

      // aFill is not used here.
      this.plotArc(toVector2I(aCenter), aStartAngle, endAngle, aRadius, false);
    }
  }

  /**
   * Plot a Gerber arc (the SHAPE_ARC overload).
   *
   * If aPlotInRegion = true, the current pen position will not be initialized to the arc
   * start position, and therefore the arc can be used to define a region outline item
   * a line will be created from current position to arc start point.  If aPlotInRegion
   * = false, the current pen position will be initialized to the arc start position, to
   * plot an usual arc item.  The line thickness is not initialized in plotArc, and must
   * be initialized before calling it if needed.
   */
  protected plotArcShape(aArc: SHAPE_ARC, aPlotInRegion: boolean): void {
    const start = aArc.GetP0();
    const end = aArc.GetP1();
    const center = aArc.GetCenter();

    if (!aPlotInRegion) this.MoveTo(start);
    else this.LineTo(start);

    const devEnd = this.userToDeviceCoordinates(end);

    // devRelCenter is the position on arc center relative to the arc start, in Gerber coord.
    // Warning: it is **not** userToDeviceCoordinates( center -  start ) when the plotter
    // has an offset.
    const devCenter = this.userToDeviceCoordinates(center);
    const devStart = this.userToDeviceCoordinates(start);
    const devRelCenter = { x: devCenter.x - devStart.x, y: devCenter.y - devStart.y };

    // We need to know if the arc is CW or CCW in device coordinates, so build this arc.
    const deviceArc = new SHAPE_ARC(
      toVector2I(devStart),
      toVector2I(this.userToDeviceCoordinates(aArc.GetArcMid())),
      toVector2I(devEnd),
      0,
    );

    this.println('G75*'); // Multiquadrant (360 degrees) mode

    if (deviceArc.IsClockwise())
      this.println('G02*'); // Active circular interpolation, CW
    else this.println('G03*'); // Active circular interpolation, CCW

    this.println(
      `X${KiROUND(devEnd.x)}Y${KiROUND(devEnd.y)}I${KiROUND(devRelCenter.x)}J${KiROUND(devRelCenter.y)}D01*`,
    );

    this.println('G01*'); // Back to linear interpolate (perhaps useless here).
  }

  /** Plot a Gerber arc (the centre / angles overload). See {@link plotArcShape}. */
  protected plotArc(
    aCenter: Vec2,
    aStartAngle: EDA_ANGLE,
    aEndAngle: EDA_ANGLE,
    aRadius: number,
    aPlotInRegion: boolean,
  ): void {
    const start = {
      x: KiROUND(aCenter.x + aRadius * aStartAngle.Cos()),
      y: KiROUND(aCenter.y + aRadius * aStartAngle.Sin()),
    };

    if (!aPlotInRegion) this.MoveTo(start);
    else this.LineTo(start);

    const end = {
      x: KiROUND(aCenter.x + aRadius * aEndAngle.Cos()),
      y: KiROUND(aCenter.y + aRadius * aEndAngle.Sin()),
    };
    const devEnd = this.userToDeviceCoordinates(end);

    // devRelCenter is the position on arc center relative to the arc start, in Gerber coord.
    const devCenter = this.userToDeviceCoordinates(aCenter);
    const devStart = this.userToDeviceCoordinates(start);
    const devRelCenter = { x: devCenter.x - devStart.x, y: devCenter.y - devStart.y };

    this.println('G75*'); // Multiquadrant (360 degrees) mode

    if (aStartAngle.gt(aEndAngle))
      this.println('G03*'); // Active circular interpolation, CCW
    else this.println('G02*'); // Active circular interpolation, CW

    this.println(
      `X${KiROUND(devEnd.x)}Y${KiROUND(devEnd.y)}I${KiROUND(devRelCenter.x)}J${KiROUND(devRelCenter.y)}D01*`,
    );

    this.println('G01*'); // Back to linear interpolate (perhaps useless here).
  }

  /**
   * Plot a Gerber region (the SHAPE_LINE_CHAIN overload): similar to PlotPoly but plot only
   * filled polygon, and add the TA.AperFunction if aGbrMetadata contains this attribute, and
   * clear it after plotting.
   */
  PlotGerberRegionLineChain(aPoly: SHAPE_LINE_CHAIN, aGbrMetadata: GBR_METADATA | null): void {
    if (aPoly.PointCount() <= 2) return;

    let clearTA_AperFunction = false; // true if a TA.AperFunction is used

    if (aGbrMetadata) {
      const attrib = aGbrMetadata.m_ApertureMetadata.FormatAttribute(!this.m_useX2format);

      if (attrib !== '') {
        this.print(attrib);
        clearTA_AperFunction = true;
      }
    }

    this.PlotPolyLineChain(aPoly, FILL_T.FILLED_SHAPE, 0, aGbrMetadata);

    // Clear the TA attribute, to avoid the next item to inherit it:
    if (clearTA_AperFunction) {
      if (this.m_useX2format) this.println('%TD.AperFunction*%');
      else this.println('G04 #@! TD.AperFunction*');
    }
  }

  /**
   * Plot a Gerber region: similar to PlotPoly but plot only filled polygon,
   * and add the TA.AperFunction if aGbrMetadata contains this attribute, and clear it
   * after plotting.
   */
  PlotGerberRegion(aCornerList: readonly Vec2[], aGbrMetadata: GBR_METADATA | null): void {
    if (aCornerList.length <= 2) return;

    let clearTA_AperFunction = false; // true if a TA.AperFunction is used

    if (aGbrMetadata) {
      const attrib = aGbrMetadata.m_ApertureMetadata.FormatAttribute(!this.m_useX2format);

      if (attrib !== '') {
        this.print(attrib);
        clearTA_AperFunction = true;
      }
    }

    this.PlotPoly(aCornerList, FILL_T.FILLED_SHAPE, 0, aGbrMetadata);

    // Clear the TA attribute, to avoid the next item to inherit it:
    if (clearTA_AperFunction) {
      if (this.m_useX2format) this.println('%TD.AperFunction*%');
      else this.println('G04 #@! TD.AperFunction*');
    }
  }

  /**
   * Similar to PlotPoly(), plot a filled polygon using Gerber region,
   * therefore adding X2 attributes to the region object, like TA.xxx
   */
  PlotPolyAsRegion(
    aPoly: SHAPE_LINE_CHAIN,
    aFill: FILL_T,
    aWidth: number,
    aGbrMetadata: GBR_METADATA | null,
  ): void {
    // plot a filled polygon using Gerber region, therefore adding X2 attributes
    // to the solid polygon
    if (aWidth || aFill === FILL_T.NO_FILL)
      this.PlotPolyLineChain(aPoly, FILL_T.NO_FILL, aWidth, aGbrMetadata);

    if (aFill !== FILL_T.NO_FILL) this.PlotGerberRegionLineChain(aPoly, aGbrMetadata);
  }

  /** `PlotPoly( const SHAPE_LINE_CHAIN&, … )`: arcs in the chain plot as Gerber arcs. */
  override PlotPolyLineChain(
    aPoly: SHAPE_LINE_CHAIN,
    aFill: FILL_T,
    aWidth: number,
    aData?: unknown,
  ): void {
    if (aPoly.CPoints().length <= 1) return;

    // Gerber format does not know filled polygons with thick outline
    // Therefore, to plot a filled polygon with outline having a thickness,
    // one should plot outline as thick segments
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    const first = aPoly.CPoint(0);
    const last = aPoly.CLastPoint();

    if (aFill !== FILL_T.NO_FILL) {
      this.println('G36*');

      this.MoveTo(first);

      this.println('G01*'); // Set linear interpolation.

      for (let ii = 1; ii < aPoly.PointCount(); ii++) {
        const arcindex = aPoly.ArcIndex(ii);

        if (arcindex < 0) {
          /// Plain point
          this.LineTo(aPoly.CPoint(ii));
        } else {
          const arc = aPoly.Arc(arcindex);

          this.plotArcShape(arc, true);

          // skip points on arcs, since we plot the arc itself
          while (ii + 1 < aPoly.PointCount() && arcindex === aPoly.ArcIndex(ii + 1)) ii++;
        }
      }

      // If the polygon is not closed, close it:
      if (!vecEq(first, last)) this.FinishTo(first);

      this.println('G37*');
    } else if (aWidth !== 0) {
      // Draw the polyline/polygon outline
      this.SetCurrentLineWidth(aWidth, gbr_metadata);

      this.MoveTo(first);

      for (let ii = 1; ii < aPoly.PointCount(); ii++) {
        const arcindex = aPoly.ArcIndex(ii);

        if (arcindex < 0) {
          /// Plain point
          this.LineTo(aPoly.CPoint(ii));
        } else {
          const arc = aPoly.Arc(arcindex);

          this.plotArcShape(arc, true);

          // skip points on arcs, since we plot the arc itself
          while (ii + 1 < aPoly.PointCount() && arcindex === aPoly.ArcIndex(ii + 1)) ii++;
        }
      }

      // Ensure the thick outline is closed for filled polygons
      // (if not filled, could be only a polyline)
      if (!vecEq(first, last) && (aPoly.IsClosed() || aFill !== FILL_T.NO_FILL)) this.LineTo(first);

      this.PenFinish();
    }
  }

  /**
   * Gerber polygon: they can (and *should*) be filled with the
   * appropriate G36/G37 sequence
   */
  PlotPoly(aCornerList: readonly Vec2[], aFill: FILL_T, aWidth: number, aData?: unknown): void {
    if (aCornerList.length <= 1) return;

    // Gerber format does not know filled polygons with thick outline
    // Therefore, to plot a filled polygon with outline having a thickness,
    // one should plot outline as thick segments
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    const first = aCornerList[0]!;
    const last = aCornerList[aCornerList.length - 1]!;

    if (aFill !== FILL_T.NO_FILL) {
      this.println('G36*');

      this.MoveTo(first);
      this.println('G01*'); // Set linear interpolation.

      for (let ii = 1; ii < aCornerList.length; ii++) this.LineTo(aCornerList[ii]!);

      // If the polygon is not closed, close it:
      if (!vecEq(first, last)) this.FinishTo(first);

      this.println('G37*');
    }

    if (aWidth !== 0 || aFill === FILL_T.NO_FILL) {
      // Draw the polyline/polygon outline
      this.SetCurrentLineWidth(aWidth, gbr_metadata);

      this.MoveTo(first);

      for (let ii = 1; ii < aCornerList.length; ii++) this.LineTo(aCornerList[ii]!);

      // Ensure the thick outline is closed for filled polygons
      // (if not filled, could be only a polyline)
      if (aFill !== FILL_T.NO_FILL && !vecEq(last, first)) this.LineTo(first);

      this.PenFinish();
    }
  }

  override ThickSegment(start: Vec2, end: Vec2, width: number, aData?: unknown): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.SetCurrentLineWidth(width, aData);

    // A zero-length segment is plotted as a single flash of the segment's aperture.
    // Falling through to PLOTTER::ThickSegment would emit a filled circle stroked with
    // the (now sentinel) DO_NOT_SET_LINE_WIDTH width, creating a spurious 0-size aperture.
    if (vecEq(start, end)) {
      this.MoveTo(start);
      this.FinishTo(end);
      return;
    }

    super.ThickSegment(start, end, DO_NOT_SET_LINE_WIDTH, aData);
  }

  override ThickArc(
    aCentre: Vec2,
    aStartAngle: EDA_ANGLE,
    aAngle: EDA_ANGLE,
    aRadius: number,
    aWidth: number,
    aData?: unknown,
  ): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.SetCurrentLineWidth(aWidth, aData);
    super.ThickArc(aCentre, aStartAngle, aAngle, aRadius, DO_NOT_SET_LINE_WIDTH, aData);
  }

  override ThickRect(p1: Vec2, p2: Vec2, width: number, aData?: unknown): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.SetCurrentLineWidth(width, aData);
    super.ThickRect(p1, p2, DO_NOT_SET_LINE_WIDTH, aData);
  }

  override ThickCircle(pos: Vec2, diametre: number, width: number, aData?: unknown): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.SetCurrentLineWidth(width, aData);
    super.ThickCircle(pos, diametre, DO_NOT_SET_LINE_WIDTH, aData);
  }

  override FilledCircle(pos: Vec2, diametre: number, aData?: unknown): void {
    // A filled circle is a graphic item, not a pad.
    // So it is drawn, not flashed.
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    // Draw a circle of diameter = diameter/2 with a line thickness = radius,
    // To create a filled circle
    this.SetCurrentLineWidth(Math.trunc(diametre / 2), aData);
    this.Circle(pos, Math.trunc(diametre / 2), FILL_T.NO_FILL, DO_NOT_SET_LINE_WIDTH);
  }

  override ThickPoly(aPoly: SHAPE_POLY_SET, aWidth: number, aData?: unknown): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.SetCurrentLineWidth(aWidth, aData);
    super.ThickPoly(aPoly, DO_NOT_SET_LINE_WIDTH, aData);
  }

  /** Filled circular flashes are stored as apertures. */
  FlashPadCircle(pos: Vec2, diametre: number, aData?: unknown): void {
    const size = { x: diametre, y: diametre };
    const gbr_metadata = asMetadata(aData);

    this.selectApertureWithAttributes(pos, gbr_metadata, size, 0, ANGLE_0, APERTURE_TYPE.AT_CIRCLE);
  }

  FlashPadOval(aPos: Vec2, aSize: Vec2, aOrient: EDA_ANGLE, aData?: unknown): void {
    // wxASSERT( m_outputFile );
    const size = { x: aSize.x, y: aSize.y };
    let orient = aOrient.Clone();
    orient.Normalize();
    const gbr_metadata = asMetadata(aData);

    // Flash a vertical or horizontal shape (this is a basic aperture).
    if (orient.IsCardinal()) {
      if (orient.IsCardinal90()) [size.x, size.y] = [size.y, size.x];

      this.selectApertureWithAttributes(
        aPos,
        gbr_metadata,
        size,
        0,
        ANGLE_0,
        APERTURE_TYPE.AT_OVAL,
      );
    } else {
      // Plot pad as region.
      // Only regions and flashed items accept a object attribute TO.P for the pin name
      if (!this.m_gerberDisableApertMacros) {
        this.m_hasApertureRotOval = true;
        // We are using a aperture macro that expect size.y < size.x
        // i.e draw a horizontal line for rotation = 0.0
        // size.x = length, size.y = width
        if (size.x < size.y) {
          [size.x, size.y] = [size.y, size.x];
          orient = orient.add(ANGLE_90);

          if (orient.gt(ANGLE_180)) orient = orient.sub(ANGLE_180);
        }

        this.selectApertureWithAttributes(
          aPos,
          gbr_metadata,
          size,
          0,
          orient,
          APERTURE_TYPE.AM_ROTATED_OVAL,
        );
        return;
      }

      // Draw the oval as round rect pad with a radius = 50% min size)
      // In gerber file, it will be drawn as a region with arcs, and can be
      // detected as pads (similar to a flashed pad)
      this.FlashPadRoundRect(
        aPos,
        aSize,
        Math.trunc(Math.min(aSize.x, aSize.y) / 2),
        orient,
        aData,
      );
    }
  }

  FlashPadRect(pos: Vec2, aSize: Vec2, aOrient: EDA_ANGLE, aData?: unknown): void {
    // wxASSERT( m_outputFile );
    const size = { x: aSize.x, y: aSize.y };
    const gbr_metadata = asMetadata(aData);

    // Horizontal / vertical rect can use a basic aperture (not a macro)
    // so use it for rotation n*90 deg
    if (aOrient.IsCardinal()) {
      // Build the not rotated equivalent shape:
      if (aOrient.IsCardinal90()) [size.x, size.y] = [size.y, size.x];

      this.selectApertureWithAttributes(pos, gbr_metadata, size, 0, ANGLE_0, APERTURE_TYPE.AT_RECT);
    } else if (!this.m_gerberDisableApertMacros) {
      this.m_hasApertureRotRect = true;

      this.selectApertureWithAttributes(
        pos,
        gbr_metadata,
        size,
        0,
        aOrient,
        APERTURE_TYPE.AM_ROT_RECT,
      );
    } else {
      // plot pad shape as Gerber region
      // coord[0] is assumed the lower left
      // coord[1] is assumed the upper left
      // coord[2] is assumed the upper right
      // coord[3] is assumed the lower right
      const hx = Math.trunc(size.x / 2);
      const hy = Math.trunc(size.y / 2);
      const coord: Vec2[] = [
        { x: -hx, y: hy }, // lower left
        { x: -hx, y: -hy }, // upper left
        { x: hx, y: -hy }, // upper right
        { x: hx, y: hy }, // lower right
      ];

      this.FlashPadTrapez(pos, coord, aOrient, aData);
    }
  }

  FlashPadRoundRect(
    aPadPos: Vec2,
    aSize: Vec2,
    aCornerRadius: number,
    aOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const gbr_metadata = asMetadata(aData);

    if (!this.m_gerberDisableApertMacros) {
      this.m_hasApertureRoundRect = true;

      this.selectApertureWithAttributes(
        aPadPos,
        gbr_metadata,
        aSize,
        aCornerRadius,
        aOrient,
        APERTURE_TYPE.AM_ROUND_RECT,
      );
      return;
    }

    // A Pad RoundRect is plotted as a Gerber region.
    // Initialize region metadata:
    let clearTA_AperFunction = false; // true if a TA.AperFunction is used

    if (gbr_metadata) {
      this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);
      const attrib = gbr_metadata.m_ApertureMetadata.FormatAttribute(!this.m_useX2format);

      if (attrib !== '') {
        this.print(attrib);
        clearTA_AperFunction = true;
      }
    }

    // Plot the region using arcs in corners.
    this.plotRoundRectAsRegion(aPadPos, aSize, aCornerRadius, aOrient);

    // Clear the TA attribute, to avoid the next item to inherit it:
    if (clearTA_AperFunction) {
      if (this.m_useX2format) this.println('%TD.AperFunction*%');
      else this.println('G04 #@! TD.AperFunction*');
    }
  }

  /**
   * Plot a round rect (a round rect shape in fact) as a Gerber region using lines and arcs
   * for corners.
   *
   * @note Only the G36 ... G37 region is created.
   */
  protected plotRoundRectAsRegion(
    aRectCenter: Vec2,
    aSize: Vec2,
    aCornerRadius: number,
    aOrient: EDA_ANGLE,
  ): void {
    // The region outline is generated by 4 sides and 4 90 deg arcs
    //  1 --- 2
    //  |  c  |
    //  4 --- 3

    // Note also in user coordinates the Y axis is from top to bottom
    // for historical reasons.

    // A helper structure to handle outlines coordinates (segments and arcs)
    // in user coordinates
    interface RR_EDGE {
      m_start: Vec2;
      m_end: Vec2;
      m_center: Vec2;
      m_arc_angle_start: EDA_ANGLE;
    }

    const hsizeX = Math.trunc(aSize.x / 2);
    const hsizeY = Math.trunc(aSize.y / 2);

    const rr_outline: RR_EDGE[] = [];

    // Build outline coordinates, relative to rectangle center, rotation 0:

    // Top left corner 1 (and 4 to 1 left vertical side @ x=-hsizeX)
    rr_outline.push({
      m_start: { x: -hsizeX, y: hsizeY - aCornerRadius },
      m_end: { x: -hsizeX, y: -hsizeY + aCornerRadius },
      m_center: { x: -hsizeX + aCornerRadius, y: -hsizeY + aCornerRadius },
      m_arc_angle_start: aOrient.add(ANGLE_180),
    });

    // Top right corner 2 (and 1 to 2 top horizontal side @ y=-hsizeY)
    rr_outline.push({
      m_start: { x: -hsizeX + aCornerRadius, y: -hsizeY },
      m_end: { x: hsizeX - aCornerRadius, y: -hsizeY },
      m_center: { x: hsizeX - aCornerRadius, y: -hsizeY + aCornerRadius },
      m_arc_angle_start: aOrient.add(ANGLE_90),
    });

    // bottom right corner 3 (and 2 to 3 right vertical side @ x=hsizeX)
    rr_outline.push({
      m_start: { x: hsizeX, y: -hsizeY + aCornerRadius },
      m_end: { x: hsizeX, y: hsizeY - aCornerRadius },
      m_center: { x: hsizeX - aCornerRadius, y: hsizeY - aCornerRadius },
      m_arc_angle_start: aOrient.add(ANGLE_0),
    });

    // bottom left corner 4 (and 3 to 4 bottom horizontal side @ y=hsizeY)
    const curr_edge: RR_EDGE = {
      m_start: { x: hsizeX - aCornerRadius, y: hsizeY },
      m_end: { x: -hsizeX + aCornerRadius, y: hsizeY },
      m_center: { x: -hsizeX + aCornerRadius, y: hsizeY - aCornerRadius },
      m_arc_angle_start: aOrient.sub(ANGLE_90),
    };
    rr_outline.push(curr_edge);

    // Move relative coordinates to the actual location and rotation:
    let arc_last_center: Vec2 = { x: 0, y: 0 };
    const arc_last_angle = curr_edge.m_arc_angle_start.sub(ANGLE_90);

    for (const rr_edge of rr_outline) {
      const s = RotatePoint(rr_edge.m_start, aOrient);
      const e = RotatePoint(rr_edge.m_end, aOrient);
      const c = RotatePoint(rr_edge.m_center, aOrient);
      rr_edge.m_start = { x: s.x + aRectCenter.x, y: s.y + aRectCenter.y };
      rr_edge.m_end = { x: e.x + aRectCenter.x, y: e.y + aRectCenter.y };
      rr_edge.m_center = { x: c.x + aRectCenter.x, y: c.y + aRectCenter.y };
      arc_last_center = rr_edge.m_center;
    }

    // Ensure the region is a closed polygon, i.e. the end point of last segment
    // (end of arc) is the same as the first point. Rounding issues can create a
    // small difference, mainly for rotated pads.
    // calculate last point (end of last arc):
    const last_pt = {
      x: arc_last_center.x + KiROUND(aCornerRadius * arc_last_angle.Cos()),
      y: arc_last_center.y - KiROUND(aCornerRadius * arc_last_angle.Sin()),
    };

    this.println('G36*'); // Start region
    this.println('G01*'); // Set linear interpolation.
    const first_pt = last_pt;
    this.MoveTo(first_pt); // Start point of region, must be same as end point

    for (const rr_edge of rr_outline) {
      if (aCornerRadius) {
        // Guard: ensure we do not create arcs with radius = 0
        // LineTo( rr_edge.m_end ); // made in plotArc()
        this.plotArc(
          rr_edge.m_center,
          rr_edge.m_arc_angle_start.negate(),
          rr_edge.m_arc_angle_start.negate().add(ANGLE_90),
          aCornerRadius,
          true,
        );
      } else {
        this.LineTo(rr_edge.m_end);
      }
    }

    this.println('G37*'); // Close region
  }

  FlashPadCustom(
    aPadPos: Vec2,
    _aSize: Vec2,
    aOrient: EDA_ANGLE,
    aPolygons: SHAPE_POLY_SET,
    aData?: unknown,
  ): void {
    // A Pad custom is plotted as polygon (a region in Gerber language).
    const source = asMetadata(aData);
    const gbr_metadata = source ? source.Clone() : new GBR_METADATA();

    const polyshape = aPolygons.CloneDropTriangulation();

    for (let cnt = 0; cnt < polyshape.OutlineCount(); ++cnt) {
      const poly = polyshape.Outline(cnt);

      const cornerList: Vec2[] = [];

      for (let ii = 0; ii < poly.PointCount(); ++ii) {
        const p = poly.CPoint(ii);
        cornerList.push({ x: p.x, y: p.y });
      }

      // Close polygon
      cornerList.push(cornerList[0]!);

      if (
        this.m_gerberDisableApertMacros ||
        cornerList.length > GBR_MACRO_FOR_CUSTOM_PAD_MAX_CORNER_COUNT
      ) {
        this.PlotGerberRegion(cornerList, gbr_metadata);
      } else {
        // An AM will be created. the shape must be in position 0,0 and orientation 0
        // to be able to reuse the same AM for pads having the same shape
        for (let ii = 0; ii < cornerList.length; ii++) {
          const rel = { x: cornerList[ii]!.x - aPadPos.x, y: cornerList[ii]!.y - aPadPos.y };
          cornerList[ii] = RotatePoint(rel, aOrient.negate());
        }

        const pos_dev = this.userToDeviceCoordinates(aPadPos);
        this.selectApertureCorners(
          cornerList,
          aOrient,
          APERTURE_TYPE.AM_FREE_POLYGON,
          gbr_metadata.GetApertureAttrib(),
          gbr_metadata.GetCustomAttribute(),
        );
        this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

        this.emitDcode(pos_dev, 3);
      }
    }
  }

  /**
   * Flash a chamfered round rect pad.
   *
   * @param aChamferPositions is the identifier of the corners to chamfer:
   *  0 = no chamfer, 1 = TOP_LEFT, 2 = TOP_RIGHT, 4 = BOTTOM_LEFT, 8 = BOTTOM_RIGHT
   */
  FlashPadChamferRoundRect(
    aShapePos: Vec2,
    aPadSize: Vec2,
    aCornerRadius: number,
    aChamferRatio: number,
    aChamferPositions: number,
    aPadOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const source = asMetadata(aData);
    const gbr_metadata = source ? source.Clone() : new GBR_METADATA();

    const pos_device = this.userToDeviceCoordinates(aShapePos);
    const outline = new SHAPE_POLY_SET();
    const cornerList: Vec2[] = [];

    const hasRoundedCorner = aCornerRadius !== 0 && aChamferPositions !== 15;

    // Round rect shape or Apert Macros disabled
    if (hasRoundedCorner || this.m_gerberDisableApertMacros) {
      TransformRoundChamferedRectToPolygon(
        outline,
        aShapePos,
        aPadSize,
        aPadOrient,
        aCornerRadius,
        aChamferRatio,
        aChamferPositions,
        0,
        this.GetPlotterArcHighDef(),
        ERROR_LOC.ERROR_INSIDE,
      );

      // Build the corner list
      const corners = outline.Outline(0);

      for (let ii = 0; ii < corners.PointCount(); ii++) {
        const p = corners.CPoint(ii);
        cornerList.push({ x: p.x, y: p.y });
      }

      // Close the polygon
      cornerList.push(cornerList[0]!);

      if (this.m_gerberDisableApertMacros) {
        this.PlotGerberRegion(cornerList, gbr_metadata);
      } else {
        // An AM will be created. the shape must be in position 0,0 and orientation 0
        // to be able to reuse the same AM for pads having the same shape
        for (let ii = 0; ii < cornerList.length; ii++) {
          const rel = {
            x: cornerList[ii]!.x - aShapePos.x,
            y: cornerList[ii]!.y - aShapePos.y,
          };
          cornerList[ii] = RotatePoint(rel, aPadOrient.negate());
        }

        this.selectApertureCorners(
          cornerList,
          aPadOrient,
          APERTURE_TYPE.AM_FREE_POLYGON,
          gbr_metadata.GetApertureAttrib(),
          gbr_metadata.GetCustomAttribute(),
        );
        this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

        this.emitDcode(pos_device, 3);
      }

      return;
    }

    // Build the chamfered polygon (4 to 8 corners )
    TransformRoundChamferedRectToPolygon(
      outline,
      { x: 0, y: 0 },
      aPadSize,
      ANGLE_0,
      0,
      aChamferRatio,
      aChamferPositions,
      0,
      this.GetPlotterArcHighDef(),
      ERROR_LOC.ERROR_INSIDE,
    );

    // Build the corner list
    const corners = outline.Outline(0);

    // Generate the polygon (4 to 8 corners )
    for (let ii = 0; ii < corners.PointCount(); ii++) {
      const p = corners.CPoint(ii);
      cornerList.push({ x: p.x, y: p.y });
    }

    const type: Partial<Record<number, APERTURE_TYPE>> = {
      4: APERTURE_TYPE.APER_MACRO_OUTLINE4P,
      5: APERTURE_TYPE.APER_MACRO_OUTLINE5P,
      6: APERTURE_TYPE.APER_MACRO_OUTLINE6P,
      7: APERTURE_TYPE.APER_MACRO_OUTLINE7P,
      8: APERTURE_TYPE.APER_MACRO_OUTLINE8P,
    };
    const apertureType = type[cornerList.length];

    if (apertureType === undefined) {
      // wxLogMessage( "FlashPadChamferRoundRect(): Unexpected number of corners (%d)" )
    } else {
      if (cornerList.length === 4) this.m_hasApertureOutline4P = true;
      else this.m_hasApertureChamferedRect = true;

      this.selectApertureCorners(
        cornerList,
        aPadOrient,
        apertureType,
        gbr_metadata.GetApertureAttrib(),
        gbr_metadata.GetCustomAttribute(),
      );
    }

    this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    this.emitDcode(pos_device, 3);
  }

  FlashPadTrapez(
    aPadPos: Vec2,
    aCorners: readonly Vec2[],
    aPadOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    // polygon corners list
    const cornerList: Vec2[] = [aCorners[0]!, aCorners[1]!, aCorners[2]!, aCorners[3]!].map((c) => {
      // Draw the polygon and fill the interior as required
      const r = RotatePoint(c, aPadOrient);
      return { x: r.x + aPadPos.x, y: r.y + aPadPos.y };
    });

    // Close the polygon
    cornerList.push(cornerList[0]!);

    const gbr_metadata = asMetadata(aData);
    const metadata = gbr_metadata ? gbr_metadata.Clone() : new GBR_METADATA();

    // Plot a filled polygon:
    if (!this.m_gerberDisableApertMacros) {
      this.m_hasApertureOutline4P = true;
      const pos_dev = this.userToDeviceCoordinates(aPadPos);

      // polygon corners list
      const corners: Vec2[] = [aCorners[0]!, aCorners[1]!, aCorners[2]!, aCorners[3]!];
      let aperture_attribute = 0;
      let custom_attribute = '';

      if (gbr_metadata) {
        aperture_attribute = gbr_metadata.GetApertureAttrib();
        custom_attribute = gbr_metadata.GetCustomAttribute();
      }

      this.selectApertureCorners(
        corners,
        aPadOrient,
        APERTURE_TYPE.APER_MACRO_OUTLINE4P,
        aperture_attribute,
        custom_attribute,
      );

      if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

      this.emitDcode(pos_dev, 3);
      return;
    }

    this.PlotGerberRegion(cornerList, metadata);
  }

  FlashRegularPolygon(
    aShapePos: Vec2,
    aDiameter: number,
    aCornerCount: number,
    aOrient: EDA_ANGLE,
    aData?: unknown,
  ): void {
    const gbr_metadata = asMetadata(aData);

    const apert_type: APERTURE_TYPE = APERTURE_TYPE.AT_REGULAR_POLY3 + aCornerCount - 3;

    // wxASSERT( apert_type >= AT_REGULAR_POLY3 && apert_type <= AT_REGULAR_POLY12 );

    this.selectApertureWithAttributes(
      aShapePos,
      gbr_metadata,
      { x: 0, y: 0 },
      Math.trunc(aDiameter / 2),
      aOrient,
      apert_type,
    );
  }

  override Text(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aOrient: EDA_ANGLE,
    aSize: Vec2,
    aH_justify: GR_TEXT_H_ALIGN_T,
    aV_justify: GR_TEXT_V_ALIGN_T,
    aWidth: number,
    aItalic: boolean,
    aBold: boolean,
    aMultilineAllowed: boolean,
    aFont: PLOTTER_FONT | null,
    aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    super.Text(
      aPos,
      aColor,
      aText,
      aOrient,
      aSize,
      aH_justify,
      aV_justify,
      aWidth,
      aItalic,
      aBold,
      aMultilineAllowed,
      aFont,
      aFontMetrics,
      aData,
    );
  }

  override PlotText(
    aPos: Vec2,
    aColor: Color4d,
    aText: string,
    aAttributes: PLOTTER_TEXT_ATTRIBUTES,
    aFont: PLOTTER_FONT | null,
    aFontMetrics?: unknown,
    aData?: unknown,
  ): void {
    const gbr_metadata = asMetadata(aData);

    if (gbr_metadata) this.formatNetAttribute(gbr_metadata.m_NetlistMetadata);

    super.PlotText(aPos, aColor, aText, aAttributes, aFont, aFontMetrics, aData);
  }

  /**
   * Change the plot polarity and begin a new layer.
   *
   * Used to 'scratch off' silk screen away from solder mask.
   */
  override SetLayerPolarity(aPositive: boolean): void {
    if (aPositive) this.println('%LPD*%');
    else this.println('%LPC*%');
  }
}
