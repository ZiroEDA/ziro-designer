// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pcad/pcad2kicad_common.cpp` / `.h`: the unit, text and node
 * helpers every P-CAD object parser shares.
 *
 * A `wxString*` the C++ cuts words from is returned here as the remainder
 * beside the word; an `int*` out-parameter is the return value.
 */

import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { ToCDouble, ToLong } from '@ziroeda/common/libc/stdlib.js';
import { wxCmpNoCase } from '@ziroeda/common/wx/wxstring.js';
import type { XNODE } from '@ziroeda/common/xnode.js';
import { ANGLE_0, EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND, toInt } from '@ziroeda/kimath/src/math/util.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';

/** An EDA_TEXT, or a host of it (PCB_TEXT and PCB_FIELD merge it in). */
export type EDA_TEXT_LIKE = Pick<EDA_TEXT, 'SetVertJustify' | 'SetHorizJustify' | 'SetTextSize'>;

export enum TTEXT_JUSTIFY {
  LowerLeft,
  LowerCenter,
  LowerRight,
  UpperLeft,
  UpperCenter,
  UpperRight,
  Left,
  Center,
  Right,
}

export interface TTEXTVALUE {
  text: string;
  textPositionX: number;
  textPositionY: number;
  textHeight: number;
  textstrokeWidth: number;
  textRotation: EDA_ANGLE;
  textIsVisible: number;
  mirror: number;
  textUnit: number;
  correctedPositionX: number;
  correctedPositionY: number;
  justify: TTEXT_JUSTIFY;
  isBold: boolean;
  isItalic: boolean;
  isTrueType: boolean;
}

// Average height/width ratio of the text
const TEXT_WIDTH_TO_SIZE_AVERAGE = 0.5;

// PCAD stroke font average ratio of width to size
const STROKE_HEIGHT_TO_SIZE = 0.656;

// PCAD stroke font average ratio of width to size
const STROKE_WIDTH_TO_SIZE = 0.69;

// PCAD truetype font average ratio of height to size
const TRUETYPE_HEIGHT_TO_SIZE = 0.585;

// PCAD truetype font average ratio of width to size
const TRUETYPE_WIDTH_TO_SIZE = 0.585;

// PCAD truetype font thickness per height
const TRUETYPE_THICK_PER_HEIGHT = 0.073;

// PCAD truetype font thickness bold multiplier
const TRUETYPE_BOLD_THICK_MUL = 1.6;

// PCAD truetype font minimal weight when it is bold
const TRUETYPE_BOLD_MIN_WEIGHT = 700;

// ---------------------------------------------------------------------------
// wxString

/** `wxSafeIsspace`: the ASCII blanks `isspace` knows. */
const isWxSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';

/** `wxString::Trim( false )`: drop leading blanks. */
export function TrimLeft(s: string): string {
  let i = 0;

  while (i < s.length && isWxSpace(s[i])) i++;

  return s.slice(i);
}

/** `wxString::Trim( true )`: drop trailing blanks. */
export function TrimRight(s: string): string {
  let i = s.length;

  while (i > 0 && isWxSpace(s[i - 1])) i--;

  return s.slice(0, i);
}

/** `wxString::IsSameAs( other, false )`. */
export const IsSameAsNoCase = (a: string, b: string): boolean => wxCmpNoCase(a, b) === 0;

/** `wxString::MakeUpper()`: `towupper` per character, never changing the length. */
export function MakeUpper(s: string): string {
  let r = '';

  for (const c of s) {
    const u = c.toUpperCase();
    r += u.length === c.length ? u : c;
  }

  return r;
}

/** `wxString::Lower()`: `towlower` per character. */
export function MakeLower(s: string): string {
  let r = '';

  for (const c of s) {
    const l = c.toLowerCase();
    r += l.length === c.length ? l : c;
  }

  return r;
}

/**
 * `aNode->GetAttribute( "Name", &value )`: the attribute, or `aPrev` — wx
 * leaves the out-parameter untouched when there is none, and the loops here
 * depend on it keeping its last value.
 */
