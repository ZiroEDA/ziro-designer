// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/io/cadstar/cadstar_archive_parser.cpp` / `.h`: what the CADSTAR
 * schematic (`.csa`) and PCB (`.cpa`) archive parsers share — the file read
 * into an XNODE tree (`LoadArchiveFile`), the node-attribute accessors, and
 * the structures both formats use.
 *
 * Each C++ struct is a class here whose fields carry the same defaults; a
 * `std::map` member is a {@link STD_MAP}, which keeps the C++ semantics the
 * loaders depend on: `insert` keeps the first value for a key, and iteration
 * is in key order (code point order for a `wxString` key).
 */

import { DSNLEXER, T } from '../../dsnlexer.js';
import type { EDA_TEXT } from '../../eda_text.js';

/** EDA_TEXT, or a host of it (PCB_TEXT and the rest merge it in as an interface). */
export type EDA_TEXT_LIKE = Omit<
  EDA_TEXT,
  'Replace' | 'Similarity' | 'Compare' | 'ClearRenderCache'
>;
import { IO_ERROR } from '../../exceptions.js';
import type { PROGRESS_REPORTER } from '../../progress_reporter.js';
import { convertToNewOverbarNotation, ESCAPE_CONTEXT, EscapeString } from '../../string_utils.js';
import { wxCmp } from '../../wx/wxstring.js';
import { XNODE, wxXmlNodeType } from '../../xnode.js';
import { SHAPE_ARC } from '@ziroeda/kimath/src/geometry/shape_arc.js';
import { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { CADSTAR_PIN_POSITION, CADSTAR_PIN_TYPE } from './cadstar_archive_objects.js';

export { CADSTAR_PIN_POSITION, CADSTAR_PIN_TYPE };

// ---------------------------------------------------------------------------
// std::map

/**
 * A `std::map`: `insert` does not replace an existing key, `set` is
 * `operator[] =`, and iteration is in key order.
 */
export class STD_MAP<K extends string | number, V> {
  private readonly m_map = new Map<K, V>();
  private m_sorted: [K, V][] | null = null;

  /** `insert( make_pair( k, v ) )`: false (and nothing changes) when the key is taken. */
  insert(aKey: K, aValue: V): boolean {
    if (this.m_map.has(aKey)) return false;

    this.m_map.set(aKey, aValue);
    this.m_sorted = null;
    return true;
  }

  /** `map[k] = v`. */
  set(aKey: K, aValue: V): void {
    if (!this.m_map.has(aKey)) this.m_sorted = null;

    this.m_map.set(aKey, aValue);
  }

  get(aKey: K): V | undefined {
    return this.m_map.get(aKey);
  }

  has(aKey: K): boolean {
    return this.m_map.has(aKey);
  }

  /** `map.at( k )`: throws std::out_of_range when missing. */
  at(aKey: K): V {
    if (!this.m_map.has(aKey)) throw new RangeError(`map::at: ${String(aKey)}`);

    return this.m_map.get(aKey)!;
  }

  /** `map[k]`: default-constructs the value when missing. */
  ref(aKey: K, aFactory: () => V): V {
    let v = this.m_map.get(aKey);

    if (v === undefined) {
      v = aFactory();
      this.set(aKey, v);
    }

    return v;
  }

  erase(aKey: K): boolean {
    const had = this.m_map.delete(aKey);

    if (had) this.m_sorted = null;

    return had;
  }

  get size(): number {
    return this.m_map.size;
  }

  empty(): boolean {
    return this.m_map.size === 0;
  }

  /** The entries in key order. */
  entries(): [K, V][] {
    if (!this.m_sorted) {
      this.m_sorted = [...this.m_map].sort(([a], [b]) =>
        typeof a === 'number' ? (a as number) - (b as number) : wxCmp(a as string, b as string),
      );
    }

    return this.m_sorted;
  }

  keys(): K[] {
    return this.entries().map(([k]) => k);
  }

  values(): V[] {
    return this.entries().map(([, v]) => v);
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries()[Symbol.iterator]();
  }
}

/** A `std::set<wxString>` / `std::set<long>`, iterated in order. */
export function sortedKeys<K extends string | number>(aSet: Iterable<K>): K[] {
  return [...aSet].sort((a, b) =>
    typeof a === 'number' ? (a as number) - (b as number) : wxCmp(a as string, b as string),
  );
}

// ---------------------------------------------------------------------------
// errors

/** `wxLogWarning`: shown only in a log KiCad keeps outside the reporter. */
function wxLogWarning(_aMessage: string): void {
  // intentionally silent: upstream's wxLog is not the import reporter
}

export const THROW_MISSING_NODE_IO_ERROR = (nodename: string, location: string): never => {
  throw new IO_ERROR(`Missing node '${nodename}' in '${location}'`);
};
export const THROW_UNKNOWN_NODE_IO_ERROR = (nodename: string, location: string): never => {
  throw new IO_ERROR(`Unknown node '${nodename}' in '${location}'`);
};
export const THROW_MISSING_PARAMETER_IO_ERROR = (param: string, location: string): never => {
  throw new IO_ERROR(`Missing Parameter '${param}' in '${location}'`);
};
export const THROW_UNKNOWN_PARAMETER_IO_ERROR = (param: string, location: string): never => {
  throw new IO_ERROR(`Unknown Parameter '${param}' in '${location}'`);
};
export const THROW_PARSING_IO_ERROR = (param: string, location: string): never => {
  throw new IO_ERROR(`Unable to parse '${param}' in '${location}'`);
};
export const WARN_UNKNOWN_NODE_IO_ERROR = (nodename: string, location: string): void =>
  wxLogWarning(`Unknown node '${nodename}' in '${location}'`);
export const WARN_UNKNOWN_PARAMETER_IO_ERROR = (param: string, location: string): void =>
  wxLogWarning(`Unknown Parameter '${param}' in '${location}'`);

// ---------------------------------------------------------------------------
// ids

export type LINECODE_ID = string;
export type HATCHCODE_ID = string;
export type ROUTECODE_ID = string;
export type NETCLASS_ID = string;
export type SPACING_CLASS_ID = string;
export type TEXTCODE_ID = string;
export type LAYER_ID = string;
export type VARIANT_ID = string;
export type ATTRIBUTE_ID = string;
export type SYMDEF_ID = string;
export type PART_ID = string;
export type GATE_ID = string;
export type TERMINAL_ID = number;
export type PART_DEFINITION_PIN_ID = number;
export type PART_PIN_ID = number;
export type TEXT_ID = string;
export type FIGURE_ID = string;
export type GROUP_ID = string;
export type REUSEBLOCK_ID = string;
export type NET_ID = string;
export type NETELEMENT_ID = string;
export type DOCUMENTATION_SYMBOL_ID = string;
export type COLOR_ID = string;

export const UNDEFINED_VALUE = -1;
export const UNDEFINED_LAYER_ID: LAYER_ID = '';

/** Component Name Attribute ID - typically used for placement of designators on silk screen. */
export const COMPONENT_NAME_ATTRID: ATTRIBUTE_ID = '__COMPONENT_NAME__';
/** Component Name 2 Attribute ID - typically used for indicating the placement of designators in placement drawings. */
export const COMPONENT_NAME_2_ATTRID: ATTRIBUTE_ID = '__COMPONENT_NAME_2__';
export const SYMBOL_NAME_ATTRID: ATTRIBUTE_ID = '__SYMBOL_NAME__';
export const LINK_ORIGIN_ATTRID: ATTRIBUTE_ID = '__LINK_ORIGIN__';
export const SIGNALNAME_ORIGIN_ATTRID: ATTRIBUTE_ID = '__SIGNALNAME_ORIGIN__';
export const PART_NAME_ATTRID: ATTRIBUTE_ID = '__PART_NAME__';

/**
 * CADSTAR fonts are drawn on a 24x24 integer matrix, where the max width of
 * the text is 24, and the max height is 19 (the other 5 are descender).
 */
export const TXT_HEIGHT_RATIO = (24.0 - 5.0) / 24.0;

export enum TEXT_FIELD_NAME {
  DESIGN_TITLE,
  SHORT_JOBNAME,
  LONG_JOBNAME,
  NUM_OF_SHEETS,
  SHEET_NUMBER,
  SHEET_NAME,
  VARIANT_NAME,
  VARIANT_DESCRIPTION,
  REG_USER,
  COMPANY_NAME,
  CURRENT_USER,
  DATE,
  TIME,
  MACHINE_NAME,
  FROM_FILE,
  DISTANCE,
  UNITS_SHORT,
  UNITS_ABBREV,
  UNITS_FULL,
  HYPERLINK,
  NONE, ///< Synthetic for flagging
}

/** Map between CADSTAR fields and KiCad text variables (the KiCad name, without "${}"). */
export const CADSTAR_TO_KICAD_FIELDS = new Map<TEXT_FIELD_NAME, string>([
  [TEXT_FIELD_NAME.DESIGN_TITLE, 'DESIGN_TITLE'],
  [TEXT_FIELD_NAME.SHORT_JOBNAME, 'SHORT_JOBNAME'],
  [TEXT_FIELD_NAME.LONG_JOBNAME, 'LONG_JOBNAME'],
  [TEXT_FIELD_NAME.NUM_OF_SHEETS, '##'],
  [TEXT_FIELD_NAME.SHEET_NUMBER, '#'],
  [TEXT_FIELD_NAME.SHEET_NAME, 'SHEETNAME'],
  [TEXT_FIELD_NAME.VARIANT_NAME, 'VARIANT_NAME'],
  [TEXT_FIELD_NAME.VARIANT_DESCRIPTION, 'VARIANT_DESCRIPTION'],
  [TEXT_FIELD_NAME.REG_USER, 'REG_USER'],
  [TEXT_FIELD_NAME.COMPANY_NAME, 'COMPANY_NAME'],
  [TEXT_FIELD_NAME.CURRENT_USER, 'CURRENT_USER'],
  [TEXT_FIELD_NAME.DATE, 'DATE'],
  [TEXT_FIELD_NAME.TIME, 'TIME'],
  [TEXT_FIELD_NAME.MACHINE_NAME, 'MACHINE_NAME'],
]);

export class PARSER_CONTEXT {
  /** CADSTAR doesn't have user defined text fields but does allow loading text from a file. */
  FilenamesToTextMap = new STD_MAP<string, string>();
  /** KiCad doesn't support hyperlinks but we use this map to display warning messages after import. */
  TextToHyperlinksMap = new STD_MAP<string, string>();
  /** Values for the text field elements used in the CADSTAR design extracted from the text element instances. */
  TextFieldToValuesMap = new STD_MAP<number, string>();
  /** Text fields need to be updated in CADSTAR and it is possible that they are not consistent across text elements. */
  InconsistentTextFields = new Set<TEXT_FIELD_NAME>();
  /** Callback function to report progress. */
  CheckPointCallback: () => void = () => {};
}

// ---------------------------------------------------------------------------
// node access

/** `wxString::ToLong`: strtol base 10 must consume the whole (non-empty) string. */
export function wxToLong(aStr: string): number | null {
  if (!/^[ \t\n\v\f\r]*[+-]?\d+$/.test(aStr)) return null;

  const v = Number.parseInt(aStr, 10);

  // ERANGE on a 64-bit long
  if (!Number.isFinite(v) || Math.abs(v) > 2 ** 63) return null;

  return v;
}

/** `InsertAttributeAtEnd`: the next "attrN", counted in "numAttributes". */
export function InsertAttributeAtEnd(aNode: XNODE, aValue: string): void {
  const c_numAttributes = 'numAttributes';
  let numAttributes = 0;
  const result = aNode.GetAttribute(c_numAttributes);

  if (result !== null) {
    numAttributes = Number.parseInt(result, 10) || 0; // wxAtol
    aNode.DeleteAttribute(c_numAttributes);
    ++numAttributes;
  }

  const numAttrStr = String(numAttributes);
  aNode.AddAttribute(c_numAttributes, numAttrStr);
  aNode.AddAttribute(`attr${numAttrStr}`, aValue);
}

/** `IsValidAttribute`: every attribute but the "numAttributes" counter. */
export function IsValidAttribute(aName: string): boolean {
  return aName !== 'numAttributes';
}

/** The node's "attrN" values in order (the `GetAttributes()` walk the parsers do). */
export function attributeValues(aNode: XNODE): string[] {
  return aNode
    .GetAttributes()
    .filter((a) => IsValidAttribute(a.GetName()))
    .map((a) => a.GetValueText());
}

export function GetXmlAttributeIDString(aNode: XNODE, aID: number, aIsRequired = true): string {
  const retVal = aNode.GetAttribute(`attr${aID}`);

  if (retVal === null) {
    if (aIsRequired) THROW_MISSING_PARAMETER_IO_ERROR(String(aID), aNode.GetName());
    else return '';
  }

  return retVal!;
}

export function GetXmlAttributeIDLong(aNode: XNODE, aID: number, aIsRequired = true): number {
  const v = wxToLong(GetXmlAttributeIDString(aNode, aID, aIsRequired));

  if (v === null) {
    if (aIsRequired) THROW_PARSING_IO_ERROR(String(aID), aNode.GetName());
    else return UNDEFINED_VALUE;
  }

  return v!;
}

export function CheckNoChildNodes(aNode: XNODE | null): void {
  if (aNode?.GetChildren())
    WARN_UNKNOWN_NODE_IO_ERROR(aNode.GetChildren()!.GetName(), aNode.GetName());
}

export function CheckNoNextNodes(aNode: XNODE | null): void {
  if (aNode?.GetNext())
    WARN_UNKNOWN_NODE_IO_ERROR(aNode.GetNext()!.GetName(), aNode.GetParent()!.GetName());
}

/** Iterate a node's children (`for( cNode = aNode->GetChildren(); cNode; cNode = cNode->GetNext() )`). */
export function* children(aNode: XNODE): Generator<XNODE> {
  for (let c = aNode.GetChildren(); c; c = c.GetNext()) yield c;
}

export function GetNumberOfChildNodes(aNode: XNODE): number {
  let retval = 0;

  for (let c = aNode.GetChildren(); c; c = c.GetNext()) retval++;

  return retval;
}

export function GetNumberOfStepsForReporting(
  aRootNode: XNODE,
  aSubNodeChildrenToCount: readonly string[],
): number {
  let retval = 0;

  for (let level1Node = aRootNode.GetChildren(); level1Node; level1Node = level1Node.GetNext()) {
    for (const childNodeName of aSubNodeChildrenToCount) {
      if (level1Node.GetName() === childNodeName) retval += GetNumberOfChildNodes(level1Node);
    }

    retval++;
  }

  return retval;
}

/** `wxCSConv( "windows-1252" )`: the file's bytes as text. */
function decodeWindows1252(aData: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(aData);
}

/**
 * `LoadArchiveFile`: read a CADSTAR archive (an S-expression-like text) into
 * an XNODE tree whose first word is `aFileTypeIdentifier`.
 */
export function LoadArchiveFile(
  aData: Uint8Array,
  aFileName: string,
  aFileTypeIdentifier: string,
  aProgressReporter: PROGRESS_REPORTER | null = null,
): XNODE {
  const invalid = (): never => {
    throw new IO_ERROR('The selected file is not valid or might be corrupt!');
  };

  let rootNode = null as XNODE | null;
  let cNode = null as XNODE | null;
  let iNode = null as XNODE | null;
  let cadstarFileCheckDone = false;

  const text = decodeWindows1252(aData);
  const lexer = new DSNLEXER(text, aFileName);

  let tok = lexer.NextTok();
  let reported = -1.0;

  for (; tok !== T.EOF; tok = lexer.NextTok()) {
    if (aProgressReporter) {
      const progress = lexer.InputPosition() / Math.max(1, text.length);

      if (progress - reported > 0.01) {
        if (!aProgressReporter.KeepRefreshing())
          throw new IO_ERROR('File import canceled by user.');

        aProgressReporter.SetCurrentProgress(progress);
        reported = progress;
      }
    }

    if (tok === T.RIGHT) {
      cNode = iNode;

      if (cNode) iNode = cNode.GetParent();
      else invalid();
    } else if (tok === T.LEFT) {
      tok = lexer.NextTok();
      const str = lexer.CurText();
      cNode = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, str);

      if (!rootNode) rootNode = cNode;

      if (iNode) {
        InsertAttributeAtEnd(iNode, str);
        iNode.AddChild(cNode);
      } else if (!cadstarFileCheckDone) {
        if (cNode.GetName() !== aFileTypeIdentifier) invalid();

        cadstarFileCheckDone = true;
      }

      iNode = cNode;
    } else if (iNode) {
      InsertAttributeAtEnd(iNode, lexer.CurText());
    } else {
      invalid();
    }
  }

  // Not enough closing brackets
  if (iNode !== null) invalid();

  // Throw if no data was parsed
  if (!rootNode) invalid();

  return rootNode!;
}

