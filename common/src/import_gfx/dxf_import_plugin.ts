// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DXF_IMPORT_PLUGIN`: DXF entities in, `GRAPHICS_IMPORTER` calls out.
 *
 * Counterpart: `common/import_gfx/dxf_import_plugin.{h,cpp}`. The group-code
 * reader it sits on is `dxf_reader.ts`; the B-spline maths the SPLINE entity
 * needs is `dxf_spline.ts`.
 *
 * **Everything this file emits is in millimetres, and it never applies the
 * user's import scale.** `SCALE_FACTOR(x)` upstream is the identity macro, and
 * that is not an oversight: `GRAPHICS_IMPORTER` owns the placement model
 * (`m_scale`, `m_offsetCoordmm`, `m_millimeterToIu`, composed in
 * `ImportScalingFactor`). A parser that pre-multiplied its coordinates would
 * apply the user's ratio twice. The only scaling here is
 * `getCurrentUnitScale()`, which turns the file's own drawing units into
 * millimetres, and `m_xOffset`/`m_yOffset`, which are the plugin's own
 * page-origin shift and are separate from the importer's offset.
 *
 * Shapes go into `m_internalImporter`, a `GRAPHICS_IMPORTER_BUFFER`, and are
 * only replayed into the real importer by `Import()`. That indirection is what
 * lets a BLOCK be read once into its own buffer and then stamped out by each
 * INSERT — see `addInsert`, which clones and transforms rather than re-parsing.
 *
 * ## Coordinate systems
 *
 * DXF has world coordinates (WCS) and object coordinates (OCS). LINE, POINT and
 * 3D polylines are world; CIRCLE, ARC, SOLID, INSERT, 2D polylines, LWPOLYLINE
 * and TEXT are object, and must be run through the arbitrary-axis transform even
 * for a flat 2D drawing — SolidWorks in particular emits circles with a negative
 * extrusion that only comes out the right way round after the conversion.
 *
 * ## Faithfully reproduced oddities
 *
 * - `addText`'s justification test reads `vJust != 0 || hJust != 0 || hJust == 4`.
 *   The third clause can never be reached; it is upstream's and is kept.
 * - Both `addText` and `addMText` rotate the bounding-box corners with
 *   `p.x = p.x*cos - p.y*sin; p.y = p.x*sin + p.y*cos`, where the second line
 *   reads the *already rotated* x. The image bounding box is therefore wrong for
 *   any rotated text. Kept, and pinned.
 * - `insertSpline` walks tinyspline's control points four at a time but steps by
 *   `order`, so a spline of degree ≥ 4 loses all but the first four control
 *   points of each segment.
 * - An INSERT's `cols`/`rows`/spacing are read by the reader and ignored: a
 *   block is placed once however many times the file asks for.
 * - `m_codePage` is assigned an `int` in C++, which converts to a `char` string;
 *   nothing reads it back, and it is kept as a plain field here.
 * - The general (non-circular) ELLIPSE is **not ported**; see `addEllipse`.
 */

import {
  BOX2D,
  GRAPHICS_IMPORTER_BUFFER,
  IMPORTED_STROKE,
  type GRAPHICS_IMPORTER,
  type MATRIX3x3D,
  matrixGetScale,
} from './graphics_importer.js';
import {
  DL_CREATION_ADAPTER,
  DL_ENTITY_LWPOLYLINE,
  DL_ENTITY_POLYLINE,
  DL_ENTITY_SPLINE,
  DL_UNKNOWN,
  DXF_READER,
  type DL_ArcData,
  type DL_BlockData,
  type DL_CircleData,
  type DL_ControlPointData,
  type DL_EllipseData,
  type DL_Extrusion,
  type DL_FitPointData,
  type DL_InsertData,
  type DL_KnotData,
  type DL_LayerData,
  type DL_LineData,
  type DL_MTextData,
  type DL_PointData,
  type DL_PolylineData,
  type DL_SplineData,
  type DL_StyleData,
  type DL_TextData,
  type DL_VertexData,
} from './dxf_reader.js';
import { SPLINE_ERROR, bsplineToBeziers } from './dxf_spline.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '../eda_text.js';
import {
  ANGLE_0,
  ANGLE_180,
  ANGLE_360,
  EDA_ANGLE,
  EDA_ANGLE_T,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { RotatePointD } from '@ziroeda/kimath/src/trigo.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/**
 * Minimum bulge before a polyline segment is drawn as a line instead of an arc.
 * 0.0218 is about a 5 degree arc.
 */
const MIN_BULGE = 0.0218;

/* Magic lineweight constants from the DXF specification. */
export const DXF_IMPORT_LINEWEIGHT_BY_LAYER = -1;
export const DXF_IMPORT_LINEWEIGHT_BY_BLOCK = -2;
export const DXF_IMPORT_LINEWEIGHT_BY_LW_DEFAULT = -3;

/** DXF unit codes, as `$INSUNITS` numbers them (DXF 2012 specification). */
export enum DXF_IMPORT_UNITS {
  DEFAULT = 0,
  INCH = 1,
  FEET = 2,
  MM = 4,
  CM = 5,
  METERS = 6,
  MICROINCHES = 8,
  MILS = 9,
  YARDS = 10,
  ANGSTROMS = 11,
  NANOMETERS = 12,
  MICRONS = 13,
  DECIMETERS = 14,
  DECAMETERS = 15,
  HECTOMETERS = 16,
  GIGAMETERS = 17,
  ASTRONOMICAL = 18,
  LIGHTYEARS = 19,
  PARSECS = 20,
}

/** `SPLINE_CTRL_POINT`, a control point in the XY plane plus its weight. */
export interface SPLINE_CTRL_POINT {
  m_x: number;
  m_y: number;
  m_weight: number;
}

/** `DXF_IMPORT_LAYER`: a source layer's name and its default lineweight. */
export class DXF_IMPORT_LAYER {
  constructor(
    public m_layerName: string,
    public m_lineWeight: number,
  ) {}
}

/** `DXF_IMPORT_BLOCK`: a BLOCK definition and the shapes read into it. */
export class DXF_IMPORT_BLOCK {
  m_buffer = new GRAPHICS_IMPORTER_BUFFER();

  constructor(
    public m_name: string,
    public m_baseX: number,
    public m_baseY: number,
  ) {}
}

/** `DXF_IMPORT_STYLE`: a text style, of which only the width factor is used. */
export class DXF_IMPORT_STYLE {
  constructor(
    public m_name: string,
    public m_textHeight: number,
    public m_widthFactor: number,
    public m_bold: boolean,
    public m_italic: boolean,
  ) {}
}

/**
 * `DXF2BRD_ENTITY_DATA`: the state of the multi-callback entity in progress.
 *
 * POLYLINE and SPLINE are not delivered as one callback — vertices, control
 * points, knots and fit points each arrive on their own, and the entity is only
 * complete at `endEntity`. This is where they pile up.
 */
export class DXF2BRD_ENTITY_DATA {
  m_EntityType: number = DL_UNKNOWN;
  /** 0 = no entity, 1 = first item of entity, 2 = entity in progress. */
  m_EntityParseStatus = 0;
  m_EntityFlag = 0;
  m_LayerName = '';

  /** Last vertex read, already in mm. */
  m_LastCoordinate: Vec2 = { x: 0, y: 0 };
  /** First point of the polyline, in mm. */
  m_PolylineStart: Vec2 = { x: 0, y: 0 };
  m_BulgeVertex = 0.0;

  m_SplineDegree = 1;
  m_SplineKnotsCount = 0;
  m_SplineControlCount = 0;
  m_SplineFitCount = 0;
  m_SplineTangentStartX = 0.0;
  m_SplineTangentStartY = 0.0;
  m_SplineTangentEndX = 0.0;
  m_SplineTangentEndY = 0.0;

  m_SplineKnotsList: number[] = [];
  m_SplineControlPointList: SPLINE_CTRL_POINT[] = [];
  m_SplineFitPointList: Vec2[] = [];

  Clear(): void {
    this.m_EntityType = DL_UNKNOWN;
    this.m_EntityParseStatus = 0;
    this.m_EntityFlag = 0;
    this.m_LayerName = '';
    this.m_SplineDegree = 1;
    this.m_SplineKnotsCount = 0;
    this.m_SplineControlCount = 0;
    this.m_SplineFitCount = 0;
    this.m_SplineTangentStartX = 0.0;
    this.m_SplineTangentStartY = 0.0;
    this.m_SplineTangentEndX = 0.0;
    this.m_SplineTangentEndY = 0.0;
    this.m_BulgeVertex = 0.0;
    this.m_SplineKnotsList = [];
    this.m_SplineControlPointList = [];
    this.m_SplineFitPointList = [];
  }
}

/** A point this file writes through; `Vec2` is deliberately read-only. */
type MutPoint = { x: number; y: number };

/** A 3D point, `VECTOR3D`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A default-constructed `MATRIX3x3<double>` — **all zeros**, not the identity.
 *
 * This matters: `addInsert` builds its rotation and scale matrices this way and
 * only ever writes four and two entries respectively, so both carry a zero third
 * row and column into the product.
 */
export const matrixZero = (): MATRIX3x3D => [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

/** `MATRIX3x3( VECTOR3, VECTOR3, VECTOR3 )`: the three vectors are **rows**. */
export const matrixFromRows = (a1: Vec3, a2: Vec3, a3: Vec3): MATRIX3x3D => [
  [a1.x, a1.y, a1.z],
  [a2.x, a2.y, a2.z],
  [a3.x, a3.y, a3.z],
];

/** `MATRIX3x3::SetRotation`, which writes only the four rotation entries. */
export const matrixSetRotation = (m: MATRIX3x3D, aAngle: number): void => {
  const cosValue = Math.cos(aAngle);
  const sinValue = Math.sin(aAngle);

  m[0][0] = cosValue;
  m[0][1] = -sinValue;
  m[1][0] = sinValue;
  m[1][1] = cosValue;
};

/** `MATRIX3x3::SetScale`, which writes only the two diagonal entries. */
export const matrixSetScale = (m: MATRIX3x3D, aScale: Vec2): void => {
  m[0][0] = aScale.x;
  m[1][1] = aScale.y;
};

/** `operator*( MATRIX3x3, MATRIX3x3 )`, the same triple loop written out. */
export const matrixMul = (a: MATRIX3x3D, b: MATRIX3x3D): MATRIX3x3D => {
  const row = (i: 0 | 1 | 2): [number, number, number] => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0],
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1],
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2],
  ];

  return [row(0), row(1), row(2)];
};

