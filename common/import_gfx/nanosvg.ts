// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from nanosvg, copyright (c) 2013-14 Mikko Mononen (zlib).
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * nanosvg, the SVG reader `SVG_IMPORT_PLUGIN` is built on. Counterpart:
 * `thirdparty/nanosvg/nanosvg.{h,cpp}`, as KiCad bundles it.
 *
 * The output is deliberately *not* a rendering of the document. It is a flat
 * list of shapes, each a list of sub-paths, each a run of **cubic Bézier
 * control points** — `x0,y0, c1x,c1y, c2x,c2y, x1,y1, c1x,c1y, …`. Every
 * primitive is turned into cubics on the way in: a straight line becomes a
 * cubic whose controls sit at the 1/3 marks, a circle becomes four
 * `KAPPA90` arcs, an elliptical `A` command becomes up-to-90° cubic segments.
 * Nothing is flattened to line segments here — that is the consumer's job, and
 * KiCad's consumer has its own subdivision rule (see `svg_import_plugin.ts`).
 *
 * Three things about this file are load-bearing for the imported geometry and
 * are easy to "clean up" into something wrong:
 *
 * 1. **A shape's sub-paths come out in reverse parse order.** `nsvg__addPath`
 *    pushes onto the head of a linked list. The order the importer sees its
 *    `AddPolygon`/`AddSpline` calls in follows from that.
 * 2. **Coordinates leave this file already in the requested unit.**
 *    `scaleToViewbox` folds the viewBox transform *and* a unit scale into every
 *    point. Asking for `"mm"` at 96 dpi multiplies by 25.4/96, and that is the
 *    only reason the plugin can hand millimetres to the importer without
 *    scaling anything itself.
 * 3. **`NSVG_RGB` packs ABGR**, red in the low byte, and the alpha byte is the
 *    *opacity attribute*, written in only when the shape is created.
 *
 * Faithfully reproduced oddities, none of which is to be "fixed":
 *  - `NANOSVG_ALL_COLOR_KEYWORDS` is not defined in KiCad's build, so the named
 *    colour table has ten entries and every other name is mid grey.
 *  - the rounded-rect test uses two different epsilons, `1e-5` for rx and
 *    `1e-4` for ry.
 *  - `pathFlag` guards against nested `<path>` elements but is never set, so
 *    the guard never fires.
 *  - `display="inline"` does not undo an ancestor's `display="none"`.
 *  - `pushAttr` silently does nothing at the 128-deep cap while `popAttr` still
 *    pops, so a document nested deeper than that loses attributes on the way
 *    out.
 *
 * Deliberate gaps, each named at its site: gradients (`linearGradient`,
 * `radialGradient`, `stop`) are recognised but not resolved, and text is not a
 * shape in nanosvg at all.
 *
 * Precision: nanosvg computes in C `float`. We compute in `number`, i.e.
 * double. Results agree to float precision, not bit-for-bit; the only places
 * that could turn that into a *discrete* difference are the threshold
 * comparisons called out below, and none of them is near a representable edge
 * for any realistic document.
 */

/**
 * `NSVG_PI`. The C source spells out 3.14159265358979323846264338327; rounded
 * to a double that is exactly `Math.PI`, so the literal is not repeated here.
 */
const NSVG_PI = Math.PI;
/** Control-point offset, as a fraction of the radius, for a 90° arc. */
const NSVG_KAPPA90 = 0.5522847493;

const NSVG_ALIGN_MID = 0;
const NSVG_ALIGN_MIN = 1;
const NSVG_ALIGN_MAX = 2;
const NSVG_ALIGN_MEET = 0;
const NSVG_ALIGN_NONE = 1;
const NSVG_ALIGN_SLICE = 2;

/** `NSVG_RGB( r, g, b )` — **A**BGR, red in the low byte. */
const NSVG_RGB = (r: number, g: number, b: number): number =>
  ((r >>> 0) | ((g >>> 0) << 8) | ((b >>> 0) << 16)) >>> 0;

/** `NSVG_MAX_ATTR`, the attribute-stack depth. */
const NSVG_MAX_ATTR = 128;
/** `NSVG_MAX_DASHES`. */
const NSVG_MAX_DASHES = 8;

export enum NSVGpaintType {
  NSVG_PAINT_NONE = 0,
  NSVG_PAINT_COLOR = 1,
  NSVG_PAINT_LINEAR_GRADIENT = 2,
  NSVG_PAINT_RADIAL_GRADIENT = 3,
}

export enum NSVGlineJoin {
  NSVG_JOIN_MITER = 0,
  NSVG_JOIN_ROUND = 1,
  NSVG_JOIN_BEVEL = 2,
}

export enum NSVGlineCap {
  NSVG_CAP_BUTT = 0,
  NSVG_CAP_ROUND = 1,
  NSVG_CAP_SQUARE = 2,
}

export enum NSVGfillRule {
  NSVG_FILLRULE_NONZERO = 0,
  NSVG_FILLRULE_EVENODD = 1,
}

/** `NSVGflags`. The only flag there is. */
export const NSVG_FLAGS_VISIBLE = 0x01;

/**
 * `NSVGpaint`. Upstream unions the colour with a gradient pointer; gradients
 * are not resolved here (see the file docblock), so only `color` survives and
 * it is meaningful only when `type` is `NSVG_PAINT_COLOR`.
 */
export interface NSVGpaint {
  type: NSVGpaintType;
  color: number;
}

/** `[minx, miny, maxx, maxy]`, upstream's `bounds` arrays. */
export type NSVGbounds = [number, number, number, number];

/** `NSVGpath`. `pts` is `npts * 2` long; `npts` is always `1 + 3 * ncurves`. */
export interface NSVGpath {
  pts: number[];
  npts: number;
  closed: boolean;
  bounds: NSVGbounds;
}

/** `NSVGshape`. The linked list of paths becomes an array, head first. */
export interface NSVGshape {
  id: string;
  fill: NSVGpaint;
  stroke: NSVGpaint;
  opacity: number;
  strokeWidth: number;
  strokeDashOffset: number;
  strokeDashArray: number[];
  strokeDashCount: number;
  strokeLineJoin: NSVGlineJoin;
  strokeLineCap: NSVGlineCap;
  miterLimit: number;
  fillRule: NSVGfillRule;
  flags: number;
  bounds: NSVGbounds;
  paths: NSVGpath[];
}

/** `NSVGimage`. */
export interface NSVGimage {
  width: number;
  height: number;
  shapes: NSVGshape[];
}

// ---------------------------------------------------------------------------
// character classes, exactly nanosvg's
// ---------------------------------------------------------------------------

/**
 * `nsvg__isspace`, which is `strchr( " \t\n\v\f\r", c ) != 0`.
 *
 * **That includes NUL**, and not by accident of this port: `strchr` searches
 * for the terminating null too, so it returns a valid pointer for `c == '\0'`
 * and nanosvg treats a string's terminator as whitespace. Two right-trim loops
 * — in `parseStyle` and `parseNameValue` — walk backwards from the terminator
 * and depend on it. Drop the NUL case and the last declaration of a `style`
 * block keeps its trailing space, so `stroke: blue }` reads as the colour
 * `"blue "`, which is not a colour name and comes out mid grey.
 */
const isspace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r' || c === '\0';

/** `nsvg__isdigit`. */
const isdigit = (c: string): boolean => c >= '0' && c <= '9';

/**
 * `nsvg__isnum`: the characters that can *start* a number token — which
 * includes `e` and `E`, so a path command spelled `e` reads as a number.
 */
const isnum = (c: string): boolean => '0123456789+-.eE'.includes(c) && c !== '';

// ---------------------------------------------------------------------------
// the `sscanf` calls nanosvg makes, reproduced field by field
// ---------------------------------------------------------------------------

/** A scan that consumed something, and where it stopped. */
interface Scan {
  value: number;
  next: number;
}

/**
 * C's `%f`. Optional leading whitespace, optional sign, digits with an optional
 * point and an optional exponent. Returns null when there is no conversion, in
 * which case `sscanf` leaves the caller's variable untouched.
 *
 * The `inf`/`nan`/hex-float forms C also accepts are not reproduced: nanosvg
 * only ever scans SVG attribute values, where they cannot appear.
 */
function scanFloat(s: string, from: number): Scan | null {
  let i = from;

  while (i < s.length && isspace(s[i]!)) i++;

  const start = i;

  if (i < s.length && (s[i] === '+' || s[i] === '-')) i++;

  let digits = 0;

  while (i < s.length && isdigit(s[i]!)) {
    i++;
    digits++;
  }

  if (i < s.length && s[i] === '.') {
    i++;
    while (i < s.length && isdigit(s[i]!)) {
      i++;
      digits++;
    }
  }

  if (digits === 0) return null;

  const mantissaEnd = i;

  if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
    let j = i + 1;

    if (j < s.length && (s[j] === '+' || s[j] === '-')) j++;

    let expDigits = 0;

    while (j < s.length && isdigit(s[j]!)) {
      j++;
      expDigits++;
    }

    // An `e` with no digits after it is not part of the number.
    if (expDigits > 0) i = j;
    else i = mantissaEnd;
  }

  return { value: Number.parseFloat(s.slice(start, i)), next: i };
}

/** C's `%d`. */
function scanInt(s: string, from: number): Scan | null {
  let i = from;

  while (i < s.length && isspace(s[i]!)) i++;

  const start = i;

  if (i < s.length && (s[i] === '+' || s[i] === '-')) i++;

  let digits = 0;

  while (i < s.length && isdigit(s[i]!)) {
    i++;
    digits++;
  }

  if (digits === 0) return null;

  return { value: Number.parseInt(s.slice(start, i), 10), next: i };
}

/** C's `%x` — an unsigned hexadecimal, with the same optional-sign rules. */
function scanHex(s: string, from: number): Scan | null {
  let i = from;

  while (i < s.length && isspace(s[i]!)) i++;

  const start = i;

  if (i < s.length && (s[i] === '+' || s[i] === '-')) i++;

  let digits = 0;

  while (i < s.length && /[0-9a-fA-F]/.test(s[i] ?? '')) {
    i++;
    digits++;
  }

  if (digits === 0) return null;

  return { value: Number.parseInt(s.slice(start, i), 16) >>> 0, next: i };
}

/** C's `%[set]`: one or more characters from `set`, no leading-space skip. */
function scanSet(s: string, from: number, set: string): { text: string; next: number } | null {
  let i = from;

  while (i < s.length && set.includes(s[i]!)) i++;

  if (i === from) return null;

  return { text: s.slice(from, i), next: i };
}

