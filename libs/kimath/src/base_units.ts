// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The two arc-approximation constants of `include/base_units.h` that kimath's
 * shapes read (`SHAPE_ARC::DefaultAccuracyForPCB()` is `ARC_HIGH_DEF`).
 *
 * In KiCad they are `pcbIUScale.mmToIU( ... )` and base_units.h is shared by
 * kimath and common alike. Here kimath cannot import common (common depends on
 * kimath), so the board scale is written as the data it is - `PCB_IU_PER_MM`
 * is 1e6 - and common re-exports these rather than computing them again.
 *
 * "Too small values can create very long calculation time in zone filling.
 * 0.05 to 0.005 mm are reasonable values" (base_units.h).
 */

import { KiROUND } from './math/util.js';

/** `PCB_IU_PER_MM` (`base_units.h`): nanometres. */
const PCB_IU_PER_MM = 1e6;

export const ARC_LOW_DEF_MM = 0.02;
export const ARC_HIGH_DEF_MM = 0.005;

/** `pcbIUScale.mmToIU( ARC_LOW_DEF_MM )`. */
export const ARC_LOW_DEF = KiROUND(ARC_LOW_DEF_MM * PCB_IU_PER_MM);
/** `pcbIUScale.mmToIU( ARC_HIGH_DEF_MM )`. */
export const ARC_HIGH_DEF = KiROUND(ARC_HIGH_DEF_MM * PCB_IU_PER_MM);