// ---------------------------------------------------------------------------
// text fields

const txtTokens: [TEXT_FIELD_NAME, string][] = [
  [TEXT_FIELD_NAME.DESIGN_TITLE, 'DESIGN TITLE'],
  [TEXT_FIELD_NAME.SHORT_JOBNAME, 'SHORT_JOBNAME'],
  [TEXT_FIELD_NAME.LONG_JOBNAME, 'LONG_JOBNAME'],
  [TEXT_FIELD_NAME.NUM_OF_SHEETS, 'NUM_OF_SHEETS'],
  [TEXT_FIELD_NAME.SHEET_NUMBER, 'SHEET_NUMBER'],
  [TEXT_FIELD_NAME.SHEET_NAME, 'SHEET_NAME'],
  [TEXT_FIELD_NAME.VARIANT_NAME, 'VARIANT_NAME'],
  [TEXT_FIELD_NAME.VARIANT_DESCRIPTION, 'VARIANT_DESCRIPTION'],
  [TEXT_FIELD_NAME.REG_USER, 'REG_USER'],
  [TEXT_FIELD_NAME.COMPANY_NAME, 'COMPANY_NAME'],
  [TEXT_FIELD_NAME.CURRENT_USER, 'CURRENT_USER'],
  [TEXT_FIELD_NAME.DATE, 'DATE'],
  [TEXT_FIELD_NAME.TIME, 'TIME'],
  [TEXT_FIELD_NAME.MACHINE_NAME, 'MACHINE_NAME'],
  [TEXT_FIELD_NAME.FROM_FILE, 'FROM_FILE'],
  [TEXT_FIELD_NAME.DISTANCE, 'DISTANCE'],
  [TEXT_FIELD_NAME.UNITS_SHORT, 'UNITS SHORT'],
  [TEXT_FIELD_NAME.UNITS_ABBREV, 'UNITS ABBREV'],
  [TEXT_FIELD_NAME.UNITS_FULL, 'UNITS FULL'],
  [TEXT_FIELD_NAME.HYPERLINK, 'HYPERLINK'],
];

/** `wxString::SubString( from, to )`: inclusive of `to`. */
const subString = (s: string, from: number, to: number): string => s.substring(from, to + 1);

/**
 * Replace the CADSTAR text fields ("<@FIELD...@>") with KiCad text variables,
 * recording what they held in the context.
 */
export function ParseTextFields(aTextString: string, aContext: PARSER_CONTEXT): string {
  let remainingStr = aTextString;
  let returnStr = '';

  while (remainingStr.length > 0) {
    // Find the start token
    const startpos = remainingStr.indexOf('<@');

    if (startpos < 0) {
      // No more fields to parse, add to return string
      returnStr += remainingStr;
      break;
    }

    if (startpos > 0) returnStr += subString(remainingStr, 0, startpos - 1);

    if (startpos + 2 >= remainingStr.length) break;

    remainingStr = remainingStr.substring(startpos + 2);

    let foundField = TEXT_FIELD_NAME.NONE;

    // Find the first field name in the remaining string
    for (const [field, token] of txtTokens) {
      if (remainingStr.startsWith(token)) {
        foundField = field;
        break;
      }
    }

    if (foundField === TEXT_FIELD_NAME.NONE) {
      // Not a valid field, lets keep looking
      returnStr += '<@';
      continue;
    }

    // Now lets find the end token
    const endpos = remainingStr.indexOf('@>');

    if (endpos < 0) {
      // The field we found is invalid as it doesn't have a termination
      // Lets append the whole thing as plain text
      returnStr += `<@${remainingStr}`;
      break;
    }

    const valueStart = txtTokens.find(([f]) => f === foundField)![1].length;
    let fieldValue = subString(remainingStr, valueStart, endpos - 1);
    let address = '';

    if (foundField === TEXT_FIELD_NAME.FROM_FILE || foundField === TEXT_FIELD_NAME.HYPERLINK) {
      // wxASSERT_MSG( fieldValue.at( 0 ) == '"', "Expected '\"' as the first character" );
      let splitPos = fieldValue.indexOf('"', 1);

      if (splitPos < 0) splitPos = -1 >>> 0; // npos

      address = subString(fieldValue, 1, splitPos - 1);

      if (foundField === TEXT_FIELD_NAME.HYPERLINK) {
        // Assume the last two characters are "@>"
        fieldValue = subString(remainingStr, valueStart + splitPos + 1, remainingStr.length - 3);
        remainingStr = '';
      } else {
        fieldValue = fieldValue.substring(splitPos + 1);
      }
    }

    switch (foundField) {
      case TEXT_FIELD_NAME.DESIGN_TITLE:
      case TEXT_FIELD_NAME.SHORT_JOBNAME:
      case TEXT_FIELD_NAME.LONG_JOBNAME:
      case TEXT_FIELD_NAME.VARIANT_NAME:
      case TEXT_FIELD_NAME.VARIANT_DESCRIPTION:
      case TEXT_FIELD_NAME.REG_USER:
      case TEXT_FIELD_NAME.COMPANY_NAME:
      case TEXT_FIELD_NAME.CURRENT_USER:
      case TEXT_FIELD_NAME.DATE:
      case TEXT_FIELD_NAME.TIME:
      case TEXT_FIELD_NAME.MACHINE_NAME:
        if (aContext.TextFieldToValuesMap.has(foundField)) {
          // This is a shared field, add it to inconsistent fields
          aContext.InconsistentTextFields.add(foundField);
        } else {
          aContext.TextFieldToValuesMap.insert(foundField, fieldValue);
        }

        // (KI_FALLTHROUGH upstream: these become a text variable too)
        returnStr += `\${${CADSTAR_TO_KICAD_FIELDS.get(foundField)}}`;
        break;

      case TEXT_FIELD_NAME.NUM_OF_SHEETS:
      case TEXT_FIELD_NAME.SHEET_NUMBER:
      case TEXT_FIELD_NAME.SHEET_NAME:
        returnStr += `\${${CADSTAR_TO_KICAD_FIELDS.get(foundField)}}`;
        break;

      case TEXT_FIELD_NAME.DISTANCE:
      case TEXT_FIELD_NAME.UNITS_SHORT:
      case TEXT_FIELD_NAME.UNITS_ABBREV:
      case TEXT_FIELD_NAME.UNITS_FULL:
        // Just flatten the text for distances
        returnStr += fieldValue;
        break;

      case TEXT_FIELD_NAME.FROM_FILE: {
        // wxFileName fn( address ): the base name and the extension
        const slash = Math.max(address.lastIndexOf('/'), address.lastIndexOf('\\'));
        const full = address.substring(slash + 1);
        const dot = full.lastIndexOf('.');
        const fnName = dot > 0 ? full.substring(0, dot) : full;
        const fnExt = dot > 0 ? full.substring(dot + 1) : '';
        const base = `FROM_FILE_${fnName}_${fnExt}`;
        let fieldName = base;
        let version = 1;

        while (
          aContext.FilenamesToTextMap.has(fieldName) &&
          aContext.FilenamesToTextMap.get(fieldName) !== fieldValue
        ) {
          fieldName = `${base}_${version++}`;
        }

        aContext.FilenamesToTextMap.set(fieldName, fieldValue);
        returnStr += `\${${fieldName}}`;
        break;
      }

      case TEXT_FIELD_NAME.HYPERLINK:
        aContext.TextToHyperlinksMap.set(fieldValue, address);
        returnStr += ParseTextFields(fieldValue, aContext);
        break;

      default:
        break;
    }

    // Now set the remaining string
    if (endpos + 2 >= remainingStr.length) break;

    remainingStr = remainingStr.substring(endpos + 2);
  }

  return returnStr;
}