/** C's `%Ns`: skip whitespace, then up to `max` non-whitespace characters. */
function scanStr(s: string, from: number, max: number): { text: string; next: number } | null {
  let i = from;

  while (i < s.length && isspace(s[i]!)) i++;

  if (i >= s.length) return null;

  const start = i;

  while (i < s.length && !isspace(s[i]!)) i++;

  return { text: s.slice(start, Math.min(i, start + max)), next: i };
}

// ---------------------------------------------------------------------------
// the XML parser
// ---------------------------------------------------------------------------

/** `nsvg__parseContent`: trim leading whitespace, drop if empty. */
function parseContent(text: string, contentCb: (s: string) => void): void {
  let i = 0;

  while (i < text.length && isspace(text[i]!)) i++;

  if (i >= text.length) return;

  contentCb(text.slice(i));
}

/**
 * `nsvg__parseElement`. `text` is what sat between `<` and `>`.
 *
 * Entities are not decoded and CDATA is not recognised — this is the whole of
 * nanosvg's XML support, and an SVG that needs more of one simply loses it.
 */
function parseElement(
  text: string,
  startelCb: (el: string, attr: string[]) => void,
  endelCb: (el: string) => void,
): void {
  const attr: string[] = [];
  let s = 0;
  let start = false;
  let end = false;

  while (s < text.length && isspace(text[s]!)) s++;

  if (text[s] === '/') {
    s++;
    end = true;
  } else {
    start = true;
  }

  if (s >= text.length || text[s] === '?' || text[s] === '!') return;

  const nameStart = s;

  while (s < text.length && !isspace(text[s]!)) s++;

  const name = text.slice(nameStart, s);

  if (s < text.length) s++;

  while (!end && s < text.length) {
    while (s < text.length && isspace(text[s]!)) s++;

    if (s >= text.length) break;

    if (text[s] === '/') {
      end = true;
      break;
    }

    const attrNameStart = s;

    while (s < text.length && !isspace(text[s]!) && text[s] !== '=') s++;

    const attrName = text.slice(attrNameStart, s);

    if (s < text.length) s++;

    while (s < text.length && text[s] !== '"' && text[s] !== "'") s++;

    if (s >= text.length) break;

    const quote = text[s];
    s++;

    const valueStart = s;

    while (s < text.length && text[s] !== quote) s++;

    const value = text.slice(valueStart, s);

    if (s < text.length) s++;

    attr.push(attrName, value);
  }

  if (start) startelCb(name, attr);
  if (end) endelCb(name);
}

/** `nsvg__parseXML`: split on `<` and `>` and dispatch. */
function parseXML(
  input: string,
  startelCb: (el: string, attr: string[]) => void,
  endelCb: (el: string) => void,
  contentCb: (s: string) => void,
): void {
  const TAG = 1;
  const CONTENT = 2;

  let s = 0;
  let mark = 0;
  let state = CONTENT;

  while (s < input.length) {
    if (input[s] === '<' && state === CONTENT) {
      parseContent(input.slice(mark, s), contentCb);
      s++;
      mark = s;
      state = TAG;
    } else if (input[s] === '>' && state === TAG) {
      parseElement(input.slice(mark, s), startelCb, endelCb);
      s++;
      mark = s;
      state = CONTENT;
    } else {
      s++;
    }
  }
}

// ---------------------------------------------------------------------------
// 2x3 affine transforms, upstream's `float t[6]` layout: [a b c d e f]
// ---------------------------------------------------------------------------

/** `[a, b, c, d, e, f]`, mapping `(x, y)` to `(ax + cy + e, bx + dy + f)`. */
type Xform = [number, number, number, number, number, number];

const xformIdentity = (): Xform => [1, 0, 0, 1, 0, 0];

const xformSetTranslation = (tx: number, ty: number): Xform => [1, 0, 0, 1, tx, ty];

const xformSetScale = (sx: number, sy: number): Xform => [sx, 0, 0, sy, 0, 0];

const xformSetSkewX = (a: number): Xform => [1, 0, Math.tan(a), 1, 0, 0];

const xformSetSkewY = (a: number): Xform => [1, Math.tan(a), 0, 1, 0, 0];

const xformSetRotation = (a: number): Xform => {
  const cs = Math.cos(a);
  const sn = Math.sin(a);

  return [cs, sn, -sn, cs, 0, 0];
};

/** `nsvg__xformMultiply( t, s )`: `t := t * s`, in place. */
function xformMultiply(t: Xform, s: Xform): void {
  const t0 = t[0] * s[0] + t[1] * s[2];
  const t2 = t[2] * s[0] + t[3] * s[2];
  const t4 = t[4] * s[0] + t[5] * s[2] + s[4];

  t[1] = t[0] * s[1] + t[1] * s[3];
  t[3] = t[2] * s[1] + t[3] * s[3];
  t[5] = t[4] * s[1] + t[5] * s[3] + s[5];
  t[0] = t0;
  t[2] = t2;
  t[4] = t4;
}

/** `nsvg__xformPremultiply( t, s )`: `t := s * t`, in place. */
function xformPremultiply(t: Xform, s: Xform): void {
  const s2: Xform = [...s];

  xformMultiply(s2, t);

  for (let i = 0; i < 6; i++) t[i] = s2[i]!;
}

/** `nsvg__xformPoint`. */
const xformPoint = (x: number, y: number, t: Xform): [number, number] => [
  x * t[0] + y * t[2] + t[4],
  x * t[1] + y * t[3] + t[5],
];

/** `nsvg__xformVec`: the same without the translation column. */
const xformVec = (x: number, y: number, t: Xform): [number, number] => [
  x * t[0] + y * t[2],
  x * t[1] + y * t[3],
];

/** `nsvg__getAverageScale`: the mean of the two column norms. */
const getAverageScale = (t: Xform): number => {
  const sx = Math.sqrt(t[0] * t[0] + t[2] * t[2]);
  const sy = Math.sqrt(t[1] * t[1] + t[3] * t[3]);

  return (sx + sy) * 0.5;
};

// ---------------------------------------------------------------------------
// cubic bounds
// ---------------------------------------------------------------------------

const NSVG_EPSILON = 1e-12;

const ptInBounds = (px: number, py: number, b: NSVGbounds): boolean =>
  px >= b[0] && px <= b[2] && py >= b[1] && py <= b[3];

const evalBezier = (t: number, p0: number, p1: number, p2: number, p3: number): number => {
  const it = 1.0 - t;

  return it * it * it * p0 + 3.0 * it * it * t * p1 + 3.0 * it * t * t * p2 + t * t * t * p3;
};

/**
 * `nsvg__curveBounds`: the exact bounding box of one cubic — the endpoint box,
 * widened by any extremum of the curve that falls strictly inside `(0, 1)`.
 * `curve` is eight floats, `x0,y0,c1x,c1y,c2x,c2y,x1,y1`.
 */
function curveBounds(curve: number[]): NSVGbounds {
  const v = (i: number, c: number): number => curve[i * 2 + c]!;

  const bounds: number[] = [
    Math.min(v(0, 0), v(3, 0)),
    Math.min(v(0, 1), v(3, 1)),
    Math.max(v(0, 0), v(3, 0)),
    Math.max(v(0, 1), v(3, 1)),
  ];

  const asBounds = (): NSVGbounds => [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!];

  // A cubic lies inside the convex hull of its control points, so if the
  // controls are already inside the endpoint box there is nothing to add.
  if (ptInBounds(v(1, 0), v(1, 1), asBounds()) && ptInBounds(v(2, 0), v(2, 1), asBounds()))
    return asBounds();

  for (let i = 0; i < 2; i++) {
    const p0 = v(0, i);
    const p1 = v(1, i);
    const p2 = v(2, i);
    const p3 = v(3, i);

    const a = -3.0 * p0 + 9.0 * p1 - 9.0 * p2 + 3.0 * p3;
    const b = 6.0 * p0 - 12.0 * p1 + 6.0 * p2;
    const c = 3.0 * p1 - 3.0 * p0;
    const roots: number[] = [];

    if (Math.abs(a) < NSVG_EPSILON) {
      if (Math.abs(b) > NSVG_EPSILON) {
        const t = -c / b;

        if (t > NSVG_EPSILON && t < 1.0 - NSVG_EPSILON) roots.push(t);
      }
    } else {
      const b2ac = b * b - 4.0 * c * a;

      if (b2ac > NSVG_EPSILON) {
        let t = (-b + Math.sqrt(b2ac)) / (2.0 * a);

        if (t > NSVG_EPSILON && t < 1.0 - NSVG_EPSILON) roots.push(t);

        t = (-b - Math.sqrt(b2ac)) / (2.0 * a);

        if (t > NSVG_EPSILON && t < 1.0 - NSVG_EPSILON) roots.push(t);
      }
    }

    for (const root of roots) {
      const value = evalBezier(root, p0, p1, p2, p3);

      bounds[0 + i] = Math.min(bounds[0 + i]!, value);
      bounds[2 + i] = Math.max(bounds[2 + i]!, value);
    }
  }

  return asBounds();
}

// ---------------------------------------------------------------------------
// parser state
// ---------------------------------------------------------------------------

/** `NSVGunits`. */
enum NSVGunits {
  NSVG_UNITS_USER = 0,
  NSVG_UNITS_PX = 1,
  NSVG_UNITS_PT = 2,
  NSVG_UNITS_PC = 3,
  NSVG_UNITS_MM = 4,
  NSVG_UNITS_CM = 5,
  NSVG_UNITS_IN = 6,
  NSVG_UNITS_PERCENT = 7,
  NSVG_UNITS_EM = 8,
  NSVG_UNITS_EX = 9,
}

interface NSVGcoordinate {
  value: number;
  units: NSVGunits;
}

/** `NSVGattrib`, the entry of the cascade stack. */
interface NSVGattrib {
  id: string;
  xform: Xform;
  fillColor: number;
  strokeColor: number;
  opacity: number;
  fillOpacity: number;
  strokeOpacity: number;
  fillGradient: string;
  strokeGradient: string;
  strokeWidth: number;
  strokeDashOffset: number;
  strokeDashArray: number[];
  strokeDashCount: number;
  strokeLineJoin: NSVGlineJoin;
  strokeLineCap: NSVGlineCap;
  miterLimit: number;
  fillRule: NSVGfillRule;
  fontSize: number;
  stopColor: number;
  stopOpacity: number;
  stopOffset: number;
  /** 0 none, 1 colour, 2 `url(#…)`. */
  hasFill: number;
  hasStroke: number;
  visible: number;
}

