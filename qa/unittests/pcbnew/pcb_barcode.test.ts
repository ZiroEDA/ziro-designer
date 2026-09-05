// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_BARCODE` as a board item: geometry, hit testing, the transforms, and
 * what its properties dialog decides.
 *
 * The encoder is checked elsewhere, against Zint itself
 * (`zint_encode.test.ts`). This file is about everything KiCad wraps around it
 * — `AssembleBarcode` and the four steps it runs (`pcb_barcode.cpp:324-380`),
 * and the item plumbing that makes a barcode selectable, movable and lockable
 * like anything else on the board.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  barcodeGeometry,
  barcodeHullBoxes,
  symbolRects,
} from '@ziroeda/pcbnew/src/barcode_geometry.js';
import {
  addBoardBarcode,
  boardHitCandidates,
  boardItemBBox,
  deleteBoardItems,
  duplicateBoardItems,
  flipBoardItems,
  isBoardItemLocked,
  moveBoardItems,
  rotateBoardItemsBy,
  setBoardItemsLocked,
} from '@ziroeda/pcbnew/src/edit-board.js';
import {
  barcodeAt,
  barcodeCommitError,
  barcodeUiState,
  barcodeValues,
  correctEccForKind,
} from '@ziroeda/pcbnew/src/barcode_properties.js';
import { encodeBarcode } from '@ziroeda/pcbnew/src/barcode/zint.js';
import { bestSnapAnchor } from '@ziroeda/pcbnew/src/pcb_cursor_snap.js';
import { boardEditHandles, dragBoardHandle } from '@ziroeda/pcbnew/src/point_editor.js';
import { pcbBarcodeMsgPanelInfo } from '@ziroeda/pcbnew/src/msg_panel.js';
import { pcbPropertiesFor } from '@ziroeda/pcbnew/src/properties_panel.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { Board, PcbBarcode } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);

const bc = (over: Partial<PcbBarcode> = {}): PcbBarcode => ({
  at: { x: MM(10), y: MM(20) },
  angle: 0,
  layer: 'Dwgs.User',
  width: MM(8),
  height: MM(8),
  text: 'ZIRO',
  textHeight: MM(1.27),
  kind: 'qr',
  ecc: 'L',
  showText: false,
  knockout: false,
  margin: { x: 0, y: 0 },
  source: { kind: 'list', items: [] },
  ...over,
});

const BOARD = `(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Dwgs.User" user)
          (37 "F.SilkS" user "F.Silkscreen") (38 "B.SilkS" user "B.Silkscreen"))
  (net 0 "")
  (barcode (at 10 20 0) (layer "Dwgs.User") (size 8 8) (text "ZIRO")
    (text_height 1.27) (type qr) (ecc_level L) (hide yes) (knockout no)
    (uuid "aaaaaaaa-0000-0000-0000-000000000001"))
)`;

const read = (src = BOARD): Board => readBoard(parse(src));

const box = (b: PcbBarcode): { w: number; h: number; cx: number; cy: number } => {
  const g = barcodeGeometry(b);
  return {
    w: g.bbox.x2 - g.bbox.x1,
    h: g.bbox.y2 - g.bbox.y1,
    cx: (g.bbox.x1 + g.bbox.x2) / 2,
    cy: (g.bbox.y1 + g.bbox.y2) / 2,
  };
};