// ---------------------------------------------------------------------------
// enums

export enum RESOLUTION {
  HUNDREDTH_MICRON,
}

export enum LINESTYLE {
  SOLID,
  DASH,
  DASHDOT,
  DASHDOTDOT,
  DOT,
}

export enum VERTEX_TYPE {
  VT_POINT,
  CLOCKWISE_ARC,
  CLOCKWISE_SEMICIRCLE,
  ANTICLOCKWISE_ARC,
  ANTICLOCKWISE_SEMICIRCLE,
}

export enum SHAPE_TYPE {
  OPENSHAPE, ///< Unfilled open shape. Cannot have cutouts.
  OUTLINE, ///< Unfilled closed shape.
  SOLID, ///< Filled closed shape (solid fill).
  HATCHED, ///< Filled closed shape (hatch fill).
}

export enum UNITS {
  DESIGN, ///< Inherits from design units (assumed Assignments->Technology->Units)
  THOU,
  INCH,
  MICROMETRE,
  MM,
  CENTIMETER,
  METER,
}

export enum ANGUNITS {
  DEGREES,
  RADIANS,
}

export enum GRID_TYPE {
  FRACTIONALGRID, ///< Param1 = Units, Param2 = Divisor. The grid is equal in X and Y dimensions
  STEPGRID, ///< Param1 = X Step, Param2 = Y Step. A standard x,y grid.
}

export enum ALIGNMENT {
  NO_ALIGNMENT, ///< NO_ALIGNMENT has different meaning depending on the object type
  TOPLEFT,
  TOPCENTER,
  TOPRIGHT,
  CENTERLEFT,
  CENTERCENTER,
  CENTERRIGHT,
  BOTTOMLEFT,
  BOTTOMCENTER,
  BOTTOMRIGHT,
}

export enum JUSTIFICATION {
  LEFT,
  CENTER,
  RIGHT,
}

export enum READABILITY {
  BOTTOM_TO_TOP, ///< When text is vertical, show it rotated 90 degrees anticlockwise
  TOP_TO_BOTTOM, ///< When text is vertical, show it rotated 90 degrees clockwise
}

export enum ATTROWNER {
  ALL_ITEMS,
  AREA,
  BOARD,
  COMPONENT,
  CONNECTION,
  COPPER,
  DOCSYMBOL,
  FIGURE,
  NET,
  NETCLASS,
  PART,
  PART_DEFINITION,
  PIN,
  SIGNALREF,
  SYMBOL,
  SYMDEF,
  TEMPLATE,
  TESTPOINT,
}

export enum ATTRUSAGE {
  BOTH,
  COMPONENT,
  PART_DEFINITION,
  PART_LIBRARY,
  SYMBOL,
  UNDEFINED,
}

export enum SWAP_RULE {
  NO_SWAP, ///< Display the text/figure on the same layer on both sides
  USE_SWAP_LAYER, ///< Use the swap layer
  BOTH, ///< Default: use both swap layer and swap position on flip
}

export const FONT_NORMAL = 400;
export const FONT_BOLD = 700;

// ---------------------------------------------------------------------------
// structures

export class FORMAT {
  Type = '';
  SomeInt = 0; ///< It is unclear what this parameter is used for
  Version = 0; ///< Archive version number (e.g. for PCB: 19=> CADSTAR 17.0 archive, ...)

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.Type = GetXmlAttributeIDString(aNode, 0);
    this.SomeInt = GetXmlAttributeIDLong(aNode, 1);
    this.Version = GetXmlAttributeIDLong(aNode, 2);
  }
}

export class TIMESTAMP {
  Year = 0;
  Month = 0;
  Day = 0;
  Hour = 0;
  Minute = 0;
  Second = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    const v: number[] = [];

    for (let i = 0; i < 6; i++) {
      const n = wxToLong(GetXmlAttributeIDString(aNode, i));

      if (n === null) THROW_PARSING_IO_ERROR('TIMESTAMP', 'HEADER');

      v.push(n!);
    }

    [this.Year, this.Month, this.Day, this.Hour, this.Minute, this.Second] = v as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
  }
}

export class HEADER {
  Format = new FORMAT();
  JobFile = '';
  JobTitle = '';
  Generator = '';
  Resolution = RESOLUTION.HUNDREDTH_MICRON;
  Timestamp = new TIMESTAMP();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const nodeName = cNode.GetName();

      if (nodeName === 'FORMAT') {
        this.Format.Parse(cNode, aContext);
      } else if (nodeName === 'JOBFILE') {
        this.JobFile = GetXmlAttributeIDString(cNode, 0);
      } else if (nodeName === 'JOBTITLE') {
        this.JobTitle = GetXmlAttributeIDString(cNode, 0);
      } else if (nodeName === 'GENERATOR') {
        this.Generator = GetXmlAttributeIDString(cNode, 0);
      } else if (nodeName === 'RESOLUTION') {
        const subNode = cNode.GetChildren()!;

        if (
          subNode.GetName() === 'METRIC' &&
          GetXmlAttributeIDString(subNode, 0) === 'HUNDREDTH' &&
          GetXmlAttributeIDString(subNode, 1) === 'MICRON'
        ) {
          this.Resolution = RESOLUTION.HUNDREDTH_MICRON;
        } else {
          // TODO Need to find out if there are other possible resolutions. Logically
          // there must be other base units that could be used, such as "IMPERIAL INCH"
          // or "METRIC MM" but so far none of settings in CADSTAR generated a different
          // output resolution to "HUNDREDTH MICRON"
          WARN_UNKNOWN_NODE_IO_ERROR(subNode.GetName(), 'HEADER->RESOLUTION');
        }
      } else if (nodeName === 'TIMESTAMP') {
        this.Timestamp.Parse(cNode, aContext);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), 'HEADER');
      }
    }
  }
}

export class VARIANT {
  ID: VARIANT_ID = '';
  ParentID: VARIANT_ID = ''; ///< if empty, then this one is the master
  Name = '';
  Description = '';

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);

    if (aNode.GetName() === 'VMASTER') {
      this.Name = GetXmlAttributeIDString(aNode, 1);
      this.Description = GetXmlAttributeIDString(aNode, 2);
    } else {
      this.ParentID = GetXmlAttributeIDString(aNode, 1);
      this.Name = GetXmlAttributeIDString(aNode, 2);
      this.Description = GetXmlAttributeIDString(aNode, 3);
    }
  }
}

export class VARIANT_HIERARCHY {
  Variants = new STD_MAP<VARIANT_ID, VARIANT>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'VMASTER' || cNode.GetName() === 'VARIANT') {
        const variant = new VARIANT();
        variant.Parse(cNode, aContext);
        this.Variants.insert(variant.ID, variant);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), cNode.GetName());
      }
    }
  }
}

export class LINECODE {
  ID: LINECODE_ID = '';
  Name = '';
  Width = 0;
  Style = LINESTYLE.SOLID;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const w = wxToLong(GetXmlAttributeIDString(aNode, 2));

    if (w === null) THROW_PARSING_IO_ERROR('Line Width', `LINECODE -> ${this.Name}`);

    this.Width = w!;

    const cNode = aNode.GetChildren();

    if (!cNode || cNode.GetName() !== 'STYLE')
      THROW_UNKNOWN_NODE_IO_ERROR(cNode!.GetName(), `LINECODE -> ${this.Name}`);

    const styleStr = GetXmlAttributeIDString(cNode!, 0);

    if (styleStr === 'SOLID') this.Style = LINESTYLE.SOLID;
    else if (styleStr === 'DASH') this.Style = LINESTYLE.DASH;
    else if (styleStr === 'DASHDOT') this.Style = LINESTYLE.DASHDOT;
    else if (styleStr === 'DASHDOTDOT') this.Style = LINESTYLE.DASHDOTDOT;
    else if (styleStr === 'DOT') this.Style = LINESTYLE.DOT;
    else WARN_UNKNOWN_PARAMETER_IO_ERROR(`STYLE ${styleStr}`, `LINECODE -> ${this.Name}`);
  }
}

export class HATCH {
  Step = 0;
  LineWidth = 0;
  OrientAngle = 0; ///< 1/1000 of a Degree

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.Step = GetXmlAttributeIDLong(aNode, 0);
    this.LineWidth = GetXmlAttributeIDLong(aNode, 2);

    const cNode = aNode.GetChildren();

    if (!cNode || cNode.GetName() !== 'ORIENT') THROW_MISSING_NODE_IO_ERROR('ORIENT', 'HATCH');

    this.OrientAngle = GetXmlAttributeIDLong(cNode!, 0);
  }
}