const cloneAttrib = (a: NSVGattrib): NSVGattrib => ({
  ...a,
  xform: [...a.xform],
  strokeDashArray: [...a.strokeDashArray],
});

/** `NSVGstyles`, one `.class { … }` rule from a `<style>` element. */
interface NSVGstyles {
  name: string;
  description: string | null;
}

class NSVGparser {
  attr: NSVGattrib[] = [];
  attrHead = 0;
  /** The working point buffer, `npts * 2` floats. */
  pts: number[] = [];
  /** Sub-paths of the shape being built, **head first** — reverse parse order. */
  plist: NSVGpath[] = [];
  image: NSVGimage = { width: 0, height: 0, shapes: [] };
  /** Prepended, exactly as upstream's linked list is. */
  styles: NSVGstyles[] = [];
  viewMinx = 0;
  viewMiny = 0;
  viewWidth = 0;
  viewHeight = 0;
  alignX = NSVG_ALIGN_MID;
  alignY = NSVG_ALIGN_MID;
  alignType = NSVG_ALIGN_MEET;
  dpi = 96;
  /** Never set to 1 upstream; the nested-`<path>` guard it feeds never fires. */
  pathFlag = false;
  defsFlag = false;
  styleFlag = false;

  constructor() {
    // `nsvg__createParser`'s initial style.
    this.attr.push({
      id: '',
      xform: xformIdentity(),
      fillColor: NSVG_RGB(0, 0, 0),
      strokeColor: NSVG_RGB(0, 0, 0),
      opacity: 1,
      fillOpacity: 1,
      strokeOpacity: 1,
      fillGradient: '',
      strokeGradient: '',
      strokeWidth: 0,
      strokeDashOffset: 0,
      strokeDashArray: [0, 0, 0, 0, 0, 0, 0, 0],
      strokeDashCount: 0,
      strokeLineJoin: NSVGlineJoin.NSVG_JOIN_MITER,
      strokeLineCap: NSVGlineCap.NSVG_CAP_BUTT,
      miterLimit: 4,
      fillRule: NSVGfillRule.NSVG_FILLRULE_NONZERO,
      fontSize: 0,
      stopColor: 0,
      stopOpacity: 1,
      stopOffset: 0,
      hasFill: 1,
      hasStroke: 0,
      visible: 1,
    });
  }

  getAttr(): NSVGattrib {
    return this.attr[this.attrHead]!;
  }

  /** At the 128-deep cap this does nothing — but `popAttr` still pops. */
  pushAttr(): void {
    if (this.attrHead < NSVG_MAX_ATTR - 1) {
      this.attrHead++;
      this.attr[this.attrHead] = cloneAttrib(this.attr[this.attrHead - 1]!);
    }
  }

  popAttr(): void {
    if (this.attrHead > 0) this.attrHead--;
  }

  get npts(): number {
    return this.pts.length / 2;
  }

  actualOrigX(): number {
    return this.viewMinx;
  }
  actualOrigY(): number {
    return this.viewMiny;
  }
  actualWidth(): number {
    return this.viewWidth;
  }
  actualHeight(): number {
    return this.viewHeight;
  }

  /** `nsvg__actualLength`: the viewBox diagonal over √2. */
  actualLength(): number {
    const w = this.actualWidth();
    const h = this.actualHeight();

    return Math.sqrt(w * w + h * h) / Math.sqrt(2.0);
  }

  convertToPixels(c: NSVGcoordinate, orig: number, length: number): number {
    const attr = this.getAttr();

    switch (c.units) {
      case NSVGunits.NSVG_UNITS_USER:
        return c.value;
      case NSVGunits.NSVG_UNITS_PX:
        return c.value;
      case NSVGunits.NSVG_UNITS_PT:
        return (c.value / 72.0) * this.dpi;
      case NSVGunits.NSVG_UNITS_PC:
        return (c.value / 6.0) * this.dpi;
      case NSVGunits.NSVG_UNITS_MM:
        return (c.value / 25.4) * this.dpi;
      case NSVGunits.NSVG_UNITS_CM:
        return (c.value / 2.54) * this.dpi;
      case NSVGunits.NSVG_UNITS_IN:
        return c.value * this.dpi;
      case NSVGunits.NSVG_UNITS_EM:
        return c.value * attr.fontSize;
      case NSVGunits.NSVG_UNITS_EX:
        // x-height of Helvetica, upstream's constant.
        return c.value * attr.fontSize * 0.52;
      case NSVGunits.NSVG_UNITS_PERCENT:
        return orig + (c.value / 100.0) * length;
      default:
        return c.value;
    }
  }

  // -- path building -------------------------------------------------------

  resetPath(): void {
    this.pts.length = 0;
  }

  addPoint(x: number, y: number): void {
    this.pts.push(x, y);
  }

  /** `nsvg__moveTo`: **overwrites** the last point rather than appending. */
  moveTo(x: number, y: number): void {
    if (this.npts > 0) {
      this.pts[(this.npts - 1) * 2 + 0] = x;
      this.pts[(this.npts - 1) * 2 + 1] = y;
    } else {
      this.addPoint(x, y);
    }
  }

  /** A straight line, as a cubic with its controls at the 1/3 marks. */
  lineTo(x: number, y: number): void {
    if (this.npts > 0) {
      const px = this.pts[(this.npts - 1) * 2 + 0]!;
      const py = this.pts[(this.npts - 1) * 2 + 1]!;
      const dx = x - px;
      const dy = y - py;

      this.addPoint(px + dx / 3.0, py + dy / 3.0);
      this.addPoint(x - dx / 3.0, y - dy / 3.0);
      this.addPoint(x, y);
    }
  }

  cubicBezTo(cpx1: number, cpy1: number, cpx2: number, cpy2: number, x: number, y: number): void {
    this.addPoint(cpx1, cpy1);
    this.addPoint(cpx2, cpy2);
    this.addPoint(x, y);
  }

  /**
   * `nsvg__addPath`. Fewer than four points is not a complete cubic and is
   * dropped outright — note the check comes *before* the closing segment, so a
   * `M x y Z` contributes nothing.
   */
  addPath(closed: boolean): void {
    if (this.npts < 4) return;

    if (closed) this.lineTo(this.pts[0]!, this.pts[1]!);

    const attr = this.getAttr();
    const npts = this.npts;
    const pts: number[] = new Array(npts * 2);

    for (let i = 0; i < npts; ++i) {
      const [x, y] = xformPoint(this.pts[i * 2]!, this.pts[i * 2 + 1]!, attr.xform);

      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
    }

    const bounds: NSVGbounds = [0, 0, 0, 0];

    for (let i = 0; i < npts - 1; i += 3) {
      const cb = curveBounds(pts.slice(i * 2, i * 2 + 8));

      if (i === 0) {
        bounds[0] = cb[0];
        bounds[1] = cb[1];
        bounds[2] = cb[2];
        bounds[3] = cb[3];
      } else {
        bounds[0] = Math.min(bounds[0], cb[0]);
        bounds[1] = Math.min(bounds[1], cb[1]);
        bounds[2] = Math.max(bounds[2], cb[2]);
        bounds[3] = Math.max(bounds[3], cb[3]);
      }
    }

    // Upstream pushes onto the head of the list, so a shape's sub-paths end up
    // in reverse parse order. Everything downstream sees them that way.
    this.plist.unshift({ pts, npts, closed, bounds });
  }

  /**
   * `nsvg__addShape`. Note the two multiplications the stroke width picks up:
   * the element's own transform scale here, and the viewBox/unit scale later
   * in `scaleToViewbox`.
   */
  addShape(): void {
    if (this.plist.length === 0) return;

    const attr = this.getAttr();
    const scale = getAverageScale(attr.xform);

    const paths = this.plist;
    this.plist = [];

    const bounds: NSVGbounds = [...paths[0]!.bounds];

    for (const path of paths.slice(1)) {
      bounds[0] = Math.min(bounds[0], path.bounds[0]);
      bounds[1] = Math.min(bounds[1], path.bounds[1]);
      bounds[2] = Math.max(bounds[2], path.bounds[2]);
      bounds[3] = Math.max(bounds[3], path.bounds[3]);
    }

    const fill: NSVGpaint = { type: NSVGpaintType.NSVG_PAINT_NONE, color: 0 };

    if (attr.hasFill === 1) {
      fill.type = NSVGpaintType.NSVG_PAINT_COLOR;
      fill.color = (attr.fillColor | ((attr.fillOpacity * 255) << 24)) >>> 0;
    } else if (attr.hasFill === 2) {
      // GAP: gradients are not resolved (see the file docblock). Upstream calls
      // `nsvg__createGradient`, which returns NULL when the referenced element
      // is missing and then sets the paint to NONE. We always take that branch.
      fill.type = NSVGpaintType.NSVG_PAINT_NONE;
    }

    const stroke: NSVGpaint = { type: NSVGpaintType.NSVG_PAINT_NONE, color: 0 };

    if (attr.hasStroke === 1) {
      stroke.type = NSVGpaintType.NSVG_PAINT_COLOR;
      stroke.color = (attr.strokeColor | ((attr.strokeOpacity * 255) << 24)) >>> 0;
    } else if (attr.hasStroke === 2) {
      // GAP: as above.
      stroke.type = NSVGpaintType.NSVG_PAINT_NONE;
    }

    this.image.shapes.push({
      id: attr.id,
      fill,
      stroke,
      opacity: attr.opacity,
      strokeWidth: attr.strokeWidth * scale,
      strokeDashOffset: attr.strokeDashOffset * scale,
      // Only the first `strokeDashCount` entries are copied; the shape's array
      // is zeroed, so a stale value left in the attrib beyond the count does
      // not travel with it.
      strokeDashArray: Array.from({ length: NSVG_MAX_DASHES }, (_, i) =>
        i < attr.strokeDashCount ? attr.strokeDashArray[i]! * scale : 0,
      ),
      strokeDashCount: attr.strokeDashCount,
      strokeLineJoin: attr.strokeLineJoin,
      strokeLineCap: attr.strokeLineCap,
      miterLimit: attr.miterLimit,
      fillRule: attr.fillRule,
      flags: attr.visible ? NSVG_FLAGS_VISIBLE : 0x00,
      bounds,
      paths,
    });
  }
}

