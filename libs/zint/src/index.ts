// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause), copyright Robin Stuart and
// contributors. See NOTICE.md.
/**
 * KiCad's `thirdparty/zint/backend`, the part of libzint `PCB_BARCODE` links:
 * `ZBarcode_Encode` for the five symbologies it offers, and the module grid
 * it fills. `pcb_barcode.ts` is the one caller.
 */
export { type BarcodeEcc, type BarcodeKind, encodeBarcode } from './backend/zint.js';
export { moduleIsSet, newSymbol, type ZintSymbol } from './backend/common.js';
export { GF_DATAMATRIX, GF_QR, ReedSolomon } from './backend/reedsol.js';
