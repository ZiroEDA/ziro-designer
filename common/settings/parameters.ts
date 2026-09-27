// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/parameters.cpp` + `include/settings/parameters.h`: the
 * `PARAM`s that bind members of a `JSON_SETTINGS` subclass to paths in its
 * tree.
 *
 * A C++ `PARAM` holds a pointer to the member. Here it holds a getter and a
 * setter, which is the same binding without the address.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { JSON_SETTINGS } from './json_settings.js';
import { type JsonObject, type JsonValue, jsonEquals } from './json_settings_internals.js';

/**
 * `PARAM_BASE`: one binding between a JSON path and a member.
 *
 * `m_readOnly` params are never loaded — the member is authoritative and the
 * file is only written. `m_clearUnknownKeys` marks a param whose subtree
 * should be wiped before storing, so keys the program no longer knows do not
 * survive a save.
 */
export abstract class PARAM_BASE {
  protected m_path: string; ///< Address of the param in the json files
  protected m_readOnly: boolean; ///< Indicates param pointer should never be overwritten
  protected m_clearUnknownKeys: boolean; ///< Keys should be cleared

  constructor(aJsonPath: string, aReadOnly: boolean) {
    this.m_path = aJsonPath;
    this.m_readOnly = aReadOnly;
    this.m_clearUnknownKeys = false;
  }

  /**
   * Load the value of this parameter from JSON to the underlying storage.
   *
   * @param aSettings is the JSON_SETTINGS object to load from.
   * @param aResetIfMissing if true will set the parameter to its default value if the load fails
   */
  abstract Load(aSettings: JSON_SETTINGS, aResetIfMissing?: boolean): void;

  /** Store the value of this parameter to the given JSON_SETTINGS object. */
  abstract Store(aSettings: JSON_SETTINGS): void;

  abstract SetDefault(): void;

  /** Check whether the parameter in memory matches the one in a given JSON file. */
  abstract MatchesFile(aSettings: JSON_SETTINGS): boolean;

  /** @return the path name of the parameter used to store it in the json file. */
  GetJsonPath(): string {
    return this.m_path;
  }

  ClearUnknownKeys(): boolean {
    return this.m_clearUnknownKeys;
  }

  SetClearUnknownKeys(aSet = true): void {
    this.m_clearUnknownKeys = aSet;
  }
}

/** The two halves of a C++ pointer-to-member. */
export interface Ref<T> {
  get(): T;
  set(v: T): void;
}

/** A `Ref` over one property of an object — `PARAM( "path", &m_field, … )`. */
export function ref<O, K extends keyof O>(obj: O, key: K): Ref<O[K]> {
  return {
    get: () => obj[key],
    set: (v) => {
      obj[key] = v;
    },
  };
}

/**
 * `PARAM<ValueType>`: a scalar, optionally range-checked.
 *
 * A value outside `[m_min, m_max]` does not clamp — it falls back to the
 * DEFAULT, on the reasoning that an out-of-range number in a settings file
 * is corruption rather than intent.
 */
export class PARAM<ValueType extends JsonValue> extends PARAM_BASE {
  private m_min: ValueType | undefined;
  private m_max: ValueType | undefined;
  private m_use_minmax: boolean;
  private m_ptr: Ref<ValueType>;
  private m_default: ValueType;

  constructor(aJsonPath: string, aPtr: Ref<ValueType>, aDefault: ValueType, aReadOnly?: boolean);
  constructor(
    aJsonPath: string,
    aPtr: Ref<ValueType>,
    aDefault: ValueType,
    aMin: ValueType,
    aMax: ValueType,
    aReadOnly?: boolean,
  );
  constructor(
    aJsonPath: string,
    aPtr: Ref<ValueType>,
    aDefault: ValueType,
    aMinOrReadOnly?: ValueType | boolean,
    aMax?: ValueType,
    aReadOnly = false,
  ) {
    const ranged = aMax !== undefined;
    super(aJsonPath, ranged ? aReadOnly : ((aMinOrReadOnly as boolean | undefined) ?? false));
    this.m_min = ranged ? (aMinOrReadOnly as ValueType) : undefined;
    this.m_max = aMax;
    this.m_use_minmax = ranged;
    this.m_ptr = aPtr;
    this.m_default = aDefault;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const optval = aSettings.Get<ValueType>(this.m_path);

    if (optval !== undefined) {
      let val = optval;

      if (this.m_use_minmax) {
        if ((this.m_max as number) < (val as number) || (val as number) < (this.m_min as number))
          val = this.m_default;
      }

      this.m_ptr.set(val);
    } else if (aResetIfMissing) {
      this.m_ptr.set(this.m_default);
    }
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<ValueType>(this.m_path, this.m_ptr.get());
  }

  GetDefault(): ValueType {
    return this.m_default;
  }

  override SetDefault(): void {
    this.m_ptr.set(this.m_default);
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const optval = aSettings.Get<ValueType>(this.m_path);
    return optval !== undefined && jsonEquals(optval, this.m_ptr.get());
  }
}