// ---------------------------------------------------------------------------
// number and colour parsing
// ---------------------------------------------------------------------------

/**
 * `nsvg__atof`, nanosvg's own locale-independent conversion. Kept rather than
 * delegated to `Number.parseFloat` because the two disagree: this one returns 0
 * for a token with neither an integer nor a fractional part, and it ignores an
 * exponent whose digits are missing.
 */
function nsvgAtof(s: string): number {
  let cur = 0;
  let res = 0.0;
  let sign = 1.0;
  let hasIntPart = false;
  let hasFracPart = false;

  if (s[cur] === '+') {
    cur++;
  } else if (s[cur] === '-') {
    sign = -1;
    cur++;
  }

  if (cur < s.length && isdigit(s[cur]!)) {
    const start = cur;

    while (cur < s.length && isdigit(s[cur]!)) cur++;

    res = Number.parseInt(s.slice(start, cur), 10);
    hasIntPart = true;
  }

  if (s[cur] === '.') {
    cur++;

    if (cur < s.length && isdigit(s[cur]!)) {
      const start = cur;

      while (cur < s.length && isdigit(s[cur]!)) cur++;

      res += Number.parseInt(s.slice(start, cur), 10) / 10 ** (cur - start);
      hasFracPart = true;
    }
  }

  if (!hasIntPart && !hasFracPart) return 0.0;

  if (s[cur] === 'e' || s[cur] === 'E') {
    cur++;

    const exp = scanInt(s, cur);

    if (exp) res *= 10 ** exp.value;
  }

  return res * sign;
}

/**
 * `nsvg__parseNumber`: lift the numeric token starting at `from`.
 *
 * The 64-byte destination buffer is reproduced: a token longer than 63
 * characters is truncated, but the scan still consumes all of it.
 */
function parseNumber(s: string, from: number, size = 64): { it: string; next: number } {
  const last = size - 1;
  let it = '';
  let i = from;

  const take = (): void => {
    if (it.length < last) it += s[i];
    i++;
  };

  if (s[i] === '-' || s[i] === '+') take();

  while (i < s.length && isdigit(s[i]!)) take();

  if (s[i] === '.') {
    take();

    while (i < s.length && isdigit(s[i]!)) take();
  }

  if (s[i] === 'e' || s[i] === 'E') {
    take();

    if (s[i] === '-' || s[i] === '+') take();

    while (i < s.length && isdigit(s[i]!)) take();
  }

  return { it, next: i };
}

/** `nsvg__getNextPathItem`: one number or one single-character command. */
function getNextPathItem(s: string, from: number): { it: string; next: number } {
  let i = from;

  while (i < s.length && (isspace(s[i]!) || s[i] === ',')) i++;

  if (i >= s.length) return { it: '', next: i };

  const c = s[i]!;

  if (c === '-' || c === '+' || c === '.' || isdigit(c)) return parseNumber(s, i);

  return { it: c, next: i + 1 };
}

/** `nsvg__parseColorHex`. Anything but 3 or 6 hex digits reads as black. */
function parseColorHex(str: string): number {
  const s = str.slice(1); // skip '#'
  let n = 0;

  while (n < s.length && !isspace(s[n]!)) n++;

  let c = 0;

  if (n === 6) {
    c = scanHex(s, 0)?.value ?? 0;
  } else if (n === 3) {
    c = scanHex(s, 0)?.value ?? 0;
    c = ((c & 0xf) | ((c & 0xf0) << 4) | ((c & 0xf00) << 8)) >>> 0;
    c = (c | (c << 4)) >>> 0;
  }

  const r = (c >>> 16) & 0xff;
  const g = (c >>> 8) & 0xff;
  const b = c & 0xff;

  return NSVG_RGB(r, g, b);
}

/**
 * `nsvg__parseColorRGB`, i.e. `sscanf( str + 4, "%d%[%%, \t]%d%[%%, \t]%d" )`.
 *
 * The three components start at -1, and `sscanf` leaves them there when it
 * stops early — so a malformed `rgb(` produces `NSVG_RGB( -1, … )`, which is
 * 0xFFFFFFFF. Upstream's, kept.
 */
function parseColorRGB(str: string): number {
  let r = -1;
  let g = -1;
  let b = -1;
  let s1 = '';

  let pos = 4;

  const ri = scanInt(str, pos);

  if (ri) {
    r = ri.value;
    pos = ri.next;

    const set1 = scanSet(str, pos, '%, \t');

    if (set1) {
      s1 = set1.text;
      pos = set1.next;

      const gi = scanInt(str, pos);

      if (gi) {
        g = gi.value;
        pos = gi.next;

        const set2 = scanSet(str, pos, '%, \t');

        if (set2) {
          pos = set2.next;

          const bi = scanInt(str, pos);

          if (bi) b = bi.value;
        }
      }
    }
  }

  // Only the *first* separator is inspected for a '%', upstream's choice.
  if (s1.includes('%')) {
    return NSVG_RGB(
      Math.trunc((r * 255) / 100),
      Math.trunc((g * 255) / 100),
      Math.trunc((b * 255) / 100),
    );
  }

  return NSVG_RGB(r, g, b);
}

/**
 * `nsvg__colors`. Ten entries: KiCad's build does **not** define
 * `NANOSVG_ALL_COLOR_KEYWORDS`, so the 140 CSS colour keywords behind that
 * `#ifdef` are not compiled in and every one of them reads as mid grey.
 */
const nsvgColors: ReadonlyArray<readonly [string, number]> = [
  ['red', NSVG_RGB(255, 0, 0)],
  ['green', NSVG_RGB(0, 128, 0)],
  ['blue', NSVG_RGB(0, 0, 255)],
  ['yellow', NSVG_RGB(255, 255, 0)],
  ['cyan', NSVG_RGB(0, 255, 255)],
  ['magenta', NSVG_RGB(255, 0, 255)],
  ['black', NSVG_RGB(0, 0, 0)],
  ['grey', NSVG_RGB(128, 128, 128)],
  ['gray', NSVG_RGB(128, 128, 128)],
  ['white', NSVG_RGB(255, 255, 255)],
];

function parseColorName(str: string): number {
  for (const [name, color] of nsvgColors) if (name === str) return color;

  return NSVG_RGB(128, 128, 128);
}

function parseColor(str: string): number {
  let s = str;

  while (s.startsWith(' ')) s = s.slice(1);

  if (s.length >= 1 && s[0] === '#') return parseColorHex(s);

  if (s.length >= 4 && s.startsWith('rgb(')) return parseColorRGB(s);

  return parseColorName(s);
}

/** `nsvg__parseOpacity`: `%f`, clamped to `[0, 1]`, defaulting to 0. */
function parseOpacity(str: string): number {
  let val = scanFloat(str, 0)?.value ?? 0;

  if (val < 0.0) val = 0.0;
  if (val > 1.0) val = 1.0;

  return val;
}

/** `nsvg__parseMiterLimit`: `%f`, clamped below at 0. */
function parseMiterLimit(str: string): number {
  let val = scanFloat(str, 0)?.value ?? 0;

  if (val < 0.0) val = 0.0;

  return val;
}

/** `nsvg__parseUnits`: a two-character prefix test, never a full match. */
function parseUnits(units: string): NSVGunits {
  const c0 = units[0] ?? '';
  const c1 = units[1] ?? '';

  if (c0 === 'p' && c1 === 'x') return NSVGunits.NSVG_UNITS_PX;
  if (c0 === 'p' && c1 === 't') return NSVGunits.NSVG_UNITS_PT;
  if (c0 === 'p' && c1 === 'c') return NSVGunits.NSVG_UNITS_PC;
  if (c0 === 'm' && c1 === 'm') return NSVGunits.NSVG_UNITS_MM;
  if (c0 === 'c' && c1 === 'm') return NSVGunits.NSVG_UNITS_CM;
  if (c0 === 'i' && c1 === 'n') return NSVGunits.NSVG_UNITS_IN;
  if (c0 === '%') return NSVGunits.NSVG_UNITS_PERCENT;
  if (c0 === 'e' && c1 === 'm') return NSVGunits.NSVG_UNITS_EM;
  if (c0 === 'e' && c1 === 'x') return NSVGunits.NSVG_UNITS_EX;

  return NSVGunits.NSVG_UNITS_USER;
}

/** `nsvg__parseCoordinateRaw`: `sscanf( str, "%f%31s" )`. */
function parseCoordinateRaw(str: string): NSVGcoordinate {
  const coord: NSVGcoordinate = { value: 0, units: NSVGunits.NSVG_UNITS_USER };
  let units = '';

  const f = scanFloat(str, 0);

  if (f) {
    coord.value = f.value;

    const u = scanStr(str, f.next, 31);

    if (u) units = u.text;
  }

  coord.units = parseUnits(units);

  return coord;
}

const nsvgCoord = (v: number, units: NSVGunits): NSVGcoordinate => ({ value: v, units });

function parseCoordinate(p: NSVGparser, str: string, orig: number, length: number): number {
  return p.convertToPixels(parseCoordinateRaw(str), orig, length);
}

// ---------------------------------------------------------------------------
// transform attribute
// ---------------------------------------------------------------------------

/**
 * `nsvg__parseTransformArgs`. Returns the offset of the closing `)` — or 1 when
 * there is no parenthesised group, or **0** when there are more arguments than
 * the caller can hold, which is the source of the hang described in
 * `parseTransform`.
 */
function parseTransformArgs(str: string, maxNa: number): { args: number[]; len: number } {
  const args: number[] = [];
  let ptr = 0;

  while (ptr < str.length && str[ptr] !== '(') ++ptr;

  if (ptr >= str.length) return { args, len: 1 };

  let end = ptr;

  while (end < str.length && str[end] !== ')') ++end;

  if (end >= str.length) return { args, len: 1 };

  while (ptr < end) {
    const c = str[ptr]!;

    if (c === '-' || c === '+' || c === '.' || isdigit(c)) {
      if (args.length >= maxNa) return { args, len: 0 };

      const n = parseNumber(str, ptr);

      ptr = n.next;
      args.push(nsvgAtof(n.it));
    } else {
      ++ptr;
    }
  }

  return { args, len: end };
}

function parseMatrix(str: string): { xform: Xform | null; len: number } {
  const { args, len } = parseTransformArgs(str, 6);

  if (args.length !== 6) return { xform: null, len };

  return { xform: [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!], len };
}