/** `operator*( MATRIX3x3, VECTOR3 )`. */
export const matrixMulVec3 = (m: MATRIX3x3D, v: Vec3): Vec3 => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
  z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
});

const vec3Cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** `VECTOR3::Normalize`. A zero-length vector is returned unchanged, as upstream. */
const vec3Normalize = (v: Vec3): Vec3 => {
  const norm = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

  if (!(norm > 0)) return v;

  return { x: v.x / norm, y: v.y / norm, z: v.z / norm };
};

/**
 * `DXF_IMPORT_PLUGIN`.
 *
 * Use is `Load(text)` then `SetImporter(...)` then `Import()`. Loading fills the
 * internal buffer; importing replays it, which is when the drawing meets the
 * board's coordinate system for the first time.
 */
export class DXF_IMPORT_PLUGIN extends DL_CREATION_ADAPTER {
  /** X offset for conversion, in mm. */
  private m_xOffset = 0.0;
  /** Y offset for conversion, in mm. */
  private m_yOffset = 0.0;
  /** Default line thickness for conversion, in mm. */
  private m_defaultThickness = 0.2;
  /** The DXF version. Upstream keeps the field and never reads it either. */
  private m_version = 0;
  private m_codePage = '';
  /** Footprint items rather than board items. Unused by the buffer. */
  private m_importAsFPShapes = true;
  /** Messages generated during parsing; each ends with '\n'. */
  private m_messages = '';

  private m_curr_entity = new DXF2BRD_ENTITY_DATA();
  private m_mtextContent = '';

  private m_minX = Number.MAX_VALUE;
  private m_maxX = -Number.MAX_VALUE;
  private m_minY = Number.MAX_VALUE;
  private m_maxY = -Number.MAX_VALUE;

  private m_currentUnit: DXF_IMPORT_UNITS = DXF_IMPORT_UNITS.DEFAULT;
  /** Initial values per the DXF specification. */
  private m_importCoordinatePrecision = 4;
  private m_importAnglePrecision = 0;

  private m_internalImporter = new GRAPHICS_IMPORTER_BUFFER();
  private m_importer: GRAPHICS_IMPORTER | null = null;

  private m_layers: DXF_IMPORT_LAYER[] = [];
  private m_blocks: DXF_IMPORT_BLOCK[] = [];
  private m_styles: DXF_IMPORT_STYLE[] = [];
  private m_currentBlock: DXF_IMPORT_BLOCK | null = null;

  constructor() {
    super();

    // A placeholder layer, so getImportLayer always has something to fall back
    // to for an entity naming a layer the file never declared.
    this.m_layers.push(new DXF_IMPORT_LAYER('', DXF_IMPORT_LINEWEIGHT_BY_LW_DEFAULT));
  }

  GetName(): string {
    return 'AutoCAD DXF';
  }

  GetFileExtensions(): string[] {
    return ['dxf'];
  }

  /** Parse a DXF file's text into the internal buffer. */
  Load(aText: string): boolean {
    return this.ImportDxfFile(aText);
  }

  /** Replay the buffer into the importer. Requires `SetImporter` first. */
  Import(): boolean {
    if (this.m_importer === null) return false;

    this.m_internalImporter.ImportTo(this.m_importer);

    return true;
  }

  GetImageWidth(): number {
    return this.m_maxX - this.m_minX;
  }

  GetImageHeight(): number {
    return this.m_maxY - this.m_minY;
  }

  GetImageBBox(): BOX2D {
    const bbox = new BOX2D();

    bbox.SetOrigin(this.m_minX, this.m_minY);
    bbox.SetSize(this.m_maxX - this.m_minX, this.m_maxY - this.m_minY);

    return bbox;
  }

  /**
   * Every distinct DXF layer the buffered shapes came from.
   *
   * This is the list the import dialog turns into a layer map, and the map is
   * consulted by `GRAPHICS_IMPORTER::CanImportSourceLayer` at `Import()` time —
   * so a layer must be *seen* here before it can be mapped or excluded.
   */
  GetSourceLayers(): string[] {
    return this.m_internalImporter.GetSourceLayers();
  }

  /** Also adopts the importer's line width as this plugin's default thickness. */
  SetImporter(aImporter: GRAPHICS_IMPORTER): void {
    this.m_importer = aImporter;

    if (this.m_importer) this.SetDefaultLineWidthMM(this.m_importer.GetLineWidthMM());
  }

  GetImporter(): GRAPHICS_IMPORTER | null {
    return this.m_importer;
  }

  ImportAsFootprintGraphic(aImportAsFootprintGraphic: boolean): void {
    this.m_importAsFPShapes = aImportAsFootprintGraphic;
  }

  IsImportAsFootprintGraphic(): boolean {
    return this.m_importAsFPShapes;
  }

  /** The unit to assume for a DXF that does not declare one. */
  SetUnit(aUnit: DXF_IMPORT_UNITS): void {
    this.m_currentUnit = aUnit;
  }

  GetUnit(): DXF_IMPORT_UNITS {
    return this.m_currentUnit;
  }

  /** DXF has no explicit line width; this is what most imported lines get. */
  SetDefaultLineWidthMM(aWidth: number): void {
    this.m_defaultThickness = aWidth;
  }

  SetLineWidthMM(aWidth: number): void {
    this.SetDefaultLineWidthMM(aWidth);
  }

  /**
   * The offset between the imported items and pcbnew, in mm.
   *
   * DXF's Y axis runs bottom to top, so importing a full page means
   * `aOffsetX = 0, aOffsetY = -pageHeight`.
   */
  SetOffset(aOffsetX: number, aOffsetY: number): void {
    this.m_xOffset = aOffsetX;
    this.m_yOffset = aOffsetY;
  }

  GetMessages(): string {
    return this.m_messages;
  }

