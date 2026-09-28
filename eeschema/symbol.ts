// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/symbol.h`: `SYMBOL`, the base of `LIB_SYMBOL` and `SCH_SYMBOL`.
 *
 * Forward declaration (eeschema stage E3, part 1): the members the item classes
 * already call. The class itself lands with LIB_SYMBOL and SCH_SYMBOL.
 */

import type { EMBEDDED_FILES } from '@ziroeda/common/embedded_files.js';
import type { KIID } from '@ziroeda/common/kiid.js';

export interface SYMBOL {
  readonly m_Uuid: KIID;
  GetUnitCount(): number;
  IsMultiUnit(): boolean;
  IsMultiBodyStyle(): boolean;
  GetUnitDisplayName(aUnit: number, aLabel: boolean): string;
  GetBodyStyleDescription(aBodyStyle: number, aLabel: boolean): string;
  GetEmbeddedFiles(): EMBEDDED_FILES | null;
}