export class HATCHCODE {
  ID: HATCHCODE_ID = '';
  Name = '';
  Hatches: HATCH[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `HATCHCODE -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      if (cNode.GetName() !== 'HATCH') {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), location);
        continue;
      }

      const hatch = new HATCH();
      hatch.Parse(cNode, aContext);
      this.Hatches.push(hatch);
    }
  }
}

export class FONT {
  Name = 'CADSTAR';
  Modifier1 = FONT_NORMAL; ///< It seems this is related to weight. 400=Normal, 700=Bold.
  Modifier2 = 0; ///< It seems this is always 0 regardless of settings
  KerningPairs = false; ///< From CADSTAR Help: "Kerning Pairs is for causing the system to
  ///< automatically red the spacing between certain pairs of characters"
  Italic = false;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.Name = GetXmlAttributeIDString(aNode, 0);
    this.Modifier1 = GetXmlAttributeIDLong(aNode, 1);
    this.Modifier2 = GetXmlAttributeIDLong(aNode, 2);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ITALIC') this.Italic = true;
      else if (cNodeName === 'KERNING') this.KerningPairs = true;
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

export class TEXTCODE {
  ID: TEXTCODE_ID = '';
  Name = '';
  LineWidth = 0;
  Height = 0;
  Width = 0; ///< Defaults to 0 if using system fonts or, if using CADSTAR font, default to
  ///< equal height (1:1 aspect ratio). Allows for system fonts to be rendered in
  ///< a different aspect ratio.
  Font = new FONT();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    this.LineWidth = GetXmlAttributeIDLong(aNode, 2);
    this.Height = GetXmlAttributeIDLong(aNode, 3);
    this.Width = GetXmlAttributeIDLong(aNode, 4);

    const cNode = aNode.GetChildren();

    if (cNode) {
      if (cNode.GetName() === 'FONT') this.Font.Parse(cNode, aContext);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }
}

export class ROUTEREASSIGN {
  LayerID: LAYER_ID = '';
  OptimalWidth = 0;
  MinWidth = 0;
  MaxWidth = 0;
  NeckedWidth = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.LayerID = GetXmlAttributeIDString(aNode, 0);
    this.OptimalWidth = GetXmlAttributeIDLong(aNode, 1, false);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'NECKWIDTH') this.NeckedWidth = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'SROUTEWIDTH') this.OptimalWidth = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'MINWIDTH') this.MinWidth = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'MAXWIDTH') this.MaxWidth = GetXmlAttributeIDLong(cNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

export class ROUTECODE {
  ID: ROUTECODE_ID = '';
  Name = '';
  OptimalWidth = 0;
  MinWidth = 0;
  MaxWidth = 0;
  NeckedWidth = 0;
  RouteReassigns: ROUTEREASSIGN[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
    this.OptimalWidth = GetXmlAttributeIDLong(aNode, 2, false);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'NECKWIDTH') {
        this.NeckedWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'SROUTEWIDTH') {
        this.OptimalWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MINWIDTH') {
        this.MinWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MAXWIDTH') {
        this.MaxWidth = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'ROUTEREASSIGN') {
        const routereassign = new ROUTEREASSIGN();
        routereassign.Parse(cNode, aContext);
        this.RouteReassigns.push(routereassign);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

/** Represents a floating value in E notation. */
export class EVALUE {
  Base = 0;
  Exponent = 0;

  GetDouble(): number {
    return this.Base * 10.0 ** this.Exponent;
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    const b = wxToLong(GetXmlAttributeIDString(aNode, 0));
    const e = b === null ? null : wxToLong(GetXmlAttributeIDString(aNode, 1));

    if (b === null || e === null) {
      THROW_PARSING_IO_ERROR(
        'Base and Exponent',
        `${aNode.GetParent()!.GetName()}->${aNode.GetParent()!.GetName()}`,
      );
    }

    this.Base = b!;
    this.Exponent = e!;
  }
}

/** Represents a point in x,y coordinates. */
export class POINT implements VECTOR2I {
  x: number;
  y: number;

  constructor(aX = UNDEFINED_VALUE, aY = UNDEFINED_VALUE) {
    this.x = aX;
    this.y = aY;
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT | null): void {
    this.x = GetXmlAttributeIDLong(aNode, 0) | 0;
    this.y = GetXmlAttributeIDLong(aNode, 1) | 0;
  }
}

export class LONGPOINT {
  x = UNDEFINED_VALUE;
  y = UNDEFINED_VALUE;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.x = GetXmlAttributeIDLong(aNode, 0);
    this.y = GetXmlAttributeIDLong(aNode, 1);
  }
}

export type POINT_TRANSFORM = (aPoint: VECTOR2I) => VECTOR2I;

/** Represents a vertex in a shape. E.g. A circle is made by two semicircles with the same center point. */
export class VERTEX {
  Type: VERTEX_TYPE;
  End: POINT;
  Center: POINT;

  constructor(aType = VERTEX_TYPE.VT_POINT, aEnd = new POINT(), aCenter = new POINT()) {
    this.Type = aType;
    this.End = aEnd;
    this.Center = aCenter;
  }

  static IsVertex(aNode: XNODE): boolean {
    const aNodeName = aNode.GetName();

    return (
      aNodeName === 'PT' ||
      aNodeName === 'ACWARC' ||
      aNodeName === 'CWARC' ||
      aNodeName === 'CWSEMI' ||
      aNodeName === 'ACWSEMI'
    );
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    const aNodeName = aNode.GetName();

    if (aNodeName === 'PT') {
      this.Type = VERTEX_TYPE.VT_POINT;
      this.Center.x = UNDEFINED_VALUE;
      this.Center.y = UNDEFINED_VALUE;
      this.End.Parse(aNode, aContext);
    } else if (aNodeName === 'ACWARC' || aNodeName === 'CWARC') {
      this.Type =
        aNodeName === 'ACWARC' ? VERTEX_TYPE.ANTICLOCKWISE_ARC : VERTEX_TYPE.CLOCKWISE_ARC;

      const pts = ParseAllChildPoints(aNode, aContext, true, 2);

      this.Center = pts[0]!;
      this.End = pts[1]!;
    } else if (aNodeName === 'ACWSEMI' || aNodeName === 'CWSEMI') {
      this.Type =
        aNodeName === 'ACWSEMI'
          ? VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE
          : VERTEX_TYPE.CLOCKWISE_SEMICIRCLE;

      this.Center.x = UNDEFINED_VALUE;
      this.Center.y = UNDEFINED_VALUE;

      const pts = ParseAllChildPoints(aNode, aContext, true, 1);

      this.End = pts[0]!;
    }
  }

  AppendToChain(
    aChainToAppendTo: SHAPE_LINE_CHAIN,
    aCadstarToKicadPointCallback: POINT_TRANSFORM,
    aAccuracy: number,
  ): void {
    if (this.Type === VERTEX_TYPE.VT_POINT) {
      aChainToAppendTo.Append(aCadstarToKicadPointCallback(this.End));
      return;
    }

    // wxCHECK: can't append an arc to vertex to an empty chain
    if (aChainToAppendTo.PointCount() <= 0) return;

    aChainToAppendTo.Append(
      this.BuildArc(aChainToAppendTo.GetPoint(-1), aCadstarToKicadPointCallback),
      aAccuracy,
    );
  }

  BuildArc(aPrevPoint: VECTOR2I, aCadstarToKicadPointCallback: POINT_TRANSFORM): SHAPE_ARC {
    // wxCHECK: can't build an arc for a straight segment
    if (this.Type === VERTEX_TYPE.VT_POINT) return new SHAPE_ARC();

    const startPoint = aPrevPoint;
    const endPoint = aCadstarToKicadPointCallback(this.End);
    let centerPoint: VECTOR2I;

    if (
      this.Type === VERTEX_TYPE.ANTICLOCKWISE_SEMICIRCLE ||
      this.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE
    ) {
      // ( startPoint / 2 ) + ( endPoint / 2 ): VECTOR2I / double rounds
      centerPoint = {
        x: KiROUND(startPoint.x / 2) + KiROUND(endPoint.x / 2),
        y: KiROUND(startPoint.y / 2) + KiROUND(endPoint.y / 2),
      };
    } else {
      centerPoint = aCadstarToKicadPointCallback(this.Center);
    }

    let clockwise =
      this.Type === VERTEX_TYPE.CLOCKWISE_ARC || this.Type === VERTEX_TYPE.CLOCKWISE_SEMICIRCLE;

    // A bit of a hack to figure out if we need to invert clockwise due to the transform
    const t1 = aCadstarToKicadPointCallback({ x: 500, y: 500 });
    const t0 = aCadstarToKicadPointCallback({ x: 0, y: 0 });
    const transform = { x: t1.x - t0.x, y: t1.y - t0.y };

    if ((transform.x > 0 && transform.y < 0) || (transform.x < 0 && transform.y > 0))
      clockwise = !clockwise;

    return new SHAPE_ARC().ConstructFromStartEndCenter(
      startPoint,
      endPoint,
      centerPoint,
      clockwise,
    );
  }
}

/** Represents a cutout in a closed shape (e.g. OUTLINE). */
export class CUTOUT {
  Vertices: VERTEX[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.Vertices = ParseAllChildVertices(aNode, aContext, true);
  }
}

export class SHAPE {
  Type = SHAPE_TYPE.OPENSHAPE;
  Vertices: VERTEX[] = [];
  Cutouts: CUTOUT[] = []; ///< Not Applicable to OPENSHAPE Type
  HatchCodeID = ''; ///< Only Applicable for HATCHED Type

  static IsShape(aNode: XNODE): boolean {
    const n = aNode.GetName();
    return n === 'OPENSHAPE' || n === 'OUTLINE' || n === 'SOLID' || n === 'HATCHED';
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    const aNodeName = aNode.GetName();

    if (aNodeName === 'OPENSHAPE') {
      this.Type = SHAPE_TYPE.OPENSHAPE;
      this.Vertices = ParseAllChildVertices(aNode, aContext, true);
      this.Cutouts = [];
      this.HatchCodeID = '';
    } else if (aNodeName === 'OUTLINE') {
      this.Type = SHAPE_TYPE.OUTLINE;
      this.Vertices = ParseAllChildVertices(aNode, aContext, false);
      this.Cutouts = ParseAllChildCutouts(aNode, aContext, false);
      this.HatchCodeID = '';
    } else if (aNodeName === 'SOLID') {
      this.Type = SHAPE_TYPE.SOLID;
      this.Vertices = ParseAllChildVertices(aNode, aContext, false);
      this.Cutouts = ParseAllChildCutouts(aNode, aContext, false);
      this.HatchCodeID = '';
    } else if (aNodeName === 'HATCHED') {
      this.Type = SHAPE_TYPE.HATCHED;
      this.Vertices = ParseAllChildVertices(aNode, aContext, false);
      this.Cutouts = ParseAllChildCutouts(aNode, aContext, false);
      this.HatchCodeID = GetXmlAttributeIDString(aNode, 0);
    }
  }

  OutlineAsChain(
    aCadstarToKicadPointCallback: POINT_TRANSFORM,
    aMaxError: number,
  ): SHAPE_LINE_CHAIN {
    const outline = new SHAPE_LINE_CHAIN();

    if (this.Vertices.length === 0) return outline;

    for (const vertex of this.Vertices)
      vertex.AppendToChain(outline, aCadstarToKicadPointCallback, aMaxError);

    if (this.Type !== SHAPE_TYPE.OPENSHAPE) {
      outline.SetClosed(true);

      // Append after closing, to ensre first and last point remain the same
      outline.Append(outline.CPoint(0), true);
    }

    return outline;
  }

  ConvertToPolySet(
    aCadstarToKicadPointCallback: POINT_TRANSFORM,
    aMaxError: number,
  ): SHAPE_POLY_SET {
    const polyset = new SHAPE_POLY_SET();

    // wxCHECK: this shape must not be an OPENSHAPE
    if (this.Type === SHAPE_TYPE.OPENSHAPE) return polyset;

    polyset.AddOutline(this.OutlineAsChain(aCadstarToKicadPointCallback, aMaxError));

    for (const cutout of this.Cutouts) {
      const hole = new SHAPE_LINE_CHAIN();

      if (cutout.Vertices.length === 0) continue;

      for (const cutoutVertex of cutout.Vertices)
        cutoutVertex.AppendToChain(hole, aCadstarToKicadPointCallback, aMaxError);

      hole.SetClosed(true);

      // Append after closing, to ensre first and last point remain the same
      cutout.Vertices[0]!.AppendToChain(hole, aCadstarToKicadPointCallback, aMaxError);

      polyset.AddHole(hole);
    }

    return polyset;
  }
}

export function ParseUnits(aNode: XNODE): UNITS {
  const unit = GetXmlAttributeIDString(aNode, 0);

  switch (unit) {
    case 'CENTIMETER':
      return UNITS.CENTIMETER;
    case 'INCH':
      return UNITS.INCH;
    case 'METER':
      return UNITS.METER;
    case 'MICROMETRE':
      return UNITS.MICROMETRE;
    case 'MM':
      return UNITS.MM;
    case 'THOU':
      return UNITS.THOU;
    case 'DESIGN':
      return UNITS.DESIGN;
    default:
      WARN_UNKNOWN_PARAMETER_IO_ERROR(unit, 'UNITS');
      return UNITS.DESIGN;
  }
}

export function ParseAngunits(aNode: XNODE): ANGUNITS {
  const angUnitStr = GetXmlAttributeIDString(aNode, 0);

  if (angUnitStr === 'DEGREES') return ANGUNITS.DEGREES;

  if (angUnitStr === 'RADIANS') return ANGUNITS.RADIANS;

  WARN_UNKNOWN_PARAMETER_IO_ERROR(angUnitStr, aNode.GetName());
  return ANGUNITS.DEGREES;
}

export class GRID {
  Type = GRID_TYPE.STEPGRID;
  Name = '';
  Param1 = 0; ///< Either Units or X step, depending on Type (see GRID_TYPE for more details)
  Param2 = 0; ///< Either Divisor or Y step, depending on Type (see GRID_TYPE for more details)

  static IsGrid(aNode: XNODE | null): boolean {
    if (!aNode) return false;

    const n = aNode.GetName();
    return n === 'FRACTIONALGRID' || n === 'STEPGRID';
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    const aNodeName = aNode.GetName();

    if (aNodeName === 'FRACTIONALGRID') this.Type = GRID_TYPE.FRACTIONALGRID;
    else if (aNodeName === 'STEPGRID') this.Type = GRID_TYPE.STEPGRID;

    this.Name = GetXmlAttributeIDString(aNode, 0);
    this.Param1 = GetXmlAttributeIDLong(aNode, 1);
    this.Param2 = GetXmlAttributeIDLong(aNode, 2);
  }
}

export class GRIDS {
  WorkingGrid = new GRID();
  ScreenGrid = new GRID(); ///< From CADSTAR Help: "There is one Screen Grid, which is visible
  ///< as dots on the screen..."
  UserGrids: GRID[] = []; ///< List of predefined grids created by the user

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'WORKINGGRID') {
        const workingGridNode = cNode.GetChildren();

        if (!GRID.IsGrid(workingGridNode))
          WARN_UNKNOWN_NODE_IO_ERROR(
            workingGridNode ? workingGridNode.GetName() : '(empty)',
            'GRIDS -> WORKINGGRID',
          );
        else this.WorkingGrid.Parse(workingGridNode!, aContext);
      } else if (cNodeName === 'SCREENGRID') {
        const screenGridNode = cNode.GetChildren();

        if (!GRID.IsGrid(screenGridNode))
          WARN_UNKNOWN_NODE_IO_ERROR(
            screenGridNode ? screenGridNode.GetName() : '(empty)',
            'GRIDS -> SCREENGRID',
          );
        else this.ScreenGrid.Parse(screenGridNode!, aContext);
      } else if (GRID.IsGrid(cNode)) {
        const userGrid = new GRID();
        userGrid.Parse(cNode, aContext);
        this.UserGrids.push(userGrid);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'GRIDS');
      }
    }
  }
}

export class SETTINGS {
  Units = UNITS.DESIGN; ///< Units to display for linear dimensions
  UnitDisplPrecision = 0; ///< Number of decimal points to display for linear dimensions
  InterlineGap = 0; ///< For CADSTAR font only, distance between lines of text,
  ///< expressed as a percentage of the text height (accepted values are 0-100)
  BarlineGap = 0; ///< For CADSTAR font only, distance between top bar and character,
  ///< expressed as a percentage of the text height (accepted values are 0-100)
  AllowBarredText = false; ///< Specifies if barring is allowed in the design
  AngularPrecision = 0; ///< Number of decimal points to display for angular dimensions
  PinNoOffset = 0;
  PinNoAngle = 0;
  DesignOrigin = new LONGPOINT();
  DesignArea: [POINT, POINT] = [new POINT(), new POINT()];
  DesignRef = new LONGPOINT(); ///< Appears to be 0,0 always
  DesignLimit = new LONGPOINT(); ///< Max X and Y

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'UNITS') {
      this.Units = ParseUnits(aChildNode);
    } else if (cNodeName === 'UNITSPRECISION') {
      this.UnitDisplPrecision = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'INTERLINEGAP') {
      this.InterlineGap = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'BARLINEGAP') {
      this.BarlineGap = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'ALLOWBARTEXT') {
      this.AllowBarredText = true;
    } else if (cNodeName === 'ANGULARPRECISION') {
      this.AngularPrecision = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'DESIGNORIGIN') {
      this.DesignOrigin.Parse(aChildNode.GetChildren()!, aContext);
    } else if (cNodeName === 'DESIGNAREA') {
      const pts = ParseAllChildPoints(aChildNode, aContext, true, 2);
      this.DesignArea = [pts[0]!, pts[1]!];
    } else if (cNodeName === 'DESIGNREF') {
      // upstream parses DESIGNREF into DesignOrigin
      this.DesignOrigin.Parse(aChildNode.GetChildren()!, aContext);
    } else if (cNodeName === 'DESIGNLIMIT') {
      this.DesignLimit.Parse(aChildNode.GetChildren()!, aContext);
    } else if (cNodeName === 'PINNOOFFSET') {
      this.PinNoOffset = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'PINNOANGLE') {
      this.PinNoAngle = GetXmlAttributeIDLong(aChildNode, 0);
    } else {
      return false;
    }

    return true;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      if (!this.ParseSubNode(cNode, aContext))
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), 'SETTINGS');
    }
  }
}

export function ParseAlignment(aNode: XNODE): ALIGNMENT {
  const alignmentStr = GetXmlAttributeIDString(aNode, 0);

  switch (alignmentStr) {
    case 'BOTTOMCENTER':
      return ALIGNMENT.BOTTOMCENTER;
    case 'BOTTOMLEFT':
      return ALIGNMENT.BOTTOMLEFT;
    case 'BOTTOMRIGHT':
      return ALIGNMENT.BOTTOMRIGHT;
    case 'CENTERCENTER':
      return ALIGNMENT.CENTERCENTER;
    case 'CENTERLEFT':
      return ALIGNMENT.CENTERLEFT;
    case 'CENTERRIGHT':
      return ALIGNMENT.CENTERRIGHT;
    case 'TOPCENTER':
      return ALIGNMENT.TOPCENTER;
    case 'TOPLEFT':
      return ALIGNMENT.TOPLEFT;
    case 'TOPRIGHT':
      return ALIGNMENT.TOPRIGHT;
    default:
      WARN_UNKNOWN_PARAMETER_IO_ERROR(alignmentStr, 'ALIGN');
      //shouldn't be here but return a default value
      return ALIGNMENT.NO_ALIGNMENT;
  }
}

export function ParseJustification(aNode: XNODE): JUSTIFICATION {
  const justificationStr = GetXmlAttributeIDString(aNode, 0);

  if (justificationStr === 'LEFT') return JUSTIFICATION.LEFT;

  if (justificationStr === 'RIGHT') return JUSTIFICATION.RIGHT;

  if (justificationStr === 'CENTER') return JUSTIFICATION.CENTER;

  WARN_UNKNOWN_PARAMETER_IO_ERROR(justificationStr, 'JUSTIFICATION');
  return JUSTIFICATION.LEFT;
}

export function ParseReadability(aNode: XNODE): READABILITY {
  const readabilityStr = GetXmlAttributeIDString(aNode, 0);

  if (readabilityStr === 'BOTTOM_TO_TOP') return READABILITY.BOTTOM_TO_TOP;

  if (readabilityStr === 'TOP_TO_BOTTOM') return READABILITY.TOP_TO_BOTTOM;

  WARN_UNKNOWN_PARAMETER_IO_ERROR(readabilityStr, 'READABILITY');
  return READABILITY.BOTTOM_TO_TOP;
}

export class ATTRIBUTE_LOCATION {
  TextCodeID: TEXTCODE_ID = '';
  LayerID: LAYER_ID = '';
  Position = new POINT();
  OrientAngle = 0;
  Mirror = false;
  Fixed = false;
  Justification = JUSTIFICATION.LEFT; ///< Note: Justification has no effect on single lines of text
  Alignment = ALIGNMENT.NO_ALIGNMENT; ///< In CADSTAR The default alignment for a TEXT object (when
  ///< "(No Alignment)" is selected) Bottom Left of the *first line*.

  ParseIdentifiers(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.TextCodeID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 1);
  }

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'PT') this.Position.Parse(aChildNode, aContext);
    else if (cNodeName === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(aChildNode, 0);
    else if (cNodeName === 'MIRROR') this.Mirror = true;
    else if (cNodeName === 'FIX') this.Fixed = true;
    else if (cNodeName === 'ALIGN') this.Alignment = ParseAlignment(aChildNode);
    else if (cNodeName === 'JUSTIFICATION') this.Justification = ParseJustification(aChildNode);
    else return false;

    return true;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      if (!this.ParseSubNode(cNode, aContext))
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), 'ATTRLOC');
    }

    if (this.Position.x === UNDEFINED_VALUE || this.Position.y === UNDEFINED_VALUE)
      THROW_MISSING_NODE_IO_ERROR('PT', 'ATTRLOC');
  }
}

export class COLUMNORDER {
  ID = 0;
  Order = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);
    this.Order = GetXmlAttributeIDLong(aNode, 1);

    CheckNoChildNodes(aNode);
  }
}

export class COLUMNWIDTH {
  ID = 0;
  Width = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);
    this.Width = GetXmlAttributeIDLong(aNode, 1);

    CheckNoChildNodes(aNode);
  }
}

const ATTROWNER_NAMES: Record<string, ATTROWNER> = {
  ALL_ITEMS: ATTROWNER.ALL_ITEMS,
  AREA: ATTROWNER.AREA,
  BOARD: ATTROWNER.BOARD,
  COMPONENT: ATTROWNER.COMPONENT,
  CONNECTION: ATTROWNER.CONNECTION,
  COPPER: ATTROWNER.COPPER,
  DOCSYMBOL: ATTROWNER.DOCSYMBOL,
  FIGURE: ATTROWNER.FIGURE,
  NET: ATTROWNER.NET,
  NETCLASS: ATTROWNER.NETCLASS,
  PART: ATTROWNER.PART,
  PART_DEFINITION: ATTROWNER.PART_DEFINITION,
  PIN: ATTROWNER.PIN,
  SIGNALREF: ATTROWNER.SIGNALREF,
  SYMBOL: ATTROWNER.SYMBOL,
  SYMDEF: ATTROWNER.SYMDEF,
  TEMPLATE: ATTROWNER.TEMPLATE,
  TESTPOINT: ATTROWNER.TESTPOINT,
};

const ATTRUSAGE_NAMES: Record<string, ATTRUSAGE> = {
  BOTH: ATTRUSAGE.BOTH,
  COMPONENT: ATTRUSAGE.COMPONENT,
  PART_DEFINITION: ATTRUSAGE.PART_DEFINITION,
  PART_LIBRARY: ATTRUSAGE.PART_LIBRARY,
  SYMBOL: ATTRUSAGE.SYMBOL,
};

/** NOTE from CADSTAR help: "An attribute may be added to all objects of a certain type". */
export class ATTRNAME {
  ID: ATTRIBUTE_ID = '';
  Name = ''; ///< Parenthesis aren't permitted in user attributes in CADSTAR.
  AttributeOwner = ATTROWNER.ALL_ITEMS;
  AttributeUsage = ATTRUSAGE.UNDEFINED;
  NoTransfer = false; ///< True="All Design Types", False="Current Design Type"
  ColumnOrders: COLUMNORDER[] = [];
  ColumnWidths: COLUMNWIDTH[] = [];
  ColumnInvisible = false;

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `ATTRNAME -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ATTROWNER') {
        const attOwnerVal = GetXmlAttributeIDString(cNode, 0);
        const o = ATTROWNER_NAMES[attOwnerVal];

        if (o !== undefined && Object.hasOwn(ATTROWNER_NAMES, attOwnerVal)) this.AttributeOwner = o;
        else WARN_UNKNOWN_PARAMETER_IO_ERROR(attOwnerVal, location);
      } else if (cNodeName === 'ATTRUSAGE') {
        const attUsageVal = GetXmlAttributeIDString(cNode, 0);
        const u = ATTRUSAGE_NAMES[attUsageVal];

        if (u !== undefined && Object.hasOwn(ATTRUSAGE_NAMES, attUsageVal)) this.AttributeUsage = u;
        else WARN_UNKNOWN_PARAMETER_IO_ERROR(attUsageVal, location);
      } else if (cNodeName === 'NOTRANSFER') {
        this.NoTransfer = true;
      } else if (cNodeName === 'COLUMNORDER') {
        const cOrder = new COLUMNORDER();
        cOrder.Parse(cNode, aContext);
        this.ColumnOrders.push(cOrder);
      } else if (cNodeName === 'COLUMNWIDTH') {
        const cWidth = new COLUMNWIDTH();
        cWidth.Parse(cNode, aContext);
        this.ColumnWidths.push(cWidth);
      } else if (cNodeName === 'COLUMNINVISIBLE') {
        this.ColumnInvisible = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class ATTRIBUTE_VALUE {
  AttributeID: ATTRIBUTE_ID = '';
  Value = '';
  ReadOnly = false;
  HasLocation = false; ///< Flag to know if this ATTRIBUTE_VALUE has a location
  ///< i.e. is displayed
  AttributeLocation = new ATTRIBUTE_LOCATION();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.AttributeID = GetXmlAttributeIDString(aNode, 0);
    this.Value = GetXmlAttributeIDString(aNode, 1);

    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'READONLY') {
        this.ReadOnly = true;
      } else if (cNode.GetName() === 'ATTRLOC') {
        this.AttributeLocation.Parse(cNode, aContext);
        this.HasLocation = true;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), 'ATTR');
      }
    }
  }
}