  /**
   * Header state the file set but nothing downstream consumes.
   *
   * Upstream has no accessors for these — `$DWGCODEPAGE`, `$LUPREC`, `$AUPREC`
   * and the DXF version are parsed into private members and then never read.
   * They are exposed here so that the header parsing is observable at all.
   */
  GetHeaderState(): {
    version: number;
    codePage: string;
    coordinatePrecision: number;
    anglePrecision: number;
  } {
    return {
      version: this.m_version,
      codePage: this.m_codePage,
      coordinatePrecision: this.m_importCoordinatePrecision,
      anglePrecision: this.m_importAnglePrecision,
    };
  }

  /** Keep a trace of DXF entities that could not be imported. */
  ReportMsg(aMessage: string): void {
    this.m_messages += aMessage;
    this.m_messages += '\n';
  }

  ImportDxfFile(aText: string): boolean {
    const reader = new DXF_READER();

    return reader.in(aText, this);
  }

  /* ------------------------------------------------------------------ */
  /* Coordinate conversion. mm out, always.                              */
  /* ------------------------------------------------------------------ */

  private mapX(aDxfCoordX: number): number {
    return this.m_xOffset + aDxfCoordX * this.getCurrentUnitScale();
  }

  /** Note the subtraction: DXF's Y axis points up and pcbnew's points down. */
  private mapY(aDxfCoordY: number): number {
    return this.m_yOffset - aDxfCoordY * this.getCurrentUnitScale();
  }

  /** A length, so no offset — only the unit scale. */
  private mapDim(aDxfValue: number): number {
    return aDxfValue * this.getCurrentUnitScale();
  }

  /**
   * Millimetres per drawing unit.
   *
   * The entries with no case fall through to 1.0, which silently imports miles,
   * kilometres, decametres, hectometres, gigametres, astronomical units,
   * lightyears and parsecs as millimetres. Upstream's, and its own comment says
   * so — those units are in the enum because `$INSUNITS` can carry them, not
   * because anything supports them.
   */
  private getCurrentUnitScale(): number {
    switch (this.m_currentUnit) {
      case DXF_IMPORT_UNITS.INCH:
        return 25.4;
      case DXF_IMPORT_UNITS.FEET:
        return 304.8;
      case DXF_IMPORT_UNITS.MM:
        return 1.0;
      case DXF_IMPORT_UNITS.CM:
        return 10.0;
      case DXF_IMPORT_UNITS.METERS:
        return 1000.0;
      case DXF_IMPORT_UNITS.MICROINCHES:
        return 2.54e-5;
      case DXF_IMPORT_UNITS.MILS:
        return 0.0254;
      case DXF_IMPORT_UNITS.YARDS:
        return 914.4;
      case DXF_IMPORT_UNITS.ANGSTROMS:
        return 1.0e-7;
      case DXF_IMPORT_UNITS.NANOMETERS:
        return 1.0e-6;
      case DXF_IMPORT_UNITS.MICRONS:
        return 1.0e-3;
      case DXF_IMPORT_UNITS.DECIMETERS:
        return 100.0;
      default:
        return 1.0;
    }
  }

  /**
   * A DXF lineweight to a width in mm.
   *
   * All non-negative lineweights are in hundredths of a millimetre. Anything
   * negative is one of the BY_LAYER / BY_BLOCK / BY_LW_DEFAULT markers, and only
   * BY_LAYER is resolved — the other two fall through to the default thickness.
   */
  private lineWeightToWidth(aLw: number, aLayer: DXF_IMPORT_LAYER | null): number {
    let lw = aLw;

    if (lw === DXF_IMPORT_LINEWEIGHT_BY_LAYER && aLayer !== null) lw = aLayer.m_lineWeight;

    let mm = this.m_defaultThickness;

    if (lw >= 0) mm = lw / 100.0;

    return mm;
  }

  /** The named layer, or the placeholder pushed by the constructor. */
  private getImportLayer(aLayerName: string): DXF_IMPORT_LAYER {
    // The constructor pushes a placeholder, so index 0 always exists.
    let layer = this.m_layers[0]!;

    if (aLayerName.length !== 0) {
      const found = this.m_layers.find((it) => it.m_layerName === aLayerName);

      if (found !== undefined) layer = found;
    }

    return layer;
  }

  /** An entity with no layer belongs to layer "0", DXF's implicit default. */
  private getDxfLayerName(aLayerName: string): string {
    return aLayerName.length === 0 ? '0' : aLayerName;
  }

  private getImportBlock(aBlockName: string): DXF_IMPORT_BLOCK | null {
    if (aBlockName.length === 0) return null;

    return this.m_blocks.find((it) => it.m_name === aBlockName) ?? null;
  }

  private getImportStyle(aStyleName: string): DXF_IMPORT_STYLE | null {
    if (aStyleName.length === 0) return null;

    return this.m_styles.find((it) => it.m_name === aStyleName) ?? null;
  }

  /** Inside a BLOCK definition, shapes go to that block, not to the drawing. */
  private bufferToUse(): GRAPHICS_IMPORTER_BUFFER {
    return this.m_currentBlock ? this.m_currentBlock.m_buffer : this.m_internalImporter;
  }

  updateImageLimits(aPoint: Vec2): void {
    this.m_minX = Math.min(aPoint.x, this.m_minX);
    this.m_maxX = Math.max(aPoint.x, this.m_maxX);

    this.m_minY = Math.min(aPoint.y, this.m_minY);
    this.m_maxY = Math.max(aPoint.y, this.m_maxY);
  }

  /* ------------------------------------------------------------------ */
  /* Arbitrary axis (OCS <-> WCS)                                        */
  /* ------------------------------------------------------------------ */

  /**
   * The object coordinate system's basis, from the entity's extrusion vector.
   *
   * The 1/64 test is the DXF specification's own arbitrary-axis algorithm: an
   * extrusion close to the world Z axis takes world Y as the reference so the
   * cross product stays well conditioned.
   */
  private getArbitraryAxis(aData: DL_Extrusion): MATRIX3x3D {
    const direction = aData.getDirection();

    const arbZ = vec3Normalize({ x: direction[0], y: direction[1], z: direction[2] });

    const arbX =
      Math.abs(arbZ.x) < 1.0 / 64.0 && Math.abs(arbZ.y) < 1.0 / 64.0
        ? vec3Normalize(vec3Cross({ x: 0, y: 1, z: 0 }, arbZ))
        : vec3Normalize(vec3Cross({ x: 0, y: 0, z: 1 }, arbZ));

    const arbY = vec3Normalize(vec3Cross(arbZ, arbX));

    return matrixFromRows(arbX, arbY, arbZ);
  }

  private wcsToOcs(aArbitraryAxis: MATRIX3x3D, aPoint: Vec3): Vec3 {
    return matrixMulVec3(aArbitraryAxis, aPoint);
  }

  /** The transpose, spelt out column by column exactly as upstream does. */
  private ocsToWcs(aArbitraryAxis: MATRIX3x3D, aPoint: Vec3): Vec3 {
    const worldX = this.wcsToOcs(aArbitraryAxis, { x: 1, y: 0, z: 0 });
    const worldY = this.wcsToOcs(aArbitraryAxis, { x: 0, y: 1, z: 0 });
    const worldZ = this.wcsToOcs(aArbitraryAxis, { x: 0, y: 0, z: 1 });

    return matrixMulVec3(matrixFromRows(worldX, worldY, worldZ), aPoint);
  }

  /* ------------------------------------------------------------------ */
  /* Reader callbacks                                                    */
  /* ------------------------------------------------------------------ */

