// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * @deprecated The plain-object (`PcbBarcode`) form, kept for the properties
 * dialog until it moves onto `PCB_BARCODE` (#636 stage 6). The class port is
 * `pcb_barcode.ts`; new code uses that one.
 *
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
import { LSET_Name, LSET_NameToLayer } from '@ziroeda/common/layer_ids.js';
import { EDA_ANGLE, EDA_ANGLE_T } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { BOARD_COMMIT } from '../board_commit.js';
import type { PCB_BASE_FRAME } from '../pcb_base_frame.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '../pcb_barcode.js';
import { barcodeGeometry } from '../pcb_io/kicad_sexpr/board_view.js';
import type { TransferResult } from './dialog_text_properties.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { parseBoardItemId } from '../edit-board.js';
import type { BarcodeEcc, BarcodeKind, Board, PcbBarcode } from '../types.js';

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

// ---------------------------------------------------------------------------
// DIALOG_BARCODE_PROPERTIES over the live PCB_BARCODE (#636 stage 6)

/** `m_barcode`'s radio order (`:208-215`, `:291-299`). */
const KINDS: readonly BarcodeKind[] = ['code39', 'code128', 'datamatrix', 'qr', 'microqr'];
const KIND_T: readonly BARCODE_T[] = [
  BARCODE_T.CODE_39,
  BARCODE_T.CODE_128,
  BARCODE_T.DATA_MATRIX,
  BARCODE_T.QR_CODE,
  BARCODE_T.MICRO_QR_CODE,
];
/** `m_errorCorrection`'s order. */
const ECCS: readonly BarcodeEcc[] = ['L', 'M', 'Q', 'H'];
const ECC_T: readonly BARCODE_ECC_T[] = [
  BARCODE_ECC_T.L,
  BARCODE_ECC_T.M,
  BARCODE_ECC_T.Q,
  BARCODE_ECC_T.H,
];

/** What the dialog's preview canvas draws: the item's polygon rings and its box. */
export interface BarcodePreview {
  rings: readonly (readonly Vec2[])[];
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

/** `refreshPreview`'s item: `GetPolyShape()` (symbol, text, knockout) and `GetBoundingBox()`. */
export function barcodePreview(aBarcode: PCB_BARCODE): BarcodePreview {
  const poly = aBarcode.GetPolyShape();
  const rings: Vec2[][] = [];

  for (let i = 0; i < poly.OutlineCount(); i++) {
    rings.push([...poly.COutline(i).CPoints()]);

    for (let j = 0; j < poly.HoleCount(i); j++) rings.push([...poly.CHole(i, j).CPoints()]);
  }

  const box = aBarcode.GetBoundingBox();
  const end = box.GetEnd();

  return { rings, bbox: { x1: box.GetX(), y1: box.GetY(), x2: end.x, y2: end.y } };
}

/**
 * `DIALOG_BARCODE_PROPERTIES` (dialog_barcode_properties.cpp) on a live
 * PCB_BARCODE. OK first assembles the values on a dummy barcode and refuses
 * a text that yields no symbol (the Zint error), then applies them to the
 * item in one BOARD_COMMIT, "Modify barcode". A changed orientation is a
 * `Rotate` about the position, as `transferDataToBarcode` does.
 */
export class DIALOG_BARCODE_PROPERTIES {
  private readonly m_parent: PCB_BASE_FRAME;
  private readonly m_currentBarcode: PCB_BARCODE;

  constructor(aParent: PCB_BASE_FRAME, aBarcode: PCB_BARCODE) {
    this.m_parent = aParent;
    this.m_currentBarcode = aBarcode;
  }

  TransferDataToWindow(): BarcodeValues {
    const b = this.m_currentBarcode;
    const kind = KIND_T.indexOf(b.GetKind());
    const ecc = ECC_T.indexOf(b.GetErrorCorrection());

    return {
      text: b.GetText(),
      locked: b.IsLocked(),
      layer: LSET_Name(b.GetLayer()),
      at: b.GetPosition(),
      width: b.GetWidth(),
      height: b.GetHeight(),
      textHeight: b.GetTextSize(),
      angle: b.GetAngle().AsDegrees(),
      knockout: b.IsKnockout(),
      margin: b.GetMargin(),
      showText: b.Text().IsVisible(),
      kind: KINDS[kind >= 0 ? kind : 0]!,
      ecc: ECCS[ecc >= 0 ? ecc : 0]!,
    };
  }

  /** `transferDataToBarcode( aBarcode )`. */
  private transferDataToBarcode(aBarcode: PCB_BARCODE, v: BarcodeValues): void {
    aBarcode.SetText(v.text);
    aBarcode.SetLocked(v.locked);
    aBarcode.SetLayer(LSET_NameToLayer(v.layer));

    aBarcode.SetPosition({ x: v.at.x, y: v.at.y });

    aBarcode.SetWidth(v.width);
    aBarcode.SetHeight(v.height);
    aBarcode.SetTextSize(v.textHeight);

    const oldAngle = aBarcode.GetAngle();
    const newAngle = new EDA_ANGLE(v.angle, EDA_ANGLE_T.DEGREES_T);

    if (!newAngle.equals(oldAngle)) aBarcode.Rotate(aBarcode.GetPosition(), newAngle.sub(oldAngle));

    aBarcode.SetIsKnockout(v.knockout);
    aBarcode.SetMargin({ x: v.margin.x, y: v.margin.y });

    aBarcode.Text().SetVisible(v.showText);

    const kind = KINDS.indexOf(v.kind);
    aBarcode.SetKind(kind >= 0 ? KIND_T[kind]! : BARCODE_T.QR_CODE);

    const ecc = ECCS.indexOf(v.ecc);
    aBarcode.SetErrorCorrection(ecc >= 0 ? ECC_T[ecc]! : BARCODE_ECC_T.L);

    aBarcode.AssembleBarcode();
  }

  /**
   * `m_dummyBarcode` after `transferDataToBarcode`: what `refreshPreview`
   * draws (`:322-343`) and what OK checks before touching the real item.
   */
  Preview(v: BarcodeValues): PCB_BARCODE {
    const dummy = new PCB_BARCODE(this.m_parent.GetBoard());
    dummy.assignBarcode(this.m_currentBarcode);
    this.transferDataToBarcode(dummy, v);
    return dummy;
  }

  /** The "Barcode Error" message OK would put up, or '' (`:241-245`). */
  CommitError(v: BarcodeValues): string {
    const dummy = this.Preview(v);
    if (dummy.GetText() !== '' && dummy.GetSymbolPoly().OutlineCount() === 0)
      return dummy.GetLastError();
    return '';
  }

  TransferDataFromWindow(v: BarcodeValues): TransferResult {
    const message = this.CommitError(v);

    if (message) return { ok: false, message };

    // A new barcode (DrawBarcode's, IS_NEW) is not on the board yet; the tool
    // commits it as 'Draw Barcode'. Upstream's `commit.Modify` of it here
    // would push a second undo step for an item no board holds.
    if (this.m_currentBarcode.IsNew()) {
      this.transferDataToBarcode(this.m_currentBarcode, v);
      return { ok: true };
    }

    const commit = new BOARD_COMMIT(this.m_parent);
    commit.Modify(this.m_currentBarcode);

    this.transferDataToBarcode(this.m_currentBarcode, v);

    commit.Push('Modify barcode');

    return { ok: true };
  }
}
