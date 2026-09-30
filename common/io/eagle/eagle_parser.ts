// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/eagle/eagle_parser.cpp` / `.h`: the Eagle XML document model the
 * board and schematic importers read — one struct per element, each built
 * from its `wxXmlNode` — and the text and coordinate conversions they share.
 *
 * `OPTIONAL_XML_ATTRIBUTE<T>` is `T | undefined` here: an absent or empty
 * attribute is `undefined`, a present one is converted when read (a failed
 * conversion throws `XML_PARSER_ERROR`, as upstream's `Set` does).
 */

import { atoi, strtodPrefix, ToCDoubleOk } from '../../libc/stdlib.js';
import { tan } from '@ziroeda/kimath/src/math/libm.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { IO_ERROR } from '../../exceptions.js';
import type { IO_BASE } from '../io_base.js';
import { RPT_SEVERITY_UNDEFINED, type Severity } from '../../reporter.js';
import {
  convertToNewOverbarNotation,
  RemoveHTMLTags,
  ReplaceIllegalFileNameChars,
} from '../../string_utils.js';
import type { wxXmlNode } from '../../wx/xml.js';

/** `NODE_MAP`: `std::unordered_map<wxString, wxXmlNode*>`. */
export type NODE_MAP = Map<string, wxXmlNode>;

/// Translates Eagle special characters to their counterparts in KiCad.
export function escapeName(aNetName: string): string {
  const ret = aNetName.replaceAll('!', '~');

  return convertToNewOverbarNotation(ret);
}

/// Interprets special characters in Eagle text and converts them to KiCAD notation.
export function interpretText(aText: string): string {
  const token = { text: aText };

  if (substituteVariable(token)) return token.text;

  let text = '';
  let sectionOpen = false;

  for (let i = 0; i < aText.length; i++) {
    // Interpret escaped characters
    if (aText[i] === '\\') {
      if (i + 1 !== aText.length) text += aText[i + 1];

      i++;
      continue;
    }

    // Escape ~ for KiCAD when it would otherwise be interpreted as markup
    if (aText[i] === '~') {
      if (
        (i + 1 < aText.length && aText[i + 1] === '{') || // overbar opening sequence
        aText === '~' // legacy empty string token
      ) {
        text += '~';
        text += '~';
        continue;
      }
    }

    if (aText[i] === '!') {
      if (sectionOpen) {
        text += '~';
        sectionOpen = false;
        continue;
      }

      const escapeChars = ' )]}\'"';

      if (i + 1 !== aText.length && !escapeChars.includes(aText[i + 1]!)) {
        sectionOpen = true;
        text += '~';
      } else {
        text += aText[i];
      }

      continue;
    }

    if (aText[i] === ',' && sectionOpen) {
      text += '~';
      sectionOpen = false;
    }

    text += aText[i];
  }

  return text;
}

/// Translates Eagle special text reference to a KiCad variable reference.
export function substituteVariable(aText: { text: string }): boolean {
  const t = aText.text;
  const space = t.indexOf(' ');

  // StartsWith( '>' ) && AfterFirst( ' ' ).IsEmpty()
  if (t.startsWith('>') && (space === -1 || t.substring(space + 1) === '')) {
    const token = t.toUpperCase();

    if (token === '>NAME') aText.text = '${REFERENCE}';
    else if (token === '>VALUE') aText.text = '${VALUE}';
    else if (token === '>PART') aText.text = '${REFERENCE}';
    else if (token === '>GATE') aText.text = '${UNIT}';
    else if (token === '>MODULE') aText.text = '${FOOTPRINT_NAME}';
    else if (token === '>SHEETNR') aText.text = '${#}';
    else if (token === '>SHEETS') aText.text = '${##}';
    else if (token === '>SHEET') aText.text = '${#}/${##}';
    else if (token === '>SHEETNR_TOTAL') aText.text = '${#}';
    else if (token === '>SHEETS_TOTAL') aText.text = '${##}';
    else if (token === '>SHEET_TOTAL') aText.text = '${#}/${##}';
    else if (token === '>SHEET_HEADLINE') aText.text = '${SHEETNAME}';
    else if (token === '>ASSEMBLY_VARIANT') aText.text = '${ASSEMBLY_VARIANT}';
    else if (token === '>DRAWING_NAME') aText.text = '${PROJECTNAME}';
    else if (token === '>LAST_DATE_TIME') aText.text = '${CURRENT_DATE}';
    else if (token === '>PLOT_DATE_TIME') aText.text = '${CURRENT_DATE}';
    // Mid( 1 ).Trim(): trailing blanks off
    else aText.text = `\${${t.substring(1).replace(/[ \t\n\v\f\r]+$/, '')}}`;

    return true;
  }

  return false;
}

/// Converts Eagle's HTML description into KiCad description format.
export function convertDescription(aDescrIn: string): string {
  let aDescr = aDescrIn.replaceAll('\n', ' ');
  aDescr = aDescr.replaceAll('\r', '');

  aDescr = aDescr.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>/g, '$1 ');

  aDescr = aDescr.replaceAll('<p>', '\n\n');
  aDescr = aDescr.replaceAll('</p>', '\n\n');

  aDescr = aDescr.replaceAll('<br>', '\n');
  aDescr = aDescr.replaceAll('<ul>', '\n');
  aDescr = aDescr.replaceAll('</ul>', '\n\n');
  aDescr = aDescr.replaceAll('<li></li>', '\n');
  aDescr = aDescr.replaceAll('<li>', '\n • '); // Bullet point

  aDescr = RemoveHTMLTags(aDescr);

  aDescr = aDescr.replace(/\n +/g, '\n');
  aDescr = aDescr.replace(/ +\n/g, '\n');

  aDescr = aDescr.replace(/\n{3,}/g, '\n\n');
  aDescr = aDescr.replace(/^\n+/g, '');
  aDescr = aDescr.replace(/\n+$/g, '');

  return aDescr;
}

export function getChildrenNodes(aMap: NODE_MAP, aName: string): wxXmlNode | null {
  const it = aMap.get(aName);
  return it === undefined ? null : it.GetChildren();
}

/**
 * Implement a simple wrapper around runtime_error to isolate the errors thrown by the
 * Eagle XML parser.
 */
export class XML_PARSER_ERROR extends Error {
  constructor(aMessage: string) {
    super(`XML parser failed - ${aMessage}`);
    this.name = 'XML_PARSER_ERROR';
  }
}

/// segment (element) of our XPATH into the Eagle XML document tree in PTREE form.
interface TRIPLET {
  element: string;
  attribute: string;
  value: string;
}

/**
 * Keep track of what we are working on within a PTREE.
 */
export class XPATH {
  private p: TRIPLET[] = [];

  push(aPathSegment: string, aAttribute = ''): void {
    this.p.push({ element: aPathSegment, attribute: aAttribute, value: '' });
  }

  clear(): void {
    this.p = [];
  }

  pop(): void {
    this.p.pop();
  }

  /// modify the last path node's value
  Value(aValue: string): void {
    this.p[this.p.length - 1]!.value = aValue;
  }

  /// Modify the last path node's attribute.
  Attribute(aAttribute: string): void {
    this.p[this.p.length - 1]!.attribute = aAttribute;
  }

  /// Return the contents of the XPATH as a single string.
  Contents(): string {
    let ret = '';

    this.p.forEach((it, i) => {
      if (i !== 0) ret += '.';

      ret += it.element;

      if (it.attribute !== '' && it.value !== '') ret += `[${it.attribute}=${it.value}]`;
    });

    return ret;
  }
}

/**
 * Fetch the number of XML nodes within \a aNode.
 */
export function GetNodeCount(aNode: wxXmlNode | null): number {
  const countNodes = (nodeIn: wxXmlNode | null): number => {
    let count = 0;
    let node = nodeIn;

    while (node) {
      const child = node.GetChildren();

      if (child) count += countNodes(child);
      else count++;

      node = node.GetNext();
    }

    return count;
  };

  return countNodes(aNode);
}

/**
 * Provide an easy access to the children of an XML node via their names.
 */
export function MapChildren(aCurrentNodeIn: wxXmlNode | null | undefined): NODE_MAP {
  // Map node_name -> node_pointer
  const nodesMap: NODE_MAP = new Map();

  // Loop through all children mapping them in nodesMap
  let aCurrentNode = aCurrentNodeIn ? aCurrentNodeIn.GetChildren() : null;

  while (aCurrentNode) {
    // Create a new pair in the map (the last node of a name wins, as operator[] assigns)
    nodesMap.set(aCurrentNode.GetName(), aCurrentNode);

    // Get next child
    aCurrentNode = aCurrentNode.GetNext();
  }

  return nodesMap;
}

/// Convert an Eagle curve end to a KiCad center for S_ARC.
export function ConvertArcCenter(aStart: VECTOR2I, aEnd: VECTOR2I, aAngle: number): VECTOR2I {
  // Eagle give us start and end.
  // S_ARC wants start to give the center, and end to give the start.
  const dx = aEnd.x - aStart.x;
  const dy = aEnd.y - aStart.y;
  // ( aStart + aEnd ) / 2: VECTOR2<int>::operator/( int ) truncates
  const mid = {
    x: Math.trunc((aStart.x + aEnd.x) / 2),
    y: Math.trunc((aStart.y + aEnd.y) / 2),
  };

  const dlen = Math.sqrt(dx * dx + dy * dy);

  const isnormal = (v: number): boolean =>
    Number.isFinite(v) && v !== 0 && Math.abs(v) >= 2.2250738585072014e-308;

  if (!isnormal(dlen) || !isnormal(aAngle)) {
    throw new IO_ERROR(`Invalid Arc with radius ${dlen.toFixed(2)} and angle ${aAngle.toFixed(2)}`);
  }

  const dist = dlen / (2 * tan((aAngle * Math.PI) / 180.0 / 2));

  // VECTOR2I( double, double ): each component truncated toward zero
  return {
    x: Math.trunc(mid.x + dist * (dy / dlen)) + 0,
    y: Math.trunc(mid.y - dist * (dx / dlen)) + 0,
  };
}

export interface EROT {
  mirror: boolean;
  spin: boolean;
  degrees: number;
}

/** `EROT()` / `EROT( aDegrees )`. */
export function EROT(aDegrees = 0): EROT {
  return { mirror: false, spin: false, degrees: aDegrees };
}