  override setVariableInt(aKey: string, aValue: number, _aCode: number): void {
    if (aKey === '$DWGCODEPAGE') {
      // Upstream assigns an int to a std::string here, which builds a string of
      // that character. Nothing reads it back.
      this.m_codePage = String.fromCharCode(aValue);
      return;
    }

    if (aKey === '$AUPREC') {
      this.m_importAnglePrecision = aValue;
      return;
    }

    if (aKey === '$LUPREC') {
      this.m_importCoordinatePrecision = aValue;
      return;
    }

    if (aKey === '$INSUNITS') {
      this.m_currentUnit = DXF_IMPORT_UNITS.DEFAULT;

      switch (aValue) {
        case 1:
          this.m_currentUnit = DXF_IMPORT_UNITS.INCH;
          break;
        case 2:
          this.m_currentUnit = DXF_IMPORT_UNITS.FEET;
          break;
        case 4:
          this.m_currentUnit = DXF_IMPORT_UNITS.MM;
          break;
        case 5:
          this.m_currentUnit = DXF_IMPORT_UNITS.CM;
          break;
        case 6:
          this.m_currentUnit = DXF_IMPORT_UNITS.METERS;
          break;
        case 8:
          this.m_currentUnit = DXF_IMPORT_UNITS.MICROINCHES;
          break;
        case 9:
          this.m_currentUnit = DXF_IMPORT_UNITS.MILS;
          break;
        case 10:
          this.m_currentUnit = DXF_IMPORT_UNITS.YARDS;
          break;
        case 11:
          this.m_currentUnit = DXF_IMPORT_UNITS.ANGSTROMS;
          break;
        case 12:
          this.m_currentUnit = DXF_IMPORT_UNITS.NANOMETERS;
          break;
        case 13:
          this.m_currentUnit = DXF_IMPORT_UNITS.MICRONS;
          break;
        case 14:
          this.m_currentUnit = DXF_IMPORT_UNITS.DECIMETERS;
          break;
        default:
          // 0 unspecified, 3 miles, 7 km, 15..20: keep the default.
          break;
      }
    }
  }

  /**
   * A LAYER table entry.
   *
   * A layer may not itself be BY_LAYER, so that marker is rewritten to
   * BY_LW_DEFAULT; `lineWeightToWidth` then hands such a layer's entities the
   * plugin's default thickness.
   */
  override addLayer(aData: DL_LayerData): void {
    let lw = this.getAttributes().getWidth();

    if (lw === DXF_IMPORT_LINEWEIGHT_BY_LAYER) lw = DXF_IMPORT_LINEWEIGHT_BY_LW_DEFAULT;

    this.m_layers.push(new DXF_IMPORT_LAYER(aData.name, lw));
  }

  override addTextStyle(aData: DL_StyleData): void {
    this.m_styles.push(
      new DXF_IMPORT_STYLE(
        aData.name,
        aData.fixedTextHeight,
        aData.widthFactor,
        aData.bold,
        aData.italic,
      ),
    );
  }

  override addLine(aData: DL_LineData): void {
    const layer = this.getImportLayer(this.getAttributes().getLayer());
    const lineWidth = this.lineWeightToWidth(this.getAttributes().getWidth(), layer);
    const sourceLayer = this.getDxfLayerName(this.getAttributes().getLayer());

    const start: Vec2 = { x: this.mapX(aData.x1), y: this.mapY(aData.y1) };
    const end: Vec2 = { x: this.mapX(aData.x2), y: this.mapY(aData.y2) };

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(sourceLayer);
    buffer.AddLine(start, end, new IMPORTED_STROKE(lineWidth));

    this.updateImageLimits(start);
    this.updateImageLimits(end);
  }

  /**
   * A POINT, drawn as a filled circle.
   *
   * The *thickness* becomes the radius — DXF gives a point no size of its own,
   * so the only number available is used — and the stroke is set to 0.0001 mm so
   * that even a tiny circle still reads as a dot.
   */
  override addPoint(aData: DL_PointData): void {
    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const centerCoords = this.ocsToWcs(arbAxis, { x: aData.x, y: aData.y, z: aData.z });
    const center: Vec2 = { x: this.mapX(centerCoords.x), y: this.mapY(centerCoords.y) };

    const lineWidth = 0.0001;
    const thickness = this.mapDim(Math.max(aData.thickness, 0.01));

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(this.getDxfLayerName(this.getAttributes().getLayer()));
    buffer.AddCircle(center, thickness, new IMPORTED_STROKE(lineWidth), true);

    this.updateImageLimits({ x: center.x + thickness, y: center.y + thickness });
    this.updateImageLimits({ x: center.x - thickness, y: center.y - thickness });
  }

  override addCircle(aData: DL_CircleData): void {
    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const centerCoords = this.ocsToWcs(arbAxis, { x: aData.cx, y: aData.cy, z: aData.cz });

    const center: Vec2 = { x: this.mapX(centerCoords.x), y: this.mapY(centerCoords.y) };
    const layer = this.getImportLayer(this.getAttributes().getLayer());
    const lineWidth = this.lineWeightToWidth(this.getAttributes().getWidth(), layer);
    const sourceLayer = this.getDxfLayerName(this.getAttributes().getLayer());

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(sourceLayer);
    buffer.AddCircle(center, this.mapDim(aData.radius), new IMPORTED_STROKE(lineWidth), false);

    const r = this.mapDim(aData.radius);

    this.updateImageLimits({ x: center.x + r, y: center.y + r });
    this.updateImageLimits({ x: center.x - r, y: center.y - r });
  }

  /**
   * An ARC.
   *
   * DXF arcs wind counter-clockwise from `angle1` to `angle2`; pcbnew's carry a
   * negative sweep. The mirror test compares the *signs* of the arbitrary axis'
   * X and Y scales: exactly one negative means the OCS is reflected, which turns
   * a CCW arc into a CW one, and reflecting each angle about 180° and swapping
   * them undoes it.
   */
  override addArc(aData: DL_ArcData): void {
    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const centerCoords = this.ocsToWcs(arbAxis, { x: aData.cx, y: aData.cy, z: aData.cz });

    const center: Vec2 = { x: this.mapX(centerCoords.x), y: this.mapY(centerCoords.y) };

    let startangle = new EDA_ANGLE(aData.angle1, EDA_ANGLE_T.DEGREES_T);
    let endangle = new EDA_ANGLE(aData.angle2, EDA_ANGLE_T.DEGREES_T);

    const axisScale = matrixGetScale(arbAxis);

    if (axisScale.x < 0 !== axisScale.y < 0) {
      const newStart = ANGLE_180.sub(startangle);
      const newEnd = ANGLE_180.sub(endangle);

      startangle = newEnd;
      endangle = newStart;
    }

    const startPoint = RotatePointD({ x: aData.radius, y: 0.0 }, startangle.negate());
    const arcStart: Vec2 = {
      x: this.mapX(startPoint.x + centerCoords.x),
      y: this.mapY(startPoint.y + centerCoords.y),
    };

    let angle = endangle.sub(startangle).negate();

    if (angle.gt(ANGLE_0)) angle = angle.sub(ANGLE_360);

    const layer = this.getImportLayer(this.getAttributes().getLayer());
    const lineWidth = this.lineWeightToWidth(this.getAttributes().getWidth(), layer);
    const sourceLayer = this.getDxfLayerName(this.getAttributes().getLayer());

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(sourceLayer);
    buffer.AddArc(center, arcStart, angle, new IMPORTED_STROKE(lineWidth));

    const r = this.mapDim(aData.radius);

    this.updateImageLimits({ x: center.x + r, y: center.y + r });
    this.updateImageLimits({ x: center.x - r, y: center.y - r });
  }