describe('the encoder’s units never reach the board', () => {
  it('fills exactly the size the item asks for', () => {
    // `SetRect` scales the symbol polygon so its bounding box IS the item's
    // width and height (`pcb_barcode.cpp:592-625`). That is what makes Zint's
    // own scale — two units per module — irrelevant, and it is also why the
    // same text at two sizes is the same symbol at two scales rather than two
    // different symbols.
    expect(box(bc())).toMatchObject({ w: MM(8), h: MM(8), cx: MM(10), cy: MM(20) });
    expect(box(bc({ width: MM(25), height: MM(3) }))).toMatchObject({ w: MM(25), h: MM(3) });
  });

  it('stretches a linear barcode over the whole height, one row and all', () => {
    // Code 39 is a single row of full-height bars: `row_height` is left at
    // zero and the output stage shares `symbol->height` among the rows that
    // have none (`output.c:842-843`). Getting that wrong gives a zero-height
    // symbol and nothing at all is drawn — which is exactly what happened
    // first, because our `rowHeight` array is EMPTY rather than zero-filled.
    const g = barcodeGeometry(bc({ kind: 'code39', width: MM(20), height: MM(5) }));

    expect(g.poly.length).toBeGreaterThan(0);
    expect(box(bc({ kind: 'code39', width: MM(20), height: MM(5) }))).toMatchObject({
      w: MM(20),
      h: MM(5),
    });
  });

  it('draws one rectangle per horizontal run, not one per module', () => {
    // Zint's vector stage merges adjacent set modules (`vector.c:622-624`), so
    // a symbol with long runs has fewer rectangles than dark modules. A
    // per-module version would fill identically; this pins that we take the
    // rectangles rather than re-deriving them.
    const { symbol } = encodeBarcode('code39', 'L', 'ZIRO');
    const rects = symbolRects(symbol!);
    let darkModules = 0;
    for (let i = 0; i < symbol!.width; i++) if (symbol!.encoded[0]?.[i]) darkModules++;

    expect(rects.length).toBeGreaterThan(0);
    expect(rects.length).toBeLessThan(darkModules);
  });
});

describe('the human-readable line', () => {
  it('adds height below the symbol when shown, and none when hidden', () => {
    // `ComputeTextPoly` puts it under the symbol with a 1 mm gap
    // (`pcb_barcode.cpp:398-401`), and `AssembleBarcode` unions it into
    // `m_poly` — so it is inside the bounding box and inside the knockout.
    const hidden = box(bc({ showText: false }));
    const shown = box(bc({ showText: true }));

    expect(hidden.h).toBe(MM(8));
    expect(shown.h).toBeGreaterThan(hidden.h);
    // …and nothing is added above the symbol: the whole growth is below.
    expect(barcodeGeometry(bc({ showText: true })).bbox.y1).toBe(
      barcodeGeometry(bc({ showText: false })).bbox.y1,
    );
  });

  it('sits exactly 1 mm below the symbol, not flush against it', () => {
    // `textPos.y = symbolBBox.GetBottom() - textBBox.GetTop() + textOffset`
    // with `textOffset = pcbIUScale.mmToIU( 1 )` (`pcb_barcode.cpp:398-401`).
    //
    // Measuring the total height cannot see this: the glyphs are ~1.3 mm tall
    // on their own, so a barcode with no gap at all is still taller than one
    // with the text hidden. The gap has to be measured directly.
    const g = barcodeGeometry(bc({ showText: true }));
    const symbolBottom = barcodeGeometry(bc({ showText: false })).bbox.y2;
    const textTop = Math.min(...g.textPoly.flat(2).map((p) => p.y));

    expect(textTop - symbolBottom).toBe(MM(1));
  });

  it('is centred on the symbol', () => {
    const g = barcodeGeometry(bc({ showText: true, text: 'W' }));
    const sym = barcodeGeometry(bc({ showText: false, text: 'W' }));
    const mid = (b: { x1: number; x2: number }): number => (b.x1 + b.x2) / 2;

    expect(Math.abs(mid(g.bbox) - mid(sym.bbox))).toBeLessThan(MM(0.01));
  });

  it('contributes nothing when the barcode has no text at all', () => {
    // Empty text encodes nothing (`ComputeBarcode` returns early), so there is
    // no symbol to hang a line under either.
    expect(barcodeGeometry(bc({ text: '', showText: true })).poly).toHaveLength(0);
  });
});

