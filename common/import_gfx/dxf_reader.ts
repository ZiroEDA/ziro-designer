// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
// Portions derived from dxflib, copyright RibbonSoft GmbH (GPL-2.0-or-later).
/**
 * `DL_Dxf`, the DXF group-code reader KiCad's DXF importer sits on top of.
 *
 * Counterpart: `thirdparty/dxflib_qcad/dl_dxf.{h,cpp}` plus `dl_attributes.h`,
 * `dl_extrusion.h`, `dl_entities.h` and `dl_creationadapter.h`. (KiCad's own
 * file comment calls the library "libdxfrw"; the code it actually links is
 * dxflib as shipped by QCAD, whose classes are all `DL_`-prefixed. The comment
 * is wrong upstream and is not worth propagating.)
 *
 * A DXF file is a flat stream of *group couplets*: a line holding an integer
 * group code, then a line holding that group's value. There is no nesting and
 * no terminator — an entity is "finished" only when the next code 0 or code 9
 * arrives. Everything about this reader follows from that one fact:
 *
 *  - Values accumulate into a map keyed by group code, and the entity is built
 *    from that map at the *next* code 0/9, not when its own code 0 was seen.
 *  - The map is keyed and iterated in ascending code order, because
 *    `addSetting` identifies a header variable's type from the *smallest* code
 *    present (`values.begin()->first` on a `std::map`). A `Map` in insertion
 *    order would pick a different one, so `lowestCode` sorts.
 *  - Entities with an unbounded number of sub-values — LWPOLYLINE vertices,
 *    spline knots and control points, leader vertices — cannot use the map at
 *    all, since each repetition would overwrite the last. Those get dedicated
 *    "continuation" handlers that append to arrays instead, and the arrays are
 *    pre-sized by a count group (90, 72/73/74, 76) that the file promises comes
 *    first.
 *
 * Two parsing details are load-bearing and easy to lose:
 *
 *  - The *code* line is stripped of leading and trailing whitespace; the
 *    *value* line only has its trailing CR/LF removed. A DXF text string may
 *    legitimately start with a space.
 *  - `toInt` is `strtol` base 10 and `toInt16` is `strtol` base **16** (group 5,
 *    the handle, is hexadecimal); `toReal` first rewrites ',' to '.', for files
 *    written under a comma-decimal locale.
 */

/** `DL_DXF_MAXGROUPCODE`. Codes at or above this are dropped, not stored. */
const DL_DXF_MAXGROUPCODE = 1100;

/* Object type constants, `dl_dxf.h`. */
export const DL_UNKNOWN = 0;
export const DL_LAYER = 10;
export const DL_BLOCK = 11;
export const DL_ENDBLK = 12;
export const DL_LINETYPE = 13;
export const DL_STYLE = 20;
export const DL_SETTING = 50;
export const DL_ENTITY_POINT = 100;
export const DL_ENTITY_LINE = 101;
export const DL_ENTITY_POLYLINE = 102;
export const DL_ENTITY_LWPOLYLINE = 103;
export const DL_ENTITY_VERTEX = 104;
export const DL_ENTITY_SPLINE = 105;
export const DL_ENTITY_ARC = 108;
export const DL_ENTITY_CIRCLE = 109;
export const DL_ENTITY_ELLIPSE = 110;
export const DL_ENTITY_INSERT = 111;
export const DL_ENTITY_TEXT = 112;
export const DL_ENTITY_MTEXT = 113;
export const DL_ENTITY_DIMENSION = 114;
export const DL_ENTITY_LEADER = 115;
export const DL_ENTITY_HATCH = 116;
export const DL_ENTITY_ATTRIB = 117;
export const DL_ENTITY_IMAGE = 118;
export const DL_ENTITY_IMAGEDEF = 119;
export const DL_ENTITY_TRACE = 120;
export const DL_ENTITY_SOLID = 121;
export const DL_ENTITY_3DFACE = 122;
export const DL_ENTITY_XLINE = 123;
export const DL_ENTITY_RAY = 124;
export const DL_ENTITY_ARCALIGNEDTEXT = 125;
export const DL_ENTITY_SEQEND = 126;
export const DL_XRECORD = 200;
export const DL_DICTIONARY = 210;

/** `DL_NANDOUBLE`, the "no alignment point given" marker on TEXT. */
export const DL_NANDOUBLE = Number.NaN;

/** `DL_Attributes`: layer, colour, lineweight and linetype of one entity. */
export class DL_Attributes {
  constructor(
    public layer = '',
    public color = 0,
    public color24 = -1,
    public width = 0,
    public linetype = 'BYLAYER',
    public handle = -1,
    public linetypeScale = 1.0,
    public inPaperSpace = false,
  ) {}

  getLayer(): string {
    return this.layer;
  }
  getColor(): number {
    return this.color;
  }
  getColor24(): number {
    return this.color24;
  }
  getWidth(): number {
    return this.width;
  }
  setWidth(aWidth: number): void {
    this.width = aWidth;
  }
  setColor(aColor: number): void {
    this.color = aColor;
  }
  setLinetype(aLinetype: string): void {
    this.linetype = aLinetype;
  }
  /** An empty linetype reads back as "BYLAYER", never as "". */
  getLinetype(): string {
    return this.linetype.length === 0 ? 'BYLAYER' : this.linetype;
  }
}

/**
 * `DL_Extrusion`: the entity's local Z axis, plus the elevation of its plane.
 *
 * Defaults to +Z, which is what makes the arbitrary-axis transform an identity
 * for the overwhelming majority of 2D drawings.
 */
export class DL_Extrusion {
  direction: [number, number, number] = [0.0, 0.0, 1.0];
  elevation = 0.0;

  setDirection(dx: number, dy: number, dz: number): void {
    this.direction = [dx, dy, dz];
  }
  getDirection(): [number, number, number] {
    return this.direction;
  }
  setElevation(aElevation: number): void {
    this.elevation = aElevation;
  }
  getElevation(): number {
    return this.elevation;
  }
}

export interface DL_LayerData {
  name: string;
  flags: number;
}

export interface DL_LinetypeData {
  name: string;
  description: string;
  flags: number;
  numberOfDashes: number;
  patternLength: number;
}

export interface DL_BlockData {
  name: string;
  flags: number;
  bpx: number;
  bpy: number;
  bpz: number;
}

export interface DL_StyleData {
  name: string;
  flags: number;
  fixedTextHeight: number;
  widthFactor: number;
  obliqueAngle: number;
  textGenerationFlags: number;
  lastHeightUsed: number;
  primaryFontFile: string;
  bigFontFile: string;
  /** dxflib never reads these from the file; they are always false. */
  bold: boolean;
  italic: boolean;
}

export interface DL_PointData {
  x: number;
  y: number;
  z: number;
  thickness: number;
}

