// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/gbr_metadata.h` + `common/gbr_metadata.cpp`: the Gerber X2
 * attribute strings - TF.CreationDate, the project GUID, the aperture
 * (`TA.AperFunction`) and net (`TO.P` / `TO.N` / `TO.C`) attributes - and the
 * escaping between a string and its Gerber form both ways.
 *
 * `GBR_DATA_FIELD::GetGerberString` and `GBR_CMP_PNP_METADATA`'s two methods
 * are defined in this .cpp upstream; their classes are in
 * `gbr_netlist_metadata.ts`, where the header declares them.
 */
import { GBR_NETINFO_TYPE, GBR_NETLIST_METADATA } from './gbr_netlist_metadata.js';

/** `char2Hex` (`common/gbr_metadata.cpp`): a hex digit's value, -1 if not one. */
function char2Hex(aCode: number): number {
  if (aCode >= 0x30 && aCode <= 0x39) return aCode - 0x30; // '0'..'9'
  if (aCode >= 0x41 && aCode <= 0x46) return aCode - 0x41 + 10; // 'A'..'F'
  if (aCode >= 0x61 && aCode <= 0x66) return aCode - 0x61 + 10; // 'a'..'f'
  return -1;
}

/**
 * `FormatStringFromGerber`: undo `\uXXXX` escapes (the Gerber X2 2019 form).
 * A sequence that is not four hex digits is kept as it is.
 */
export function FormatStringFromGerber(aString: string): string {
  let txt = '';
  const count = aString.length;

  for (let ii = 0; ii < count; ++ii) {
    let code = aString.charCodeAt(ii);

    if (code === 0x5c /* '\\' */ && ii < count - 5 && aString[ii + 1] === 'u') {
      let value = 0;
      let error = false;

      for (let jj = 0; jj < 4; jj++) {
        value <<= 4;
        code = aString.charCodeAt(ii + jj + 2);

        const hexa = char2Hex(code);

        if (hexa >= 0) {
          value += hexa;
        } else {
          error = true;
          break;
        }
      }

      if (!error) {
        if (value >= ' '.charCodeAt(0)) {
          // Is a valid wxChar ?
          txt += String.fromCharCode(value);
        }

        ii += 5;
      } else {
        txt += aString[ii];
      }
    } else {
      txt += aString[ii];
    }
  }

  return txt;
}

