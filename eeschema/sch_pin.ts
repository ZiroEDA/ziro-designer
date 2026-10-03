// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * SCH_PIN helpers. Counterpart: `eeschema/sch_pin.cpp`.
 *
 * Ported here is the pin-to-pad resolution, SCH_PIN::GetEffectivePadNumber, which
 * every consumer that has to name a *pad* rather than a *pin* goes through: the
 * netlist exporters, ERC's pin-map tests and the board's back-annotation. A symbol
 * pin does not have to carry the pad number it lands on: a named pin map, the
 * footprint association that selects one, and per-instance sparse edits can all
 * remap it, and the resolved pad may itself use stacked-pin notation (`[1,2]`) and
 * so stand for several pads.
 *
 * `resolvePadNumbers` — the netlist-exporter-facing wrapper that expands a
 * resolved pad through stacked-pin notation — lives in
 * `netlist_exporters/netlist_exporter_base.ts` now: it is exporter
 * infrastructure built on this function, not this file's own.
 */

import type { LibSymbol, SchSymbol } from './types.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { EDA_ITEM as EDA_ITEM_CLASS } from '@ziroeda/common/eda_item.js';
import { SHOW_ELEC_TYPE, SKIP_STRUCT, STRUCT_DELETED } from '@ziroeda/common/eda_item_flags.js';
import { type EDA_SEARCH_DATA, SCH_SEARCH_DATA } from '@ziroeda/common/eda_search_data.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import type { FONT } from '@ziroeda/common/font/font.js';
import type { METRICS } from '@ziroeda/common/font/font_metrics.js';
import { GetPenSizeForNormal } from '@ziroeda/common/gr_text.js';
import { wxStringSplit } from '@ziroeda/common/string_utils.js';
import type { KIID } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import {
  ELECTRICAL_PINTYPE,
  GetCanonicalElectricalTypeName,
  GRAPHIC_PINSHAPE,
  PIN_ORIENTATION,
} from '@ziroeda/common/pin_type.js';
import {
  countStackedPinNotation,
  ESCAPE_CONTEXT,
  EscapeString,
  expandStackedPinNotation as expandStacked,
  strNumCmp,
  unescapeString,
} from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import type { UNITS_PROVIDER } from '@ziroeda/common/units_provider.js';
import { wxCmp } from '@ziroeda/common/wx/wxstring.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_90 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import type { SHAPE_LINE_CHAIN } from '@ziroeda/kimath/src/geometry/shape_line_chain.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { TRANSFORM } from '@ziroeda/kimath/src/transform.js';
import { RotatePoint } from '@ziroeda/kimath/src/trigo.js';
import { DEFAULT_PIN_LENGTH, DEFAULT_PINNAME_SIZE, DEFAULT_PINNUM_SIZE } from './default_values.js';
import { PIN_LAYOUT_CACHE } from './pin_layout_cache.js';
import { ElectricalPinTypeGetText, PinShapeGetText } from './pin_type.js';
import { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** SCH_PIN::PAD_RESOLUTION, how a pin's pad number was arrived at. */
export type PadResolution = 'mapped' | 'identity' | 'unmapped';

export interface EffectivePadNumber {
  /** The resolved pad number; empty when UNMAPPED. */
  padNumber: string;
  state: PadResolution;
}

/**
 * SCH_PIN::GetEffectivePadNumber, the pad number `pinNumber` resolves to on
 * `footprintLibId`, in upstream's order:
 *
 *   0. an instance-local sparse edit for this pin (unless identity is forced),
 *   1. MAPPED, an explicit entry of the resolved pin map; needs no footprint,
 *   2. IDENTITY, no entry, but the footprint carries a pad of that number,
 *   3. UNMAPPED, the footprint has no such pad.
 *
 * `footprintPads` undefined means "no footprint available": the caller gets the
 * pin number back as an assumed identity, which is the painter's path.
 */
export function getEffectivePadNumber(
  pinNumber: string,
  symbol: SchSymbol,
  lib: LibSymbol | undefined,
  footprintLibId: string,
  footprintPads: ReadonlySet<string> | undefined,
): EffectivePadNumber {
  const override = symbol.pinMapOverride;
  const mode = override?.mode ?? 'library_default';
  const maps = lib?.pinMaps ?? [];
  let map = mode === 'named_map' ? maps.find((m) => m.name === override?.mapName) : undefined;

  // Library default, or a named map that no longer exists, resolves through the
  // footprint association.
  if (!map && mode !== 'identity' && lib) {
    const assoc = (lib.associatedFootprints ?? []).find((a) => a.footprintLibId === footprintLibId);
    if (assoc) map = maps.find((m) => m.name === assoc.mapName);
  }

  // Instance-local sparse edits patch the resolved map, but are ignored under
  // forced identity per the PIN_MAP_INSTANCE_OVERRIDE contract.
  if (mode !== 'identity') {
    const edit = override?.edits.find((e) => e.pin === pinNumber);
    if (edit) return { padNumber: edit.pad, state: 'mapped' };
  }

  const entry = map?.entries.find((e) => e.pin === pinNumber);
  if (entry) return { padNumber: entry.pad, state: 'mapped' };

  if (footprintPads?.has(pinNumber)) return { padNumber: pinNumber, state: 'identity' };

  return footprintPads
    ? { padNumber: '', state: 'unmapped' }
    : { padNumber: pinNumber, state: 'identity' };
}

// ---------------------------------------------------------------------------
// `SCH_PIN` itself: the live-model class (eeschema stage E3). The record model's pad
// resolution above is left untouched.
//
// Not here: `Plot`, `PlotPinTexts`, `PlotPinType`, `GetMsgPanelInfo`, `GetMenuImage`,
// `Serialize`/`Deserialize`, `SCH_PIN_DESC`, and `PIN_LAYOUT_CACHE`
// (pin_layout_cache.cpp), which `GetBoundingBox`/`ViewBBox`/`HitTest` read: pending, they
// throw until it is ported. `m_netmap_mutex` has no counterpart (single thread).
// ---------------------------------------------------------------------------

/** `TARGET_PIN_RADIUS`: circle diameter drawn at the active end of pins. */
export const TARGET_PIN_RADIUS = schIUScale.milsToIU(15);

const samePt = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `SCH_PIN::ALT`: one alternate function of a library pin. */
export interface SCH_PIN_ALT {
  m_Name: string;
  m_Shape: GRAPHIC_PINSHAPE; // Shape drawn around pin
  m_Type: ELECTRICAL_PINTYPE; // Electrical type of the pin.
}

/** A `std::map<wxString, ALT>` walked in its key order (by code point). */
export function alternatesInMapOrder(aAlternates: ReadonlyMap<string, SCH_PIN_ALT>) {
  return [...aAlternates].sort((a, b) => wxCmp(a[0], b[0]));
}

/** The parts of the parent symbols a pin reads (`SCH_SYMBOL` / `LIB_SYMBOL`). */
interface PIN_PARENT_SYMBOL {
  Type(): KICAD_T;
  m_Uuid: KIID;
  GetTransform(): TRANSFORM;
  GetPosition(): VECTOR2I;
  IsGlobalPower(): boolean;
  IsLocalPower(): boolean;
  GetRef(aSheet: SCH_SHEET_PATH | null, aIncludeUnit?: boolean): string;
  GetValue(aResolve: boolean, aPath: SCH_SHEET_PATH | null, aAllowExtraText: boolean): string;
  GetPins(aSheet?: SCH_SHEET_PATH | null): SCH_PIN[];
  GetField(aFieldType: FIELD_T): { GetText(): string } | null;
}

/**
 * `FormatStackedPinForDisplay` (sch_pin.cpp:45): a stacked pin number `[A,B,C]` too wide for
 * its pin, broken into one trimmed name per line inside the brackets.
 */
export function FormatStackedPinForDisplay(
  aPinNumber: string,
  aPinLength: number,
  aTextSize: number,
  aFont: FONT,
  aFontMetrics: METRICS,
): string {
  // Check if this is stacked pin notation: [A,B,C]
  if (!aPinNumber.startsWith('[') || !aPinNumber.endsWith(']')) return aPinNumber;

  const minPinTextWidth = schIUScale.milsToIU(50);
  const maxPinTextWidth = Math.max(aPinLength, minPinTextWidth);

  const fontSize = { x: aTextSize, y: aTextSize };
  const penWidth = GetPenSizeForNormal(aTextSize);
  const textExtents = aFont.StringBoundaryLimits(
    aPinNumber,
    fontSize,
    penWidth,
    false,
    false,
    aFontMetrics,
  );

  if (textExtents.x <= maxPinTextWidth) return aPinNumber; // Fits already

  // Strip brackets and split by comma
  const inner = aPinNumber.slice(1, aPinNumber.length - 1);
  const parts = wxStringSplit(inner, ',');

  if (parts.length === 0) return aPinNumber; // malformed; fallback

  // Build multi-line representation inside braces, each line trimmed
  let result = '[';

  for (let i = 0; i < parts.length; ++i) {
    const line = parts[i]!.trim();

    if (i > 0) result += '\n';

    result += line;
  }

  result += ']';
  return result;
}

export class SCH_PIN extends SCH_ITEM {
  protected m_libPin: SCH_PIN | null; // The corresponding pin in the LIB_SYMBOL
  // (nullptr for a pin *in* the LIB_SYMBOL)

  protected m_alternates: Map<string, SCH_PIN_ALT>; // Map of alternate name to ALT structure
  // (only valid for pins in LIB_SYMBOLS)

  protected m_position: VECTOR2I; // Position of the pin.
  protected m_length: number | undefined; // Length of the pin.
  protected m_orientation: PIN_ORIENTATION; // Pin orientation (Up, Down, Left, Right)
  protected m_shape: GRAPHIC_PINSHAPE; // Shape drawn around pin
  protected m_type: ELECTRICAL_PINTYPE; // Electrical type of the pin.
  protected m_hidden: boolean | undefined;
  protected m_name: string;
  protected m_number: string;
  protected m_numTextSize: number | undefined; // Pin num and Pin name sizes
  protected m_nameTextSize: number | undefined;
  protected m_alt: string; // The current alternate for an instance

  protected m_operatingPoint: string;

  protected m_flipStackedTextSide: boolean;

  protected m_isDangling: boolean;

  /// Net name per sheet path (and whether it was forced no-connect).
  protected m_net_name_map: Map<string, [string, boolean]>;

  /**
   * `SCH_PIN( LIB_SYMBOL* aParentSymbol )` (a new library pin with the defaults),
   * `SCH_PIN( LIB_SYMBOL* ... name, number ... )` through {@link SCH_PIN.makeLibPin},
   * `SCH_PIN( SCH_SYMBOL*, SCH_PIN* aLibPin )` through {@link SCH_PIN.makeInstancePin},
   * `SCH_PIN( SCH_SYMBOL*, number, alt, uuid )` through {@link SCH_PIN.makeFromFile}.
   */
  constructor(aParentSymbol: EDA_ITEM | null) {
    super(aParentSymbol, KICAD_T.SCH_PIN_T, 0, 0);
    this.m_libPin = null;
    this.m_alternates = new Map();
    this.m_position = { x: 0, y: 0 };
    this.m_length = schIUScale.milsToIU(DEFAULT_PIN_LENGTH);
    this.m_orientation = PIN_ORIENTATION.PIN_RIGHT;
    this.m_shape = GRAPHIC_PINSHAPE.LINE;
    this.m_type = ELECTRICAL_PINTYPE.PT_UNSPECIFIED;
    this.m_hidden = false;
    this.m_name = '';
    this.m_number = '';
    this.m_numTextSize = schIUScale.milsToIU(DEFAULT_PINNUM_SIZE);
    this.m_nameTextSize = schIUScale.milsToIU(DEFAULT_PINNAME_SIZE);
    this.m_alt = '';
    this.m_operatingPoint = '';
    this.m_flipStackedTextSide = false;
    this.m_isDangling = true;
    this.m_net_name_map = new Map();

    // SYMBOL_EDITOR_SETTINGS' pin defaults are settings (stage E6): the default_values.h
    // numbers stand, as they do in KiCad without a symbol editor config.

    this.m_layer = SCH_LAYER_ID.LAYER_DEVICE;
  }

  /** `SCH_PIN( LIB_SYMBOL*, aName, aNumber, aOrientation, aPinType, aLength, ... )`. */
  static makeLibPin(
    aParentSymbol: EDA_ITEM | null,
    aName: string,
    aNumber: string,
    aOrientation: PIN_ORIENTATION,
    aPinType: ELECTRICAL_PINTYPE,
    aLength: number,
    aNameTextSize: number,
    aNumTextSize: number,
    aBodyStyle: number,
    aPos: VECTOR2I,
    aUnit: number,
  ): SCH_PIN {
    const pin = new SCH_PIN(aParentSymbol);
    pin.m_unit = aUnit;
    pin.m_bodyStyle = aBodyStyle;
    pin.m_position = { x: aPos.x, y: aPos.y };
    pin.m_length = aLength;
    pin.m_orientation = aOrientation;
    pin.m_type = aPinType;
    pin.m_numTextSize = aNumTextSize;
    pin.m_nameTextSize = aNameTextSize;

    pin.SetName(aName);
    pin.SetNumber(aNumber);
    pin.m_layer = SCH_LAYER_ID.LAYER_DEVICE;
    return pin;
  }

  /** `SCH_PIN( SCH_SYMBOL* aParentSymbol, SCH_PIN* aLibPin )`: an instance pin. */
  static makeInstancePin(aParentSymbol: EDA_ITEM, aLibPin: SCH_PIN): SCH_PIN {
    const pin = new SCH_PIN(aParentSymbol);
    pin.m_libPin = aLibPin;
    pin.m_length = undefined;
    pin.m_orientation = PIN_ORIENTATION.INHERIT;
    pin.m_shape = GRAPHIC_PINSHAPE.INHERIT;
    pin.m_type = ELECTRICAL_PINTYPE.PT_INHERIT;
    pin.m_hidden = undefined;
    pin.m_numTextSize = undefined;
    pin.m_nameTextSize = undefined;
    pin.m_isDangling = true;

    pin.SetName(aLibPin.GetName());
    pin.SetNumber(aLibPin.GetNumber());
    pin.m_position = aLibPin.GetPosition();

    pin.m_layer = SCH_LAYER_ID.LAYER_PIN;
    return pin;
  }

  /**
   * `SCH_PIN( SCH_SYMBOL* aParentSymbol, const wxString& aNumber, const wxString& aAlt,
   * const KIID& aUuid )`: the parser's pin, with no library pin yet.
   */
  static makeFromFile(
    aParentSymbol: EDA_ITEM | null,
    aNumber: string,
    aAlt: string,
    aUuid: KIID,
  ): SCH_PIN {
    const pin = new SCH_PIN(aParentSymbol);
    pin.m_libPin = null;
    pin.m_length = undefined;
    pin.m_orientation = PIN_ORIENTATION.INHERIT;
    pin.m_shape = GRAPHIC_PINSHAPE.INHERIT;
    pin.m_type = ELECTRICAL_PINTYPE.PT_INHERIT;
    pin.m_hidden = undefined;
    pin.m_numTextSize = undefined;
    pin.m_nameTextSize = undefined;
    pin.m_number = aNumber;
    pin.m_alt = aAlt;
    pin.m_isDangling = true;

    (pin as { m_Uuid: KIID }).m_Uuid = aUuid;
    pin.m_layer = SCH_LAYER_ID.LAYER_PIN;
    return pin;
  }

  /** `SCH_PIN( const SCH_PIN& aPin )`. */
  static copyOf(aPin: SCH_PIN): SCH_PIN {
    const copy = SCH_ITEM.copySchItem(new SCH_PIN(null), aPin);
    copy.m_libPin = aPin.m_libPin;
    copy.m_alternates = new Map([...aPin.m_alternates].map(([k, v]) => [k, { ...v }]));
    copy.m_position = { ...aPin.m_position };
    copy.m_length = aPin.m_length;
    copy.m_orientation = aPin.m_orientation;
    copy.m_shape = aPin.m_shape;
    copy.m_type = aPin.m_type;
    copy.m_hidden = aPin.m_hidden;
    copy.m_numTextSize = aPin.m_numTextSize;
    copy.m_nameTextSize = aPin.m_nameTextSize;
    copy.m_alt = aPin.m_alt;
    copy.m_isDangling = aPin.m_isDangling;

    copy.m_name = '';
    copy.m_number = '';
    copy.SetName(aPin.m_name);
    copy.SetNumber(aPin.m_number);
    copy.m_layer = aPin.m_layer;
    return copy;
  }

  /** `SCH_PIN& operator=( const SCH_PIN& aPin )`. */
  assignPin(aPin: SCH_PIN): this {
    this.assignSchItem(aPin);

    this.m_libPin = aPin.m_libPin;
    this.m_alternates = new Map([...aPin.m_alternates].map(([k, v]) => [k, { ...v }]));
    this.m_alt = aPin.m_alt;
    this.m_name = aPin.m_name;
    this.m_number = aPin.m_number;
    this.m_position = { ...aPin.m_position };
    this.m_length = aPin.m_length;
    this.m_orientation = aPin.m_orientation;
    this.m_shape = aPin.m_shape;
    this.m_type = aPin.m_type;
    this.m_hidden = aPin.m_hidden;
    this.m_numTextSize = aPin.m_numTextSize;
    this.m_nameTextSize = aPin.m_nameTextSize;
    this.m_isDangling = aPin.m_isDangling;

    return this;
  }

  override GetClass(): string {
    return 'SCH_PIN';
  }

  static ClassOf(aItem: EDA_ITEM | null): boolean {
    return !!aItem && aItem.Type() === KICAD_T.SCH_PIN_T;
  }

  override GetFriendlyName(): string {
    return 'Pin';
  }

  GetLibPin(): SCH_PIN | null {
    return this.m_libPin;
  }
  SetLibPin(aLibPin: SCH_PIN | null): void {
    this.m_libPin = aLibPin;
  }

  /** The parent symbol, as the parts a pin reads of it. */
  private parentSymbol(): PIN_PARENT_SYMBOL | null {
    return this.GetParentSymbol() as unknown as PIN_PARENT_SYMBOL | null;
  }

  private parentIsSchSymbol(): boolean {
    return this.parentSymbol()?.Type() === KICAD_T.SCH_SYMBOL_T;
  }

  private parentIsLibSymbol(): boolean {
    return this.parentSymbol()?.Type() === KICAD_T.LIB_SYMBOL_T;
  }

  GetOrientation(): PIN_ORIENTATION {
    if (this.m_orientation === PIN_ORIENTATION.INHERIT) {
      if (!this.m_libPin) return PIN_ORIENTATION.PIN_RIGHT;

      return this.m_libPin.GetOrientation();
    }

    return this.m_orientation;
  }

  SetOrientation(aOrientation: PIN_ORIENTATION): void {
    this.m_orientation = aOrientation;
  }

  GetShape(): GRAPHIC_PINSHAPE {
    if (this.m_alt !== '') {
      if (!this.m_libPin) return GRAPHIC_PINSHAPE.LINE;

      return this.m_libPin.GetAlt(this.m_alt).m_Shape;
    } else if (this.m_shape === GRAPHIC_PINSHAPE.INHERIT) {
      if (!this.m_libPin) return GRAPHIC_PINSHAPE.LINE;

      return this.m_libPin.GetShape();
    }

    return this.m_shape;
  }

  SetShape(aShape: GRAPHIC_PINSHAPE): void {
    this.m_shape = aShape;
  }

  GetLength(): number {
    if (this.m_length === undefined) {
      if (!this.m_libPin) return 0;

      return this.m_libPin.GetLength();
    }

    return this.m_length;
  }

  SetLength(aLength: number): void {
    this.m_length = aLength;
  }

  /**
   * Change the length of a pin and adjust its position based on orientation.
   *
   * @param aLength New length of pin
   */
  ChangeLength(aLength: number): void {
    const lengthChange = this.GetLength() - aLength;
    let offsetX = 0;
    let offsetY = 0;

    switch (this.GetOrientation()) {
      case PIN_ORIENTATION.PIN_LEFT:
        offsetX = -1 * lengthChange;
        break;
      case PIN_ORIENTATION.PIN_UP:
        offsetY = -1 * lengthChange;
        break;
      case PIN_ORIENTATION.PIN_DOWN:
        offsetY = lengthChange;
        break;
      default:
        offsetX = lengthChange;
        break;
    }

    this.m_position = { x: this.m_position.x + offsetX, y: this.m_position.y + offsetY };
    this.m_length = aLength;
  }

  GetType(): ELECTRICAL_PINTYPE {
    if (this.m_alt !== '') {
      if (!this.m_libPin) return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;

      return this.m_libPin.GetAlt(this.m_alt).m_Type;
    } else if (this.m_type === ELECTRICAL_PINTYPE.PT_INHERIT) {
      if (!this.m_libPin) return ELECTRICAL_PINTYPE.PT_UNSPECIFIED;

      return this.m_libPin.GetType();
    }

    return this.m_type;
  }

  SetType(aType: ELECTRICAL_PINTYPE): void {
    if (aType === this.m_type) return;

    this.m_type = aType;
  }

  GetCanonicalElectricalTypeName(): string {
    return GetCanonicalElectricalTypeName(this.GetType());
  }

  GetElectricalTypeName(): string {
    return ElectricalPinTypeGetText(this.GetType());
  }

  IsVisible(): boolean {
    if (this.m_hidden === undefined) {
      if (!this.m_libPin) return true;

      return this.m_libPin.IsVisible();
    }

    return !this.m_hidden;
  }

  SetVisible(aVisible: boolean): void {
    this.m_hidden = !aVisible;
  }

  GetName(): string {
    if (this.m_alt !== '') return this.m_alt;

    return this.GetBaseName();
  }

  GetShownName(): string {
    if (this.m_alt !== '') return this.m_alt;
    else if (this.m_libPin) return this.m_libPin.GetShownName();

    return this.m_name;
  }

  SetName(aName: string): void {
    if (this.m_name === aName) return;

    this.m_name = aName;

    // pin name string does not support spaces
    this.m_name = this.m_name.replaceAll(' ', '_');
  }

  /** Get the name without any alternates. */
  GetBaseName(): string {
    if (this.m_libPin) return this.m_libPin.GetBaseName();

    return this.m_name;
  }

  GetNumber(): string {
    return this.m_number;
  }

  GetShownNumber(): string {
    return this.m_number;
  }

  GetStackedPinNumbers(aValid?: { value: boolean }): string[] {
    const { numbers, valid } = expandStacked(this.GetShownNumber());

    if (aValid) aValid.value = valid;

    return numbers;
  }

  GetStackedPinCount(aValid?: { value: boolean }): number {
    const { count, valid } = countStackedPinNotation(this.GetShownNumber());

    if (aValid) aValid.value = valid;

    return count;
  }

  /** The smallest logical pin number of a stacked pin, or undefined when it does not parse. */
  GetSmallestLogicalNumber(): string | undefined {
    const valid = { value: false };
    const numbers = this.GetStackedPinNumbers(valid);

    if (valid.value && numbers.length > 0) return numbers[0]; // Already in ascending order

    return undefined;
  }

  /** The pad number used for net naming: the smallest logical number, else the shown one. */
  GetEffectivePadNumber(): string {
    return this.GetSmallestLogicalNumber() ?? this.GetShownNumber();
  }

  SetNumber(aNumber: string): void {
    if (this.m_number === aNumber) return;

    this.m_number = aNumber;

    // pin number string does not support spaces
    this.m_number = this.m_number.replaceAll(' ', '_');
  }

  GetNameTextSize(): number {
    if (this.m_nameTextSize === undefined) {
      if (!this.m_libPin) return schIUScale.milsToIU(DEFAULT_PINNAME_SIZE);

      return this.m_libPin.GetNameTextSize();
    }

    return this.m_nameTextSize;
  }

  SetNameTextSize(aSize: number): void {
    if (aSize === this.m_nameTextSize) return;

    this.m_nameTextSize = aSize;
  }

  GetNumberTextSize(): number {
    if (this.m_numTextSize === undefined) {
      if (!this.m_libPin) return schIUScale.milsToIU(DEFAULT_PINNUM_SIZE);

      return this.m_libPin.GetNumberTextSize();
    }

    return this.m_numTextSize;
  }

  SetNumberTextSize(aSize: number): void {
    if (aSize === this.m_numTextSize) return;

    this.m_numTextSize = aSize;
  }

  GetAlternates(): Map<string, SCH_PIN_ALT> {
    if (this.m_libPin) return this.m_libPin.GetAlternates();

    return this.m_alternates;
  }

  /**
   * `GetAlternates() = aAlternates` on a pin with no library pin (SCH_SYMBOL::UpdatePins
   * clears the link first): the map is copied into this pin's own.
   */
  assignAlternates(aAlternates: ReadonlyMap<string, SCH_PIN_ALT>): void {
    this.m_alternates = new Map([...aAlternates].map(([k, v]) => [k, { ...v }]));
  }

  /** `GetAlt( const wxString& aAlt )`: `std::map::operator[]`, which inserts a default. */
  GetAlt(aAlt: string): SCH_PIN_ALT;
  /** `GetAlt()`: the current alternate. */
  GetAlt(): string;
  GetAlt(aAlt?: string): SCH_PIN_ALT | string {
    if (aAlt === undefined) return this.m_alt;

    const alternates = this.GetAlternates();
    let alt = alternates.get(aAlt);

    if (!alt) {
      alt = { m_Name: '', m_Shape: GRAPHIC_PINSHAPE.LINE, m_Type: ELECTRICAL_PINTYPE.PT_INPUT };
      alternates.set(aAlt, alt);
    }

    return alt;
  }

  /**
   * Set the name of the alternate pin.
   *
   * @note If the alternate pin is the same as the default pin name or does not exist in the
   *       list of pin alternates, it's set to the default pin name.
   */
  SetAlt(aAlt: string): void {
    // Do not set the alternate pin definition to the default pin name.  This breaks the library
    // symbol comparison for the ERC and the library diff tool.  It also incorrectly causes the
    // schematic symbol pin alternate to be set.
    if (aAlt === '' || aAlt === this.GetBaseName()) {
      this.m_alt = '';
      return;
    }

    if (!this.m_libPin) {
      // wxFAIL_MSG: Pin '%s' has no corresponding lib_pin
      this.m_alt = '';
      return;
    }

    if (!this.m_libPin.GetAlternates().has(aAlt)) {
      // wxFAIL_MSG: Pin '%s' has no alterate '%s'
      this.m_alt = '';
      return;
    }

    this.m_alt = aAlt;
  }

  /**
   * Return the pin real orientation (PIN_UP, PIN_DOWN, PIN_RIGHT, PIN_LEFT), according to its
   * orientation and the matrix transform (rot, mirror) \a aTransform.
   */
  PinDrawOrient(aTransform: TRANSFORM): PIN_ORIENTATION {
    let end = { x: 0, y: 0 }; // position of pin end starting at 0,0 according to its orientation, length = 1

    switch (this.GetOrientation()) {
      case PIN_ORIENTATION.PIN_UP:
        end.y = -1;
        break;
      case PIN_ORIENTATION.PIN_DOWN:
        end.y = 1;
        break;
      case PIN_ORIENTATION.PIN_LEFT:
        end.x = -1;
        break;
      default:
        end.x = 1;
        break;
    }

    // = pos of end point, according to the symbol orientation.
    end = aTransform.TransformCoordinate(end);
    let orient = PIN_ORIENTATION.PIN_UP;

    if (end.x === 0) {
      if (end.y > 0) orient = PIN_ORIENTATION.PIN_DOWN;
    } else {
      orient = PIN_ORIENTATION.PIN_RIGHT;

      if (end.x < 0) orient = PIN_ORIENTATION.PIN_LEFT;
    }

    return orient;
  }

  /**
   * Return whether the stacked-pin text (drawn along the pin) ends up on the far side of the
   * pin after \a aTransform.
   */
  StackedTextSideFlipped(aTransform: TRANSFORM): boolean {
    const ruleSide = (aOrient: PIN_ORIENTATION): VECTOR2I => {
      if (aOrient === PIN_ORIENTATION.PIN_UP || aOrient === PIN_ORIENTATION.PIN_DOWN)
        return { x: -1, y: 0 };

      return { x: 0, y: -1 };
    };

    const mapped = aTransform.TransformCoordinate(ruleSide(this.GetOrientation()));
    const drawn = ruleSide(this.PinDrawOrient(aTransform));

    return mapped.x === -drawn.x && mapped.y === -drawn.y;
  }

  override HitTest(aPosition: VECTOR2I, aAccuracy?: number): boolean;
  override HitTest(aRect: BOX2I, aContained: boolean, aAccuracy?: number): boolean;
  override HitTest(aPoly: SHAPE_LINE_CHAIN, aContained: boolean): boolean;
  override HitTest(
    a: VECTOR2I | BOX2I | SHAPE_LINE_CHAIN,
    b?: number | boolean,
    c?: number,
  ): boolean {
    if ('x' in a && 'y' in a) {
      let aAccuracy = (b as number | undefined) ?? 0;

      // When looking for an "exact" hit aAccuracy will be 0 which works poorly if the pin has
      // no pin number or name.  Give it a floor.
      if (this.Schematic())
        aAccuracy = Math.max(
          aAccuracy,
          Math.trunc(this.Schematic()!.Settings().m_PinSymbolSize / 4),
        );

      const rect = this.GetBoundingBox(false, true, (this.m_flags & SHOW_ELEC_TYPE) !== 0);

      return rect.Inflate(aAccuracy).Contains(a);
    }

    if (this.m_flags & (STRUCT_DELETED | SKIP_STRUCT)) return false;

    const sel = (a as BOX2I).GetInflated(c ?? 0);

    if (b as boolean) return sel.Contains(this.GetBoundingBox(false, false, false));

    return sel.Intersects(this.GetBoundingBox(false, true, (this.m_flags & SHOW_ELEC_TYPE) !== 0));
  }

  override ViewBBox(): BOX2I {
    return this.GetBoundingBox(false, true, (this.m_flags & SHOW_ELEC_TYPE) !== 0);
  }

  override ViewGetLayers(): number[] {
    return [
      SCH_LAYER_ID.LAYER_DANGLING,
      SCH_LAYER_ID.LAYER_DEVICE,
      SCH_LAYER_ID.LAYER_SELECTION_SHADOWS,
      SCH_LAYER_ID.LAYER_OP_CURRENTS,
      SCH_LAYER_ID.LAYER_PINNAM,
      SCH_LAYER_ID.LAYER_PINNUM,
    ];
  }

  /**
   * `GetBoundingBox( aIncludeLabelsOnInvisiblePins, aIncludeNameAndNumber,
   * aIncludeElectricalType )`: `GetLayoutCache().GetPinBoundingBox( … )`.
   *
   * With no arguments: `( false, true, m_flags & SHOW_ELEC_TYPE )`.
   */
  override GetBoundingBox(
    aIncludeLabelsOnInvisiblePins = false,
    aIncludeNameAndNumber = true,
    aIncludeElectricalType = (this.m_flags & SHOW_ELEC_TYPE) !== 0,
  ): BOX2I {
    return this.GetLayoutCache().GetPinBoundingBox(
      aIncludeLabelsOnInvisiblePins,
      aIncludeNameAndNumber,
      aIncludeElectricalType,
    );
  }

  /**
   * Get the layout cache associated with this pin, made on first use.  The owner is
   * checked because a copy made field-by-field would otherwise share its source's cache
   * (upstream's copy constructor leaves `m_layoutCache` empty).
   */
  GetLayoutCache(): PIN_LAYOUT_CACHE {
    if (!this.m_layoutCache || this.m_layoutCacheOwner !== this) {
      this.m_layoutCache = new PIN_LAYOUT_CACHE(
        this as unknown as ConstructorParameters<typeof PIN_LAYOUT_CACHE>[0],
      );
      this.m_layoutCacheOwner = this;
    }

    return this.m_layoutCache;
  }

  private m_layoutCache: PIN_LAYOUT_CACHE | null = null;
  private m_layoutCacheOwner: SCH_PIN | null = null;

  IsGlobalPower(): boolean {
    if (this.GetType() !== ELECTRICAL_PINTYPE.PT_POWER_IN) return false;

    const parent = this.parentSymbol()!;

    if (parent.IsGlobalPower()) return true;

    // Local power symbols are never global, even with invisible pins
    if (parent.IsLocalPower()) return false;

    // Legacy support: invisible power-in pins on non-power symbols act as global power
    return !this.IsVisible();
  }

  IsLocalPower(): boolean {
    return this.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN && this.parentSymbol()!.IsLocalPower();
  }

  IsPower(): boolean {
    return this.IsLocalPower() || this.IsGlobalPower();
  }

  override GetPenWidth(): number {
    return 0;
  }

  override Move(aOffset: VECTOR2I): void {
    this.m_position = { x: this.m_position.x + aOffset.x, y: this.m_position.y + aOffset.y };
  }

  override GetPosition(): VECTOR2I {
    const symbol = this.parentSymbol();

    if (symbol && symbol.Type() === KICAD_T.SCH_SYMBOL_T) {
      const p = symbol.GetTransform().TransformCoordinate(this.m_position);
      const origin = symbol.GetPosition();
      return { x: p.x + origin.x, y: p.y + origin.y };
    }

    return { ...this.m_position };
  }

  GetLocalPosition(): VECTOR2I {
    return { ...this.m_position };
  }

  override SetPosition(aPos: VECTOR2I): void {
    this.m_position = { x: aPos.x, y: aPos.y };
  }

  GetX(): number {
    return this.m_position.x;
  }
  SetX(aX: number): void {
    this.m_position.x = aX;
  }
  GetY(): number {
    return this.m_position.y;
  }
  SetY(aY: number): void {
    this.m_position.y = aY;
  }

  GetPinRoot(): VECTOR2I {
    const symbol = this.parentSymbol();

    if (symbol && symbol.Type() === KICAD_T.SCH_SYMBOL_T) {
      const t = symbol.GetTransform();

      if (!this.m_libPin) return this.GetPosition();

      const p = t.TransformCoordinate(this.m_libPin.GetPinRoot());
      const origin = symbol.GetPosition();
      return { x: p.x + origin.x, y: p.y + origin.y };
    }

    const p = this.m_position;

    switch (this.GetOrientation()) {
      case PIN_ORIENTATION.PIN_LEFT:
        return { x: p.x - this.GetLength(), y: p.y };
      case PIN_ORIENTATION.PIN_UP:
        return { x: p.x, y: p.y - this.GetLength() };
      case PIN_ORIENTATION.PIN_DOWN:
        return { x: p.x, y: p.y + this.GetLength() };
      default:
        return { x: p.x + this.GetLength(), y: p.y };
    }
  }

  override MirrorHorizontally(aCenter: number): void {
    if (this.parentIsLibSymbol()) this.MirrorHorizontallyPin(aCenter);
  }

  override MirrorVertically(aCenter: number): void {
    if (this.parentIsLibSymbol()) this.MirrorVerticallyPin(aCenter);
  }

  override Rotate(aCenter: VECTOR2I, aRotateCCW = true): void {
    if (this.parentIsLibSymbol()) this.RotatePin(aCenter, aRotateCCW);
  }

  MirrorHorizontallyPin(aCenter: number): void {
    this.m_position.x -= aCenter;
    this.m_position.x *= -1;
    this.m_position.x += aCenter;

    if (this.m_orientation === PIN_ORIENTATION.PIN_RIGHT)
      this.m_orientation = PIN_ORIENTATION.PIN_LEFT;
    else if (this.m_orientation === PIN_ORIENTATION.PIN_LEFT)
      this.m_orientation = PIN_ORIENTATION.PIN_RIGHT;
  }

  MirrorVerticallyPin(aCenter: number): void {
    this.m_position.y -= aCenter;
    this.m_position.y *= -1;
    this.m_position.y += aCenter;

    if (this.m_orientation === PIN_ORIENTATION.PIN_UP)
      this.m_orientation = PIN_ORIENTATION.PIN_DOWN;
    else if (this.m_orientation === PIN_ORIENTATION.PIN_DOWN)
      this.m_orientation = PIN_ORIENTATION.PIN_UP;
  }

  RotatePin(aCenter: VECTOR2I, aRotateCCW = true): void {
    if (aRotateCCW) {
      this.m_position = RotatePoint(this.m_position, aCenter, ANGLE_90);

      switch (this.GetOrientation()) {
        case PIN_ORIENTATION.PIN_UP:
          this.m_orientation = PIN_ORIENTATION.PIN_LEFT;
          break;
        case PIN_ORIENTATION.PIN_LEFT:
          this.m_orientation = PIN_ORIENTATION.PIN_DOWN;
          break;
        case PIN_ORIENTATION.PIN_DOWN:
          this.m_orientation = PIN_ORIENTATION.PIN_RIGHT;
          break;
        default:
          this.m_orientation = PIN_ORIENTATION.PIN_UP;
          break;
      }
    } else {
      this.m_position = RotatePoint(this.m_position, aCenter, ANGLE_90.Invert());

      switch (this.GetOrientation()) {
        case PIN_ORIENTATION.PIN_UP:
          this.m_orientation = PIN_ORIENTATION.PIN_RIGHT;
          break;
        case PIN_ORIENTATION.PIN_LEFT:
          this.m_orientation = PIN_ORIENTATION.PIN_UP;
          break;
        case PIN_ORIENTATION.PIN_DOWN:
          this.m_orientation = PIN_ORIENTATION.PIN_LEFT;
          break;
        default:
          this.m_orientation = PIN_ORIENTATION.PIN_DOWN;
          break;
      }
    }
  }

  /** `GetItemDescription( aUnitsProvider, bool aFull )`, or with an explicit alternate. */
  override GetItemDescription(
    _aUnitsProvider: UNITS_PROVIDER | null,
    aFullOrAlt: boolean | SCH_PIN_ALT | null,
  ): string {
    if (typeof aFullOrAlt !== 'boolean') return this.getItemDescription(aFullOrAlt);

    if (this.m_libPin) {
      let alt: SCH_PIN_ALT | null = null;

      if (this.m_alt !== '') alt = { ...this.m_libPin.GetAlt(this.m_alt) };

      const itemDesc = this.m_libPin.GetItemDescription(null, alt);
      const symbol = this.parentSymbol()!;

      return `Symbol ${unescapeString(symbol.GetField(FIELD_T.REFERENCE)?.GetText() ?? '')} ${itemDesc}`;
    }

    return this.getItemDescription(null);
  }

  protected getItemDescription(aAlt: SCH_PIN_ALT | null): string {
    const name = unescapeString(aAlt ? aAlt.m_Name : this.GetShownName());
    const electricalTypeName = ElectricalPinTypeGetText(aAlt ? aAlt.m_Type : this.m_type);
    const pinShapeName = PinShapeGetText(aAlt ? aAlt.m_Shape : this.m_shape);

    if (this.IsVisible()) {
      if (name !== '')
        return `Pin ${this.GetShownNumber()} [${name}, ${electricalTypeName}, ${pinShapeName}]`;
      else return `Pin ${this.GetShownNumber()} [${electricalTypeName}, ${pinShapeName}]`;
    } else {
      if (name !== '')
        return `Hidden pin ${this.GetShownNumber()} [${name}, ${electricalTypeName}, ${pinShapeName}]`;
      else return `Hidden pin ${this.GetShownNumber()} [${electricalTypeName}, ${pinShapeName}]`;
    }
  }

  override Clone(): SCH_PIN {
    return SCH_PIN.copyOf(this);
  }

  override CalcEdit(aPosition: VECTOR2I): void {
    if (this.IsMoving()) this.SetPosition(aPosition);
  }

  override Matches(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown): boolean {
    const searchAllPins = aSearchData instanceof SCH_SEARCH_DATA && aSearchData.searchAllPins;

    if (
      searchAllPins &&
      (this.matchesText(this.GetName(), aSearchData) ||
        this.matchesText(this.GetNumber(), aSearchData))
    ) {
      return true;
    }

    // Net-name search asks this pin's SCH_CONNECTION: pending the connection graph.
    return false;
  }

  override Replace(aSearchData: EDA_SEARCH_DATA, _aAuxData: unknown = null): boolean {
    let isReplaced = false;

    const name = { value: this.m_name };
    isReplaced = EDA_ITEM_CLASS.Replace(aSearchData, name) || isReplaced;
    this.m_name = name.value;

    const number = { value: this.m_number };
    isReplaced = EDA_ITEM_CLASS.Replace(aSearchData, number) || isReplaced;
    this.m_number = number.value;

    return isReplaced;
  }

  static GetCanonicalElectricalTypeName(aType: ELECTRICAL_PINTYPE): string {
    return GetCanonicalElectricalTypeName(aType);
  }

  override IsConnectable(): boolean {
    return true;
  }

  override HasConnectivityChanges(
    aItem: SCH_ITEM,
    _aInstance: SCH_SHEET_PATH | null = null,
  ): boolean {
    // Do not compare to ourself.
    if (aItem === this) return false;

    if (!(aItem instanceof SCH_PIN)) return false; // wxCHECK

    const pin = aItem;

    // Don't check the pin position since it's relative to the symbol.

    if (!samePt(this.GetPosition(), pin.GetPosition())) return true;

    if (this.GetNumber() !== pin.GetNumber()) return true;

    if (this.GetName() !== pin.GetName()) return true;

    // Power pins are connectable when they are invisible (or of power-in type).
    if (
      this.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN ||
      pin.GetType() === ELECTRICAL_PINTYPE.PT_POWER_IN
    ) {
      if (this.IsVisible() !== pin.IsVisible() || this.GetType() !== pin.GetType()) return true;
    }

    return false;
  }

  ClearDefaultNetName(aPath: SCH_SHEET_PATH | null): void {
    if (aPath) this.m_net_name_map.delete(aPath.PathAsString());
    else this.m_net_name_map.clear();
  }

  /** The default net name of an unlabelled net this pin is on, on \a aPath. */
  GetDefaultNetName(aPath: SCH_SHEET_PATH, aForceNoConnect = false): string {
    const symbol = this.parentSymbol()!;

    // Need to check for parent as power symbol to make sure we aren't dealing
    // with legacy global power pins on non-power symbols
    if (this.IsGlobalPower() || this.IsLocalPower()) {
      const parent = this.GetLibPin()?.GetParentSymbol() as unknown as PIN_PARENT_SYMBOL | null;

      if (parent && (parent.IsGlobalPower() || parent.IsLocalPower())) {
        return EscapeString(symbol.GetValue(true, aPath, false), ESCAPE_CONTEXT.CTX_NETNAME);
      } else {
        const tmp = this.m_libPin ? this.m_libPin.GetName() : '??';
        return EscapeString(tmp, ESCAPE_CONTEXT.CTX_NETNAME);
      }
    }

    const key = aPath.PathAsString();
    const cached = this.m_net_name_map.get(key);

    if (cached && cached[1] === aForceNoConnect) return cached[0];

    let name = 'Net-(';
    let unconnected = false;

    if (aForceNoConnect || this.GetType() === ELECTRICAL_PINTYPE.PT_NC) {
      unconnected = true;
      name = 'unconnected-(';
    }

    let annotated = true;

    const pins = symbol.GetPins(aPath);
    let has_multiple = false;

    for (const pin of pins) {
      if (
        pin.GetShownName() === this.GetShownName() &&
        pin.GetShownNumber() !== this.GetShownNumber() &&
        unconnected === (pin.GetType() === ELECTRICAL_PINTYPE.PT_NC)
      ) {
        has_multiple = true;
        break;
      }
    }

    const libPinShownName = this.m_libPin ? this.m_libPin.GetShownName() : '??';
    const libPinShownNumber = this.m_libPin ? this.m_libPin.GetShownNumber() : '??';
    const effectivePadNumber = this.m_libPin
      ? this.m_libPin.GetEffectivePadNumber()
      : libPinShownNumber;

    // Use timestamp for unannotated symbols
    if (symbol.GetRef(aPath, false).endsWith('?')) {
      name += (this.GetParentSymbol() as unknown as PIN_PARENT_SYMBOL).m_Uuid;

      let libPinNumber = this.m_libPin ? this.m_libPin.GetNumber() : '??';

      // Use smallest logical number for stacked pins
      if (effectivePadNumber !== libPinShownNumber && effectivePadNumber !== '')
        libPinNumber = effectivePadNumber;

      name += `-Pad${libPinNumber})`;
      annotated = false;
    } else if (libPinShownName !== '' && libPinShownName !== libPinShownNumber) {
      // Pin names might not be unique between different units so we must have the
      // unit token in the reference designator
      name += symbol.GetRef(aPath, true);
      name += `-${EscapeString(libPinShownName, ESCAPE_CONTEXT.CTX_NETNAME)}`;

      if (unconnected || has_multiple) {
        // Use effective pad number for net naming
        name += `-Pad${EscapeString(effectivePadNumber, ESCAPE_CONTEXT.CTX_NETNAME)}`;
      }

      name += ')';
    } else {
      // Pin numbers are unique, so we skip the unit token
      name += symbol.GetRef(aPath, false);
      name += `-Pad${EscapeString(effectivePadNumber, ESCAPE_CONTEXT.CTX_NETNAME)})`;
    }

    if (annotated) this.m_net_name_map.set(key, [name, aForceNoConnect]);

    return name;
  }

  override IsDangling(): boolean {
    if (this.GetType() === ELECTRICAL_PINTYPE.PT_NC || this.GetType() === ELECTRICAL_PINTYPE.PT_NIC)
      return false;

    return this.m_isDangling;
  }

  SetIsDangling(aIsDangling: boolean): void {
    this.m_isDangling = aIsDangling;
  }

  /**
   * Return whether this pin forms a stacked pin with \a aPin: same parent, same position,
   * same name and a compatible type.
   */
  IsStacked(aPin: SCH_PIN): boolean {
    const isPassiveOrNic = (t: ELECTRICAL_PINTYPE): boolean =>
      t === ELECTRICAL_PINTYPE.PT_PASSIVE || t === ELECTRICAL_PINTYPE.PT_NIC;

    const sameParent = this.m_parent === aPin.GetParent();
    const samePos = samePt(this.GetPosition(), aPin.GetPosition());
    const sameName = this.GetName() === aPin.GetName();
    const typeCompat =
      this.GetType() === aPin.GetType() ||
      isPassiveOrNic(this.GetType()) ||
      isPassiveOrNic(aPin.GetType());

    return sameParent && samePos && sameName && typeCompat;
  }

  override IsPointClickableAnchor(aPos: VECTOR2I): boolean {
    return this.m_isDangling && samePt(this.GetPosition(), aPos);
  }

  override ConnectionPropagatesTo(_aItem: EDA_ITEM): boolean {
    // Reciprocal checking is done in CONNECTION_GRAPH anyway
    return this.GetType() !== ELECTRICAL_PINTYPE.PT_NC;
  }

  GetOperatingPoint(): string {
    return this.m_operatingPoint;
  }
  SetOperatingPoint(aText: string): void {
    this.m_operatingPoint = aText;
  }

  GetFlipStackedTextSide(): boolean {
    return this.m_flipStackedTextSide;
  }
  SetFlipStackedTextSide(aFlip: boolean): void {
    this.m_flipStackedTextSide = aFlip;
  }

  override Similarity(aOther: SCH_ITEM): number {
    if (aOther.m_Uuid === this.m_Uuid) return 1.0;

    if (aOther.Type() !== KICAD_T.SCH_PIN_T) return 0.0;

    const other = aOther as SCH_PIN;

    if (this.m_libPin) {
      if (this.m_number !== other.m_number) return 0.0;

      if (!samePt(this.m_position, other.m_position)) return 0.0;

      return this.m_libPin.Similarity(other.m_libPin!);
    }

    let similarity = this.SimilarityBase(aOther);

    if (this.m_name !== other.m_name) similarity *= 0.9;

    if (this.m_number !== other.m_number) similarity *= 0.9;

    if (!samePt(this.m_position, other.m_position)) similarity *= 0.9;

    if (this.m_length !== other.m_length) similarity *= 0.9;

    if (this.m_orientation !== other.m_orientation) similarity *= 0.9;

    if (this.m_shape !== other.m_shape) similarity *= 0.9;

    if (this.m_type !== other.m_type) similarity *= 0.9;

    if (this.m_hidden !== other.m_hidden) similarity *= 0.9;

    if (this.m_numTextSize !== other.m_numTextSize) similarity *= 0.9;

    if (this.m_nameTextSize !== other.m_nameTextSize) similarity *= 0.9;

    if (this.m_alternates.size !== other.m_alternates.size) similarity *= 0.9;

    return similarity;
  }

  /** `operator>`. */
  greaterThan(aRhs: SCH_ITEM): boolean {
    return this.compare(aRhs, SCH_ITEM.COMPARE_FLAGS.EQUALITY) > 0;
  }

  /**
   * The pin specific sort order is as follows:
   *      - Pin number.
   *      - Pin name, case insensitive compare.
   *      - Pin horizontal (X) position.
   *      - Pin vertical (Y) position.
   */
  override compare(aOther: SCH_ITEM, aCompareFlags = 0): number {
    let retv = super.compare(
      aOther,
      aCompareFlags | SCH_ITEM.COMPARE_FLAGS.EQUALITY | SCH_ITEM.COMPARE_FLAGS.SKIP_TST_POS,
    );

    if (retv) return retv;

    const tmp = aOther as SCH_PIN;

    // When comparing units, we do not compare the part numbers.  If everything else is
    // identical, then we can just renumber the parts for the inherited symbol.
    if (this.m_number !== tmp.m_number) {
      return strNumCmp(this.m_number, tmp.m_number);
    }

    if (this.m_position.x !== tmp.m_position.x) return this.m_position.x - tmp.m_position.x;

    if (this.m_position.y !== tmp.m_position.y) return this.m_position.y - tmp.m_position.y;

    if (this.parentIsSchSymbol()) {
      if (this.m_libPin === null || tmp.m_libPin === null) return -1;

      retv = this.m_libPin.compare(tmp.m_libPin);

      if (retv) return retv;

      retv = wxCmp(this.m_alt, tmp.m_alt);

      if (retv) return retv;
    }

    if (this.parentIsLibSymbol()) {
      if (this.m_length !== tmp.m_length) return (this.m_length ?? 0) - (tmp.m_length ?? 0);

      if (this.m_orientation !== tmp.m_orientation) return this.m_orientation - tmp.m_orientation;

      if (this.m_shape !== tmp.m_shape) return this.m_shape - tmp.m_shape;

      if (this.m_type !== tmp.m_type) return this.m_type - tmp.m_type;

      if (this.m_hidden !== tmp.m_hidden)
        return Number(this.m_hidden ?? false) - Number(tmp.m_hidden ?? false);

      if (this.m_numTextSize !== tmp.m_numTextSize)
        return (this.m_numTextSize ?? 0) - (tmp.m_numTextSize ?? 0);

      if (this.m_nameTextSize !== tmp.m_nameTextSize)
        return (this.m_nameTextSize ?? 0) - (tmp.m_nameTextSize ?? 0);

      if (this.m_alternates.size !== tmp.m_alternates.size)
        return this.m_alternates.size - tmp.m_alternates.size;

      const lhs = alternatesInMapOrder(this.m_alternates);
      const rhs = alternatesInMapOrder(tmp.m_alternates);

      for (let i = 0; i < lhs.length; i++) {
        const lhsAlt = lhs[i]![1];
        const rhsAlt = rhs[i]![1];

        retv = wxCmp(lhsAlt.m_Name, rhsAlt.m_Name);

        if (retv) return retv;

        if (lhsAlt.m_Type !== rhsAlt.m_Type) return lhsAlt.m_Type - rhsAlt.m_Type;

        if (lhsAlt.m_Shape !== rhsAlt.m_Shape) return lhsAlt.m_Shape - rhsAlt.m_Shape;
      }
    }

    return 0;
  }
}