export interface DL_LineData {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

export interface DL_XLineData {
  bx: number;
  by: number;
  bz: number;
  dx: number;
  dy: number;
  dz: number;
}

export type DL_RayData = DL_XLineData;

export interface DL_PolylineData {
  number: number;
  m: number;
  n: number;
  elevation: number;
  flags: number;
}

export interface DL_VertexData {
  x: number;
  y: number;
  z: number;
  bulge: number;
  startWidth: number;
  endWidth: number;
}

export interface DL_SplineData {
  degree: number;
  nKnots: number;
  nControl: number;
  nFit: number;
  flags: number;
  tangentStartX: number;
  tangentStartY: number;
  tangentStartZ: number;
  tangentEndX: number;
  tangentEndY: number;
  tangentEndZ: number;
}

export interface DL_ControlPointData {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface DL_FitPointData {
  x: number;
  y: number;
  z: number;
}

export interface DL_KnotData {
  k: number;
}

export interface DL_ArcData {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
  angle1: number;
  angle2: number;
}

export interface DL_CircleData {
  cx: number;
  cy: number;
  cz: number;
  radius: number;
}

export interface DL_EllipseData {
  cx: number;
  cy: number;
  cz: number;
  mx: number;
  my: number;
  mz: number;
  ratio: number;
  angle1: number;
  angle2: number;
}

export interface DL_InsertData {
  name: string;
  ipx: number;
  ipy: number;
  ipz: number;
  sx: number;
  sy: number;
  sz: number;
  angle: number;
  cols: number;
  rows: number;
  colSp: number;
  rowSp: number;
}

export interface DL_TextData {
  ipx: number;
  ipy: number;
  ipz: number;
  apx: number;
  apy: number;
  apz: number;
  height: number;
  xScaleFactor: number;
  textGenerationFlags: number;
  hJustification: number;
  vJustification: number;
  text: string;
  style: string;
  angle: number;
}

export interface DL_MTextData {
  ipx: number;
  ipy: number;
  ipz: number;
  dirx: number;
  diry: number;
  dirz: number;
  height: number;
  width: number;
  attachmentPoint: number;
  drawingDirection: number;
  lineSpacingStyle: number;
  lineSpacingFactor: number;
  text: string;
  style: string;
  angle: number;
}

/** TRACE, SOLID and 3DFACE share one four-corner shape. */
export interface DL_TraceData {
  thickness: number;
  x: [number, number, number, number];
  y: [number, number, number, number];
  z: [number, number, number, number];
}

export type DL_SolidData = DL_TraceData;
export type DL_3dFaceData = DL_TraceData;

export interface DL_DimensionData {
  dpx: number;
  dpy: number;
  dpz: number;
  mpx: number;
  mpy: number;
  mpz: number;
  type: number;
  attachmentPoint: number;
  lineSpacingStyle: number;
  lineSpacingFactor: number;
  text: string;
  style: string;
  angle: number;
  arrow1Flipped: boolean;
  arrow2Flipped: boolean;
}

export interface DL_DimLinearData {
  dpx1: number;
  dpy1: number;
  dpz1: number;
  dpx2: number;
  dpy2: number;
  dpz2: number;
  angle: number;
  oblique: number;
}

export interface DL_DimAlignedData {
  epx1: number;
  epy1: number;
  epz1: number;
  epx2: number;
  epy2: number;
  epz2: number;
}

export interface DL_DimRadialData {
  dpx: number;
  dpy: number;
  dpz: number;
  leader: number;
}

export type DL_DimDiametricData = DL_DimRadialData;

export interface DL_DimAngular2LData {
  dpx1: number;
  dpy1: number;
  dpz1: number;
  dpx2: number;
  dpy2: number;
  dpz2: number;
  dpx3: number;
  dpy3: number;
  dpz3: number;
  dpx4: number;
  dpy4: number;
  dpz4: number;
}

export interface DL_DimAngular3PData {
  dpx1: number;
  dpy1: number;
  dpz1: number;
  dpx2: number;
  dpy2: number;
  dpz2: number;
  dpx3: number;
  dpy3: number;
  dpz3: number;
}

export interface DL_DimOrdinateData {
  dpx1: number;
  dpy1: number;
  dpz1: number;
  dpx2: number;
  dpy2: number;
  dpz2: number;
  xtype: boolean;
}

export interface DL_LeaderData {
  arrowHeadFlag: number;
  leaderPathType: number;
  leaderCreationFlag: number;
  hooklineDirectionFlag: number;
  hasHookline: number;
  textAnnotationHeight: number;
  textAnnotationWidth: number;
  number: number;
}

export interface DL_LeaderVertexData {
  x: number;
  y: number;
  z: number;
}

export interface DL_HatchData {
  numLoops: number;
  solid: boolean;
  scale: number;
  angle: number;
  pattern: string;
}

export interface DL_ImageData {
  ref: string;
  ipx: number;
  ipy: number;
  ipz: number;
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  fade: number;
}

export interface DL_ImageDefData {
  ref: string;
  file: string;
}

export interface DL_AttributeData extends DL_TextData {
  tag: string;
}

/**
 * `DL_CreationAdapter`: every callback the reader can make, defaulted to a
 * no-op. `DXF_IMPORT_PLUGIN` overrides the handful it cares about.
 *
 * The adapter — not the reader — owns the current attributes and extrusion,
 * because the reader sets them once per entity and the handlers read them back
 * whenever they like.
 */
export abstract class DL_CREATION_ADAPTER {
  protected attributes = new DL_Attributes();
  protected extrusion = new DL_Extrusion();

  setAttributes(aAttrib: DL_Attributes): void {
    this.attributes = aAttrib;
  }
  getAttributes(): DL_Attributes {
    return this.attributes;
  }
  setExtrusion(dx: number, dy: number, dz: number, elevation: number): void {
    this.extrusion.setDirection(dx, dy, dz);
    this.extrusion.setElevation(elevation);
  }
  getExtrusion(): DL_Extrusion {
    return this.extrusion;
  }