/** `GBR_NC_STRING_FORMAT`: the form of the CreationDate attribute string. */
export enum GBR_NC_STRING_FORMAT {
  GBR_NC_STRING_FORMAT_X1,
  GBR_NC_STRING_FORMAT_X2,
  GBR_NC_STRING_FORMAT_GBRJOB,
  GBR_NC_STRING_FORMAT_NCDRILL,
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Create a gerber TF.CreationDate attribute: the full ISO 8601 date and time
 * with its time zone - the date the file was created, not the project's.
 *
 * @param aNow is "now" (`wxDateTime::GetTimeNow()`), given only by tests.
 */
export function GbrMakeCreationDateAttributeString(
  aFormat: GBR_NC_STRING_FORMAT,
  aNow: Date = new Date(),
): string {
  // `FormatISOCombined()`: local time, "YYYY-MM-DDTHH:MM:SS".
  const iso =
    `${String(aNow.getFullYear()).padStart(4, '0')}-${pad2(aNow.getMonth() + 1)}-` +
    `${pad2(aNow.getDate())}T${pad2(aNow.getHours())}:${pad2(aNow.getMinutes())}:` +
    `${pad2(aNow.getSeconds())}`;

  // `Format( "%z" )`: +hhmm or -hhmm east of UTC, then a separator between
  // hours and minutes.
  const east = -aNow.getTimezoneOffset();
  let timezone_offset = `${east >= 0 ? '+' : '-'}${pad2(Math.trunc(Math.abs(east) / 60))}${pad2(Math.abs(east) % 60)}`;

  if (timezone_offset.length > 3)
    timezone_offset = `${timezone_offset.slice(0, 3)}:${timezone_offset.slice(3)}`;

  switch (aFormat) {
    case GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_X2:
      return `%TF.CreationDate,${iso}${timezone_offset}*%`;
    case GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_X1:
      return `G04 #@! TF.CreationDate,${iso}${timezone_offset}*`;
    case GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_GBRJOB:
      return `${iso}${timezone_offset}`;
    case GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_NCDRILL:
      return `; #@! TF.CreationDate,${iso}${timezone_offset}`;
  }
}

const hex = (aValue: number, aDigits: number): string => aValue.toString(16).padStart(aDigits, '0');

/**
 * Build a project GUID (RFC 4122 version 4, variant 1 in form) from a string,
 * the board file name: `xxxxxxxx-xxxx-4xxx-9xxx-xxxxxxxxxxxx`.
 */
export function GbrMakeProjectGUIDfromString(aText: string): string {
  // wxString indexes code points.
  const bname = Array.from(aText).map((c) => c.codePointAt(0)!);

  // guid has 32 digits, so add chars in name to be sure we can build a 32
  // digits guid (i.e. from a 16 char string name)
  while (bname.length < 16) bname.push('X'.charCodeAt(0));

  let chr_idx = 0;
  let guid = '';

  // Output the 8 first hex digits:
  for (let ii = 0; ii < 4; ii++) guid += hex(bname[chr_idx++]! & 0xff, 2);

  // Output the 4 next hex digits:
  guid += '-';

  for (let ii = 0; ii < 2; ii++) guid += hex(bname[chr_idx++]! & 0xff, 2);

  // Output the 4 next hex digits (UUID version and 3 digits):
  guid += '-4'; // first digit: UUID version 4 (M = 4)
  {
    let cc = (bname[chr_idx++]! << 4) & 0xff0;
    cc += (bname[chr_idx]! >> 4) & 0x0f;
    guid += hex(cc, 3);
  }

  // Output the 4 next hex digits (UUID variant and 3 digits):
  guid += '-9'; // first digit: UUID variant 1 (N = 9)
  {
    let cc = (bname[chr_idx++]! & 0x0f) << 8;
    cc += bname[chr_idx++]! & 0xff;
    guid += hex(cc, 3);
  }

  // Output the 12 last hex digits:
  guid += '-';

  for (let ii = 0; ii < 6; ii++) guid += hex(bname[chr_idx++]! & 0xff, 2);

  return guid;
}

/** `GBR_APERTURE_METADATA::GBR_APERTURE_ATTRIB`. */
export enum GBR_APERTURE_ATTRIB {
  GBR_APERTURE_ATTRIB_NONE,
  GBR_APERTURE_ATTRIB_ETCHEDCMP,
  GBR_APERTURE_ATTRIB_CONDUCTOR,
  GBR_APERTURE_ATTRIB_EDGECUT,
  GBR_APERTURE_ATTRIB_NONCONDUCTOR,
  GBR_APERTURE_ATTRIB_VIAPAD,
  GBR_APERTURE_ATTRIB_COMPONENTPAD,
  GBR_APERTURE_ATTRIB_SMDPAD_SMDEF,
  GBR_APERTURE_ATTRIB_SMDPAD_CUDEF,
  GBR_APERTURE_ATTRIB_BGAPAD_SMDEF,
  GBR_APERTURE_ATTRIB_BGAPAD_CUDEF,
  GBR_APERTURE_ATTRIB_CONNECTORPAD,
  GBR_APERTURE_ATTRIB_WASHERPAD,
  GBR_APERTURE_ATTRIB_TESTPOINT,
  GBR_APERTURE_ATTRIB_FIDUCIAL_GLBL,
  GBR_APERTURE_ATTRIB_FIDUCIAL_LOCAL,
  GBR_APERTURE_ATTRIB_HEATSINKPAD,
  GBR_APERTURE_ATTRIB_CASTELLATEDPAD,
  GBR_APERTURE_ATTRIB_CASTELLATEDDRILL,
  GBR_APERTURE_ATTRIB_PRESSFITDRILL,
  GBR_APERTURE_ATTRIB_VIADRILL,
  GBR_APERTURE_ATTRIB_BACKDRILL,
  GBR_APERTURE_ATTRIB_CMP_DRILL,
  GBR_APERTURE_ATTRIB_CMP_OBLONG_DRILL,
  GBR_APERTURE_ATTRIB_CMP_POSITION,
  GBR_APERTURE_ATTRIB_PAD1_POS,
  GBR_APERTURE_ATTRIB_PADOTHER_POS,
  GBR_APERTURE_ATTRIB_CMP_BODY,
  GBR_APERTURE_ATTRIB_CMP_LEAD2LEAD,
  GBR_APERTURE_ATTRIB_CMP_FOOTPRINT,
  GBR_APERTURE_ATTRIB_CMP_COURTYARD,
  GBR_APERTURE_ATTRIB_OTHER,
  /** sentinel: max value */
  GBR_APERTURE_ATTRIB_END,
}

/** The `TA.AperFunction` value of each attribute, as `FormatAttribute` spells it. */
const APER_FUNCTION: Partial<Record<GBR_APERTURE_ATTRIB, string>> = {
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_ETCHEDCMP]: 'EtchedComponent',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONDUCTOR]: 'Conductor',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_EDGECUT]: 'Profile',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_VIAPAD]: 'ViaPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONCONDUCTOR]: 'NonConductor',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_COMPONENTPAD]: 'ComponentPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_SMDPAD_SMDEF]: 'SMDPad,SMDef',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_SMDPAD_CUDEF]: 'SMDPad,CuDef',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_BGAPAD_SMDEF]: 'BGAPad,SMDef',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_BGAPAD_CUDEF]: 'BGAPad,CuDef',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CONNECTORPAD]: 'ConnectorPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_WASHERPAD]: 'WasherPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_HEATSINKPAD]: 'HeatsinkPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_TESTPOINT]: 'TestPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_FIDUCIAL_GLBL]: 'FiducialPad,Global',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_FIDUCIAL_LOCAL]: 'FiducialPad,Local',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CASTELLATEDPAD]: 'CastellatedPad',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CASTELLATEDDRILL]: 'CastellatedDrill',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_VIADRILL]: 'ViaDrill',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_BACKDRILL]: 'BackDrill',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_DRILL]: 'ComponentDrill',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PRESSFITDRILL]: 'ComponentDrill,PressFit',
  // Same as a round pad hole, but a specific aperture, with a G04 comment.
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_OBLONG_DRILL]: 'ComponentDrill',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_POSITION]: 'ComponentMain',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PAD1_POS]: 'ComponentPin',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_PADOTHER_POS]: 'ComponentPin',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_BODY]: 'ComponentOutline,Body',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_LEAD2LEAD]: 'ComponentOutline,Lead2Lead',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_FOOTPRINT]: 'ComponentOutline,Footprint',
  [GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_COURTYARD]: 'ComponentOutline,Courtyard',
};

