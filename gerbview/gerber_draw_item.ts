// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/gerber_draw_item.h` + `.cpp`: `GERBER_DRAW_ITEM`, one graphic
 * element of a Gerber image — a line, an arc, a circle, a region, or a
 * flashed aperture.
 *
 * Coordinates are stored as read (`m_Start`, `m_End`, `m_ArcCentre`, the
 * region in `m_ShapeAsPolygon`), in the file's own axes. The image's
 * transforms — axis swap, offsets, scale, rotation, mirror, and the Y flip to
 * KiCad's downward axis — are applied when drawing, by `GetABPosition`, and
 * undone by `GetXYPosition`.
 *
 * Not ported: `Print` / `PrintGerberPoly` (the legacy wxDC path; the GAL
 * painter draws), `Show` (a DEBUG dump).
 */
import { EDA_ITEM, INSPECT_RESULT, type INSPECTOR } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { type EdaUnits, toUserUnit } from '@ziroeda/common/eda_units.js';
import { GERBER_DCODE_LAYER, GERBER_DRAW_LAYER, IsDCodeLayer } from '@ziroeda/common/layer_id.js';
import { unescapeString as UnescapeString } from '@ziroeda/common/string_utils.js';
import { VIEW_ITEM, type VIEW_FOR_LOD } from '@ziroeda/common/view/view_item.js';
import { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import {
  ANGLE_0,
  ANGLE_360,
  ANGLE_HORIZONTAL,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint, TestSegmentHit } from '@ziroeda/kimath/src/trigo.js';
import { D_CODE, APERTURE_T } from './dcode.js';
import { GBR_NETLIST_METADATA, GBR_NETINFO_TYPE } from './gbr_netlist_metadata.js';
import type { GERBER_FILE_IMAGE } from './gerber_file_image.js';
import { GERBER_FILE_IMAGE_LIST } from './gerber_file_image_list.js';
import { gerbIUScale } from './gerbview.js';

/** `GBR_BASIC_SHAPE_TYPE` (`gerber_draw_item.h:50-61`), `m_ShapeType`. */
export enum GBR_BASIC_SHAPE_TYPE {
  /** Usual segment: line with rounded ends. */
  GBR_SEGMENT = 0,
  /** Arcs (with rounded ends). */
  GBR_ARC,
  /** Ring. */
  GBR_CIRCLE,
  /** Polygonal shape. */
  GBR_POLYGON,
  /** Flashed shape: round shape (can have hole). */
  GBR_SPOT_CIRCLE,
  /** Flashed shape: rectangular shape (can have hole). */
  GBR_SPOT_RECT,
  /** Flashed shape: oval shape. */
  GBR_SPOT_OVAL,
  /** Flashed shape: regular polygon, 3 to 12 edges. */
  GBR_SPOT_POLY,
  /** Complex shape described by a macro. */
  GBR_SPOT_MACRO,
}

const sub = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: VECTOR2I, b: VECTOR2I): VECTOR2I => ({ x: a.x + b.x, y: a.y + b.y });
const eq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;
const dist = (a: VECTOR2I, b: VECTOR2I): number => Math.hypot(a.x - b.x, a.y - b.y);

/** `gerbIUScale.mmToIU( x )`. */
const mmToIU = (mm: number): number => KiROUND(mm * gerbIUScale.IU_PER_MM);

/** What `GetMsgPanelInfo` needs of the frame: its units. */
export interface GBR_UNITS_FRAME {
  GetUserUnits(): EdaUnits;
}

export class GERBER_DRAW_ITEM extends EDA_ITEM {
  /** Store here the gerber units (inch/mm). Used only to calculate aperture macros shapes sizes. */
  m_UnitsMetric: boolean;
  /** Shape type of this gerber item. */
  m_ShapeType: GBR_BASIC_SHAPE_TYPE;
  /** Line or arc start point or position of the shape for flashed items. */
  m_Start!: VECTOR2I;
  /** Line or arc end point. */
  m_End!: VECTOR2I;
  /** For arcs only: Center of arc. */
  m_ArcCentre!: VECTOR2I;
  /**
   * Polygon shape data from G36 to G37 coordinates, or for complex shapes
   * which are converted to polygon.
   */
  m_ShapeAsPolygon!: SHAPE_POLY_SET;
  /** Flashed shapes: size of the shape. Lines: m_Size.x = m_Size.y = line width. */
  m_Size!: VECTOR2I;
  /** True for flashed items. */
  m_Flashed: boolean;
  /**
   * DCode used to draw this item; >= 10, 0 when unknown. Regions (polygons) do
   * not use a DCode, so it is set to 0.
   */
  m_DCode: number;
  /**
   * The aperture function set by a %TA.AperFunction, xxx (the xxx value);
   * used for regions, which have no D code but can have a TA.AperFunction.
   */
  m_AperFunction!: string;
  /** Gerber file image source of this item. */
  m_GerberImageFile: GERBER_FILE_IMAGE | null;
  /** This polygon is to draw this item (mainly GBR_POLYGON), in absolute coordinates. */
  m_AbsolutePolygon!: SHAPE_POLY_SET;