/**
 * Corresponds to CADSTAR "origin". This is used for setting a location of an
 * attribute e.g. Designator (called Component Name in CADSTAR), Part Name
 * (name of component in the library), etc.
 */
export class TEXT_LOCATION extends ATTRIBUTE_LOCATION {
  AttributeID: ATTRIBUTE_ID = '';

  constructor() {
    super();
    // The default alignment for TEXT_LOCATION (when "NO_ALIGNMENT" is selected) is
    // Bottom left, matching CADSTAR's default behaviour
    this.Alignment = ALIGNMENT.BOTTOMLEFT;
  }

  override Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    const attributeStr = GetXmlAttributeIDString(aNode, 0);
    let attributeIDisSet = false;

    if (attributeStr === 'PART_NAME') {
      this.AttributeID = PART_NAME_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'COMP_NAME') {
      this.AttributeID = COMPONENT_NAME_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'COMP_NAME2') {
      this.AttributeID = COMPONENT_NAME_2_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'SYMBOL_NAME') {
      this.AttributeID = SYMBOL_NAME_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'LINK_ORIGIN') {
      this.AttributeID = LINK_ORIGIN_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'SIGNALNAME_ORIGIN') {
      this.AttributeID = SIGNALNAME_ORIGIN_ATTRID;
      attributeIDisSet = true;
    } else if (attributeStr === 'ATTRREF') {
      //We will initialise when we parse all child nodes
      attributeIDisSet = false;
    } else {
      WARN_UNKNOWN_PARAMETER_IO_ERROR(attributeStr, 'TEXTLOC');
    }