describe('knockout', () => {
  const solid = bc();
  const knocked = bc({ knockout: true });

  it('inflates the box by at least 10% of the smaller side', () => {
    // "Enforce minimum margin: at least 10% of the smallest side of the
    // barcode, rounded up to the nearest 0.1 mm" (`pcb_barcode.cpp:409-414`).
    // 10% of 8 mm is 0.8 mm on each side, so the box grows by 1.6 mm.
    expect(box(knocked).w).toBe(box(solid).w + MM(1.6));
    expect(box(knocked).h).toBe(box(solid).h + MM(1.6));
  });

  it('treats `(margins …)` as a floor on that, not as the value', () => {
    // `std::max( m_margin.x, tenPercentRounded )`: a margin smaller than the
    // 10% minimum is ignored, a larger one wins.
    expect(box(bc({ knockout: true, margin: { x: MM(0.5), y: MM(0.5) } })).w).toBe(box(knocked).w);
    expect(box(bc({ knockout: true, margin: { x: MM(3), y: MM(0) } })).w).toBe(
      box(solid).w + MM(6),
    );
  });

  it('inverts the symbol: the modules become holes in a filled rectangle', () => {
    // Which is the point — a knockout barcode is milled or masked out of a
    // solid pour rather than printed onto bare board.
    const g = barcodeGeometry(knocked);
    const plain = barcodeGeometry(solid);

    expect(g.poly.length).toBeGreaterThan(0);
    // The outline now reaches the inflated corners, which the modules never do.
    expect(g.bbox.x1).toBeLessThan(plain.bbox.x1);
    expect(g.bbox.y2).toBeGreaterThan(plain.bbox.y2);
  });

  it('is off unless asked for, so `(margins …)` alone changes nothing', () => {
    expect(box(bc({ margin: { x: MM(5), y: MM(5) } }))).toEqual(box(solid));
  });
});

describe('orientation and side', () => {
  it('rotating turns the polygon about the item’s own position', () => {
    const upright = barcodeGeometry(bc({ width: MM(20), height: MM(4) }));
    const turned = barcodeGeometry(bc({ width: MM(20), height: MM(4), angle: 90 }));

    // A 20x4 box turned 90 degrees is 4x20, still centred on (10, 20).
    expect(turned.bbox.x2 - turned.bbox.x1).toBe(upright.bbox.y2 - upright.bbox.y1);
    expect(turned.bbox.y2 - turned.bbox.y1).toBe(upright.bbox.x2 - upright.bbox.x1);
    expect((turned.bbox.x1 + turned.bbox.x2) / 2).toBe(MM(10));
  });

  it('mirrors on a back layer, so it reads from that side', () => {
    // `if( IsSideSpecific() && GetBoard()->IsBackLayer( m_layer ) )
    //      m_poly.Mirror( m_pos, LEFT_RIGHT )` (`pcb_barcode.cpp:371-372`).
    // Without it a barcode on B.SilkS is a mirror image and no reader will
    // decode it from the back of the board.
    const front = barcodeGeometry(bc({ layer: 'F.SilkS' }));
    const back = barcodeGeometry(bc({ layer: 'B.SilkS' }));

    expect(front.poly).not.toEqual(back.poly);
    // The bounding box is unchanged — a mirror about the centre.
    expect(back.bbox).toEqual(front.bbox);
  });
});

