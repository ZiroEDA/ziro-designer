// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `lset.h` is `include/`, so `LSET` lives in `common/src/lset.ts`; this is
 * the pcbnew-side name for it.
 *
 * @deprecated import from `@ziroeda/common/src/lset.js` and
 * `@ziroeda/common/src/layer_range.js`.
 */

export { type LSEQ, LSET } from '@ziroeda/common/src/lset.js';
export { LAYER_RANGE } from '@ziroeda/common/src/layer_range.js';
