// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ENV_VAR_ITEM` and `ENV_VAR_MAP` (include/settings/environment.h): one
 * environment variable KiCad knows about - its value, its built-in default,
 * and whether the process environment or the settings file defined it.
 */

export class ENV_VAR_ITEM {
  private readonly m_key: string;
  private m_value: string;
  private readonly m_defaultValue: string;
  private m_settingsValue = '';
  private readonly m_isBuiltin = true;
  private m_isDefinedExternally = false;
  private m_isDefinedInSettings = false;

  /** `ENV_VAR_ITEM( aKey, aValue, aDefaultValue )`. */
  constructor(aKey = '', aValue = '', aDefaultValue = '') {
    this.m_key = aKey;
    this.m_value = aValue;
    this.m_defaultValue = aDefaultValue;
  }

  GetDefinedExternally(): boolean {
    return this.m_isDefinedExternally;
  }

  SetDefinedExternally(aIsDefinedExternally = true): void {
    this.m_isDefinedExternally = aIsDefinedExternally;
  }

  GetDefinedInSettings(): boolean {
    return this.m_isDefinedInSettings;
  }

  SetDefinedInSettings(aDefined = true): void {
    this.m_isDefinedInSettings = aDefined;
  }

  GetKey(): string {
    return this.m_key;
  }

  GetValue(): string {
    return this.m_value;
  }

  SetValue(aValue: string): void {
    this.m_value = aValue;
  }

  GetDefault(): string {
    return this.m_defaultValue;
  }

  GetSettingsValue(): string {
    return this.m_settingsValue;
  }

  SetSettingsValue(aValue: string): void {
    this.m_settingsValue = aValue;
  }

  GetBuiltin(): boolean {
    return this.m_isBuiltin;
  }

  /** Is this item's value still its built-in default? */
  IsDefault(): boolean {
    return this.m_isBuiltin && this.m_value === this.m_defaultValue;
  }
}

/**
 * `std::map<wxString, ENV_VAR_ITEM>`: a map that iterates in KEY order, as a
 * std::map does - `GetKicadPaths` and `GetVersionedEnvVarValue` walk it, and
 * their answers depend on that order.
 */
export class ENV_VAR_MAP extends Map<string, ENV_VAR_ITEM> {
  private sortedKeys(): string[] {
    // wxString operator<: a code-unit comparison, not a locale collation.
    return [...super.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  override *keys(): MapIterator<string> {
    yield* this.sortedKeys();
  }

  override *values(): MapIterator<ENV_VAR_ITEM> {
    for (const k of this.sortedKeys()) yield super.get(k)!;
  }

  override *entries(): MapIterator<[string, ENV_VAR_ITEM]> {
    for (const k of this.sortedKeys()) yield [k, super.get(k)!];
  }

  override [Symbol.iterator](): MapIterator<[string, ENV_VAR_ITEM]> {
    return this.entries();
  }

  override forEach(
    aCallback: (value: ENV_VAR_ITEM, key: string, map: Map<string, ENV_VAR_ITEM>) => void,
    aThis?: unknown,
  ): void {
    for (const [k, v] of this.entries()) aCallback.call(aThis, v, k, this);
  }
}