  // These values are used to draw this item, according to gerber layers
  // parameters. Because they can change inside a gerber image, they are
  // stored here for each item.
  /** true = item in negative Layer. */
  private m_LayerNegative: boolean;
  /** false if A = X, B = Y; true if A = Y, B = X. */
  private m_swapAxis: boolean;
  /** true: mirror / axis A. */
  private m_mirrorA: boolean;
  /** true: mirror / axis B. */
  private m_mirrorB: boolean;
  /** A and B scaling factor. */
  private m_drawScale: { x: number; y: number };
  /** Offset for A and B axis, from OF parameter. */
  private m_layerOffset!: VECTOR2I;
  /** Fine rotation, from OR parameter, in degrees. */
  private m_lyrRotation: number;
  /** The %TO attributes set in force when this item was made. */
  private m_netAttributes!: GBR_NETLIST_METADATA;

  /**
   * `GERBER_DRAW_ITEM( GERBER_FILE_IMAGE* )`, or the copy constructor
   * `GERBER_DRAW_ITEM( const GERBER_DRAW_ITEM& )` the step-and-repeat uses.
   */
  constructor(aGerberImageFile: GERBER_FILE_IMAGE | null);
  constructor(aOther: GERBER_DRAW_ITEM);
  constructor(a: GERBER_FILE_IMAGE | GERBER_DRAW_ITEM | null) {
    // EDA_ITEM( const EDA_ITEM& ) for the copy, EDA_ITEM( nullptr, GERBER_DRAW_ITEM_T ) otherwise.
    const copy = a instanceof GERBER_DRAW_ITEM ? a : null;
    super(copy as never, (copy ? undefined : KICAD_T.GERBER_DRAW_ITEM_T) as never);

    if (a instanceof GERBER_DRAW_ITEM) {
      this.m_UnitsMetric = a.m_UnitsMetric;
      this.m_ShapeType = a.m_ShapeType;
      this.m_Start = { ...a.m_Start };
      this.m_End = { ...a.m_End };
      this.m_ArcCentre = { ...a.m_ArcCentre };
      this.m_ShapeAsPolygon = a.m_ShapeAsPolygon.CloneDropTriangulation();
      this.m_Size = { ...a.m_Size };
      this.m_Flashed = a.m_Flashed;
      this.m_DCode = a.m_DCode;
      this.m_AperFunction = a.m_AperFunction;
      this.m_GerberImageFile = a.m_GerberImageFile;
      this.m_AbsolutePolygon = a.m_AbsolutePolygon.CloneDropTriangulation();
      this.m_LayerNegative = a.m_LayerNegative;
      this.m_swapAxis = a.m_swapAxis;
      this.m_mirrorA = a.m_mirrorA;
      this.m_mirrorB = a.m_mirrorB;
      this.m_drawScale = { ...a.m_drawScale };
      this.m_layerOffset = { ...a.m_layerOffset };
      this.m_lyrRotation = a.m_lyrRotation;
      this.m_netAttributes = a.m_netAttributes.Clone();
      return;
    }

    this.m_GerberImageFile = a;
    this.m_Start = { x: 0, y: 0 };
    this.m_End = { x: 0, y: 0 };
    this.m_ArcCentre = { x: 0, y: 0 };
    this.m_ShapeAsPolygon = new SHAPE_POLY_SET();
    this.m_Size = { x: 0, y: 0 };
    this.m_AperFunction = '';
    this.m_AbsolutePolygon = new SHAPE_POLY_SET();
    this.m_layerOffset = { x: 0, y: 0 };
    this.m_netAttributes = new GBR_NETLIST_METADATA();
    this.m_ShapeType = GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT;
    this.m_Flashed = false;
    this.m_DCode = 0;
    this.m_UnitsMetric = false;
    this.m_LayerNegative = false;
    this.m_swapAxis = false;
    this.m_mirrorA = false;
    this.m_mirrorB = false;
    this.m_drawScale = { x: 1.0, y: 1.0 };
    this.m_lyrRotation = 0;

    if (this.m_GerberImageFile) this.SetLayerParameters();
  }

  override GetClass(): string {
    return 'GERBER_DRAW_ITEM';
  }