export enum EAGLE_UNIT {
  EU_NM, ///< nanometers
  EU_MM, ///< millimeters
  EU_INCH, ///< inches
  EU_MIL, ///< mils/thous
}

/**
 * `sscanf( s, "%d.%n%llu%n", … )`: the return count, the integer, and the
 * fraction with the number of characters `%llu` consumed.
 */
function scanCoordinate(s: string): {
  ret: number;
  integer: number;
  fraction: number;
  digits: number;
} {
  // %d: optional blanks, sign, digits
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(s);

  if (!m) return { ret: 0, integer: 0, fraction: 0, digits: 0 };

  // int overflow is UB upstream; wrap as the int store would
  const integer = Number.parseInt(m[1]!, 10) | 0;
  let k = m[0].length;

  if (s[k] !== '.') return { ret: 1, integer, fraction: 0, digits: 0 };

  k++;
  const pre = k;
  // %llu: optional blanks and sign, digits
  const f = /^[ \t\n\v\f\r]*([+-]?)(\d+)/.exec(s.slice(k));

  if (!f) return { ret: 1, integer, fraction: 0, digits: 0 };

  const digits = f[0].length;
  let fraction = Number(BigInt(f[2]!) % 2n ** 64n);

  if (f[1] === '-') fraction = Number((2n ** 64n - BigInt(f[2]!)) % 2n ** 64n);

  return { ret: 2, integer, fraction, digits: pre + digits - pre };
}

export class ECOORD {
  value: number;

  static readonly ECOORD_UNIT = EAGLE_UNIT.EU_NM;

  /** `ECOORD()`, `ECOORD( int, unit )` or `ECOORD( const wxString&, unit )`. */
  constructor(aValue: number | string = 0, aUnit: EAGLE_UNIT = EAGLE_UNIT.EU_NM) {
    if (typeof aValue === 'number') {
      this.value = ECOORD.ConvertToNm(aValue, aUnit);
      return;
    }

    // This array is used to adjust the fraction part value basing on the number of digits
    // in the fraction.
    const DIVIDERS = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000];

    // The following check is needed to handle correctly negative fractions where the integer
    // part == 0.
    const negative = aValue[0] === '-';

    // %n is used to find out how many digits contains the fraction part, e.g. 0.001 contains 3
    // digits.
    const scan = scanCoordinate(aValue);

    if (scan.ret === 0) throw new XML_PARSER_ERROR('Invalid coordinate');

    // process the integer part
    this.value = ECOORD.ConvertToNm(scan.integer, aUnit);

    // process the fraction part
    if (scan.ret === 2) {
      let digits = scan.digits;
      let fraction = scan.fraction;

      // adjust the number of digits if necessary as we cannot handle anything smaller than
      // nanometers (rounding).
      if (digits >= DIVIDERS.length) {
        const denom = 10 ** (digits - DIVIDERS.length + 1);
        digits = DIVIDERS.length - 1;
        fraction = Math.floor(fraction / denom);
      }

      // ConvertToNm( int ): the fraction narrowed to int first
      const frac_value =
        Math.trunc(ECOORD.ConvertToNm(fraction | 0, aUnit) / DIVIDERS[digits]!) | 0;

      // keep the sign in mind
      this.value = negative ? this.value - frac_value : this.value + frac_value;
    }
  }

  ToMils(): number {
    return Math.trunc(this.value / 25400);
  }

  To100NanoMeters(): number {
    return Math.trunc(this.value / 100);
  }

  /** `int ToNanoMeters()`: the long long narrowed to int. */
  ToNanoMeters(): number {
    return this.value | 0;
  }

  /** `float ToMm()`. */
  ToMm(): number {
    return Math.fround(this.value / 1000000.0);
  }

  ToSchUnits(): number {
    return this.To100NanoMeters();
  }

  ToPcbUnits(): number {
    return this.ToNanoMeters();
  }

  add(aOther: ECOORD): ECOORD {
    return new ECOORD(this.value + aOther.value, ECOORD.ECOORD_UNIT);
  }

  sub(aOther: ECOORD): ECOORD {
    return new ECOORD(this.value - aOther.value, ECOORD.ECOORD_UNIT);
  }

  equals(aOther: ECOORD): boolean {
    return this.value === aOther.value;
  }

  static ConvertToNm(aValue: number, aUnit: EAGLE_UNIT): number {
    let ret: number;

    switch (aUnit) {
      case EAGLE_UNIT.EU_MM:
        ret = aValue * 1000000;
        break;
      case EAGLE_UNIT.EU_INCH:
        ret = aValue * 25400000;
        break;
      case EAGLE_UNIT.EU_MIL:
        ret = aValue * 25400;
        break;
      default:
        ret = aValue;
        break;
    }

    if (ret > 0 !== aValue > 0) console.error(`Invalid size ${aValue}: too large`);

    return ret;
  }
}

export class EURN {
  host = ''; ///< Should always be "urn".
  path = ''; ///< Path to the asset type below.
  assetType = ''; ///< Must be "symbol", "footprint", "package", "component", or "library".
  assetId = ''; ///< The unique asset identifier for the asset type.
  assetVersion = ''; ///< May be empty depending on the asset type.

  constructor(aUrn?: string) {
    if (aUrn !== undefined) this.Parse(aUrn);
  }

  Parse(aUrn: string): void {
    // wxStringTokenizer( aUrn, ":" ): wxTOKEN_DEFAULT drops empty tokens
    const tokens = aUrn.split(':').filter((t) => t !== '');
    let i = 0;
    const next = (): string => tokens[i++] ?? '';

    this.host = next();
    this.path = next();
    this.assetType = next();

    // Split off the version if there is one.
    const tmp = next();

    const slash = tmp.indexOf('/');
    this.assetId = slash === -1 ? tmp : tmp.substring(0, slash);
    this.assetVersion = tmp.substring(tmp.lastIndexOf('/') + 1);
  }

  IsValid(): boolean {
    if (this.host !== 'urn') return false;

    if (this.path === '') return false;

    const validAssetTypes = ['component', 'footprint', 'library', 'package', 'symbol', 'fs.file'];

    if (!validAssetTypes.includes(this.assetType)) return false;

    if (this.assetId === '') return false;

    return true;
  }
}

// Template specializations below parse wxString to the used types.

type CONVERTER<T> = (aValue: string) => T;

export const Convert = {
  wxString: ((aValue: string) => aValue) as CONVERTER<string>,

  /** `Convert<std::string>`: the UTF-8 form; a JS string is the same text. */
  string: ((aValue: string) => aValue) as CONVERTER<string>,

  double: ((aValue: string) => {
    if (ToCDoubleOk(aValue)) return strtodPrefix(aValue, 0)!.value;
    throw new XML_PARSER_ERROR(`Conversion to double failed. Original value: '${aValue}'.`);
  }) as CONVERTER<number>,

  int: ((aValue: string) => {
    if (aValue === '')
      throw new XML_PARSER_ERROR('Conversion to int failed. Original value is empty.');

    return atoi(aValue);
  }) as CONVERTER<number>,

  bool: ((aValue: string) => {
    if (aValue !== 'yes' && aValue !== 'no')
      throw new XML_PARSER_ERROR(
        `Conversion to bool failed. Original value, '${aValue}', is neither 'yes' nor 'no'.`,
      );

    return aValue === 'yes';
  }) as CONVERTER<boolean>,

  /// parse an Eagle XML "rot" field.  Unfortunately the DTD seems not to explain
  /// this format very well.  [S][M]R<degrees>.   Examples: "R90", "MR180", "SR180"
  EROT: ((aRot: string) => {
    const value = EROT();

    value.spin = aRot.includes('S');
    value.mirror = aRot.includes('M');

    if (!aRot.includes('R')) {
      value.degrees = 0.0;
      return value;
    }

    // Calculate the offset after 'R', 'S', and 'M'
    let offset: number;

    for (offset = 0; offset < aRot.length; offset++) {
      if (aRot[offset]! >= '0' && aRot[offset]! <= '9') break;
    }

    const degreesStr = aRot.substring(offset);

    // Use locale-independent conversion
    if (ToCDoubleOk(degreesStr)) value.degrees = strtodPrefix(degreesStr, 0)!.value;
    else value.degrees = 0.0;

    return value;
  }) as CONVERTER<EROT>,

  ECOORD: ((aCoord: string) => {
    // Eagle uses millimeters as the default unit
    return new ECOORD(aCoord, EAGLE_UNIT.EU_MM);
  }) as CONVERTER<ECOORD>,

  EURN: ((aUrn: string) => new EURN(aUrn)) as CONVERTER<EURN>,
};

/**
 * Parse \a aAttribute of the XML node \a aNode.
 *
 * @throw  XML_PARSER_ERROR - exception thrown if the required attribute is missing
 */
function parseRequiredAttribute<T>(aConv: CONVERTER<T>, aNode: wxXmlNode, aAttribute: string): T {
  const value = aNode.GetAttributeOpt(aAttribute);

  if (value !== null) return aConv(value);
  else
    throw new XML_PARSER_ERROR(
      `The required attribute ${aAttribute} is missing at line ${aNode.GetLineNumber()}.`,
    );
}

/**
 * Parse option \a aAttribute of the XML node \a aNode: `undefined` when it is
 * absent or empty.
 */
function parseOptionalAttribute<T>(
  aConv: CONVERTER<T>,
  aNode: wxXmlNode,
  aAttribute: string,
): T | undefined {
  const value = aNode.GetAttribute(aAttribute);

  return value === '' ? undefined : aConv(value);
}

/** `OPTIONAL_XML_ATTRIBUTE<wxString>` built from a string: empty is unavailable. */
export function opt_wxString(aValue: string): string | undefined {
  return aValue === '' ? undefined : aValue;
}

/// Converts Eagle's text size to KiCad text size depending on the font used.
export function ConvertEagleTextSize(font: string | undefined, size: ECOORD): VECTOR2I {
  let textsize: VECTOR2I;

  if (font !== undefined) {
    const fontName = font;

    if (fontName === 'vector') {
      textsize = { x: size.ToSchUnits(), y: size.ToSchUnits() };
    } else if (fontName === 'fixed') {
      textsize = { x: size.ToSchUnits(), y: Math.trunc(size.ToSchUnits() * 0.8) };
    } else {
      textsize = { x: size.ToSchUnits(), y: size.ToSchUnits() };
    }
  } else {
    textsize = { x: Math.trunc(size.ToSchUnits() * 0.85), y: size.ToSchUnits() };
  }

  return textsize;
}