export function GetName(aNode: XNODE, aPrev: string): string {
  return aNode.GetAttribute('Name') ?? aPrev;
}

/** `wxString::ToLong( &num )`: the prefix's value, whatever the return. */
export const NodeToLong = (aText: string): number => ToLong(aText).value;

// ---------------------------------------------------------------------------
// words and units

/** `GetWord( wxString* aStr )`: the word, and what is left of `aStr`. */
export function GetWord(aStr: string): [string, string] {
  let result = '';

  aStr = TrimLeft(aStr);

  if (aStr.length === 0) return [result, aStr];

  if (aStr[0] === '"') {
    result += aStr[0];
    aStr = aStr.slice(1); // remove Frontal Quote

    while (aStr.length > 0 && aStr[0] !== '"') {
      result += aStr[0];
      aStr = aStr.slice(1);
    }

    if (aStr.length > 0 && aStr[0] === '"') {
      result += aStr[0];
      aStr = aStr.slice(1); // remove ending Quote
    }
  } else {
    while (aStr.length > 0 && !(aStr[0] === ' ' || aStr[0] === '(' || aStr[0] === ')')) {
      result += aStr[0];
      aStr = aStr.slice(1);
    }
  }

  result = TrimLeft(TrimRight(result));

  return [result, aStr];
}