  SetNetAttributes(aNetAttributes: GBR_NETLIST_METADATA): void {
    this.m_netAttributes = aNetAttributes.Clone();

    const image = this.m_GerberImageFile as GERBER_FILE_IMAGE;

    if (
      this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_CMP ||
      this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_PAD
    ) {
      // std::map::insert keeps an existing key.
      if (!image.m_ComponentsList.has(this.m_netAttributes.m_Cmpref))
        image.m_ComponentsList.set(this.m_netAttributes.m_Cmpref, 0);
    }

    if (this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_NET) {
      if (!image.m_NetnamesList.has(this.m_netAttributes.m_Netname))
        image.m_NetnamesList.set(this.m_netAttributes.m_Netname, 0);
    }
  }

  GetNetAttributes(): GBR_NETLIST_METADATA {
    return this.m_netAttributes;
  }

  /** The layer this item is on, or 0 if the m_GerberImageFile is null. */
  GetLayer(): number {
    return this.m_GerberImageFile ? this.m_GerberImageFile.m_GraphicLayer : 0;
  }

  /** `m_LayerNegative`: true when the item was drawn with %LPC in force. */
  GetLayerPolarity(): boolean {
    return this.m_LayerNegative;
  }

  /**
   * The best size, position and orientation for the D-code text of this item.
   * @return false if the item has no D-code.
   */
  GetTextD_CodePrms(): { size: number; pos: VECTOR2I; orientation: EDA_ANGLE } | null {
    // calculate the best size and orientation of the D_Code text
    if (this.m_DCode <= 0) return null; // No D_Code for this item

    let aPos: VECTOR2I;

    if (this.m_Flashed || this.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_ARC) aPos = this.m_Start;
    // it is a line:
    else
      aPos = {
        x: Math.trunc((this.m_Start.x + this.m_End.x) / 2),
        y: Math.trunc((this.m_Start.y + this.m_End.y) / 2),
      };

    aPos = this.GetABPosition(aPos);

    let size: number; // the best size for the text
    const dcode = this.GetDcodeDescr();

    if (dcode) size = dcode.GetShapeDim(this);
    else size = Math.min(this.m_Size.x, this.m_Size.y);

    let aOrientation = ANGLE_HORIZONTAL;
    let aSize: number;

    if (this.m_Flashed) {
      // A reasonable size for text is min_dim/3 because most of time this text has 3 chars.
      aSize = Math.trunc(size / 3);
    } else {
      // this item is a line
      const delta = sub(this.m_Start, this.m_End);
      const angle = EDA_ANGLE.fromVector(delta);

      aOrientation = angle.Normalize90();

      // A reasonable size for text is size/2 because text needs margin below and above it.
      aSize = Math.trunc(size / 2);
    }

    return { size: aSize, pos: aPos, orientation: aOrientation };
  }

  /** True if this item is drawn in background color (a negative item). */
  HasNegativeItems(): boolean {
    const isClear =
      this.m_LayerNegative !== (this.m_GerberImageFile as GERBER_FILE_IMAGE).m_ImageNegative;

    // if isClear is true, this item has negative shape
    return isClear;
  }

  /** Set the parameters the item takes from the image when it is made. */
  SetLayerParameters(): void {
    const image = this.m_GerberImageFile as GERBER_FILE_IMAGE;
    this.m_UnitsMetric = image.m_GerbMetric;
    this.m_swapAxis = image.m_SwapAxis; // false if A = X, B = Y;

    // true if A =Y, B = Y
    this.m_mirrorA = image.m_MirrorA; // true: mirror / axe A
    this.m_mirrorB = image.m_MirrorB; // true: mirror / axe B
    this.m_drawScale = { ...image.m_Scale }; // A and B scaling factor
    this.m_layerOffset = { ...image.m_Offset }; // Offset from OF command

    // Rotation from RO command:
    this.m_lyrRotation = image.m_LocalRotation;
    this.m_LayerNegative = image.GetLayerParams().m_LayerNegative;
  }

  SetLayerPolarity(aNegative: boolean): void {
    this.m_LayerNegative = aNegative;
  }

  /** Move this item by `aMoveVector`, in XY (file) coordinates. */
  MoveXY(aMoveVector: VECTOR2I): void {
    this.m_Start = add(this.m_Start, aMoveVector);
    this.m_End = add(this.m_End, aMoveVector);
    this.m_ArcCentre = add(this.m_ArcCentre, aMoveVector);

    this.m_ShapeAsPolygon.Move(aMoveVector);
  }

  override GetPosition(): VECTOR2I {
    return this.m_Start;
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_Start = aPos;
  }