/**
 * `GBR_APERTURE_METADATA`: the aperture attribute (`TA.AperFunction`) of a
 * D-code. (`GetAttributeName` is declared upstream and defined nowhere.)
 */
export class GBR_APERTURE_METADATA {
  m_ApertAttribute: GBR_APERTURE_ATTRIB = GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_NONE;
  m_CustomAttribute = '';

  /**
   * The full attribute string for an aperture: `%TA.AperFunction,...*%\n`,
   * or `G04 #@! TA...*\n` as an X1 structured comment, after a `G04` comment
   * line for an oblong drill; '' for no attribute.
   */
  static FormatAttribute(
    aAttribute: GBR_APERTURE_ATTRIB,
    aUseX1StructuredComment: boolean,
    aCustomAttribute: string,
  ): string {
    let attribute_string = ''; // the specific aperture attribute (TA.xxx)
    let comment_string = ''; // a optional G04 comment line to write before the TA. line

    if (aAttribute === GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_OTHER)
      attribute_string = `TA.AperFunction,Other,${aCustomAttribute}`;
    else if (APER_FUNCTION[aAttribute] !== undefined)
      attribute_string = `TA.AperFunction,${APER_FUNCTION[aAttribute]}`;

    if (aAttribute === GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_CMP_OBLONG_DRILL)
      comment_string = 'aperture for slot hole';

    let full_attribute_string = '';
    let eol_string = '';

    if (attribute_string !== '') {
      if (comment_string !== '') full_attribute_string = `G04 ${comment_string}*\n`;

      if (aUseX1StructuredComment) {
        full_attribute_string += 'G04 #@! ';
        eol_string = '*\n';
      } else {
        full_attribute_string += '%';
        eol_string = '*%\n';
      }
    }

    full_attribute_string += attribute_string + eol_string;

    return full_attribute_string;
  }