function parseTranslate(str: string): { xform: Xform; len: number } {
  const { args, len } = parseTransformArgs(str, 2);

  if (args.length === 1) args[1] = 0.0;

  return { xform: xformSetTranslation(args[0] ?? 0, args[1] ?? 0), len };
}

function parseScale(str: string): { xform: Xform; len: number } {
  const { args, len } = parseTransformArgs(str, 2);

  if (args.length === 1) args[1] = args[0]!;

  return { xform: xformSetScale(args[0] ?? 0, args[1] ?? 0), len };
}

function parseSkewX(str: string): { xform: Xform; len: number } {
  const { args, len } = parseTransformArgs(str, 1);

  return { xform: xformSetSkewX(((args[0] ?? 0) / 180.0) * NSVG_PI), len };
}

function parseSkewY(str: string): { xform: Xform; len: number } {
  const { args, len } = parseTransformArgs(str, 1);

  return { xform: xformSetSkewY(((args[0] ?? 0) / 180.0) * NSVG_PI), len };
}

function parseRotate(str: string): { xform: Xform; len: number } {
  const { args, len } = parseTransformArgs(str, 3);
  const na = args.length;

  if (na === 1) {
    args[1] = 0.0;
    args[2] = 0.0;
  }

  const m = xformIdentity();

  if (na > 1) xformMultiply(m, xformSetTranslation(-(args[1] ?? 0), -(args[2] ?? 0)));

  xformMultiply(m, xformSetRotation(((args[0] ?? 0) / 180.0) * NSVG_PI));

  if (na > 1) xformMultiply(m, xformSetTranslation(args[1] ?? 0, args[2] ?? 0));

  return { xform: m, len };
}

/**
 * `nsvg__parseTransform`. Each recognised function is parsed and
 * *pre*multiplied, so a list composes right-to-left as SVG requires.
 *
 * DEVIATION, and the only one in this file: when a transform function is given
 * more arguments than it takes — `translate(1,2,3)`, `matrix(1,2,3,4,5,6,7)` —
 * `parseTransformArgs` returns a length of 0 and upstream's `str += len`
 * advances nowhere, so nanosvg spins forever on that input. A hang is not
 * behaviour worth reproducing in a browser, so we stop parsing the attribute
 * there and keep whatever was accumulated before it.
 */
function parseTransform(str: string): Xform {
  const xform = xformIdentity();
  let s = str;

  while (s.length > 0) {
    let result: { xform: Xform | null; len: number };

    if (s.startsWith('matrix')) result = parseMatrix(s);
    else if (s.startsWith('translate')) result = parseTranslate(s);
    else if (s.startsWith('scale')) result = parseScale(s);
    else if (s.startsWith('rotate')) result = parseRotate(s);
    else if (s.startsWith('skewX')) result = parseSkewX(s);
    else if (s.startsWith('skewY')) result = parseSkewY(s);
    else {
      s = s.slice(1);
      continue;
    }

    // Upstream loops forever here; see the docblock.
    if (result.len <= 0) break;

    if (result.xform) xformPremultiply(xform, result.xform);

    s = s.slice(result.len);
  }

  return xform;
}

/** `nsvg__parseUrl`: the id inside `url(#…)`, at most 63 characters. */
function parseUrl(str: string): string {
  let s = str.slice(4);

  if (s[0] === '#') s = s.slice(1);

  let id = '';

  for (let i = 0; i < 63 && i < s.length && s[i] !== ')'; i++) id += s[i];

  return id;
}

function parseLineCap(str: string): NSVGlineCap {
  if (str === 'butt') return NSVGlineCap.NSVG_CAP_BUTT;
  if (str === 'round') return NSVGlineCap.NSVG_CAP_ROUND;
  if (str === 'square') return NSVGlineCap.NSVG_CAP_SQUARE;

  return NSVGlineCap.NSVG_CAP_BUTT;
}

function parseLineJoin(str: string): NSVGlineJoin {
  if (str === 'miter') return NSVGlineJoin.NSVG_JOIN_MITER;
  if (str === 'round') return NSVGlineJoin.NSVG_JOIN_ROUND;
  if (str === 'bevel') return NSVGlineJoin.NSVG_JOIN_BEVEL;

  return NSVGlineJoin.NSVG_JOIN_MITER;
}

function parseFillRule(str: string): NSVGfillRule {
  if (str === 'nonzero') return NSVGfillRule.NSVG_FILLRULE_NONZERO;
  if (str === 'evenodd') return NSVGfillRule.NSVG_FILLRULE_EVENODD;

  return NSVGfillRule.NSVG_FILLRULE_NONZERO;
}

/** `nsvg__getNextDashItem`: one whitespace/comma-delimited token. */
function getNextDashItem(s: string, from: number): { it: string; next: number } {
  let i = from;
  let it = '';

  while (i < s.length && (isspace(s[i]!) || s[i] === ',')) i++;

  while (i < s.length && !isspace(s[i]!) && s[i] !== ',') {
    if (it.length < 63) it += s[i];
    i++;
  }

  return { it, next: i };
}

/**
 * `nsvg__parseStrokeDashArray`. At most eight entries are kept, each an
 * absolute length; a dash array summing to nothing is discarded entirely.
 */
function parseStrokeDashArray(p: NSVGparser, str: string, strokeDashArray: number[]): number {
  let count = 0;
  let sum = 0.0;
  let pos = 0;

  if (str[0] === 'n') return 0; // "none"

  while (pos < str.length) {
    const item = getNextDashItem(str, pos);

    pos = item.next;

    if (item.it.length === 0) break;

    if (count < NSVG_MAX_DASHES)
      strokeDashArray[count++] = Math.abs(parseCoordinate(p, item.it, 0.0, p.actualLength()));
  }

  for (let i = 0; i < count; i++) sum += strokeDashArray[i]!;

  if (sum <= 1e-6) count = 0;

  return count;
}

// ---------------------------------------------------------------------------
// attributes
// ---------------------------------------------------------------------------

/**
 * `nsvg__parseAttr`. Returns true when the name was one of the presentation
 * attributes handled here — the element parsers use that to decide whether to
 * try their own geometry attributes instead.
 */
function parseAttr(p: NSVGparser, name: string, value: string): boolean {
  const attr = p.getAttr();

  if (name === 'style') {
    parseStyle(p, value);
  } else if (name === 'display') {
    // Not reset on `display:inline`: one `display:none` hides the subtree.
    if (value === 'none') attr.visible = 0;
  } else if (name === 'fill') {
    if (value === 'none') {
      attr.hasFill = 0;
    } else if (value.startsWith('url(')) {
      attr.hasFill = 2;
      attr.fillGradient = parseUrl(value);
    } else {
      attr.hasFill = 1;
      attr.fillColor = parseColor(value);
    }
  } else if (name === 'opacity') {
    attr.opacity = parseOpacity(value);
  } else if (name === 'fill-opacity') {
    attr.fillOpacity = parseOpacity(value);
  } else if (name === 'stroke') {
    if (value === 'none') {
      attr.hasStroke = 0;
    } else if (value.startsWith('url(')) {
      attr.hasStroke = 2;
      attr.strokeGradient = parseUrl(value);
    } else {
      attr.hasStroke = 1;
      attr.strokeColor = parseColor(value);
    }
  } else if (name === 'stroke-width') {
    attr.strokeWidth = parseCoordinate(p, value, 0.0, p.actualLength());
  } else if (name === 'stroke-dasharray') {
    attr.strokeDashCount = parseStrokeDashArray(p, value, attr.strokeDashArray);
  } else if (name === 'stroke-dashoffset') {
    attr.strokeDashOffset = parseCoordinate(p, value, 0.0, p.actualLength());
  } else if (name === 'stroke-opacity') {
    attr.strokeOpacity = parseOpacity(value);
  } else if (name === 'stroke-linecap') {
    attr.strokeLineCap = parseLineCap(value);
  } else if (name === 'stroke-linejoin') {
    attr.strokeLineJoin = parseLineJoin(value);
  } else if (name === 'stroke-miterlimit') {
    attr.miterLimit = parseMiterLimit(value);
  } else if (name === 'fill-rule') {
    attr.fillRule = parseFillRule(value);
  } else if (name === 'font-size') {
    attr.fontSize = parseCoordinate(p, value, 0.0, p.actualLength());
  } else if (name === 'transform') {
    xformPremultiply(attr.xform, parseTransform(value));
  } else if (name === 'stop-color') {
    attr.stopColor = parseColor(value);
  } else if (name === 'stop-opacity') {
    attr.stopOpacity = parseOpacity(value);
  } else if (name === 'offset') {
    attr.stopOffset = parseCoordinate(p, value, 0.0, 1.0);
  } else if (name === 'id') {
    attr.id = value.slice(0, 63);
  } else if (name === 'class') {
    for (const style of p.styles) {
      // `style->name + 1` — the leading '.' of the selector is skipped.
      //
      // The null check has no counterpart upstream: a `<style>` whose block is
      // never closed leaves `description` NULL, and nanosvg walks it anyway.
      // We skip the rule rather than reproduce a null dereference.
      if (style.name.slice(1) === value && style.description !== null)
        parseStyle(p, style.description);
    }
  } else {
    return false;
  }

  return true;
}

/** `nsvg__parseNameValue`: one `name: value` pair out of a `style` string. */
function parseNameValue(p: NSVGparser, text: string, start: number, end: number): boolean {
  let str = start;

  while (str < end && text[str] !== ':') ++str;

  let val = str;

  // `text[str] ?? '\0'` is the C string's terminator, which reads as space.
  while (str > start && (text[str] === ':' || isspace(text[str] ?? '\0'))) --str;

  ++str;

  const name = text.slice(start, Math.min(str, start + 511));

  while (val < end && (text[val] === ':' || isspace(text[val] ?? '\0'))) ++val;

  const value = text.slice(val, Math.min(end, val + 511));

  return parseAttr(p, name, value);
}

/** `nsvg__parseStyle`: a `;`-separated declaration list. */
function parseStyle(p: NSVGparser, text: string): void {
  let str = 0;

  while (str < text.length) {
    while (str < text.length && isspace(text[str]!)) ++str;

    const start = str;

    while (str < text.length && text[str] !== ';') ++str;

    let end = str;

    // Same terminator rule: the loop starts *at* the NUL for the last
    // declaration of a block, and must step back off it.
    while (end > start && (text[end] === ';' || isspace(text[end] ?? '\0'))) --end;

    ++end;

    parseNameValue(p, text, start, end);

    if (str < text.length) ++str;
  }
}