describe('as a board item', () => {
  it('reads into BOARD::Drawings() and is measured by its polygon', () => {
    const b = read();

    expect(b.barcodes).toHaveLength(1);
    const bb = boardItemBBox(b, 'barcode:0')!;
    expect(bb.maxX - bb.minX).toBe(MM(8));
  });

  it('is picked up by a click anywhere in its hull, light modules included', () => {
    // `HitTest` collides against `GetBoundingHull` — two rectangles, one round
    // the symbol and one round the text — not against the modules
    // (`pcb_barcode.cpp:562-573`). Clicking a white square inside a QR code
    // has to select it; the alternative is an item most clicks miss.
    const b = read();
    const hit = (x: number, y: number): boolean =>
      boardHitCandidates(b, { x, y }, MM(0.01)).includes('barcode:0');

    expect(hit(MM(10), MM(20))).toBe(true); // the middle, which is light
    expect(hit(MM(6.2), MM(16.2))).toBe(true); // just inside a corner
    expect(hit(MM(2), MM(20))).toBe(false); // well outside
  });

  it('and its hull follows the rotation', () => {
    const wide = bc({ width: MM(20), height: MM(4), angle: 90 });
    const [hull] = barcodeHullBoxes(barcodeGeometry(wide), wide);

    expect(hull!.x2 - hull!.x1).toBe(MM(4));
    expect(hull!.y2 - hull!.y1).toBe(MM(20));
  });

  it('moves', () => {
    const after = moveBoardItems(read(), new Set(['barcode:0']), { x: MM(5), y: MM(-5) });

    expect(after.barcodes[0]!.at).toEqual({ x: MM(15), y: MM(15) });
    expect(serializeBoard(after)).toContain('(at 15 15 0)');
  });

  it('rotates, and its own orientation advances with it', () => {
    // `PCB_BARCODE::Rotate` does both: `RotatePoint( m_pos, … )` AND
    // `m_angle += aAngle` (`pcb_barcode.cpp:296-302`). Moving the position
    // without the angle would turn the symbol's *placement* while leaving the
    // symbol itself upright.
    const after = rotateBoardItemsBy(read(), new Set(['barcode:0']), 90, {
      x: MM(0),
      y: MM(0),
    });

    expect(after.barcodes[0]!.angle).toBe(90);
    expect(after.barcodes[0]!.at).toEqual({ x: MM(20), y: MM(-10) });
    expect(serializeBoard(after)).toContain('(at 20 -10 90)');
  });

  it('flips: position, angle and layer', () => {
    // `MIRROR( m_pos, aCentre, aDir )`, `m_angle += ANGLE_180` for a
    // top-bottom flip, and `SetLayer( GetBoard()->FlipLayer( GetLayer() ) )`
    // (`pcb_barcode.cpp:305-316`).
    const src = BOARD.replace('"Dwgs.User") (size', '"F.SilkS") (size');
    const after = flipBoardItems(read(src), new Set(['barcode:0']), { x: MM(0), y: MM(0) });

    expect(after.barcodes[0]!.layer).toBe('B.SilkS');
    expect(after.barcodes[0]!.angle).toBe(180);
  });

  it('locks, and unlike a point the flag reaches the file', () => {
    // `format( const PCB_BARCODE* )` writes `(locked yes)`
    // (`pcb_io_kicad_sexpr.cpp:2204-2205`) where the point formatter has no
    // such line at all — so this one has to round-trip.
    const locked = setBoardItemsLocked(read(), new Set(['barcode:0']), true);

    expect(isBoardItemLocked(locked, 'barcode:0')).toBe(true);
    expect(serializeBoard(locked)).toContain('(locked yes)');
    expect(readBoard(parse(serializeBoard(locked))).barcodes[0]!.locked).toBe(true);

    const unlocked = setBoardItemsLocked(locked, new Set(['barcode:0']), false);
    expect(serializeBoard(unlocked)).not.toContain('locked');
  });

  it('deletes and duplicates', () => {
    expect(deleteBoardItems(read(), new Set(['barcode:0'])).barcodes).toHaveLength(0);

    const { board, ids } = duplicateBoardItems(read(), new Set(['barcode:0']), {
      x: MM(1),
      y: 0,
    });
    expect(board.barcodes).toHaveLength(2);
    expect(ids).toEqual(['barcode:1']);
    expect(board.barcodes[1]!.at).toEqual({ x: MM(11), y: MM(20) });
  });

  it('is appended by the place tool with a source of its own', () => {
    const { board, id } = addBoardBarcode(read(), {
      at: { x: MM(50), y: MM(50) },
      angle: 0,
      layer: 'F.SilkS',
      width: MM(40),
      height: MM(40),
      text: 'NEW',
      textHeight: MM(1),
      kind: 'qr',
      ecc: 'L',
      showText: true,
      knockout: false,
      margin: { x: 0, y: 0 },
    });

    expect(id).toBe('barcode:1');
    expect(serializeBoard(board)).toContain('(text "NEW")');
  });
});