  /** `FormatAttribute( aUseX1StructuredComment )`: this aperture's. */
  FormatAttribute(aUseX1StructuredComment: boolean): string {
    return GBR_APERTURE_METADATA.FormatAttribute(
      this.m_ApertAttribute,
      aUseX1StructuredComment,
      this.m_CustomAttribute,
    );
  }
}

/** `GBR_METADATA`: the aperture and the netlist metadata of a plotted item. */
export class GBR_METADATA {
  m_ApertureMetadata = new GBR_APERTURE_METADATA();
  m_NetlistMetadata = new GBR_NETLIST_METADATA();
  private m_isCopper = false;

  /** `SetApertureAttrib( aApertAttribute )`, or `SetApertureAttrib( aCustomAttribute )`. */
  SetApertureAttrib(aApertAttribute: GBR_APERTURE_ATTRIB | string): void {
    if (typeof aApertAttribute === 'string') {
      this.m_ApertureMetadata.m_ApertAttribute = GBR_APERTURE_ATTRIB.GBR_APERTURE_ATTRIB_OTHER;
      this.m_ApertureMetadata.m_CustomAttribute = aApertAttribute;
    } else {
      this.m_ApertureMetadata.m_ApertAttribute = aApertAttribute;
    }
  }

  GetApertureAttrib(): GBR_APERTURE_ATTRIB {
    return this.m_ApertureMetadata.m_ApertAttribute;
  }

  GetCustomAttribute(): string {
    return this.m_ApertureMetadata.m_CustomAttribute;
  }

  SetNetAttribType(aNetAttribType: number): void {
    this.m_NetlistMetadata.m_NetAttribType = aNetAttribType;
  }

  GetNetAttribType(): number {
    return this.m_NetlistMetadata.m_NetAttribType;
  }

  SetNetName(aNetname: string): void {
    this.m_NetlistMetadata.m_Netname = aNetname;
  }

  SetPadName(aPadname: string, aUseUTF8 = false, aEscapeString = false): void {
    this.m_NetlistMetadata.m_Padname.SetField(aPadname, aUseUTF8, aEscapeString);
  }

  SetPadPinFunction(aPadPinFunction: string, aUseUTF8: boolean, aEscapeString: boolean): void {
    this.m_NetlistMetadata.m_PadPinFunction.SetField(aPadPinFunction, aUseUTF8, aEscapeString);
  }

  SetCmpReference(aComponentRef: string): void {
    this.m_NetlistMetadata.m_Cmpref = aComponentRef;
  }

  IsCopper(): boolean {
    return this.m_isCopper;
  }

  /** The implicit copy constructor (`GBR_METADATA metadata = *aData;`). */
  Clone(): GBR_METADATA {
    const c = new GBR_METADATA();
    c.m_ApertureMetadata.m_ApertAttribute = this.m_ApertureMetadata.m_ApertAttribute;
    c.m_ApertureMetadata.m_CustomAttribute = this.m_ApertureMetadata.m_CustomAttribute;
    c.m_NetlistMetadata = this.m_NetlistMetadata.Clone();
    c.m_isCopper = this.m_isCopper;
    return c;
  }

  SetCopper(aValue: boolean): void {
    this.m_isCopper = aValue;
  }
}

/**
 * Convert a string to a Gerber string: every code above 0x7F (unless
 * `aAllowUtf8Chars`) and every separator (`\ % * ,`, and `"` when quoting)
 * becomes a `\uXXXX` escape of its low 16 bits.
 */
