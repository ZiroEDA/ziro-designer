// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_screen.h`: `SCH_SCREEN` and its item container `EE_RTREE`.
 *
 * Forward declaration (eeschema stage E3, part 1): the members the item classes
 * already call. The class itself lands with SCH_SHEET.
 */

import type { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOX2I } from '@ziroeda/kimath/src/math/box2.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { SCH_ITEM } from './sch_item.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

/** The part of `EE_RTREE` the items walk. */
export interface EE_RTREE_LIKE extends Iterable<SCH_ITEM> {
  OfType(aType: KICAD_T): Iterable<SCH_ITEM>;
  /** `Overlapping( aRect )` is `Overlapping( null, aRect )` here: every type. */
  Overlapping(aType: KICAD_T | null, aRect: BOX2I): Iterable<SCH_ITEM>;
}

export interface SCH_SCREEN {
  Items(): EE_RTREE_LIKE;
  IsJunction(aPosition: VECTOR2I): boolean;
  GetClientSheetPaths(): readonly SCH_SHEET_PATH[];
}
