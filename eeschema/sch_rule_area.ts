// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_rule_area.h`: `SCH_RULE_AREA`.
 *
 * Forward declaration (eeschema stage E3, part 1): the members the item classes
 * already call. The class itself lands with the shapes.
 */

import type { SCH_ITEM } from './sch_item.js';
import type { SCH_DIRECTIVE_LABEL } from './sch_label.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

export interface SCH_RULE_AREA {
  RemoveItem(aItem: SCH_ITEM): void;
  RemoveDirective(aLabel: SCH_DIRECTIVE_LABEL): void;
  GetExcludedFromSim(aInstance?: SCH_SHEET_PATH | null, aVariantName?: string): boolean;
  GetExcludedFromBOM(aInstance?: SCH_SHEET_PATH | null, aVariantName?: string): boolean;
  GetExcludedFromBoard(aInstance?: SCH_SHEET_PATH | null, aVariantName?: string): boolean;
  GetExcludedFromPosFiles(aInstance?: SCH_SHEET_PATH | null, aVariantName?: string): boolean;
  GetDNP(aInstance?: SCH_SHEET_PATH | null, aVariantName?: string): boolean;
}
