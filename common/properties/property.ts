// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/properties/property.h`: PROPERTY_BASE, PROPERTY, PROPERTY_ENUM,
 * ENUM_MAP, TYPE_CAST, and the type ids they are keyed by.
 *
 * What the C++ gets from templates and RTTI, this file states explicitly:
 *
 *  - `TYPE_HASH( X )` is `typeid( X ).hash_code()`. A class's id here is the
 *    class itself (`TYPE_HASH( PAD )` is `PAD`, `TYPE_HASH( *item )` is
 *    `item.constructor`); a value type's id is one of the `TYPE_*` tokens
 *    below (`TYPE_HASH( int )` is `TYPE_INT`); an enum's id is its ENUM_MAP,
 *    which `ENUM_MAP.Instance( 'PCB_LAYER_ID' )` keys by the enum's NAME,
 *    because a TypeScript enum is only a number at run time.
 *  - `PROPERTY<Owner, T, Base>` cannot read T from a template, so the value
 *    type id is a constructor argument, after the getter. Everything the C++
 *    derives from T (`TypeHash()`, `get<T>` checks, PCBEXPR's VT_NUMERIC /
 *    VT_STRING choice, PROPERTY_ENUM's choices) reads that id.
 *  - `&PAD::SetWidth` becomes the name `'SetWidth'`, looked up on the object
 *    when the property is read or written: a pointer to a virtual member
 *    dispatches on the object in the C++ too, and an abstract or mixed-in
 *    method (EDA_SHAPE's, EDA_TEXT's) has no entry on the base prototype.
 *  - `wxAny` is `unknown`. `Get<T>` type checks compare the property's type id
 *    with what the caller asked for, as the C++ `CheckType<T>` does.
 *
 * `_HKI( s )` (a translation marker, no translation) is the bare string.
 */
import type { COORD_TYPES_T } from '../origin_transforms.js';
import { COORD_TYPES_T as ORIGIN_COORD } from '../origin_transforms.js';

/**
 * Common property types.
 */
export enum PROPERTY_DISPLAY {
  PT_DEFAULT, ///< Default property for a given type
  PT_SIZE, ///< Size expressed in distance units (mm/inch)
  PT_AREA, ///< Area expressed in distance units-squared (mm/inch)
  PT_COORD, ///< Coordinate expressed in distance units (mm/inch)
  PT_DEGREE, ///< Angle expressed in degrees
  PT_DECIDEGREE, ///< Angle expressed in decidegrees
  PT_RATIO,
  PT_TIME, ///< Time expressed in ps
  PT_NET, ///< Net selection property
}

/**
 * A value type's `typeid`: one token per C++ type a property can hold. The
 * C++ compares `hash_code()`s; these compare by identity.
 */
export class VALUE_TYPE_ID {
  constructor(readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

export const TYPE_INT = new VALUE_TYPE_ID('int');
export const TYPE_UNSIGNED = new VALUE_TYPE_ID('unsigned');
export const TYPE_DOUBLE = new VALUE_TYPE_ID('double');
export const TYPE_BOOL = new VALUE_TYPE_ID('bool');
export const TYPE_STRING = new VALUE_TYPE_ID('wxString');
export const TYPE_EDA_ANGLE = new VALUE_TYPE_ID('EDA_ANGLE');
export const TYPE_COLOR4D = new VALUE_TYPE_ID('COLOR4D');
export const TYPE_OPT_INT = new VALUE_TYPE_ID('std::optional<int>');
export const TYPE_OPT_DOUBLE = new VALUE_TYPE_ID('std::optional<double>');
export const TYPE_VECTOR2I = new VALUE_TYPE_ID('VECTOR2I');

// biome-ignore lint/complexity/noBannedTypes: a class constructor of any arity, as `typeid` names one
export type CLASS_TYPE_ID = Function;

/** Unique type identifier: a class, a value type token, or an enum's map. */
export type TYPE_ID = CLASS_TYPE_ID | VALUE_TYPE_ID | ENUM_MAP<number>;

/**
 * `TYPE_HASH( x )`: of a class, the class; of an object, its class.
 */
export function TYPE_HASH(x: object | CLASS_TYPE_ID): CLASS_TYPE_ID {
  return typeof x === 'function' ? x : (x.constructor as CLASS_TYPE_ID);
}

/** `TYPE_NAME( x )`: the class name. */
export function TYPE_NAME(x: CLASS_TYPE_ID): string {
  return x.name;
}

/**
 * `wxPGChoices`: the labelled values of an enum property.
 */
export class PG_CHOICE_ENTRY {
  constructor(
    private m_text: string,
    private m_value: number,
  ) {}
  GetText(): string {
    return this.m_text;
  }
  GetValue(): number {
    return this.m_value;
  }
  SetText(aText: string): void {
    this.m_text = aText;
  }
}

export class PG_CHOICES {
  private m_entries: PG_CHOICE_ENTRY[] = [];

  Add(aLabel: string, aValue: number = this.m_entries.length): PG_CHOICE_ENTRY {
    const e = new PG_CHOICE_ENTRY(aLabel, aValue);
    this.m_entries.push(e);
    return e;
  }
  GetCount(): number {
    return this.m_entries.length;
  }
  GetLabel(aIndex: number): string {
    return this.m_entries[aIndex]!.GetText();
  }
  GetValue(aIndex: number): number {
    return this.m_entries[aIndex]!.GetValue();
  }
  /** `Index( int aValue )`: the entry with that value, or -1. */
  Index(aValue: number): number;
  /** `Index( const wxString& aLabel )`: the entry with that label, or -1. */
  Index(aLabel: string): number;
  Index(a: number | string): number {
    if (typeof a === 'number') return this.m_entries.findIndex((e) => e.GetValue() === a);
    return this.m_entries.findIndex((e) => e.GetText() === a);
  }
  Item(aIndex: number): PG_CHOICE_ENTRY {
    return this.m_entries[aIndex]!;
  }
  Clear(): void {
    this.m_entries = [];
  }
  /** Copy, as `m_choices = aChoices` copies the wx object. */
  Assign(aOther: PG_CHOICES): void {
    this.m_entries = aOther.m_entries.map((e) => new PG_CHOICE_ENTRY(e.GetText(), e.GetValue()));
  }
  Copy(): PG_CHOICES {
    const c = new PG_CHOICES();
    c.Assign(this);
    return c;
  }
  [Symbol.iterator](): Iterator<PG_CHOICE_ENTRY> {
    return this.m_entries[Symbol.iterator]();
  }
}

/**
 * `ENUM_MAP<T>`: the names of an enum's values. `Instance( aName )` is
 * `ENUM_MAP<T>::Instance()` for the enum called aName; the map itself is the
 * enum's type id.
 */
export class ENUM_MAP<T extends number> {
  private static s_instances = new Map<string, ENUM_MAP<number>>();

  static Instance<T extends number>(aEnumName: string): ENUM_MAP<T> {
    let inst = ENUM_MAP.s_instances.get(aEnumName);
    if (!inst) {
      inst = new ENUM_MAP<number>(aEnumName);
      ENUM_MAP.s_instances.set(aEnumName, inst);
    }
    return inst as ENUM_MAP<T>;
  }

  private m_choices = new PG_CHOICES();
  private m_reverseMap = new Map<string, T>();
  private m_undefined: T = 0 as T; // Returned if the string is not recognized

  private constructor(readonly name: string) {}

  Map(aValue: T, aName: string): this {
    this.m_choices.Add(aName, aValue);
    this.m_reverseMap.set(aName, aValue);
    return this;
  }

  Undefined(aValue: T): this {
    this.m_undefined = aValue;
    return this;
  }

  GetUndefined(): T {
    return this.m_undefined;
  }

  ToString(value: T): string {
    const idx = this.m_choices.Index(value);

    if (idx >= 0 && idx < this.m_choices.GetCount()) return this.m_choices.GetLabel(idx);
    return 'UNDEFINED';
  }

  IsValueDefined(value: T): boolean {
    const idx = this.m_choices.Index(value);

    if (idx >= 0 && idx < this.m_choices.GetCount()) return true;

    return false;
  }

  ToEnum(value: string): T {
    const v = this.m_reverseMap.get(value);
    return v !== undefined ? v : this.m_undefined;
  }

  Choices(): PG_CHOICES {
    return this.m_choices;
  }
}

/**
 * Represents an error returned by a validator and contains enough data to
 * format an error message (`property_validator.h`).
 */
export abstract class VALIDATION_ERROR {
  abstract Format(aUnits: UNITS_PROVIDER_LIKE): string;
}

/** The one `UNITS_PROVIDER` call a validation error formats with. */
export interface UNITS_PROVIDER_LIKE {
  StringFromValue(aValue: number, aAddUnitLabel?: boolean): string;
}

/// Null optional means validation succeeded
export type VALIDATOR_RESULT = VALIDATION_ERROR | null;

export type PROPERTY_VALIDATOR_FN = (
  aValue: unknown,
  aItem: INSPECTABLE_ITEM | null,
) => VALIDATOR_RESULT;

/** The `EDA_ITEM*` a validator gets: any inspectable object. */
export type INSPECTABLE_ITEM = object;

export type AVAIL_FN = (aObject: INSPECTABLE_ITEM) => boolean;
export type CHOICES_FN = (aObject: INSPECTABLE_ITEM) => PG_CHOICES;

export abstract class PROPERTY_BASE {
  /**
   * Permanent identifier for this property.  Property names are an API contract; changing them
   * after release will impact the Custom DRC Rules system as well as the automatic API binding
   * system.  Never rename properties; instead deprecate them and hide them from the GUI.
   */
  private readonly m_name: string;

  /// The display style controls how properties are edited in the properties manager GUI
  private m_display: PROPERTY_DISPLAY;

  /// The coordinate type controls how distances are mapped to the user coordinate system
  private m_coordType: COORD_TYPES_T;

  private m_hideFromPropertiesManager = false; // Do not show in Properties Manager
  private m_hideFromLibraryEditors = false; // Do not show in Properties Manager of symbol or
  //   footprint editors
  private m_hideFromDesignEditors = false; // Do not show in Properties Manager of schematic or
  //   board editors
  private m_hideFromRulesEditor = false; // Do not show in Custom Rules editor autocomplete

  /// Optional group identifier
  private m_group = '';

  private m_availFunc: AVAIL_FN = () => true; ///< Eval to determine if prop is available

  private m_writeableFunc: AVAIL_FN = () => true; ///< Eval to determine if prop is read-only

  private m_choicesFunc: CHOICES_FN | null = null;

  private m_validator: PROPERTY_VALIDATOR_FN = PROPERTY_BASE.NullValidator;

  constructor(
    aName: string,
    aDisplay: PROPERTY_DISPLAY = PROPERTY_DISPLAY.PT_DEFAULT,
    aCoordType: COORD_TYPES_T = ORIGIN_COORD.NOT_A_COORD,
  ) {
    this.m_name = aName;
    this.m_display = aDisplay;
    this.m_coordType = aCoordType;
  }

  Name(): string {
    return this.m_name;
  }

  /**
   * Return a limited set of possible values (e.g. enum). Check with HasChoices() if a particular
   * PROPERTY provides such set.
   */
  Choices(): PG_CHOICES {
    return PROPERTY_BASE.s_emptyChoices;
  }
  private static readonly s_emptyChoices = new PG_CHOICES();

  TranslateChoices(): void {}

  /**
   * Set the possible values for for the property.
   */
  SetChoices(_aChoices: PG_CHOICES): void {
    throw new Error('wxFAIL: only possible for PROPERTY_ENUM');
  }

  /**
   * Return true if this PROPERTY has a limited set of possible values.
   * @see PROPERTY_BASE::Choices()
   */
  HasChoices(): boolean {
    return this.m_choicesFunc !== null;
  }

  /**
   * Return true if aObject offers this PROPERTY.
   */
  Available(aObject: INSPECTABLE_ITEM): boolean {
    return this.m_availFunc(aObject);
  }

  /**
   * Set a callback function to determine whether an object provides this property.
   */
  SetAvailableFunc(aFunc: AVAIL_FN): this {
    this.m_availFunc = aFunc;
    return this;
  }

  GetChoices(aObject: INSPECTABLE_ITEM): PG_CHOICES {
    if (this.m_choicesFunc) return this.m_choicesFunc(aObject);

    return new PG_CHOICES();
  }

  SetChoicesFunc(aFunc: CHOICES_FN): this {
    this.m_choicesFunc = aFunc;
    return this;
  }

  Writeable(aObject: INSPECTABLE_ITEM): boolean {
    return this.m_writeableFunc(aObject);
  }

  SetWriteableFunc(aFunc: AVAIL_FN): this {
    this.m_writeableFunc = aFunc;
    return this;
  }

  /**
   * Return type-id of the Owner class.
   */
  abstract OwnerHash(): CLASS_TYPE_ID;

  /**
   * Return type-id of the Base class.
   */
  abstract BaseHash(): CLASS_TYPE_ID;

  /**
   * Return type-id of the property type.
   */
  abstract TypeHash(): TYPE_ID;

  Display(): PROPERTY_DISPLAY {
    return this.m_display;
  }
  SetDisplay(aDisplay: PROPERTY_DISPLAY): this {
    this.m_display = aDisplay;
    return this;
  }

  CoordType(): COORD_TYPES_T {
    return this.m_coordType;
  }
  SetCoordType(aType: COORD_TYPES_T): this {
    this.m_coordType = aType;
    return this;
  }

  IsHiddenFromPropertiesManager(): boolean {
    return this.m_hideFromPropertiesManager;
  }
  SetIsHiddenFromPropertiesManager(aHide = true): this {
    this.m_hideFromPropertiesManager = aHide;
    return this;
  }

  IsHiddenFromRulesEditor(): boolean {
    return this.m_hideFromRulesEditor;
  }
  SetIsHiddenFromRulesEditor(aHide = true): this {
    this.m_hideFromRulesEditor = aHide;
    return this;
  }

  IsHiddenFromLibraryEditors(): boolean {
    return this.m_hideFromLibraryEditors;
  }
  SetIsHiddenFromLibraryEditors(aIsHidden = true): this {
    this.m_hideFromLibraryEditors = aIsHidden;
    return this;
  }

  IsHiddenFromDesignEditors(): boolean {
    return this.m_hideFromDesignEditors;
  }
  SetIsHiddenFromDesignEditors(aIsHidden = true): this {
    this.m_hideFromDesignEditors = aIsHidden;
    return this;
  }

  Group(): string {
    return this.m_group;
  }
  SetGroup(aGroup: string): this {
    this.m_group = aGroup;
    return this;
  }

  SetValidator(aValidator: PROPERTY_VALIDATOR_FN): this {
    this.m_validator = aValidator;
    return this;
  }

  Validate(aValue: unknown, aItem: INSPECTABLE_ITEM | null): VALIDATOR_RESULT {
    return this.m_validator(aValue, aItem);
  }

  static NullValidator(_aValue: unknown, _aItem: INSPECTABLE_ITEM | null): VALIDATOR_RESULT {
    return null;
  }

  /**
   * `set<T>( aObject, aValue )`: the variant conversions the C++ does for a
   * wxVariant from the property grid are the grid's (stage 6); here the value
   * goes to the setter as it is.
   */
  set(aObject: object, aValue: unknown): void {
    this.setter(aObject, aValue);
  }

  /**
   * `get<T>( aObject )`: the value, with the C++'s two rules: a bool becomes
   * a numeric (1 / 0), and a value of another type than the property's throws
   * `std::invalid_argument( "Invalid requested type" )`.
   */
  get(aObject: object, aType: TYPE_ID): unknown {
    let a = this.getter(aObject);

    // We don't currently have a bool type, so change it to a numeric
    if (typeof a === 'boolean') a = a ? 1 : 0;

    const mine = this.TypeHash();
    const isEnum = mine instanceof ENUM_MAP;

    if (!(isEnum && aType === TYPE_INT) && !typeMatches(mine, aType))
      throw new Error('Invalid requested type');

    return a;
  }

  /** `setter( void*, wxAny& )` */
  abstract setter(aObject: object, aValue: unknown): void;
  /** `getter( const void* )` */
  abstract getter(aObject: object): unknown;
}

/**
 * The C++ `a.CheckType<T>()` on a property value: the requested type id is the
 * property's, or the bool-to-int reading `get<T>` allows.
 */
function typeMatches(aMine: TYPE_ID, aRequested: TYPE_ID): boolean {
  if (aMine === aRequested) return true;
  // a bool property reads as int (see get()): `a.CheckType<bool>() -> int`
  if (aMine === TYPE_BOOL && aRequested === TYPE_INT) return true;
  return false;
}

/**
 * `T (Base::*)() const`: a member function pointer is a NAME here, looked up
 * on the object at call time — which is what a pointer to a virtual member
 * does in the C++ (`&A::setA` on a D calls `D::setA`), and what an abstract
 * or mixed-in method needs, having no entry on the base prototype.
 */
export type GETTER<Base, _T> = keyof Base & string;
/** `void (Base::*)( T )`; `NO_SETTER( owner, type )` is null. */
export type SETTER<Base, _T> = (keyof Base & string) | null;

export class PROPERTY<Owner extends object, T, Base extends object = Owner> extends PROPERTY_BASE {
  ///< Set method
  protected m_setter: SETTER<Base, T>;

  ///< Get method
  protected m_getter: GETTER<Base, T>;

  ///< Owner class type-id
  private readonly m_ownerHash: CLASS_TYPE_ID;

  ///< Base class type-id
  private readonly m_baseHash: CLASS_TYPE_ID;

  ///< Property value type-id
  private readonly m_typeHash: TYPE_ID;

  /**
   * @param aOwner the Owner class (`TYPE_HASH( Owner )`)
   * @param aName the property name
   * @param aSetter `&Base::Setter`, or null for `NO_SETTER`
   * @param aGetter `&Base::Getter`
   * @param aType the value type id (`TYPE_INT`, ... or an ENUM_MAP)
   * @param aBase the class declaring the accessors when it is not the owner
   */
  constructor(
    aOwner: CLASS_TYPE_ID,
    aName: string,
    aSetter: SETTER<Base, T>,
    aGetter: GETTER<Base, T>,
    aType: TYPE_ID,
    aDisplay: PROPERTY_DISPLAY = PROPERTY_DISPLAY.PT_DEFAULT,
    aCoordType: COORD_TYPES_T = ORIGIN_COORD.NOT_A_COORD,
    aBase: CLASS_TYPE_ID = aOwner,
  ) {
    super(aName, aDisplay, aCoordType);
    this.m_setter = aSetter;
    this.m_getter = aGetter;
    this.m_ownerHash = aOwner;
    this.m_baseHash = aBase;
    this.m_typeHash = aType;
  }

  override OwnerHash(): CLASS_TYPE_ID {
    return this.m_ownerHash;
  }

  override BaseHash(): CLASS_TYPE_ID {
    return this.m_baseHash;
  }

  override TypeHash(): TYPE_ID {
    return this.m_typeHash;
  }

  override Writeable(aObject: INSPECTABLE_ITEM): boolean {
    return this.m_setter !== null && super.Writeable(aObject);
  }

  override setter(obj: object, v: unknown): void {
    if (!this.m_setter) throw new Error('wxCHECK: property has no setter');

    callMember(obj, this.m_setter, v as T);
  }

  override getter(obj: object): unknown {
    return callMember(obj, this.m_getter);
  }
}

/** `( aOwner->*m_func )( args )` */
function callMember(aObject: object, aName: string, ...aArgs: unknown[]): unknown {
  const fn = (aObject as Record<string, unknown>)[aName];

  if (typeof fn !== 'function') throw new Error(`No member function '${aName}' on the object`);

  return (fn as (...a: unknown[]) => unknown).apply(aObject, aArgs);
}

export class PROPERTY_ENUM<
  Owner extends object,
  T extends number,
  Base extends object = Owner,
> extends PROPERTY<Owner, T, Base> {
  protected m_choicesFromENUM_MAP: boolean;
  protected m_choices = new PG_CHOICES();
  /** `ENUM_MAP<T>::Instance()`; null for the `PROPERTY_ENUM<Owner, int>` form. */
  private readonly m_enumMap: ENUM_MAP<T> | null;

  /**
   * @param aEnum the enum's ENUM_MAP (`ENUM_MAP<T>::Instance()`), which is the
   *              property's type id and the source of its choices — or a value
   *              type id for `PROPERTY_ENUM<Owner, int>` (`std::is_enum<T>` is
   *              false: no choices from a map, the type is int)
   */
  constructor(
    aOwner: CLASS_TYPE_ID,
    aName: string,
    aSetter: SETTER<Base, T>,
    aGetter: GETTER<Base, T>,
    aEnum: ENUM_MAP<T> | VALUE_TYPE_ID,
    aDisplay: PROPERTY_DISPLAY = PROPERTY_DISPLAY.PT_DEFAULT,
    aCoordType: COORD_TYPES_T = ORIGIN_COORD.NOT_A_COORD,
    aBase: CLASS_TYPE_ID = aOwner,
  ) {
    super(aOwner, aName, aSetter, aGetter, aEnum, aDisplay, aCoordType, aBase);
    this.m_enumMap = aEnum instanceof ENUM_MAP ? aEnum : null;
    this.m_choicesFromENUM_MAP = false;

    if (this.m_enumMap) {
      // if( std::is_enum<T>::value )
      this.m_choices = this.m_enumMap.Choices().Copy();
      this.m_choicesFromENUM_MAP = true;
      if (this.m_choices.GetCount() === 0) console.assert(false, 'No enum choices defined');
    }
  }

  override setter(obj: object, v: unknown): void {
    if (!this.m_setter) throw new Error('wxCHECK: property has no setter');

    if (typeof v === 'number') {
      callMember(obj, this.m_setter, v as T);
    } else {
      throw new Error('Invalid type requested');
    }
  }

  override getter(obj: object): unknown {
    return callMember(obj, this.m_getter) as number;
  }

  override Choices(): PG_CHOICES {
    if (this.m_choices.GetCount() > 0) return this.m_choices;

    return this.m_enumMap ? this.m_enumMap.Choices() : PROPERTY_ENUM.s_noChoices;
  }
  private static readonly s_noChoices = new PG_CHOICES();

  override TranslateChoices(): void {
    if (this.m_choicesFromENUM_MAP && this.m_enumMap) {
      this.m_choices.Clear();

      const choices = this.m_enumMap.Choices();

      for (let ii = 0; ii < choices.GetCount(); ++ii)
        this.m_choices.Add(choices.GetLabel(ii), choices.GetValue(ii));
    }
  }

  override SetChoices(aChoices: PG_CHOICES): void {
    this.m_choices = aChoices.Copy();
    this.m_choicesFromENUM_MAP = false;
  }

  override HasChoices(): boolean {
    return this.Choices().GetCount() > 0;
  }
}

/**
 * `TYPE_CAST<Base, Derived>`: in the C++ a static_cast between the two
 * subobjects of a multiply-inherited class. An object here is one reference
 * whatever its bases (mixins copy methods onto the one prototype), so the
 * cast is the identity; what remains is the (base, derived) pair the manager
 * records for `TypeCast` and `InheritsAfter`'s assertion.
 */
export class TYPE_CAST {
  constructor(
    private readonly m_base: CLASS_TYPE_ID,
    private readonly m_derived: CLASS_TYPE_ID,
  ) {}

  cast(aPointer: object): object {
    return aPointer;
  }

  BaseHash(): CLASS_TYPE_ID {
    return this.m_base;
  }

  DerivedHash(): CLASS_TYPE_ID {
    return this.m_derived;
  }
}

/** `NO_SETTER( owner, type )` */
export const NO_SETTER = null;

/**
 * `wxAnyValueTypeImpl<enum>::ConvertValue` to wxString (the
 * `ENUM_TO_WXANY( type )` specialisation): the value's name, or null when the
 * value is neither mapped nor the map's undefined value — which is what
 * `any.GetAs<wxString>( &str )` returning false means.
 */
export function enumAnyAsString(aMap: ENUM_MAP<number>, aValue: number): string | null {
  if (!aMap.IsValueDefined(aValue) && aValue !== aMap.GetUndefined()) return null;

  return aMap.ToString(aValue);
}
