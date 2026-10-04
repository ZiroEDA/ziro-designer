// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `symbol_library_common.h`: SYMBOL_LIBRARY_FILTER, what the symbol chooser is limited to.
 */

/** `SYMBOL_LIBRARY_FILTER`: the libraries a chooser lists, and whether only power symbols. */
export class SYMBOL_LIBRARY_FILTER {
  private m_allowedLibs: string[] = []; ///< List of filtered library names.
  private m_filterPowerSymbols = false; ///< Enable or disable power symbol filtering.
  private m_forceLoad = false; ///< Force loading symbol from library m_allowedLibs[0].

  /** Add \a aLibName to the allowed libraries list. */
  AddLib(aLibName: string): void {
    this.m_allowedLibs.push(aLibName);
    this.m_forceLoad = false;
  }

  /** Add \a aLibName to the allowed libraries list, and load symbols only from it. */
  LoadFrom(aLibName: string): void {
    this.m_allowedLibs = [aLibName];
    this.m_forceLoad = true;
  }

  /** Clear the allowed libraries list (allows all libraries). */
  ClearLibList(): void {
    this.m_allowedLibs = [];
    this.m_forceLoad = false;
  }

  /** Enable or disable the filtering of power symbols. */
  FilterPowerSymbols(aFilterEnable: boolean): void {
    this.m_filterPowerSymbols = aFilterEnable;
  }

  /** True if power symbols are the only ones listed. */
  GetFilterPowerSymbols(): boolean {
    return this.m_filterPowerSymbols;
  }

  /** The names of the allowed libraries. */
  GetAllowedLibList(): readonly string[] {
    return this.m_allowedLibs;
  }

  /** The library to load a symbol from, or '' when there is no such library. */
  GetLibSource(): string {
    if (this.m_forceLoad && this.m_allowedLibs.length > 0) return this.m_allowedLibs[0]!;
    else return '';
  }
}
