// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/string_any_map.h`: `STRING_ANY_MAP`, a `std::map<std::string, wxAny>`
 * with an internal-units scale, the property bag a `PCB_GENERATOR` is
 * saved and restored through.
 *
 * `wxAny` is `unknown` here; `get_to` checks the requested kind the way
 * `wxAny::GetAs` does (a mismatched kind is a false, not a throw).
 */

export type ANY_KIND = 'number' | 'string' | 'boolean' | 'object';

export class STRING_ANY_MAP extends Map<string, unknown> {
  private m_iuScale: number;

  constructor(aIUScale = 1.0) {
    super();
    this.m_iuScale = aIUScale;
  }

  /**
   * `get_to`: the value under `aKey` as `aKind`, or undefined when absent or
   * of another kind (`wxAny::GetAs` returning false).
   */
  get_to<T>(aKey: string, aKind: ANY_KIND): T | undefined {
    if (!this.contains(aKey)) return undefined;

    const value = this.get(aKey);

    if (typeof value !== aKind) return undefined;

    return value as T;
  }

  /**
   * `get_to_iu`: a numeric value is scaled into internal units; anything else
   * is returned as it is.
   */
  get_to_iu<T>(aKey: string, aKind: ANY_KIND): T | undefined {
    if (!this.contains(aKey)) return undefined;

    const value = this.get(aKey);

    if (typeof value === 'number') {
      let number = value;
      number *= this.m_iuScale;
      return number as unknown as T;
    }

    if (typeof value !== aKind) return undefined;

    return value as T;
  }

  /** `set`: `emplace` — the first value for a key wins. */
  set_(aKey: string, aVar: unknown): void {
    if (!this.has(aKey)) this.set(aKey, aVar);
  }

  /** `set_iu`: the value divided by the scale, then `emplace`. */
  set_iu(aKey: string, aVar: number): void {
    if (!this.has(aKey)) this.set(aKey, aVar / this.m_iuScale);
  }

  contains(aKey: string): boolean {
    return this.has(aKey);
  }

  get_opt<T>(aKey: string, aKind: ANY_KIND): T | undefined {
    if (this.contains(aKey)) {
      const value = this.get(aKey);

      if (typeof value !== aKind) return undefined;

      return value as T;
    }

    return undefined;
  }
}