describe('what the properties dialog decides', () => {
  it('opens on one barcode and on nothing else', () => {
    // `EDIT_TOOL::Properties` lists `PCB_BARCODE_T` with the items whose
    // dialog it can open (`edit_tool.cpp:2785`), so Properties... over one
    // barcode has to resolve to it rather than falling through to the
    // footprint's — which is what a missing arm would do.
    const b = read();

    expect(barcodeAt(b, ['barcode:0'])).toBe(0);
    expect(barcodeAt(b, [])).toBeNull();
    expect(barcodeAt(b, ['shape:0'])).toBeNull();
    // Two of them is not one, and upstream's Properties is single-item except
    // for tracks.
    expect(barcodeAt(b, ['barcode:0', 'barcode:1'])).toBeNull();
    // An id past the end resolves to nothing rather than to a hole.
    expect(barcodeAt(b, ['barcode:9'])).toBeNull();
  });

  it('offers error correction for the two QR kinds only', () => {
    // `m_barcode->GetSelection() >= to_underlying( BARCODE_T::QR_CODE )`
    // (`dialog_barcode_properties.cpp:149`). Data Matrix has error correction
    // too — ECC 200 — but its level is fixed by the symbol size, so there is
    // nothing to choose.
    const state = (kind: PcbBarcode['kind']): boolean =>
      barcodeUiState(barcodeValues(bc({ kind }))).eccEnabled;

    expect(state('qr')).toBe(true);
    expect(state('microqr')).toBe(true);
    expect(state('code39')).toBe(false);
    expect(state('code128')).toBe(false);
    expect(state('datamatrix')).toBe(false);
  });

  it('greys level H for Micro QR, and moves the choice off it', () => {
    // `m_errorCorrection->Enable( 3, !isMicroQR )` and, if H was selected,
    // `SetSelection( 2 )` — "consistent with SetErrorCorrection" (`:158-168`).
    // Leaving H selected would commit a level Micro QR cannot carry, and the
    // encoder would refuse it on OK.
    expect(barcodeUiState(barcodeValues(bc({ kind: 'microqr' }))).eccHEnabled).toBe(false);
    expect(barcodeUiState(barcodeValues(bc({ kind: 'qr' }))).eccHEnabled).toBe(true);

    const v = correctEccForKind({ ...barcodeValues(bc({ kind: 'microqr' })), ecc: 'H' });
    expect(v.ecc).toBe('Q');
    // …and a level it CAN carry is left alone.
    expect(correctEccForKind({ ...v, ecc: 'M' }).ecc).toBe('M');
  });

  it('gates text size on Show Text and the margins on Knockout', () => {
    expect(barcodeUiState(barcodeValues(bc({ showText: false }))).textSizeEnabled).toBe(false);
    expect(barcodeUiState(barcodeValues(bc({ showText: true }))).textSizeEnabled).toBe(true);
    expect(barcodeUiState(barcodeValues(bc({ knockout: false }))).marginsEnabled).toBe(false);
    expect(barcodeUiState(barcodeValues(bc({ knockout: true }))).marginsEnabled).toBe(true);
  });

  it('refuses OK when the text will not encode, with Zint’s own message', () => {
    // `TransferDataFromWindow` (`:238-244`) shows `GetLastError()` and returns
    // false rather than committing an empty symbol.
    const b = bc();
    const bad = { ...barcodeValues(b), kind: 'code39' as const, text: 'a*b' };

    expect(barcodeCommitError(b, bad)).toContain('Invalid character at position 2');
  });

  it('but lets empty text through, which draws nothing', () => {
    // `if( !m_dummyBarcode->GetText().empty() && … )` — the emptiness check
    // comes first, so a barcode with no content is a legal item.
    expect(barcodeCommitError(bc(), { ...barcodeValues(bc()), text: '' })).toBe('');
  });
});