  /**
   * An ELLIPSE, but only the degenerate case.
   *
   * A ratio of exactly 1 is a circle, and upstream reroutes it to `addCircle` or
   * `addArc` — including the detail that an elliptical arc's angles are stored in
   * *radians* and are relative to the major axis, so they need the major axis'
   * own angle subtracted before they can be handed to a circular arc.
   *
   * **The general ellipse is not ported.** Upstream calls
   * `GRAPHICS_IMPORTER_BUFFER::AddEllipse` / `AddEllipseArc`, and neither exists
   * in the ported importer half (`graphics_importer.ts` has no `IMPORTED_ELLIPSE`
   * and `GRAPHICS_IMPORTER_PCBNEW` has no `AddEllipse`). Adding them is the
   * importer half's work, not the parser's; until then a non-circular ellipse is
   * reported and dropped rather than silently drawn wrong.
   */
  override addEllipse(aData: DL_EllipseData): void {
    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    // Upstream also maps the centre here, for the ellipse it then buffers and
    // for the image limits. Neither happens on the ported path, so the centre is
    // only computed inside the reroute below.
    const majorCoords = this.ocsToWcs(arbAxis, { x: aData.mx, y: aData.my, z: aData.mz });

    const major: Vec2 = { x: this.mapX(majorCoords.x), y: this.mapY(majorCoords.y) };

    const startAngle = new EDA_ANGLE(aData.angle1, EDA_ANGLE_T.RADIANS_T);
    let endAngle = new EDA_ANGLE(aData.angle2, EDA_ANGLE_T.RADIANS_T);

    if (startAngle.gt(endAngle)) endAngle = endAngle.add(ANGLE_360);

    if (aData.ratio === 1.0) {
      const radius = Math.hypot(major.x, major.y);

      if (startAngle.equals(endAngle)) {
        this.addCircle({ cx: aData.cx, cy: aData.cy, cz: aData.cz, radius });
        return;
      }

      // Angles are relative to the major axis.
      const majorAngle = EDA_ANGLE.fromVector(major);

      this.addArc({
        cx: aData.cx,
        cy: aData.cy,
        cz: aData.cz,
        radius,
        angle1: startAngle.sub(majorAngle).AsDegrees(),
        angle2: endAngle.sub(majorAngle).AsDegrees(),
      });
      return;
    }

    this.ReportMsg('DXF ellipses are not currently supported.');
  }

  /**
   * The start of a POLYLINE or LWPOLYLINE.
   *
   * Only the entity state is set up: the geometry arrives one vertex at a time.
   * A POLYLINE may in principle be a 3D line or even a polygon mesh; the only
   * kind that imports correctly is a 2D one, and upstream assumes that of all of
   * them, dropping Z silently. Per-vertex widths are honoured (see `addVertex`)
   * even though the comment says they are not.
   */
  override addPolyline(aData: DL_PolylineData): void {
    this.m_curr_entity.Clear();
    this.m_curr_entity.m_EntityParseStatus = 1;
    this.m_curr_entity.m_EntityFlag = aData.flags;
    this.m_curr_entity.m_EntityType = DL_ENTITY_POLYLINE;
    this.m_curr_entity.m_LayerName = this.getDxfLayerName(this.getAttributes().getLayer());
  }

  /**
   * One polyline vertex.
   *
   * The bulge belongs to the segment *leaving* a vertex, so the segment drawn
   * here uses the bulge recorded with the previous vertex, and this vertex's own
   * bulge is stashed for the next call. Getting that one step out of phase
   * curves every segment in the wrong place.
   */
  override addVertex(aData: DL_VertexData): void {
    if (this.m_curr_entity.m_EntityParseStatus === 0) return; // Error

    const layer = this.getImportLayer(this.getAttributes().getLayer());
    let lineWidth = this.lineWeightToWidth(this.getAttributes().getWidth(), layer);

    // Support for per-vertex-encoded linewidth, which Cadence uses. DXF scales
    // line widths by 100.
    if (aData.startWidth > 0.0) lineWidth = aData.startWidth / 100.0;
    else if (aData.endWidth > 0.0) lineWidth = aData.endWidth / 100.0;

    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const vertexCoords = this.ocsToWcs(arbAxis, { x: aData.x, y: aData.y, z: aData.z });

    if (this.m_curr_entity.m_EntityParseStatus === 1) {
      // This is the first vertex of an entity.
      this.m_curr_entity.m_LastCoordinate = {
        x: this.mapX(vertexCoords.x),
        y: this.mapY(vertexCoords.y),
      };
      this.m_curr_entity.m_PolylineStart = { ...this.m_curr_entity.m_LastCoordinate };
      this.m_curr_entity.m_BulgeVertex = aData.bulge;
      this.m_curr_entity.m_EntityParseStatus = 2;
      return;
    }

    const segEnd: Vec2 = { x: this.mapX(vertexCoords.x), y: this.mapY(vertexCoords.y) };

    if (Math.abs(this.m_curr_entity.m_BulgeVertex) < MIN_BULGE)
      this.insertLine(this.m_curr_entity.m_LastCoordinate, segEnd, lineWidth);
    else
      this.insertArc(
        this.m_curr_entity.m_LastCoordinate,
        segEnd,
        this.m_curr_entity.m_BulgeVertex,
        lineWidth,
      );

    this.m_curr_entity.m_LastCoordinate = segEnd;
    this.m_curr_entity.m_BulgeVertex = aData.bulge;
  }

  /**
   * The entity in progress is complete.
   *
   * Polyline flag bit 0 means closed, which adds the segment back to the start —
   * with the last vertex's bulge, so a closed polyline can end on an arc.
   */
  override endEntity(): void {
    const layer = this.getImportLayer(this.getAttributes().getLayer());
    const lineWidth = this.lineWeightToWidth(this.getAttributes().getWidth(), layer);

    if (
      this.m_curr_entity.m_EntityType === DL_ENTITY_POLYLINE ||
      this.m_curr_entity.m_EntityType === DL_ENTITY_LWPOLYLINE
    ) {
      if (this.m_curr_entity.m_EntityFlag & 1) {
        if (Math.abs(this.m_curr_entity.m_BulgeVertex) < MIN_BULGE) {
          this.insertLine(
            this.m_curr_entity.m_LastCoordinate,
            this.m_curr_entity.m_PolylineStart,
            lineWidth,
          );
        } else {
          this.insertArc(
            this.m_curr_entity.m_LastCoordinate,
            this.m_curr_entity.m_PolylineStart,
            this.m_curr_entity.m_BulgeVertex,
            lineWidth,
          );
        }
      }
    }

    if (this.m_curr_entity.m_EntityType === DL_ENTITY_SPLINE) this.insertSpline(lineWidth);

    this.m_curr_entity.Clear();
  }

  override addBlock(aData: DL_BlockData): void {
    const block = new DXF_IMPORT_BLOCK(aData.name, aData.bpx, aData.bpy);

    this.m_blocks.push(block);
    this.m_currentBlock = block;
  }

  override endBlock(): void {
    this.m_currentBlock = null;
  }

  /**
   * Place a BLOCK.
   *
   * The composed transform is `(arbitraryAxis * rotation) * scale`, and both the
   * rotation and the scale start life as *zero* matrices — `SetRotation` writes
   * four entries and `SetScale` two — so the product carries a zero third row
   * and column. Nothing here reads them, but a matrix helper that "helpfully"
   * started from the identity would change the result.
   *
   * The translation is the insertion point minus the block's own base point,
   * both mapped, so the block's base point lands on the insertion point.
   *
   * A shape that arrives with no source layer, or with DXF's implicit layer "0",
   * inherits the INSERT's layer; one that named a layer of its own keeps it.
   */
  override addInsert(aData: DL_InsertData): void {
    const block = this.getImportBlock(aData.name);

    if (block === null) return;

    const insertLayer = this.getDxfLayerName(this.getAttributes().getLayer());

    const arbAxis = this.getArbitraryAxis(this.getExtrusion());

    const rot = matrixZero();
    matrixSetRotation(rot, (-aData.angle * Math.PI) / 180.0); // the angle is in degrees

    const scale = matrixZero();
    matrixSetScale(scale, { x: aData.sx, y: aData.sy });

    const trans = matrixMul(matrixMul(arbAxis, rot), scale);
    const insertCoords = this.ocsToWcs(arbAxis, { x: aData.ipx, y: aData.ipy, z: aData.ipz });

    const translation: Vec2 = {
      x: this.mapX(insertCoords.x) - this.mapX(block.m_baseX),
      y: this.mapY(insertCoords.y) - this.mapY(block.m_baseY),
    };

    for (const shape of block.m_buffer.GetShapes()) {
      const newShape = shape.clone();

      newShape.Transform(trans, translation);

      if (newShape.GetSourceLayer() === '' || newShape.GetSourceLayer() === '0')
        newShape.SetSourceLayer(insertLayer);

      this.m_internalImporter.AddShape(newShape);
    }
  }