  /* biome-ignore-start lint/correctness/noUnusedFunctionParameters: the adapter's
     whole point is to name every callback and ignore its argument. */
  processCodeValuePair(aCode: number, aValue: string): void {}
  endSection(): void {}
  addLayer(aData: DL_LayerData): void {}
  addLinetype(aData: DL_LinetypeData): void {}
  addLinetypeDash(aLength: number): void {}
  addBlock(aData: DL_BlockData): void {}
  endBlock(): void {}
  addTextStyle(aData: DL_StyleData): void {}
  addPoint(aData: DL_PointData): void {}
  addLine(aData: DL_LineData): void {}
  addXLine(aData: DL_XLineData): void {}
  addRay(aData: DL_RayData): void {}
  addArc(aData: DL_ArcData): void {}
  addCircle(aData: DL_CircleData): void {}
  addEllipse(aData: DL_EllipseData): void {}
  addPolyline(aData: DL_PolylineData): void {}
  addVertex(aData: DL_VertexData): void {}
  addSpline(aData: DL_SplineData): void {}
  addControlPoint(aData: DL_ControlPointData): void {}
  addFitPoint(aData: DL_FitPointData): void {}
  addKnot(aData: DL_KnotData): void {}
  addInsert(aData: DL_InsertData): void {}
  addMText(aData: DL_MTextData): void {}
  addMTextChunk(aText: string): void {}
  addText(aData: DL_TextData): void {}
  addArcAlignedText(aData: DL_TextData): void {}
  addAttribute(aData: DL_AttributeData): void {}
  addDimAlign(aData: DL_DimensionData, aEdata: DL_DimAlignedData): void {}
  addDimLinear(aData: DL_DimensionData, aEdata: DL_DimLinearData): void {}
  addDimRadial(aData: DL_DimensionData, aEdata: DL_DimRadialData): void {}
  addDimDiametric(aData: DL_DimensionData, aEdata: DL_DimDiametricData): void {}
  addDimAngular(aData: DL_DimensionData, aEdata: DL_DimAngular2LData): void {}
  addDimAngular3P(aData: DL_DimensionData, aEdata: DL_DimAngular3PData): void {}
  addDimOrdinate(aData: DL_DimensionData, aEdata: DL_DimOrdinateData): void {}
  addLeader(aData: DL_LeaderData): void {}
  addLeaderVertex(aData: DL_LeaderVertexData): void {}
  addHatch(aData: DL_HatchData): void {}
  addTrace(aData: DL_TraceData): void {}
  add3dFace(aData: DL_3dFaceData): void {}
  addSolid(aData: DL_SolidData): void {}
  addImage(aData: DL_ImageData): void {}
  linkImage(aData: DL_ImageDefData): void {}
  addXDataApp(aName: string): void {}
  addXDataString(aCode: number, aValue: string): void {}
  addXDataReal(aCode: number, aValue: number): void {}
  addXDataInt(aCode: number, aValue: number): void {}
  endEntity(): void {}
  endSequence(): void {}
  addComment(aComment: string): void {}
  setVariableVector(aKey: string, x: number, y: number, z: number, aCode: number): void {}
  setVariableString(aKey: string, aValue: string, aCode: number): void {}
  setVariableInt(aKey: string, aValue: number, aCode: number): void {}
  setVariableDouble(aKey: string, aValue: number, aCode: number): void {}
  /* biome-ignore-end lint/correctness/noUnusedFunctionParameters: see above. */
}

/**
 * `DL_Dxf`, reduced to reading. (The writing half of the C++ class is a DXF
 * *plotter*, which ZiroEDA already has in `plot_dxf.ts`.)
 */
export class DXF_READER {
  private values = new Map<number, string>();
  private groupCode = 0;
  private groupValue = '';
  private currentObjectType: number = DL_UNKNOWN;
  private settingKey = '';
  private libVersion = 0;

  /** LWPOLYLINE vertex buffer: four doubles per vertex, x/y/z/bulge. */
  private vertices: number[] = [];
  private maxVertices = 0;
  private vertexIndex = -1;

  private knots: number[] = [];
  private maxKnots = 0;
  private knotIndex = -1;

  private weights: number[] = [];
  private weightIndex = -1;

  private controlPoints: number[] = [];
  private maxControlPoints = 0;
  private controlPointIndex = -1;

  private fitPoints: number[] = [];
  private maxFitPoints = 0;
  private fitPointIndex = -1;

  private leaderVertices: number[] = [];
  private maxLeaderVertices = 0;
  private leaderVertexIndex = -1;

  /**
   * `DL_Dxf::in`, over the file's text rather than a `FILE*`.
   *
   * Returns true for any readable input, as upstream returns true for any
   * openable file: a DXF that parses to nothing is not an error.
   */
  in(aText: string, aCreationInterface: DL_CREATION_ADAPTER): boolean {
    this.currentObjectType = DL_UNKNOWN;

    const lines = aText.split('\n');

    // A trailing newline does not make an extra (empty) line in C++, where the
    // read stops at EOF.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    for (let i = 0; i + 1 < lines.length; i += 2) {
      const codeLine = stripWhiteSpace(lines[i] ?? '', true);
      const valueLine = stripWhiteSpace(lines[i + 1] ?? '', false);

      this.groupCode = toInt(codeLine);
      this.groupValue = valueLine;

      aCreationInterface.processCodeValuePair(this.groupCode, this.groupValue);
      this.processDXFGroup(aCreationInterface, this.groupCode, this.groupValue);
    }

    return true;
  }

  private hasValue(code: number): boolean {
    return this.values.has(code);
  }

  private getIntValue(code: number, def: number): number {
    const v = this.values.get(code);
    return v === undefined ? def : toInt(v);
  }

  private getInt16Value(code: number, def: number): number {
    const v = this.values.get(code);
    return v === undefined ? def : toInt16(v);
  }

  private getStringValue(code: number, def: string): string {
    const v = this.values.get(code);
    return v === undefined ? def : v;
  }

  private getRealValue(code: number, def: number): number {
    const v = this.values.get(code);
    return v === undefined ? def : toReal(v);
  }

  /** `values.begin()->first` on an ordered `std::map`. */
  private lowestCode(): number {
    let lowest = -1;

    for (const code of this.values.keys()) {
      if (lowest === -1 || code < lowest) lowest = code;
    }

    return lowest;
  }

  private processDXFGroup(ci: DL_CREATION_ADAPTER, aGroupCode: number, aGroupValue: string): void {
    if (aGroupCode === 999) {
      if (aGroupValue.length > 0) {
        if (aGroupValue.substring(0, 6) === 'dxflib')
          this.libVersion = getLibVersion(aGroupValue.substring(7));

        ci.addComment(aGroupValue);
      }

      return;
    }

    if (aGroupCode === 0 || aGroupCode === 9) {
      this.flushEntity(ci);

      const prevEntity = this.currentObjectType;

      this.currentObjectType = nextObjectType(aGroupValue);

      if (this.currentObjectType === DL_SETTING) this.settingKey = aGroupValue;

      // End of an old-style POLYLINE: its VERTEX list is terminated by anything
      // that is not another VERTEX (normally SEQEND).
      if (prevEntity === DL_ENTITY_VERTEX && this.currentObjectType !== DL_ENTITY_VERTEX)
        ci.endEntity();

      return;
    }

    // Continuation of the entity already in progress.
    if (aGroupCode < DL_DXF_MAXGROUPCODE) {
      let handled = false;

      switch (this.currentObjectType) {
        case DL_ENTITY_MTEXT:
          handled = this.handleMTextData(ci);
          break;
        case DL_ENTITY_LWPOLYLINE:
          handled = this.handleLWPolylineData();
          break;
        case DL_ENTITY_SPLINE:
          handled = this.handleSplineData();
          break;
        case DL_ENTITY_LEADER:
          handled = this.handleLeaderData();
          break;
        case DL_LINETYPE:
          handled = this.handleLinetypeData(ci);
          break;
        default:
          break;
      }

      // XRECORD, DICTIONARY and HATCH have continuation handlers upstream too.
      // None of them is ported: every callback they can reach is a no-op in
      // DXF_IMPORT_PLUGIN, so the only difference is that their group values
      // land in `values` and are then discarded with the rest of the entity.
      //
      // The assignment below *overwrites* `handled` rather than or-ing into it,
      // which is upstream's and is not a typo to fix: a group that a per-entity
      // handler already consumed is stored in `values` as well, because XData
      // declined it. No entity reads a code back that its own handler owns, so
      // nothing observable comes of it — but the stored value is real.
      if (this.currentObjectType !== DL_XRECORD) handled = this.handleXData(ci);

      if (!handled) this.values.set(aGroupCode, aGroupValue);
    }
  }