export class EAGLE_BASE {
  constructor(public io: IO_BASE | null = null) {}

  Report(aMsg: string, aSeverity: Severity = RPT_SEVERITY_UNDEFINED): void {
    if (!this.io) return;

    this.io.Report(aMsg, aSeverity);
  }

  AdvanceProgressPhase(): void {
    if (!this.io) return;

    this.io.AdvanceProgressPhase();
  }
}

const S = Convert.wxString;
const I = Convert.int;
const D = Convert.double;
const B = Convert.bool;
const C = Convert.ECOORD;
const R = Convert.EROT;
const U = Convert.EURN;

export class EDESCRIPTION extends EAGLE_BASE {
  text: string;
  language: string | undefined;

  constructor(aDescription: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.text = aDescription.GetNodeContent();
    this.language = parseOptionalAttribute(S, aDescription, 'language');
    this.AdvanceProgressPhase();
  }
}

export class EWIRE extends EAGLE_BASE {
  static readonly CONTINUOUS = 0;
  static readonly LONGDASH = 1;
  static readonly SHORTDASH = 2;
  static readonly DASHDOT = 3;
  static readonly FLAT = 0;
  static readonly ROUND = 1;

  x1: ECOORD;
  y1: ECOORD;
  x2: ECOORD;
  y2: ECOORD;
  width: ECOORD;
  layer: number;
  extent: string | undefined;
  style: number | undefined;
  curve: number | undefined; ///< range is -359.9..359.9
  cap: number | undefined;

  constructor(aWire: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x1 = parseRequiredAttribute(C, aWire, 'x1');
    this.y1 = parseRequiredAttribute(C, aWire, 'y1');
    this.x2 = parseRequiredAttribute(C, aWire, 'x2');
    this.y2 = parseRequiredAttribute(C, aWire, 'y2');
    this.width = parseRequiredAttribute(C, aWire, 'width');
    this.layer = parseRequiredAttribute(I, aWire, 'layer');
    this.curve = parseOptionalAttribute(D, aWire, 'curve');

    let s = parseOptionalAttribute(S, aWire, 'style');

    if (s === 'continuous') this.style = EWIRE.CONTINUOUS;
    else if (s === 'longdash') this.style = EWIRE.LONGDASH;
    else if (s === 'shortdash') this.style = EWIRE.SHORTDASH;
    else if (s === 'dashdot') this.style = EWIRE.DASHDOT;

    s = parseOptionalAttribute(S, aWire, 'cap');

    if (s === 'round') this.cap = EWIRE.ROUND;
    else if (s === 'flat') this.cap = EWIRE.FLAT;

    this.AdvanceProgressPhase();
  }
}

export class EJUNCTION extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;

  constructor(aJunction: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aJunction, 'x');
    this.y = parseRequiredAttribute(C, aJunction, 'y');
    this.AdvanceProgressPhase();
  }
}

export class ELABEL extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  size: ECOORD;
  layer: number;
  font: string | undefined;
  ratio: number | undefined;
  rot: EROT | undefined;
  /** `opt_bool xref` read as a string upstream (`parseOptionalAttribute<wxString>`). */
  xref: boolean | undefined;
  align: string | undefined;

  constructor(aLabel: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aLabel, 'x');
    this.y = parseRequiredAttribute(C, aLabel, 'y');
    this.size = parseRequiredAttribute(C, aLabel, 'size');
    this.layer = parseRequiredAttribute(I, aLabel, 'layer');
    this.font = parseOptionalAttribute(S, aLabel, 'font');
    this.ratio = parseOptionalAttribute(I, aLabel, 'ratio');
    this.rot = parseOptionalAttribute(R, aLabel, 'rot');
    // opt_bool = OPTIONAL_XML_ATTRIBUTE<wxString>: assigning the string runs Convert<bool>
    this.xref = parseOptionalAttribute(B, aLabel, 'xref');
    this.align = parseOptionalAttribute(S, aLabel, 'align');
    this.AdvanceProgressPhase();
  }
}

export class ESEGMENT extends EAGLE_BASE {
  pinRefs: EPINREF[] = [];
  portRefs: EPORTREF[] = [];
  wires: EWIRE[] = [];
  junctions: EJUNCTION[] = [];
  labels: ELABEL[] = [];
  probes: EPROBE[] = [];

  constructor(aSegment: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    for (let child = aSegment.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'pinref') this.pinRefs.push(new EPINREF(child, aIo));
      else if (child.GetName() === 'portref') this.portRefs.push(new EPORTREF(child, aIo));
      else if (child.GetName() === 'wire') this.wires.push(new EWIRE(child, aIo));
      else if (child.GetName() === 'junction') this.junctions.push(new EJUNCTION(child, aIo));
      else if (child.GetName() === 'label') this.labels.push(new ELABEL(child, aIo));
      else if (child.GetName() === 'probe') this.probes.push(new EPROBE(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EBUS extends EAGLE_BASE {
  name: string;
  segments: ESEGMENT[] = [];

  constructor(aBus: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aBus, 'name');

    for (let child = aBus.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'segment') this.segments.push(new ESEGMENT(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class ENET extends EAGLE_BASE {
  netname = '';
  netcode = 0;
  segments: ESEGMENT[] = [];

  /** `ENET( aNetCode, aNetName )`, or `ENET( wxXmlNode* aNet, IO_BASE* aIo )`. */
  constructor(a?: number | wxXmlNode, b?: string | IO_BASE | null) {
    super(typeof a === 'number' || a === undefined ? null : ((b as IO_BASE | null) ?? null));

    if (typeof a === 'number') {
      this.netcode = a;
      this.netname = b as string;
      return;
    }

    if (a === undefined) return;

    this.netname = parseRequiredAttribute(S, a, 'name');
    this.netcode = parseRequiredAttribute(I, a, 'class');

    for (let segment = a.GetChildren(); segment; segment = segment.GetNext())
      this.segments.push(new ESEGMENT(segment));

    this.AdvanceProgressPhase();
  }
}

export class EVIA extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  layer_front_most = 0; /// < extent
  layer_back_most = 0; /// < inclusive
  drill: ECOORD;
  diam: ECOORD | undefined;
  shape: string | undefined;
  alwaysStop: boolean | undefined;

  constructor(aVia: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aVia, 'x');
    this.y = parseRequiredAttribute(C, aVia, 'y');

    const ext = parseRequiredAttribute(S, aVia, 'extent');
    // sscanf( ext, "%d-%d", … ): fields not matched keep their value
    const m = /^[ \t\n\v\f\r]*([+-]?\d+)(?:-[ \t\n\v\f\r]*([+-]?\d+))?/.exec(ext);
    if (m) {
      this.layer_front_most = Number.parseInt(m[1]!, 10) | 0;
      if (m[2] !== undefined) this.layer_back_most = Number.parseInt(m[2], 10) | 0;
    }

    this.drill = parseRequiredAttribute(C, aVia, 'drill');
    this.diam = parseOptionalAttribute(C, aVia, 'diameter');
    this.shape = parseOptionalAttribute(S, aVia, 'shape');
    this.AdvanceProgressPhase();
  }
}

export class ECIRCLE extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  radius: ECOORD;
  width: ECOORD;
  layer: number;

  constructor(aCircle: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aCircle, 'x');
    this.y = parseRequiredAttribute(C, aCircle, 'y');
    this.radius = parseRequiredAttribute(C, aCircle, 'radius');
    this.width = parseRequiredAttribute(C, aCircle, 'width');
    this.layer = parseRequiredAttribute(I, aCircle, 'layer');
    this.AdvanceProgressPhase();
  }
}

export class ERECT extends EAGLE_BASE {
  x1: ECOORD;
  y1: ECOORD;
  x2: ECOORD;
  y2: ECOORD;
  layer: number;
  rot: EROT | undefined;

  constructor(aRect: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x1 = parseRequiredAttribute(C, aRect, 'x1');
    this.y1 = parseRequiredAttribute(C, aRect, 'y1');
    this.x2 = parseRequiredAttribute(C, aRect, 'x2');
    this.y2 = parseRequiredAttribute(C, aRect, 'y2');
    this.layer = parseRequiredAttribute(I, aRect, 'layer');
    this.rot = parseOptionalAttribute(R, aRect, 'rot');
    this.AdvanceProgressPhase();
  }
}

export class EVERTEX extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  curve: number | undefined; ///< range is -359.9..359.9

  constructor(aVertex: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aVertex, 'x');
    this.y = parseRequiredAttribute(C, aVertex, 'y');
    this.curve = parseOptionalAttribute(D, aVertex, 'curve');
    this.AdvanceProgressPhase();
  }
}

export class ESPLINE extends EAGLE_BASE {
  vertices: EVERTEX[] = [];
  width: number;

