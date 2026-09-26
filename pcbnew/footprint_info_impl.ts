// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `FOOTPRINT_INFO_IMPL` and `FOOTPRINT_LIST_IMPL` (pcbnew/footprint_info_impl.h,
 * .cpp): the footprint list pcbnew builds for the choosers and CvPcb.
 *
 * KiCad reads every library's footprints (or its footprint-info cache) and
 * keeps name, pad counts, description and keywords per footprint. Ours come
 * from the hosted libraries' index, which is that cache: per library, each
 * footprint's name, unique pad count (`pads`), `(descr …)` and `(tags …)`.
 * They are built with the cache constructor - loaded already - and the list
 * is sorted by `FOOTPRINT_INFO::operator<`, as ReadFootprintFiles leaves it.
 */
import { FOOTPRINT_INFO, FOOTPRINT_LIST } from '@ziroeda/common/footprint_info.js';

/** One library of the hosted index: `tools/libraries/upload.mjs` writes it. */
export interface FootprintIndexLibrary {
  name: string;
  footprints: readonly string[];
  /** Distinct numbered pads per footprint, parallel to `footprints`. */
  pads?: readonly number[];
  /** `(descr …)` per footprint. */
  descr?: readonly string[];
  /** `(tags …)` per footprint. */
  tags?: readonly string[];
}

export class FOOTPRINT_INFO_IMPL extends FOOTPRINT_INFO {
  /** `FOOTPRINT_INFO_IMPL( nickname, name, description, keywords, order, pads, unique pads )`: a cached item. */
  constructor(
    aNickname: string,
    aFootprintName: string,
    aDescription: string,
    aKeywords: string,
    aOrderNum: number,
    aPadCount: number,
    aUniquePadCount: number,
  ) {
    super();
    this.m_nickname = aNickname;
    this.m_fpname = aFootprintName;
    this.m_num = aOrderNum;
    this.m_pad_count = aPadCount;
    this.m_unique_pad_count = aUniquePadCount;
    this.m_doc = aDescription;
    this.m_keywords = aKeywords;

    this.m_owner = null;
    this.m_loaded = true;
  }
}

export class FOOTPRINT_LIST_IMPL extends FOOTPRINT_LIST {
  Clear(): void {
    this.m_list = [];
    this.m_errors = [];
  }

  /**
   * `ReadFootprintFiles` over the hosted index: one cached FOOTPRINT_INFO per
   * footprint, optionally of one library only (`aNickname`), then sorted.
   * The index carries the UNIQUE pad count only, so it stands for both counts.
   */
  ReadFootprintIndex(aIndex: readonly FootprintIndexLibrary[], aNickname?: string): boolean {
    this.Clear();

    for (const lib of aIndex) {
      if (aNickname !== undefined && lib.name !== aNickname) continue;

      lib.footprints.forEach((fpname, i) => {
        const pads = lib.pads?.[i] ?? 0;
        this.m_list.push(
          new FOOTPRINT_INFO_IMPL(
            lib.name,
            fpname,
            lib.descr?.[i] ?? '',
            lib.tags?.[i] ?? '',
            0,
            pads,
            pads,
          ),
        );
      });
    }

    this.m_list.sort((a, b) => FOOTPRINT_INFO.Compare(a, b));

    return true;
  }
}
