// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BARCODE`'s message panel and Properties rows on the live item. Its
 * assembled geometry is pinned in pcb_barcode_geometry.test.ts, the encoder
 * against Zint itself in zint_encode.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { MSG_PANEL_ITEM } from '@ziroeda/common/widgets/msgpanel.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { FOOTPRINT_EDIT_FRAME_NAME, PCB_EDIT_FRAME_NAME } from '@ziroeda/common/eda_draw_frame.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { TEST_PCB_FRAME } from './support/test_pcb_frame.js';
import { livePanel } from './support/live_panel.js';

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Dwgs.User" user)
          (37 "F.SilkS" user "F.Silkscreen") (38 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (barcode (at 10 20 0) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type qr) (ecc_level L) (hide yes) (knockout no)
    (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
)`;

describe('the message panel', () => {
  /** PCB_BARCODE::GetMsgPanelInfo on the live item, in a frame of \a aType. */
  const rows = (src = BOARD, aType = FRAME_T.FRAME_PCB_EDITOR, aLocked = false) => {
    const board = ParseBoard(src);
    // `aFrame->GetName() == PCB_EDIT_FRAME_NAME` is what the rows test.
    const frame = new (class extends TEST_PCB_FRAME {
      override GetName(): string {
        return aType === FRAME_T.FRAME_PCB_EDITOR ? PCB_EDIT_FRAME_NAME : FOOTPRINT_EDIT_FRAME_NAME;
      }
    })(board, aType);
    frame.SetUserUnits('mm');
    const barcode = board.Drawings().find((d) => d.Type() === KICAD_T.PCB_BARCODE_T)!;
    barcode.SetLocked(aLocked);
    const list: MSG_PANEL_ITEM[] = [];
    barcode.GetMsgPanelInfo(frame.AsDrawFrameLike(), list);
    return list.map((i) => ({ upper: i.GetUpperText(), lower: i.GetLowerText() }));
  };

  it('shows PCB_BARCODE::GetMsgPanelInfo’s rows', () => {
    // `pcb_barcode.cpp:539-560`. `Barcode` carries the ENUM_MAP spelling —
    // `QR_CODE`, not the dialog's "QR Code (ISO 18004)" — and the angle goes
    // through `%g`, so it has no degree sign.
    const r = rows();
    expect(r.map((x) => x.upper)).toEqual(['Barcode', 'Text', 'Layer', 'Angle', 'Text Height']);
    expect(r[0]!.lower).toBe('QR_CODE');
    expect(r[1]!.lower).toBe('ZIRO');
    expect(r[3]!.lower).toBe('0');
  });

  it('shows the raw text, variable references and all', () => {
    // "Don't use GetShownText() here; we want to show the user the variable
    // references" (`:548`) — the opposite of what most items do, and the
    // reason is that a barcode's content is often generated.
    const src = BOARD.replace('(text "ZIRO")', '(text "${REFERENCE}")');
    expect(rows(src)[1]!.lower).toBe('${REFERENCE}');
  });

  it('adds Status only in the board editor, and only when locked', () => {
    expect(rows(BOARD, FRAME_T.FRAME_PCB_EDITOR, true).map((r) => r.upper)).toContain('Status');
    expect(rows(BOARD, FRAME_T.FRAME_FOOTPRINT_EDITOR, true).map((r) => r.upper)).not.toContain(
      'Status',
    );
    expect(rows(BOARD, FRAME_T.FRAME_PCB_EDITOR, false).map((r) => r.upper)).not.toContain(
      'Status',
    );
  });
});

describe('the Properties panel', () => {
  // PCB_PROPERTIES_PANEL on the live BOARD (#636 stage 6).
  const panel = (src = BOARD) => livePanel(src, (b) => b.Drawings()[0]!);
  const names = (src = BOARD): string[] =>
    panel(src)
      .rows()
      .map((r) => r.name);

  it('offers BOARD_ITEM’s four rows and then the barcode group', () => {
    // `InheritsAfter( PCB_BARCODE, BOARD_ITEM )` (`pcb_barcode.cpp:896`).
    expect(names()).toEqual([
      'Position X',
      'Position Y',
      'Layer',
      'Locked',
      'Text',
      'Show Text',
      'Text Size',
      'Width',
      'Height',
      'Orientation',
      'Barcode Type',
      'Error Correction',
      'Knockout',
    ]);
  });

  it('drops Error Correction for a symbology that has none', () => {
    // `SetAvailableFunc( isQRCode )`: the row is ABSENT, not greyed. Data
    // Matrix has error correction, but ECC 200 fixes the level per size.
    expect(names(BOARD.replace('(type qr)', '(type datamatrix)'))).not.toContain(
      'Error Correction',
    );
  });

  it('offers H to a QR code and not to a Micro QR', () => {
    // `SetChoicesFunc`: "Only QR_CODE has High" (`:974-976`).
    const eccOptions = (src: string): readonly string[] =>
      panel(src)
        .rows()
        .find((r) => r.name === 'Error Correction')!.choices!;

    expect(eccOptions(BOARD)).toEqual(['L (Low)', 'M (Medium)', 'Q (Quartile)', 'H (High)']);
    expect(eccOptions(BOARD.replace('(type qr)', '(type microqr)'))).toEqual([
      'L (Low)',
      'M (Medium)',
      'Q (Quartile)',
    ]);
  });

  it('shows the two margins only when Knockout is on', () => {
    // `SetAvailableFunc( hasKnockout )`.
    expect(names()).not.toContain('Margin X');

    const knocked = BOARD.replace('(knockout no)', '(knockout yes)');
    expect(names(knocked)).toContain('Margin X');
    expect(names(knocked)).toContain('Margin Y');
  });

  it('writes an edit back, keeping the uuid', () => {
    const p = panel();
    expect(p.set('Text', 'CHANGED')).toBe(true);
    expect(p.written()).toContain('(text "CHANGED")');
    expect(p.written()).toContain('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('drops `(ecc_level …)` when the kind stops being a QR code', () => {
    // The writer emits it for QR and Micro QR only, so a barcode changed to
    // Code 39 must lose the token rather than carry a stale one.
    const p = panel();
    expect(p.set('Barcode Type', 'CODE_39')).toBe(true);
    expect(p.written()).toContain('(type code39)');
    expect(p.written()).not.toContain('ecc_level');
  });

  it('moves off H when the kind becomes Micro QR', () => {
    // `SetBarcodeKind` re-encodes immediately, dropping a level Micro QR has not.
    const p = panel(BOARD.replace('(ecc_level L)', '(ecc_level H)'));
    expect(p.set('Barcode Type', 'MICRO_QR_CODE')).toBe(true);
    expect(p.written()).toContain('(ecc_level Q)');
  });
});