  constructor(aSpline: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.width = parseRequiredAttribute(D, aSpline, 'width');

    for (let child = aSpline.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'vertex') this.vertices.push(new EVERTEX(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

// ETEXT alignments
export const ETEXT_ALIGN = {
  CENTER: 0,
  CENTER_LEFT: 1,
  TOP_CENTER: 2,
  TOP_LEFT: 3,
  TOP_RIGHT: 4,
  CENTER_RIGHT: -1,
  BOTTOM_CENTER: -2,
  BOTTOM_LEFT: -4,
  BOTTOM_RIGHT: -3,
} as const;

const DEFAULT_ALIGNMENT = ETEXT_ALIGN.BOTTOM_LEFT;

function parseAlignment(aAlignment: string): number {
  // (bottom-left | bottom-center | bottom-right | center-left |
  // center | center-right | top-left | top-center | top-right)
  if (aAlignment === 'center') return ETEXT_ALIGN.CENTER;
  else if (aAlignment === 'center-right') return ETEXT_ALIGN.CENTER_RIGHT;
  else if (aAlignment === 'top-left') return ETEXT_ALIGN.TOP_LEFT;
  else if (aAlignment === 'top-center') return ETEXT_ALIGN.TOP_CENTER;
  else if (aAlignment === 'top-right') return ETEXT_ALIGN.TOP_RIGHT;
  else if (aAlignment === 'bottom-left') return ETEXT_ALIGN.BOTTOM_LEFT;
  else if (aAlignment === 'bottom-center') return ETEXT_ALIGN.BOTTOM_CENTER;
  else if (aAlignment === 'bottom-right') return ETEXT_ALIGN.BOTTOM_RIGHT;
  else if (aAlignment === 'center-left') return ETEXT_ALIGN.CENTER_LEFT;

  return DEFAULT_ALIGNMENT;
}

export class EATTR extends EAGLE_BASE {
  static readonly Off = 0;
  static readonly VALUE = 1;
  static readonly NAME = 2;
  static readonly BOTH = 3;

  name = '';
  value: string | undefined;
  x: ECOORD | undefined;
  y: ECOORD | undefined;
  size: ECOORD | undefined;
  layer: number | undefined;
  font: string | undefined;
  ratio: number | undefined;
  rot: EROT | undefined;
  constant: boolean | undefined;
  display: number | undefined;
  align: number | undefined;

  /** `EATTR( wxXmlNode* aTree, IO_BASE* aIo )`, or `EATTR()`. */
  constructor(aTree?: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    if (!aTree) return;

    this.name = parseRequiredAttribute(S, aTree, 'name');
    this.value = parseOptionalAttribute(S, aTree, 'value');
    this.x = parseOptionalAttribute(C, aTree, 'x');
    this.y = parseOptionalAttribute(C, aTree, 'y');
    this.size = parseOptionalAttribute(C, aTree, 'size');
    this.layer = parseOptionalAttribute(I, aTree, 'layer');
    this.ratio = parseOptionalAttribute(D, aTree, 'ratio');
    this.rot = parseOptionalAttribute(R, aTree, 'rot');

    let stemp = parseOptionalAttribute(S, aTree, 'display');

    // (off | value | name | both)
    if (stemp === 'off') this.display = EATTR.Off;
    else if (stemp === 'name') this.display = EATTR.NAME;
    else if (stemp === 'both') this.display = EATTR.BOTH;
    // "value" is the default
    else this.display = EATTR.VALUE;

    stemp = parseOptionalAttribute(S, aTree, 'align');

    this.align = stemp !== undefined ? parseAlignment(stemp) : DEFAULT_ALIGNMENT;

    this.AdvanceProgressPhase();
  }

  /** The copy `name = a` makes. */
  assign(aOther: EATTR): void {
    Object.assign(this, aOther);
  }
}

export class EPINREF extends EAGLE_BASE {
  part: string;
  gate: string;
  pin: string;

  constructor(aPinRef: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.part = parseRequiredAttribute(S, aPinRef, 'part');
    this.gate = parseRequiredAttribute(S, aPinRef, 'gate');
    this.pin = parseRequiredAttribute(S, aPinRef, 'pin');
    this.AdvanceProgressPhase();
  }
}

export class EPORTREF extends EAGLE_BASE {
  moduleinst: string;
  port: string;

  constructor(aPortRef: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.moduleinst = parseRequiredAttribute(S, aPortRef, 'moduleinst');
    this.port = parseRequiredAttribute(S, aPortRef, 'port');
    this.AdvanceProgressPhase();
  }
}

export class EPROBE extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  size: number;
  layer: number;
  font: string | undefined;
  ratio: number | undefined;
  rot: EROT | undefined;
  xref: boolean | undefined;

  constructor(aProbe: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x = parseRequiredAttribute(C, aProbe, 'x');
    this.y = parseRequiredAttribute(C, aProbe, 'y');
    this.size = parseRequiredAttribute(D, aProbe, 'size');
    this.layer = parseRequiredAttribute(I, aProbe, 'layer');
    this.font = parseOptionalAttribute(S, aProbe, 'font');
    this.ratio = parseOptionalAttribute(I, aProbe, 'ratio');
    this.rot = parseOptionalAttribute(R, aProbe, 'rot');
    this.xref = parseOptionalAttribute(B, aProbe, 'xref');
    this.AdvanceProgressPhase();
  }
}

export class EDIMENSION extends EAGLE_BASE {
  x1: ECOORD;
  y1: ECOORD;
  x2: ECOORD;
  y2: ECOORD;
  x3: ECOORD;
  y3: ECOORD;
  textsize: ECOORD | undefined;
  layer: number;
  dimensionType: string | undefined;
  width: number | undefined;
  extwidth: number | undefined;
  extlength: number | undefined;
  extoffset: number | undefined;
  textratio: number | undefined;
  unit: string | undefined;
  precision: number | undefined;
  visible: boolean | undefined;

  constructor(aDimension: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x1 = parseRequiredAttribute(C, aDimension, 'x1');
    this.y1 = parseRequiredAttribute(C, aDimension, 'y1');
    this.x2 = parseRequiredAttribute(C, aDimension, 'x2');
    this.y2 = parseRequiredAttribute(C, aDimension, 'y2');
    this.x3 = parseRequiredAttribute(C, aDimension, 'x3');
    this.y3 = parseRequiredAttribute(C, aDimension, 'y3');
    this.textsize = parseOptionalAttribute(C, aDimension, 'textsize');
    this.layer = parseRequiredAttribute(I, aDimension, 'layer');
    this.dimensionType = parseOptionalAttribute(S, aDimension, 'dtype');
    this.AdvanceProgressPhase();
  }
}

export class ETEXT extends EAGLE_BASE {
  static readonly CENTER = ETEXT_ALIGN.CENTER;
  static readonly CENTER_LEFT = ETEXT_ALIGN.CENTER_LEFT;
  static readonly TOP_CENTER = ETEXT_ALIGN.TOP_CENTER;
  static readonly TOP_LEFT = ETEXT_ALIGN.TOP_LEFT;
  static readonly TOP_RIGHT = ETEXT_ALIGN.TOP_RIGHT;
  static readonly CENTER_RIGHT = ETEXT_ALIGN.CENTER_RIGHT;
  static readonly BOTTOM_CENTER = ETEXT_ALIGN.BOTTOM_CENTER;
  static readonly BOTTOM_LEFT = ETEXT_ALIGN.BOTTOM_LEFT;
  static readonly BOTTOM_RIGHT = ETEXT_ALIGN.BOTTOM_RIGHT;

  text: string;
  x: ECOORD;
  y: ECOORD;
  size: ECOORD;
  layer: number;
  font: string | undefined;
  ratio: number | undefined;
  rot: EROT | undefined;
  align: number | undefined;
  distance: number | undefined;

  constructor(aText: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.text = aText.GetNodeContent();
    this.x = parseRequiredAttribute(C, aText, 'x');
    this.y = parseRequiredAttribute(C, aText, 'y');
    this.size = parseRequiredAttribute(C, aText, 'size');
    this.layer = parseRequiredAttribute(I, aText, 'layer');
    this.font = parseOptionalAttribute(S, aText, 'font');
    this.ratio = parseOptionalAttribute(D, aText, 'ratio');
    this.rot = parseOptionalAttribute(R, aText, 'rot');

    const stemp = parseOptionalAttribute(S, aText, 'align');

    this.align = stemp !== undefined ? parseAlignment(stemp) : DEFAULT_ALIGNMENT;

    this.AdvanceProgressPhase();
  }

  ConvertSize(): VECTOR2I {
    return ConvertEagleTextSize(this.font, this.size);
  }
}

export class EFRAME extends EAGLE_BASE {
  x1: ECOORD;
  y1: ECOORD;
  x2: ECOORD;
  y2: ECOORD;
  columns: number;
  rows: number;
  layer: number;
  border_left: boolean | undefined;
  border_top: boolean | undefined;
  border_right: boolean | undefined;
  border_bottom: boolean | undefined;

  constructor(aFrameNode: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.x1 = parseRequiredAttribute(C, aFrameNode, 'x1');
    this.y1 = parseRequiredAttribute(C, aFrameNode, 'y1');
    this.x2 = parseRequiredAttribute(C, aFrameNode, 'x2');
    this.y2 = parseRequiredAttribute(C, aFrameNode, 'y2');
    this.columns = parseRequiredAttribute(I, aFrameNode, 'columns');
    this.rows = parseRequiredAttribute(I, aFrameNode, 'rows');
    this.layer = parseRequiredAttribute(I, aFrameNode, 'layer');
    // border_* = true first, then the optional attribute (absent -> unavailable)
    this.border_left = parseOptionalAttribute(B, aFrameNode, 'border-left');
    this.border_top = parseOptionalAttribute(B, aFrameNode, 'border-top');
    this.border_right = parseOptionalAttribute(B, aFrameNode, 'border-right');
    this.border_bottom = parseOptionalAttribute(B, aFrameNode, 'border-bottom');
    this.AdvanceProgressPhase();
  }
}

export class EPAD_COMMON extends EAGLE_BASE {
  name: string;
  x: ECOORD;
  y: ECOORD;
  rot: EROT | undefined;
  stop: boolean | undefined;
  thermals: boolean | undefined;

  constructor(aPad: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    // #REQUIRED says DTD, throw exception if not found
    this.name = parseRequiredAttribute(S, aPad, 'name');
    this.x = parseRequiredAttribute(C, aPad, 'x');
    this.y = parseRequiredAttribute(C, aPad, 'y');
    this.rot = parseOptionalAttribute(R, aPad, 'rot');
    this.stop = parseOptionalAttribute(B, aPad, 'stop');
    this.thermals = parseOptionalAttribute(B, aPad, 'thermals');
  }
}

export class EPAD extends EPAD_COMMON {
  static readonly UNDEF = -1;
  static readonly SQUARE = 0;
  static readonly ROUND = 1;
  static readonly OCTAGON = 2;
  static readonly LONG = 3;
  static readonly OFFSET = 4;

  drill: ECOORD | undefined;
  diameter: ECOORD | undefined;
  shape: number | undefined;
  first: boolean | undefined;

  constructor(aPad: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aPad, aIo);
    // #REQUIRED says DTD, but DipTrace doesn't write it sometimes
    this.drill = parseOptionalAttribute(C, aPad, 'drill');

    // Optional attributes
    this.diameter = parseOptionalAttribute(C, aPad, 'diameter');

    const s = parseOptionalAttribute(S, aPad, 'shape');

    // (square | round | octagon | long | offset)
    if (s === 'square') this.shape = EPAD.SQUARE;
    else if (s === 'round') this.shape = EPAD.ROUND;
    else if (s === 'octagon') this.shape = EPAD.OCTAGON;
    else if (s === 'long') this.shape = EPAD.LONG;
    else if (s === 'offset') this.shape = EPAD.OFFSET;

    this.first = parseOptionalAttribute(B, aPad, 'first');
    this.AdvanceProgressPhase();
  }
}

export class ESMD extends EPAD_COMMON {
  dx: ECOORD;
  dy: ECOORD;
  layer: number;
  roundness: number | undefined;
  cream: boolean | undefined;

  constructor(aSMD: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aSMD, aIo);
    // DTD #REQUIRED, throw exception if not found
    this.dx = parseRequiredAttribute(C, aSMD, 'dx');
    this.dy = parseRequiredAttribute(C, aSMD, 'dy');
    this.layer = parseRequiredAttribute(I, aSMD, 'layer');
    this.roundness = parseOptionalAttribute(I, aSMD, 'roundness');
    this.cream = parseOptionalAttribute(B, aSMD, 'cream');
    this.AdvanceProgressPhase();
  }
}

export class EPIN extends EAGLE_BASE {
  name: string;
  x: ECOORD;
  y: ECOORD;
  visible: string | undefined;
  length: string | undefined;
  direction: string | undefined;
  function: string | undefined;
  swaplevel: number | undefined;
  rot: EROT | undefined;