export function FindPinMap(aNode: XNODE): XNODE | null {
  let result: XNODE | null = null;
  const lNode = FindNode(aNode, 'attachedPattern');

  if (lNode) result = FindNode(lNode, 'padPinMap');

  return result;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

export function StrToDoublePrecisionUnits(
  aStr: string,
  aAxe: string,
  aActualConversion: string,
): number {
  let ls: string;
  let i: number;

  ls = TrimLeft(TrimRight(aStr));

  if (ls.length > 0) {
    const u = ls[ls.length - 1];

    while (
      ls.length > 0 &&
      !(ls[ls.length - 1] === '.' || ls[ls.length - 1] === ',' || isDigit(ls[ls.length - 1]))
    ) {
      ls = ls.slice(0, -1);
    }

    while (
      ls.length > 0 &&
      !(ls[0] === '-' || ls[0] === '+' || ls[0] === '.' || ls[0] === ',' || isDigit(ls[0]))
    ) {
      ls = ls.slice(1);
    }

    // `double i;` is uninitialised in the C++: a text with no number in it
    // leaves it whatever the stack held. Ours reads 0.
    if (u === 'm') {
      i = ToCDouble(ls, 0);

      // PCAD2KICAD_SCALE_SCH_TO_INCH_GRID is defined (pcad2kicad_common.h)
      if (aActualConversion === 'SCH' || aActualConversion === 'SCHLIB') i = i * (0.0254 / 0.025);

      i = pcbIUScale.mmToIU(i);
    } else {
      i = ToCDouble(ls, 0);
      i *= pcbIUScale.IU_PER_MILS;
    }
  } else {
    i = 0.0;
  }

  if ((aActualConversion === 'PCB' || aActualConversion === 'SCH') && aAxe === 'Y') return -i;

  return i; // Y axe is mirrored compared to P-Cad
}

export function StrToIntUnits(aStr: string, aAxe: string, aActualConversion: string): number {
  return KiROUND(StrToDoublePrecisionUnits(aStr, aAxe, aActualConversion));
}

/** `GetAndCutWordWithMeasureUnits`: the word with its unit, and the rest of `aStr`. */
export function GetAndCutWordWithMeasureUnits(
  aStr: string,
  aDefaultMeasurementUnit: string,
): [string, string] {
  let result = '';

  aStr = TrimLeft(aStr);

  // value
  while (aStr.length > 0 && aStr[0] !== ' ') {
    result += aStr[0];
    aStr = aStr.slice(1);
  }

  aStr = TrimLeft(aStr);

  // if there is also measurement unit
  while (
    aStr.length > 0 &&
    ((aStr[0]! >= 'a' && aStr[0]! <= 'z') || (aStr[0]! >= 'A' && aStr[0]! <= 'Z'))
  ) {
    result += aStr[0];
    aStr = aStr.slice(1);
  }

  // and if not, add default....
  if (
    result.length > 0 &&
    (result[result.length - 1] === '.' ||
      result[result.length - 1] === ',' ||
      isDigit(result[result.length - 1]))
  ) {
    result += aDefaultMeasurementUnit;
  }

  return [result, aStr];
}

export function StrToInt1Units(aStr: string): number {
  // `double num;` is written by ToCDouble even for "" (strtod's 0)
  const num = ToCDouble(aStr, 0);
  const precision = 10;

  return KiROUND(num * precision);
}

export function ValidateName(aName: string): string {
  return aName.replaceAll(' ', '_');
}

export function ValidateReference(aRef: string): string {
  // ^[[:digit:]][[:digit:]]*$: POSIX [[:digit:]] is ASCII here
  if (/^[0-9][0-9]*$/.test(aRef)) return `.${aRef}`;

  return aRef;
}

export function SetWidth(
  aStr: string,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): number {
  const [word] = GetAndCutWordWithMeasureUnits(aStr, aDefaultMeasurementUnit);

  return StrToIntUnits(word, ' ', aActualConversion);
}

export function SetHeight(
  aStr: string,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): number {
  const [word] = GetAndCutWordWithMeasureUnits(aStr, aDefaultMeasurementUnit);

  return StrToIntUnits(word, ' ', aActualConversion);
}

export function SetPosition(
  aStr: string,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): [number, number] {
  const [xw, rest] = GetAndCutWordWithMeasureUnits(aStr, aDefaultMeasurementUnit);
  const x = StrToIntUnits(xw, 'X', aActualConversion);
  const [yw] = GetAndCutWordWithMeasureUnits(rest, aDefaultMeasurementUnit);
  const y = StrToIntUnits(yw, 'Y', aActualConversion);

  return [x, y];
}

export function SetDoublePrecisionPosition(
  aStr: string,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): [number, number] {
  const [xw, rest] = GetAndCutWordWithMeasureUnits(aStr, aDefaultMeasurementUnit);
  const x = StrToDoublePrecisionUnits(xw, 'X', aActualConversion);
  const [yw] = GetAndCutWordWithMeasureUnits(rest, aDefaultMeasurementUnit);
  const y = StrToDoublePrecisionUnits(yw, 'Y', aActualConversion);

  return [x, y];
}

export function GetJustifyIdentificator(aJustify: string): TTEXT_JUSTIFY {
  if (IsSameAsNoCase(aJustify, 'LowerCenter')) return TTEXT_JUSTIFY.LowerCenter;
  if (IsSameAsNoCase(aJustify, 'LowerRight')) return TTEXT_JUSTIFY.LowerRight;
  if (IsSameAsNoCase(aJustify, 'UpperLeft')) return TTEXT_JUSTIFY.UpperLeft;
  if (IsSameAsNoCase(aJustify, 'UpperCenter')) return TTEXT_JUSTIFY.UpperCenter;
  if (IsSameAsNoCase(aJustify, 'UpperRight')) return TTEXT_JUSTIFY.UpperRight;
  if (IsSameAsNoCase(aJustify, 'Left')) return TTEXT_JUSTIFY.Left;
  if (IsSameAsNoCase(aJustify, 'Center')) return TTEXT_JUSTIFY.Center;
  if (IsSameAsNoCase(aJustify, 'Right')) return TTEXT_JUSTIFY.Right;

  return TTEXT_JUSTIFY.LowerLeft;
}

export function SetTextParameters(
  aNode: XNODE,
  aTextValue: TTEXTVALUE,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): void {
  let tNode: XNODE | null;
  let str: string;

  tNode = FindNode(aNode, 'pt');

  if (tNode) {
    [aTextValue.textPositionX, aTextValue.textPositionY] = SetPosition(
      tNode.GetNodeContent(),
      aDefaultMeasurementUnit,
      aActualConversion,
    );
  }

  tNode = FindNode(aNode, 'rotation');

  if (tNode) {
    str = TrimLeft(tNode.GetNodeContent());
    aTextValue.textRotation = new EDA_ANGLE(StrToInt1Units(str), EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T);
  } else {
    aTextValue.textRotation = ANGLE_0;
  }

  str = FindNodeGetContent(aNode, 'isVisible');

  if (IsSameAsNoCase(str, 'True')) aTextValue.textIsVisible = 1;
  else aTextValue.textIsVisible = 0;

  str = FindNodeGetContent(aNode, 'justify');
  aTextValue.justify = GetJustifyIdentificator(str);

  str = FindNodeGetContent(aNode, 'isFlipped');

  if (IsSameAsNoCase(str, 'True')) aTextValue.mirror = 1;
  else aTextValue.mirror = 0;

  tNode = FindNode(aNode, 'textStyleRef');

  if (tNode) SetFontProperty(tNode, aTextValue, aDefaultMeasurementUnit, aActualConversion);
}

export function SetFontProperty(
  aNode: XNODE,
  aTextValue: TTEXTVALUE,
  aDefaultMeasurementUnit: string,
  aActualConversion: string,
): void {
  let node: XNODE | null = aNode;
  let propValue = '';
  const n = GetName(node, '');

  while (node!.GetName() !== 'www.lura.sk') node = node!.GetParent();

  node = FindNode(node!, 'library');

  if (node) node = FindNode(node, 'textStyleDef');

  while (node) {
    propValue = TrimRight(TrimLeft(GetName(node, propValue)));

    if (propValue === n) break;

    node = node.GetNext();
  }

  if (!node) return;

  propValue = FindNodeGetContent(node, 'textStyleDisplayTType');
  aTextValue.isTrueType = IsSameAsNoCase(propValue, 'True');

  // `FindNodeGetContent( nullptr, … )` would crash in the C++; a style with no
  // `font` is not something P-CAD writes.
  node = FindNode(node, 'font');
  const fontType = FindNodeGetContent(node!, 'fontType');

  if (
    (aTextValue.isTrueType && !IsSameAsNoCase(fontType, 'TrueType')) ||
    (!aTextValue.isTrueType && !IsSameAsNoCase(fontType, 'Stroke'))
  )
    node = node!.GetNext();

  if (!node) return;

  if (aTextValue.isTrueType) {
    propValue = FindNodeGetContent(node, 'fontItalic');
    aTextValue.isItalic = IsSameAsNoCase(propValue, 'True');

    propValue = FindNodeGetContent(node, 'fontWeight');

    if (propValue !== '') {
      const fontWeight = NodeToLong(propValue);
      aTextValue.isBold = fontWeight >= TRUETYPE_BOLD_MIN_WEIGHT;
    }
  }

  let lNode = FindNode(node, 'fontHeight');

  if (lNode)
    aTextValue.textHeight = SetHeight(
      lNode.GetNodeContent(),
      aDefaultMeasurementUnit,
      aActualConversion,
    );

  if (aTextValue.isTrueType) {
    // int = double: truncated
    aTextValue.textstrokeWidth = toInt(TRUETYPE_THICK_PER_HEIGHT * aTextValue.textHeight);

    if (aTextValue.isBold)
      aTextValue.textstrokeWidth = toInt(aTextValue.textstrokeWidth * TRUETYPE_BOLD_THICK_MUL);
  } else {
    lNode = FindNode(node, 'strokeWidth');

    if (lNode)
      aTextValue.textstrokeWidth = SetWidth(
        lNode.GetNodeContent(),
        aDefaultMeasurementUnit,
        aActualConversion,
      );
  }
}

export function SetTextJustify(aText: EDA_TEXT_LIKE, aJustify: TTEXT_JUSTIFY): void {
  const V = GR_TEXT_V_ALIGN_T;
  const H = GR_TEXT_H_ALIGN_T;

  switch (aJustify) {
    case TTEXT_JUSTIFY.LowerLeft:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;
    case TTEXT_JUSTIFY.LowerCenter:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;
    case TTEXT_JUSTIFY.LowerRight:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_BOTTOM);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
    case TTEXT_JUSTIFY.UpperLeft:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;
    case TTEXT_JUSTIFY.UpperCenter:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;
    case TTEXT_JUSTIFY.UpperRight:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_TOP);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
    case TTEXT_JUSTIFY.Left:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_LEFT);
      break;
    case TTEXT_JUSTIFY.Center:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_CENTER);
      break;
    case TTEXT_JUSTIFY.Right:
      aText.SetVertJustify(V.GR_TEXT_V_ALIGN_CENTER);
      aText.SetHorizJustify(H.GR_TEXT_H_ALIGN_RIGHT);
      break;
  }
}

