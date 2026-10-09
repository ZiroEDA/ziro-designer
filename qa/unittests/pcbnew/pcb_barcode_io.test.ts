// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `(barcode …)` in and out of a `.kicad_pcb`.
 *
 * `PCB_BARCODE` (`pcbnew/pcb_barcode.h:63`) is a machine-readable symbol —
 * Code 39, Code 128, Data Matrix, QR or Micro QR — drawn as filled polygons on
 * a graphic layer, with an optional human-readable line under it.
 *
 * The striking thing about the format is what is NOT in it: **no geometry**.
 * The file stores the string, the symbology and the error-correction level, and
 * `parsePCB_BARCODE` ends with `barcode->AssembleBarcode()`
 * (`…_parser.cpp:4113`) — every load re-encodes from scratch. So this file's
 * job is the tokens, and the modules are somebody else's.
 *
 * Reader: `parsePCB_BARCODE` (`…_parser.cpp:3979-4117`).
 * Writer: `format( const PCB_BARCODE* )` (`pcb_io_kicad_sexpr.cpp:2198-2261`).
 */
import { describe, expect, it, vi } from 'vitest';

// Every read assembles the barcode's symbol (`PCB_BARCODE::AssembleBarcode`,
// the parser's last step), and a knockout QR takes a second or more.
vi.setConfig({ testTimeout: 30_000 });
import { head } from '@ziroeda/sexpr/index.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { GENERATOR } from '@ziroeda/common/generator.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { BARCODE_ECC_T, BARCODE_T, PCB_BARCODE } from '@ziroeda/pcbnew/pcb_barcode.js';
import {
  FormatBoard,
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNode } from './support/written_node.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

const withBarcode = (tokens: string): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (17 "Dwgs.User" user))
    (net 0 "")
    (barcode ${tokens})
  )`);

const barcodesOf = (items: { Type(): KICAD_T }[]): PCB_BARCODE[] =>
  items.filter((d) => d.Type() === KICAD_T.PCB_BARCODE_T) as PCB_BARCODE[];
const only = (b: BOARD): PCB_BARCODE => {
  const all = barcodesOf(b.Drawings());
  expect(all).toHaveLength(1);
  return all[0]!;
};
const fpBarcodes = (fp: FOOTPRINT): PCB_BARCODE[] => barcodesOf(fp.GraphicalItems());

describe('reading the tokens (parsePCB_BARCODE)', () => {
  const FULL = `(at 20 30 45) (layer "F.SilkS") (size 8 8) (text "ZIRO-1")
    (text_height 1.5) (type qr) (ecc_level M) (hide no) (knockout yes)
    (margins 2 3) (uuid "aaaaaaaa-0000-0000-0000-000000000001")`;

  it('reads every one of them', () => {
    const bc = only(withBarcode(FULL));

    expect(bc.GetPosition()).toEqual({ x: MM(20), y: MM(30) });
    expect(bc.GetOrientation()).toBe(45);
    expect(bc.GetLayer()).toBe(PCB_LAYER_ID.F_SilkS);
    expect(bc.GetWidth()).toBe(MM(8));
    expect(bc.GetHeight()).toBe(MM(8));
    expect(bc.GetText()).toBe('ZIRO-1');
    expect(bc.GetTextSize()).toBe(MM(1.5));
    expect(bc.GetKind()).toBe(BARCODE_T.QR_CODE);
    expect(bc.GetErrorCorrection()).toBe(BARCODE_ECC_T.M);
    expect(bc.IsKnockout()).toBe(true);
    expect(bc.GetMargin()).toEqual({ x: MM(2), y: MM(3) });
    expect(bc.m_Uuid).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('stores `(hide …)` inverted, because the item stores visibility', () => {
    // `barcode->SetShowText( !parseBool() )` (:4093).
    expect(only(withBarcode(`(text "X") (hide yes)`)).GetShowText()).toBe(false);
    expect(only(withBarcode(`(text "X") (hide no)`)).GetShowText()).toBe(true);
  });

  it('shows the text when the token is absent', () => {
    // `m_text` is a default `PCB_TEXT` and `EDA_TEXT::m_visible` starts true
    // (`eda_text.cpp:103`), so an old file with no `(hide …)` shows its text.
    expect(only(withBarcode(`(text "X")`)).GetShowText()).toBe(true);
  });

  it('takes the angle as a plain double, and needs one', () => {
    // `token = NextTok(); if( CurTok() == T_NUMBER ) barcode->SetOrientation(
    // parseDouble() ); NeedRIGHT();` (:4000-4004): pcbnew 10.0.5 refuses
    // `(barcode (at 1 2) …)` and its own writer always spells the angle.
    expect(() => withBarcode(`(at 1 2) (text "X")`)).toThrow(/Expecting '\)'/);
    expect(only(withBarcode(`(at 1 2 -12.5) (text "X")`)).GetOrientation()).toBe(-12.5);
  });

  it.each([
    ['code39', BARCODE_T.CODE_39],
    ['code128', BARCODE_T.CODE_128],
    ['datamatrix', BARCODE_T.DATA_MATRIX],
    ['data_matrix', BARCODE_T.DATA_MATRIX],
    ['qr', BARCODE_T.QR_CODE],
    ['qrcode', BARCODE_T.QR_CODE],
    ['microqr', BARCODE_T.MICRO_QR_CODE],
    ['micro_qr', BARCODE_T.MICRO_QR_CODE],
  ])('accepts `(type %s)`', (token, kind) => {
    // Three of the five kinds have a second accepted spelling (:4045-4059).
    expect(only(withBarcode(`(text "X") (type ${token})`)).GetKind()).toBe(kind);
  });

  it.each([
    ['L', BARCODE_ECC_T.L],
    ['M', BARCODE_ECC_T.M],
    ['Q', BARCODE_ECC_T.Q],
    ['H', BARCODE_ECC_T.H],
    ['l', BARCODE_ECC_T.L],
    ['h', BARCODE_ECC_T.H],
  ])('accepts `(ecc_level %s)`', (token, ecc) => {
    // `if( ecc == "L" || ecc == "l" )` — either case (:4067-4076).
    expect(
      only(withBarcode(`(text "X") (type qr) (ecc_level ${token})`)).GetErrorCorrection(),
    ).toBe(ecc);
  });

  it('falls back to the constructor for every absent token', () => {
    // `PCB_BARCODE::PCB_BARCODE` (`pcb_barcode.cpp:61-72`): a bare `(barcode)`
    // has to land on a complete item.
    const bc = only(withBarcode(''));

    expect(bc.GetPosition()).toEqual({ x: 0, y: 0 });
    expect(bc.GetOrientation()).toBe(0);
    expect(bc.GetWidth()).toBe(MM(40));
    expect(bc.GetHeight()).toBe(MM(40));
    expect(bc.GetKind()).toBe(BARCODE_T.QR_CODE);
    expect(bc.GetErrorCorrection()).toBe(BARCODE_ECC_T.L);
    expect(bc.GetLayer()).toBe(PCB_LAYER_ID.Dwgs_User);
    expect(bc.GetText()).toBe('');
    // `EDA_TEXT`'s `DEFAULT_SIZE_TEXT`, 50 mils (`eda_text.h:81`).
    expect(bc.GetTextSize()).toBe(MM(1.27));
    expect(bc.IsKnockout()).toBe(false);
    expect(bc.GetMargin()).toEqual({ x: 0, y: 0 });
  });

  it('reads `(locked …)` in the maybe-absent form', () => {
    // `parseMaybeAbsentBool( true )` (:4083), so a bare `(locked)` means yes.
    expect(only(withBarcode(`(text "X") (locked yes)`)).IsLocked()).toBe(true);
    expect(only(withBarcode(`(text "X") (locked)`)).IsLocked()).toBe(true);
    expect(only(withBarcode(`(text "X") (locked no)`)).IsLocked()).toBe(false);
    expect(only(withBarcode(`(text "X")`)).IsLocked()).toBe(false);
  });
});