describe('the message panel', () => {
  it('shows PCB_BARCODE::GetMsgPanelInfo’s rows', () => {
    // `pcb_barcode.cpp:539-560`. `Barcode` carries the ENUM_MAP spelling —
    // `QR_CODE`, not the dialog's "QR Code (ISO 18004)" — and the angle goes
    // through `%g`, so it has no degree sign.
    const b = read();
    const rows = pcbBarcodeMsgPanelInfo(
      { board: b, units: 'mm', frame: 'pcb_edit' },
      b.barcodes[0]!,
    );

    expect(rows.map((r) => r.upper)).toEqual(['Barcode', 'Text', 'Layer', 'Angle', 'Text Height']);
    expect(rows[0]!.lower).toBe('QR_CODE');
    expect(rows[1]!.lower).toBe('ZIRO');
    expect(rows[3]!.lower).toBe('0');
  });

  it('shows the raw text, variable references and all', () => {
    // "Don't use GetShownText() here; we want to show the user the variable
    // references" (`:548`) — the opposite of what most items do, and the
    // reason is that a barcode's content is often generated.
    const src = BOARD.replace('(text "ZIRO")', '(text "${REFERENCE}")');
    const b = read(src);
    const rows = pcbBarcodeMsgPanelInfo(
      { board: b, units: 'mm', frame: 'pcb_edit' },
      b.barcodes[0]!,
    );

    expect(rows[1]!.lower).toBe('${REFERENCE}');
  });

  it('adds Status only in the board editor, and only when locked', () => {
    const b = setBoardItemsLocked(read(), new Set(['barcode:0']), true);
    const inPcb = pcbBarcodeMsgPanelInfo(
      { board: b, units: 'mm', frame: 'pcb_edit' },
      b.barcodes[0]!,
    );
    const inFp = pcbBarcodeMsgPanelInfo(
      { board: b, units: 'mm', frame: 'footprint_edit' },
      b.barcodes[0]!,
    );

    expect(inPcb.map((r) => r.upper)).toContain('Status');
    expect(inFp.map((r) => r.upper)).not.toContain('Status');
    expect(
      pcbBarcodeMsgPanelInfo(
        { board: read(), units: 'mm', frame: 'pcb_edit' },
        read().barcodes[0]!,
      ).map((r) => r.upper),
    ).not.toContain('Status');
  });
});