  /**
   * Build and dispatch the entity whose values have been accumulating, then
   * reset for the next one.
   *
   * The attributes and the extrusion are rebuilt here, once per entity, and
   * every handler reads them back off the creation interface.
   */
  private flushEntity(ci: DL_CREATION_ADAPTER): void {
    const layer = this.getStringValue(8, '0');

    let width: number;

    // Compatibility with qcad1:
    if (this.hasValue(39) && !this.hasValue(370)) width = this.getIntValue(39, -1);
    // since autocad 2002:
    else if (this.hasValue(370)) width = this.getIntValue(370, -1);
    // default to BYLAYER:
    else width = -1;

    const attrib = new DL_Attributes(
      layer,
      this.getIntValue(62, 256),
      this.getIntValue(420, -1),
      width,
      this.getStringValue(6, 'BYLAYER'),
      this.getInt16Value(5, -1),
      this.getRealValue(48, 1.0),
      this.getIntValue(67, 0) !== 0,
    );

    ci.setAttributes(attrib);

    // LWPOLYLINE puts its elevation in group 38; everything else in 30.
    const elevationGroupCode = this.currentObjectType === DL_ENTITY_LWPOLYLINE ? 38 : 30;

    ci.setExtrusion(
      this.getRealValue(210, 0.0),
      this.getRealValue(220, 0.0),
      this.getRealValue(230, 1.0),
      this.getRealValue(elevationGroupCode, 0.0),
    );

    switch (this.currentObjectType) {
      case DL_SETTING:
        this.addSetting(ci);
        break;
      case DL_LAYER:
        this.addLayer(ci);
        break;
      case DL_LINETYPE:
        this.addLinetype(ci);
        break;
      case DL_BLOCK:
        this.addBlock(ci);
        break;
      case DL_ENDBLK:
        ci.endBlock();
        break;
      case DL_STYLE:
        this.addTextStyle(ci);
        break;
      case DL_ENTITY_POINT:
        this.addPoint(ci);
        break;
      case DL_ENTITY_LINE:
        this.addLine(ci);
        break;
      case DL_ENTITY_XLINE:
        ci.addXLine(this.twoPointData());
        break;
      case DL_ENTITY_RAY:
        ci.addRay(this.twoPointData());
        break;
      case DL_ENTITY_POLYLINE:
      case DL_ENTITY_LWPOLYLINE:
        this.addPolyline(ci);
        break;
      case DL_ENTITY_VERTEX:
        this.addVertex(ci);
        break;
      case DL_ENTITY_SPLINE:
        this.addSpline(ci);
        break;
      case DL_ENTITY_ARC:
        this.addArc(ci);
        break;
      case DL_ENTITY_CIRCLE:
        this.addCircle(ci);
        break;
      case DL_ENTITY_ELLIPSE:
        this.addEllipse(ci);
        break;
      case DL_ENTITY_INSERT:
        this.addInsert(ci);
        break;
      case DL_ENTITY_MTEXT:
        this.addMText(ci);
        break;
      case DL_ENTITY_TEXT:
        ci.addText(this.textData());
        break;
      case DL_ENTITY_ARCALIGNEDTEXT:
        ci.addArcAlignedText(this.textData());
        break;
      case DL_ENTITY_ATTRIB:
        ci.addAttribute({ ...this.textData(), tag: this.getStringValue(2, '') });
        break;
      case DL_ENTITY_DIMENSION:
        this.addDimension(ci);
        break;
      case DL_ENTITY_LEADER:
        this.addLeader(ci);
        break;
      case DL_ENTITY_HATCH:
        ci.addHatch({
          numLoops: this.getIntValue(91, 1),
          solid: this.getIntValue(70, 0) !== 0,
          scale: this.getRealValue(41, 1.0),
          angle: this.getRealValue(52, 0.0),
          pattern: this.getStringValue(2, ''),
        });
        break;
      case DL_ENTITY_IMAGE:
        this.addImage(ci);
        break;
      case DL_ENTITY_IMAGEDEF:
        ci.linkImage({ ref: this.getStringValue(5, ''), file: this.getStringValue(1, '') });
        break;
      case DL_ENTITY_TRACE:
        ci.addTrace(this.fourCornerData());
        break;
      case DL_ENTITY_3DFACE:
        ci.add3dFace(this.fourCornerData());
        break;
      case DL_ENTITY_SOLID:
        ci.addSolid(this.fourCornerData());
        break;
      case DL_ENTITY_SEQEND:
        ci.endSequence();
        break;
      default:
        break;
    }

    ci.endSection();

    this.values.clear();
    this.settingKey = '';
  }

  /**
   * A header variable. Its *type* is inferred from the group code the value
   * arrived under: 0-9 string, 10-39 vector (only the 10 triple), 40-59 double,
   * 60-99 int, anything else string.
   */
  private addSetting(ci: DL_CREATION_ADAPTER): void {
    const c = this.lowestCode();

    if (c >= 0 && c <= 9) {
      ci.setVariableString(this.settingKey, this.getStringValue(c, ''), c);
    } else if (c >= 10 && c <= 39) {
      if (c === 10) {
        ci.setVariableVector(
          this.settingKey,
          this.getRealValue(c, 0.0),
          this.getRealValue(c + 10, 0.0),
          this.getRealValue(c + 20, 0.0),
          c,
        );
      }
    } else if (c >= 40 && c <= 59) {
      ci.setVariableDouble(this.settingKey, this.getRealValue(c, 0.0), c);
    } else if (c >= 60 && c <= 99) {
      ci.setVariableInt(this.settingKey, this.getIntValue(c, 0), c);
    } else if (c >= 0) {
      ci.setVariableString(this.settingKey, this.getStringValue(c, ''), c);
    }
  }

  /**
   * A LAYER table entry. The attributes are repaired first — a layer may not be
   * BYLAYER-anything, since it *is* the layer — and the repaired copy is pushed
   * back onto the creation interface, which is where `addLayer` reads its
   * lineweight from.
   */
  private addLayer(ci: DL_CREATION_ADAPTER): void {
    const attrib = ci.getAttributes();

    if (attrib.getColor() === 256 || attrib.getColor() === 0) attrib.setColor(7);

    if (attrib.getWidth() < 0) attrib.setWidth(1);

    const linetype = attrib.getLinetype().toUpperCase();

    if (linetype === 'BYLAYER' || linetype === 'BYBLOCK') attrib.setLinetype('CONTINUOUS');

    const name = this.getStringValue(2, '');

    if (name.length === 0) return;

    ci.addLayer({ name, flags: this.getIntValue(70, 0) });
  }

