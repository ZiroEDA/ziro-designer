// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What decides the order of GerbView's layers manager.
 *
 * Two sorts, in `gerbview/gerber_file_image_list.cpp`, and neither existed
 * here: the layers sat in load order and both context-menu entries were greyed
 * out. So this pins the comparators AND the four places upstream applies one,
 * because a correct comparator nothing calls is the same bug.
 */
import { describe, expect, it } from 'vitest';
import {
  GERBER_ORDER,
  compareByFileExtension,
  compareByZOrder,
  gerberLayerFromFilename,
  zOrderOf,
} from '@ziroeda/gerbview';

const sortNames = (names: string[]): string[] => names.slice().sort(compareByFileExtension);

describe('GetGerberLayerFromFilename', () => {
  it('matches the LAST n characters, uppercased, n being the mask length', () => {
    // wxString ext = filename.Right( o.m_FilenameMask.length() ).Upper();
    // — so it is not an extension in any real sense, which is how "EDGE.CUTS"
    // and "F.PASTE" can be masks at all.
    expect(gerberLayerFromFilename('board.gtl').order).toBe(GERBER_ORDER.GERBER_TOP_COPPER);
    expect(gerberLayerFromFilename('BOARD.GTL').order).toBe(GERBER_ORDER.GERBER_TOP_COPPER);
    expect(gerberLayerFromFilename('board-F.Cu.gbr').matchedExtension).toBe('.GBR');
  });

  it('returns on the FIRST match, which is why .GBR beats EDGE.CUTS', () => {
    // .GBR is the third entry and EDGE.CUTS the seventh, so a modern KiCad
    // plot's Edge_Cuts file is BOARD_OUTLINE by way of .GBR, not by its name.
    // This is the single most consequential thing about the table and the
    // reason a sorted list of .gbr files barely moves.
    const edge = gerberLayerFromFilename('kit-dev-coldfire-xilinx_5213-Edge_Cuts.gbr');
    expect(edge.matchedExtension).toBe('.GBR');
    expect(edge.order).toBe(GERBER_ORDER.GERBER_BOARD_OUTLINE);
  });

  it('reads a bare EDGE.CUTS name when there is no .gbr to match first', () => {
    // The mask is not dead — it is what a file with no extension at all hits.
    expect(gerberLayerFromFilename('board-Edge.Cuts').order).toBe(
      GERBER_ORDER.GERBER_BOARD_OUTLINE,
    );
  });

  it('needs a character for ?, even when the name is shorter than the mask', () => {
    // `filename.Right( n )` returns the WHOLE string when it is shorter than n,
    // so a two-character name is compared against a three-character mask and
    // must not match. Turning `?` into a zero-or-more glob passes every
    // ordinary case and only shows up here.
    expect(gerberLayerFromFilename('.g').order).toBe(GERBER_ORDER.GERBER_LAYER_UNKNOWN);
    expect(gerberLayerFromFilename('.g1').order).toBe(GERBER_ORDER.GERBER_INNER);
  });

  it('treats ? as exactly one character', () => {
    // ".GM?" is four long, so it wants .GM plus one more.
    expect(gerberLayerFromFilename('board.gm2').order).toBe(GERBER_ORDER.GERBER_MECHANICAL);
    // .GM1 and .GM3 are listed ABOVE the glob as board outline, so they are not
    // mechanical — an ordering detail the glob would otherwise swallow.
    expect(gerberLayerFromFilename('board.gm1').order).toBe(GERBER_ORDER.GERBER_BOARD_OUTLINE);
    expect(gerberLayerFromFilename('board.gm3').order).toBe(GERBER_ORDER.GERBER_BOARD_OUTLINE);
  });

  it('keeps the inner-copper globs last so they cannot eat a named layer', () => {
    // ".G?" would match .GTL, .GBL, .GKO and every other three-character
    // gerber extension if it came first; upstream's comment says exactly that.
    expect(gerberLayerFromFilename('board.gko').order).toBe(GERBER_ORDER.GERBER_KEEP_OUT);
    expect(gerberLayerFromFilename('board.gbl').order).toBe(GERBER_ORDER.GERBER_BOTTOM_COPPER);
    expect(gerberLayerFromFilename('board.g2').order).toBe(GERBER_ORDER.GERBER_INNER);
  });

  it('ignores an Eagle .GPI outright', () => {
    expect(gerberLayerFromFilename('board.gpi').order).toBe(GERBER_ORDER.GERBER_LAYER_UNKNOWN);
  });

  it('calls anything unrecognised UNKNOWN, which sorts last', () => {
    expect(gerberLayerFromFilename('notes.pdf').order).toBe(GERBER_ORDER.GERBER_LAYER_UNKNOWN);
    expect(GERBER_ORDER.GERBER_LAYER_UNKNOWN).toBe(13);
  });
});