describe('the Properties panel', () => {
  const ctx = { layerColor: () => 'rgb(0, 0, 0)', units: 'mm' as const };
  const rows = (b = read()): ReturnType<typeof pcbPropertiesFor> =>
    pcbPropertiesFor(b, ['barcode:0'], ctx);

  it('offers BOARD_ITEM’s four rows and then the barcode group', () => {
    // `InheritsAfter( PCB_BARCODE, BOARD_ITEM )` (`pcb_barcode.cpp:896`).
    expect(rows().map((r) => r.name)).toEqual([
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
    const b = read(BOARD.replace('(type qr)', '(type datamatrix)'));

    expect(rows(b).map((r) => r.name)).not.toContain('Error Correction');
  });

  it('offers H to a QR code and not to a Micro QR', () => {
    // `SetChoicesFunc`: "Only QR_CODE has High" (`:974-976`).
    const eccOptions = (b: Board): readonly string[] =>
      rows(b).find((r) => r.name === 'Error Correction')!.choices!;

    expect(eccOptions(read())).toEqual(['L (Low)', 'M (Medium)', 'Q (Quartile)', 'H (High)']);
    expect(eccOptions(read(BOARD.replace('(type qr)', '(type microqr)')))).toEqual([
      'L (Low)',
      'M (Medium)',
      'Q (Quartile)',
    ]);
  });

  it('shows the two margins only when Knockout is on', () => {
    // `SetAvailableFunc( hasKnockout )`.
    expect(rows().map((r) => r.name)).not.toContain('Margin X');

    const knocked = read(BOARD.replace('(knockout no)', '(knockout yes)'));
    expect(rows(knocked).map((r) => r.name)).toContain('Margin X');
    expect(rows(knocked).map((r) => r.name)).toContain('Margin Y');
  });

  it('writes an edit back through the source node, keeping the uuid', () => {
    // The panel patches child by child rather than rebuilding, so the tokens
    // it does not own survive.
    const row = rows().find((r) => r.name === 'Text')!;
    const after = row.set!('CHANGED')!;

    expect(after.barcodes[0]!.text).toBe('CHANGED');
    expect(serializeBoard(after)).toContain('(text "CHANGED")');
    expect(serializeBoard(after)).toContain('aaaaaaaa-0000-0000-0000-000000000001');
  });

  it('drops `(ecc_level …)` when the kind stops being a QR code', () => {
    // The writer emits it for QR and Micro QR only, so a barcode changed to
    // Code 39 must lose the token rather than carry a stale one.
    const row = rows().find((r) => r.name === 'Barcode Type')!;
    const after = row.set!('CODE_39')!;

    expect(after.barcodes[0]!.kind).toBe('code39');
    expect(serializeBoard(after)).toContain('(type code39)');
    expect(serializeBoard(after)).not.toContain('ecc_level');
  });

  it('moves off H when the kind becomes Micro QR', () => {
    // The same correction the dialog makes, because the property grid is the
    // other way in and `SetBarcodeKind` re-encodes immediately.
    const b = read(BOARD.replace('(ecc_level L)', '(ecc_level H)'));
    const row = rows(b).find((r) => r.name === 'Barcode Type')!;
    const after = row.set!('MICRO_QR_CODE')!;

    expect(after.barcodes[0]!.ecc).toBe('Q');
  });
});

describe('as a snap anchor', () => {
  // `computeAnchors`, `case PCB_BARCODE_T` (`pcb_grid_helper.cpp:1915-1928`):
  // the item's own position as a centre anchor, then `addRectPoints` over the
  // SYMBOL polygon's bounding box — nine more, the corners, the edge midpoints
  // and the box centre.
  //
  // The grid is disabled so `bestSnapAnchor`'s fallback is the raw cursor,
  // which is what makes "the barcode pulled it" distinguishable from "nothing
  // did" — with a grid on, both answers could round to the same node.
  const grid = { size: MM(1), origin: { x: 0, y: 0 }, enableGrid: false, enableSnap: true };
  const snapOpts = { snapScale: MM(1), visibleGrid: MM(100), layer: 'Dwgs.User' };
  const near = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x + MM(0.2),
    y: p.y + MM(0.2),
  });

  it('pulls the cursor onto a corner of the symbol box', () => {
    const b = read();
    // 8 mm square centred on (10, 20), so the top-left corner is (6, 16).
    const corner = { x: MM(6), y: MM(16) };

    expect(bestSnapAnchor(b, near(corner), grid, snapOpts)).toEqual(corner);
  });

  it('and onto the middle of an edge', () => {
    const b = read();
    const edge = { x: MM(10), y: MM(16) };

    expect(bestSnapAnchor(b, near(edge), grid, snapOpts)).toEqual(edge);
  });

  it('offers nothing once the Selection Filter’s Other items box is cleared', () => {
    // `if( aFrom && aSelectionFilter && !aSelectionFilter->otherItems ) break;`
    // — and it is `otherItems`, not `graphics`, because that is the category a
    // barcode falls in (`pcb_selection_tool.cpp:3522`).
    const b = read();
    const p = near({ x: MM(6), y: MM(16) });

    expect(bestSnapAnchor(b, p, grid, { ...snapOpts, otherItems: false })).toEqual(p);
  });

  it('is not offered from a layer the caller is not on', () => {
    const b = read();
    const p = near({ x: MM(6), y: MM(16) });

    expect(bestSnapAnchor(b, p, grid, { ...snapOpts, layer: 'B.Cu' })).toEqual(p);
  });

  it('measures the SYMBOL box, so the text is outside it', () => {
    // `barcode->GetSymbolPoly().BBox()`, not `m_poly`'s: the human-readable
    // line and any knockout margin are not part of the snap box.
    const withText = read(BOARD.replace('(hide yes)', '(hide no)'));
    const corner = { x: MM(6), y: MM(24) }; // the symbol's bottom-left

    expect(bestSnapAnchor(withText, near(corner), grid, snapOpts)).toEqual(corner);
  });
});

