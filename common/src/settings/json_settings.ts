// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/settings/json_settings.cpp` + `include/settings/json_settings.h`:
 * a settings file as a JSON tree, and the `PARAM`s that bind members of a
 * subclass to paths in it.
 *
 * The model is two-way. A subclass declares its members, then registers one
 * `PARAM` per member naming the JSON path it lives at. `Load()` walks the
 * params and pulls each value out of the tree into its member; `Store()`
 * walks them and pushes each member back into the tree. The tree is what is
 * read from and written to the `.kicad_pro` / `.kicad_prl`; the members are
 * what the rest of the program reads.
 *
 * Paths are dotted — `"board.design_settings.rules.min_clearance"` — and
 * `PointerFromString` turns the dots into a JSON pointer. A missing path on
 * `Load` sets the member to its default when `m_resetParamsIfMissing` is on,
 * which it is by default: a file that lacks a key means "the default", not
 * "keep whatever was there".
 *
 * A C++ `PARAM` holds a pointer to the member. Here it holds a getter and a
 * setter, which is the same binding without the address.
 */

/** A JSON value as `nlohmann::json` would hold it. */
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** `JSON_SETTINGS_INTERNALS::PointerFromString`: dots to a segment list. */
export function PointerFromString(aPath: string): string[] {
  return aPath === '' ? [] : aPath.split('.');
}

/** Where a settings file lives; only the location kind matters here. */
export enum SETTINGS_LOC {
  USER = 0, ///< The main config directory (e.g. ~/.config/kicad/)
  PROJECT, ///< The settings directory inside a project folder
  COLORS, ///< The color scheme directory (e.g. ~/.config/kicad/colors/)
  NESTED, ///< Not stored in a file, but inside another JSON_SETTINGS
  NONE, ///< No directory prepended, full path in filename (used for PROJECT_FILE)
}

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

/** `nlohmann::json::operator==`: structural equality. */
export function jsonEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;

  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => jsonEquals(v, b[i]!));

  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) || Array.isArray(b)) return false;

    const ka = Object.keys(a);
    const kb = Object.keys(b);

    return (
      ka.length === kb.length && ka.every((k) => k in b && jsonEquals(a[k]!, (b as JsonObject)[k]!))
    );
  }

  return false;
}

/**
 * `JSON_SETTINGS`: the tree, the params, and the moves between them.
 *
 * `m_schemaVersion` is what `Migrate` keys on; a file with a higher version
 * than the program knows is `m_isFutureFormat`, and is loaded but never
 * written, so a newer KiCad's settings survive an older one opening them.
 */
export class JSON_SETTINGS {
  protected m_internals: JsonObject = {};

  /** The filename (not including path) of this settings file (inicode) */
  protected m_filename: string;
  /** The filename of the wxConfig backing file of this settings file (inicode) */
  protected m_legacy_filename = '';
  /** The location of this settings file (wxConfig section) */
  protected m_location: SETTINGS_LOC;
  /** Nested settings files that are loaded and stored with this one */
  protected m_nested_settings: NESTED_SETTINGS[] = [];
  /** Whether or not the backing store file should be created it if doesn't exist */
  protected m_createIfMissing: boolean;
  /**
   * Whether or not the  backing store file should be created if all parameters are still
   * at their default values.
   */
  protected m_createIfDefault: boolean;
  /** Whether or not the backing store file should be written */
  protected m_writeFile: boolean;
  /** True if the JSON data store has been written to since the last file write */
  protected m_modified = false;
  /** Whether or not to delete legacy file after migration */
  protected m_deleteLegacyAfterMigration = true;
  /** Whether or not to set parameters to their default value if missing from JSON on Load() */
  protected m_resetParamsIfMissing = true;
  /** Version of this settings schema. */
  protected m_schemaVersion: number;
  /** True if the file is a later schema than this version of KiCad knows. */
  protected m_isFutureFormat = false;
  /** The list of params (owned by this object) */
  protected m_params: PARAM_BASE[] = [];

  /** A map of starting schema version to a pair of <ending version, migrator function> */
  protected m_migrators = new Map<number, [number, () => boolean]>();