  /**
   * The image position of `aXYPosition`, a position in file coordinates:
   * justify offset, axis swap, offsets, scale, rotation and mirror applied,
   * and the Y axis turned downward (unless mirrored), then the display
   * rotation and offset.
   *
   * "Note: RS274Xrevd_e is obscure about the order of transforms."
   */
  GetABPosition(aXYPosition: VECTOR2I): VECTOR2I {
    const image = this.m_GerberImageFile as GERBER_FILE_IMAGE;
    let abPos = add(aXYPosition, image.m_ImageJustifyOffset);

    // We have also a draw transform (rotation and offset)
    // order is rotation and after offset

    if (this.m_swapAxis) abPos = { x: abPos.y, y: abPos.x };

    abPos = add(abPos, add(this.m_layerOffset, image.m_ImageOffset));
    abPos.x = KiROUND(abPos.x * this.m_drawScale.x);
    abPos.y = KiROUND(abPos.y * this.m_drawScale.y);
    const rotation = new EDA_ANGLE(
      this.m_lyrRotation + image.m_ImageRotation,
      EDA_ANGLE_T.DEGREES_T,
    );

    if (!rotation.IsZero()) abPos = RotatePoint(abPos, rotation.negate());

    // Negate A axis if mirrored
    if (this.m_mirrorA) abPos.x = -abPos.x;

    // abPos.y must be negated when no mirror, because draw axis is top to bottom
    if (!this.m_mirrorB) abPos.y = -abPos.y;

    // Now generate the draw transform
    if (!image.m_DisplayRotation.IsZero()) abPos = RotatePoint(abPos, image.m_DisplayRotation);

    abPos.x += KiROUND(image.m_DisplayOffset.x * this.m_drawScale.x);
    abPos.y += KiROUND(image.m_DisplayOffset.y * this.m_drawScale.y);

    return { x: abPos.x + 0, y: abPos.y + 0 };
  }

  /** The file position of `aABPosition`: the inverse of GetABPosition. */
  GetXYPosition(aABPosition: VECTOR2I): VECTOR2I {
    const image = this.m_GerberImageFile as GERBER_FILE_IMAGE;
    // do the inverse transform made by GetABPosition
    let xyPos = { ...aABPosition };

    // First, undo the draw transform
    xyPos.x -= KiROUND(image.m_DisplayOffset.x * this.m_drawScale.x);
    xyPos.y -= KiROUND(image.m_DisplayOffset.y * this.m_drawScale.y);

    if (!image.m_DisplayRotation.IsZero())
      xyPos = RotatePoint(xyPos, image.m_DisplayRotation.negate());

    if (this.m_mirrorA) xyPos.x = -xyPos.x;

    if (!this.m_mirrorB) xyPos.y = -xyPos.y;

    const rotation = new EDA_ANGLE(
      this.m_lyrRotation + image.m_ImageRotation,
      EDA_ANGLE_T.DEGREES_T,
    );

    if (!rotation.IsZero()) xyPos = RotatePoint(xyPos, rotation);

    xyPos.x = KiROUND(xyPos.x / this.m_drawScale.x);
    xyPos.y = KiROUND(xyPos.y / this.m_drawScale.y);
    xyPos = sub(xyPos, add(this.m_layerOffset, image.m_ImageOffset));

    if (this.m_swapAxis) xyPos = { x: xyPos.y, y: xyPos.x };

    return sub(xyPos, image.m_ImageJustifyOffset);
  }

  /** The D_CODE of this item, or null for a region or an undefined D code. */
  GetDcodeDescr(): D_CODE | null {
    if (!D_CODE.IsValidDcodeValue(this.m_DCode)) return null;

    if (this.m_GerberImageFile === null) return null;

    return this.m_GerberImageFile.GetDCODE(this.m_DCode);
  }