  private addLinetype(ci: DL_CREATION_ADAPTER): void {
    const name = this.getStringValue(2, '');

    if (name.length === 0) return;

    const d: DL_LinetypeData = {
      name,
      description: this.getStringValue(3, ''),
      flags: this.getIntValue(70, 0),
      numberOfDashes: this.getIntValue(73, 0),
      patternLength: this.getRealValue(40, 0.0),
    };

    if (name !== 'By Layer' && name !== 'By Block' && name !== 'BYLAYER' && name !== 'BYBLOCK')
      ci.addLinetype(d);
  }

  private handleLinetypeData(ci: DL_CREATION_ADAPTER): boolean {
    if (this.groupCode === 49) {
      ci.addLinetypeDash(toReal(this.groupValue));
      return true;
    }

    return false;
  }

  private addBlock(ci: DL_CREATION_ADAPTER): void {
    const name = this.getStringValue(2, '');

    if (name.length === 0) return;

    ci.addBlock({
      name,
      flags: this.getIntValue(70, 0),
      bpx: this.getRealValue(10, 0.0),
      bpy: this.getRealValue(20, 0.0),
      bpz: this.getRealValue(30, 0.0),
    });
  }

  private addTextStyle(ci: DL_CREATION_ADAPTER): void {
    const name = this.getStringValue(2, '');

    if (name.length === 0) return;

    ci.addTextStyle({
      name,
      flags: this.getIntValue(70, 0),
      fixedTextHeight: this.getRealValue(40, 0.0),
      widthFactor: this.getRealValue(41, 0.0),
      obliqueAngle: this.getRealValue(50, 0.0),
      textGenerationFlags: this.getIntValue(71, 0),
      lastHeightUsed: this.getRealValue(42, 0.0),
      primaryFontFile: this.getStringValue(3, ''),
      bigFontFile: this.getStringValue(4, ''),
      bold: false,
      italic: false,
    });
  }

  private addPoint(ci: DL_CREATION_ADAPTER): void {
    ci.addPoint({
      x: this.getRealValue(10, 0.0),
      y: this.getRealValue(20, 0.0),
      z: this.getRealValue(30, 0.0),
      thickness: this.getRealValue(39, 0.0),
    });
  }

  private addLine(ci: DL_CREATION_ADAPTER): void {
    ci.addLine({
      x1: this.getRealValue(10, 0.0),
      y1: this.getRealValue(20, 0.0),
      z1: this.getRealValue(30, 0.0),
      x2: this.getRealValue(11, 0.0),
      y2: this.getRealValue(21, 0.0),
      z2: this.getRealValue(31, 0.0),
    });
  }

  private twoPointData(): DL_XLineData {
    return {
      bx: this.getRealValue(10, 0.0),
      by: this.getRealValue(20, 0.0),
      bz: this.getRealValue(30, 0.0),
      dx: this.getRealValue(11, 0.0),
      dy: this.getRealValue(21, 0.0),
      dz: this.getRealValue(31, 0.0),
    };
  }

  private fourCornerData(): DL_TraceData {
    const x: [number, number, number, number] = [0, 0, 0, 0];
    const y: [number, number, number, number] = [0, 0, 0, 0];
    const z: [number, number, number, number] = [0, 0, 0, 0];

    for (let k = 0; k < 4; k++) {
      x[k] = this.getRealValue(10 + k, 0.0);
      y[k] = this.getRealValue(20 + k, 0.0);
      z[k] = this.getRealValue(30 + k, 0.0);
    }

    return { thickness: 0.0, x, y, z };
  }

  /**
   * POLYLINE and LWPOLYLINE both land here. The old-style POLYLINE's vertices
   * arrive later as separate VERTEX entities; an LWPOLYLINE carries its
   * vertices inline, so the reader replays the buffered ones itself and closes
   * the entity on the spot.
   */
  private addPolyline(ci: DL_CREATION_ADAPTER): void {
    ci.addPolyline({
      number: this.maxVertices,
      m: this.getIntValue(71, 0),
      n: this.getIntValue(72, 0),
      flags: this.getIntValue(70, 0),
      elevation: this.getRealValue(38, 0),
    });

    this.maxVertices = Math.min(this.maxVertices, this.vertexIndex + 1);

    if (this.currentObjectType === DL_ENTITY_LWPOLYLINE) {
      for (let i = 0; i < this.maxVertices; i++) {
        ci.addVertex({
          x: this.vertices[i * 4] ?? 0,
          y: this.vertices[i * 4 + 1] ?? 0,
          z: this.vertices[i * 4 + 2] ?? 0,
          bulge: this.vertices[i * 4 + 3] ?? 0,
          startWidth: 0.0,
          endWidth: 0.0,
        });
      }

      ci.endEntity();
    }
  }

  private addVertex(ci: DL_CREATION_ADAPTER): void {
    // A vertex with bit 128 set but not bit 64 defines a mesh face, not a
    // point; its 10/20/30 are meaningless.
    if (this.getIntValue(70, 0) & 128 && !(this.getIntValue(70, 0) & 64)) return;

    ci.addVertex({
      x: this.getRealValue(10, 0.0),
      y: this.getRealValue(20, 0.0),
      z: this.getRealValue(30, 0.0),
      bulge: this.getRealValue(42, 0.0),
      startWidth: this.getRealValue(40, 0.0),
      endWidth: this.getRealValue(41, 0.0),
    });
  }

  private addSpline(ci: DL_CREATION_ADAPTER): void {
    ci.addSpline({
      degree: this.getIntValue(71, 3),
      nKnots: this.maxKnots,
      nControl: this.maxControlPoints,
      nFit: this.maxFitPoints,
      flags: this.getIntValue(70, 4),
      tangentStartX: this.getRealValue(12, 0.0),
      tangentStartY: this.getRealValue(22, 0.0),
      tangentStartZ: this.getRealValue(32, 0.0),
      tangentEndX: this.getRealValue(13, 0.0),
      tangentEndY: this.getRealValue(23, 0.0),
      tangentEndZ: this.getRealValue(33, 0.0),
    });

    for (let i = 0; i < this.maxControlPoints; i++) {
      ci.addControlPoint({
        x: this.controlPoints[i * 3] ?? 0,
        y: this.controlPoints[i * 3 + 1] ?? 0,
        z: this.controlPoints[i * 3 + 2] ?? 0,
        w: this.weights[i] ?? 1.0,
      });
    }

    for (let i = 0; i < this.maxFitPoints; i++) {
      ci.addFitPoint({
        x: this.fitPoints[i * 3] ?? 0,
        y: this.fitPoints[i * 3 + 1] ?? 0,
        z: this.fitPoints[i * 3 + 2] ?? 0,
      });
    }

    for (let i = 0; i < this.maxKnots; i++) ci.addKnot({ k: this.knots[i] ?? 0 });

    ci.endEntity();
  }

  private addArc(ci: DL_CREATION_ADAPTER): void {
    ci.addArc({
      cx: this.getRealValue(10, 0.0),
      cy: this.getRealValue(20, 0.0),
      cz: this.getRealValue(30, 0.0),
      radius: this.getRealValue(40, 0.0),
      angle1: this.getRealValue(50, 0.0),
      angle2: this.getRealValue(51, 0.0),
    });
  }