  constructor(
    aFilename: string,
    aLocation: SETTINGS_LOC,
    aSchemaVersion: number,
    aCreateIfMissing = true,
    aCreateIfDefault = true,
    aWriteFile = true,
  ) {
    this.m_filename = aFilename;
    this.m_location = aLocation;
    this.m_schemaVersion = aSchemaVersion;
    this.m_createIfMissing = aCreateIfMissing;
    this.m_createIfDefault = aCreateIfDefault;
    this.m_writeFile = aWriteFile;

    this.m_params.push(
      new PARAM<number>(
        'meta.version',
        {
          get: () => this.m_schemaVersion,
          set: (v) => {
            this.m_schemaVersion = v;
          },
        },
        aSchemaVersion,
        true,
      ),
    );
  }

  GetFilename(): string {
    return this.m_filename;
  }

  GetLocation(): SETTINGS_LOC {
    return this.m_location;
  }

  SetLegacyFilename(aFilename: string): void {
    this.m_legacy_filename = aFilename;
  }

  IsReadOnly(): boolean {
    return !this.m_writeFile;
  }

  SetReadOnly(aReadOnly: boolean): void {
    this.m_writeFile = !aReadOnly;
  }

  IsFutureFormat(): boolean {
    return this.m_isFutureFormat;
  }

  /** Update the parameters of this object based on the current JSON document. */
  Load(): void {
    for (const param of this.m_params) {
      try {
        param.Load(this, this.m_resetParamsIfMissing);
      } catch {
        // Skip unreadable parameters in file
      }
    }
  }

  /**
   * Store the current parameters into the JSON document represented by this object.
   *
   * @return true if any part of the JSON document actually changed.
   */
  Store(): boolean {
    for (const param of this.m_params) {
      try {
        this.m_modified ||= !param.MatchesFile(this);
        param.Store(this);
      } catch {
        // param store err
      }
    }

    return this.m_modified;
  }

  /**
   * `LoadFromJson`: take a whole tree — what `LoadFromFile` parses — and
   * `Load()` the params from it. The file half is the caller's, because a
   * browser's file is a string it already has.
   */
  LoadFromJson(aJson: JsonValue): void {
    this.m_internals =
      aJson !== null && typeof aJson === 'object' && !Array.isArray(aJson) ? { ...aJson } : {};

    // If parse succeeds, check if schema migration is required
    const filever = this.Get<number>('meta.version') ?? -1;

    if (filever >= 0 && filever < this.m_schemaVersion) {
      this.Migrate();
    } else if (filever > this.m_schemaVersion) {
      this.m_isFutureFormat = true;
    }

    this.Load();

    for (const settings of this.m_nested_settings) settings.LoadFromFile();

    this.m_modified = false;
  }

  /**
   * Register a migration from one schema version to another.
   *
   * If the schema version in the file loaded from disk is less than the schema version of the
   * JSON_SETTINGS class, migration functions will be called in order until the data is at the
   * current schema version.
   */
  protected registerMigration(
    aOldSchemaVersion: number,
    aNewSchemaVersion: number,
    aMigrator: () => boolean,
  ): void {
    console.assert(aNewSchemaVersion > aOldSchemaVersion);
    this.m_migrators.set(aOldSchemaVersion, [aNewSchemaVersion, aMigrator]);
  }

  /** Migrate the schema of this settings from the version in the file to the latest version. */
  Migrate(): boolean {
    let filever = this.Get<number>('meta.version') ?? 0;

    while (filever < this.m_schemaVersion) {
      const pair = this.m_migrators.get(filever);

      // Migrator missing for this version
      if (!pair) return false;

      if (pair[1]()) {
        filever = pair[0];
        this.Set<number>('meta.version', filever);
      } else {
        return false;
      }
    }

    return true;
  }

  /** `SaveToJson`: `Store()` and hand back the tree, for the caller to write. */
  SaveToJson(): JsonObject {
    this.Store();

    for (const settings of this.m_nested_settings) settings.SaveToFile();

    this.m_modified = false;

    return this.m_internals;
  }

  /** Reset all parameters to default values. */
  ResetToDefaults(): void {
    for (const param of this.m_params) param.SetDefault();
  }

  /** Fetch a JSON object that is a subset of this JSON_SETTINGS object's JSON tree. */
  GetJson(aPath: string): JsonValue | undefined {
    const ptr = PointerFromString(aPath);
    let node: JsonValue = this.m_internals;

    for (const seg of ptr) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;

      if (!(seg in node)) return undefined;

      node = node[seg]!;
    }