    this.TextCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2, false);

    //Parse child nodes
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (this.ParseSubNode(cNode, aContext)) {
        continue;
      } else if (!attributeIDisSet && cNodeName === 'ATTRREF') {
        this.AttributeID = GetXmlAttributeIDString(cNode, 0);
        attributeIDisSet = true;
      } else if (cNodeName === 'ORIENT') {
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'MIRROR') {
        this.Mirror = true;
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'ALIGN') {
        this.Alignment = ParseAlignment(cNode);
      } else if (cNodeName === 'JUSTIFICATION') {
        this.Justification = ParseJustification(cNode);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'TEXTLOC');
      }
    }

    if (this.Position.x === UNDEFINED_VALUE || this.Position.y === UNDEFINED_VALUE)
      THROW_MISSING_NODE_IO_ERROR('PT', 'TEXTLOC');
  }
}

export class CADSTAR_NETCLASS {
  ID: NETCLASS_ID = '';
  Name = '';
  Attributes: ATTRIBUTE_VALUE[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    const location = `NETCLASS -> ${this.Name}`;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'ATTR') {
        const attribute_val = new ATTRIBUTE_VALUE();
        attribute_val.Parse(cNode, aContext);
        this.Attributes.push(attribute_val);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class SPCCLASSNAME {
  ID: SPACING_CLASS_ID = '';
  Name = '';

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
  }
}

export class CODEDEFS {
  LineCodes = new STD_MAP<LINECODE_ID, LINECODE>();
  HatchCodes = new STD_MAP<HATCHCODE_ID, HATCHCODE>();
  TextCodes = new STD_MAP<TEXTCODE_ID, TEXTCODE>();
  RouteCodes = new STD_MAP<ROUTECODE_ID, ROUTECODE>();
  AttributeNames = new STD_MAP<ATTRIBUTE_ID, ATTRNAME>();
  NetClasses = new STD_MAP<NETCLASS_ID, CADSTAR_NETCLASS>();
  SpacingClassNames = new STD_MAP<SPACING_CLASS_ID, SPCCLASSNAME>();

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const nodeName = aChildNode.GetName();

    if (nodeName === 'LINECODE') {
      const linecode = new LINECODE();
      linecode.Parse(aChildNode, aContext);
      this.LineCodes.insert(linecode.ID, linecode);
    } else if (nodeName === 'HATCHCODE') {
      const hatchcode = new HATCHCODE();
      hatchcode.Parse(aChildNode, aContext);
      this.HatchCodes.insert(hatchcode.ID, hatchcode);
    } else if (nodeName === 'TEXTCODE') {
      const textcode = new TEXTCODE();
      textcode.Parse(aChildNode, aContext);
      this.TextCodes.insert(textcode.ID, textcode);
    } else if (nodeName === 'ROUTECODE') {
      const routecode = new ROUTECODE();
      routecode.Parse(aChildNode, aContext);
      this.RouteCodes.insert(routecode.ID, routecode);
    } else if (nodeName === 'ATTRNAME') {
      const attrname = new ATTRNAME();
      attrname.Parse(aChildNode, aContext);
      this.AttributeNames.insert(attrname.ID, attrname);
    } else if (nodeName === 'NETCLASS') {
      const netclass = new CADSTAR_NETCLASS();
      netclass.Parse(aChildNode, aContext);
      this.NetClasses.insert(netclass.ID, netclass);
    } else if (nodeName === 'SPCCLASSNAME') {
      const spcclassname = new SPCCLASSNAME();
      spcclassname.Parse(aChildNode, aContext);
      this.SpacingClassNames.insert(spcclassname.ID, spcclassname);
    } else {
      return false;
    }

    return true;
  }
}

export function ParseSwapRule(aNode: XNODE): SWAP_RULE {
  const swapRuleStr = GetXmlAttributeIDString(aNode, 0);

  if (swapRuleStr === 'NO_SWAP') return SWAP_RULE.NO_SWAP;

  if (swapRuleStr === 'USE_SWAP_LAYER') return SWAP_RULE.USE_SWAP_LAYER;

  WARN_UNKNOWN_PARAMETER_IO_ERROR(swapRuleStr, 'SWAPRULE');
  return SWAP_RULE.NO_SWAP;
}

export class REUSEBLOCK {
  ID: REUSEBLOCK_ID = '';
  Name = '';
  FileName = ''; ///< Filename of the reuse block (usually a .pcb). Used for reloading
  Mirror = false;
  OrientAngle = 0;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
    this.FileName = GetXmlAttributeIDString(aNode, 2);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'MIRROR') this.Mirror = true;
      else if (cNodeName === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'REUSEBLOCK');
    }
  }
}

/** References an element from a design reuse block. */
export class REUSEBLOCKREF {
  ReuseBlockID: REUSEBLOCK_ID = '';
  ItemReference = ''; ///< For Components, this references the designator in the reuse file.
  ///< For net elements (such as vias, routes, etc.), coppers and templates,
  ///< this parameter is blank.

  /** Determines if this is empty (i.e. no design reuse associated). */
  IsEmpty(): boolean {
    return this.ReuseBlockID === '' && this.ItemReference === '';
  }

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ReuseBlockID = GetXmlAttributeIDString(aNode, 0);
    this.ItemReference = GetXmlAttributeIDString(aNode, 1);

    CheckNoChildNodes(aNode);
  }
}

export class GROUP {
  ID: GROUP_ID = '';
  Name = '';
  Fixed = false;
  Transfer = false; ///< If true, the group is transferred to PCB
  GroupID: GROUP_ID = ''; ///< If not empty, this GROUP is part of another GROUP
  ReuseBlockRef = new REUSEBLOCKREF();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'FIX') this.Fixed = true;
      else if (cNodeName === 'TRANSFER') this.Transfer = true;
      else if (cNodeName === 'GROUPREF') this.GroupID = GetXmlAttributeIDString(cNode, 0);
      else if (cNodeName === 'REUSEBLOCKREF') this.ReuseBlockRef.Parse(cNode, aContext);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'GROUP');
    }
  }
}

export class FIGURE {
  ID: FIGURE_ID = '';
  LineCodeID: LINECODE_ID = '';
  LayerID: LAYER_ID = '';
  Shape = new SHAPE(); ///< Uses the component's coordinate frame if within a component
  ///< definition, otherwise uses the design's coordinate frame.
  GroupID: GROUP_ID = ''; ///< If not empty, this FIGURE is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  SwapRule = SWAP_RULE.BOTH; ///< Only applicable to Figures in Components
  Fixed = false;
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LineCodeID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    let shapeIsInitialised = false; // Stop more than one Shape Object
    const location = `Figure ${this.ID}`;

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('Shape', location);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!shapeIsInitialised && SHAPE.IsShape(cNode)) {
        this.Shape.Parse(cNode, aContext);
        shapeIsInitialised = true;
      } else if (cNodeName === 'SWAPRULE') {
        this.SwapRule = ParseSwapRule(cNode);
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, location);
      }
    }
  }
}

export class TEXT {
  ID: TEXT_ID = '';
  Text = ''; //TODO: Need to lex/parse to identify design fields and hyperlinks
  TextCodeID: TEXTCODE_ID = '';
  LayerID: LAYER_ID = '';
  Position = new POINT();
  OrientAngle = 0;
  Mirror = false;
  Fixed = false;
  SwapRule = SWAP_RULE.BOTH;
  Justification = JUSTIFICATION.LEFT; ///< Note: has no effect on single lines of text
  Alignment = ALIGNMENT.NO_ALIGNMENT; ///< In CADSTAR The default alignment for a TEXT object (when
  ///< "(No Alignment)" is selected) Bottom Left of the *first line*.
  GroupID: GROUP_ID = ''; ///< If not empty, this FIGURE is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT, aParseFields = true): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);

    //TODO: Need to lex/parse to identify design fields and hyperlinks
    this.Text = GetXmlAttributeIDString(aNode, 1);

    if (aParseFields) this.Text = ParseTextFields(this.Text, aContext);

    this.TextCodeID = GetXmlAttributeIDString(aNode, 2);
    this.LayerID = GetXmlAttributeIDString(aNode, 3);

    if (!aNode.GetChildren()) THROW_MISSING_NODE_IO_ERROR('PT', 'TEXT');

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PT') this.Position.Parse(cNode, aContext);
      else if (cNodeName === 'ORIENT') this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      else if (cNodeName === 'MIRROR') this.Mirror = true;
      else if (cNodeName === 'FIX') this.Fixed = true;
      else if (cNodeName === 'SWAPRULE') this.SwapRule = ParseSwapRule(cNode);
      else if (cNodeName === 'ALIGN') this.Alignment = ParseAlignment(cNode);
      else if (cNodeName === 'JUSTIFICATION') this.Justification = ParseJustification(cNode);
      else if (cNodeName === 'GROUPREF') this.GroupID = GetXmlAttributeIDString(cNode, 0);
      else if (cNodeName === 'REUSEBLOCKREF') this.ReuseBlockRef.Parse(cNode, aContext);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, 'TEXT');
    }
  }
}

export class SYMDEF {
  ID: SYMDEF_ID = '';
  ReferenceName = ''; ///< This is the name which identifies the symbol in the library
  ///< Multiple components may exist with the same ReferenceName.
  Alternate = ''; ///< This is in addition to ReferenceName. It allows defining
  ///< different versions, views etc. of the same basic symbol.
  Origin = new POINT(); ///< Origin of the component (this is used as the reference point
  ///< when placing the component in the design)
  Stub = false; ///< When the CADSTAR Archive file is exported without the
  ///< component library, if components on the board are still exported, the
  ///< Reference and Alternate names will still be exported but the content
  ///< is replaced with a "stub" (i.e. there's no Origin)
  Version = UNDEFINED_VALUE; ///< Version is a sequential integer number to identify
  ///< discrepancies between the library and the design.

  Figures = new STD_MAP<FIGURE_ID, FIGURE>();
  Texts = new STD_MAP<TEXT_ID, TEXT>();
  TextLocations = new STD_MAP<ATTRIBUTE_ID, TEXT_LOCATION>(); ///< This contains location of
  ///< any attributes, including designator position
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>(); ///< These attributes might also
  ///< have a location