  private addCircle(ci: DL_CREATION_ADAPTER): void {
    ci.addCircle({
      cx: this.getRealValue(10, 0.0),
      cy: this.getRealValue(20, 0.0),
      cz: this.getRealValue(30, 0.0),
      radius: this.getRealValue(40, 0.0),
    });
  }

  private addEllipse(ci: DL_CREATION_ADAPTER): void {
    ci.addEllipse({
      cx: this.getRealValue(10, 0.0),
      cy: this.getRealValue(20, 0.0),
      cz: this.getRealValue(30, 0.0),
      mx: this.getRealValue(11, 0.0),
      my: this.getRealValue(21, 0.0),
      mz: this.getRealValue(31, 0.0),
      ratio: this.getRealValue(40, 1.0),
      angle1: this.getRealValue(41, 0.0),
      angle2: this.getRealValue(42, 2 * Math.PI),
    });
  }

  private addInsert(ci: DL_CREATION_ADAPTER): void {
    const name = this.getStringValue(2, '');

    if (name.length === 0) return;

    ci.addInsert({
      name,
      ipx: this.getRealValue(10, 0.0),
      ipy: this.getRealValue(20, 0.0),
      ipz: this.getRealValue(30, 0.0),
      sx: this.getRealValue(41, 1.0),
      sy: this.getRealValue(42, 1.0),
      sz: this.getRealValue(43, 1.0),
      angle: this.getRealValue(50, 0.0),
      cols: this.getIntValue(70, 1),
      rows: this.getIntValue(71, 1),
      colSp: this.getRealValue(44, 0.0),
      rowSp: this.getRealValue(45, 0.0),
    });
  }

  /**
   * The alignment point defaults to NaN, not to zero: TEXT distinguishes "no
   * second point" from "a second point at the origin", and `addText` in the
   * plugin tests for it.
   */
  private textData(): DL_TextData {
    return {
      ipx: this.getRealValue(10, 0.0),
      ipy: this.getRealValue(20, 0.0),
      ipz: this.getRealValue(30, 0.0),
      apx: this.getRealValue(11, DL_NANDOUBLE),
      apy: this.getRealValue(21, DL_NANDOUBLE),
      apz: this.getRealValue(31, DL_NANDOUBLE),
      height: this.getRealValue(40, 2.5),
      xScaleFactor: this.getRealValue(41, 1.0),
      textGenerationFlags: this.getIntValue(71, 0),
      hJustification: this.getIntValue(72, 0),
      vJustification: this.getIntValue(73, 0),
      text: this.getStringValue(1, ''),
      style: this.getStringValue(7, ''),
      angle: (this.getRealValue(50, 0.0) * 2 * Math.PI) / 360.0,
    };
  }

  /**
   * MTEXT's rotation may be given directly (group 50, in degrees) or implied by
   * an X-direction vector (11/21). dxflib ≤ 2.0.2.0 wrote group 50 in radians,
   * so a file that says so in its `999 dxflib` comment is read that way.
   */
  private addMText(ci: DL_CREATION_ADAPTER): void {
    let angle = 0.0;

    if (this.hasValue(50)) {
      if (this.libVersion <= 0x02000200) angle = this.getRealValue(50, 0.0);
      else angle = (this.getRealValue(50, 0.0) * 2 * Math.PI) / 360.0;
    } else if (this.hasValue(11) && this.hasValue(21)) {
      const x = this.getRealValue(11, 0.0);
      const y = this.getRealValue(21, 0.0);

      if (Math.abs(x) < 1.0e-6) angle = y > 0.0 ? Math.PI / 2.0 : (Math.PI / 2.0) * 3.0;
      else angle = Math.atan(y / x);
    }

    ci.addMText({
      ipx: this.getRealValue(10, 0.0),
      ipy: this.getRealValue(20, 0.0),
      ipz: this.getRealValue(30, 0.0),
      dirx: this.getRealValue(11, 0.0),
      diry: this.getRealValue(21, 0.0),
      dirz: this.getRealValue(31, 0.0),
      height: this.getRealValue(40, 2.5),
      width: this.getRealValue(41, 0.0),
      attachmentPoint: this.getIntValue(71, 1),
      drawingDirection: this.getIntValue(72, 1),
      lineSpacingStyle: this.getIntValue(73, 1),
      lineSpacingFactor: this.getRealValue(44, 1.0),
      text: this.getStringValue(1, ''),
      style: this.getStringValue(7, ''),
      angle,
    });
  }

  private dimData(): DL_DimensionData {
    return {
      dpx: this.getRealValue(10, 0.0),
      dpy: this.getRealValue(20, 0.0),
      dpz: this.getRealValue(30, 0.0),
      mpx: this.getRealValue(11, 0.0),
      mpy: this.getRealValue(21, 0.0),
      mpz: this.getRealValue(31, 0.0),
      type: this.getIntValue(70, 0),
      attachmentPoint: this.getIntValue(71, 5),
      lineSpacingStyle: this.getIntValue(72, 1),
      lineSpacingFactor: this.getRealValue(41, 1.0),
      text: this.getStringValue(1, ''),
      style: this.getStringValue(3, ''),
      angle: this.getRealValue(53, 0.0),
      arrow1Flipped: this.getIntValue(74, 0) === 1,
      arrow2Flipped: this.getIntValue(75, 0) === 1,
    };
  }

  /** The bottom three bits of group 70 pick which kind of dimension this is. */
  private addDimension(ci: DL_CREATION_ADAPTER): void {
    const type = this.getIntValue(70, 0) & 0x07;

    const p1 = {
      dpx1: this.getRealValue(13, 0.0),
      dpy1: this.getRealValue(23, 0.0),
      dpz1: this.getRealValue(33, 0.0),
    };
    const p2 = {
      dpx2: this.getRealValue(14, 0.0),
      dpy2: this.getRealValue(24, 0.0),
      dpz2: this.getRealValue(34, 0.0),
    };
    const p3 = {
      dpx3: this.getRealValue(15, 0.0),
      dpy3: this.getRealValue(25, 0.0),
      dpz3: this.getRealValue(35, 0.0),
    };

    switch (type) {
      case 0:
        ci.addDimLinear(this.dimData(), {
          ...p1,
          ...p2,
          angle: this.getRealValue(50, 0.0),
          oblique: this.getRealValue(52, 0.0),
        });
        break;
      case 1:
        ci.addDimAlign(this.dimData(), {
          epx1: p1.dpx1,
          epy1: p1.dpy1,
          epz1: p1.dpz1,
          epx2: p2.dpx2,
          epy2: p2.dpy2,
          epz2: p2.dpz2,
        });
        break;
      case 2:
        ci.addDimAngular(this.dimData(), {
          ...p1,
          ...p2,
          ...p3,
          dpx4: this.getRealValue(16, 0.0),
          dpy4: this.getRealValue(26, 0.0),
          dpz4: this.getRealValue(36, 0.0),
        });
        break;
      case 3:
        ci.addDimDiametric(this.dimData(), {
          dpx: p3.dpx3,
          dpy: p3.dpy3,
          dpz: p3.dpz3,
          leader: this.getRealValue(40, 0.0),
        });
        break;
      case 4:
        ci.addDimRadial(this.dimData(), {
          dpx: p3.dpx3,
          dpy: p3.dpy3,
          dpz: p3.dpz3,
          leader: this.getRealValue(40, 0.0),
        });
        break;
      case 5:
        ci.addDimAngular3P(this.dimData(), { ...p1, ...p2, ...p3 });
        break;
      case 6:
        ci.addDimOrdinate(this.dimData(), {
          ...p1,
          ...p2,
          xtype: (this.getIntValue(70, 0) & 64) === 64,
        });
        break;
      default:
        break;
    }
  }

