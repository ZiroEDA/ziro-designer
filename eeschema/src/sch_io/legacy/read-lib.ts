// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The legacy `.lib` symbol library reader — `SCH_IO_KICAD_LEGACY_LIB_CACHE`
 * (`eeschema/sch_io/kicad_legacy/sch_io_kicad_legacy_lib_cache.cpp`).
 *
 * This is the KiCad 4/5 symbol format: a line-oriented file of `DEF … ENDDEF`
 * blocks, coordinates in mils, +Y up. We read it for exactly one reason — a
 * project's `<project>-cache.lib` is what the Project Rescue Helper compares a
 * schematic against (`PROJECT_SCH::LegacySchLibs`), and without it three of
 * Rescue's four arms can never fire. It is not an import path: nothing here
 * writes the format back, and a `.lib` is never a library you can place from.
 *
 * ## Why it produces s-expressions rather than a model
 *
 * The obvious port builds `LibSymbol` objects directly. That would be a SECOND
 * construction path for the same model — a second place to get the Y inversion
 * wrong, a second set of defaults to drift, and every item in the model carries
 * a `source: SList` that a legacy file has nothing to put in.
 *
 * So this translates legacy tokens into the `(kicad_symbol_lib …)` node the
 * existing reader already consumes, and hands it to `readSymbolLib`. That is
 * also what upstream effectively does with the format — the two caches build
 * the same `LIB_SYMBOL` — and it means every rule about how a symbol becomes a
 * model stays stated once.
 *
 * ## The one conversion
 *
 * Legacy stores mils with +Y up, and negates on read:
 *
 *     pos.y = -schIUScale.MilsToIU( parseInt( … ) );
 *
 * The s-expression format also stores +Y up, and OUR reader negates it the same
 * way (`readPoint`'s `invertY`). So the whole coordinate conversion is
 * mils → mm, with no sign flip anywhere: 1 mil is 254 IU and 1 mm is 10000 IU,
 * both exact, so nothing is lost on the way through.
 */

import { atom, list, str, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { fx, fy, kiRound, mil, mm, ParseError, Scanner } from './parse.js';
import { convertToNewOverbarNotation } from '@ziroeda/common/src/string_utils.js';
import { GENERATOR, GENERATOR_VERSION } from '@ziroeda/common/src/generator.js';
import type { Reporter } from '@ziroeda/common/src/reporter.js';
import type { LibSymbol } from '../../types.js';
import { readSymbolLib } from '../sexpr/read-schematic.js';

// ---------------------------------------------------------------------------
// Geometry the arc needs — trigo.cpp / eda_shape.cpp
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

/** `EDA_ANGLE::Normalize()`, into [0, 360). */
function normalizeDeg(a: number): number {
  let v = a % 360;
  if (v < 0) v += 360;
  return v;
}

/** `NORMALIZE_ANGLE_POS` on tenths of a degree, into [0, 3600). */
function normalizeTenths(a: number): number {
  let v = a % 3600;
  if (v < 0) v += 3600;
  return v;
}

/**
 * `RotatePoint( VECTOR2I&, const VECTOR2I& aCentre, const EDA_ANGLE& )`, with
 * upstream's exact special cases at the quadrants — they exist so a right-angle
 * rotation is lossless, and dropping them moves points by an IU.
 */
function rotatePoint(p: Pt, c: Pt, angleDeg: number): Pt {
  const a = normalizeDeg(angleDeg);
  const x = p.x - c.x;
  const y = p.y - c.y;
  let rx: number;
  let ry: number;
  if (a === 0) {
    rx = x;
    ry = y;
  } else if (a === 90) {
    rx = y;
    ry = -x;
  } else if (a === 180) {
    rx = -x;
    ry = -y;
  } else if (a === 270) {
    rx = -y;
    ry = x;
  } else {
    const s = Math.sin((a * Math.PI) / 180);
    const co = Math.cos((a * Math.PI) / 180);
    rx = kiRound(y * s + x * co);
    ry = kiRound(y * co - x * s);
  }
  return { x: rx + c.x, y: ry + c.y };
}

/** `EDA_SHAPE::CalcArcAngles` then `endAngle - startAngle`. */
function arcAngle(start: Pt, end: Pt, centre: Pt): number {
  const deg = (p: Pt): number => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  const startAngle = deg(start);
  let endAngle = deg(end);
  if (endAngle === startAngle) endAngle = startAngle + 360;
  while (endAngle < startAngle) endAngle += 360;
  return endAngle - startAngle;
}

/** `EDA_SHAPE::GetArcMid()` for an arc that has no cached mid yet. */
const arcMid = (start: Pt, end: Pt, centre: Pt): Pt =>
  rotatePoint(start, centre, -arcAngle(start, end, centre) / 2);

/**
 * `MapAnglesV6` (`sch_io_kicad_legacy_lib_cache.cpp:786-843`), verbatim.
 *
 * Its comment is worth keeping: "This function based on version 6.0 is required
 * for reading legacy arcs. Changing it in any way will likely break arcs." The
 * old format overdefines the arc — centre, radius, both angles AND both
 * endpoints — and the old renderer always drew counter-clockwise, so the
 * endpoints have to be swapped in exactly the cases this decides.
 *
 * @returns whether the caller must swap the arc's start and end.
 */
function mapAnglesV6(a1: number, a2: number): boolean {
  const deciRad = (deci: number): number => (deci * Math.PI) / 1800;
  const toDeci = (rad: number): number => kiRound((rad * 1800) / Math.PI);

  let angle1 = a1;
  let angle2 = a2;
  const delta = angle2 - angle1;

  if (delta >= 1800) {
    angle1 -= 1;
    angle2 += 1;
  }

  angle1 = toDeci(Math.atan2(-Math.sin(deciRad(angle1)), Math.cos(deciRad(angle1))));
  angle2 = toDeci(Math.atan2(-Math.sin(deciRad(angle2)), Math.cos(deciRad(angle2))));

  angle1 = normalizeTenths(angle1);
  angle2 = normalizeTenths(angle2);

  if (angle2 < angle1) angle2 += 3600;

  if (angle2 - angle1 > 1800) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Token tables
// ---------------------------------------------------------------------------

/** `loadPin`'s electrical type letters, then `getPinTypeToken`'s names. */
const PIN_TYPE: Record<string, string> = {
  I: 'input',
  O: 'output',
  B: 'bidirectional',
  T: 'tri_state',
  P: 'passive',
  U: 'unspecified',
  W: 'power_in',
  w: 'power_out',
  C: 'open_collector',
  E: 'open_emitter',
  N: 'no_connect',
};

/** `getPinAngle( PIN_ORIENTATION )` (`sch_io_kicad_sexpr_common.cpp:156`). */
const PIN_ANGLE: Record<string, number> = { R: 0, L: 180, U: 90, D: 270 };

/** The pin-shape flag combinations `loadPin` accepts, as the sexpr tokens
 *  `getPinShapeToken` writes. The bits are INVERTED 1, CLOCK 2, LOWLEVEL_IN 4,
 *  LOWLEVEL_OUT 8, FALLING_EDGE 16, NONLOGIC 32. */
const PIN_SHAPE: Record<number, string> = {
  0: 'line',
  1: 'inverted',
  2: 'clock',
  3: 'inverted_clock',
  4: 'input_low',
  6: 'clock_low',
  8: 'output_low',
  16: 'edge_clock_high',
  32: 'non_logic',
};

/** `parseFillMode` (`:767`), as the `(fill (type …))` tokens. */
const FILL: Record<string, string> = { F: 'outline', f: 'background', N: 'none' };

// ---------------------------------------------------------------------------
// Node builders
// ---------------------------------------------------------------------------

const point = (name: string, x: number, y: number): SList =>
  list(atom(name), atom(fx(x)), atom(fy(y)));

/** `STROKE_PARAMS stroke( …, LINE_STYLE::SOLID )` — every legacy shape is
 *  explicitly solid, which the modern format writes as `solid` and not as the
 *  `default` a `.kicad_sym` uses for "whatever the layer says". */
const strokeNode = (widthIU: number): SList =>
  list(atom('stroke'), list(atom('width'), atom(mm(widthIU))), list(atom('type'), atom('solid')));

const fillNode = (token: string): SList => list(atom('fill'), list(atom('type'), atom(token)));

const sizeEffects = (sizeIU: number, extra: SNode[] = []): SList =>
  list(
    atom('effects'),
    list(atom('font'), list(atom('size'), atom(mm(sizeIU)), atom(mm(sizeIU)))),
    ...extra,
  );

// ---------------------------------------------------------------------------
// One drawn item
// ---------------------------------------------------------------------------

/** A body item, with the unit and body style it belongs to. */
interface Drawn {
  unit: number;
  bodyStyle: number;
  node: SList;
}

/** `loadArc` (`:844`). */
function loadArc(s: Scanner): Drawn {
  const centre: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const radius = mil(s.int());
  const angle1 = normalizeTenths(s.int());
  const angle2 = normalizeTenths(s.int());
  const unit = s.int();
  const bodyStyle = s.int();
  const width = mil(s.int());

  let fill = 'none';
  if (!s.atEol()) fill = FILL[s.char()] ?? 'none';

  let start: Pt;
  let end: Pt;
  if (!s.atEol()) {
    start = { x: mil(s.int()), y: -mil(s.int()) };
    end = { x: mil(s.int()), y: -mil(s.int()) };
  } else {
    // "Actual Coordinates of arc ends are not read from file (old library),
    // calculate them" — a point at (radius, 0) turned by each angle.
    start = rotatePoint({ x: centre.x + radius, y: centre.y }, centre, angle1 / 10);
    end = rotatePoint({ x: centre.x + radius, y: centre.y }, centre, angle2 / 10);
  }

  if (mapAnglesV6(angle1, angle2)) {
    const t = start;
    start = end;
    end = t;
  }

  // `SetArcGeometry( GetStart(), GetArcMid(), GetEnd() )`, which upstream calls
  // so a legacy-loaded arc and an s-expression-loaded one hold the same numbers
  // — the comment there says a mismatch shows up as a false ERC symbol
  // mismatch, which is precisely what Rescue must not produce either.
  const midPt = arcMid(start, end, centre);
  return {
    unit,
    bodyStyle,
    node: list(
      atom('arc'),
      point('start', start.x, start.y),
      point('mid', midPt.x, midPt.y),
      point('end', end.x, end.y),
      strokeNode(width),
      fillNode(fill),
    ),
  };
}

/** `loadCircle` (`:931`). */
function loadCircle(s: Scanner): Drawn {
  const centre: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const radius = mil(s.int());
  const unit = s.int();
  const bodyStyle = s.int();
  const width = mil(s.int());
  const fill = s.atEol() ? 'none' : (FILL[s.char()] ?? 'none');
  return {
    unit,
    bodyStyle,
    node: list(
      atom('circle'),
      point('center', centre.x, centre.y),
      list(atom('radius'), atom(mm(radius))),
      strokeNode(width),
      fillNode(fill),
    ),
  };
}

/** `loadRect` (`:1077`). */
function loadRect(s: Scanner): Drawn {
  const start: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const end: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const unit = s.int();
  const bodyStyle = s.int();
  const width = mil(s.int());
  const fill = s.atEol() ? 'none' : (FILL[s.char()] ?? 'none');
  return {
    unit,
    bodyStyle,
    node: list(
      atom('rectangle'),
      point('start', start.x, start.y),
      point('end', end.x, end.y),
      strokeNode(width),
      fillNode(fill),
    ),
  };
}

/** `loadPolyLine` (`:1338`). */
function loadPolyLine(s: Scanner): Drawn {
  const count = s.int();
  const unit = s.int();
  const bodyStyle = s.int();
  const width = mil(s.int());
  const pts: SNode[] = [atom('pts')];
  for (let i = 0; i < count; i++) {
    const x = mil(s.int());
    const y = -mil(s.int());
    pts.push(point('xy', x, y));
  }
  const fill = s.atEol() ? 'none' : (FILL[s.char()] ?? 'none');
  return {
    unit,
    bodyStyle,
    node: list(atom('polyline'), { kind: 'list', items: pts }, strokeNode(width), fillNode(fill)),
  };
}

/** `loadBezier` (`:1370`) — always four control points, or it is not one. */
function loadBezier(s: Scanner): Drawn {
  const count = s.int();
  if (count !== 4) throw new ParseError(`invalid Bezier curve definition: ${s.line}`);
  const unit = s.int();
  const bodyStyle = s.int();
  const width = mil(s.int());
  const pts: SNode[] = [atom('pts')];
  for (let i = 0; i < 4; i++) {
    const x = mil(s.int());
    const y = -mil(s.int());
    pts.push(point('xy', x, y));
  }
  const fill = s.atEol() ? 'none' : (FILL[s.char()] ?? 'none');
  return {
    unit,
    bodyStyle,
    node: list(atom('bezier'), { kind: 'list', items: pts }, strokeNode(width), fillNode(fill)),
  };
}

/** `loadText` (`:963`). */
function loadText(s: Scanner, major: number, minor: number): Drawn {
  const angleTenths = s.int();
  const at: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const size = mil(s.int());
  const visible = s.int() === 0;
  const unit = s.int();
  const bodyStyle = s.int();

  // "If quoted string loading fails, load as not quoted string."
  let text: string;
  if (s.peekQuote()) {
    text = convertToNewOverbarNotation(s.quoted());
  } else {
    // "In old libs, 'spaces' are replaced by '~' in unquoted strings".
    text = s.word(true).replace(/~/g, ' ');
  }
  // "convert two apostrophes back to double quote"
  if (text !== '') text = text.replace(/''/g, '"');

  const extra: SNode[] = [];
  const version = major * 100 + minor;
  if (version > 0 && version > 200 && !s.atEol()) {
    const italic = s.take('Italic');
    if (!italic && !s.take('Normal')) {
      throw new ParseError(`invalid text style, expected 'Normal' or 'Italic': ${s.line}`);
    }
    const bold = s.int() > 0;
    const font: SNode[] = [
      atom('font'),
      list(atom('size'), atom(mm(size)), atom(mm(size))),
      ...(italic ? [list(atom('italic'), atom('yes'))] : []),
      ...(bold ? [list(atom('bold'), atom('yes'))] : []),
    ];
    const justify: SNode[] = [];
    if (!s.atEol()) {
      const H: Record<string, string> = { L: 'left', C: 'center', R: 'right' };
      const V: Record<string, string> = { T: 'top', C: 'center', B: 'bottom' };
      const h = H[s.char()];
      const v = V[s.char()];
      if (h === undefined || v === undefined) {
        throw new ParseError(`invalid text justification: ${s.line}`);
      }
      // `(justify …)` names only what is not centred, as EDA_TEXT::Format does.
      const words = [...(h === 'center' ? [] : [h]), ...(v === 'center' ? [] : [v])];
      if (words.length) justify.push(list(atom('justify'), ...words.map((w) => atom(w))));
    }
    extra.push(
      list(
        atom('effects'),
        { kind: 'list', items: font },
        ...justify,
        ...(visible ? [] : [list(atom('hide'), atom('yes'))]),
      ),
    );
  } else {
    extra.push(sizeEffects(size, visible ? [] : [list(atom('hide'), atom('yes'))]));
  }

  // An invisible one becomes a user SCH_FIELD upstream rather than a SCH_TEXT
  // (`:1010`). The model has no per-unit field, and nothing downstream of the
  // cache library asks: Rescue compares pins, and a hidden text draws as
  // nothing either way.
  return {
    unit,
    bodyStyle,
    node: list(
      atom('text'),
      str(text),
      // Tenths of a degree, not degrees: a symbol's SCH_TEXT is written with
      // `GetTextAngle().AsTenthsOfADegree()`, so a 90-degree text reads `900`
      // here and in every `.kicad_sym` KiCad writes.
      list(atom('at'), atom(fx(at.x)), atom(fy(at.y)), atom(String(angleTenths))),
      ...extra,
    ),
  };
}

/** `loadPin` (`:1113`). */
function loadPin(s: Scanner): Drawn {
  const t = s.tokens();
  if (t.length < 11) throw new ParseError(`invalid pin definition: ${s.line}`);
  const num = (v: string | undefined, what: string): number => {
    const n = Number.parseInt(v ?? '', 10);
    if (Number.isNaN(n)) throw new ParseError(`invalid pin ${what}: ${s.line}`);
    return n;
  };

  const name = t[0]!;
  const number = t[1]!;
  const x = mil(num(t[2], 'X coordinate'));
  const y = -mil(num(t[3], 'Y coordinate'));
  const length = mil(num(t[4], 'length'));
  const orient = t[5]!;
  if (orient.length > 1) throw new ParseError(`invalid pin orientation: ${s.line}`);
  const numberSize = mil(num(t[6], 'number text size'));
  const nameSize = mil(num(t[7], 'name text size'));
  const unit = num(t[8], 'unit');
  const bodyStyle = num(t[9], 'body style');
  const typeLetter = t[10]!;
  if (typeLetter.length !== 1) throw new ParseError(`invalid pin type: ${s.line}`);
  const type = PIN_TYPE[typeLetter];
  if (!type) throw new ParseError(`unknown pin type '${typeLetter}': ${s.line}`);

  // "R: fall-through / default" — anything unrecognised points right.
  const angle = PIN_ANGLE[orient] ?? 0;

  let shape = 'line';
  let hidden = false;
  if (t.length > 11) {
    const attrs = t[11]!;
    let flags = 0;
    for (const c of attrs) {
      switch (c) {
        case '~':
          break;
        case 'N':
          hidden = true;
          break;
        case 'I':
          flags |= 1;
          break;
        case 'C':
          flags |= 2;
          break;
        case 'L':
          flags |= 4;
          break;
        case 'V':
          flags |= 8;
          break;
        case 'F':
          flags |= 16;
          break;
        case 'X':
          flags |= 32;
          break;
        default:
          throw new ParseError(`invalid pin attribute '${c}': ${s.line}`);
      }
    }
    const mapped = PIN_SHAPE[flags];
    if (mapped === undefined) {
      throw new ParseError(`pin attributes do not define a valid pin shape: ${s.line}`);
    }
    shape = mapped;
  }

  return {
    unit,
    bodyStyle,
    node: list(
      atom('pin'),
      atom(type),
      atom(shape),
      list(atom('at'), atom(fx(x)), atom(fy(y)), atom(String(angle))),
      list(atom('length'), atom(mm(length))),
      ...(hidden ? [list(atom('hide'), atom('yes'))] : []),
      list(atom('name'), str(convertToNewOverbarNotation(name)), sizeEffects(nameSize)),
      list(atom('number'), str(convertToNewOverbarNotation(number)), sizeEffects(numberSize)),
    ),
  };
}

// ---------------------------------------------------------------------------
// A field line
// ---------------------------------------------------------------------------

interface Field {
  index: number;
  name: string;
  node: SList;
}

/**
 * The fixed ids `loadField`'s switch maps — and it maps exactly four. An `F4`
 * line is a USER field with its own name, not a fifth mandatory one.
 */
const LEGACY_FIELDS = ['Reference', 'Value', 'Footprint', 'Datasheet'];

/**
 * `GetCanonicalFieldName` for the mandatory fields a `LIB_SYMBOL` always
 * carries. Description is the fifth, and the legacy format has nowhere to state
 * it — a `.dcm` companion held the description, and that is a separate file we
 * do not read — so it comes through empty and hidden, as it does upstream.
 */
const MANDATORY = [...LEGACY_FIELDS, 'Description'];

/** `loadField` (`:532`). */
function loadField(s: Scanner, valueText: string): Field {
  const index = s.int();
  if (index < 0) throw new ParseError(`invalid field ID: ${s.line}`);

  s.toQuote();
  let text = s.quoted(true);

  // "Doctor the *.lib file field which has a '~' in blank fields."
  if (text === '~') text = '';
  else text = convertToNewOverbarNotation(text);

  const at: Pt = { x: mil(s.int()), y: -mil(s.int()) };
  const size = mil(s.int());

  const orient = s.char();
  if (orient !== 'H' && orient !== 'V') {
    throw new ParseError(`invalid field text orientation parameter: ${s.line}`);
  }
  const angle = orient === 'V' ? 90 : 0;

  const vis = s.char();
  if (vis !== 'V' && vis !== 'I') {
    throw new ParseError(`invalid field text visibility parameter: ${s.line}`);
  }
  const visible = vis === 'V';

  const justify: string[] = [];
  let italic = false;
  let bold = false;

  // "It may be technically correct to use the library version to determine if
  // the field text attributes are present" — upstream tests the line instead.
  if (!s.atEol() && !s.peekQuote()) {
    const H: Record<string, string> = { C: 'center', L: 'left', R: 'right' };
    const h = H[s.char()];
    if (h === undefined) throw new ParseError(`invalid field justification: ${s.line}`);
    if (h !== 'center') justify.push(h);

    const attrs = s.word();
    if (attrs.length !== 1 && attrs.length !== 3) {
      throw new ParseError(`invalid field text attributes size: ${s.line}`);
    }
    const V: Record<string, string> = { C: 'center', B: 'bottom', T: 'top' };
    const v = V[attrs[0]!];
    if (v === undefined) throw new ParseError(`invalid field vertical justification: ${s.line}`);
    if (v !== 'center') justify.push(v);

    if (attrs.length === 3) {
      if (attrs[1] === 'I') italic = true;
      else if (attrs[1] !== 'N') throw new ParseError(`invalid field italic parameter: ${s.line}`);
      if (attrs[2] === 'B') bold = true;
      else if (attrs[2] !== 'N') throw new ParseError(`invalid field bold parameter: ${s.line}`);
    }
  }

  let name = LEGACY_FIELDS[index] ?? '';
  if (name === '') {
    // A user field's name is the optional trailing quoted string.
    name = s.atEol() ? '' : s.quoted(true);
    if (name === '') name = `Field${index}`;
  } else if (index === 1) {
    // "Ensure the VALUE field = the symbol name (can be not the case with
    // malformed libraries: edited by hand, or converted from other tools)".
    text = valueText;
  }

  const font: SNode[] = [
    atom('font'),
    list(atom('size'), atom(mm(size)), atom(mm(size))),
    ...(italic ? [list(atom('italic'), atom('yes'))] : []),
    ...(bold ? [list(atom('bold'), atom('yes'))] : []),
  ];

  return {
    index,
    name,
    node: list(
      atom('property'),
      str(name),
      str(text),
      list(atom('at'), atom(fx(at.x)), atom(fy(at.y)), atom(String(angle))),
      // Every field a legacy symbol produces has the SCH_FIELD defaults for
      // these two, and KiCad writes them on every property it saves.
      list(atom('show_name'), atom('no')),
      list(atom('do_not_autoplace'), atom('no')),
      list(
        atom('effects'),
        { kind: 'list', items: font },
        ...(justify.length ? [list(atom('justify'), ...justify.map((w) => atom(w)))] : []),
        ...(visible ? [] : [list(atom('hide'), atom('yes'))]),
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// One DEF … ENDDEF block
// ---------------------------------------------------------------------------

interface ParsedSymbol {
  /** The `(symbol …)` node. */
  node: SList;
  /** Aliases declared by this symbol, which become derived symbols. */
  aliases: string[];
  name: string;
  /** Everything the symbol was built from, so an alias can be built from it too. */
  parts: SymbolParts;
}

/** `LoadPart` (`:302`). */
function loadPart(
  lines: string[],
  from: number,
  major: number,
  minor: number,
): {
  symbol: ParsedSymbol;
  next: number;
} {
  const defLine = new Scanner(lines[from]!, from + 1);
  if (!defLine.take('DEF')) throw new ParseError(`invalid symbol definition: ${lines[from]}`);
  const t = defLine.tokens();
  if (t.length < 8) throw new ParseError(`invalid symbol definition: ${lines[from]}`);

  // "This fixes a dubious decision to escape LIB_ID characters. Escaped LIB_IDs
  // broke rescue library look up. Legacy LIB_IDs should not be escaped." The
  // unescape is the whole reason the cache lookup can find these names at all.
  const rawName = t[0]!;
  const defName = unescapeLegacyName(rawName);
  const prefix = t[1]!;
  // t[2] is NumOfPins, unused upstream too.
  const pinNameOffset = mil(Number.parseInt(t[3] ?? '0', 10));
  const showPinNumbers = t[4] !== 'N';
  const showPinNames = t[5] !== 'N';
  // t[6] is the unit count, which does not reach the model: a `.kicad_sym`
  // states it only through which `<name>_<unit>_<style>` sub-symbols exist, and
  // the writer emits one per group that has items — so a unit nothing draws in
  // is absent there too.
  const unitsLocked = t[7] === 'L';
  const isPower = t[8] === 'P';

  // "The root alias is added to the alias list by SetName()": a leading '~'
  // means the name without it, and a Value field that is not shown.
  const name = defName.startsWith('~') ? defName.slice(1) : defName;

  const fields: Field[] = [];
  const drawn: Drawn[] = [];
  const aliases: string[] = [];
  let fpFilters: string[] | null = null;

  // The Reference field comes from the DEF prefix until an F0 line says
  // otherwise; "~" means no reference text, and not shown.
  fields.push({
    index: 0,
    name: 'Reference',
    node: list(
      atom('property'),
      str('Reference'),
      str(prefix === '~' ? '' : prefix),
      list(atom('at'), atom('0'), atom('0'), atom('0')),
      sizeEffects(mil(50), prefix === '~' ? [list(atom('hide'), atom('yes'))] : []),
    ),
  });

  let i = from + 1;
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.startsWith('#')) continue;
    const s = new Scanner(raw, i + 1);

    if (s.take('ENDDEF')) {
      i++;
      break;
    }
    if (s.take('Ti')) continue; // "Modification date is ignored."
    if (s.take('ALIAS')) {
      aliases.push(...s.tokens().map(unescapeLegacyName));
      continue;
    }
    if (s.take('$FPLIST')) {
      fpFilters = [];
      for (i++; i < lines.length; i++) {
        const f = new Scanner(lines[i]!, i + 1);
        if (f.take('$ENDFPLIST')) break;
        fpFilters.push(f.word(true));
      }
      continue;
    }
    if (s.take('DRAW')) {
      for (i++; i < lines.length; i++) {
        const d = new Scanner(lines[i]!, i + 1);
        if (d.take('ENDDRAW')) break;
        const kind = lines[i]![0];
        if (kind === undefined || kind === '#' || kind === '\r' || lines[i]!.trim() === '') {
          continue;
        }
        d.take(kind);
        switch (kind) {
          case 'A':
            drawn.push(loadArc(d));
            break;
          case 'C':
            drawn.push(loadCircle(d));
            break;
          case 'T':
            drawn.push(loadText(d, major, minor));
            break;
          case 'S':
            drawn.push(loadRect(d));
            break;
          case 'X':
            drawn.push(loadPin(d));
            break;
          case 'P':
            drawn.push(loadPolyLine(d));
            break;
          case 'B':
            drawn.push(loadBezier(d));
            break;
          default:
            throw new ParseError(`undefined DRAW entry: ${lines[i]}`);
        }
      }
      continue;
    }
    if (raw[0] === 'F') {
      const f = loadField(new Scanner(raw.slice(1), i + 1), name);
      const at = fields.findIndex((e) => e.index === f.index);
      if (at === -1) fields.push(f);
      else fields[at] = f;
    }
  }

  const parts: SymbolParts = {
    fields,
    drawn,
    pinNameOffset,
    showPinNames,
    showPinNumbers,
    isPower,
    unitsLocked,
    valueHiddenByDef: defName.startsWith('~'),
    fpFilters,
  };

  return { symbol: { name, aliases, parts, node: symbolNode(name, parts) }, next: i };
}

/** `UnescapeString` on a legacy name, which upstream applies only when it
 *  changes the name — an unescaped name is left exactly as written. */
function unescapeLegacyName(name: string): string {
  // The escapes a LIB_ID could carry are the `{token}` forms; anything else is
  // returned unchanged, which is what `if( name != UnescapeString( name ) )`
  // amounts to.
  return name.replace(
    /\{(dblquote|quote|lt|gt|backslash|slash|bar|comma|colon|space|dollar|tab|return|brace)\}/g,
    (_, t: string) =>
      ({
        dblquote: '"',
        quote: "'",
        lt: '<',
        gt: '>',
        backslash: '\\',
        slash: '/',
        bar: '|',
        comma: ',',
        colon: ':',
        space: ' ',
        dollar: '$',
        tab: '\t',
        return: '\n',
        brace: '{',
      })[t] ?? _,
  );
}

interface SymbolParts {
  fields: Field[];
  drawn: Drawn[];
  pinNameOffset: number;
  showPinNames: boolean;
  showPinNumbers: boolean;
  isPower: boolean;
  unitsLocked: boolean;
  valueHiddenByDef: boolean;
  fpFilters: string[] | null;
}

/**
 * An `ALIAS` name, as the derived symbol `loadAliases` makes of it.
 *
 *     for( FIELD_T fieldId : MANDATORY_FIELDS ) { *field = *parentField;
 *         if( fieldId == FIELD_T::VALUE ) field->SetText( newAliasName ); }
 *
 * So it takes the parent's mandatory fields WHOLE — position, size, justify,
 * visibility — and changes only the Value's text. Its user fields are not
 * copied; its footprint filters are not stored on it either, but
 * `GetFPFilters()` resolves them through the parent, which is why they come
 * back out when the library is saved.
 */
function aliasNode(parent: string, alias: string, p: SymbolParts): SList {
  const items: SNode[] = [atom('symbol'), str(alias), list(atom('extends'), str(parent))];
  for (let n = 0; n < MANDATORY.length; n++) {
    const f = n < LEGACY_FIELDS.length ? p.fields.find((x) => x.index === n) : undefined;
    if (n === 1) {
      items.push(
        f
          ? ({
              kind: 'list',
              items: f.node.items.map((it, at) => (at === 2 ? str(alias) : it)),
            } as SList)
          : defaultProperty('Value', alias, { hidden: false }),
      );
    } else {
      items.push(f?.node ?? defaultProperty(MANDATORY[n]!, '', { hidden: true }));
    }
  }
  if (p.fpFilters?.length) {
    items.push(defaultProperty('ki_fp_filters', p.fpFilters.join(' '), { hidden: true }));
  }
  return { kind: 'list', items };
}

/** A property the format does not position: origin, default text size, and the
 *  SCH_FIELD defaults KiCad writes on every one. */
function defaultProperty(key: string, value: string, o: { hidden: boolean }): SList {
  return list(
    atom('property'),
    str(key),
    str(value),
    list(atom('at'), atom('0'), atom('0'), atom('0')),
    list(atom('show_name'), atom('no')),
    list(atom('do_not_autoplace'), atom('no')),
    sizeEffects(mil(50), o.hidden ? [list(atom('hide'), atom('yes'))] : []),
  );
}

/** Assemble the `(symbol …)` node the s-expression reader expects. */
function symbolNode(name: string, p: SymbolParts): SList {
  const items: SNode[] = [atom('symbol'), str(name)];

  if (p.isPower) items.push(list(atom('power')));
  // The four part attributes are plain bools on a `LIB_SYMBOL` and default to
  // "not excluded", so a legacy symbol always has them — the format simply has
  // nowhere to say otherwise. Stated here rather than left absent, because
  // absent means "the library never said", which is a different thing:
  // "Update/reset symbol attributes" reads the distinction.
  items.push(
    list(atom('exclude_from_sim'), atom('no')),
    list(atom('in_bom'), atom('yes')),
    list(atom('on_board'), atom('yes')),
    list(atom('in_pos_files'), atom('yes')),
  );
  if (!p.showPinNumbers) items.push(list(atom('pin_numbers'), list(atom('hide'), atom('yes'))));
  items.push(
    list(
      atom('pin_names'),
      list(atom('offset'), atom(mm(p.pinNameOffset))),
      ...(p.showPinNames ? [] : [list(atom('hide'), atom('yes'))]),
    ),
  );

  // Mandatory fields first, in canonical order, then the user ones as written.
  const byIndex = (n: number): Field | undefined => p.fields.find((f) => f.index === n);
  for (let n = 0; n < MANDATORY.length; n++) {
    const f = n < LEGACY_FIELDS.length ? byIndex(n) : undefined;
    items.push(
      f?.node ??
        defaultProperty(MANDATORY[n]!, n === 1 ? name : '', {
          // A DEF name written as `~NAME` hides the value — but only when no F1
          // line follows to say otherwise, because `loadField` sets visibility
          // from the file and runs after the DEF that hid it.
          hidden: n !== 1 || p.valueHiddenByDef,
        }),
    );
  }
  for (const f of p.fields) if (f.index >= LEGACY_FIELDS.length) items.push(f.node);

  // `LockUnits( true )` from the DEF's `L`, which the modern format keeps as a
  // property rather than a token.
  if (p.unitsLocked) items.push(defaultProperty('ki_locked', '', { hidden: false }));

  // Footprint filters live in a property in the modern format
  // (`ki_fp_filters`), which is where `$FPLIST` ends up.
  if (p.fpFilters && p.fpFilters.length) {
    items.push(defaultProperty('ki_fp_filters', p.fpFilters.join(' '), { hidden: true }));
  }

  // One `(symbol "<name>_<unit>_<bodyStyle>" …)` per group that has items, the
  // same grouping `SCH_IO_KICAD_SEXPR_LIB_CACHE::SaveSymbol` writes. A unit the
  // DEF counted but nothing draws in gets no node, exactly as there.
  const groups = new Map<string, Drawn[]>();
  for (const d of p.drawn) {
    const key = `${d.unit}_${d.bodyStyle}`;
    const at = groups.get(key);
    if (at) at.push(d);
    else groups.set(key, [d]);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const [au, ac] = a.split('_').map(Number) as [number, number];
    const [bu, bc] = b.split('_').map(Number) as [number, number];
    return au - bu || ac - bc;
  });
  for (const key of order) {
    items.push({
      kind: 'list',
      items: [atom('symbol'), str(`${name}_${key}`), ...groups.get(key)!.map((d) => d.node)],
    });
  }

  return { kind: 'list', items };
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** The header's version, and whether the file is one we can read at all. */
function loadHeader(line: string): { major: number; minor: number } {
  const s = new Scanner(line, 1);
  if (!s.take('EESchema-LIBRARY Version') && !s.take('EESchema-LIB Version')) {
    // `strCompare` needs a whole token, and this header is three words; take a
    // prefix match instead, the way the C++ does with a literal string.
    if (!/^EESchema-LIB(RARY)? Version/i.test(line.trim())) {
      throw new ParseError('file is not a valid symbol or symbol library file');
    }
  }
  const m = /Version\s+(\d+)([./])(\d+)/i.exec(line);
  if (!m) throw new ParseError('invalid file version formatting in header');
  // "Some old libraries use a version syntax like
  //  EESchema-LIBRARY Version  2/10/2006-18:49:15 — use 2.3 to read the file."
  if (m[2] === '/') return { major: 2, minor: 3 };
  const major = Number.parseInt(m[1]!, 10);
  const minor = Number.parseInt(m[3]!, 10);
  if (major < 1 || minor < 0 || minor > 99) {
    throw new ParseError('invalid file version in header');
  }
  return { major, minor };
}

/**
 * `LEGACY_SYMBOL_LIBS::CacheName` (`legacy_symbol_library.cpp:485-503`): the
 * names a project's cache library can have, newest first.
 *
 * `LoadAllLibraries` adds this one unconditionally — "add the special cache
 * library" — which is why `PROJECT_SCH::LegacySchLibs` has it even on a project
 * the symbol library table serves, and therefore why the Project Rescue Helper
 * can still compare against a cache on a modern schematic.
 */
export function legacyCacheFileNames(projectFileName: string): string[] {
  const base = projectFileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  // The `.lib` extension is `FILEEXT::LegacySymbolLibFileExtension`; the second
  // form is the 2007 spelling upstream still falls back to.
  return [`${base}-cache.lib`, `${base}.cache.lib`];
}

/**
 * Read a legacy `.lib` symbol library.
 *
 * Throws on a file that is not one — the caller decides whether a project's
 * cache library being unreadable is worth reporting. A `.dcm` companion is not
 * read: it carries only descriptions and keywords, which Rescue never compares.
 */
export function readLegacySymbolLibrary(text: string, reporter?: Reporter): LibSymbol[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length === 0) throw new ParseError('unexpected end of file');

  const { major, minor } = loadHeader(lines[0] ?? '');

  const nodes: SNode[] = [
    atom('kicad_symbol_lib'),
    list(atom('version'), atom('20241209')),
    list(atom('generator'), str(GENERATOR)),
    list(atom('generator_version'), str(GENERATOR_VERSION)),
  ];

  // `m_symbols` is a `LIB_SYMBOL_MAP`, a `std::map<wxString, LIB_SYMBOL*>`, so
  // the library is held — and written back — in name order rather than file
  // order. An alias sorts among the rest, not beside the symbol it extends.
  const parsed: { name: string; node: SList }[] = [];

  for (let i = 1; i < lines.length; ) {
    const raw = lines[i]!;
    if (raw === '' || raw.startsWith('#') || /^\s/.test(raw)) {
      i++;
      continue;
    }
    if (!new Scanner(raw, i + 1).take('DEF')) {
      i++;
      continue;
    }
    const { symbol, next } = loadPart(lines, i, major, minor);
    parsed.push({ name: symbol.name, node: symbol.node });

    // "ALIAS" makes a symbol of its own whose parent is this one, inheriting
    // the mandatory fields with Value replaced by the alias name.
    for (const alias of symbol.aliases) {
      parsed.push({ name: alias, node: aliasNode(symbol.name, alias, symbol.parts) });
    }
    i = next;
  }

  parsed.sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  for (const p of parsed) nodes.push(p.node);

  return readSymbolLib({ kind: 'list', items: nodes } as SList, reporter);
}