/**
 * `PARAM_LAMBDA<ValueType>`: a value with no member behind it — the getter and
 * setter are the whole binding. Used where the stored form and the in-memory
 * form differ, e.g. a `LSET` stored as a list of layer names.
 */
export class PARAM_LAMBDA<ValueType extends JsonValue> extends PARAM_BASE {
  private m_default: ValueType;
  private m_getter: () => ValueType;
  private m_setter: (v: ValueType) => void;

  constructor(
    aJsonPath: string,
    aGetter: () => ValueType,
    aSetter: (v: ValueType) => void,
    aDefault: ValueType,
    aReadOnly = false,
  ) {
    super(aJsonPath, aReadOnly);
    this.m_default = aDefault;
    this.m_getter = aGetter;
    this.m_setter = aSetter;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const optval = aSettings.Get<ValueType>(this.m_path);

    if (optval !== undefined) this.m_setter(optval);
    else if (aResetIfMissing) this.m_setter(this.m_default);
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<ValueType>(this.m_path, this.m_getter());
  }

  override SetDefault(): void {
    this.m_setter(this.m_default);
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const optval = aSettings.Get<ValueType>(this.m_path);
    return optval !== undefined && jsonEquals(optval, this.m_getter());
  }
}

/**
 * `PARAM_ENUM<EnumType>`: an enum stored as its integer, range-checked
 * against `[aMin, aMax]` — a value past the enum's end (a file from a newer
 * version) falls back to the default rather than producing an enum member
 * that does not exist.
 */
export class PARAM_ENUM<EnumType extends number> extends PARAM_BASE {
  private m_ptr: Ref<EnumType>;
  private m_min: EnumType;
  private m_max: EnumType;
  private m_default: EnumType;

  constructor(
    aJsonPath: string,
    aPtr: Ref<EnumType>,
    aDefault: EnumType,
    aMin: EnumType,
    aMax: EnumType,
    aReadOnly = false,
  ) {
    super(aJsonPath, aReadOnly);
    this.m_ptr = aPtr;
    this.m_min = aMin;
    this.m_max = aMax;
    this.m_default = aDefault;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const val = aSettings.Get<number>(this.m_path);

    if (val !== undefined) {
      if (val >= this.m_min && val <= this.m_max) this.m_ptr.set(val as EnumType);
      else if (aResetIfMissing) this.m_ptr.set(this.m_default);
    } else if (aResetIfMissing) {
      this.m_ptr.set(this.m_default);
    }
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<number>(this.m_path, this.m_ptr.get());
  }

  GetDefault(): EnumType {
    return this.m_default;
  }

  override SetDefault(): void {
    this.m_ptr.set(this.m_default);
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const val = aSettings.Get<number>(this.m_path);
    return val !== undefined && val === this.m_ptr.get();
  }
}

/**
 * `PARAM_SCALED<ValueType>`: a number stored in one unit and held in another,
 * multiplied on the way out and divided on the way in. Board settings keep
 * nanometres and the file keeps millimetres.
 */
export class PARAM_SCALED extends PARAM_BASE {
  private m_ptr: Ref<number>;
  private m_default: number;
  private m_min: number | undefined;
  private m_max: number | undefined;
  private m_use_minmax: boolean;
  private m_scale: number;
  private m_invScale: number;

  constructor(
    aJsonPath: string,
    aPtr: Ref<number>,
    aDefault: number,
    aScale: number,
    aReadOnly?: boolean,
  );
  constructor(
    aJsonPath: string,
    aPtr: Ref<number>,
    aDefault: number,
    aMin: number,
    aMax: number,
    aScale: number,
    aReadOnly?: boolean,
  );
  constructor(
    aJsonPath: string,
    aPtr: Ref<number>,
    aDefault: number,
    a4: number,
    a5?: number | boolean,
    a6?: number,
    a7 = false,
  ) {
    const ranged = a6 !== undefined;
    super(aJsonPath, ranged ? a7 : ((a5 as boolean | undefined) ?? false));
    this.m_ptr = aPtr;
    this.m_default = aDefault;
    this.m_min = ranged ? a4 : undefined;
    this.m_max = ranged ? (a5 as number) : undefined;
    this.m_use_minmax = ranged;
    // `aScale` is the file unit per IU (`pcbIUScale.MM_PER_IU`), as upstream:
    // a load multiplies by the inverse, a store divides by it.
    this.m_scale = ranged ? a6 : a4;
    this.m_invScale = 1 / this.m_scale;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    let dval = this.m_default / this.m_invScale;

    const optval = aSettings.Get<number>(this.m_path);

    if (optval !== undefined) dval = optval;
    else if (!aResetIfMissing) return;

    let val = KiROUND(dval * this.m_invScale);

    if (this.m_use_minmax) {
      if (val > this.m_max! || val < this.m_min!) val = this.m_default;
    }

    this.m_ptr.set(val);
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<number>(this.m_path, this.m_ptr.get() / this.m_invScale);
  }