/** `nsvg__parseAttribs`: `style` first-class, everything else via `parseAttr`. */
function parseAttribs(p: NSVGparser, attr: string[]): void {
  for (let i = 0; i < attr.length; i += 2) {
    if (attr[i] === 'style') parseStyle(p, attr[i + 1]!);
    else parseAttr(p, attr[i]!, attr[i + 1]!);
  }
}

// ---------------------------------------------------------------------------
// path data
// ---------------------------------------------------------------------------

function getArgsPerElement(cmd: string): number {
  switch (cmd) {
    case 'v':
    case 'V':
    case 'h':
    case 'H':
      return 1;
    case 'm':
    case 'M':
    case 'l':
    case 'L':
    case 't':
    case 'T':
      return 2;
    case 'q':
    case 'Q':
    case 's':
    case 'S':
      return 4;
    case 'c':
    case 'C':
      return 6;
    case 'a':
    case 'A':
      return 7;
    default:
      return 0;
  }
}

/** The current point and the reflected control point a path walk carries. */
interface PathCursor {
  cpx: number;
  cpy: number;
  cpx2: number;
  cpy2: number;
}

function pathMoveTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  if (rel) {
    c.cpx += args[0]!;
    c.cpy += args[1]!;
  } else {
    c.cpx = args[0]!;
    c.cpy = args[1]!;
  }

  p.moveTo(c.cpx, c.cpy);
}

function pathLineTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  if (rel) {
    c.cpx += args[0]!;
    c.cpy += args[1]!;
  } else {
    c.cpx = args[0]!;
    c.cpy = args[1]!;
  }

  p.lineTo(c.cpx, c.cpy);
}

function pathHLineTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  if (rel) c.cpx += args[0]!;
  else c.cpx = args[0]!;

  p.lineTo(c.cpx, c.cpy);
}

function pathVLineTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  if (rel) c.cpy += args[0]!;
  else c.cpy = args[0]!;

  p.lineTo(c.cpx, c.cpy);
}

function pathCubicBezTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  let cx1: number;
  let cy1: number;
  let cx2: number;
  let cy2: number;
  let x2: number;
  let y2: number;

  if (rel) {
    cx1 = c.cpx + args[0]!;
    cy1 = c.cpy + args[1]!;
    cx2 = c.cpx + args[2]!;
    cy2 = c.cpy + args[3]!;
    x2 = c.cpx + args[4]!;
    y2 = c.cpy + args[5]!;
  } else {
    cx1 = args[0]!;
    cy1 = args[1]!;
    cx2 = args[2]!;
    cy2 = args[3]!;
    x2 = args[4]!;
    y2 = args[5]!;
  }

  p.cubicBezTo(cx1, cy1, cx2, cy2, x2, y2);

  c.cpx2 = cx2;
  c.cpy2 = cy2;
  c.cpx = x2;
  c.cpy = y2;
}

function pathCubicBezShortTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  const x1 = c.cpx;
  const y1 = c.cpy;
  let cx2: number;
  let cy2: number;
  let x2: number;
  let y2: number;

  if (rel) {
    cx2 = c.cpx + args[0]!;
    cy2 = c.cpy + args[1]!;
    x2 = c.cpx + args[2]!;
    y2 = c.cpy + args[3]!;
  } else {
    cx2 = args[0]!;
    cy2 = args[1]!;
    x2 = args[2]!;
    y2 = args[3]!;
  }

  const cx1 = 2 * x1 - c.cpx2;
  const cy1 = 2 * y1 - c.cpy2;

  p.cubicBezTo(cx1, cy1, cx2, cy2, x2, y2);

  c.cpx2 = cx2;
  c.cpy2 = cy2;
  c.cpx = x2;
  c.cpy = y2;
}

function pathQuadBezTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  const x1 = c.cpx;
  const y1 = c.cpy;
  let cx: number;
  let cy: number;
  let x2: number;
  let y2: number;

  if (rel) {
    cx = c.cpx + args[0]!;
    cy = c.cpy + args[1]!;
    x2 = c.cpx + args[2]!;
    y2 = c.cpy + args[3]!;
  } else {
    cx = args[0]!;
    cy = args[1]!;
    x2 = args[2]!;
    y2 = args[3]!;
  }

  // Quadratic to cubic: the controls sit two thirds of the way to the handle.
  const cx1 = x1 + (2.0 / 3.0) * (cx - x1);
  const cy1 = y1 + (2.0 / 3.0) * (cy - y1);
  const cx2 = x2 + (2.0 / 3.0) * (cx - x2);
  const cy2 = y2 + (2.0 / 3.0) * (cy - y2);

  p.cubicBezTo(cx1, cy1, cx2, cy2, x2, y2);

  c.cpx2 = cx;
  c.cpy2 = cy;
  c.cpx = x2;
  c.cpy = y2;
}

function pathQuadBezShortTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  const x1 = c.cpx;
  const y1 = c.cpy;
  let x2: number;
  let y2: number;

  if (rel) {
    x2 = c.cpx + args[0]!;
    y2 = c.cpy + args[1]!;
  } else {
    x2 = args[0]!;
    y2 = args[1]!;
  }

  const cx = 2 * x1 - c.cpx2;
  const cy = 2 * y1 - c.cpy2;

  const cx1 = x1 + (2.0 / 3.0) * (cx - x1);
  const cy1 = y1 + (2.0 / 3.0) * (cy - y1);
  const cx2 = x2 + (2.0 / 3.0) * (cx - x2);
  const cy2 = y2 + (2.0 / 3.0) * (cy - y2);

  p.cubicBezTo(cx1, cy1, cx2, cy2, x2, y2);

  c.cpx2 = cx;
  c.cpy2 = cy;
  c.cpx = x2;
  c.cpy = y2;
}

const sqr = (x: number): number => x * x;

const vmag = (x: number, y: number): number => Math.sqrt(x * x + y * y);

const vecrat = (ux: number, uy: number, vx: number, vy: number): number =>
  (ux * vx + uy * vy) / (vmag(ux, uy) * vmag(vx, vy));

function vecang(ux: number, uy: number, vx: number, vy: number): number {
  let r = vecrat(ux, uy, vx, vy);

  if (r < -1.0) r = -1.0;
  if (r > 1.0) r = 1.0;

  return (ux * vy < uy * vx ? -1.0 : 1.0) * Math.acos(r);
}

/**
 * `nsvg__pathArcTo`, the endpoint-to-centre conversion from canvg.
 *
 * The arc is split into `ndivs = trunc( |Δθ| / (π/2) + 1 )` cubic segments —
 * at most 90° each — with the handle length `κ = |4/3 · (1 − cos(Δθ/2ndivs)) /
 * sin(Δθ/2ndivs)|`, signed by the sweep direction. That count is the whole of
 * the "how many curves does an arc become" question, and it is a *fixed*
 * subdivision, not an adaptive one: radius does not enter it.
 */
function pathArcTo(p: NSVGparser, c: PathCursor, args: number[], rel: boolean): void {
  let rx = Math.abs(args[0]!);
  let ry = Math.abs(args[1]!);
  const rotx = (args[2]! / 180.0) * NSVG_PI;
  const fa = Math.abs(args[3]!) > 1e-6 ? 1 : 0;
  const fs = Math.abs(args[4]!) > 1e-6 ? 1 : 0;
  const x1 = c.cpx;
  const y1 = c.cpy;

  let x2: number;
  let y2: number;

  if (rel) {
    x2 = c.cpx + args[5]!;
    y2 = c.cpy + args[6]!;
  } else {
    x2 = args[5]!;
    y2 = args[6]!;
  }

  let dx = x1 - x2;
  let dy = y1 - y2;
  let d = Math.sqrt(dx * dx + dy * dy);

  if (d < 1e-6 || rx < 1e-6 || ry < 1e-6) {
    // The arc degenerates to a line.
    p.lineTo(x2, y2);
    c.cpx = x2;
    c.cpy = y2;
    return;
  }

  const sinrx = Math.sin(rotx);
  const cosrx = Math.cos(rotx);

  const x1p = (cosrx * dx) / 2.0 + (sinrx * dy) / 2.0;
  const y1p = (-sinrx * dx) / 2.0 + (cosrx * dy) / 2.0;

  d = sqr(x1p) / sqr(rx) + sqr(y1p) / sqr(ry);

  if (d > 1) {
    d = Math.sqrt(d);
    rx *= d;
    ry *= d;
  }

  let s = 0.0;
  let sa = sqr(rx) * sqr(ry) - sqr(rx) * sqr(y1p) - sqr(ry) * sqr(x1p);
  const sb = sqr(rx) * sqr(y1p) + sqr(ry) * sqr(x1p);

  if (sa < 0.0) sa = 0.0;
  if (sb > 0.0) s = Math.sqrt(sa / sb);
  if (fa === fs) s = -s;

  const cxp = (s * rx * y1p) / ry;
  const cyp = (s * -ry * x1p) / rx;

  const cx = (x1 + x2) / 2.0 + cosrx * cxp - sinrx * cyp;
  const cy = (y1 + y2) / 2.0 + sinrx * cxp + cosrx * cyp;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const a1 = vecang(1.0, 0.0, ux, uy);
  let da = vecang(ux, uy, vx, vy);

  if (fs === 0 && da > 0) da -= 2 * NSVG_PI;
  else if (fs === 1 && da < 0) da += 2 * NSVG_PI;

  const t: Xform = [cosrx, sinrx, -sinrx, cosrx, cx, cy];

  // The loop runs once per end point, start and end included, hence the +1.
  const ndivs = Math.trunc(Math.abs(da) / (NSVG_PI * 0.5) + 1.0);
  const hda = da / ndivs / 2.0;
  let kappa = Math.abs(((4.0 / 3.0) * (1.0 - Math.cos(hda))) / Math.sin(hda));

  if (da < 0.0) kappa = -kappa;

  let px = 0;
  let py = 0;
  let ptanx = 0;
  let ptany = 0;

  for (let i = 0; i <= ndivs; i++) {
    const a = a1 + da * (i / ndivs);

    dx = Math.cos(a);
    dy = Math.sin(a);

    const [x, y] = xformPoint(dx * rx, dy * ry, t);
    const [tanx, tany] = xformVec(-dy * rx * kappa, dx * ry * kappa, t);

    if (i > 0) p.cubicBezTo(px + ptanx, py + ptany, x - tanx, y - tany, x, y);

    px = x;
    py = y;
    ptanx = tanx;
    ptany = tany;
  }

  c.cpx = x2;
  c.cpy = y2;
}

