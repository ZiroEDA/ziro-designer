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
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr/src/index.js';
import { readBoard, readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { buildBarcodeNode } from '@ziroeda/pcbnew/src/write-footprint.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { GENERATOR } from '@ziroeda/common/src/generator.js';
import type { Board, PcbBarcode } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const read = (src: string): Board => readBoard(parse(src));

const withBarcode = (tokens: string): Board =>
  read(`(kicad_pcb (version 20241229) (generator "test")
    (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Dwgs.User" user))
    (net 0 "")
    (barcode ${tokens})
  )`);

const only = (b: Board): PcbBarcode => {
  expect(b.barcodes).toHaveLength(1);
  return b.barcodes[0]!;
};

describe('reading the tokens', () => {
  const FULL = `(at 20 30 45) (layer "F.SilkS") (size 8 8) (text "ZIRO-1")
    (text_height 1.5) (type qr) (ecc_level M) (hide no) (knockout yes)
    (margins 2 3) (uuid "aaaaaaaa-0000-0000-0000-000000000001")`;

  it('reads every one of them', () => {
    const bc = only(withBarcode(FULL));

    expect(bc.at).toEqual({ x: MM(20), y: MM(30) });
    expect(bc.angle).toBe(45);
    expect(bc.layer).toBe('F.SilkS');
    expect(bc.width).toBe(MM(8));
    expect(bc.height).toBe(MM(8));
    expect(bc.text).toBe('ZIRO-1');
    expect(bc.textHeight).toBe(MM(1.5));
    expect(bc.kind).toBe('qr');
    expect(bc.ecc).toBe('M');
    expect(bc.knockout).toBe(true);
    expect(bc.margin).toEqual({ x: MM(2), y: MM(3) });
    expect(bc.uuid).toBe('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('stores `(hide …)` inverted, because the item stores visibility', () => {
    // `barcode->SetShowText( !parseBool() )` (:4093). The two are the same
    // fact spelled opposite ways, and getting the sign wrong hides exactly the
    // text a file asked to show.
    expect(only(withBarcode(`(text "X") (hide yes)`)).showText).toBe(false);
    expect(only(withBarcode(`(text "X") (hide no)`)).showText).toBe(true);
  });

  it('shows the text when the token is absent', () => {
    // `m_text` is a default `PCB_TEXT` and `EDA_TEXT::m_visible` starts true
    // (`eda_text.cpp:103`), so an old file with no `(hide …)` shows its text.
    expect(only(withBarcode(`(text "X")`)).showText).toBe(true);
  });

  it('takes the angle as a plain double, and defaults it to zero', () => {
    // `if( CurTok() == T_NUMBER ) barcode->SetOrientation( parseDouble() )`
    // (:4002-4004): the third field of `(at …)` is optional.
    expect(only(withBarcode(`(at 1 2) (text "X")`)).angle).toBe(0);
    expect(only(withBarcode(`(at 1 2 -12.5) (text "X")`)).angle).toBe(-12.5);
  });

  it.each([
    ['code39', 'code39'],
    ['code128', 'code128'],
    ['datamatrix', 'datamatrix'],
    ['data_matrix', 'datamatrix'],
    ['qr', 'qr'],
    ['qrcode', 'qr'],
    ['microqr', 'microqr'],
    ['micro_qr', 'microqr'],
  ])('accepts `(type %s)`', (token, kind) => {
    // Three of the five kinds have a second accepted spelling (:4045-4059).
    // The writer emits only the first of each pair, so the aliases exist to
    // read files other tools wrote — dropping them would fail the load.
    expect(only(withBarcode(`(text "X") (type ${token})`)).kind).toBe(kind);
  });

  it.each([
    ['L', 'L'],
    ['M', 'M'],
    ['Q', 'Q'],
    ['H', 'H'],
    ['l', 'L'],
    ['h', 'H'],
  ])('accepts `(ecc_level %s)`', (token, ecc) => {
    // `if( ecc == "L" || ecc == "l" )` — either case (:4067-4076).
    expect(only(withBarcode(`(text "X") (type qr) (ecc_level ${token})`)).ecc).toBe(ecc);
  });

  it('falls back to the constructor for every absent token', () => {
    // `PCB_BARCODE::PCB_BARCODE` (`pcb_barcode.cpp:61-72`). The grammar makes
    // all eleven optional — the parser only rejects a head that is not one of
    // them — so a bare `(barcode)` has to land on a complete item.
    const bc = only(withBarcode(''));

    expect(bc.at).toEqual({ x: 0, y: 0 });
    expect(bc.angle).toBe(0);
    expect(bc.width).toBe(MM(40));
    expect(bc.height).toBe(MM(40));
    expect(bc.kind).toBe('qr');
    expect(bc.ecc).toBe('L');
    expect(bc.layer).toBe('Dwgs.User');
    expect(bc.text).toBe('');
    // `EDA_TEXT`'s `DEFAULT_SIZE_TEXT`, 50 mils (`eda_text.h:81`).
    expect(bc.textHeight).toBe(MM(1.27));
    expect(bc.knockout).toBe(false);
    expect(bc.margin).toEqual({ x: 0, y: 0 });
  });

  it('reads `(locked …)` in the maybe-absent form', () => {
    // `parseMaybeAbsentBool( true )` (:4083), so a bare `(locked)` means yes.
    expect(only(withBarcode(`(text "X") (locked yes)`)).locked).toBe(true);
    expect(only(withBarcode(`(text "X") (locked)`)).locked).toBe(true);
    expect(only(withBarcode(`(text "X") (locked no)`)).locked).toBe(false);
    expect(only(withBarcode(`(text "X")`)).locked).toBeUndefined();
  });
});

describe('a footprint’s barcode', () => {
  const FP = `(footprint "L:B" (version 20241229) (layer "F.Cu")
    (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB")
      (text_height 1) (type code128) (hide no) (knockout no)
      (uuid "bbbbbbbb-0000-0000-0000-000000000002")))`;

  it('reads into FOOTPRINT’s own list', () => {
    // `parseFOOTPRINT`, T_barcode (`…_parser.cpp:5559-5563`) — the same
    // unprefixed token a board uses, added to the footprint.
    const fp = readFootprintFile(parse(FP))!;

    expect(fp.barcodes).toHaveLength(1);
    expect(fp.barcodes[0]!.text).toBe('AB');
    expect(fp.barcodes[0]!.kind).toBe('code128');
  });

  it('is stored in ABSOLUTE board coordinates, like a point and unlike a graphic', () => {
    // `parsePCB_BARCODE( footprint.get() )` hands the footprint to the
    // constructor as a parent and then never consults it: there is no
    // `Rotate( {0,0}, parentFP->GetOrientation() ); Move( … )` tail, which
    // every graphic and every text has (`…_parser.cpp:3649-3652`, :3968-3974).
    // The writer matches — `formatInternalUnits( aBarcode->GetPosition() )`
    // with no `parentFP` argument (`pcb_io_kicad_sexpr.cpp:2208`).
    const b = read(`(kicad_pcb (version 20241229) (net 0 "")
      (footprint "L:B" (layer "F.Cu") (at 100 50 90)
        (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB")
          (text_height 1) (type qr) (ecc_level L) (hide no) (knockout no))))`);

    expect(b.footprints[0]!.barcodes[0]!.at).toEqual({ x: MM(1), y: MM(2) });
  });
});

describe('writing', () => {
  const built = (over: Partial<PcbBarcode> = {}): PcbBarcode => ({
    at: { x: MM(10), y: MM(20) },
    angle: 0,
    layer: 'Dwgs.User',
    width: MM(40),
    height: MM(40),
    text: 'HELLO',
    textHeight: MM(1.27),
    kind: 'qr',
    ecc: 'L',
    showText: true,
    knockout: false,
    margin: { x: 0, y: 0 },
    source: { kind: 'list', items: [] },
    ...over,
  });
  /**
   * The token sequence on one line. `serialize` is our port of KiCad's
   * pretty-printer, so it breaks and indents children exactly as upstream
   * does; collapsing that here keeps these assertions about the ORDER and the
   * PRESENCE of tokens, which is what the formatter decides, rather than about
   * the printer's line breaks, which a different test owns.
   */
  const out = (over: Partial<PcbBarcode> = {}): string =>
    serialize(buildBarcodeNode(built(over)))
      .replace(/\s+/g, ' ')
      .replace(/ \)/g, ')')
      .trim();

  it('writes the formatter’s tokens in the formatter’s order', () => {
    expect(out()).toBe(
      '(barcode (at 10 20 0) (layer "Dwgs.User") (size 40 40) (text "HELLO")' +
        ' (text_height 1.27) (type qr) (ecc_level L) (hide no) (knockout no))',
    );
  });

  it('always writes the angle, even when it is zero', () => {
    // Most items omit a zero rotation; `format( const PCB_BARCODE* )` has no
    // such branch — `(at %s %s)` with `FormatAngle` filling the second `%s`
    // unconditionally (:2207-2209).
    expect(out()).toContain('(at 10 20 0)');
    expect(out({ angle: 90 })).toContain('(at 10 20 90)');
  });

  it('writes the angle as %.10g, which is what FormatAngle is', () => {
    // `fmt::format( "{:.10g}", aAngle.AsDegrees() )` (`eda_units.cpp:188`) —
    // ten SIGNIFICANT digits, not ten decimal places.
    expect(out({ angle: 33.333333333333 })).toContain('(at 10 20 33.33333333)');
  });

  it('writes `hide` and `knockout` both ways, because FormatBool always emits', () => {
    // A `no` here is not noise: dropping it would change what a reader
    // defaults to, and `SetShowText`'s default is the opposite of
    // `SetIsKnockout`'s.
    expect(out({ showText: true, knockout: false })).toContain('(hide no) (knockout no)');
    expect(out({ showText: false, knockout: true })).toContain('(hide yes) (knockout yes)');
  });

  it('writes `(ecc_level …)` for QR and Micro QR only', () => {
    // The two symbologies whose error correction Zint takes as `option_1`
    // (`pcb_barcode.cpp:580-588`). A Code 39 with one would be a token KiCad's
    // parser accepts but its writer never produces.
    expect(out({ kind: 'qr' })).toContain('(ecc_level L)');
    expect(out({ kind: 'microqr', ecc: 'Q' })).toContain('(ecc_level Q)');
    expect(out({ kind: 'code39', ecc: 'H' })).not.toContain('ecc_level');
    expect(out({ kind: 'code128', ecc: 'H' })).not.toContain('ecc_level');
    expect(out({ kind: 'datamatrix', ecc: 'H' })).not.toContain('ecc_level');
  });

  it('writes `(margins …)` only when one is non-zero', () => {
    // The one token the formatter guards on a value rather than a flag
    // (:2252-2256).
    expect(out()).not.toContain('margins');
    expect(out({ margin: { x: MM(1), y: 0 } })).toContain('(margins 1 0)');
    expect(out({ margin: { x: 0, y: MM(2) } })).toContain('(margins 0 2)');
  });

  it('writes `(locked yes)` ahead of the position, and nothing when unlocked', () => {
    // `if( aBarcode->IsLocked() ) FormatBool( …, "locked", true )` sits between
    // the head and `(at …)` (:2204-2205) — unlike `hide`/`knockout`, this one
    // is conditional, so an unlocked barcode has no token at all.
    expect(out({ locked: true }).startsWith('(barcode (locked yes) (at')).toBe(true);
    expect(out()).not.toContain('locked');
  });

  it('emits the canonical spelling for a kind read through its alias', () => {
    const b = withBarcode(`(text "X") (type data_matrix)`);
    b.barcodes[0] = { ...b.barcodes[0]!, source: { kind: 'list', items: [] } };

    expect(serializeBoard(b)).toContain('(type datamatrix)');
  });
});

describe('round-tripping', () => {
  it('leaves an untouched board byte-identical', () => {
    const src = parse(`(kicad_pcb (version 20241229) (generator "${GENERATOR}")
    (layers (0 "F.Cu" signal))
    (net 0 "")
    (barcode (at 20 30 45) (layer "F.SilkS") (size 8 8) (text "ZIRO-1") (text_height 1.5)
      (type qr) (ecc_level M) (hide no) (knockout yes) (margins 2 3)
      (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
  )`);

    expect(serializeBoard(readBoard(src))).toBe(serialize(src));
  });

  it('keeps a footprint’s barcode where the file put it', () => {
    const src = parse(`(kicad_pcb (version 20241229) (generator "${GENERATOR}")
    (layers (0 "F.Cu" signal))
    (net 0 "")
    (footprint "L:B" (layer "F.Cu") (at 100 50 90)
      (barcode (at 1 2 0) (layer "F.SilkS") (size 5 5) (text "AB") (text_height 1)
        (type code39) (hide no) (knockout no)
        (uuid "bbbbbbbb-0000-0000-0000-000000000002")))
  )`);

    expect(serializeBoard(readBoard(src))).toBe(serialize(src));
  });
});