    return node;
  }

  /** Fetch a value from within the JSON document. */
  Get<ValueType extends JsonValue>(aPath: string): ValueType | undefined {
    const js = this.GetJson(aPath);

    return js === undefined ? undefined : (js as ValueType);
  }

  /** Store a value into the JSON document, creating intermediate objects. */
  Set<ValueType extends JsonValue>(aPath: string, aVal: ValueType): void {
    const ptr = PointerFromString(aPath);
    let node: JsonObject = this.m_internals;

    for (let i = 0; i < ptr.length - 1; ++i) {
      const seg = ptr[i]!;
      const next = node[seg];

      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next))
        node[seg] = {};

      node = node[seg] as JsonObject;
    }

    if (ptr.length > 0) node[ptr[ptr.length - 1]!] = aVal;
  }

  /** Remove a value from the JSON document. */
  Erase(aPath: string): void {
    const ptr = PointerFromString(aPath);
    let node: JsonValue = this.m_internals;

    for (let i = 0; i < ptr.length - 1; ++i) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return;

      node = (node as JsonObject)[ptr[i]!]!;
    }

    if (node !== null && typeof node === 'object' && !Array.isArray(node) && ptr.length > 0)
      delete (node as JsonObject)[ptr[ptr.length - 1]!];
  }

  Contains(aPath: string): boolean {
    return this.GetJson(aPath) !== undefined;
  }

  /** Register a param, `m_params.emplace_back( new PARAM(...) )` in every subclass constructor. */
  protected addParam(aParam: PARAM_BASE): void {
    this.m_params.push(aParam);
  }

  /** Transfer ownership of a given NESTED_SETTINGS to this object. */
  AddNestedSettings(aSettings: NESTED_SETTINGS): void {
    this.m_nested_settings.push(aSettings);
  }

  /** Save and free a nested settings object, if it exists within this one. */
  ReleaseNestedSettings(aSettings: NESTED_SETTINGS): void {
    const i = this.m_nested_settings.indexOf(aSettings);

    if (i >= 0) {
      aSettings.SaveToFile();
      this.m_nested_settings.splice(i, 1);
    }
  }

  SetManager(_aManager: unknown): void {
    // SETTINGS_MANAGER is not ported; the one caller passes it through.
  }
}

/**
 * `NESTED_SETTINGS`: a settings object stored INSIDE another's tree at
 * `m_filename` rather than in a file of its own. `BOARD_DESIGN_SETTINGS`
 * lives inside `PROJECT_FILE` at `board.design_settings` this way.
 */
export class NESTED_SETTINGS extends JSON_SETTINGS {
  protected m_parent: JSON_SETTINGS | null;

  constructor(
    aName: string,
    aSchemaVersion: number,
    aParent: JSON_SETTINGS | null,
    aPath: string,
    aLoadFromFile = true,
  ) {
    super(aName, SETTINGS_LOC.NESTED, aSchemaVersion);
    this.m_parent = aParent;
    // The path within the parent's tree.
    this.m_filename = aPath;

    this.SetParent(aParent, aLoadFromFile);
  }

  /** Load the JSON document from the parent and then calls Load() */
  LoadFromFile(): boolean {
    this.m_internals = {};

    if (this.m_parent) {
      const js = this.m_parent.GetJson(this.m_filename);

      if (js !== undefined && js !== null && typeof js === 'object' && !Array.isArray(js)) {
        this.m_internals = { ...js };

        const filever = this.Get<number>('meta.version') ?? -1;

        if (filever >= 0 && filever < this.m_schemaVersion) this.Migrate();
        else if (filever > this.m_schemaVersion) this.m_isFutureFormat = true;

        this.Load();
        this.m_modified = false;
        return true;
      }
    }

    // No parent, or no such subtree: the defaults.
    this.Load();
    return false;
  }

  /** Call Store() and then write the contents of the JSON document to the parent object. */
  SaveToFile(): boolean {
    if (!this.m_parent) return false;

    const modified = this.Store();

    this.m_parent.Set<JsonValue>(this.m_filename, this.m_internals);
    this.m_modified = false;

    return modified;
  }

  SetParent(aParent: JSON_SETTINGS | null, aLoadFromFile = true): void {
    this.m_parent = aParent;

    if (this.m_parent) {
      this.m_parent.AddNestedSettings(this);

      // In case we were created after the parent's ctor
      if (aLoadFromFile) this.LoadFromFile();
    }
  }

  GetParent(): JSON_SETTINGS | null {
    return this.m_parent;
  }
}