  /**
   * A single-line TEXT entity.
   *
   * DXF gives text an insertion point and, for anything but left/baseline
   * alignment, a second "alignment point" that is the one actually meant. The
   * swap below picks the right one — except for the aligned (3) and fit (5)
   * justifications, which stretch text between two points and have no pcbnew
   * equivalent.
   *
   * The width of a glyph is guessed at 0.9 of its height, which is what makes
   * KiCad's stroke font look approximately like the original, and the stroke
   * thickness at height/8.
   */
  override addText(aData: DL_TextData): void {
    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const refPointCoords = this.ocsToWcs(arbAxis, { x: aData.ipx, y: aData.ipy, z: aData.ipz });
    const secPointCoords = this.ocsToWcs(arbAxis, {
      x: Number.isNaN(aData.apx) ? 0 : aData.apx,
      y: Number.isNaN(aData.apy) ? 0 : aData.apy,
      z: Number.isNaN(aData.apz) ? 0 : aData.apz,
    });

    let refPoint: Vec2 = { x: this.mapX(refPointCoords.x), y: this.mapY(refPointCoords.y) };
    let secPoint: Vec2 = { x: this.mapX(secPointCoords.x), y: this.mapY(secPointCoords.y) };

    // The third clause is unreachable — hJustification == 4 already satisfies
    // the second. Upstream's, kept.
    // Hoisted so TypeScript does not narrow the third clause away; it is dead
    // either way, and deleting it would hide that upstream wrote it.
    const hJustIsMiddle = aData.hJustification === 4;

    if (aData.vJustification !== 0 || aData.hJustification !== 0 || hJustIsMiddle) {
      if (aData.hJustification !== 3 && aData.hJustification !== 5) {
        const tmp = secPoint;
        secPoint = refPoint;
        refPoint = tmp;
      }
    }

    const text = DXF_IMPORT_PLUGIN.toNativeString(aData.text);

    const style = this.getImportStyle(aData.style);

    const textHeight = this.mapDim(aData.height);

    // The 0.9 factor gives a better height/width base ratio with our font.
    let charWidth = textHeight * 0.9;

    if (style !== null) charWidth *= style.m_widthFactor;

    const textWidth = charWidth * text.length; // Rough approximation
    const textThickness = textHeight / 8.0; // A reasonable line thickness for this text

    const bottomLeft: MutPoint = { x: 0.0, y: 0.0 };
    const bottomRight: MutPoint = { x: 0.0, y: 0.0 };
    const topLeft: MutPoint = { x: 0.0, y: 0.0 };
    const topRight: MutPoint = { x: 0.0, y: 0.0 };

    let hJustify = GR_TEXT_H_ALIGN_T.LEFT;
    let vJustify = GR_TEXT_V_ALIGN_T.BOTTOM;

    switch (aData.vJustification) {
      case 0: // VBaseLine
      case 1: // VBottom
        vJustify = GR_TEXT_V_ALIGN_T.BOTTOM;
        topLeft.y = textHeight;
        topRight.y = textHeight;
        break;

      case 2: // VMiddle
        vJustify = GR_TEXT_V_ALIGN_T.CENTER;
        bottomRight.y = -textHeight / 2.0;
        bottomLeft.y = -textHeight / 2.0;
        topLeft.y = textHeight / 2.0;
        topRight.y = textHeight / 2.0;
        break;

      case 3: // VTop
        vJustify = GR_TEXT_V_ALIGN_T.TOP;
        bottomLeft.y = -textHeight;
        bottomRight.y = -textHeight;
        break;
      default:
        break;
    }

    switch (aData.hJustification) {
      case 0: // HLeft
      case 3: // HAligned — no equivalent in pcbnew
      case 5: // HFit — no equivalent in pcbnew
        hJustify = GR_TEXT_H_ALIGN_T.LEFT;
        bottomRight.x = textWidth;
        topRight.x = textWidth;
        break;

      case 1: // HCenter
      case 4: // HMiddle — no equivalent in pcbnew
        hJustify = GR_TEXT_H_ALIGN_T.CENTER;
        bottomLeft.x = -textWidth / 2.0;
        topLeft.x = -textWidth / 2.0;
        bottomRight.x = textWidth / 2.0;
        topRight.x = textWidth / 2.0;
        break;

      case 2: // HRight
        hJustify = GR_TEXT_H_ALIGN_T.RIGHT;
        bottomLeft.x = -textWidth;
        topLeft.x = -textWidth;
        break;
      default:
        break;
    }

    // The reader converts group 50 from degrees to radians; this converts it
    // straight back, because pcbnew wants degrees.
    const angle_degree = (aData.angle * 180) / Math.PI;

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(this.getDxfLayerName(this.getAttributes().getLayer()));
    buffer.AddText(
      refPoint,
      text,
      textHeight,
      charWidth,
      textThickness,
      angle_degree,
      hJustify,
      vJustify,
    );

    this.updateTextImageLimits(angle_degree, refPoint, [
      bottomLeft,
      bottomRight,
      topLeft,
      topRight,
    ]);
  }

  /**
   * The corner rotation both text handlers use, bug and all.
   *
   * Upstream writes, for each corner:
   *
   *     p.x = p.x * cos - p.y * sin;
   *     p.y = p.x * sin + p.y * cos;
   *
   * The second line reads the `p.x` the first line just overwrote, so the result
   * is not a rotation for any non-zero angle. Only the reported image bounding
   * box is affected — the text itself is placed by `AddText` — so this is
   * reproduced rather than corrected.
   */
  private updateTextImageLimits(aAngleDegrees: number, aOrigin: Vec2, aCorners: MutPoint[]): void {
    const angleInRads = (aAngleDegrees * Math.PI) / 180.0;
    const cosine = Math.cos(angleInRads);
    const sine = Math.sin(angleInRads);

    for (const corner of aCorners) {
      corner.x = corner.x * cosine - corner.y * sine;
      corner.y = corner.x * sine + corner.y * cosine;

      this.updateImageLimits({ x: corner.x + aOrigin.x, y: corner.y + aOrigin.y });
    }
  }

  /**
   * A chunk of MTEXT.
   *
   * Text over 250 characters is split across repeated group 3s with the tail in
   * group 1, so chunks must accumulate and the entity's own text is appended
   * last.
   */
  override addMTextChunk(aText: string): void {
    this.m_mtextContent += aText;
  }

  /**
   * A multi-line MTEXT entity.
   *
   * Justification comes from a single attachment point numbered 1..9 reading
   * top-left to bottom-right, which is why the vertical part is a range test and
   * the horizontal part is `% 3`.
   */
  override addMText(aData: DL_MTextData): void {
    this.m_mtextContent += aData.text;

    const text = DXF_IMPORT_PLUGIN.toNativeString(this.m_mtextContent);

    const style = this.getImportStyle(aData.style);
    const textHeight = this.mapDim(aData.height);

    // The 0.9 factor gives a better height/width base ratio with our font.
    let charWidth = textHeight * 0.9;

    if (style !== null) charWidth *= style.m_widthFactor;

    const textWidth = charWidth * text.length; // Rough approximation
    const textThickness = textHeight / 8.0; // A reasonable line thickness for this text

    const bottomLeft: MutPoint = { x: 0.0, y: 0.0 };
    const bottomRight: MutPoint = { x: 0.0, y: 0.0 };
    const topLeft: MutPoint = { x: 0.0, y: 0.0 };
    const topRight: MutPoint = { x: 0.0, y: 0.0 };

    const arbAxis = this.getArbitraryAxis(this.getExtrusion());
    const textposCoords = this.ocsToWcs(arbAxis, { x: aData.ipx, y: aData.ipy, z: aData.ipz });
    const textpos: Vec2 = { x: this.mapX(textposCoords.x), y: this.mapY(textposCoords.y) };

    let hJustify = GR_TEXT_H_ALIGN_T.LEFT;
    let vJustify = GR_TEXT_V_ALIGN_T.BOTTOM;

    if (aData.attachmentPoint <= 3) {
      vJustify = GR_TEXT_V_ALIGN_T.TOP;
      bottomLeft.y = -textHeight;
      bottomRight.y = -textHeight;
    } else if (aData.attachmentPoint <= 6) {
      vJustify = GR_TEXT_V_ALIGN_T.CENTER;
      bottomRight.y = -textHeight / 2.0;
      bottomLeft.y = -textHeight / 2.0;
      topLeft.y = textHeight / 2.0;
      topRight.y = textHeight / 2.0;
    } else {
      vJustify = GR_TEXT_V_ALIGN_T.BOTTOM;
      topLeft.y = textHeight;
      topRight.y = textHeight;
    }

    if (aData.attachmentPoint % 3 === 1) {
      hJustify = GR_TEXT_H_ALIGN_T.LEFT;
      bottomRight.x = textWidth;
      topRight.x = textWidth;
    } else if (aData.attachmentPoint % 3 === 2) {
      hJustify = GR_TEXT_H_ALIGN_T.CENTER;
      bottomLeft.x = -textWidth / 2.0;
      topLeft.x = -textWidth / 2.0;
      bottomRight.x = textWidth / 2.0;
      topRight.x = textWidth / 2.0;
    } else {
      hJustify = GR_TEXT_H_ALIGN_T.RIGHT;
      bottomLeft.x = -textWidth;
      topLeft.x = -textWidth;
    }

    const angle_degree = (aData.angle * 180) / Math.PI;

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(this.getDxfLayerName(this.getAttributes().getLayer()));
    buffer.AddText(
      textpos,
      text,
      textHeight,
      charWidth,
      textThickness,
      angle_degree,
      hJustify,
      vJustify,
    );

    this.updateTextImageLimits(angle_degree, textpos, [bottomLeft, bottomRight, topLeft, topRight]);

    this.m_mtextContent = '';
  }