/**
 * `nsvg__parsePath`. `class` is applied in a first pass so that a presentation
 * attribute on the element itself still wins over the class's declaration.
 */
function parsePath(p: NSVGparser, attr: string[]): void {
  let s: string | null = null;

  for (let i = 0; i < attr.length; i += 2) {
    if (attr[i] === 'class') parseAttribs(p, [attr[i]!, attr[i + 1]!]);
  }

  for (let i = 0; i < attr.length; i += 2) {
    if (attr[i] === 'd') s = attr[i + 1]!;
    else if (attr[i] !== 'class') parseAttribs(p, [attr[i]!, attr[i + 1]!]);
  }

  if (s !== null) {
    p.resetPath();

    const c: PathCursor = { cpx: 0, cpy: 0, cpx2: 0, cpy2: 0 };
    let cmd = '\0';
    let args: number[] = [];
    let rargs = 0;
    let closedFlag = false;
    let pos = 0;

    while (pos < s.length) {
      const item = getNextPathItem(s, pos);

      pos = item.next;

      if (item.it.length === 0) break;

      if (isnum(item.it[0]!)) {
        if (args.length < 10) args.push(nsvgAtof(item.it));

        if (args.length >= rargs) {
          switch (cmd) {
            case 'm':
            case 'M':
              pathMoveTo(p, c, args, cmd === 'm');
              // A moveto's extra coordinate pairs are linetos.
              cmd = cmd === 'm' ? 'l' : 'L';
              rargs = getArgsPerElement(cmd);
              c.cpx2 = c.cpx;
              c.cpy2 = c.cpy;
              break;
            case 'l':
            case 'L':
              pathLineTo(p, c, args, cmd === 'l');
              c.cpx2 = c.cpx;
              c.cpy2 = c.cpy;
              break;
            case 'H':
            case 'h':
              pathHLineTo(p, c, args, cmd === 'h');
              c.cpx2 = c.cpx;
              c.cpy2 = c.cpy;
              break;
            case 'V':
            case 'v':
              pathVLineTo(p, c, args, cmd === 'v');
              c.cpx2 = c.cpx;
              c.cpy2 = c.cpy;
              break;
            case 'C':
            case 'c':
              pathCubicBezTo(p, c, args, cmd === 'c');
              break;
            case 'S':
            case 's':
              pathCubicBezShortTo(p, c, args, cmd === 's');
              break;
            case 'Q':
            case 'q':
              pathQuadBezTo(p, c, args, cmd === 'q');
              break;
            case 'T':
            case 't':
              pathQuadBezShortTo(p, c, args, cmd === 't');
              break;
            case 'A':
            case 'a':
              pathArcTo(p, c, args, cmd === 'a');
              c.cpx2 = c.cpx;
              c.cpy2 = c.cpy;
              break;
            default:
              // Coordinates with no command: the last pair becomes the current
              // point and nothing is drawn.
              if (args.length >= 2) {
                c.cpx = args[args.length - 2]!;
                c.cpy = args[args.length - 1]!;
                c.cpx2 = c.cpx;
                c.cpy2 = c.cpy;
              }
              break;
          }

          args = [];
        }
      } else {
        cmd = item.it[0]!;
        rargs = getArgsPerElement(cmd);

        if (cmd === 'M' || cmd === 'm') {
          if (p.npts > 0) p.addPath(closedFlag);

          p.resetPath();
          closedFlag = false;
          args = [];
        } else if (cmd === 'Z' || cmd === 'z') {
          closedFlag = true;

          if (p.npts > 0) {
            // The current point returns to the sub-path's start.
            c.cpx = p.pts[0]!;
            c.cpy = p.pts[1]!;
            c.cpx2 = c.cpx;
            c.cpy2 = c.cpy;
            p.addPath(closedFlag);
          }

          p.resetPath();
          p.moveTo(c.cpx, c.cpy);
          closedFlag = false;
          args = [];
        }
      }
    }

    if (p.npts > 0) p.addPath(closedFlag);
  }

  p.addShape();
}

/**
 * `nsvg__parseRect`.
 *
 * The sharp-versus-rounded test is `rx < 0.00001 || ry < 0.0001` — two
 * different epsilons, an upstream typo. Reproduced: a rect with
 * `ry` between 1e-5 and 1e-4 draws sharp corners where the SVG asks for
 * (imperceptibly) round ones.
 */
function parseRect(p: NSVGparser, attr: string[]): void {
  let x = 0.0;
  let y = 0.0;
  let w = 0.0;
  let h = 0.0;
  let rx = -1.0; // marks not set
  let ry = -1.0;

  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'x') x = parseCoordinate(p, value, p.actualOrigX(), p.actualWidth());
      if (name === 'y') y = parseCoordinate(p, value, p.actualOrigY(), p.actualHeight());
      if (name === 'width') w = parseCoordinate(p, value, 0.0, p.actualWidth());
      if (name === 'height') h = parseCoordinate(p, value, 0.0, p.actualHeight());
      if (name === 'rx') rx = Math.abs(parseCoordinate(p, value, 0.0, p.actualWidth()));
      if (name === 'ry') ry = Math.abs(parseCoordinate(p, value, 0.0, p.actualHeight()));
    }
  }

  if (rx < 0.0 && ry > 0.0) rx = ry;
  if (ry < 0.0 && rx > 0.0) ry = rx;
  if (rx < 0.0) rx = 0.0;
  if (ry < 0.0) ry = 0.0;
  if (rx > w / 2.0) rx = w / 2.0;
  if (ry > h / 2.0) ry = h / 2.0;

  if (w !== 0.0 && h !== 0.0) {
    p.resetPath();

    if (rx < 0.00001 || ry < 0.0001) {
      p.moveTo(x, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w, y + h);
      p.lineTo(x, y + h);
    } else {
      const k = 1 - NSVG_KAPPA90;

      p.moveTo(x + rx, y);
      p.lineTo(x + w - rx, y);
      p.cubicBezTo(x + w - rx * k, y, x + w, y + ry * k, x + w, y + ry);
      p.lineTo(x + w, y + h - ry);
      p.cubicBezTo(x + w, y + h - ry * k, x + w - rx * k, y + h, x + w - rx, y + h);
      p.lineTo(x + rx, y + h);
      p.cubicBezTo(x + rx * k, y + h, x, y + h - ry * k, x, y + h - ry);
      p.lineTo(x, y + ry);
      p.cubicBezTo(x, y + ry * k, x + rx * k, y, x + rx, y);
    }

    p.addPath(true);
    p.addShape();
  }
}

/** `nsvg__parseCircle`: four `KAPPA90` cubics, clockwise from `(cx + r, cy)`. */
function parseCircle(p: NSVGparser, attr: string[]): void {
  let cx = 0.0;
  let cy = 0.0;
  let r = 0.0;

  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'cx') cx = parseCoordinate(p, value, p.actualOrigX(), p.actualWidth());
      if (name === 'cy') cy = parseCoordinate(p, value, p.actualOrigY(), p.actualHeight());
      if (name === 'r') r = Math.abs(parseCoordinate(p, value, 0.0, p.actualLength()));
    }
  }

  if (r > 0.0) {
    p.resetPath();

    const k = NSVG_KAPPA90;

    p.moveTo(cx + r, cy);
    p.cubicBezTo(cx + r, cy + r * k, cx + r * k, cy + r, cx, cy + r);
    p.cubicBezTo(cx - r * k, cy + r, cx - r, cy + r * k, cx - r, cy);
    p.cubicBezTo(cx - r, cy - r * k, cx - r * k, cy - r, cx, cy - r);
    p.cubicBezTo(cx + r * k, cy - r, cx + r, cy - r * k, cx + r, cy);

    p.addPath(true);
    p.addShape();
  }
}

/** `nsvg__parseEllipse`. */
function parseEllipse(p: NSVGparser, attr: string[]): void {
  let cx = 0.0;
  let cy = 0.0;
  let rx = 0.0;
  let ry = 0.0;

  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'cx') cx = parseCoordinate(p, value, p.actualOrigX(), p.actualWidth());
      if (name === 'cy') cy = parseCoordinate(p, value, p.actualOrigY(), p.actualHeight());
      if (name === 'rx') rx = Math.abs(parseCoordinate(p, value, 0.0, p.actualWidth()));
      if (name === 'ry') ry = Math.abs(parseCoordinate(p, value, 0.0, p.actualHeight()));
    }
  }

  if (rx > 0.0 && ry > 0.0) {
    p.resetPath();

    const k = NSVG_KAPPA90;

    p.moveTo(cx + rx, cy);
    p.cubicBezTo(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry);
    p.cubicBezTo(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy);
    p.cubicBezTo(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry);
    p.cubicBezTo(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy);

    p.addPath(true);
    p.addShape();
  }
}

/** `nsvg__parseLine`. A `<line>` with no attributes is a zero-length line. */
function parseLine(p: NSVGparser, attr: string[]): void {
  let x1 = 0.0;
  let y1 = 0.0;
  let x2 = 0.0;
  let y2 = 0.0;

  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'x1') x1 = parseCoordinate(p, value, p.actualOrigX(), p.actualWidth());
      if (name === 'y1') y1 = parseCoordinate(p, value, p.actualOrigY(), p.actualHeight());
      if (name === 'x2') x2 = parseCoordinate(p, value, p.actualOrigX(), p.actualWidth());
      if (name === 'y2') y2 = parseCoordinate(p, value, p.actualOrigY(), p.actualHeight());
    }
  }

  p.resetPath();
  p.moveTo(x1, y1);
  p.lineTo(x2, y2);
  p.addPath(false);
  p.addShape();
}

/** `nsvg__parsePoly`, shared by `<polyline>` and `<polygon>`. */
function parsePoly(p: NSVGparser, attr: string[], closeFlag: boolean): void {
  p.resetPath();

  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'points') {
        const args: number[] = [];
        let npts = 0;
        let pos = 0;

        while (pos < value.length) {
          const item = getNextPathItem(value, pos);

          pos = item.next;
          args.push(nsvgAtof(item.it));

          if (args.length >= 2) {
            if (npts === 0) p.moveTo(args[0]!, args[1]!);
            else p.lineTo(args[0]!, args[1]!);

            args.length = 0;
            npts++;
          }
        }
      }
    }
  }

  p.addPath(closeFlag);
  p.addShape();
}