  private addLeader(ci: DL_CREATION_ADAPTER): void {
    ci.addLeader({
      arrowHeadFlag: this.getIntValue(71, 1),
      leaderPathType: this.getIntValue(72, 0),
      leaderCreationFlag: this.getIntValue(73, 3),
      hooklineDirectionFlag: this.getIntValue(74, 1),
      hasHookline: this.getIntValue(75, 0),
      textAnnotationHeight: this.getRealValue(40, 1.0),
      textAnnotationWidth: this.getRealValue(41, 1.0),
      number: this.getIntValue(76, 0),
    });

    for (let i = 0; i < this.maxLeaderVertices; i++) {
      ci.addLeaderVertex({
        x: this.leaderVertices[i * 3] ?? 0,
        y: this.leaderVertices[i * 3 + 1] ?? 0,
        z: this.leaderVertices[i * 3 + 2] ?? 0,
      });
    }

    ci.endEntity();
  }

  private addImage(ci: DL_CREATION_ADAPTER): void {
    ci.addImage({
      ref: this.getStringValue(340, ''),
      ipx: this.getRealValue(10, 0.0),
      ipy: this.getRealValue(20, 0.0),
      ipz: this.getRealValue(30, 0.0),
      ux: this.getRealValue(11, 0.0),
      uy: this.getRealValue(21, 0.0),
      uz: this.getRealValue(31, 0.0),
      vx: this.getRealValue(12, 0.0),
      vy: this.getRealValue(22, 0.0),
      vz: this.getRealValue(32, 0.0),
      width: this.getIntValue(13, 1),
      height: this.getIntValue(23, 1),
      brightness: this.getIntValue(281, 50),
      contrast: this.getIntValue(282, 50),
      fade: this.getIntValue(283, 0),
    });
  }

  private handleMTextData(ci: DL_CREATION_ADAPTER): boolean {
    // Text longer than 250 characters is split across repeated group 3s, with
    // the tail in group 1 — so 3 must append rather than overwrite.
    if (this.groupCode === 3) {
      ci.addMTextChunk(this.groupValue);
      return true;
    }

    return false;
  }

  private handleLWPolylineData(): boolean {
    if (this.groupCode === 90) {
      this.maxVertices = toInt(this.groupValue);

      if (this.maxVertices > 0) this.vertices = new Array(4 * this.maxVertices).fill(0.0);

      this.vertexIndex = -1;
      return true;
    }

    if (
      this.groupCode === 10 ||
      this.groupCode === 20 ||
      this.groupCode === 30 ||
      this.groupCode === 42
    ) {
      // Only the X code opens a new vertex, and only while there is room: a file
      // claiming fewer vertices in group 90 than it then writes silently keeps
      // overwriting the last slot.
      if (this.vertexIndex < this.maxVertices - 1 && this.groupCode === 10) this.vertexIndex++;

      if (this.groupCode <= 30) {
        if (this.vertexIndex >= 0 && this.vertexIndex < this.maxVertices)
          this.vertices[4 * this.vertexIndex + (Math.trunc(this.groupCode / 10) - 1)] = toReal(
            this.groupValue,
          );
      } else if (
        this.groupCode === 42 &&
        this.vertexIndex < this.maxVertices &&
        this.vertexIndex >= 0
      ) {
        this.vertices[4 * this.vertexIndex + 3] = toReal(this.groupValue);
      }

      return true;
    }

    return false;
  }

  private handleSplineData(): boolean {
    if (this.groupCode === 72) {
      this.maxKnots = toInt(this.groupValue);

      if (this.maxKnots > 0) this.knots = new Array(this.maxKnots).fill(0.0);

      this.knotIndex = -1;
      return true;
    }

    if (this.groupCode === 73) {
      this.maxControlPoints = toInt(this.groupValue);

      if (this.maxControlPoints > 0) {
        this.controlPoints = new Array(3 * this.maxControlPoints).fill(0.0);
        this.weights = new Array(this.maxControlPoints).fill(1.0);
      }

      this.controlPointIndex = -1;
      this.weightIndex = -1;
      return true;
    }

    if (this.groupCode === 74) {
      this.maxFitPoints = toInt(this.groupValue);

      if (this.maxFitPoints > 0) this.fitPoints = new Array(3 * this.maxFitPoints).fill(0.0);

      this.fitPointIndex = -1;
      return true;
    }

    if (this.groupCode === 40) {
      if (this.knotIndex < this.maxKnots - 1) {
        this.knotIndex++;
        this.knots[this.knotIndex] = toReal(this.groupValue);
      }

      return true;
    }

    if (this.groupCode === 10 || this.groupCode === 20 || this.groupCode === 30) {
      if (this.controlPointIndex < this.maxControlPoints - 1 && this.groupCode === 10)
        this.controlPointIndex++;

      if (this.controlPointIndex >= 0 && this.controlPointIndex < this.maxControlPoints)
        this.controlPoints[3 * this.controlPointIndex + (Math.trunc(this.groupCode / 10) - 1)] =
          toReal(this.groupValue);

      return true;
    }

    if (this.groupCode === 11 || this.groupCode === 21 || this.groupCode === 31) {
      if (this.fitPointIndex < this.maxFitPoints - 1 && this.groupCode === 11) this.fitPointIndex++;

      if (this.fitPointIndex >= 0 && this.fitPointIndex < this.maxFitPoints)
        this.fitPoints[3 * this.fitPointIndex + (Math.trunc((this.groupCode - 1) / 10) - 1)] =
          toReal(this.groupValue);

      return true;
    }

    if (this.groupCode === 41) {
      if (this.weightIndex < this.maxControlPoints - 1) this.weightIndex++;

      if (this.weightIndex >= 0 && this.weightIndex < this.maxControlPoints)
        this.weights[this.weightIndex] = toReal(this.groupValue);

      return true;
    }

    return false;
  }

