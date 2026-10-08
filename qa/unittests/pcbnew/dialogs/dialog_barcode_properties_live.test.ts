// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_BARCODE_PROPERTIES on a live PCB_BARCODE (dialog_barcode_properties.cpp).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import {
  DIALOG_BARCODE_PROPERTIES,
  barcodePreview,
  barcodeUiState,
  correctEccForKind,
} from '@ziroeda/pcbnew/dialogs/dialog_barcode_properties.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '@ziroeda/pcbnew/pcb_barcode.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from '../support/test_pcb_frame.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

let board: BOARD;
let frame: TEST_PCB_FRAME;
const bc = () => board.Drawings()[0] as PCB_BARCODE;
const dlg = () => new DIALOG_BARCODE_PROPERTIES(frame, bc());

beforeEach(() => {
  board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user "F.Silkscreen"))
  (net 0 "")
  (barcode (at 20 30 0) (layer "F.SilkS") (size 8 8) (text "ZIRO-1") (text_height 1.5)
    (type qr) (ecc_level M) (hide no) (knockout no) (uuid "aaaaaaaa-0000-4000-8000-000000000001"))
)`);
  frame = new TEST_PCB_FRAME(board);
});

describe('DIALOG_BARCODE_PROPERTIES', () => {
  it('reads the barcode', () => {
    expect(dlg().TransferDataToWindow()).toMatchObject({
      text: 'ZIRO-1',
      layer: 'F.SilkS',
      at: { x: MM(20), y: MM(30) },
      textHeight: MM(1.5),
      angle: 0,
      showText: true,
      kind: 'qr',
      ecc: 'M',
    });
  });

  it('writes it back as one undo step, rotating about the position', () => {
    const v = dlg().TransferDataToWindow();
    expect(
      dlg().TransferDataFromWindow({ ...v, text: 'NEW', angle: 90, ecc: 'H', showText: false }),
    ).toEqual({
      ok: true,
    });
    expect(bc().GetText()).toBe('NEW');
    expect(bc().GetAngle().AsDegrees()).toBe(90);
    expect(bc().GetPosition()).toEqual({ x: MM(20), y: MM(30) });
    expect(bc().GetErrorCorrection()).toBe(BARCODE_ECC_T.H);
    expect(bc().Text().IsVisible()).toBe(false);
    expect(bc().GetSymbolPoly().OutlineCount()).toBeGreaterThan(0);
    expect(frame.GetUndoCommandCount()).toBe(1);
    frame.RestoreCopyFromUndoList();
    expect(bc().GetText()).toBe('ZIRO-1');
  });

  it('refuses a text the symbology cannot encode, with Zint’s own message, changing nothing', () => {
    // `TransferDataFromWindow` (`:238-244`) shows `GetLastError()` and returns
    // false rather than committing an empty symbol.
    const v = dlg().TransferDataToWindow();
    // Code 39 has no lower case or '@'.
    const r = dlg().TransferDataFromWindow({ ...v, kind: 'code39', text: 'a@b' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Invalid character at position 2');
    expect(bc().GetKind()).toBe(BARCODE_T.QR_CODE);
    expect(frame.GetUndoCommandCount()).toBe(0);
  });

  it('lets empty text through, which draws nothing', () => {
    // `if( !m_dummyBarcode->GetText().empty() && … )` (`:238`) — the emptiness
    // check comes first, so a barcode with no content is a legal item.
    const r = dlg().TransferDataFromWindow({ ...dlg().TransferDataToWindow(), text: '' });
    expect(r.ok).toBe(true);
    expect(bc().GetText()).toBe('');
  });

  it('the preview is the dialog values on a copy; the item is untouched (:322-343)', () => {
    const d = dlg();
    const v = d.TransferDataToWindow();
    const p = d.Preview({ ...v, text: 'OTHER', width: MM(12), height: MM(12) });
    expect(p).not.toBe(bc());
    expect(p.GetText()).toBe('OTHER');
    expect(p.GetSymbolPoly().OutlineCount()).toBeGreaterThan(0);
    expect(bc().GetText()).toBe('ZIRO-1');
    const g = barcodePreview(p);
    expect(g.rings.length).toBeGreaterThan(0);
    expect(g.bbox.x2 - g.bbox.x1).toBeGreaterThanOrEqual(MM(12));
  });

  it('a new barcode (IS_NEW) takes the values with no commit of its own', () => {
    const fresh = new PCB_BARCODE(board);
    fresh.SetFlags(IS_NEW);
    fresh.SetLayer(PCB_LAYER_ID.F_SilkS);
    const d = new DIALOG_BARCODE_PROPERTIES(frame, fresh);
    expect(d.TransferDataFromWindow({ ...d.TransferDataToWindow(), text: 'FRESH' })).toEqual({
      ok: true,
    });
    expect(fresh.GetText()).toBe('FRESH');
    expect(frame.GetUndoCommandCount()).toBe(0);
  });
});

describe('what OnUpdateUI decides (:145-168)', () => {
  const window = () => dlg().TransferDataToWindow();

  it('offers error correction for the two QR kinds only', () => {
    // `m_barcode->GetSelection() >= to_underlying( BARCODE_T::QR_CODE )`
    // (`:149`). Data Matrix has error correction too — ECC 200 — but its level
    // is fixed by the symbol size, so there is nothing to choose.
    const state = (kind: ReturnType<typeof window>['kind']): boolean =>
      barcodeUiState({ ...window(), kind }).eccEnabled;

    expect(state('qr')).toBe(true);
    expect(state('microqr')).toBe(true);
    expect(state('code39')).toBe(false);
    expect(state('code128')).toBe(false);
    expect(state('datamatrix')).toBe(false);
  });

  it('greys level H for Micro QR, and moves the choice off it', () => {
    // `m_errorCorrection->Enable( 3, !isMicroQR )` and, if H was selected,
    // `SetSelection( 2 )` — "consistent with SetErrorCorrection" (`:158-168`).
    expect(barcodeUiState({ ...window(), kind: 'microqr' }).eccHEnabled).toBe(false);
    expect(barcodeUiState({ ...window(), kind: 'qr' }).eccHEnabled).toBe(true);

    const v = correctEccForKind({ ...window(), kind: 'microqr', ecc: 'H' });
    expect(v.ecc).toBe('Q');
    // …a level it CAN carry is left alone, and so is H on a plain QR code.
    expect(correctEccForKind({ ...v, ecc: 'M' }).ecc).toBe('M');
    expect(correctEccForKind({ ...window(), kind: 'qr', ecc: 'H' }).ecc).toBe('H');
  });

  it('gates text size on Show Text and the margins on Knockout', () => {
    expect(barcodeUiState({ ...window(), showText: false }).textSizeEnabled).toBe(false);
    expect(barcodeUiState({ ...window(), showText: true }).textSizeEnabled).toBe(true);
    expect(barcodeUiState({ ...window(), knockout: false }).marginsEnabled).toBe(false);
    expect(barcodeUiState({ ...window(), knockout: true }).marginsEnabled).toBe(true);
  });
});