/** `nsvg__parseSVG`: the root's `width`, `height`, `viewBox` and alignment. */
function parseSVG(p: NSVGparser, attr: string[]): void {
  for (let i = 0; i < attr.length; i += 2) {
    const name = attr[i]!;
    const value = attr[i + 1]!;

    if (!parseAttr(p, name, value)) {
      if (name === 'width') {
        p.image.width = parseCoordinate(p, value, 0.0, 0.0);
      } else if (name === 'height') {
        p.image.height = parseCoordinate(p, value, 0.0, 0.0);
      } else if (name === 'viewBox') {
        // sscanf( "%f%*[%%, \t]%f%*[%%, \t]%f%*[%%, \t]%f" ) — a failed field
        // leaves the corresponding member at whatever it already held.
        let pos = 0;
        const out = [p.viewMinx, p.viewMiny, p.viewWidth, p.viewHeight];

        for (let f = 0; f < 4; f++) {
          if (f > 0) {
            const sep = scanSet(value, pos, '%, \t');

            if (!sep) break;

            pos = sep.next;
          }

          const num = scanFloat(value, pos);

          if (!num) break;

          out[f] = num.value;
          pos = num.next;
        }

        p.viewMinx = out[0]!;
        p.viewMiny = out[1]!;
        p.viewWidth = out[2]!;
        p.viewHeight = out[3]!;
      } else if (name === 'preserveAspectRatio') {
        if (value.includes('none')) {
          p.alignType = NSVG_ALIGN_NONE;
        } else {
          if (value.includes('xMin')) p.alignX = NSVG_ALIGN_MIN;
          else if (value.includes('xMid')) p.alignX = NSVG_ALIGN_MID;
          else if (value.includes('xMax')) p.alignX = NSVG_ALIGN_MAX;

          if (value.includes('yMin')) p.alignY = NSVG_ALIGN_MIN;
          else if (value.includes('yMid')) p.alignY = NSVG_ALIGN_MID;
          else if (value.includes('yMax')) p.alignY = NSVG_ALIGN_MAX;

          p.alignType = value.includes('slice') ? NSVG_ALIGN_SLICE : NSVG_ALIGN_MEET;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// element dispatch
// ---------------------------------------------------------------------------

function startElement(p: NSVGparser, el: string, attr: string[]): void {
  if (p.defsFlag) {
    // Inside <defs> only gradients and styles are looked at. Gradients are a
    // documented gap, so only <style> has an effect here.
    if (el === 'style') p.styleFlag = true;

    return;
  }

  if (el === 'g') {
    p.pushAttr();
    parseAttribs(p, attr);
  } else if (el === 'path') {
    // `pathFlag` is never set upstream, so this guard never fires.
    if (p.pathFlag) return;

    p.pushAttr();
    parsePath(p, attr);
    p.popAttr();
  } else if (el === 'rect') {
    p.pushAttr();
    parseRect(p, attr);
    p.popAttr();
  } else if (el === 'circle') {
    p.pushAttr();
    parseCircle(p, attr);
    p.popAttr();
  } else if (el === 'ellipse') {
    p.pushAttr();
    parseEllipse(p, attr);
    p.popAttr();
  } else if (el === 'line') {
    p.pushAttr();
    parseLine(p, attr);
    p.popAttr();
  } else if (el === 'polyline') {
    p.pushAttr();
    parsePoly(p, attr, false);
    p.popAttr();
  } else if (el === 'polygon') {
    p.pushAttr();
    parsePoly(p, attr, true);
    p.popAttr();
  } else if (el === 'defs') {
    p.defsFlag = true;
  } else if (el === 'svg') {
    parseSVG(p, attr);
  } else if (el === 'style') {
    p.styleFlag = true;
  }
  // linearGradient / radialGradient / stop: documented gap, ignored.
}

function endElement(p: NSVGparser, el: string): void {
  if (el === 'g') p.popAttr();
  else if (el === 'path') p.pathFlag = false;
  else if (el === 'defs') p.defsFlag = false;
  else if (el === 'style') p.styleFlag = false;
}

/**
 * `nsvg__content`: the body of a `<style>` element.
 *
 * A three-state scan that only ever recognises `.class` selectors — anything
 * else is collected as a name and then thrown away because it does not start
 * with a dot. Several comma-separated selectors share one declaration block.
 */
function content(p: NSVGparser, text: string): void {
  if (!p.styleFlag) return;

  let state = 0;
  let classCount = 0;
  let start = 0;
  let s = 0;

  while (s < text.length) {
    const c = text[s]!;

    if (state === 2) {
      if (c === '{') {
        start = s + 1;
      } else if (c === '}') {
        // The most recent `classCount` styles share this declaration block.
        for (let i = 0; i < classCount; i++) p.styles[i]!.description = text.slice(start, s);

        classCount = 0;
        state = 0;
      }
    } else if (isspace(c) || c === '{' || c === ',') {
      if (state === 1) {
        if (text[start] === '.') {
          p.styles.unshift({ name: text.slice(start, s), description: null });
          ++classCount;
        }

        start = s + 1;
        state = c === ',' ? 0 : 2;
      }
    } else if (state === 0) {
      start = s;
      state = 1;
    }

    s++;
  }
}

// ---------------------------------------------------------------------------
// viewBox / unit scaling
// ---------------------------------------------------------------------------

function imageBounds(p: NSVGparser): NSVGbounds {
  if (p.image.shapes.length === 0) return [0, 0, 0, 0];

  const bounds: NSVGbounds = [...p.image.shapes[0]!.bounds];

  for (const shape of p.image.shapes.slice(1)) {
    bounds[0] = Math.min(bounds[0], shape.bounds[0]);
    bounds[1] = Math.min(bounds[1], shape.bounds[1]);
    bounds[2] = Math.max(bounds[2], shape.bounds[2]);
    bounds[3] = Math.max(bounds[3], shape.bounds[3]);
  }

  return bounds;
}

function viewAlign(contentSize: number, container: number, type: number): number {
  if (type === NSVG_ALIGN_MIN) return 0;
  if (type === NSVG_ALIGN_MAX) return container - contentSize;

  return (container - contentSize) * 0.5;
}

/**
 * `nsvg__scaleToViewbox`, the pass that makes the output usable.
 *
 * It does three jobs at once and they are not separable: it fills in whichever
 * of `width`/`height`/`viewBox` the document left out, it maps the viewBox onto
 * the image box honouring `preserveAspectRatio`, and it converts to the unit
 * the caller asked for. That last step is why the plugin gets millimetres —
 * `us = 1 / convertToPixels( 1 mm )` = 25.4/96 at 96 dpi.
 */
function scaleToViewbox(p: NSVGparser, units: string): void {
  const bounds = imageBounds(p);
  let updw = false;
  let updh = false;

  if (p.viewWidth === 0) {
    if (p.image.width > 0) {
      p.viewWidth = p.image.width;
    } else {
      p.viewMinx = bounds[0];
      p.viewWidth = bounds[2] - bounds[0];
    }
  }

  if (p.viewHeight === 0) {
    if (p.image.height > 0) {
      p.viewHeight = p.image.height;
    } else {
      p.viewMiny = bounds[1];
      p.viewHeight = bounds[3] - bounds[1];
    }
  }

  if (p.image.width === 0) {
    p.image.width = p.viewWidth;
    updw = true;
  }

  if (p.image.height === 0) {
    p.image.height = p.viewHeight;
    updh = true;
  }

  let tx = -p.viewMinx;
  let ty = -p.viewMiny;
  let sx = p.viewWidth > 0 ? p.image.width / p.viewWidth : 0;
  let sy = p.viewHeight > 0 ? p.image.height / p.viewHeight : 0;
  const us = 1.0 / p.convertToPixels(nsvgCoord(1.0, parseUnits(units)), 0.0, 1.0);

  if (p.alignType === NSVG_ALIGN_MEET) {
    // Fit the whole image into the viewbox.
    sx = sy = Math.min(sx, sy);

    if (updw) p.image.width = p.viewWidth * sx;
    if (updh) p.image.height = p.viewHeight * sy;

    tx += viewAlign(p.viewWidth * sx, p.image.width, p.alignX) / sx;
    ty += viewAlign(p.viewHeight * sy, p.image.height, p.alignY) / sy;
  } else if (p.alignType === NSVG_ALIGN_SLICE) {
    // Fill the whole viewbox with the image.
    sx = sy = Math.max(sx, sy);

    if (updw) p.image.width = p.viewWidth * sx;
    if (updh) p.image.height = p.viewHeight * sy;

    tx += viewAlign(p.viewWidth * sx, p.image.width, p.alignX) / sx;
    ty += viewAlign(p.viewHeight * sy, p.image.height, p.alignY) / sy;
  }

  sx *= us;
  sy *= us;

  const avgs = (sx + sy) / 2.0;

  for (const shape of p.image.shapes) {
    shape.bounds[0] = (shape.bounds[0] + tx) * sx;
    shape.bounds[1] = (shape.bounds[1] + ty) * sy;
    shape.bounds[2] = (shape.bounds[2] + tx) * sx;
    shape.bounds[3] = (shape.bounds[3] + ty) * sy;

    for (const path of shape.paths) {
      path.bounds[0] = (path.bounds[0] + tx) * sx;
      path.bounds[1] = (path.bounds[1] + ty) * sy;
      path.bounds[2] = (path.bounds[2] + tx) * sx;
      path.bounds[3] = (path.bounds[3] + ty) * sy;

      for (let i = 0; i < path.npts; i++) {
        path.pts[i * 2] = (path.pts[i * 2]! + tx) * sx;
        path.pts[i * 2 + 1] = (path.pts[i * 2 + 1]! + ty) * sy;
      }
    }

    shape.strokeWidth *= avgs;
    shape.strokeDashOffset *= avgs;

    for (let i = 0; i < shape.strokeDashCount; i++)
      shape.strokeDashArray[i] = shape.strokeDashArray[i]! * avgs;
  }
}

/**
 * `nsvgParse`. `units` is one of `px`, `pt`, `pc`, `mm`, `cm`, `in`; `dpi`
 * decides how the physical ones relate to user units.
 */
export function nsvgParse(input: string, units: string, dpi: number): NSVGimage {
  const p = new NSVGparser();

  p.dpi = dpi;

  parseXML(
    input,
    (el, attr) => startElement(p, el, attr),
    (el) => endElement(p, el),
    (s) => content(p, s),
  );

  scaleToViewbox(p, units);

  return p.image;
}