export function CalculateTextLengthSize(aText: TTEXTVALUE): number {
  // `wxString::Len()` counts code points
  return KiROUND([...aText.text].length * aText.textHeight * TEXT_WIDTH_TO_SIZE_AVERAGE);
}

export function CorrectTextPosition(aValue: TTEXTVALUE): void {
  const cm = aValue.mirror ? -1 : 1;
  const cl = KiROUND(CalculateTextLengthSize(aValue) / 2.0);
  const ch = KiROUND(aValue.textHeight / 2.0);
  let posX = 0;
  let posY = 0;
  const j = aValue.justify;

  if (j === TTEXT_JUSTIFY.LowerLeft || j === TTEXT_JUSTIFY.Left || j === TTEXT_JUSTIFY.UpperLeft)
    posX += cl * cm;
  else if (
    j === TTEXT_JUSTIFY.LowerRight ||
    j === TTEXT_JUSTIFY.Right ||
    j === TTEXT_JUSTIFY.UpperRight
  )
    posX -= cl * cm;

  if (
    j === TTEXT_JUSTIFY.LowerLeft ||
    j === TTEXT_JUSTIFY.LowerCenter ||
    j === TTEXT_JUSTIFY.LowerRight
  )
    posY -= ch;
  else if (
    j === TTEXT_JUSTIFY.UpperLeft ||
    j === TTEXT_JUSTIFY.UpperCenter ||
    j === TTEXT_JUSTIFY.UpperRight
  )
    posY += ch;

  const p = RotatePoint({ x: posX, y: posY }, aValue.textRotation);

  aValue.correctedPositionX = aValue.textPositionX + p.x;
  aValue.correctedPositionY = aValue.textPositionY + p.y;
}