  private handleLeaderData(): boolean {
    if (this.groupCode === 76) {
      this.maxLeaderVertices = toInt(this.groupValue);

      if (this.maxLeaderVertices > 0)
        this.leaderVertices = new Array(3 * this.maxLeaderVertices).fill(0.0);

      this.leaderVertexIndex = -1;
      return true;
    }

    if (this.groupCode === 10 || this.groupCode === 20 || this.groupCode === 30) {
      if (this.leaderVertexIndex < this.maxLeaderVertices - 1 && this.groupCode === 10)
        this.leaderVertexIndex++;

      if (this.leaderVertexIndex >= 0 && this.leaderVertexIndex < this.maxLeaderVertices)
        this.leaderVertices[3 * this.leaderVertexIndex + (Math.trunc(this.groupCode / 10) - 1)] =
          toReal(this.groupValue);

      return true;
    }

    return false;
  }

  private handleXData(ci: DL_CREATION_ADAPTER): boolean {
    if (this.groupCode === 1001) {
      ci.addXDataApp(this.groupValue);
      return true;
    }

    if (this.groupCode >= 1000 && this.groupCode <= 1009) {
      ci.addXDataString(this.groupCode, this.groupValue);
      return true;
    }

    if (this.groupCode >= 1010 && this.groupCode <= 1059) {
      ci.addXDataReal(this.groupCode, toReal(this.groupValue));
      return true;
    }

    if (this.groupCode >= 1060 && this.groupCode <= 1071) {
      ci.addXDataInt(this.groupCode, toInt(this.groupValue));
      return true;
    }

    return false;
  }
}

/** The name a code-0 value maps to. A `$`-prefixed value is a header variable. */
function nextObjectType(aGroupValue: string): number {
  if (aGroupValue[0] === '$') return DL_SETTING;

  switch (aGroupValue) {
    case 'LAYER':
      return DL_LAYER;
    case 'LTYPE':
      return DL_LINETYPE;
    case 'BLOCK':
      return DL_BLOCK;
    case 'ENDBLK':
      return DL_ENDBLK;
    case 'STYLE':
      return DL_STYLE;
    case 'POINT':
      return DL_ENTITY_POINT;
    case 'LINE':
      return DL_ENTITY_LINE;
    case 'XLINE':
      return DL_ENTITY_XLINE;
    case 'RAY':
      return DL_ENTITY_RAY;
    case 'POLYLINE':
      return DL_ENTITY_POLYLINE;
    case 'LWPOLYLINE':
      return DL_ENTITY_LWPOLYLINE;
    case 'VERTEX':
      return DL_ENTITY_VERTEX;
    case 'SPLINE':
      return DL_ENTITY_SPLINE;
    case 'ARC':
      return DL_ENTITY_ARC;
    case 'ELLIPSE':
      return DL_ENTITY_ELLIPSE;
    case 'CIRCLE':
      return DL_ENTITY_CIRCLE;
    case 'INSERT':
      return DL_ENTITY_INSERT;
    case 'TEXT':
      return DL_ENTITY_TEXT;
    case 'MTEXT':
      return DL_ENTITY_MTEXT;
    case 'ARCALIGNEDTEXT':
      return DL_ENTITY_ARCALIGNEDTEXT;
    case 'ATTRIB':
      return DL_ENTITY_ATTRIB;
    case 'DIMENSION':
      return DL_ENTITY_DIMENSION;
    case 'LEADER':
      return DL_ENTITY_LEADER;
    case 'HATCH':
      return DL_ENTITY_HATCH;
    case 'IMAGE':
      return DL_ENTITY_IMAGE;
    case 'IMAGEDEF':
      return DL_ENTITY_IMAGEDEF;
    case 'TRACE':
      return DL_ENTITY_TRACE;
    case 'SOLID':
      return DL_ENTITY_SOLID;
    case '3DFACE':
      return DL_ENTITY_3DFACE;
    case 'SEQEND':
      return DL_ENTITY_SEQEND;
    case 'XRECORD':
      return DL_XRECORD;
    case 'DICTIONARY':
      return DL_DICTIONARY;
    default:
      return DL_UNKNOWN;
  }
}

/**
 * `DL_Dxf::stripWhiteSpace`. CR and LF always go; spaces and tabs go only when
 * `aStripSpace` is set, which is true for the group-code line and false for the
 * value line — a DXF string value may start or end with a space on purpose.
 */
export function stripWhiteSpace(aLine: string, aStripSpace: boolean): string {
  let last = aLine.length - 1;

  while (
    last >= 0 &&
    (aLine.charCodeAt(last) === 10 ||
      aLine.charCodeAt(last) === 13 ||
      (aStripSpace && (aLine[last] === ' ' || aLine[last] === '\t')))
  ) {
    last--;
  }

  let start = 0;

  if (aStripSpace) {
    while (start <= last && (aLine[start] === ' ' || aLine[start] === '\t')) start++;
  }

  return aLine.substring(start, last + 1);
}

/** `strtol( s, &p, 10 )`: a leading numeric prefix, or 0 when there is none. */
export function toInt(aStr: string): number {
  const m = /^[ \t\n\r]*[+-]?[0-9]+/.exec(aStr);

  return m === null ? 0 : Number.parseInt(m[0], 10);
}

/** `strtol( s, &p, 16 )`. Group 5, the entity handle, is hexadecimal. */
export function toInt16(aStr: string): number {
  const m = /^[ \t\n\r]*[+-]?(0[xX])?[0-9a-fA-F]+/.exec(aStr);

  return m === null ? 0 : Number.parseInt(m[0], 16);
}

/**
 * `DL_Dxf::toReal`: rewrite ',' to '.' — some writers emit comma decimals —
 * then extract a leading double as `istream >>` would. A value that is not a
 * number at all reads back as 0.
 */
export function toReal(aStr: string): number {
  const s = aStr.replace(/,/g, '.');
  const m = /^[ \t\n\r]*[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?/.exec(s);

  if (m === null) return 0;

  const v = Number.parseFloat(m[0]);

  return Number.isNaN(v) ? 0 : v;
}

/**
 * `DL_Dxf::getLibVersion`: "a.b.c.d" packed one byte per component, so that
 * `libVersion <= 0x02000200` picks out the dxflib releases that wrote MTEXT
 * angles in radians. Fewer than two dots is not a version and reads as 0.
 *
 * Deliberate divergence: upstream reads an uninitialised `d[2]` when the string
 * has exactly two dots ("3.26.4"), so the third component is whatever was on
 * the stack. That is undefined behaviour, not a rule to mirror; here the third
 * component is the rest of the string and the fourth is 0, which is what the
 * three-dot branch would give for "3.26.4.0".
 */
function getLibVersion(aStr: string): number {
  const dots: number[] = [];

  for (let i = 0; i < aStr.length && dots.length < 3; ++i) {
    if (aStr[i] === '.') dots.push(i);
  }

  if (dots.length < 2) return 0;

  const d0 = dots[0]!;
  const d1 = dots[1]!;
  const d2 = dots[2];

  const v0 = aStr.substring(0, d0);
  const v1 = aStr.substring(d0 + 1, d1);
  const v2 = d2 === undefined ? aStr.substring(d1 + 1) : aStr.substring(d1 + 1, d2);
  const v3 = d2 === undefined ? '0' : aStr.substring(d2 + 1);

  return (toInt(v0) << 24) + (toInt(v1) << 16) + (toInt(v2) << 8) + toInt(v3);
}