  /** The bounding box, in AB (drawn) coordinates. */
  override GetBoundingBox(): BOX2I {
    // return a rectangle which is (pos,dim) in nature.  therefore the +1
    let bbox = new BOX2I(this.m_Start, { x: 1, y: 1 });
    const code = this.GetDcodeDescr();

    switch (this.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON: {
        const bb = this.m_ShapeAsPolygon.BBox();
        bbox.Inflate(Math.trunc(bb.GetWidth() / 2), Math.trunc(bb.GetHeight() / 2));
        bbox.SetOrigin(bb.GetOrigin());
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE: {
        const radius = dist(this.m_Start, this.m_End);
        bbox.Inflate(radius, radius);
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_ARC: {
        let angle = new EDA_ANGLE(
          Math.atan2(this.m_End.y - this.m_ArcCentre.y, this.m_End.x - this.m_ArcCentre.x) -
            Math.atan2(this.m_Start.y - this.m_ArcCentre.y, this.m_Start.x - this.m_ArcCentre.x),
          EDA_ANGLE_T.RADIANS_T,
        );

        // Arc with the end point = start point is expected to be a circle.
        if (eq(this.m_End, this.m_Start)) angle = ANGLE_360;
        else angle = angle.Normalize();

        const arc = new SHAPE_ARC(this.m_ArcCentre, this.m_Start, angle);
        bbox = arc.BBox(Math.trunc(this.m_Size.x / 2)); // m_Size.x is the line thickness
        break;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
        if (code) {
          const radius = code.m_Size.x >> 1;
          bbox.Inflate(radius, radius);
        }

        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
        if (code) bbox.Inflate(Math.trunc(code.m_Size.x / 2), Math.trunc(code.m_Size.y / 2));

        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
        if (code) bbox.Inflate(Math.trunc(code.m_Size.x / 2), Math.trunc(code.m_Size.y / 2));

        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
        if (code) {
          if (code.m_Polygon.OutlineCount() === 0) code.ConvertShapeToPolygon(this);

          bbox.Inflate(
            Math.trunc(code.m_Polygon.BBox().GetWidth() / 2),
            Math.trunc(code.m_Polygon.BBox().GetHeight() / 2),
          );
        }

        break;

      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
        if (code && code.m_ApertType === APERTURE_T.APT_RECT) {
          if (this.m_ShapeAsPolygon.OutlineCount() === 0) {
            // We cannot initialize m_ShapeAsPolygon, because we are in a const function.
            // So use a temporary polygon
            const poly_shape = new SHAPE_POLY_SET();
            this.ConvertSegmentToPolygon(poly_shape);
            bbox = poly_shape.BBox();
          } else {
            bbox = this.m_ShapeAsPolygon.BBox();
          }
        } else {
          const radius = Math.trunc((this.m_Size.x + 1) / 2);

          const ymax = Math.max(this.m_Start.y, this.m_End.y) + radius;
          const xmax = Math.max(this.m_Start.x, this.m_End.x) + radius;

          const ymin = Math.min(this.m_Start.y, this.m_End.y) - radius;
          const xmin = Math.min(this.m_Start.x, this.m_End.x) - radius;

          bbox = new BOX2I({ x: xmin, y: ymin }, { x: xmax - xmin + 1, y: ymax - ymin + 1 });
        }

        break;

      default:
        // wxASSERT_MSG( false, wxT( "GERBER_DRAW_ITEM shape is unknown!" ) );
        break;
    }

    // calculate the corners coordinates in current Gerber axis orientations
    // because the initial bbox is a horizontal rect, but the bbox in AB position
    // is the bbox image with perhaps a rotation, we need to calculate the coords of the
    // corners of the bbox rotated, and then calculate the final bounding box
    bbox.Normalize();

    // Shape:
    // 0...1
    // .   .
    // .   .
    // 3...2
    const corners: VECTOR2I[] = [];
    corners[0] = { ...bbox.GetOrigin() }; // top left
    corners[2] = { ...bbox.GetEnd() }; // bottom right
    corners[1] = { x: corners[2].x, y: corners[0].y }; // top right
    corners[3] = { x: corners[0].x, y: corners[2].y }; // bottom left

    const org = this.GetABPosition(bbox.GetOrigin());
    const end = this.GetABPosition(bbox.GetEnd());

    // Now calculate the bounding box of bbox, if the display image is rotated
    // It will be perhaps a bit bigger than a better bounding box calculation, but it is fast
    // and easy
    // (if not rotated, this is a nop)
    for (let ii = 0; ii < 4; ii++) {
      corners[ii] = this.GetABPosition(corners[ii] as VECTOR2I);
      const c = corners[ii] as VECTOR2I;

      org.x = Math.min(org.x, c.x);
      org.y = Math.min(org.y, c.y);

      end.x = Math.max(end.x, c.x);
      end.y = Math.max(end.y, c.y);
    }

    // Set the corners position:
    bbox.SetOrigin(org);
    bbox.SetEnd(end);
    bbox.Normalize();

    return bbox;
  }

  /**
   * Convert a line to an equivalent polygon: useful when a line is drawn with
   * a rectangular aperture, which sweeps a six-cornered hull, not a capsule.
   */
  ConvertSegmentToPolygon(aPolygon?: SHAPE_POLY_SET): void {
    if (aPolygon === undefined) {
      this.ConvertSegmentToPolygon(this.m_ShapeAsPolygon);
      return;
    }

    aPolygon.RemoveAllContours();
    aPolygon.NewOutline();

    let start = this.m_Start;
    let end = this.m_End;

    // make calculations more easy if ensure start.x < end.x
    // (only 2 quadrants to consider)
    if (start.x > end.x) [start, end] = [end, start];

    // calculate values relative to start point:
    const delta = sub(end, start);

    // calculate corners for the first quadrant only (delta.x and delta.y > 0 )
    // currently, delta.x already is > 0.
    // make delta.y > 0
    const change = delta.y < 0;

    if (change) delta.y = -delta.y;

    // Now create the full polygon.
    // Due to previous changes, the shape is always something like
    // 3 4
    // 2 5
    // 1 6
    const corner: VECTOR2I = { x: 0, y: 0 };
    corner.x -= Math.trunc(this.m_Size.x / 2);
    corner.y -= Math.trunc(this.m_Size.y / 2);
    const close = { ...corner };
    aPolygon.Append({ ...corner }); // Lower left corner, start point (1)
    corner.y += this.m_Size.y;
    aPolygon.Append({ ...corner }); // upper left corner, start point (2)

    if (delta.x || delta.y) {
      corner.x += delta.x;
      corner.y += delta.y;
      aPolygon.Append({ ...corner }); // upper left corner, end point (3)
    }

    corner.x += this.m_Size.x;
    aPolygon.Append({ ...corner }); // upper right corner, end point (4)
    corner.y -= this.m_Size.y;
    aPolygon.Append({ ...corner }); // lower right corner, end point (5)

    if (delta.x || delta.y) {
      corner.x -= delta.x;
      corner.y -= delta.y;
      aPolygon.Append({ ...corner }); // lower left corner, start point (6)
    }

    aPolygon.Append({ ...close }); // close the shape

    // Create final polygon:
    if (change) aPolygon.Mirror({ x: 0, y: 0 }, FLIP_DIRECTION.TOP_BOTTOM);

    aPolygon.Move({ ...start });
  }

  ShapeType(): GBR_BASIC_SHAPE_TYPE {
    return this.m_ShapeType;
  }

  /** The type of shape, for the message panel. */
  ShowGBRShape(): string {
    switch (this.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
        return 'Line';
      case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
        return 'Arc';
      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
        return 'Circle';
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
        return 'spot_oval';
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
        return 'spot_circle';
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
        return 'spot_rect';
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
        return 'spot_poly';
      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
        return 'polygon';

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO: {
        let name = 'apt_macro';
        const dcode = this.GetDcodeDescr();
        const macro = dcode?.GetMacro();

        if (dcode && macro) name += ` ${macro.m_AmName}`;

        return name;
      }

      default:
        return '??';
    }
  }

  /** The rows the message panel shows for a picked item. */
  override GetMsgPanelInfo(aFrame: GBR_UNITS_FRAME, aList: MSG_PANEL_ITEM[]): void {
    let msg: string;
    let text: string;

    msg = this.ShowGBRShape();
    aList.push(new MSG_PANEL_ITEM('Type', msg));

    // Display D_Code value with its attributes for items using a DCode:
    if (this.m_ShapeType === GBR_BASIC_SHAPE_TYPE.GBR_POLYGON) {
      // Has no DCode, but can have an attribute
      msg = 'Attribute';

      if (this.m_AperFunction.length === 0) text = 'No attribute';
      else text = this.m_AperFunction;
    } else {
      msg = `D Code ${this.m_DCode}`;
      const apertDescr = this.GetDcodeDescr();

      if (!apertDescr || apertDescr.m_AperFunction.length === 0) text = 'No attribute';
      else text = apertDescr.m_AperFunction;
    }

    aList.push(new MSG_PANEL_ITEM(msg, text));

    // Display graphic layer name
    msg = GERBER_FILE_IMAGE_LIST.GetImagesList().GetDisplayName(this.GetLayer(), true);
    aList.push(new MSG_PANEL_ITEM('Graphic Layer', msg));

    // Display item position
    const units = aFrame.GetUserUnits();
    const xStart = toUserUnit(gerbIUScale, units, this.m_Start.x);
    const yStart = toUserUnit(gerbIUScale, units, this.m_Start.y);
    const xEnd = toUserUnit(gerbIUScale, units, this.m_End.x);
    const yEnd = toUserUnit(gerbIUScale, units, this.m_End.y);

    if (this.m_Flashed) {
      msg = `(${xStart.toFixed(4)}, ${yStart.toFixed(4)})`;
      aList.push(new MSG_PANEL_ITEM('Position', msg));
    } else {
      msg = `(${xStart.toFixed(4)}, ${yStart.toFixed(4)})`;
      aList.push(new MSG_PANEL_ITEM('Start', msg));

      msg = `(${xEnd.toFixed(4)}, ${yEnd.toFixed(4)})`;
      aList.push(new MSG_PANEL_ITEM('End', msg));
    }

    // Display item rotation
    // The full rotation is Image rotation + m_lyrRotation
    // but m_lyrRotation is specific to this object
    // so we display only this parameter
    msg = this.m_lyrRotation.toFixed(6); // wxT( "%f" )
    aList.push(new MSG_PANEL_ITEM('Rotation', msg));

    // Display item polarity (item specific)
    msg = this.m_LayerNegative ? 'Clear' : 'Dark';
    aList.push(new MSG_PANEL_ITEM('Polarity', msg));

    // Display mirroring (item specific)
    msg = `A:${this.m_mirrorA ? 'Yes' : 'No'} B:${this.m_mirrorB ? 'Yes' : 'No'}`;
    aList.push(new MSG_PANEL_ITEM('Mirror', msg));

    // Display AB axis swap (item specific)
    msg = this.m_swapAxis ? 'A=Y B=X' : 'A=X B=Y';
    aList.push(new MSG_PANEL_ITEM('AB axis', msg));

    // Display net info, if exists
    if (this.m_netAttributes.m_NetAttribType === GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED) return;

    // Build full net info:
    let net_msg = '';
    let cmp_pad_msg = '';

    if (this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_NET) {
      net_msg = 'Net:';
      net_msg += ' ';

      if (this.m_netAttributes.m_Netname.length === 0) net_msg += '<no net>';
      else net_msg += UnescapeString(this.m_netAttributes.m_Netname);
    }

    if (this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_PAD) {
      if (this.m_netAttributes.m_PadPinFunction.IsEmpty()) {
        cmp_pad_msg = `Cmp: ${this.m_netAttributes.m_Cmpref}  Pad: ${this.m_netAttributes.m_Padname.GetValue()}`;
      } else {
        cmp_pad_msg =
          `Cmp: ${this.m_netAttributes.m_Cmpref}  Pad: ${this.m_netAttributes.m_Padname.GetValue()}` +
          `  Fct ${this.m_netAttributes.m_PadPinFunction.GetValue()}`;
      }
    } else if (this.m_netAttributes.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_CMP) {
      cmp_pad_msg = 'Cmp:';
      cmp_pad_msg += ` ${this.m_netAttributes.m_Cmpref}`;
    }

    aList.push(new MSG_PANEL_ITEM(net_msg, cmp_pad_msg));
  }

  override GetMenuImage(): string {
    if (this.m_Flashed) return 'pad';

    switch (this.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
      case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
        return 'add_line';

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
        // should be handles by m_Flashed == true
        return 'pad';

      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
        return 'add_graphical_polygon';
    }

    return 'info';
  }

  /**
   * `HitTest( const VECTOR2I& aRefPos, int aAccuracy )`, `aRefPos` in AB
   * (drawn) coordinates; or `HitTest( const BOX2I&, bool, int )`.
   */
  override HitTest(aRefPos: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRefArea: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if (a instanceof BOX2I) return this.HitTestArea(a);

    // Not overridden upstream: EDA_ITEM's, which answers false.
    if (a instanceof SHAPE_LINE_CHAIN) return super.HitTest(a, b as boolean);

    void c;
    return this.HitTestPos(a, (b as number | undefined) ?? 0);
  }

  private HitTestPos(aRefPos: VECTOR2I, aAccuracy: number): boolean {
    // In case the item has a very tiny width defined, allow it to be selected
    const MIN_HIT_TEST_RADIUS = mmToIU(0.01);

    // calculate aRefPos in XY Gerber axis:
    const ref_pos = this.GetXYPosition(aRefPos);

    let poly: SHAPE_POLY_SET;

    switch (this.m_ShapeType) {
      case GBR_BASIC_SHAPE_TYPE.GBR_POLYGON:
        poly = this.m_ShapeAsPolygon;
        return poly.Contains(ref_pos, 0, aAccuracy);

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_POLY:
        poly = (this.GetDcodeDescr() as D_CODE).m_Polygon.CloneDropTriangulation();
        poly.Move({ ...this.m_Start });
        return poly.Contains(ref_pos, 0, aAccuracy);

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_RECT:
        return this.GetBoundingBox().Contains(aRefPos);

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_OVAL: {
        const bbox = this.GetBoundingBox();

        if (!bbox.Contains(aRefPos)) return false;

        // This is similar to a segment with thickness = min( m_Size.x, m_Size.y )
        let radius = Math.trunc(Math.min(this.m_Size.x, this.m_Size.y) / 2);
        let start: VECTOR2I = { x: 0, y: 0 };
        let end: VECTOR2I = { x: 0, y: 0 };

        if (this.m_Size.x > this.m_Size.y) {
          // Horizontal oval
          const len = this.m_Size.y - this.m_Size.x;
          start.x = -Math.trunc(len / 2);
          end.x = Math.trunc(len / 2);
        } else {
          // Vertical oval
          const len = this.m_Size.x - this.m_Size.y;
          start.y = -Math.trunc(len / 2);
          end.y = Math.trunc(len / 2);
        }

        const c = bbox.Centre();
        start = add(start, c);
        end = add(end, c);

        if (radius < MIN_HIT_TEST_RADIUS) radius = MIN_HIT_TEST_RADIUS;

        return TestSegmentHit(aRefPos, start, end, radius);
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_ARC: {
        const radius = dist(this.m_Start, this.m_ArcCentre);
        const test_radius = sub(ref_pos, this.m_ArcCentre);

        const size = this.m_Size.x < MIN_HIT_TEST_RADIUS ? MIN_HIT_TEST_RADIUS : this.m_Size.x;

        // Are we close enough to the radius?
        const radius_hit = Math.abs(Math.hypot(test_radius.x, test_radius.y) - radius) < size;

        if (radius_hit) {
          // Now check that we are within the arc angle
          const start = sub(this.m_Start, this.m_ArcCentre);
          const end = sub(this.m_End, this.m_ArcCentre);
          let start_angle = EDA_ANGLE.fromVector(start);
          let end_angle = EDA_ANGLE.fromVector(end);

          start_angle = start_angle.Normalize();
          end_angle = end_angle.Normalize();

          if (eq(this.m_Start, this.m_End)) {
            start_angle = ANGLE_0;
            end_angle = ANGLE_360;
          } else if (end_angle.lt(start_angle)) {
            end_angle = end_angle.add(ANGLE_360);
          }

          const test_angle = EDA_ANGLE.fromVector(test_radius).Normalize();

          return test_angle.gt(start_angle) && test_angle.lt(end_angle);
        }

        return false;
      }

      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
        return this.m_AbsolutePolygon.Contains(aRefPos, -1, aAccuracy);

      case GBR_BASIC_SHAPE_TYPE.GBR_SEGMENT:
      case GBR_BASIC_SHAPE_TYPE.GBR_CIRCLE:
      case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_CIRCLE:
        break; // handled below.
    }

    // TODO: a better analyze of the shape (perhaps create a D_CODE::HitTest for flashed items)
    let radius = Math.min(this.m_Size.x, this.m_Size.y) >> 1;

    if (radius < MIN_HIT_TEST_RADIUS) radius = MIN_HIT_TEST_RADIUS;

    if (this.m_Flashed) return dist(this.m_Start, ref_pos) <= radius;
    return TestSegmentHit(ref_pos, this.m_Start, this.m_End, radius);
  }

  private HitTestArea(aRefArea: BOX2I): boolean {
    let pos = this.GetABPosition(this.m_Start);

    if (aRefArea.Contains(pos)) return true;

    pos = this.GetABPosition(this.m_End);

    if (aRefArea.Contains(pos)) return true;

    return false;
  }

  /** `ViewGetLayers`: the drawing layer and its D-code layer. */
  override ViewGetLayers(): number[] {
    const layers: number[] = [0, 0];
    layers[0] = GERBER_DRAW_LAYER(this.GetLayer());
    layers[1] = GERBER_DCODE_LAYER(layers[0]);

    return layers;
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox();
  }

  /**
   * "DCodes will be shown only if zoom is appropriate": the D-code text is
   * drawn only once it reads at 3 mm on screen.
   */
  override ViewGetLOD(aLayer: number, aView: VIEW_FOR_LOD | null): number {
    if (IsDCodeLayer(aLayer)) {
      let size = 0;

      switch (this.m_ShapeType) {
        case GBR_BASIC_SHAPE_TYPE.GBR_SPOT_MACRO:
          size = (this.GetDcodeDescr() as D_CODE).m_Polygon.BBox().GetWidth();
          break;

        case GBR_BASIC_SHAPE_TYPE.GBR_ARC:
          size = Math.trunc(dist(this.m_Start, this.m_ArcCentre));
          break;

        default:
          size = this.m_Size.x;
      }

      // the level of details is chosen experimentally, to show
      // only a readable text:
      return VIEW_ITEM.lodScaleForThreshold(aView as VIEW_FOR_LOD, size, mmToIU(3.0));
    }

    // Other layers are shown without any conditions
    return VIEW_ITEM.LOD_SHOW;
  }

  override Visit(
    inspector: INSPECTOR,
    testData: unknown,
    aScanTypes: readonly KICAD_T[],
  ): INSPECT_RESULT {
    for (const scanType of aScanTypes) {
      if (scanType === this.Type()) {
        if (INSPECT_RESULT.QUIT === inspector(this, testData)) return INSPECT_RESULT.QUIT;
      }
    }

    return INSPECT_RESULT.CONTINUE;
  }

  override GetItemDescription(_aUnitsProvider: unknown, _aFull: boolean): string {
    const layerName = GERBER_FILE_IMAGE_LIST.GetImagesList().GetDisplayName(this.GetLayer(), true);

    return `${this.ShowGBRShape()} (D${this.m_DCode}) on layer ${this.GetLayer() + 1}: ${layerName}`;
  }
}
