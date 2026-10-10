// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `utils/idftools/vrml_layer.{h,cpp}`: VRML_LAYER, a set of 2D contours tessellated by GLU into
 * the triangles and walls pcbnew's VRML exporter writes.
 *
 * The contour, circle, slot, tessellation and triangle-list half, which EXPORTER_PCB_VRML calls.
 * Not yet ported: AddArc / AppendArc / AddPolygon (idf2vrml's) and the Write* text writers the
 * exporter uses only with --models-dir.
 */
import {
  GL_LINE_LOOP,
  GL_TRIANGLE_FAN,
  GL_TRIANGLE_STRIP,
  GL_TRIANGLES,
  GLU_TESS_BEGIN_DATA,
  GLU_TESS_BOUNDARY_ONLY,
  GLU_TESS_COMBINE_DATA,
  GLU_TESS_END_DATA,
  GLU_TESS_ERROR_DATA,
  GLU_TESS_VERTEX_DATA,
  GLU_TESS_WINDING_NEGATIVE,
  GLU_TESS_WINDING_POSITIVE,
  GLU_TESS_WINDING_RULE,
  type GLUtesselator,
  gluNewTess,
} from '@ziroeda/common/kicad_gl/kiglu.js';

const M_PI2 = Math.PI / 2.0;

// minimum sides to a circle
const MIN_NSIDES = 6;

export interface VERTEX_3D {
  x: number;
  y: number;
  i: number; // vertex index
  o: number; // vertex order
  pth: boolean; // true for plate-through hole
}

export interface TRIPLET_3D {
  i1: number;
  i2: number;
  i3: number;
}

/** `gluErrorString` for the tessellator's errors. */
const GLU_ERRORS: Record<number, string> = {
  100151: 'gluTessBeginPolygon() must precede a gluTessEndPolygon()',
  100152: 'gluTessBeginContour() must precede a gluTessEndContour()',
  100153: 'gluTessEndPolygon() must follow a gluTessBeginPolygon()',
  100154: 'gluTessEndContour() must follow a gluTessBeginContour()',
  100155: 'a coordinate is too large',
  100156: 'need combine callback',
};

export class VRML_LAYER {
  private maxArcSeg = 48; // maximum number of arc segments in a small circle
  private minSegLength = 0.1; // min segment length
  private maxSegLength = 0.5; // max segment length
  private offsetX = 0.0; // offset to apply to final X coordinates
  private offsetY = 0.0; // offset to apply to final Y coordinates

  private fix = false; // when true, no more vertices may be added by the user
  private idx = 0; // vertex index (number of contained vertices)
  private ord = 0; // vertex order (number of ordered vertices)
  private vertices: VERTEX_3D[] = []; // vertices of all contours
  private contours: number[][] = []; // lists of vertices for each contour
  private pth: boolean[] = []; // indicates whether a 'contour' is a PTH or not
  private solid: boolean[] = []; // indicates whether a 'contour' is a solid or a hole
  private areas: number[] = []; // area of the contours (positive if winding is CCW)
  private triplets: TRIPLET_3D[] = []; // output facet triplet list (triangle)
  private outline: number[][] = []; // indices for outline outputs (index by order)
  private ordmap: number[] = []; // mapping of order to index

  private extra_verts: VERTEX_3D[] = []; // extra vertices added for outlines and facets
  private vlist: VERTEX_3D[] = []; // vertex list for the GL command in progress
  private pholes: VRML_LAYER | null = null; // pointer to another layer object used for holes
  private tess: GLUtesselator | null; // local instance of the GLU tesselator

  private glcmd = 0; // currently active GL command
  private hidx = 0; // number of vertices in the holes
  private eidx = 0; // index for extra vertices

  private error = ''; // error message

  // set to true when a fault is encountered during tessellation
  Fault = false;

  constructor() {
    this.ResetArcParams();
    this.tess = gluNewTess();

    // set up the tesselator callbacks
    this.tess.gluTessCallback(GLU_TESS_BEGIN_DATA, (cmd: number, lp: VRML_LAYER) =>
      lp.glStart(cmd),
    );
    this.tess.gluTessCallback(GLU_TESS_VERTEX_DATA, (v: VERTEX_3D, lp: VRML_LAYER) =>
      lp.glPushVertex(v),
    );
    this.tess.gluTessCallback(GLU_TESS_END_DATA, (lp: VRML_LAYER) => lp.glEnd());
    this.tess.gluTessCallback(GLU_TESS_ERROR_DATA, (errorID: number, lp: VRML_LAYER) => {
      lp.Fault = true;
      lp.SetGLError(errorID);
    });
    this.tess.gluTessCallback(
      GLU_TESS_COMBINE_DATA,
      (
        coords: number[],
        vertex_data: (VERTEX_3D | null)[],
        _weight: number[],
        lp: VRML_LAYER,
      ): VERTEX_3D => {
        // the plating is set to true only if all are plated
        let plated = vertex_data[0]!.pth;

        if (!vertex_data[1]!.pth) plated = false;

        if (vertex_data[2] && !vertex_data[2].pth) plated = false;

        if (vertex_data[3] && !vertex_data[3].pth) plated = false;

        return lp.AddExtraVertex(coords[0]!, coords[1]!, plated);
      },
    );

    this.tess.gluTessProperty(GLU_TESS_WINDING_RULE, GLU_TESS_WINDING_POSITIVE);
    this.tess.gluTessNormal(0, 0, 1);
  }

  /** `calcNSides`: the number of sides of an arc of radius aRadius over aAngle radians. */
  private calcNSides(aRadius: number, aAngle: number): number {
    // check #segments on ends of arc
    let maxSeg = Math.trunc((this.maxArcSeg * aAngle) / Math.PI);

    if (maxSeg < 3) maxSeg = 3;

    let csides = Math.trunc((aRadius * Math.PI) / this.minSegLength);

    if (csides < 0) csides = -csides;

    if (csides > maxSeg) {
      if (csides < 2 * maxSeg) csides = Math.trunc(csides / 2);
      else csides = Math.trunc((csides * this.minSegLength) / this.maxSegLength);
    }

    if (csides < 3) csides = 3;

    if ((csides & 1) === 0) csides += 1;

    return csides;
  }

  ResetArcParams(): void {
    // arc parameters suitable to mm measurements
    this.maxArcSeg = 48;
    this.minSegLength = 0.1;
    this.maxSegLength = 0.5;
  }

  GetArcParams(): { maxSeg: number; minLength: number; maxLength: number } {
    return { maxSeg: this.maxArcSeg, minLength: this.minSegLength, maxLength: this.maxSegLength };
  }

  SetArcParams(aMaxSeg: number, aMinLength: number, aMaxLength: number): boolean {
    let maxSeg = aMaxSeg;

    if (maxSeg < 8) maxSeg = 8;

    if (aMinLength <= 0 || aMaxLength <= aMinLength) return false;

    this.maxArcSeg = maxSeg;
    this.minSegLength = aMinLength;
    this.maxSegLength = aMaxLength;
    return true;
  }

  Clear(): void {
    this.fix = false;
    this.idx = 0;
    this.contours = [];
    this.pth = [];
    this.areas = [];
    this.vertices = [];
    this.clearTmp();
  }

  private clearTmp(): void {
    this.Fault = false;
    this.hidx = 0;
    this.eidx = 0;
    this.ord = 0;
    this.glcmd = 0;

    this.triplets = [];
    this.solid = [];
    this.outline = [];
    this.ordmap = [];
    this.extra_verts = [];

    // note: unlike outline and extra_verts,
    // vlist is not responsible for memory management
    this.vlist = [];

    // go through the vertex list and reset ephemeral parameters
    for (const v of this.vertices) v.o = -1;
  }

  NewContour(aPlatedHole = false): number {
    if (this.fix) return -1;

    this.contours.push([]);
    this.areas.push(0.0);
    this.pth.push(aPlatedHole);

    return this.contours.length - 1;
  }

  AddVertex(aContourID: number, aXpos: number, aYpos: number): boolean {
    if (this.fix) {
      this.error = 'AddVertex(): no more vertices may be added (Tesselate was previously executed)';
      return false;
    }

    if (aContourID < 0 || aContourID >= this.contours.length) {
      this.error = 'AddVertex(): aContour is not within a valid range';
      return false;
    }

    const vertex: VERTEX_3D = {
      x: aXpos,
      y: aYpos,
      i: this.idx++,
      o: -1,
      pth: this.pth[aContourID]!,
    };

    const contour = this.contours[aContourID]!;
    let v2: VERTEX_3D | null = null;

    if (contour.length > 0) v2 = this.vertices[contour[contour.length - 1]!]!;

    this.vertices.push(vertex);
    contour.push(vertex.i);

    if (v2) this.areas[aContourID]! += (aXpos - v2.x) * (aYpos + v2.y);

    return true;
  }

  EnsureWinding(aContourID: number, aHoleFlag: boolean): boolean {
    if (aContourID < 0 || aContourID >= this.contours.length) {
      this.error = 'EnsureWinding(): aContour is outside the valid range';
      return false;
    }

    const cp = this.contours[aContourID]!;

    if (cp.length < 3) {
      this.error = 'EnsureWinding(): there are fewer than 3 vertices';
      return false;
    }

    let dir = this.areas[aContourID]!;

    const vp0 = this.vertices[cp[cp.length - 1]!]!;
    const vp1 = this.vertices[cp[0]!]!;

    dir += (vp1.x - vp0.x) * (vp1.y + vp0.y);

    // if dir is positive, winding is CW
    if ((aHoleFlag && dir < 0) || (!aHoleFlag && dir > 0)) {
      cp.reverse();
      this.areas[aContourID] = -this.areas[aContourID]!;
    }

    return true;
  }

  AppendCircle(
    aXpos: number,
    aYpos: number,
    aRadius: number,
    aContourID: number,
    aHoleFlag: boolean,
  ): boolean {
    if (aContourID < 0 || aContourID >= this.contours.length) {
      this.error = 'AppendCircle(): invalid contour (out of range)';
      return false;
    }

    let nsides = Math.trunc((Math.PI * 2.0 * aRadius) / this.minSegLength);

    if (nsides > this.maxArcSeg) {
      if (nsides > 2 * this.maxArcSeg) {
        // use segments approx. maxAr
        nsides = Math.trunc((Math.PI * 2.0 * aRadius) / this.maxSegLength);
      } else {
        nsides = Math.trunc(nsides / 2);
      }
    }

    if (nsides < MIN_NSIDES) nsides = MIN_NSIDES;

    // even numbers give prettier results for circles
    if (nsides & 1) nsides += 1;

    const da = (Math.PI * 2.0) / nsides;

    let fail = false;

    if (aHoleFlag) {
      fail = !this.AddVertex(aContourID, aXpos + aRadius, aYpos) || fail;

      for (let angle = da; angle < Math.PI * 2; angle += da) {
        fail =
          !this.AddVertex(
            aContourID,
            aXpos + aRadius * Math.cos(angle),
            aYpos - aRadius * Math.sin(angle),
          ) || fail;
      }
    } else {
      fail = !this.AddVertex(aContourID, aXpos + aRadius, aYpos) || fail;

      for (let angle = da; angle < Math.PI * 2; angle += da) {
        fail =
          !this.AddVertex(
            aContourID,
            aXpos + aRadius * Math.cos(angle),
            aYpos + aRadius * Math.sin(angle),
          ) || fail;
      }
    }

    return !fail;
  }

  AddCircle(
    aXpos: number,
    aYpos: number,
    aRadius: number,
    aHoleFlag = false,
    aPlatedHole = false,
  ): boolean {
    let pad: number;

    if (aHoleFlag && aPlatedHole) pad = this.NewContour(true);
    else pad = this.NewContour(false);

    if (pad < 0) {
      this.error = 'AddCircle(): failed to add a contour';
      return false;
    }

    return this.AppendCircle(aXpos, aYpos, aRadius, pad, aHoleFlag);
  }

  AddSlot(
    aCenterX: number,
    aCenterY: number,
    aSlotLength: number,
    aSlotWidth: number,
    aAngle: number,
    aHoleFlag = false,
    aPlatedHole = false,
  ): boolean {
    let angle = (aAngle * Math.PI) / 180.0;
    let slotLength = aSlotLength;
    let slotWidth = aSlotWidth;

    if (slotWidth > slotLength) {
      angle += M_PI2;
      [slotLength, slotWidth] = [slotWidth, slotLength];
    }

    slotWidth /= 2.0;
    slotLength = slotLength / 2.0 - slotWidth;

    const csides = this.calcNSides(slotWidth, Math.PI);

    let capx = aCenterX + Math.cos(angle) * slotLength;
    let capy = aCenterY + Math.sin(angle) * slotLength;

    let ang: number;
    let i: number;
    let pad: number;

    if (aHoleFlag && aPlatedHole) pad = this.NewContour(true);
    else pad = this.NewContour(false);

    if (pad < 0) {
      this.error = 'AddCircle(): failed to add a contour';
      return false;
    }

    const da = Math.PI / csides;
    let fail = false;
    const add = (aX: number, aY: number): void => {
      fail = !this.AddVertex(pad, aX, aY) || fail;
    };

    if (aHoleFlag) {
      for (ang = angle + M_PI2, i = 0; i < csides; ang -= da, ++i)
        add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      ang = angle - M_PI2;
      add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      capx = aCenterX - Math.cos(angle) * slotLength;
      capy = aCenterY - Math.sin(angle) * slotLength;

      for (ang = angle - M_PI2, i = 0; i < csides; ang -= da, ++i)
        add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      ang = angle + M_PI2;
      add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));
    } else {
      for (ang = angle - M_PI2, i = 0; i < csides; ang += da, ++i)
        add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      ang = angle + M_PI2;
      add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      capx = aCenterX - Math.cos(angle) * slotLength;
      capy = aCenterY - Math.sin(angle) * slotLength;

      for (ang = angle + M_PI2, i = 0; i < csides; ang += da, ++i)
        add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));

      ang = angle - M_PI2;
      add(capx + slotWidth * Math.cos(ang), capy + slotWidth * Math.sin(ang));
    }

    return !fail;
  }

  /**
   * `Tesselate( holes, aHolesOnly )`: the solid outline, then (unless aHolesOnly) its holes and
   * the holes object's, as an outline and a list of triangles.
   */
  Tesselate(holes: VRML_LAYER | null, aHolesOnly = false): boolean {
    const tess = this.tess;

    if (!tess) {
      this.error = 'Tesselate(): GLU tesselator was not initialized';
      return false;
    }

    this.pholes = holes;
    this.Fault = false;

    if (aHolesOnly) tess.gluTessProperty(GLU_TESS_WINDING_RULE, GLU_TESS_WINDING_NEGATIVE);
    else tess.gluTessProperty(GLU_TESS_WINDING_RULE, GLU_TESS_WINDING_POSITIVE);

    if (this.contours.length < 1 || this.vertices.length < 3) {
      this.error = 'Tesselate(): not enough vertices';
      return false;
    }

    // finish the winding calculation on all vertices prior to setting 'fix'
    if (!this.fix) {
      for (let i = 0; i < this.contours.length; ++i) {
        const c = this.contours[i]!;

        if (c.length < 3) continue;

        const vp0 = this.vertices[c[c.length - 1]!]!;
        const vp1 = this.vertices[c[0]!]!;
        this.areas[i]! += (vp1.x - vp0.x) * (vp1.y + vp0.y);
      }
    }

    // prevent the addition of any further contours and contour vertices
    this.fix = true;

    // clear temporary internals which may have been used in a previous run
    this.clearTmp();

    // request an outline
    tess.gluTessProperty(GLU_TESS_BOUNDARY_ONLY, 1);

    // adjust internal indices for extra points and holes
    if (holes) this.hidx = holes.GetSize();
    else this.hidx = 0;

    this.eidx = this.idx + this.hidx;

    if (aHolesOnly && this.checkNContours(true) === 0) {
      this.error = 'tesselate(): no hole contours';
      return false;
    } else if (!aHolesOnly && this.checkNContours(false) === 0) {
      this.error = 'tesselate(): no solid contours';
      return false;
    }

    // open the polygon
    tess.gluTessBeginPolygon(this);

    if (aHolesOnly) {
      this.pholes = null; // do not accept foreign holes
      this.hidx = 0;
      this.eidx = this.idx;

      // add holes
      this.pushVertices(true);

      tess.gluTessEndPolygon();

      if (this.Fault) return false;

      return true;
    }

    // add solid outlines
    this.pushVertices(false);

    // close the polygon
    tess.gluTessEndPolygon();

    if (this.Fault) return false;

    // if there are no outlines we cannot proceed
    if (this.outline.length === 0) {
      this.error = 'tesselate(): no points in result';
      return false;
    }

    // at this point we have a solid outline; add it to the tesselator
    tess.gluTessBeginPolygon(this);

    if (!this.pushOutline(null)) return false;

    // add the holes contained by this object
    this.pushVertices(true);

    // import external holes (if any)
    if (this.hidx && holes!.Import(this.idx, tess) < 0) {
      this.error = `Tesselate():FAILED: ${holes!.GetError()}`;
      return false;
    }

    if (this.Fault) return false;

    // erase the previous outline data and vertex order
    // but preserve the extra vertices
    this.outline = [];
    this.ordmap = [];
    this.ord = 0;

    // go through the vertex lists and reset ephemeral parameters
    for (const v of this.vertices) v.o = -1;

    for (const v of this.extra_verts) v.o = -1;

    // close the polygon; this creates the outline points
    // and the point ordering list 'ordmap'
    this.solid = [];
    tess.gluTessEndPolygon();

    // repeat the last operation but request a tesselated surface
    // rather than an outline; this creates the triangles list.
    tess.gluTessProperty(GLU_TESS_BOUNDARY_ONLY, 0);

    tess.gluTessBeginPolygon(this);

    if (!this.pushOutline(holes)) return false;

    tess.gluTessEndPolygon();

    if (this.Fault) return false;

    return true;
  }

  private pushOutline(holes: VRML_LAYER | null): boolean {
    // traverse the outline list to push all used vertices
    if (this.outline.length < 1) {
      this.error = 'pushOutline() failed: no vertices to push';
      return false;
    }

    const tess = this.tess!;
    let nc = 0; // number of contours pushed

    for (const o of this.outline) {
      if (o.length < 3) continue;

      tess.gluTessBeginContour();

      for (const ord of o) {
        if (ord < 0 || ord > this.ordmap.length) {
          tess.gluTessEndContour();
          this.error = 'pushOutline():BUG: *outline.begin() is not a valid index to ordmap';
          return false;
        }

        // retrieve the actual index
        const pi = this.ordmap[ord]!;

        const vp = this.getVertexByIndex(pi, holes);

        if (!vp) {
          tess.gluTessEndContour();
          this.error = 'pushOutline():: BUG: ordmap[n] is not a valid index to vertices[]';
          return false;
        }

        tess.gluTessVertex([vp.x, vp.y, 0.0], vp);
      }

      tess.gluTessEndContour();
      ++nc;
    }

    if (!nc) {
      this.error = 'pushOutline():: no valid contours available';
      return false;
    }

    return true;
  }

  private addTriplet(p0: VERTEX_3D, p1: VERTEX_3D, p2: VERTEX_3D): boolean {
    let dx0 = p1.x - p0.x;
    let dx1 = p2.x - p0.x;
    let dx2 = p2.x - p1.x;

    let dy0 = p1.y - p0.y;
    let dy1 = p2.y - p0.y;
    let dy2 = p2.y - p1.y;

    dx0 *= dx0;
    dx1 *= dx1;
    dx2 *= dx2;

    dy0 *= dy0;
    dy1 *= dy1;
    dy2 *= dy2;

    // this number is chosen because we shall only write 9 decimal places
    // at most on the VRML output
    const err = 0.000000001;

    // test if the triangles are degenerate (equal points)
    if (dx0 + dy0 < err) return false;

    if (dx1 + dy1 < err) return false;

    if (dx2 + dy2 < err) return false;

    this.triplets.push({ i1: p0.o, i2: p1.o, i3: p2.o });
    return true;
  }

  AddExtraVertex(aXpos: number, aYpos: number, aPlatedHole: boolean): VERTEX_3D {
    if (this.eidx === 0) this.eidx = this.idx + this.hidx;

    const vertex: VERTEX_3D = { x: aXpos, y: aYpos, i: this.eidx++, o: -1, pth: aPlatedHole };

    this.extra_verts.push(vertex);

    return vertex;
  }

  glStart(cmd: number): void {
    this.glcmd = cmd;
    this.vlist = [];
  }

  glPushVertex(vertex: VERTEX_3D): void {
    if (vertex.o < 0) {
      vertex.o = this.ord++;
      this.ordmap.push(vertex.i);
    }

    this.vlist.push(vertex);
  }

  glEnd(): void {
    switch (this.glcmd) {
      case GL_LINE_LOOP: {
        // add the loop to the list of outlines
        const loop: number[] = [];

        let firstX = 0.0;
        let firstY = 0.0;
        let lastX = 0.0;
        let lastY = 0.0;
        let area = 0.0;

        if (this.vlist.length > 0) {
          loop.push(this.vlist[0]!.o);
          firstX = this.vlist[0]!.x;
          firstY = this.vlist[0]!.y;
          lastX = firstX;
          lastY = firstY;
        }

        for (let i = 1; i < this.vlist.length; ++i) {
          loop.push(this.vlist[i]!.o);
          const curX = this.vlist[i]!.x;
          const curY = this.vlist[i]!.y;
          area += (curX - lastX) * (curY + lastY);
          lastX = curX;
          lastY = curY;
        }

        area += (firstX - lastX) * (firstY + lastY);

        this.outline.push(loop);

        if (area <= 0.0) this.solid.push(true);
        else this.solid.push(false);

        break;
      }

      case GL_TRIANGLE_FAN:
        this.processFan();
        break;

      case GL_TRIANGLE_STRIP:
        this.processStrip();
        break;

      case GL_TRIANGLES:
        this.processTri();
        break;

      default:
        break;
    }

    this.vlist = [];
    this.glcmd = 0;
  }

  SetGLError(errorID: number): void {
    this.error = GLU_ERRORS[errorID] ?? '';

    if (this.error === '') this.error = `Unknown OpenGL error: ${errorID}`;
  }

  private processFan(): void {
    if (this.vlist.length < 3) return;

    const p0 = this.vlist[0]!;

    for (let i = 2; i < this.vlist.length; ++i)
      this.addTriplet(p0, this.vlist[i - 1]!, this.vlist[i]!);
  }

  private processStrip(): void {
    // GL_TRIANGLE_STRIP: Every group of 3 adjacent vertices forms a triangle.
    // The face direction of the strip is determined by the winding of the
    // first triangle. Each successive triangle will have its effective face
    // order reverse, so the system compensates for that by testing it in the
    // opposite way. A vertex stream of n length will generate n-2 triangles.
    if (this.vlist.length < 3) return;

    let flip = false;

    for (let i = 2; i < this.vlist.length; ++i) {
      if (flip) {
        this.addTriplet(this.vlist[i - 1]!, this.vlist[i - 2]!, this.vlist[i]!);
        flip = false;
      } else {
        this.addTriplet(this.vlist[i - 2]!, this.vlist[i - 1]!, this.vlist[i]!);
        flip = true;
      }
    }
  }

  private processTri(): void {
    // 1. each successive group of 3 vertices is a triangle
    // 2. as per OpenGL specification, any incomplete triangles are to be ignored
    if (this.vlist.length < 3) return;

    for (let i = 2; i < this.vlist.length; i += 3)
      this.addTriplet(this.vlist[i - 2]!, this.vlist[i - 1]!, this.vlist[i]!);
  }

  private checkNContours(holes: boolean): number {
    let nc = 0; // number of contours

    if (this.contours.length === 0) return 0;

    for (let i = 0; i < this.contours.length; ++i) {
      if (this.contours[i]!.length < 3) continue;

      if ((holes && this.areas[i]! <= 0.0) || (!holes && this.areas[i]! > 0.0)) continue;

      ++nc;
    }

    return nc;
  }

  private pushVertices(holes: boolean): void {
    // push the internally held vertices
    const tess = this.tess!;

    for (let i = 0; i < this.contours.length; ++i) {
      const c = this.contours[i]!;

      if (c.length < 3) continue;

      if ((holes && this.areas[i]! <= 0.0) || (!holes && this.areas[i]! > 0.0)) continue;

      tess.gluTessBeginContour();

      for (const vi of c) {
        const vp = this.vertices[vi]!;
        tess.gluTessVertex([vp.x, vp.y, 0.0], vp);
      }

      tess.gluTessEndContour();
    }
  }

  private getVertexByIndex(aPointIndex: number, holes: VRML_LAYER | null): VERTEX_3D | null {
    if (aPointIndex < 0 || aPointIndex >= this.idx + this.hidx + this.extra_verts.length) {
      this.error = 'getVertexByIndex():BUG: invalid index';
      return null;
    }

    if (aPointIndex < this.idx) {
      // vertex is in the vertices[] list
      return this.vertices[aPointIndex]!;
    } else if (aPointIndex >= this.idx + this.hidx) {
      // vertex is in the extra_verts[] list
      return this.extra_verts[aPointIndex - this.idx - this.hidx]!;
    }

    // vertex is in the holes object
    if (!holes) {
      this.error = 'getVertexByIndex():BUG: invalid index';
      return null;
    }

    const vp = holes.GetVertexByIndex(aPointIndex);

    if (!vp) {
      this.error = `getVertexByIndex():FAILED: ${holes.GetError()}`;
      return null;
    }

    return vp;
  }

  GetSize(): number {
    return this.vertices.length;
  }

  /** `Import( start, aTesselator )`: this object's contours, renumbered from start, as holes. */
  Import(start: number, aTesselator: GLUtesselator | null): number {
    if (start < 0) {
      this.error = 'Import(): invalid index ( start < 0 )';
      return -1;
    }

    if (!aTesselator) {
      this.error = 'Import(): NULL tesselator pointer';
      return -1;
    }

    let next = start;

    // renumber from 'start'
    for (const v of this.vertices) {
      v.i = next++;
      v.o = -1;
    }

    // push each contour to the tesselator
    for (const c of this.contours) {
      if (c.length < 3) continue;

      aTesselator.gluTessBeginContour();

      for (const vi of c) {
        const vp = this.vertices[vi]!;
        aTesselator.gluTessVertex([vp.x, vp.y, 0.0], vp);
      }

      aTesselator.gluTessEndContour();
    }

    return next;
  }

  GetVertexByIndex(aPointIndex: number): VERTEX_3D | null {
    const i0 = this.vertices[0]!.i;

    if (aPointIndex < i0 || aPointIndex >= i0 + this.vertices.length) {
      this.error = 'GetVertexByIndex(): invalid index';
      return null;
    }

    return this.vertices[aPointIndex - i0]!;
  }

  GetError(): string {
    return this.error;
  }

  SetVertexOffsets(aXoffset: number, aYoffset: number): void {
    this.offsetX = aXoffset;
    this.offsetY = aYoffset;
  }

  /**
   * `Get3DTriangles`: the top then the bottom copy of every ordered vertex, the top and bottom
   * triangles, and the walls joining them. False when there is nothing to give.
   */
  Get3DTriangles(
    aVertexList: number[],
    aIndexPlane: number[],
    aIndexSide: number[],
    aTopZ: number,
    aBotZ: number,
  ): boolean {
    aVertexList.length = 0;
    aIndexPlane.length = 0;
    aIndexSide.length = 0;

    if (this.ordmap.length < 3 || this.outline.length === 0) return false;

    let topZ = aTopZ;
    let botZ = aBotZ;

    if (topZ <= botZ) [topZ, botZ] = [botZ, topZ];

    let vp = this.getVertexByIndex(this.ordmap[0]!, this.pholes);

    if (!vp) return false;

    const vsize = this.ordmap.length;

    // top vertices
    for (let i = 0; i < vsize; ++i) {
      vp = this.getVertexByIndex(this.ordmap[i]!, this.pholes);

      if (!vp) {
        aVertexList.length = 0;
        return false;
      }

      aVertexList.push(vp.x + this.offsetX, vp.y + this.offsetY, topZ);
    }

    // bottom vertices
    for (let i = 0; i < vsize; ++i) {
      vp = this.getVertexByIndex(this.ordmap[i]!, this.pholes)!;
      aVertexList.push(vp.x + this.offsetX, vp.y + this.offsetY, botZ);
    }

    // create the index lists .. it is difficult to estimate the list size
    // a priori so instead we use a vector to help
    const holes_only = this.triplets.length === 0;

    if (!holes_only) {
      // go through the triplet list and write out the indices based on order
      const aIndexBot: number[] = [];

      for (const t of this.triplets) {
        // top vertices
        aIndexPlane.push(t.i1, t.i2, t.i3);
        // bottom vertices
        aIndexBot.push(t.i2 + vsize, t.i1 + vsize, t.i3 + vsize);
      }

      aIndexPlane.push(...aIndexBot);
    }

    // compile indices for the walls joining top to bottom
    const wall = (curPoint: number, lastPoint: number): void => {
      if (!holes_only) {
        aIndexSide.push(curPoint, lastPoint, curPoint + vsize);
        aIndexSide.push(curPoint + vsize, lastPoint, lastPoint + vsize);
      } else {
        aIndexSide.push(curPoint, curPoint + vsize, lastPoint);
        aIndexSide.push(curPoint + vsize, lastPoint + vsize, lastPoint);
      }
    };

    for (const cp of this.outline) {
      if (cp.length < 3) continue;

      let lastPoint = cp[0]!;

      for (let k = 1; k < cp.length; ++k) {
        const curPoint = cp[k]!;
        wall(curPoint, lastPoint);
        lastPoint = curPoint;
      }

      // check if the loop needs to be closed
      wall(cp[0]!, cp[cp.length - 1]!);
    }

    return true;
  }

  /** `Get2DTriangles`: the ordered vertices at aHeight and the triangles, wound for aTopPlane. */
  Get2DTriangles(
    aVertexList: number[],
    aIndexPlane: number[],
    aHeight: number,
    aTopPlane: boolean,
  ): boolean {
    aVertexList.length = 0;
    aIndexPlane.length = 0;

    if (this.ordmap.length < 3 || this.outline.length === 0) return false;

    let vp = this.getVertexByIndex(this.ordmap[0]!, this.pholes);

    if (!vp) return false;

    const vsize = this.ordmap.length;

    // vertices
    for (let i = 0; i < vsize; ++i) {
      vp = this.getVertexByIndex(this.ordmap[i]!, this.pholes);

      if (!vp) {
        aVertexList.length = 0;
        return false;
      }

      aVertexList.push(vp.x + this.offsetX, vp.y + this.offsetY, aHeight);
    }

    // create the index lists .. it is difficult to estimate the list size
    // a priori so instead we use a vector to help
    if (this.triplets.length === 0) return false;

    // go through the triplet list and write out the indices based on order
    if (aTopPlane) {
      for (const t of this.triplets) aIndexPlane.push(t.i1, t.i2, t.i3);
    } else {
      for (const t of this.triplets) aIndexPlane.push(t.i2, t.i1, t.i3);
    }

    return true;
  }
}