  /* ---- SPLINE ------------------------------------------------------- */

  override addSpline(aData: DL_SplineData): void {
    this.m_curr_entity.Clear();
    this.m_curr_entity.m_EntityParseStatus = 1;
    this.m_curr_entity.m_EntityFlag = aData.flags;
    this.m_curr_entity.m_EntityType = DL_ENTITY_SPLINE;
    this.m_curr_entity.m_SplineDegree = aData.degree;
    this.m_curr_entity.m_SplineTangentStartX = aData.tangentStartX;
    this.m_curr_entity.m_SplineTangentStartY = aData.tangentStartY;
    this.m_curr_entity.m_SplineTangentEndX = aData.tangentEndX;
    this.m_curr_entity.m_SplineTangentEndY = aData.tangentEndY;
    this.m_curr_entity.m_SplineKnotsCount = aData.nKnots;
    this.m_curr_entity.m_SplineControlCount = aData.nControl;
    this.m_curr_entity.m_SplineFitCount = aData.nFit;
    this.m_curr_entity.m_LayerName = this.getDxfLayerName(this.getAttributes().getLayer());
  }

  override addControlPoint(aData: DL_ControlPointData): void {
    this.m_curr_entity.m_SplineControlPointList.push({
      m_x: aData.x,
      m_y: aData.y,
      m_weight: aData.w,
    });
  }

  override addFitPoint(aData: DL_FitPointData): void {
    this.m_curr_entity.m_SplineFitPointList.push({ x: aData.x, y: aData.y });
  }

  override addKnot(aData: DL_KnotData): void {
    this.m_curr_entity.m_SplineKnotsList.push(aData.k);
  }

  /**
   * Turn the accumulated SPLINE into cubic Béziers.
   *
   * The control points are handed to the B-spline code in **raw DXF units** and
   * only mapped to millimetres afterwards, which is only correct because
   * `mapX`/`mapY` are affine and the Bézier decomposition is a convex
   * combination of control points.
   *
   * Two upstream quirks live in the loop below and are pinned by tests:
   *
   *  - the stride is `order`, but only four control points are read, so any
   *    spline of degree 4 or more silently loses the rest of each segment;
   *  - the `ii + 5` / `ii + 7` guards fold a truncated final segment back onto
   *    the previous control point. Upstream's comment is "not sure why this
   *    happens, but it seems to sometimes slip degree on the final bezier".
   */
  private insertSpline(aWidth: number): void {
    const imax = this.m_curr_entity.m_SplineControlPointList.length;

    if (imax < 2) return; // malformed spline

    const ctrlp: number[] = [];

    for (let ii = 0; ii < imax; ++ii) {
      ctrlp.push(this.m_curr_entity.m_SplineControlPointList[ii]!.m_x);
      ctrlp.push(this.m_curr_entity.m_SplineControlPointList[ii]!.m_y);
    }

    let coords: number[];
    let order: number;

    try {
      const beziers = bsplineToBeziers(
        ctrlp,
        this.m_curr_entity.m_SplineKnotsList,
        this.m_curr_entity.m_SplineDegree,
        2,
      );

      coords = beziers.coords;
      order = beziers.order;
    } catch (e) {
      if (!(e instanceof SPLINE_ERROR)) throw e;

      // Invalid spline definition, drop this block.
      this.ReportMsg('Invalid spline definition encountered');
      return;
    }

    const dim = 2;
    const numBeziers = Math.trunc(Math.trunc(coords.length / dim) / order);

    for (let i = 0; i < numBeziers; i++) {
      const ii = i * dim * order;
      const at = (aIndex: number): number => coords[aIndex] ?? 0;

      const start: Vec2 = { x: this.mapX(at(ii)), y: this.mapY(at(ii + 1)) };
      const bezierControl1: Vec2 = { x: this.mapX(at(ii + 2)), y: this.mapY(at(ii + 3)) };

      let bezierControl2: Vec2;

      if (ii + 5 >= coords.length) bezierControl2 = bezierControl1;
      else bezierControl2 = { x: this.mapX(at(ii + 4)), y: this.mapY(at(ii + 5)) };

      let end: Vec2;

      if (ii + 7 >= coords.length) end = bezierControl2;
      else end = { x: this.mapX(at(ii + 6)), y: this.mapY(at(ii + 7)) };

      const buffer = this.bufferToUse();
      buffer.SetCurrentSourceLayer(this.m_curr_entity.m_LayerName);
      buffer.AddSpline(start, bezierControl1, bezierControl2, end, new IMPORTED_STROKE(aWidth));
    }
  }

  /* ---- Polyline segment helpers -------------------------------------- */

  /**
   * A straight polyline segment. Its source layer comes from the *entity*, not
   * from the current attributes — a polyline's vertices carry their own layer
   * attribute and it is not the one that matters.
   */
  private insertLine(aSegStart: Vec2, aSegEnd: Vec2, aWidth: number): void {
    const origin: Vec2 = { x: aSegStart.x, y: aSegStart.y };
    const end: Vec2 = { x: aSegEnd.x, y: aSegEnd.y };

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(this.m_curr_entity.m_LayerName);
    buffer.AddLine(origin, end, new IMPORTED_STROKE(aWidth));

    this.updateImageLimits(origin);
    this.updateImageLimits(end);
  }