describe('the point editor', () => {
  // `BARCODE_POINT_EDIT_BEHAVIOR` (`pcb_point_editor.cpp:680-748`): the
  // barcode is edited as the rectangle `makeDummyRect()` builds from its
  // centre and size, so the handles are `RECTANGLE_POINT_EDIT_BEHAVIOR`'s.
  const handles = (b: Board = read()): ReturnType<typeof boardEditHandles> =>
    boardEditHandles(b, 'barcode:0');

  it('offers the rectangle’s nine handles', () => {
    expect(handles()).toHaveLength(9);
  });

  it('offers none at a non-cardinal angle', () => {
    // "Non-cardinal barcode point-editing isn't useful enough to support"
    // (`:698-702`) — and `UpdatePoints` returns false for it too, so the
    // handles do not merely misbehave, they are not drawn.
    expect(handles(read(BOARD.replace('(at 10 20 0)', '(at 10 20 30)')))).toHaveLength(0);
    // A quarter turn IS cardinal.
    expect(handles(read(BOARD.replace('(at 10 20 0)', '(at 10 20 90)')))).toHaveLength(9);
  });

  it('resizes when a corner is dragged, and stays square for a QR code', () => {
    // `KeepSquare()` is QR, Micro QR and Data Matrix (`pcb_barcode.h:1069`),
    // held square by 45-degree constraints on both diagonals. A QR code
    // dragged into a rectangle still encodes and does not scan.
    const b = read();
    const corner = handles(b).find((h) => h.kind === 'point' && h.index === 0)!;
    const after = dragBoardHandle(b, 'barcode:0', corner, { x: MM(2), y: MM(16) });
    const bc = after.barcodes[0]!;

    expect(bc.width).toBe(bc.height);
    expect(bc.width).toBe(MM(12));
  });

  it('and takes the dragged size as-is for one that is not square', () => {
    const b = read(BOARD.replace('(type qr)', '(type code128)'));
    const corner = handles(b).find((h) => h.kind === 'point' && h.index === 0)!;
    const after = dragBoardHandle(b, 'barcode:0', corner, { x: MM(2), y: MM(16) });

    expect(after.barcodes[0]!.width).toBe(MM(12));
    expect(after.barcodes[0]!.height).toBe(MM(8));
  });

  it('the centre handle moves it rather than resizing it', () => {
    const b = read();
    const centre = handles(b).find((h) => h.kind === 'point' && h.index === 4)!;
    const after = dragBoardHandle(b, 'barcode:0', centre, { x: MM(30), y: MM(40) });

    expect(after.barcodes[0]!.at).toEqual({ x: MM(30), y: MM(40) });
    expect(after.barcodes[0]!.width).toBe(MM(8));
  });
});