  BuildLibName(): string {
    return generateLibName(this.ReferenceName, this.Alternate);
  }

  ParseIdentifiers(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.ReferenceName = GetXmlAttributeIDString(aNode, 1);
    this.Alternate = GetXmlAttributeIDString(aNode, 2);
  }

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'PT') {
      this.Origin.Parse(aChildNode, aContext);
    } else if (cNodeName === 'STUB') {
      this.Stub = true;
    } else if (cNodeName === 'VERSION') {
      this.Version = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'FIGURE') {
      const figure = new FIGURE();
      figure.Parse(aChildNode, aContext);
      this.Figures.insert(figure.ID, figure);
    } else if (cNodeName === 'TEXT') {
      const txt = new TEXT();
      txt.Parse(aChildNode, aContext);
      this.Texts.insert(txt.ID, txt);
    } else if (cNodeName === 'TEXTLOC') {
      const textloc = new TEXT_LOCATION();
      textloc.Parse(aChildNode, aContext);
      this.TextLocations.insert(textloc.AttributeID, textloc);
    } else if (cNodeName === 'ATTR') {
      const attrVal = new ATTRIBUTE_VALUE();
      attrVal.Parse(aChildNode, aContext);
      this.AttributeValues.insert(attrVal.AttributeID, attrVal);
    } else {
      return false;
    }

    return true;
  }
}

const PIN_TYPE_MAP = new Map<string, CADSTAR_PIN_TYPE>([
  ['INPUT', CADSTAR_PIN_TYPE.PIN_INPUT],
  ['OUTPUT_OR', CADSTAR_PIN_TYPE.OUTPUT_OR],
  ['OUTPUT_NOT_OR', CADSTAR_PIN_TYPE.OUTPUT_NOT_OR],
  ['OUTPUT_NOT_NORM_OR', CADSTAR_PIN_TYPE.OUTPUT_NOT_NORM_OR],
  ['POWER', CADSTAR_PIN_TYPE.POWER],
  ['GROUND', CADSTAR_PIN_TYPE.GROUND],
  ['TRISTATE_BIDIR', CADSTAR_PIN_TYPE.TRISTATE_BIDIR],
  ['TRISTATE_INPUT', CADSTAR_PIN_TYPE.TRISTATE_INPUT],
  ['TRISTATE_DRIVER', CADSTAR_PIN_TYPE.TRISTATE_DRIVER],
]);

export function GetPinType(aNode: XNODE): CADSTAR_PIN_TYPE {
  const pinTypeStr = GetXmlAttributeIDString(aNode, 0);
  const t = PIN_TYPE_MAP.get(pinTypeStr);

  if (t === undefined) {
    WARN_UNKNOWN_PARAMETER_IO_ERROR(pinTypeStr, aNode.GetName());
    return CADSTAR_PIN_TYPE.UNCOMMITTED;
  }

  return t;
}

export class PART_GATE {
  ID: GATE_ID = '';
  Name = ''; ///< Symbol name in the symbol library
  Alternate = ''; ///< Symbol alternate name in the symbol library
  PinCount = 0; ///< Number of pins (terminals) in the symbol

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);
    this.Alternate = GetXmlAttributeIDString(aNode, 2);
    this.PinCount = GetXmlAttributeIDLong(aNode, 3);

    CheckNoChildNodes(aNode);
  }
}

export class PART_DEFINITION_PIN {
  ID: PART_DEFINITION_PIN_ID = UNDEFINED_VALUE;
  Identifier = ''; ///< This should match a pad identifier in the component footprint
  ///< subnode="PINIDENTIFIER". It is assumed that this could be empty in earlier versions of CADSTAR
  Name = ''; ///< Can be empty. If empty the pin name displayed will be the Identifier.
  Label = ''; ///< This Can be empty (subnode= "PINLABEL")
  ///< From CADSTAR Help: "Pin Labels are an optional replacement for the free
  ///< text sometimes placed in schematic symbols. ..."
  Signal = ''; ///< Usually for Power/Ground pins, (subnode="PINSIGNAL")
  TerminalGate: GATE_ID = '';
  TerminalPin: TERMINAL_ID = 0;
  Type = CADSTAR_PIN_TYPE.UNCOMMITTED; ///< subnode="PINTYPE"
  Load = UNDEFINED_VALUE; ///< The electrical current expected on the pin (It is unclear
  ///< what the units are, but only accepted values are integers) subnode ="PINLOAD"
  Position = CADSTAR_PIN_POSITION.TOP_RIGHT; ///< The pin names will use these positions
  ///< when the symbol is placed on the design.

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PINNAME') {
        this.Name = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'PINLABEL') {
        this.Label = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'PINSIGNAL') {
        this.Signal = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'PINTERM') {
        this.TerminalGate = GetXmlAttributeIDString(cNode, 0);
        this.TerminalPin = GetXmlAttributeIDLong(cNode, 1);
      } else if (cNodeName === 'PINTYPE') {
        this.Type = GetPinType(cNode);
      } else if (cNodeName === 'PINLOAD') {
        this.Load = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'PINPOSITION') {
        this.Position = GetXmlAttributeIDLong(cNode, 0) as CADSTAR_PIN_POSITION;
      } else if (cNodeName === 'PINIDENTIFIER') {
        this.Identifier = GetXmlAttributeIDString(cNode, 0);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

function parsePinIdList(aNode: XNODE, aError: (v: string) => never): PART_DEFINITION_PIN_ID[] {
  const ids: PART_DEFINITION_PIN_ID[] = [];

  for (const value of attributeValues(aNode)) {
    const pinId = wxToLong(value);

    if (pinId === null) aError(value);

    ids.push(pinId!);
  }

  CheckNoChildNodes(aNode);
  return ids;
}

export class PIN_EQUIVALENCE {
  PinIDs: PART_DEFINITION_PIN_ID[] = []; ///< All the pins in this vector are equivalent

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.PinIDs = parsePinIdList(aNode, (v) =>
      THROW_UNKNOWN_PARAMETER_IO_ERROR(v, aNode.GetName()),
    );
  }
}

export class SWAP_GATE {
  PinIDs: PART_DEFINITION_PIN_ID[] = []; ///< The Pins in this vector describe a "gate"

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.PinIDs = parsePinIdList(aNode, (v) =>
      THROW_UNKNOWN_PARAMETER_IO_ERROR(v, aNode.GetName()),
    );
  }
}

export class SWAP_GROUP {
  GateName = ''; ///< Optional. If not empty, should match the Name attribute of one of the gates
  External = false; ///< Determines if this swap group is external (and internal) or internal only.
  SwapGates: SWAP_GATE[] = []; ///< Each of the elements in this vector can be swapped with each other

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.GateName = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'EXTERNAL') {
        this.External = true;
      } else if (cNodeName === 'SWAPGATE') {
        const swapGate = new SWAP_GATE();
        swapGate.Parse(cNode, aContext);
        this.SwapGates.push(swapGate);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class PART_DEFINITION {
  Name = ''; ///< This name can be different to the PART name
  HidePinNames = false; ///< Specifies whether to display the pin names/identifier in
  ///< the schematic symbol or not. E.g. "Resistor" doesn't need pin names
  MaxPinCount = UNDEFINED_VALUE; ///< Optional parameter which is used for specifying the number
  ///< of electrical pins on the PCB component symbol to be used in the part definition

  GateSymbols = new STD_MAP<GATE_ID, PART_GATE>();
  Pins = new STD_MAP<PART_DEFINITION_PIN_ID, PART_DEFINITION_PIN>();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>(); ///< Some attributes are defined
  ///< within the part definition, whilst others are defined in the part
  PinEquivalences: PIN_EQUIVALENCE[] = [];
  SwapGroups: SWAP_GROUP[] = [];

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.Name = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'HIDEPINNAMES') {
        this.HidePinNames = true;
      } else if (cNodeName === 'MAXPIN') {
        this.MaxPinCount = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'GATEDEFINITION') {
        const gate = new PART_GATE();
        gate.Parse(cNode, aContext);
        this.GateSymbols.insert(gate.ID, gate);
      } else if (cNodeName === 'PARTDEFINITIONPIN') {
        const pin = new PART_DEFINITION_PIN();
        pin.Parse(cNode, aContext);
        this.Pins.insert(pin.ID, pin);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else if (cNodeName === 'PINEQUIVALENCE') {
        const pinEq = new PIN_EQUIVALENCE();
        pinEq.Parse(cNode, aContext);
        this.PinEquivalences.push(pinEq);
      } else if (cNodeName === 'SWAPGROUP') {
        const swapGroup = new SWAP_GROUP();
        swapGroup.Parse(cNode, aContext);
        this.SwapGroups.push(swapGroup);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class PART_PIN {
  ID: PART_PIN_ID = 0;
  Name = '';
  Type = CADSTAR_PIN_TYPE.UNCOMMITTED;
  Identifier = '';

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDLong(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PINNAME') this.Name = GetXmlAttributeIDString(cNode, 0);
      else if (cNodeName === 'PINTYPE') this.Type = GetPinType(cNode);
      else if (cNodeName === 'PINIDENTIFIER') this.Identifier = GetXmlAttributeIDString(cNode, 0);
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

export class PART {
  ID: PART_ID = '';
  Name = '';
  Version = 0;
  Definition = new PART_DEFINITION();
  PartPins = new STD_MAP<PART_PIN_ID, PART_PIN>(); ///< It is unclear why there are two "Pin" structures in CPA files...
  HidePinNames = false; ///< This seems to be a duplicate of DEFINITION::HidePinNames
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.Name = GetXmlAttributeIDString(aNode, 1);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'VERSION') {
        this.Version = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'HIDEPINNAMES') {
        this.HidePinNames = true;
      } else if (cNodeName === 'PARTDEFINITION') {
        this.Definition.Parse(cNode, aContext);
      } else if (cNodeName === 'PARTPIN') {
        const pin = new PART_PIN();
        pin.Parse(cNode, aContext);
        this.PartPins.insert(pin.ID, pin);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class PARTS {
  PartDefinitions = new STD_MAP<PART_ID, PART>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'PART') {
        const part = new PART();
        part.Parse(cNode, aContext);
        this.PartDefinitions.insert(part.ID, part);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }

      aContext.CheckPointCallback();
    }
  }
}

export class JUNCTION {
  ID: NETELEMENT_ID = '';
  LayerID: LAYER_ID = '';
  Location = new POINT();
  GroupID: GROUP_ID = ''; ///< If not empty, this JUNCTION is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  Fixed = false;

  ParseIdentifiers(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.LayerID = GetXmlAttributeIDString(aNode, 1);
  }

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'PT') this.Location.Parse(aChildNode, aContext);
    else if (cNodeName === 'FIX') this.Fixed = true;
    else if (cNodeName === 'GROUPREF') this.GroupID = GetXmlAttributeIDString(aChildNode, 0);
    else if (cNodeName === 'REUSEBLOCKREF') this.ReuseBlockRef.Parse(aChildNode, aContext);
    else return false;

    return true;
  }

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ParseIdentifiers(aNode, aContext);

    for (const cNode of children(aNode)) {
      if (!this.ParseSubNode(cNode, aContext))
        WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }
}

export class CONNECTION {
  StartNode: NETELEMENT_ID = '';
  EndNode: NETELEMENT_ID = '';
  RouteCodeID: ROUTECODE_ID = '';
  Fixed = false;
  Hidden = false;
  GroupID: GROUP_ID = ''; ///< If not empty, this connection is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>(); ///< It is possible to add
  ///< attributes solely to a particular connection

  ParseIdentifiers(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.StartNode = GetXmlAttributeIDString(aNode, 0);
    this.EndNode = GetXmlAttributeIDString(aNode, 1);
    this.RouteCodeID = GetXmlAttributeIDString(aNode, 2);
  }

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'FIX') {
      this.Fixed = true;
    } else if (cNodeName === 'HIDDEN') {
      this.Hidden = true;
    } else if (cNodeName === 'GROUPREF') {
      this.GroupID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'REUSEBLOCKREF') {
      this.ReuseBlockRef.Parse(aChildNode, aContext);
    } else if (cNodeName === 'ATTR') {
      const attrVal = new ATTRIBUTE_VALUE();
      attrVal.Parse(aChildNode, aContext);
      this.AttributeValues.insert(attrVal.AttributeID, attrVal);
    } else {
      return false;
    }

    return true;
  }
}

