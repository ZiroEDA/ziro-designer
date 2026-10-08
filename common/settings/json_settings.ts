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

import {
  wxDirExists,
  wxFileExists,
  wxIsDirWritable,
  wxMkdir,
  wxReadFileSync,
  wxWriteFileSync,
} from '../wx/filefn.js';
import { DumpJson } from './json_dump.js';
import { PARAM, type PARAM_BASE } from './parameters.js';
import type { NESTED_SETTINGS } from './nested_settings.js';
import { type JsonObject, type JsonValue, PointerFromString } from './json_settings_internals.js';

// Split out as upstream splits them; re-exported so existing importers keep
// working. NESTED_SETTINGS is NOT re-exported: it extends JSON_SETTINGS, so a
// runtime re-export here would evaluate it before its base class exists.
export * from './json_settings_internals.js';
export * from './parameters.js';

/** Where a settings file lives; only the location kind matters here. */
export enum SETTINGS_LOC {
  USER = 0, ///< The main config directory (e.g. ~/.config/kicad/)
  PROJECT, ///< The settings directory inside a project folder
  COLORS, ///< The color scheme directory (e.g. ~/.config/kicad/colors/)
  NESTED, ///< Not stored in a file, but inside another JSON_SETTINGS
  NONE, ///< No directory prepended, full path in filename (used for PROJECT_FILE)
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

  SetFilename(aFilename: string): void {
    this.m_filename = aFilename;
  }

  /** `getFileExt()` (json_settings.h:306). */
  protected getFileExt(): string {
    return 'json';
  }

  /**
   * `SaveToFile( aDirectory, aForce )` (json_settings.cpp:422): write `<dir>/<name>.<ext>` when
   * something changed, onto whichever writable mount holds it (common/wx/filefn.ts). Returns
   * whether it wrote.
   */
  SaveToFile(aDirectory = '', aForce = false): boolean {
    if (!this.m_writeFile) return false;

    // Default PROJECT won't have a filename set
    if (this.m_filename === '') return false;

    const path =
      aDirectory === ''
        ? `${this.m_filename}.${this.getFileExt()}`
        : `${aDirectory.replace(/\/+$/, '')}/${this.m_filename}.${this.getFileExt()}`;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '.';
    const exists = wxFileExists(path);

    // "File for %s doesn't exist and m_createIfMissing == false; not saving"
    if (!this.m_createIfMissing && !exists) return false;

    // Ensure the path exists, and create it if not.
    if (!wxDirExists(dir) && !wxMkdir(dir)) return false;

    // "File for %s is read-only; not saving": a path no writable mount covers.
    if (!wxIsDirWritable(dir)) return false;

    let modified = false;

    for (const settings of this.m_nested_settings) modified = settings.SaveToFile() || modified;

    modified = this.Store() || modified;

    // "%s contents not modified, skipping save"
    if (!modified && !aForce && exists) return false;
    // "%s contents still default and m_createIfDefault == false; not saving"
    else if (!modified && !aForce && !this.m_createIfDefault) return false;

    const payload = DumpJson(this.m_internals);

    // Last-chance skip for the case where the dirty heuristic fired but the serialized payload
    // still equals the on-disk bytes (e.g. key reordering or normalization).
    if (!aForce && exists) {
      const existing = wxReadFileSync(path);

      if (existing && new TextDecoder().decode(existing) === payload) {
        this.m_modified = false;
        return false;
      }
    }

    const success = wxWriteFileSync(path, new TextEncoder().encode(payload));

    this.m_modified = false;

    return success;
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
      aJson !== null && typeof aJson === 'object' && !Array.isArray(aJson)
        ? // `*m_internals = json::parse( ... )`: the document is ours, not the caller's.
          (structuredClone(aJson) as JsonObject)
        : {};

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
 * Whether a stored value can stand in for a default of this shape.
 *
 * Only reached for a default that is an array, null, or a scalar — `deepMerge`
 * recurses into plain objects instead. A scalar default already fails the
 * `typeof` test against an array (`typeof [] === 'object'`), so no separate
 * array guard is needed on that side; a null default accepts anything, since
 * it carries no shape to compare.
 */
function sameShape(defaults: unknown, stored: unknown): boolean {
  if (Array.isArray(defaults)) return Array.isArray(stored);
  if (defaults === null) return true;
  return typeof defaults === typeof stored;
}

// The load-merge every settings slice uses (JSON_SETTINGS::Load's fill-in of
// missing keys from the defaults). Moved from designer/src/prefs/settings.ts.
/**
 * Exported for its own tests: it is the only thing standing between a stale or
 * hand-edited localStorage and the renderer, and it has no other seam.
 */
export function deepMerge<T>(defaults: T, stored: unknown): T {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    // A stored value of the wrong *type* is not a setting, it is damage:
    // localStorage is editable by hand, survives across versions, and a string
    // where a number belongs reaches the renderer and throws before React
    // mounts — a white screen, which is the failure the capability probe
    // exists to avoid producing. Falling back to the default is always safe;
    // the worst case is one preference reverting.
    if (stored === undefined || !sameShape(defaults, stored)) return defaults;
    return stored as T;
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  if (typeof stored === 'object' && stored !== null) {
    for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}

/**
 * `RESETTABLE_PANEL::ResetPanel`'s missing half: a way for a panel to say which
 * fields are *its own*.
 *
 * Upstream never has to say it. A preferences panel resets itself by
 * default-constructing the settings object and pushing it at its own widgets —
 *
 *     void PANEL_MOUSE_SETTINGS::ResetPanel()
 *     {
 *         COMMON_SETTINGS defaultSettings;
 *         defaultSettings.ResetToDefaults();
 *         applySettingsToPanel( defaultSettings );
 *     }
 *     (common/dialogs/panel_mouse_settings.cpp)
 *
 * — and `applySettingsToPanel` can only reach the controls that exist on this
 * panel. `TransferDataFromWindow` then writes back exactly those. So although
 * `PANEL_COMMON_SETTINGS` and `PANEL_MOUSE_SETTINGS` share one `COMMON_SETTINGS`,
 * resetting Mouse and Touchpad cannot disturb Common's fields: the widgets that
 * hold them are on the other panel.
 *
 * Our panels have no widget tree standing between them and the settings object;
 * they write into a plain working copy. `ctx.setCommon(structuredClone(
 * COMMON_DEFAULTS))` therefore looks like the same thing and is not — it resets
 * the whole object, and OK commits all of it. So each panel names its slice, and
 * this is what it names it with. `keyof` makes a typo a type error; a key left
 * out is a field that silently never resets, which is what
 * `qa/unittests/designer/prefs_reset_slices.test.ts` exists to catch.
 */

/**
 * Copy `keys` from `defaults` onto `target`, and nothing else — one panel's
 * `applySettingsToPanel`.
 *
 * Values are cloned, so a panel that resets an array or a nested record cannot
 * end up aliasing the shared defaults object and mutating it on the next edit.
 */
export function resetKeys<T extends object, K extends keyof T>(
  target: T,
  defaults: T,
  keys: readonly K[],
): void {
  for (const key of keys) target[key] = structuredClone(defaults[key]);
}
