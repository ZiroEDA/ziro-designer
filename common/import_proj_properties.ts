// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/import_proj_properties.h` (new in 10.0.6): `IMPORT_PROJ_PROPS`, the
 * property keys and codec threaded through `IMPORT_PROJ_HELPER::m_properties`
 * to coordinate a non-KiCad project import across the schematic and PCB
 * editors. Values ride the MAIL_IMPORT_FILE payload, whose framing forbids
 * '\n' inside a value, so list values join with the unit-separator control
 * character (a library nickname cannot contain it). The codec lives next to
 * the contract so the manager (encode) and both editor frames (decode) cannot
 * drift.
 */
import { LIB_ID } from './lib_id.js';

export const IMPORT_PROJ_PROPS = {
  FP_CACHE_NICKNAME: 'import_fp_cache_nickname',
  SOURCE_FP_LIBS: 'import_source_fp_libs',

  /** Separator joining a list value within a single property. */
  LIST_SEPARATOR: '\x1f',

  /** Encode library nicknames into a single list-property value. */
  JoinList(aItems: readonly string[]): string {
    return aItems.join(IMPORT_PROJ_PROPS.LIST_SEPARATOR);
  },

  /** Decode a list-property value back into nicknames, dropping empties. */
  SplitList(aValue: string): string[] {
    return aValue.split(IMPORT_PROJ_PROPS.LIST_SEPARATOR).filter((item) => item !== '');
  },

  /** Read the footprint-import coordination properties out of a properties map. */
  ReadFootprintProps(aProps: ReadonlyMap<string, string> | null): {
    cacheNickname: string;
    sourceFpLibs: string[];
  } {
    let cacheNickname = '';
    let sourceFpLibs: string[] = [];

    if (!aProps) return { cacheNickname, sourceFpLibs };

    const cache = aProps.get(IMPORT_PROJ_PROPS.FP_CACHE_NICKNAME);

    if (cache !== undefined) cacheNickname = cache;

    const sources = aProps.get(IMPORT_PROJ_PROPS.SOURCE_FP_LIBS);

    if (sources !== undefined) sourceFpLibs = IMPORT_PROJ_PROPS.SplitList(sources);

    return { cacheNickname, sourceFpLibs };
  },

  /** Derive the generated footprint-cache nickname from a project or file stem. */
  MakeCacheNickname(aStem: string): string {
    return LIB_ID.FixIllegalChars(`${aStem}-import-fps`, true);
  },
} as const;