export class NET {
  ID: NET_ID = '';
  RouteCodeID: ROUTECODE_ID = ''; //"NETCODE" subnode
  SignalNum = UNDEFINED_VALUE; ///< This is undefined if the net has been given a name
  Name = ''; ///< This is undefined (wxEmptyString) if the net is unnamed.
  ///< "SIGNAME" node
  Highlight = false;

  Junctions = new STD_MAP<NETELEMENT_ID, JUNCTION>();
  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  NetClassID: NETCLASS_ID = ''; ///< The net might not have a net class, in which case it will be
  ///< wxEmptyString ("NETCLASSREF" subnode)
  SpacingClassID: SPACING_CLASS_ID = ''; ///< The net might not have a spacing class, in which
  ///< case it will be wxEmptyString ("SPACINGCLASS" subnode)

  ParseIdentifiers(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
  }

  ParseSubNode(aChildNode: XNODE, aContext: PARSER_CONTEXT): boolean {
    const cNodeName = aChildNode.GetName();

    if (cNodeName === 'NETCODE') {
      this.RouteCodeID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SIGNAME') {
      this.Name = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SIGNUM') {
      this.SignalNum = GetXmlAttributeIDLong(aChildNode, 0);
    } else if (cNodeName === 'HIGHLIT') {
      this.Highlight = true;
    } else if (cNodeName === 'JPT') {
      const jpt = new JUNCTION();
      jpt.Parse(aChildNode, aContext);
      this.Junctions.insert(jpt.ID, jpt);
    } else if (cNodeName === 'NETCLASSREF') {
      this.NetClassID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'SPACINGCLASS') {
      this.SpacingClassID = GetXmlAttributeIDString(aChildNode, 0);
    } else if (cNodeName === 'ATTR') {
      const attrVal = new ATTRIBUTE_VALUE();
      attrVal.Parse(aChildNode, aContext);
      this.AttributeValues.insert(attrVal.AttributeID, attrVal);
    } else {
      return false;
    }

    return true;
  }
}

/**
 * A symbol that is used for documentation purposes: CADSTAR allows placing a
 * "documentation symbol" in a design, which is a copy of a SYMDEF.
 */
export class DOCUMENTATION_SYMBOL {
  ID: DOCUMENTATION_SYMBOL_ID = '';
  SymdefID: SYMDEF_ID = ''; ///< Normally documentation symbols only have TEXT, FIGURE and
  ///< TEXT_LOCATION objects which are all drawn on the "(Undefined)" layer (i.e. no layer)
  LayerID: LAYER_ID = ''; ///< Move all objects in the Symdef to this layer.
  Origin = new POINT(); ///< Origin of the component (this is used as the reference point
  ///< when placing the component in the design)
  GroupID: GROUP_ID = ''; ///< If not empty, this component is part of a group
  ReuseBlockRef = new REUSEBLOCKREF();
  OrientAngle = 0;
  Mirror = false;
  Fixed = false;
  Readability = READABILITY.BOTTOM_TO_TOP;

  ScaleRatioNumerator = 1; ///< Documentation symbols can be arbitrarily scaled when added to a design
  ScaleRatioDenominator = 1; ///< Documentation symbols can be arbitrarily scaled when added to a design

  AttributeValues = new STD_MAP<ATTRIBUTE_ID, ATTRIBUTE_VALUE>();

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    this.ID = GetXmlAttributeIDString(aNode, 0);
    this.SymdefID = GetXmlAttributeIDString(aNode, 1);
    this.LayerID = GetXmlAttributeIDString(aNode, 2);

    let originParsed = false;

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (!originParsed && cNodeName === 'PT') {
        this.Origin.Parse(cNode, aContext);
        originParsed = true;
      } else if (cNodeName === 'GROUPREF') {
        this.GroupID = GetXmlAttributeIDString(cNode, 0);
      } else if (cNodeName === 'REUSEBLOCKREF') {
        this.ReuseBlockRef.Parse(cNode, aContext);
      } else if (cNodeName === 'FIX') {
        this.Fixed = true;
      } else if (cNodeName === 'MIRROR') {
        this.Mirror = true;
      } else if (cNodeName === 'READABILITY') {
        this.Readability = ParseReadability(cNode);
      } else if (cNodeName === 'ORIENT') {
        this.OrientAngle = GetXmlAttributeIDLong(cNode, 0);
      } else if (cNodeName === 'ATTR') {
        const attr = new ATTRIBUTE_VALUE();
        attr.Parse(cNode, aContext);
        this.AttributeValues.insert(attr.AttributeID, attr);
      } else if (cNodeName === 'SCALE') {
        this.ScaleRatioNumerator = GetXmlAttributeIDLong(cNode, 0);
        this.ScaleRatioDenominator = GetXmlAttributeIDLong(cNode, 1);
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }

    if (!originParsed) THROW_MISSING_PARAMETER_IO_ERROR('PT', aNode.GetName());
  }
}

export class DFLTSETTINGS {
  Color: COLOR_ID = '';
  IsVisible = true;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.Color = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      if (cNode.GetName() === 'INVISIBLE') this.IsVisible = false;
      else WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }
}

export class ATTRCOL {
  AttributeID: ATTRIBUTE_ID = '';
  Color: COLOR_ID = '';
  IsVisible = true;
  IsPickable = true;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.AttributeID = GetXmlAttributeIDString(aNode, 0);
    this.Color = GetXmlAttributeIDString(aNode, 1);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'INVISIBLE') this.IsVisible = false;
      else if (cNodeName === 'NOTPICKABLE') this.IsPickable = false;
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

export class ATTRCOLORS {
  DefaultSettings = new DFLTSETTINGS();
  AttributeColors = new STD_MAP<ATTRIBUTE_ID, ATTRCOL>();
  IsVisible = true; // unclear what this represents - maybe all attributes are hidden?

  Parse(aNode: XNODE, aContext: PARSER_CONTEXT): void {
    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'DFLTSETTINGS') {
        this.DefaultSettings.Parse(cNode, aContext);
      } else if (cNodeName === 'ATTRCOL') {
        const attrcol = new ATTRCOL();
        attrcol.Parse(cNode, aContext);
        this.AttributeColors.insert(attrcol.AttributeID, attrcol);
      } else if (cNodeName === 'INVISIBLE') {
        this.IsVisible = false;
      } else {
        WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
      }
    }
  }
}

export class PARTNAMECOL {
  Color: COLOR_ID = '';
  IsVisible = true;
  IsPickable = true;

  Parse(aNode: XNODE, _aContext: PARSER_CONTEXT): void {
    this.Color = GetXmlAttributeIDString(aNode, 0);

    for (const cNode of children(aNode)) {
      const cNodeName = cNode.GetName();

      if (cNodeName === 'INVISIBLE') this.IsVisible = false;
      else if (cNodeName === 'NOTPICKABLE') this.IsPickable = false;
      else WARN_UNKNOWN_NODE_IO_ERROR(cNodeName, aNode.GetName());
    }
  }
}

// ---------------------------------------------------------------------------
// child collections

export function ParseChildEValue(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aValueToParse: EVALUE,
): void {
  if (aNode.GetChildren()!.GetName() === 'E') aValueToParse.Parse(aNode.GetChildren()!, aContext);
  else WARN_UNKNOWN_NODE_IO_ERROR(aNode.GetChildren()!.GetName(), aNode.GetName());
}

export function ParseAllChildPoints(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aTestAllChildNodes = false,
  aExpectedNumPoints = UNDEFINED_VALUE,
): POINT[] {
  const retVal: POINT[] = [];

  for (const cNode of children(aNode)) {
    if (cNode.GetName() === 'PT') {
      const pt = new POINT();
      //TODO try.. catch + throw again with more detailed error information
      pt.Parse(cNode, aContext);
      retVal.push(pt);
    } else if (aTestAllChildNodes) {
      WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }

  if (aExpectedNumPoints !== UNDEFINED_VALUE && retVal.length !== aExpectedNumPoints) {
    throw new IO_ERROR(
      `Unexpected number of points in '${aNode.GetName()}'. Found ${retVal.length} but expected ${aExpectedNumPoints}.`,
    );
  }

  return retVal;
}

export function ParseAllChildVertices(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aTestAllChildNodes = false,
): VERTEX[] {
  const retVal: VERTEX[] = [];

  for (const cNode of children(aNode)) {
    if (VERTEX.IsVertex(cNode)) {
      const vertex = new VERTEX();
      //TODO try.. catch + throw again with more detailed error information
      vertex.Parse(cNode, aContext);
      retVal.push(vertex);
    } else if (aTestAllChildNodes) {
      WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }

  return retVal;
}

export function ParseAllChildCutouts(
  aNode: XNODE,
  aContext: PARSER_CONTEXT,
  aTestAllChildNodes = false,
): CUTOUT[] {
  const retVal: CUTOUT[] = [];

  for (const cNode of children(aNode)) {
    if (cNode.GetName() === 'CUTOUT') {
      const cutout = new CUTOUT();
      //TODO try.. catch + throw again with more detailed error information
      cutout.Parse(cNode, aContext);
      retVal.push(cutout);
    } else if (aTestAllChildNodes) {
      WARN_UNKNOWN_NODE_IO_ERROR(cNode.GetName(), aNode.GetName());
    }
  }

  return retVal;
}

// ---------------------------------------------------------------------------
// text helpers

/** Escapes the text characters KiCad would otherwise read as formatting. */
export function EscapeFieldText(aFieldText: string): string {
  return aFieldText.replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
}

/** Convert a string with CADSTAR overbar characters to equivalent in KiCad. */
export function HandleTextOverbar(aCadstarString: string): string {
  return convertToNewOverbarNotation(aCadstarString.replaceAll("'", '~'));
}

/**
 * Corrects the position of a text element that had NO_ALIGNMENT in CADSTAR.
 * Assumes that the provided text element has been initialised with a position
 * and orientation.
 */
export function FixTextPositionNoAlignment(aKiCadTextItem: EDA_TEXT_LIKE): void {
  if (aKiCadTextItem.GetText() !== '') {
    let positionOffset: VECTOR2I = { x: 0, y: aKiCadTextItem.GetInterline(null) };
    positionOffset = RotatePoint(positionOffset, aKiCadTextItem.GetTextAngle());

    //Count num of additional lines (i.e. number of carriage returns)
    const text = aKiCadTextItem.GetText();
    let numExtraLines = text.split('\n').length - 1;
    numExtraLines -= text[text.length - 1] === '\n' ? 1 : 0; // Ignore new line character at end
    positionOffset.x *= numExtraLines;
    positionOffset.y *= numExtraLines;

    aKiCadTextItem.Offset(positionOffset);
  }
}

export function generateLibName(aRefName: string, aAlternateName: string): string {
  if (aAlternateName === '') return EscapeString(aRefName, ESCAPE_CONTEXT.CTX_LIBID);

  return EscapeString(`${aRefName} (${aAlternateName})`, ESCAPE_CONTEXT.CTX_LIBID);
}

/** `CADSTAR_ARCHIVE_PARSER`: the base both archive parsers derive from. */
export class CADSTAR_ARCHIVE_PARSER {
  protected m_context = new PARSER_CONTEXT();
  protected m_progressReporter: PROGRESS_REPORTER | null = null;

  protected checkPoint(): void {
    if (this.m_progressReporter) {
      this.m_progressReporter.AdvanceProgress();

      if (!this.m_progressReporter.KeepRefreshing())
        throw new IO_ERROR('File import canceled by user.');
    }
  }
}