  constructor(aPin: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    // DTD #REQUIRED, throw exception if not found
    this.name = parseRequiredAttribute(S, aPin, 'name');
    this.x = parseRequiredAttribute(C, aPin, 'x');
    this.y = parseRequiredAttribute(C, aPin, 'y');
    this.visible = parseOptionalAttribute(S, aPin, 'visible');
    this.length = parseOptionalAttribute(S, aPin, 'length');
    this.direction = parseOptionalAttribute(S, aPin, 'direction');
    this.function = parseOptionalAttribute(S, aPin, 'function');
    this.swaplevel = parseOptionalAttribute(I, aPin, 'swaplevel');
    this.rot = parseOptionalAttribute(R, aPin, 'rot');
    this.AdvanceProgressPhase();
  }
}

export class EPOLYGON extends EAGLE_BASE {
  static readonly max_priority = 6;
  static readonly ESOLID = 0;
  static readonly EHATCH = 1;
  static readonly ECUTOUT = 2;

  width: ECOORD;
  layer: number;
  spacing: ECOORD | undefined;
  pour: number;
  isolate: ECOORD | undefined;
  orphans: boolean | undefined;
  thermals: boolean | undefined;
  rank: number | undefined;
  vertices: EVERTEX[] = [];

  constructor(aPolygon: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.width = parseRequiredAttribute(C, aPolygon, 'width');
    this.layer = parseRequiredAttribute(I, aPolygon, 'layer');
    this.spacing = parseOptionalAttribute(C, aPolygon, 'spacing');
    this.isolate = parseOptionalAttribute(C, aPolygon, 'isolate');

    const s = parseOptionalAttribute(S, aPolygon, 'pour');

    // default pour to solid fill
    this.pour = EPOLYGON.ESOLID;

    // (solid | hatch | cutout)
    if (s === 'hatch') this.pour = EPOLYGON.EHATCH;
    else if (s === 'cutout') this.pour = EPOLYGON.ECUTOUT;

    this.orphans = parseOptionalAttribute(B, aPolygon, 'orphans');
    this.thermals = parseOptionalAttribute(B, aPolygon, 'thermals');
    this.rank = parseOptionalAttribute(I, aPolygon, 'rank');

    for (let child = aPolygon.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'vertex') this.vertices.push(new EVERTEX(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EHOLE extends EAGLE_BASE {
  x: ECOORD;
  y: ECOORD;
  drill: ECOORD;

  constructor(aHole: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    // #REQUIRED:
    this.x = parseRequiredAttribute(C, aHole, 'x');
    this.y = parseRequiredAttribute(C, aHole, 'y');
    this.drill = parseRequiredAttribute(C, aHole, 'drill');
    this.AdvanceProgressPhase();
  }
}

export class EVARIANT extends EAGLE_BASE {
  name: string;
  populate: boolean | undefined;
  value: string | undefined;
  technology: string | undefined;

  constructor(aVariant: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aVariant, 'name');
    this.populate = parseOptionalAttribute(B, aVariant, 'populate');
    this.value = parseOptionalAttribute(S, aVariant, 'value');
    this.technology = parseOptionalAttribute(S, aVariant, 'technology');
    this.AdvanceProgressPhase();
  }
}

export class EMODEL extends EAGLE_BASE {
  name: string;
  model: string;

  constructor(aModel: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aModel, 'name');
    this.model = aModel.GetNodeContent();
    this.AdvanceProgressPhase();
  }
}

export class EPINMAP extends EAGLE_BASE {
  gate: string;
  pin: string;
  pinorder: string;

  constructor(aPinMap: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.gate = parseRequiredAttribute(S, aPinMap, 'gate');
    this.pin = parseRequiredAttribute(S, aPinMap, 'pin');
    this.pinorder = parseRequiredAttribute(S, aPinMap, 'pinorder');
    this.AdvanceProgressPhase();
  }
}

export class EPINMAPPING extends EAGLE_BASE {
  pinmaps: EPINMAP[] = [];
  isusermap: boolean | undefined;
  iddevicewide: boolean | undefined;
  spiceprefix: string | undefined;

  constructor(aPinMapping: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.isusermap = parseOptionalAttribute(B, aPinMapping, 'isusermap');
    this.iddevicewide = parseOptionalAttribute(B, aPinMapping, 'iddevicewide');
    this.spiceprefix = parseOptionalAttribute(S, aPinMapping, 'spiceprefix');

    for (let child = aPinMapping.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'pinmap') this.pinmaps.push(new EPINMAP(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class ESPICE extends EAGLE_BASE {
  pinmapping: EPINMAPPING;
  model: EMODEL | null = null;

  constructor(aSpice: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.pinmapping = new EPINMAPPING(aSpice);

    if (aSpice.GetName() === 'model') this.model = new EMODEL(aSpice);

    this.AdvanceProgressPhase();
  }
}

export class EELEMENT extends EAGLE_BASE {
  attributes = new Map<string, EATTR>();
  variants = new Map<string, EVARIANT>();
  name: string;
  library: string;
  library_urn: EURN | undefined;
  package: string;
  package3d_urn: string | undefined;
  override_package3d_urn: string | undefined;
  override_locally_modified: boolean | undefined;
  value: string;
  x: ECOORD;
  y: ECOORD;
  locked: boolean | undefined;
  smashed: boolean | undefined;
  rot: EROT | undefined;

  constructor(aElement: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    // #REQUIRED
    this.name = parseRequiredAttribute(S, aElement, 'name');
    this.library = parseRequiredAttribute(S, aElement, 'library');
    this.value = parseRequiredAttribute(S, aElement, 'value');
    const p = parseRequiredAttribute(Convert.string, aElement, 'package');
    this.package = ReplaceIllegalFileNameChars(p, '_');

    this.x = parseRequiredAttribute(C, aElement, 'x');
    this.y = parseRequiredAttribute(C, aElement, 'y');

    // optional
    this.library_urn = parseOptionalAttribute(U, aElement, 'library_urn');
    this.locked = parseOptionalAttribute(B, aElement, 'locked');
    this.smashed = parseOptionalAttribute(B, aElement, 'smashed');
    this.rot = parseOptionalAttribute(R, aElement, 'rot');

    for (let child = aElement.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'attribute') {
        const attr = new EATTR(child, aIo);
        this.attributes.set(attr.name, attr);
      } else if (child.GetName() === 'variant') {
        const variant = new EVARIANT(child, aIo);
        this.variants.set(variant.name, variant);
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ELAYER extends EAGLE_BASE {
  number: number;
  name: string;
  color: number;
  fill: number;
  visible: boolean | undefined;
  active: boolean | undefined;

  constructor(aLayer: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.number = parseRequiredAttribute(I, aLayer, 'number');
    this.name = parseRequiredAttribute(S, aLayer, 'name');
    this.color = parseRequiredAttribute(I, aLayer, 'color');
    this.fill = parseRequiredAttribute(I, aLayer, 'fill');
    this.visible = parseOptionalAttribute(B, aLayer, 'visible');
    this.active = parseOptionalAttribute(B, aLayer, 'active');
    this.AdvanceProgressPhase();
  }
}

export const EAGLE_LAYER = {
  TOP: 1,
  ROUTE2: 2,
  ROUTE3: 3,
  ROUTE4: 4,
  ROUTE5: 5,
  ROUTE6: 6,
  ROUTE7: 7,
  ROUTE8: 8,
  ROUTE9: 9,
  ROUTE10: 10,
  ROUTE11: 11,
  ROUTE12: 12,
  ROUTE13: 13,
  ROUTE14: 14,
  ROUTE15: 15,
  BOTTOM: 16,
  PADS: 17,
  VIAS: 18,
  UNROUTED: 19,
  DIMENSION: 20,
  TPLACE: 21,
  BPLACE: 22,
  TORIGINS: 23,
  BORIGINS: 24,
  TNAMES: 25,
  BNAMES: 26,
  TVALUES: 27,
  BVALUES: 28,
  TSTOP: 29,
  BSTOP: 30,
  TCREAM: 31,
  BCREAM: 32,
  TFINISH: 33,
  BFINISH: 34,
  TGLUE: 35,
  BGLUE: 36,
  TTEST: 37,
  BTEST: 38,
  TKEEPOUT: 39,
  BKEEPOUT: 40,
  TRESTRICT: 41,
  BRESTRICT: 42,
  VRESTRICT: 43,
  DRILLS: 44,
  HOLES: 45,
  MILLING: 46,
  MEASURES: 47,
  DOCUMENT: 48,
  REFERENCELC: 49,
  REFERENCELS: 50,
  TDOCU: 51,
  BDOCU: 52,
  NETS: 91,
  BUSSES: 92,
  PINS: 93,
  SYMBOLS: 94,
  NAMES: 95,
  VALUES: 96,
  INFO: 97,
  GUIDE: 98,
  USERLAYER1: 160,
  USERLAYER2: 161,
  USERDRAWINGS: 162,
  USERMARGIN: 163,
  USER1: 170,
  USER2: 171,
  USER3: 172,
  USER4: 173,
  USER5: 174,
  USER6: 175,
  USER7: 176,
  USER8: 177,
  USER9: 178,
} as const;

export class EGATE extends EAGLE_BASE {
  static readonly MUST = 0;
  static readonly CAN = 1;
  static readonly NEXT = 2;
  static readonly REQUEST = 3;
  static readonly ALWAYS = 4;

  name: string;
  symbol: string;
  x: ECOORD;
  y: ECOORD;
  addlevel: number | undefined;
  swaplevel: number | undefined;

  constructor(aGate: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aGate, 'name');
    this.symbol = parseRequiredAttribute(S, aGate, 'symbol');
    this.x = parseRequiredAttribute(C, aGate, 'x');
    this.y = parseRequiredAttribute(C, aGate, 'y');

    const stemp = parseOptionalAttribute(S, aGate, 'addlevel');

    // (off | value | name | both)
    if (stemp === 'must') this.addlevel = EGATE.MUST;
    else if (stemp === 'can') this.addlevel = EGATE.CAN;
    else if (stemp === 'next') this.addlevel = EGATE.NEXT;
    else if (stemp === 'request') this.addlevel = EGATE.REQUEST;
    else if (stemp === 'always') this.addlevel = EGATE.ALWAYS;
    else this.addlevel = EGATE.NEXT;

    this.swaplevel = parseOptionalAttribute(I, aGate, 'swaplevel');
    this.AdvanceProgressPhase();
  }
}

export class EPART extends EAGLE_BASE {
  attributes = new Map<string, EATTR>();
  variants = new Map<string, EVARIANT>();
  spice: ESPICE | null = null;
  name: string;
  library: string;
  libraryUrn: EURN | undefined;
  deviceset: string;
  device: string;
  package3d_urn: string | undefined;
  override_package3d_urn: string | undefined;
  override_package_urn: string | undefined;
  override_locally_modified: boolean | undefined;
  technology: string | undefined;
  value: string | undefined;

  constructor(aPart: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aPart, 'name');
    this.library = parseRequiredAttribute(S, aPart, 'library');
    this.libraryUrn = parseOptionalAttribute(U, aPart, 'library_urn');
    this.deviceset = parseRequiredAttribute(S, aPart, 'deviceset');
    this.device = parseRequiredAttribute(S, aPart, 'device');
    this.package3d_urn = parseOptionalAttribute(S, aPart, 'package3d_urn');
    this.override_package3d_urn = parseOptionalAttribute(S, aPart, 'override_package3d_urn');
    this.override_package_urn = parseOptionalAttribute(S, aPart, 'override_package_urn');
    this.override_locally_modified = parseOptionalAttribute(B, aPart, 'override_locally_modified');
    this.technology = parseOptionalAttribute(S, aPart, 'technology');
    this.value = parseOptionalAttribute(S, aPart, 'value');

    for (let child = aPart.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'attribute') {
        const attr = new EATTR(child, aIo);
        this.attributes.set(attr.name, attr);
      } else if (child.GetName() === 'variant') {
        const variant = new EVARIANT(child, aIo);
        this.variants.set(variant.name, variant);
      } else if (child.GetName() === 'spice') {
        this.spice = new ESPICE(child, aIo);
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class EINSTANCE extends EAGLE_BASE {
  part: string;
  gate: string;
  x: ECOORD;
  y: ECOORD;
  smashed: boolean | undefined;
  rot: EROT | undefined;
  attributes = new Map<string, EATTR>();

  constructor(aInstance: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.part = parseRequiredAttribute(S, aInstance, 'part');
    this.gate = parseRequiredAttribute(S, aInstance, 'gate');

    this.x = parseRequiredAttribute(C, aInstance, 'x');
    this.y = parseRequiredAttribute(C, aInstance, 'y');

    // optional
    this.smashed = parseOptionalAttribute(B, aInstance, 'smashed');
    this.rot = parseOptionalAttribute(R, aInstance, 'rot');

    for (let child = aInstance.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'attribute') {
        const attr = new EATTR(child, aIo);
        this.attributes.set(attr.name, attr);
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ECONNECT extends EAGLE_BASE {
  gate: string;
  pin: string;
  pad: string;
  contactroute: string | undefined;

  constructor(aConnect: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.gate = parseRequiredAttribute(S, aConnect, 'gate');
    this.pin = parseRequiredAttribute(S, aConnect, 'pin');
    this.pad = parseRequiredAttribute(S, aConnect, 'pad');
    this.contactroute = parseOptionalAttribute(S, aConnect, 'contactroute');
    this.AdvanceProgressPhase();
  }
}

export class ETECHNOLOGY extends EAGLE_BASE {
  name: string;
  attributes: EATTR[] = [];

  constructor(aTechnology: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aTechnology, 'name');

    for (let child = aTechnology.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'attribute') this.attributes.push(new EATTR(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EPACKAGE3DINST extends EAGLE_BASE {
  package3d_urn: string;

  constructor(aPackage3dInst: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.package3d_urn = parseRequiredAttribute(S, aPackage3dInst, 'package3d_urn');
    this.AdvanceProgressPhase();
  }
}

export class EDEVICE extends EAGLE_BASE {
  name: string;
  package: string | undefined;
  connects: ECONNECT[] = [];
  package3dinstances: EPACKAGE3DINST[] = [];
  technologies = new Map<string, ETECHNOLOGY>();

  constructor(aDevice: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aDevice, 'name');

    const pack = parseOptionalAttribute(S, aDevice, 'package');

    if (pack !== undefined) this.package = opt_wxString(ReplaceIllegalFileNameChars(pack, '_'));

    for (let child = aDevice.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'connects') {
        for (let connect = child.GetChildren(); connect; connect = connect.GetNext()) {
          if (connect.GetName() === 'connect') this.connects.push(new ECONNECT(connect, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (child.GetName() === 'packages3dinstances') {
        for (let inst = child.GetChildren(); inst; inst = inst.GetNext()) {
          if (inst.GetName() === 'package3dinstance')
            this.package3dinstances.push(new EPACKAGE3DINST(inst, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (child.GetName() === 'technologies') {
        for (let technology = child.GetChildren(); technology; technology = technology.GetNext()) {
          if (technology.GetName() === 'technology') {
            const tmp = new ETECHNOLOGY(technology, aIo);
            this.technologies.set(tmp.name, tmp);
          }
        }

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class EDEVICE_SET extends EAGLE_BASE {
  name: string;
  urn: EURN | undefined;
  locally_modified: boolean | undefined;
  prefix: string | undefined;
  uservalue: boolean | undefined;
  library_version: number | undefined;
  library_locally_modified: boolean | undefined;
  description: EDESCRIPTION | null = null;
  gates = new Map<string, EGATE>();
  devices = new Map<string, EDEVICE>();
  spice: ESPICE | null = null;

  constructor(aDeviceSet: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aDeviceSet, 'name');
    this.urn = parseOptionalAttribute(U, aDeviceSet, 'urn');
    this.locally_modified = parseOptionalAttribute(B, aDeviceSet, 'locally_modified');
    this.prefix = parseOptionalAttribute(S, aDeviceSet, 'prefix');
    this.uservalue = parseOptionalAttribute(B, aDeviceSet, 'uservalue');
    this.library_version = parseOptionalAttribute(I, aDeviceSet, 'library_version');
    this.library_locally_modified = parseOptionalAttribute(
      B,
      aDeviceSet,
      'library_locally_modified',
    );

    for (let child = aDeviceSet.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (child.GetName() === 'gates') {
        for (let gate = child.GetChildren(); gate; gate = gate.GetNext()) {
          const tmp = new EGATE(gate, aIo);
          this.gates.set(tmp.name, tmp);
        }

        this.AdvanceProgressPhase();
      } else if (child.GetName() === 'devices') {
        for (let device = child.GetChildren(); device; device = device.GetNext()) {
          const tmp = new EDEVICE(device, aIo);
          this.devices.set(tmp.name, tmp);
        }

        this.AdvanceProgressPhase();
      } else if (child.GetName() === 'spice') {
        this.spice = new ESPICE(child, aIo);
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ECLASS extends EAGLE_BASE {
  number: string;
  name: string;
  width: ECOORD | undefined;
  drill: ECOORD | undefined;
  /** `std::map<wxString, ECOORD> clearanceMap`: iterated in key order. */
  clearanceMap = new Map<string, ECOORD>();

  constructor(aClass: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.number = parseRequiredAttribute(S, aClass, 'number');
    this.name = parseRequiredAttribute(S, aClass, 'name');
    this.width = parseOptionalAttribute(C, aClass, 'width');
    this.drill = parseOptionalAttribute(C, aClass, 'drill');

    for (let child = aClass.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'clearance') {
        const to = parseRequiredAttribute(S, child, 'class');
        const value = parseRequiredAttribute(C, child, 'value');

        this.clearanceMap.set(to, value);

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class EPLAIN extends EAGLE_BASE {
  polygons: EPOLYGON[] = [];
  wires: EWIRE[] = [];
  texts: ETEXT[] = [];
  dimensions: EDIMENSION[] = [];
  circles: ECIRCLE[] = [];
  splines: ESPLINE[] = [];
  rectangles: ERECT[] = [];
  frames: EFRAME[] = [];
  holes: EHOLE[] = [];

  constructor(aPlain: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    for (let child = aPlain.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'polygon') this.polygons.push(new EPOLYGON(child, aIo));
      else if (n === 'wire') this.wires.push(new EWIRE(child, aIo));
      else if (n === 'text') this.texts.push(new ETEXT(child, aIo));
      else if (n === 'dimension') this.dimensions.push(new EDIMENSION(child, aIo));
      else if (n === 'circle') this.circles.push(new ECIRCLE(child, aIo));
      else if (n === 'spline') this.splines.push(new ESPLINE(child, aIo));
      else if (n === 'rectangle') this.rectangles.push(new ERECT(child, aIo));
      else if (n === 'frame') this.frames.push(new EFRAME(child, aIo));
      else if (n === 'hole') this.holes.push(new EHOLE(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EMODULEINST extends EAGLE_BASE {
  name: string;
  moduleinst: string;
  moduleVariant: string | undefined;
  x: ECOORD;
  y: ECOORD;
  offset: number | undefined;
  smashed: boolean | undefined;
  rotation: EROT | undefined;

  constructor(aModuleInst: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aModuleInst, 'name');
    this.moduleinst = parseRequiredAttribute(S, aModuleInst, 'module');
    this.moduleVariant = parseOptionalAttribute(S, aModuleInst, 'modulevariant');
    this.x = parseRequiredAttribute(C, aModuleInst, 'x');
    this.y = parseRequiredAttribute(C, aModuleInst, 'y');
    this.offset = parseOptionalAttribute(I, aModuleInst, 'offset');
    this.smashed = parseOptionalAttribute(B, aModuleInst, 'smashed');
    this.rotation = parseOptionalAttribute(R, aModuleInst, 'rot');
    this.AdvanceProgressPhase();
  }
}

export class ESHEET extends EAGLE_BASE {
  description: EDESCRIPTION | null = null;
  plain: EPLAIN | null = null;
  moduleinsts = new Map<string, EMODULEINST>();
  instances: EINSTANCE[] = [];
  busses: EBUS[] = [];
  nets: ENET[] = [];

  constructor(aSheet: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    for (let child = aSheet.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (n === 'plain') {
        this.plain = new EPLAIN(child, aIo);
      } else if (n === 'moduleinsts') {
        for (let m = child.GetChildren(); m; m = m.GetNext()) {
          if (m.GetName() === 'moduleinst') {
            const inst = new EMODULEINST(m, aIo);
            this.moduleinsts.set(inst.name, inst);
          }
        }

        this.AdvanceProgressPhase();
      } else if (n === 'instances') {
        for (let inst = child.GetChildren(); inst; inst = inst.GetNext()) {
          if (inst.GetName() === 'instance') this.instances.push(new EINSTANCE(inst, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (n === 'busses') {
        for (let bus = child.GetChildren(); bus; bus = bus.GetNext()) {
          if (bus.GetName() === 'bus') this.busses.push(new EBUS(bus, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (n === 'nets') {
        for (let net = child.GetChildren(); net; net = net.GetNext()) {
          if (net.GetName() === 'net') this.nets.push(new ENET(net, aIo));
        }

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ESCHEMATIC_GROUP extends EAGLE_BASE {
  name: string;
  selectable: boolean | undefined;
  width: ECOORD | undefined;
  titleSize: ECOORD | undefined;
  titleFont: string | undefined;
  wireStyle: string | undefined;
  showAnnotations: boolean | undefined;
  layer: number | undefined;
  grouprefs: string | undefined;
  description: EDESCRIPTION | null = null;
  attributes: EATTR[] = [];

  constructor(aSchematicGroup: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    const g = aSchematicGroup;
    this.name = parseRequiredAttribute(S, g, 'name');
    this.selectable = parseOptionalAttribute(B, g, 'selectable');
    this.width = parseOptionalAttribute(C, g, 'width');
    this.titleSize = parseOptionalAttribute(C, g, 'titleSize');
    this.titleFont = parseOptionalAttribute(S, g, 'font');
    this.wireStyle = parseOptionalAttribute(S, g, 'style');
    this.showAnnotations = parseOptionalAttribute(B, g, 'showAnnotations');
    this.layer = parseOptionalAttribute(I, g, 'layer');
    this.grouprefs = parseOptionalAttribute(S, g, 'grouprefs');

    for (let child = g.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'description') this.description = new EDESCRIPTION(child, aIo);
      else if (child.GetName() === 'attribute') this.attributes.push(new EATTR(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EPORT extends EAGLE_BASE {
  name: string;
  side: string;
  coord: ECOORD;
  direction: string | undefined;

  constructor(aPort: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aPort, 'name');
    this.side = parseRequiredAttribute(S, aPort, 'side');
    this.coord = parseRequiredAttribute(C, aPort, 'coord');
    this.direction = parseOptionalAttribute(S, aPort, 'direction');
    this.AdvanceProgressPhase();
  }
}

export class EVARIANTDEF extends EAGLE_BASE {
  name: string;
  current: boolean | undefined;

  constructor(aVariantDef: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aVariantDef, 'name');
    this.current = parseOptionalAttribute(B, aVariantDef, 'current');
    this.AdvanceProgressPhase();
  }
}

/** The `name`-keyed children of `aNode`'s child elements named `aChild`. */
function mapOf<T extends { name: string }>(
  aNode: wxXmlNode,
  aChild: string,
  aMake: (n: wxXmlNode) => T,
): Map<string, T> {
  const out = new Map<string, T>();

  for (let c = aNode.GetChildren(); c; c = c.GetNext()) {
    if (c.GetName() === aChild) {
      const tmp = aMake(c);
      out.set(tmp.name, tmp);
    }
  }

  return out;
}

export class EMODULE extends EAGLE_BASE {
  name: string;
  prefix: string | undefined;
  dx: ECOORD;
  dy: ECOORD;
  description: EDESCRIPTION | null = null;
  ports = new Map<string, EPORT>();
  variantdefs = new Map<string, EVARIANTDEF>();
  groups = new Map<string, ESCHEMATIC_GROUP>();
  parts = new Map<string, EPART>();
  sheets: ESHEET[] = [];

  constructor(aModule: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aModule, 'name');
    this.prefix = parseOptionalAttribute(S, aModule, 'prefix');
    this.dx = parseRequiredAttribute(C, aModule, 'dx');
    this.dy = parseRequiredAttribute(C, aModule, 'dy');

    for (let child = aModule.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (n === 'ports') {
        for (const [k, v] of mapOf(child, 'port', (c) => new EPORT(c, aIo))) this.ports.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'variantdefs') {
        for (const [k, v] of mapOf(child, 'variantdef', (c) => new EVARIANTDEF(c, aIo)))
          this.variantdefs.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'groups') {
        for (const [k, v] of mapOf(child, 'schematic_group', (c) => new ESCHEMATIC_GROUP(c, aIo)))
          this.groups.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'parts') {
        for (const [k, v] of mapOf(child, 'part', (c) => new EPART(c, aIo))) this.parts.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'sheets') {
        for (let sheet = child.GetChildren(); sheet; sheet = sheet.GetNext()) {
          if (sheet.GetName() === 'sheet') this.sheets.push(new ESHEET(sheet, aIo));
        }

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ENOTE extends EAGLE_BASE {
  version: number;
  severity: string;
  note: string;

  constructor(aNote: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.version = parseRequiredAttribute(D, aNote, 'version');
    this.severity = parseRequiredAttribute(S, aNote, 'severity');
    this.note = aNote.GetNodeContent();
    this.AdvanceProgressPhase();
  }
}

export class ECOMPATIBILITY extends EAGLE_BASE {
  notes: ENOTE[] = [];

  constructor(aCompatibility: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    // GetNext(), as upstream: the siblings after <compatibility>, not its children
    for (let child = aCompatibility.GetNext(); child; child = child.GetNext()) {
      if (child.GetName() === 'note') this.notes.push(new ENOTE(child));
    }

    this.AdvanceProgressPhase();
  }
}

export class ESETTING extends EAGLE_BASE {
  alwaysvectorfont: boolean | undefined;
  verticaltext: string | undefined;
  keepoldvectorfont: boolean | undefined;

  constructor(aSetting: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.alwaysvectorfont = parseOptionalAttribute(B, aSetting, 'alwaysvectorfont');
    this.verticaltext = parseOptionalAttribute(S, aSetting, 'verticaltext');
    this.keepoldvectorfont = parseOptionalAttribute(B, aSetting, 'keepoldvectorfont');
    this.AdvanceProgressPhase();
  }
}

export class EGRID extends EAGLE_BASE {
  distance: number | undefined;
  unitdist: string | undefined;
  unit: string | undefined;
  style: string | undefined;
  multiple: number | undefined;
  display: boolean | undefined;
  altdistance: number | undefined;
  altunitdist: string | undefined;
  altunit: string | undefined;

  constructor(aGrid: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.distance = parseOptionalAttribute(D, aGrid, 'distance');
    this.unitdist = parseOptionalAttribute(S, aGrid, 'unitdist');
    this.unit = parseOptionalAttribute(S, aGrid, 'unit');
    this.style = parseOptionalAttribute(S, aGrid, 'style');
    this.multiple = parseOptionalAttribute(I, aGrid, 'multiple');
    this.display = parseOptionalAttribute(B, aGrid, 'display');
    this.altdistance = parseOptionalAttribute(D, aGrid, 'altdistance');
    this.altunitdist = parseOptionalAttribute(S, aGrid, 'altunitdist');
    this.altunit = parseOptionalAttribute(S, aGrid, 'altunit');
    this.AdvanceProgressPhase();
  }
}

export class EFILTER extends EAGLE_BASE {
  name: string;
  expression: string;

  constructor(aFilter: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aFilter, 'name');
    this.expression = parseRequiredAttribute(S, aFilter, 'expression');
    this.AdvanceProgressPhase();
  }
}

export class EPACKAGE extends EAGLE_BASE {
  name: string;
  urn: EURN | undefined;
  locally_modified: boolean | undefined;
  library_version: number | undefined;
  library_locally_modified: boolean | undefined;
  description: EDESCRIPTION | null = null;
  polygons: EPOLYGON[] = [];
  wires: EWIRE[] = [];
  texts: ETEXT[] = [];
  dimensions: EDIMENSION[] = [];
  circles: ECIRCLE[] = [];
  rectangles: ERECT[] = [];
  frames: EFRAME[] = [];
  holes: EHOLE[] = [];
  thtpads: EPAD[] = [];
  smdpads: ESMD[] = [];

  constructor(aPackage: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aPackage, 'name');
    this.urn = parseOptionalAttribute(U, aPackage, 'urn');
    this.locally_modified = parseOptionalAttribute(B, aPackage, 'locally_modified');
    this.library_version = parseOptionalAttribute(I, aPackage, 'library_version');
    this.library_locally_modified = parseOptionalAttribute(B, aPackage, 'library_locally_modified');

    for (let child = aPackage.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') this.description = new EDESCRIPTION(child, aIo);
      else if (n === 'polygon') this.polygons.push(new EPOLYGON(child, aIo));
      else if (n === 'wire') this.wires.push(new EWIRE(child, aIo));
      else if (n === 'text') this.texts.push(new ETEXT(child, aIo));
      else if (n === 'dimension') this.dimensions.push(new EDIMENSION(child, aIo));
      else if (n === 'circle') this.circles.push(new ECIRCLE(child, aIo));
      else if (n === 'rectangle') this.rectangles.push(new ERECT(child, aIo));
      else if (n === 'frame') this.frames.push(new EFRAME(child, aIo));
      else if (n === 'hole') this.holes.push(new EHOLE(child, aIo));
      else if (n === 'pad') this.thtpads.push(new EPAD(child, aIo));
      else if (n === 'smd') this.smdpads.push(new ESMD(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class EPACKAGEINSTANCE extends EAGLE_BASE {
  name: string;

  constructor(aPackageInstance: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aPackageInstance, 'name');
    this.AdvanceProgressPhase();
  }
}

export class EPACKAGE3D extends EAGLE_BASE {
  name: string;
  urn: EURN;
  type: string;
  library_version: number | undefined;
  library_locally_modified: boolean | undefined;
  description: EDESCRIPTION | null = null;
  packageinstances: EPACKAGEINSTANCE[] = [];

  constructor(aPackage3d: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aPackage3d, 'name');
    // urn = parseRequiredAttribute<wxString>( … ): EURN assigned from a wxString parses it
    this.urn = new EURN(parseRequiredAttribute(S, aPackage3d, 'urn'));
    this.type = parseRequiredAttribute(S, aPackage3d, 'type');
    this.library_version = parseOptionalAttribute(I, aPackage3d, 'library_version');
    this.library_locally_modified = parseOptionalAttribute(
      B,
      aPackage3d,
      'library_locally_modified',
    );

    for (let child = aPackage3d.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (child.GetName() === 'packageinstances') {
        for (let instance = child.GetChildren(); instance; instance = instance.GetNext())
          this.packageinstances.push(new EPACKAGEINSTANCE(instance, aIo));

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class ESYMBOL extends EAGLE_BASE {
  name: string;
  urn: EURN | undefined;
  locally_modified: boolean | undefined;
  library_version: number | undefined;
  library_locally_modified: boolean | undefined;
  description: EDESCRIPTION | null = null;
  polygons: EPOLYGON[] = [];
  wires: EWIRE[] = [];
  texts: ETEXT[] = [];
  dimensions: EDIMENSION[] = [];
  pins: EPIN[] = [];
  circles: ECIRCLE[] = [];
  rectangles: ERECT[] = [];
  frames: EFRAME[] = [];

  constructor(aSymbol: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.name = parseRequiredAttribute(S, aSymbol, 'name');
    this.urn = parseOptionalAttribute(U, aSymbol, 'urn');
    this.locally_modified = parseOptionalAttribute(B, aSymbol, 'locally_modified');
    this.library_version = parseOptionalAttribute(I, aSymbol, 'library_version');
    this.library_locally_modified = parseOptionalAttribute(B, aSymbol, 'library_locally_modified');

    for (let child = aSymbol.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') this.description = new EDESCRIPTION(child, aIo);
      else if (n === 'polygon') this.polygons.push(new EPOLYGON(child, aIo));
      else if (n === 'wire') this.wires.push(new EWIRE(child, aIo));
      else if (n === 'text') this.texts.push(new ETEXT(child, aIo));
      else if (n === 'dimension') this.dimensions.push(new EDIMENSION(child, aIo));
      else if (n === 'pin') this.pins.push(new EPIN(child, aIo));
      else if (n === 'circle') this.circles.push(new ECIRCLE(child, aIo));
      else if (n === 'rectangle') this.rectangles.push(new ERECT(child, aIo));
      else if (n === 'frame') this.frames.push(new EFRAME(child, aIo));
    }

    this.AdvanceProgressPhase();
  }
}

export class ELIBRARY extends EAGLE_BASE {
  name = '';
  urn: EURN | undefined;
  description: EDESCRIPTION | null = null;
  packages = new Map<string, EPACKAGE>();
  packages3d = new Map<string, EPACKAGE3D>();
  symbols = new Map<string, ESYMBOL>();
  devicesets = new Map<string, EDEVICE_SET>();

  constructor(aLibrary: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    // The name and urn attributes are only valid in schematic and board files.
    const parentNodeName = aLibrary.GetParent()?.GetName() ?? '';

    if (parentNodeName === 'libraries') {
      this.name = parseRequiredAttribute(S, aLibrary, 'name');
      this.urn = parseOptionalAttribute(U, aLibrary, 'urn');
    }

    for (let child = aLibrary.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (n === 'packages') {
        for (const [k, v] of mapOf(child, 'package', (c) => new EPACKAGE(c, aIo)))
          this.packages.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'packages3d') {
        for (const [k, v] of mapOf(child, 'package3d', (c) => new EPACKAGE3D(c, aIo)))
          this.packages3d.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'symbols') {
        for (const [k, v] of mapOf(child, 'symbol', (c) => new ESYMBOL(c, aIo)))
          this.symbols.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'devicesets') {
        for (const [k, v] of mapOf(child, 'deviceset', (c) => new EDEVICE_SET(c, aIo)))
          this.devicesets.set(k, v);
        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }

  GetName(): string {
    let libName = this.name;

    // Use the name when no library urn exists.
    if (!this.urn) return libName;

    // Suffix the library name with the urn library identifier.  Eagle schematics can have
    // mulitple libraries with the same name.  The urn library identifier is used to prevent
    // library name clashes.
    if (this.urn.IsValid()) libName += `_${this.urn.assetId}`;

    return libName;
  }
}

export class EAPPROVED extends EAGLE_BASE {
  hash: string;

  constructor(aApproved: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.hash = parseRequiredAttribute(S, aApproved, 'hash');
    this.AdvanceProgressPhase();
  }
}

export class ESCHEMATIC extends EAGLE_BASE {
  xreflabel: string | undefined;
  xrefpart: string | undefined;
  description: EDESCRIPTION | null = null;
  libraries = new Map<string, ELIBRARY>();
  attributes = new Map<string, EATTR>();
  variantdefs = new Map<string, EVARIANTDEF>();
  classes = new Map<string, ECLASS>();
  modules = new Map<string, EMODULE>();
  groups = new Map<string, ESCHEMATIC_GROUP>();
  parts = new Map<string, EPART>();
  sheets: ESHEET[] = [];
  errors: EAPPROVED[] = [];

  constructor(aSchematic: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.xreflabel = parseOptionalAttribute(S, aSchematic, 'xreflabel');
    this.xrefpart = parseOptionalAttribute(S, aSchematic, 'xrefpart');

    for (let child = aSchematic.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'description') {
        this.description = new EDESCRIPTION(child, aIo);
      } else if (n === 'libraries') {
        for (let library = child.GetChildren(); library; library = library.GetNext()) {
          if (library.GetName() === 'library') {
            const tmp = new ELIBRARY(library, aIo);

            let libName = tmp.GetName();

            // Prevent duplicate library names.  This should only happen if the Eagle
            // file has an invalid format.
            if (this.libraries.has(libName)) {
              let uniqueName = '';
              const usedNames = new Set(this.libraries.keys());

              if (usedNames.has(libName)) {
                // `uniqueName.Format( … )` is a static that returns a new string; the
                // result is discarded, so uniqueName stays empty (upstream bug, kept).
                let i = 1;

                do {
                  i += 1;
                } while (usedNames.has(uniqueName));
              }

              libName = uniqueName;
            }

            this.libraries.set(libName, tmp);
          }
        }

        this.AdvanceProgressPhase();
      } else if (n === 'attributes') {
        for (const [k, v] of mapOf(child, 'attribute', (c) => new EATTR(c, aIo)))
          this.attributes.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'variantdefs') {
        for (const [k, v] of mapOf(child, 'variantdef', (c) => new EVARIANTDEF(c, aIo)))
          this.variantdefs.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'classes') {
        for (let eclass = child.GetChildren(); eclass; eclass = eclass.GetNext()) {
          if (eclass.GetName() === 'class') {
            const tmp = new ECLASS(eclass, aIo);
            this.classes.set(tmp.number, tmp);
          }
        }

        this.AdvanceProgressPhase();
      } else if (n === 'modules') {
        for (const [k, v] of mapOf(child, 'module', (c) => new EMODULE(c, aIo)))
          this.modules.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'groups') {
        for (const [k, v] of mapOf(child, 'schematic_group', (c) => new ESCHEMATIC_GROUP(c, aIo)))
          this.groups.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'parts') {
        for (const [k, v] of mapOf(child, 'part', (c) => new EPART(c, aIo))) this.parts.set(k, v);
        this.AdvanceProgressPhase();
      } else if (n === 'sheets') {
        for (let sheet = child.GetChildren(); sheet; sheet = sheet.GetNext()) {
          if (sheet.GetName() === 'sheet') this.sheets.push(new ESHEET(sheet, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (n === 'errors') {
        for (let error = child.GetChildren(); error; error = error.GetNext()) {
          if (error.GetName() === 'approved') this.errors.push(new EAPPROVED(error, aIo));
        }

        this.AdvanceProgressPhase();
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class EDRAWING extends EAGLE_BASE {
  settings: ESETTING[] = [];
  grid: EGRID | null = null;
  filters: EFILTER[] = [];
  layers: ELAYER[] = [];
  schematic: ESCHEMATIC | null = null;
  library: ELIBRARY | null = null;

  constructor(aDrawing: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);

    for (let child = aDrawing.GetChildren(); child; child = child.GetNext()) {
      const n = child.GetName();

      if (n === 'settings') {
        for (let setting = child.GetChildren(); setting; setting = setting.GetNext())
          this.settings.push(new ESETTING(setting, aIo));

        this.AdvanceProgressPhase();
      } else if (n === 'grid') {
        this.grid = new EGRID(child, aIo);
      } else if (n === 'filters') {
        for (let filter = child.GetChildren(); filter; filter = filter.GetNext()) {
          if (filter.GetName() === 'filter') this.filters.push(new EFILTER(filter, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (n === 'layers') {
        for (let layer = child.GetChildren(); layer; layer = layer.GetNext()) {
          if (layer.GetName() === 'layer') this.layers.push(new ELAYER(layer, aIo));
        }

        this.AdvanceProgressPhase();
      } else if (n === 'schematic') {
        this.schematic = new ESCHEMATIC(child, aIo);
      } else if (n === 'library') {
        this.library = new ELIBRARY(child, aIo);
      }
    }

    this.AdvanceProgressPhase();
  }
}

export class EAGLE_DOC extends EAGLE_BASE {
  version: string;
  drawing: EDRAWING | null = null;
  compatibility: ECOMPATIBILITY | null = null;

  constructor(aEagleDoc: wxXmlNode, aIo: IO_BASE | null = null) {
    super(aIo);
    this.version = parseRequiredAttribute(S, aEagleDoc, 'version');

    for (let child = aEagleDoc.GetChildren(); child; child = child.GetNext()) {
      if (child.GetName() === 'compitibility') this.compatibility = new ECOMPATIBILITY(child, aIo);
      else if (child.GetName() === 'drawing') this.drawing = new EDRAWING(child, aIo);
    }

    this.AdvanceProgressPhase();
  }
}
