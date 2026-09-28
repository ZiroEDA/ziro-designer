// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_sheet.h`: `SCH_SHEET`.
 *
 * Forward declaration (eeschema stage E3, part 1): the members the item classes
 * already call. The class itself lands with SCH_SHEET_PIN and SCH_SCREEN.
 */

import type { OutStr } from '@ziroeda/common/eda_item.js';
import type { SCH_LABEL_BASE } from './sch_label.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { SCH_SHEET_PATH } from './sch_sheet_path.js';

export interface SCH_SHEET {
  GetPins(): readonly SCH_LABEL_BASE[];
  GetScreen(): SCH_SCREEN | null;
  ResolveTextVar(aPath: SCH_SHEET_PATH | null, token: OutStr, aDepth: number): boolean;
}