export function SetTextSizeFromStrokeFontHeight(aText: EDA_TEXT_LIKE, aTextHeight: number): void {
  aText.SetTextSize({
    x: KiROUND(aTextHeight * STROKE_WIDTH_TO_SIZE),
    y: KiROUND(aTextHeight * STROKE_HEIGHT_TO_SIZE),
  });
}

export function SetTextSizeFromTrueTypeFontHeight(aText: EDA_TEXT_LIKE, aTextHeight: number): void {
  aText.SetTextSize({
    x: KiROUND(aTextHeight * TRUETYPE_WIDTH_TO_SIZE),
    y: KiROUND(aTextHeight * TRUETYPE_HEIGHT_TO_SIZE),
  });
}

export function FindNode(aChild: XNODE, aTag: string): XNODE | null {
  let child = aChild.GetChildren();

  while (child) {
    if (IsSameAsNoCase(child.GetName(), aTag)) return child;

    child = child.GetNext();
  }

  return null;
}

export function FindNodeGetContent(aChild: XNODE, aTag: string): string {
  let str = '';
  const node = FindNode(aChild, aTag);

  if (node) str = TrimRight(TrimLeft(node.GetNodeContent()));

  return str;
}

export function InitTTextValue(): TTEXTVALUE {
  return {
    text: '',
    textPositionX: 0,
    textPositionY: 0,
    textRotation: ANGLE_0,
    textHeight: 0,
    textstrokeWidth: 0,
    textIsVisible: 0,
    mirror: 0,
    textUnit: 0,
    correctedPositionX: 0,
    correctedPositionY: 0,
    justify: TTEXT_JUSTIFY.LowerLeft,
    isBold: false,
    isItalic: false,
    isTrueType: false,
  };
}