export function ConvertNotAllowedCharsInGerber(
  aString: string,
  aAllowUtf8Chars: boolean,
  aQuoteString: boolean,
): string {
  let txt = '';

  if (aQuoteString) txt += '"';

  // wxChar is a code point.
  for (const ch of aString) {
    const code = ch.codePointAt(0)!;
    let convert = false;

    switch (ch) {
      case '\\':
      case '%':
      case '*':
      case ',':
        convert = true;
        break;
      case '"':
        if (aQuoteString) convert = true;
        break;
      default:
        break;
    }

    if (!aAllowUtf8Chars && code > 0x7f) convert = true;

    if (convert) {
      // "\uXXXX", XXXX is the Unicode 16 bits hexa value
      txt += `\\u${(code & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      txt += ch;
    }
  }

  if (aQuoteString) txt += '"';

  return txt;
}

/**
 * Normalize `aString`: escape what Gerber does not allow, unless it is quoted,
 * in which case it is taken as already converted.
 */
export function FormatStringToGerber(aString: string): string {
  if (aString.length > 0 && (aString[0] !== '"' || aString[aString.length - 1] !== '"'))
    return ConvertNotAllowedCharsInGerber(aString, false, false);

  return aString;
}

// Netname and Pan num fields cannot be empty in Gerber files
// Normalized names must be used, if any
const NO_NET_NAME = 'N/C'; // net name of not connected pads (one pad net) (normalized)
const NO_PAD_NAME = ''; // pad name of pads without pad name/number (not normalized)

/**
 * Generate the string to set a net attribute for a graphic object, and only
 * what changed since `aLastNetAttributes`.
 *
 * @param aPrintedText receives the attribute text to write; left as it was
 *                     when nothing changed.
 * @param aLastNetAttributes is the previous full attribute list, updated.
 * @param aClearPreviousAttributes is set when the whole dictionary must be
 *                                 cleared (`%TD*%`) before `aPrintedText`.
 * @returns false for no data or an unspecified attribute type.
 */
export function FormatNetAttribute(
  aPrintedText: { value: string },
  aLastNetAttributes: { value: string },
  aData: GBR_NETLIST_METADATA | null,
  aClearPreviousAttributes: { value: boolean },
  aUseX1StructuredComment: boolean,
): boolean {
  aClearPreviousAttributes.value = false;
  let prepend_string: string;
  let eol_string: string;

  if (aUseX1StructuredComment) {
    prepend_string = 'G04 #@! ';
    eol_string = '*\n';
  } else {
    prepend_string = '%';
    eol_string = '*%\n';
  }

  // print a Gerber net attribute record.
  // it is added to the object attributes dictionary
  // On file, only modified or new attributes are printed.
  if (aData === null) return false;

  let pad_attribute_string = '';
  let net_attribute_string = '';
  let cmp_attribute_string = '';

  if (aData.m_NetAttribType === GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED) return false; // idle command: do nothing

  if (aData.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_PAD) {
    // print info associated to a flashed pad (cmpref, pad name, and optionally pin function)
    // example1: %TO.P,R5,3*%
    // example2: %TO.P,R5,3,reset*%
    pad_attribute_string = `${prepend_string}TO.P,`;
    pad_attribute_string += `${FormatStringToGerber(aData.m_Cmpref)},`;

    if (aData.m_Padname.IsEmpty()) {
      // Happens for "mechanical" or never connected pads
      pad_attribute_string += FormatStringToGerber(NO_PAD_NAME);
    } else {
      pad_attribute_string += aData.m_Padname.GetGerberString();

      // In Pcbnew, the pin function comes from the schematic.
      // so it exists only for named pads
      if (!aData.m_PadPinFunction.IsEmpty()) {
        pad_attribute_string += ',';
        pad_attribute_string += aData.m_PadPinFunction.GetGerberString();
      }
    }

    pad_attribute_string += eol_string;
  }

  if (aData.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_NET) {
    // print info associated to a net
    // example: %TO.N,Clk3*%
    net_attribute_string = `${prepend_string}TO.N,`;

    if (aData.m_Netname === '') {
      if (aData.m_NotInNet) {
        // Happens for not connectable pads: mechanical pads
        // and pads with no padname/num
        // In this case the net name must be left empty
      } else {
        // Happens for not connected pads: use a normalized
        // dummy name
        net_attribute_string += FormatStringToGerber(NO_NET_NAME);
      }
    } else {
      net_attribute_string += FormatStringToGerber(aData.m_Netname);
    }

    net_attribute_string += eol_string;
  }

  if (
    aData.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_CMP &&
    !(aData.m_NetAttribType & GBR_NETINFO_TYPE.GBR_NETINFO_PAD)
  ) {
    // print info associated to a footprint
    // example: %TO.C,R2*%
    // Because GBR_NETINFO_PAD option already contains this info, it is not
    // created here for a GBR_NETINFO_PAD attribute
    cmp_attribute_string = `${prepend_string}TO.C,`;
    cmp_attribute_string += FormatStringToGerber(aData.m_Cmpref) + eol_string;
  }

  // the full list of requested attributes:
  const full_attribute_string = pad_attribute_string + net_attribute_string + cmp_attribute_string;
  // the short list of requested attributes
  // (only modified or new attributes are stored here):
  let short_attribute_string = '';

  // Attributes have changed: update attribute string, and see if the previous attribute
  // list (dictionary in Gerber language) must be cleared
  if (aLastNetAttributes.value !== full_attribute_string) {
    // first, remove no longer existing attributes.
    // Because in KiCad the full attribute list is evaluated for each object,
    // the entire dictionary is cleared
    // If m_TryKeepPreviousAttributes is true, only the no longer existing attribute
    // is cleared.
    // Note: to avoid interaction between clear attributes and set attributes
    // the clear attribute is inserted first.
    let clearDict = false;
    const last = aLastNetAttributes.value;

    if (last.includes('TO.P,')) {
      if (pad_attribute_string === '') {
        // No more this attribute
        if (aData.m_TryKeepPreviousAttributes)
          // Clear only this attribute
          short_attribute_string = `${prepend_string}TO.P${eol_string}${short_attribute_string}`;
        else clearDict = true;
      } else if (!last.includes(pad_attribute_string)) {
        // This attribute has changed
        short_attribute_string += pad_attribute_string;
      }
    } else {
      // New attribute
      short_attribute_string += pad_attribute_string;
    }

    if (last.includes('TO.N,')) {
      if (net_attribute_string === '') {
        // No more this attribute
        if (aData.m_TryKeepPreviousAttributes)
          // Clear only this attribute
          short_attribute_string = `${prepend_string}TO.N${eol_string}${short_attribute_string}`;
        else clearDict = true;
      } else if (!last.includes(net_attribute_string)) {
        // This attribute has changed.
        short_attribute_string += net_attribute_string;
      }
    } else {
      // New attribute
      short_attribute_string += net_attribute_string;
    }

    if (last.includes('TO.C,')) {
      if (cmp_attribute_string === '') {
        // No more this attribute
        if (aData.m_TryKeepPreviousAttributes) {
          // Clear only this attribute
          // Refinement:
          // the attribute will be cleared only if there is no pad attribute.
          // If a pad attribute exists, the component name exists so the old
          // TO.C value will be updated, therefore no need to clear it before updating
          if (pad_attribute_string === '')
            short_attribute_string = `${prepend_string}TO.C${eol_string}${short_attribute_string}`;
        } else {
          clearDict = true;
        }
      } else if (!last.includes(cmp_attribute_string)) {
        // This attribute has changed.
        short_attribute_string += cmp_attribute_string;
      }
    } else {
      // New attribute
      short_attribute_string += cmp_attribute_string;
    }

    aClearPreviousAttributes.value = clearDict;

    aLastNetAttributes.value = full_attribute_string;

    if (clearDict) aPrintedText.value = full_attribute_string;
    else aPrintedText.value = short_attribute_string;
  }

  return true;
}