  GetDefault(): number {
    return this.m_default;
  }

  override SetDefault(): void {
    this.m_ptr.set(this.m_default);
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const optval = aSettings.Get<number>(this.m_path);

    if (optval !== undefined) return optval === this.m_ptr.get() / this.m_invScale;

    return false;
  }
}

/**
 * `PARAM_LIST<Type>`: an array member, stored as a JSON array.
 *
 * `Load` replaces the whole array rather than merging, so an element the
 * file no longer lists is gone.
 */
export class PARAM_LIST<Type extends JsonValue> extends PARAM_BASE {
  private m_ptr: Ref<Type[]>;
  private m_default: Type[];

  constructor(aJsonPath: string, aPtr: Ref<Type[]>, aDefault: Type[], aReadOnly = false) {
    super(aJsonPath, aReadOnly);
    this.m_ptr = aPtr;
    this.m_default = aDefault;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const js = aSettings.GetJson(this.m_path);

    if (js !== undefined) {
      if (Array.isArray(js)) {
        this.m_ptr.set([...(js as Type[])]);
      } else if (aResetIfMissing) {
        this.m_ptr.set([...this.m_default]);
      }
    } else if (aResetIfMissing) {
      this.m_ptr.set([...this.m_default]);
    }
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<JsonValue>(this.m_path, [...this.m_ptr.get()]);
  }

  override SetDefault(): void {
    this.m_ptr.set([...this.m_default]);
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const js = aSettings.GetJson(this.m_path);
    return js !== undefined && jsonEquals(js, [...this.m_ptr.get()]);
  }
}

/**
 * `PARAM_SET<Type>`: like `PARAM_LIST` over a `Set`, and the stored array is
 * SORTED, so two saves of the same set produce the same bytes.
 */
export class PARAM_SET<Type extends string | number> extends PARAM_BASE {
  private m_ptr: Ref<Set<Type>>;
  private m_default: Set<Type>;

  constructor(aJsonPath: string, aPtr: Ref<Set<Type>>, aDefault: Set<Type>, aReadOnly = false) {
    super(aJsonPath, aReadOnly);
    this.m_ptr = aPtr;
    this.m_default = aDefault;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const js = aSettings.GetJson(this.m_path);

    if (js !== undefined && Array.isArray(js)) {
      this.m_ptr.set(new Set(js as Type[]));
    } else if (aResetIfMissing) {
      this.m_ptr.set(new Set(this.m_default));
    }
  }

  override Store(aSettings: JSON_SETTINGS): void {
    aSettings.Set<JsonValue>(this.m_path, [...this.m_ptr.get()].sort());
  }

  override SetDefault(): void {
    this.m_ptr.set(new Set(this.m_default));
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const js = aSettings.GetJson(this.m_path);
    return js !== undefined && jsonEquals(js, [...this.m_ptr.get()].sort());
  }
}

/**
 * `PARAM_MAP<Value>`: a string-keyed map, stored as a JSON object.
 *
 * Upstream skips keys whose value is not of `Value`'s type rather than
 * failing the whole map.
 */
export class PARAM_MAP<Value extends JsonValue> extends PARAM_BASE {
  private m_ptr: Ref<Map<string, Value>>;
  private m_default: Map<string, Value>;

  constructor(
    aJsonPath: string,
    aPtr: Ref<Map<string, Value>>,
    aDefault: Map<string, Value>,
    aReadOnly = false,
  ) {
    super(aJsonPath, aReadOnly);
    this.m_ptr = aPtr;
    this.m_default = aDefault;
  }

  override Load(aSettings: JSON_SETTINGS, aResetIfMissing = true): void {
    if (this.m_readOnly) return;

    const js = aSettings.GetJson(this.m_path);

    if (js !== undefined && js !== null && typeof js === 'object' && !Array.isArray(js)) {
      const next = new Map<string, Value>();

      for (const [k, v] of Object.entries(js)) next.set(k, v as Value);

      this.m_ptr.set(next);
    } else if (aResetIfMissing) {
      this.m_ptr.set(new Map(this.m_default));
    }
  }

  override Store(aSettings: JSON_SETTINGS): void {
    const obj: JsonObject = {};

    for (const [k, v] of this.m_ptr.get()) obj[k] = v;

    aSettings.Set<JsonValue>(this.m_path, obj);
  }

  override SetDefault(): void {
    this.m_ptr.set(new Map(this.m_default));
  }

  override MatchesFile(aSettings: JSON_SETTINGS): boolean {
    const js = aSettings.GetJson(this.m_path);

    if (js === undefined || js === null || typeof js !== 'object' || Array.isArray(js))
      return false;

    const obj: JsonObject = {};

    for (const [k, v] of this.m_ptr.get()) obj[k] = v;

    return jsonEquals(js, obj);
  }
}