describe('a footprint’s barcode', () => {
  const FP = `(footprint "L:B" (version 20241229) (layer "F.Cu")
    (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB")
      (text_height 1) (type code128) (hide no) (knockout no)
      (uuid "bbbbbbbb-0000-0000-0000-000000000002")))`;

  it('reads into FOOTPRINT’s own items', () => {
    // `parseFOOTPRINT`, T_barcode (`…_parser.cpp:5559-5563`).
    const all = fpBarcodes(ParseFootprintFile(FP));

    expect(all).toHaveLength(1);
    expect(all[0]!.GetText()).toBe('AB');
    expect(all[0]!.GetKind()).toBe(BARCODE_T.CODE_128);
  });

  it('is stored in ABSOLUTE board coordinates, like a point and unlike a graphic', () => {
    // `parsePCB_BARCODE( footprint.get() )` never consults the parent: there is
    // no `Rotate( … parentFP->GetOrientation() ); Move( … )` tail, which every
    // graphic and every text has (`…_parser.cpp:3649-3652`, :3968-3974).
    const b = ParseBoard(`(kicad_pcb (version 20241229) (net 0 "")
      (footprint "L:B" (layer "F.Cu") (at 100 50 90)
        (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB")
          (text_height 1) (type qr) (ecc_level L) (hide no) (knockout no))))`);

    expect(fpBarcodes(b.Footprints()[0]!)[0]!.GetPosition()).toEqual({ x: MM(1), y: MM(2) });
  });
});

