// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from Zint (BSD-3-Clause) and KiCad. See NOTICE.md.
/**
 * `ZBarcode_Encode`, for the five symbologies `PCB_BARCODE` offers.
 *
 * `PCB_BARCODE::ComputeBarcode` (`pcbnew/pcb_barcode.cpp:412-537`) is fifteen
 * lines of setup around this call:
 *
 *     symbol->input_mode = UNICODE_MODE;
 *     symbol->show_hrt = 0;
 *     symbol->symbology = …;                       // per BARCODE_T
 *     symbol->option_1 = to_underlying( m_errorCorrection );   // QR/MicroQR
 *     if ( QR or DATA_MATRIX ) and !text.IsAscii() → symbol->eci = ECI_UTF8;
 *     ZBarcode_Encode( symbol, dataPtr, length );
 *
 * so this takes the same three inputs and returns the same module grid.
 */
import { code39 } from './code.js';
import { code128 } from './code128.js';
import { newSymbol, type ZintSymbol } from './common.js';
import type { BarcodeEcc, BarcodeKind } from '../types.js';

/** `BARCODE_ECC_T` -> Zint's `option_1` — the enum values ARE the option. */
export const ECC_OPTION: Readonly<Record<BarcodeEcc, number>> = { L: 1, M: 2, Q: 3, H: 4 };

export interface EncodeResult {
  symbol: ZintSymbol | null;
  /** `m_lastError`; empty on success. */
  error: string;
}

/**
 * `ComputeBarcode`'s message for input a symbology cannot carry
 * (`pcb_barcode.cpp:612-614`). It is chosen by the *input*, not by Zint's own
 * error text: if the text is not ASCII, this is shown instead of `errtxt`,
 * because "invalid character at position 3" does not tell a user to switch to
 * a QR code.
 */
const NON_ASCII =
  'This barcode type does not support international characters. ' +
  'Use QR Code or Data Matrix instead.';

/**
 * The bytes `ZBarcode_Encode` sees. `UNICODE_MODE` means the caller passed
 * UTF-8, and for a symbology with no ECI the library folds it to ISO 8859-1;
 * a code point above 255 has no representation and the encode fails.
 */
function toBytes(text: string): number[] | null {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xff) return null;
    bytes.push(cp);
  }
  return bytes;
}

const isAscii = (text: string): boolean => {
  for (const ch of text) if (ch.codePointAt(0)! > 127) return false;
  return true;
};

/**
 * Encode `text` and return the module grid, or the message `ComputeBarcode`
 * would put in `m_lastError`.
 *
 * Empty text is not an error: `ComputeBarcode` returns early on
 * `text.empty()` (`pcb_barcode.cpp:600`) leaving `m_symbolPoly` empty and
 * `m_lastError` clear — a barcode with nothing to encode simply draws nothing.
 */
export function encodeBarcode(kind: BarcodeKind, ecc: BarcodeEcc, text: string): EncodeResult {
  if (text === '') return { symbol: null, error: '' };

  const symbol = newSymbol();
  symbol.option1 = ECC_OPTION[ecc];

  const bytes = toBytes(text);
  if (!bytes) return { symbol: null, error: NON_ASCII };

  let error: string;

  switch (kind) {
    case 'code39':
      error = code39(symbol, text);
      break;
    case 'code128':
      error = code128(symbol, bytes);
      break;
    default:
      // QR, Micro QR and Data Matrix are not ported yet.
      error = '';
      break;
  }

  if (error) return { symbol: null, error: isAscii(text) ? error : NON_ASCII };

  return { symbol, error: '' };
}