describe('sort by file extension', () => {
  it('puts drill files first, which is the enum order', () => {
    // GERBER_DRILL is 0 and the comparison is `(int) ref < (int) test`.
    expect(sortNames(['top.gtl', 'board.drl', 'bottom.gbl'])).toStrictEqual([
      'board.drl',
      'top.gtl',
      'bottom.gbl',
    ]);
  });

  it('lays a classic extension set out top-down through the stack', () => {
    expect(
      sortNames([
        'b.gbp',
        'b.gbo',
        'b.gbs',
        'b.gbl',
        'in.g1',
        't.gtl',
        't.gts',
        't.gto',
        't.gtp',
        'o.gko',
        'd.drl',
      ]),
    ).toStrictEqual([
      'd.drl',
      'o.gko',
      't.gtp',
      't.gto',
      't.gts',
      't.gtl',
      'in.g1',
      'b.gbl',
      'b.gbs',
      'b.gbo',
      'b.gbp',
    ]);
  });

  it('orders two inner layers by the digits of the matched mask, not the enum', () => {
    // Both are GERBER_INNER, so the enum comparison would call them equal;
    // upstream blanks every non-digit and compares the numbers, which is what
    // keeps .G2 above .G10.
    expect(sortNames(['a.g10', 'a.g2', 'a.g1'])).toStrictEqual(['a.g1', 'a.g2', 'a.g10']);
  });

  it('leaves a modern KiCad plot almost untouched, because every .gbr ties', () => {
    // The finding, and the reason a live GerbView showed the drill file first
    // and the rest in load order: .GBR maps to BOARD_OUTLINE, so only the
    // drill files sort away from the pack.
    const plot = [
      'brd-F_Cu.gbr',
      'brd-B_Cu.gbr',
      'brd-F_Mask.gbr',
      'brd-PTH.drl',
      'brd-Edge_Cuts.gbr',
    ];
    expect(sortNames(plot)).toStrictEqual([
      'brd-PTH.drl',
      'brd-F_Cu.gbr',
      'brd-B_Cu.gbr',
      'brd-F_Mask.gbr',
      'brd-Edge_Cuts.gbr',
    ]);
  });
});

describe('set_Z_Order', () => {
  it('gives everything that is not part of the stack 100', () => {
    // Profile, Other, OtherDrawing, AssemblyDrawing and the drill files all
    // keep the default and so sit ABOVE the board stack.
    for (const ff of [
      'Profile,NP',
      'Other,User',
      'OtherDrawing,Comment',
      'AssemblyDrawing,Top',
      'Plated,1,4,PTH,Drill',
    ]) {
      expect(zOrderOf(ff), ff).toStrictEqual({ z: 100, zSub: 0 });
    }
  });

  it('gives copper 0 and negates its layer number', () => {
    // "the priority is the layer Id" — negated so that L1 outranks L2 under
    // the descending comparison.
    expect(zOrderOf('Copper,L1,Top')).toStrictEqual({ z: 0, zSub: -1 });
    expect(zOrderOf('Copper,L4,Bot')).toStrictEqual({ z: 0, zSub: -4 });
  });

  it('mirrors the four paired types around zero', () => {
    expect(zOrderOf('Soldermask,Top')).toStrictEqual({ z: 1, zSub: 0 });
    expect(zOrderOf('Soldermask,Bot')).toStrictEqual({ z: -1, zSub: 0 });
    expect(zOrderOf('Legend,Top')).toStrictEqual({ z: 2, zSub: 0 });
    expect(zOrderOf('Legend,Bot')).toStrictEqual({ z: -2, zSub: 0 });
    expect(zOrderOf('Paste,Top')).toStrictEqual({ z: 3, zSub: 0 });
    expect(zOrderOf('Paste,Bot')).toStrictEqual({ z: -3, zSub: 0 });
    expect(zOrderOf('Glue,Top')).toStrictEqual({ z: 4, zSub: 0 });
    expect(zOrderOf('Glue,Bot')).toStrictEqual({ z: -4, zSub: 0 });
  });

  it('compares the type case-insensitively, as IsSameAs( ..., false ) does', () => {
    expect(zOrderOf('copper,L1,Top')).toStrictEqual({ z: 0, zSub: -1 });
    expect(zOrderOf('SOLDERMASK,BOT')).toStrictEqual({ z: -1, zSub: 0 });
  });

  it('has no z order at all without a file function', () => {
    expect(zOrderOf(null)).toBeNull();
  });
});

describe('sort by X2 attributes', () => {
  const byZ = (fns: (string | null)[]): (string | null)[] => fns.slice().sort(compareByZOrder);

  it('runs the stack from glue down to glue, descending', () => {
    expect(
      byZ([
        'Glue,Bot',
        'Paste,Bot',
        'Legend,Bot',
        'Soldermask,Bot',
        'Copper,L2,Inr',
        'Copper,L1,Top',
        'Soldermask,Top',
        'Legend,Top',
        'Paste,Top',
        'Glue,Top',
        'Profile,NP',
      ]),
    ).toStrictEqual([
      'Profile,NP',
      'Glue,Top',
      'Paste,Top',
      'Legend,Top',
      'Soldermask,Top',
      'Copper,L1,Top',
      'Copper,L2,Inr',
      'Soldermask,Bot',
      'Legend,Bot',
      'Paste,Bot',
      'Glue,Bot',
    ]);
  });

  it('sinks an image with no file function below one that has one', () => {
    // `if( !ref->m_FileFunction ) return false;` / `if( !test... ) return true;`
    expect(compareByZOrder(null, 'Copper,L1,Top')).toBeGreaterThan(0);
    expect(compareByZOrder('Copper,L1,Top', null)).toBeLessThan(0);
  });

  it('leaves two functionless images alone', () => {
    // "do not change order: no criteria to sort items"
    expect(compareByZOrder(null, null)).toBe(0);
  });
});