describe('writing (format( PCB_BARCODE* ))', () => {
  /** A 40 mm QR "HELLO" at (10, 20) on Dwgs.User, as the constructor leaves the rest. */
  const out = (edit: (bc: PCB_BARCODE) => void = () => {}): string => {
    const board = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (17 "Dwgs.User" user)) (net 0 ""))`);
    const bc = new PCB_BARCODE(board);
    bc.SetPosition({ x: MM(10), y: MM(20) });
    bc.SetText('HELLO');
    edit(bc);
    bc.AssembleBarcode();
    board.Add(bc);
    const node = writtenNode(board, 'barcode');
    // `FormatUuid` is the last token (:2258); a built barcode's KIID is fresh,
    // so it is dropped from the one-line form the assertions read.
    return flatText({
      kind: 'list',
      items: node.items.filter((it) => !(it.kind === 'list' && head(it) === 'uuid')),
    }).trim();
  };

  it('writes the formatter’s tokens in the formatter’s order', () => {
    expect(out()).toBe(
      '(barcode (at 10 20 0) (layer "Dwgs.User") (size 40 40) (text "HELLO")' +
        ' (text_height 1.27) (type qr) (ecc_level L) (hide no) (knockout no))',
    );
  });

  it('always writes the angle, even when it is zero', () => {
    // `(at %s %s)` with `FormatAngle` filling the second `%s` unconditionally
    // (:2207-2209).
    expect(out()).toContain('(at 10 20 0)');
    expect(out((bc) => bc.SetOrientation(90))).toContain('(at 10 20 90)');
  });

  it('writes the angle as %.10g, which is what FormatAngle is', () => {
    // `fmt::format( "{:.10g}", aAngle.AsDegrees() )` (`eda_units.cpp:188`).
    expect(out((bc) => bc.SetOrientation(33.333333333333))).toContain('(at 10 20 33.33333333)');
  });

  it('writes `hide` and `knockout` both ways, because FormatBool always emits', () => {
    expect(out()).toContain('(hide no) (knockout no)');
    expect(
      out((bc) => {
        bc.SetShowText(false);
        bc.SetIsKnockout(true);
      }),
    ).toContain('(hide yes) (knockout yes)');
  });

  it('writes `(ecc_level …)` for QR and Micro QR only', () => {
    // The two symbologies whose error correction Zint takes as `option_1`
    // (`pcb_barcode.cpp:580-588`).
    expect(out()).toContain('(ecc_level L)');
    expect(
      out((bc) => {
        bc.SetKind(BARCODE_T.MICRO_QR_CODE);
        bc.SetErrorCorrection(BARCODE_ECC_T.Q);
      }),
    ).toContain('(ecc_level Q)');
    for (const kind of [BARCODE_T.CODE_39, BARCODE_T.CODE_128, BARCODE_T.DATA_MATRIX])
      expect(
        out((bc) => {
          bc.SetKind(kind);
          bc.SetErrorCorrection(BARCODE_ECC_T.H);
        }),
      ).not.toContain('ecc_level');
  });

  it('writes `(margins …)` only when one is non-zero', () => {
    // The one token the formatter guards on a value rather than a flag (:2252-2256).
    expect(out()).not.toContain('margins');
    expect(out((bc) => bc.SetMargin({ x: MM(1), y: 0 }))).toContain('(margins 1 0)');
    expect(out((bc) => bc.SetMargin({ x: 0, y: MM(2) }))).toContain('(margins 0 2)');
  });

  it('writes `(locked yes)` ahead of the position, and nothing when unlocked', () => {
    // `if( aBarcode->IsLocked() ) FormatBool( …, "locked", true )` sits between
    // the head and `(at …)` (:2204-2205).
    expect(out((bc) => bc.SetLocked(true)).startsWith('(barcode (locked yes) (at')).toBe(true);
    expect(out()).not.toContain('locked');
  });

  it('emits the canonical spelling for a kind read through its alias', () => {
    expect(FormatBoard(withBarcode(`(text "X") (type data_matrix)`))).toContain(
      '(type datamatrix)',
    );
  });
});

describe('round-tripping', () => {
  it('leaves an untouched board byte-identical', () => {
    const src = `(kicad_pcb (version 20241229) (generator "${GENERATOR}")
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
    (net 0 "")
    (barcode (at 20 30 45) (layer "F.SilkS") (size 8 8) (text "ZIRO-1") (text_height 1.5)
      (type qr) (ecc_level M) (hide no) (knockout yes) (margins 2 3)
      (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
  )`;

    // KiCad's formatter normalises the fixture on the first save; the second
    // save writes the same bytes, barcode included.
    const once = FormatBoard(ParseBoard(src));
    expect(once).toContain('(text "ZIRO-1")');
    expect(FormatBoard(ParseBoard(once))).toBe(once);
  });

  it('keeps a footprint’s barcode where the file put it', () => {
    const src = `(kicad_pcb (version 20241229) (generator "${GENERATOR}")
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
    (net 0 "")
    (footprint "L:B" (layer "F.Cu") (at 100 50 90)
      (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB") (text_height 1)
        (type code39) (hide no) (knockout no)
        (uuid "bbbbbbbb-0000-0000-0000-000000000002")))
  )`;

    // Stored in board coordinates and written as it was read.
    const once = FormatBoard(ParseBoard(src));
    expect(once).toContain('(at 1 2 0)');
    expect(FormatBoard(ParseBoard(once))).toBe(once);
  });
});
