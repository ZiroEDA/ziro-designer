// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The decisions behind `DIALOG_BARCODE_PROPERTIES`
 * (`pcbnew/dialogs/dialog_barcode_properties.cpp`), separated from its layout.
 *
 * There are only three of them, and every one is in `OnUpdateUI`
 * (`:146-171`) — which controls a set of widgets that fight each other:
 *
 *  - Error Correction is meaningful only for the two QR kinds.
 *  - Micro QR has no level H, and picking it while H is selected moves the
 *    selection to Q rather than leaving an impossible choice armed.
 *  - Text size follows Show Text; the two knockout margins follow Knockout.
 *
 * Plus the rule `TransferDataFromWindow` enforces: a barcode whose text will
 * not encode is refused with `m_lastError` in a message box, rather than being
 * committed as an empty symbol.
 */
import { barcodeGeometry } from './barcode_geometry.js';
import { parseBoardItemId } from './edit-board.js';
import type { BarcodeEcc, BarcodeKind, Board, PcbBarcode } from './types.js';

/**
 * The Code radio box, in `BARCODE_T` order — which is the order the file's
 * integers, the property grid and this dialog all use
 * (`dialog_barcode_properties_base.cpp`, `m_barcodeChoices`).
 */
export const BARCODE_KIND_CHOICES: readonly { value: BarcodeKind; label: string }[] = [
  { value: 'code39', label: 'Code 39 (ISO 16388)' },
  { value: 'code128', label: 'Code 128 (ISO 15417)' },
  { value: 'datamatrix', label: 'Data Matrix (ECC 200)' },
  { value: 'qr', label: 'QR Code (ISO 18004)' },
  { value: 'microqr', label: 'Micro QR Code' },
];

/**
 * The Error Correction radio box (`m_errorCorrectionChoices`). The percentages
 * are the share of the symbol a reader can lose and still decode, and they are
 * upstream's own labels rather than our gloss.
 */
export const BARCODE_ECC_CHOICES: readonly { value: BarcodeEcc; label: string }[] = [
  { value: 'L', label: '~20% (Level L)' },
  { value: 'M', label: '~37% (Level M)' },
  { value: 'Q', label: '~55% (Level Q)' },
  { value: 'H', label: '~65% (Level H)' },
];

/** The editable subset of a `PCB_BARCODE`, as the dialog holds it. */
export interface BarcodeValues {
  text: string;
  locked: boolean;
  layer: string;
  at: { x: number; y: number };
  width: number;
  height: number;
  textHeight: number;
  angle: number;
  knockout: boolean;
  margin: { x: number; y: number };
  showText: boolean;
  kind: BarcodeKind;
  ecc: BarcodeEcc;
}

/**
 * Resolve a `barcode:N` id, or null when the selection is not one barcode.
 *
 * `EDIT_TOOL::Properties` (`edit_tool.cpp:2785`) lists `PCB_BARCODE_T` with
 * the items whose dialog it can open, so Properties... over one barcode has to
 * reach `DIALOG_BARCODE_PROPERTIES` rather than falling through to the
 * footprint's.
 */
export function barcodeAt(board: Board, selection: Iterable<string>): number | null {
  let found: number | null = null;

  for (const id of selection) {
    const ref = parseBoardItemId(id);
    if (!ref || ref.kind !== 'barcode') continue;
    if (found !== null) return null;
    if (board.barcodes[ref.index]) found = ref.index;
  }

  return found;
}

/** `TransferDataToWindow` (`:174-227`). */
export const barcodeValues = (b: PcbBarcode): BarcodeValues => ({
  text: b.text,
  locked: b.locked ?? false,
  layer: b.layer,
  at: b.at,
  width: b.width,
  height: b.height,
  textHeight: b.textHeight,
  angle: b.angle,
  knockout: b.knockout,
  margin: b.margin,
  showText: b.showText,
  kind: b.kind,
  ecc: b.ecc,
});

/** `transferDataToBarcode` (`:257-320`), the values back onto the item. */
export const applyBarcodeValues = (b: PcbBarcode, v: BarcodeValues): PcbBarcode => ({
  ...b,
  text: v.text,
  locked: v.locked,
  layer: v.layer,
  at: v.at,
  width: v.width,
  height: v.height,
  textHeight: v.textHeight,
  angle: v.angle,
  knockout: v.knockout,
  margin: v.margin,
  showText: v.showText,
  kind: v.kind,
  ecc: v.ecc,
});

/** Which controls `OnUpdateUI` leaves usable for the current values. */
export interface BarcodeUiState {
  /** "Error correction options are only meaningful for QR codes" (`:148-150`). */
  eccEnabled: boolean;
  /** Micro QR has no level H (`:158-162`). */
  eccHEnabled: boolean;
  textSizeEnabled: boolean;
  marginsEnabled: boolean;
}

export const barcodeUiState = (v: BarcodeValues): BarcodeUiState => ({
  // `m_barcode->GetSelection() >= to_underlying( BARCODE_T::QR_CODE )` — an
  // index comparison, so it is the last two entries of the radio box and not
  // a named set. Data Matrix has error correction too, but ECC 200 fixes the
  // level per symbol size, so there is nothing to choose.
  eccEnabled: v.kind === 'qr' || v.kind === 'microqr',
  eccHEnabled: v.kind !== 'microqr',
  textSizeEnabled: v.showText,
  marginsEnabled: v.knockout,
});

/**
 * `OnUpdateUI`'s one *edit* (`:164-168`): switching to Micro QR while H is
 * selected moves the selection to Q — "consistent with SetErrorCorrection".
 *
 * It is not a validation message: the control simply changes under the user,
 * because H is about to be disabled and leaving it selected would commit a
 * level Micro QR cannot carry.
 */
export function correctEccForKind(v: BarcodeValues): BarcodeValues {
  if (v.kind === 'microqr' && v.ecc === 'H') return { ...v, ecc: 'Q' };
  return v;
}

/**
 * `TransferDataFromWindow` (`:238-244`): the text is set but nothing encoded.
 *
 *     if( !m_dummyBarcode->GetText().empty() && m_dummyBarcode->GetSymbolPoly().OutlineCount() == 0 )
 *         wxMessageBox( m_dummyBarcode->GetLastError(), _( "Barcode Error" ), … );
 *
 * Returns the message to show, or the empty string when the dialog may close.
 * Empty text is deliberately allowed through — a barcode with nothing in it is
 * legal and simply draws nothing.
 */
export function barcodeCommitError(b: PcbBarcode, v: BarcodeValues): string {
  if (v.text === '') return '';

  const g = barcodeGeometry(applyBarcodeValues(b, v));
  return g.symbolPoly.length === 0 ? g.error || 'Barcode Error' : '';
}