  /**
   * A bulged polyline segment, turned into an arc.
   *
   * The DXF bulge is the tangent of a quarter of the included angle, so
   * `ang = 4 * atan(bulge)` recovers the sweep — signed, and positive for a
   * counter-clockwise arc. The clamp to ±2000 keeps that inside about ±359.8°;
   * an unbounded bulge would drive `sin(ang/2)` to zero and the radius to
   * infinity.
   *
   * The construction happens in a right-handed frame, so both endpoints have
   * their Y negated on the way in and the centre and start have theirs negated
   * on the way out. From the chord's midpoint the centre lies perpendicular to
   * the chord, on the side the sweep's sign chooses — and for a sweep past a
   * half turn that side flips back, which is what the `±π` correction does.
   *
   * pcbnew arcs are stored with a negative angle, so a counter-clockwise DXF arc
   * is emitted from its start point with the angle negated, and a clockwise one
   * from its *end* point with the angle as-is.
   */
  private insertArc(aSegStart: Vec2, aSegEnd: Vec2, aBulge: number, aWidth: number): void {
    let bulge = aBulge;

    // Ensure the bulge represents an angle in +/- ( 0 .. approx 359.8 deg ).
    if (bulge < -2000.0) bulge = -2000.0;
    else if (bulge > 2000.0) bulge = 2000.0;

    const ang = 4.0 * Math.atan(bulge);

    // Reflect the Y values to put everything in a RHCS.
    const sp: Vec2 = { x: aSegStart.x, y: -aSegStart.y };
    const ep: Vec2 = { x: aSegEnd.x, y: -aSegEnd.y };

    // Angle from end->start.
    let offAng = Math.atan2(ep.y - sp.y, ep.x - sp.x);

    // Length of the subtended segment = 1/2 the distance between the 2 points.
    const d = 0.5 * Math.sqrt((sp.x - ep.x) * (sp.x - ep.x) + (sp.y - ep.y) * (sp.y - ep.y));

    // Midpoint of the subtended segment.
    const xm = (sp.x + ep.x) * 0.5;
    const ym = (sp.y + ep.y) * 0.5;
    let radius = d / Math.sin(ang * 0.5);

    if (radius < 0.0) radius = -radius;

    // The height of the triangle with base d and hypotenuse r.
    let dh2 = radius * radius - d * d;

    // This should only ever happen due to rounding errors when r == d.
    if (dh2 < 0.0) dh2 = 0.0;

    const h = Math.sqrt(dh2);

    if (ang < 0.0) offAng -= Math.PI / 2;
    else offAng += Math.PI / 2;

    // For angles greater than 180 deg the direction in which the arc centre is
    // found relative to the midpoint of the subtended segment flips.
    if (ang < -Math.PI) offAng += Math.PI;
    else if (ang > Math.PI) offAng -= Math.PI;

    const cx = h * Math.cos(offAng) + xm;
    const cy = h * Math.sin(offAng) + ym;
    const center: Vec2 = { x: cx, y: -cy };

    let arc_start: Vec2;
    let angle = new EDA_ANGLE(ang, EDA_ANGLE_T.RADIANS_T);

    if (ang < 0.0) {
      arc_start = { x: ep.x, y: -ep.y };
    } else {
      arc_start = { x: sp.x, y: -sp.y };
      angle = angle.negate();
    }

    const buffer = this.bufferToUse();
    buffer.SetCurrentSourceLayer(this.m_curr_entity.m_LayerName);
    buffer.AddArc(center, arc_start, angle, new IMPORTED_STROKE(aWidth));

    this.updateImageLimits({ x: center.x + radius, y: center.y + radius });
    this.updateImageLimits({ x: center.x - radius, y: center.y - radius });
  }

  /* ---- Unsupported entities ------------------------------------------ */

  override addXLine(): void {
    this.ReportMsg('DXF construction lines not currently supported.');
  }

  override addRay(): void {
    this.ReportMsg('DXF construction lines not currently supported.');
  }

  override addArcAlignedText(): void {
    this.ReportMsg('DXF arc-aligned text not currently supported.');
  }

  override addDimAlign(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimLinear(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimRadial(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimDiametric(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimAngular(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimAngular3P(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addDimOrdinate(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  /** LEADER shares the dimensions message upstream, misleading as that is. */
  override addLeader(): void {
    this.ReportMsg('DXF dimensions not currently supported.');
  }

  override addHatch(): void {
    this.ReportMsg('DXF hatches not currently supported.');
  }

  override addTrace(): void {
    this.ReportMsg('DXF traces not currently supported.');
  }

  override add3dFace(): void {
    this.ReportMsg('DXF 3dfaces not currently supported.');
  }

  override addSolid(): void {
    this.ReportMsg('DXF solids not currently supported.');
  }

  override addImage(): void {
    this.ReportMsg('DXF images not currently supported.');
  }

  /* ---- String conversion --------------------------------------------- */

  /**
   * A native string to DXF's encoding: `%%c` diameter, `%%d` degree, `%%p`
   * plus/minus, `\P` newline. The inverse of `toNativeString`, and the only
   * thing that needs it is a DXF *writer*, so nothing in this file calls it.
   */
  static toDxfString(aStr: string): string {
    let res = '';
    let j = 0;

    for (let i = 0; i < aStr.length; ++i) {
      const c = aStr.charCodeAt(i);

      if (c > 175 || c < 11) {
        res += aStr.substring(j, i);
        j = i;

        switch (c) {
          case 0x0a:
            res += '\\P';
            break;
          case 0x2205: // diameter (empty set)
            res += '%%C';
            break;
          case 0x00b0: // degree
            res += '%%D';
            break;
          case 0x00b1: // plus/minus
            res += '%%P';
            break;
          default:
            j--;
            break;
        }

        j++;
      }
    }

    res += aStr.substring(j);

    return res;
  }

  /**
   * DXF's MTEXT control codes to a native string.
   *
   * See https://ezdxf.readthedocs.io/en/stable/dxfinternals/entities/mtext.html
   * and https://www.cadforum.cz/en/text-formatting-codes-in-mtext-objects-tip8640
   *
   * The overbar handling is the subtle part: `\O` opens KiCad's `~{` overbar and
   * records the brace depth it opened at, so that the matching `}` — or an `\o`
   * at the same depth — closes it, and an overbar left open at the end of the
   * string is closed anyway. Codes that take an argument (`\H`, `\C`, `\f`, …)
   * are skipped to their terminating `;`.
   */
  static toNativeString(aData: string): string {
    let res = '';
    let braces = 0;
    let overbarLevel = -1;

    for (let i = 0; i < aData.length; i++) {
      switch (aData[i]) {
        case '{': // Text area influenced by the code
          braces++;
          break;

        case '}':
          if (overbarLevel === braces) {
            res += '}';
            overbarLevel = -1;
          }
          braces--;
          break;

        case '^': // C0 control code
          if (++i >= aData.length) break;

          switch (aData[i]) {
            case 'I':
              res += '\t';
              break;
            case 'J':
              res += '\b';
              break;
            case ' ':
              res += '^';
              break;
            default:
              break;
          }
          break;

        case '\\': {
          if (++i >= aData.length) break;

          switch (aData[i]) {
            case 'P': // New paragraph (new line)
            case 'X': // Paragraph wrap on the dimension line (only in dimensions)
              res += '\n';
              break;

            case '~': // Non-wrapping space, hard space
              res += ' ';
              break;

            case 'U': {
              // Unicode character, e.g. \U+ff08
              i += 2;
              let codeHex = '';

              for (; codeHex.length < 4 && i < aData.length; i++) codeHex += aData[i];

              const codeVal = Number.parseInt(codeHex, 16);

              if (!Number.isNaN(codeVal) && codeVal !== 0) res += String.fromCodePoint(codeVal);

              i--;
              break;
            }

            case 'S': {
              // Stacking
              i++;
              let stacked = '';

              for (; i < aData.length; i++) {
                if (aData[i] === ';') break;

                stacked += aData[i];
              }

              if (stacked.includes('#')) {
                const hash = stacked.indexOf('#');

                res += '^{';
                res += stacked.substring(0, hash);
                res += '}/_{';
                res += stacked.substring(hash + 1);
                res += '}';
              } else {
                res += stacked.replace(/\^ /g, '/');
              }
              break;
            }

            case 'O': // Start overstrike
              if (overbarLevel === -1) {
                res += '~{';
                overbarLevel = braces;
              }
              break;

            case 'o': // Stop overstrike
              if (overbarLevel === braces) {
                res += '}';
                overbarLevel = -1;
              }
              break;

            case 'L': // Start underline
            case 'l': // Stop underline
            case 'K': // Start strike-through
            case 'k': // Stop strike-through
            case 'N': // New column
              // Ignore
              break;

            case 'p': // Bullets, numbered paragraphs, tab stops and columns
            case 'Q': // Slanting (obliquing) text by angle
            case 'H': // Text height
            case 'W': // Text width
            case 'F': // Font selection
            case 'f': // Font selection (alternative)
            case 'A': // Alignment
            case 'C': // Color change (ACI colors)
            case 'c': // Color change (truecolor)
            case 'T': // Tracking, char.spacing
              // Skip to ;
              for (; i < aData.length; i++) {
                if (aData[i] === ';') break;
              }
              break;

            default: // Escaped character
              if (++i >= aData.length) break;

              res += aData[i];
              break;
          }
          break;
        }

        default:
          res += aData[i];
          break;
      }
    }

    if (overbarLevel !== -1) res += '}';

    // Empty_set for diameter, then degree, then plus/minus.
    res = res.replace(/%%[cC]/g, '∅');
    res = res.replace(/%%[dD]/g, '°');
    res = res.replace(/%%[pP]/g, '±');

    return res;
  }
}
