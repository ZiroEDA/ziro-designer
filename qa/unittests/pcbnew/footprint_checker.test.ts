// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Checker: DIALOG_FOOTPRINT_CHECKER::runChecks and the
 * FOOTPRINT::Check* / PAD::CheckPad family behind it.
 *
 * Two things are under test that are easy to lose. The first is the *order* the
 * seven checks emit in, which the dialog's tree shows verbatim. The second is a
 * handful of upstream asymmetries and dead branches that a sensible
 * re-implementation would quietly repair — a footprint checked by KiCad and by
 * us has to disagree about nothing, including the parts that look like bugs.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  checkFootprint,
  checkPad,
  getNetTiePads,
  isNetTie,
  mapPadNumbersToNetTieGroups,
} from '@ziroeda/pcbnew/src/footprint_checker.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { parse } from '@ziroeda/sexpr/src/index.js';
import type { PcbFootprint, PcbPad, PcbShape } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const EMPTY = { kind: 'list' as const, items: [] };

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'rect',
  at: { x: 0, y: 0 },
  angle: 0,
  size: { x: MM(1), y: MM(1) },
  layers: ['F.Cu'],
  source: EMPTY,
  ...over,
});

const line = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  layer: string,
  width = MM(0.1),
): PcbShape => ({ kind: 'line', start: a, end: b, layer, width, fill: false, source: EMPTY });

const fp = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:FP',
  reference: 'U1',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  // Almost every fixture wants to talk about something other than courtyards,
  // and a footprint with no courtyard graphics reports one every single time.
  attributes: ['allow_missing_courtyard'],
  pads: [],
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
  ...over,
});

const codes = (f: PcbFootprint): string[] => checkFootprint(f).map((v) => v.code);
const details = (p: PcbPad, forProps = false): string[] =>
  checkPad(p, forProps).map((f) => f.detail);

describe('courtyard markers', () => {
  it('reports a malformed courtyard AND a missing one for the same graphics', () => {
    // Upstream's missing test asks OutlineCount() == 0, and a conversion that
    // failed leaves zero outlines behind — so the two markers are not
    // alternatives. A `!malformed` guard here would suppress a real marker.
    const f = fp({
      attributes: [],
      shapes: [line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.CrtYd')],
    });

    expect(codes(f)).toEqual(['malformed_courtyard', 'missing_courtyard']);
    expect(checkFootprint(f)[0]!.message).toBe(
      'Footprint has malformed courtyard (not a closed shape)',
    );
  });

  it('lets `allow_missing_courtyard` suppress the missing marker only', () => {
    // The attribute excuses a footprint from *having* a courtyard; it says
    // nothing about one that is drawn wrong.
    const shapes = [line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.CrtYd')];

    expect(codes(fp({ attributes: ['allow_missing_courtyard'], shapes }))).toEqual([
      'malformed_courtyard',
    ]);
    expect(codes(fp({ attributes: [], shapes: [] }))).toEqual(['missing_courtyard']);
  });

  it('accepts a closed courtyard silently', () => {
    const box = [
      line({ x: 0, y: 0 }, { x: MM(4), y: 0 }, 'F.CrtYd'),
      line({ x: MM(4), y: 0 }, { x: MM(4), y: MM(4) }, 'F.CrtYd'),
      line({ x: MM(4), y: MM(4) }, { x: 0, y: MM(4) }, 'F.CrtYd'),
      line({ x: 0, y: MM(4) }, { x: 0, y: 0 }, 'F.CrtYd'),
    ];

    expect(codes(fp({ attributes: [], shapes: box }))).toEqual([]);
  });
});

describe('footprint attribute mismatch', () => {
  it('names the expected type and the stated one', () => {
    const f = fp({
      attributes: ['smd', 'allow_missing_courtyard'],
      pads: [
        pad({
          type: 'thru_hole',
          drill: { oblong: false, w: MM(0.8), h: MM(0.8) },
          layers: ['*.Cu'],
        }),
      ],
    });

    expect(checkFootprint(f).map((v) => v.message)).toEqual([
      "Footprint component type doesn't match footprint pads (expected 'Through hole'; actual 'SMD')",
    ]);
  });

  it('reports a footprint claiming BOTH types even when the pads agree with one', () => {
    // setAttr then has two bits and can never equal a one-bit likely
    // attribute, so upstream emits the nonsense "(expected 'SMD'; actual
    // 'SMD')". A port that compared type *names* would stay silent here.
    const f = fp({
      attributes: ['smd', 'through_hole', 'allow_missing_courtyard'],
      pads: [pad({ type: 'smd' })],
    });

    expect(checkFootprint(f).map((v) => v.message)).toEqual([
      "Footprint component type doesn't match footprint pads (expected 'SMD'; actual 'SMD')",
    ]);
  });

  it('stays silent when the footprint states no type at all', () => {
    // "Unspecified" is not "wrong": only a footprint that states a type can
    // contradict itself.
    const f = fp({
      pads: [pad({ type: 'thru_hole', drill: { oblong: false, w: MM(0.8), h: MM(0.8) } })],
    });

    expect(codes(f)).not.toContain('footprint_type_mismatch');
  });
});

describe('PAD::CheckPad', () => {
  it('gates every hole rule on the pad being on copper', () => {
    // An aperture pad — paste only — with a drill runs none of the hole tests,
    // however silly the drill is. Dropping the IsOnCopperLayer() gate makes a
    // legitimate paste aperture report a padstack error.
    const aperture = pad({ layers: ['F.Paste'], drill: { oblong: false, w: 2, h: 2 } });

    expect(details(aperture)).not.toContain('(PTH pad hole size must be larger than 4 nm)');
    expect(details(aperture)).not.toContain('(pad hole not inside pad shape)');
  });

  it('rejects a PTH hole that leaves no copper', () => {
    // The drill is exactly the pad, so the annulus is empty. Upstream builds
    // the pad ERROR_INSIDE and the hole ERROR_OUTSIDE precisely so this case
    // decides cleanly rather than on tessellation phase.
    const p = pad({
      type: 'thru_hole',
      shape: 'circle',
      size: { x: MM(1), y: MM(1) },
      drill: { oblong: false, w: MM(1), h: MM(1) },
      layers: ['*.Cu'],
    });

    expect(details(p)).toContain('(PTH pad hole leaves no copper)');
  });

  it('keeps `(PTH pad hole not fully inside copper)` out of the footprint checker', () => {
    // aForPadProperties is false from the dialog: upstream leaves this to the
    // board's annular-ring provider, which handles pads sharing a name.
    const p = pad({
      type: 'thru_hole',
      shape: 'circle',
      size: { x: MM(1), y: MM(1) },
      drill: { oblong: false, w: MM(0.9), h: MM(0.9), offset: { x: MM(0.3), y: 0 } },
      layers: ['*.Cu'],
    });

    expect(details(p, false)).not.toContain('(PTH pad hole not fully inside copper)');
    expect(details(p, true)).toContain('(PTH pad hole not fully inside copper)');
  });

  it('finds a non-plated hole that has walked outside its own pad', () => {
    // GetPosition() is the *hole* centre and the copper sits at
    // GetPosition() + rotated offset, so a large offset drags the shape off
    // the hole. Ignoring the offset makes this rule unable to fire at all.
    const p = pad({
      type: 'np_thru_hole',
      shape: 'circle',
      size: { x: MM(1), y: MM(1) },
      drill: { oblong: false, w: MM(0.5), h: MM(0.5), offset: { x: MM(2), y: 0 } },
      layers: ['*.Cu'],
    });

    expect(details(p)).toContain('(pad hole not inside pad shape)');
  });

  it('gives a connector pad the SMD rules as well, through the fallthrough', () => {
    // case CONN ends in KI_FALLTHROUGH, so a `connect` pad is checked for a
    // hole and for its copper sides too. Both of the messages below come from
    // that: the first from the CONN arm, the second from the SMD arm it falls
    // into.
    const p = pad({ type: 'connect', layers: ['B.Cu', 'F.Paste'] });

    expect(details(p)).toEqual([
      '(connector pads normally have no solder paste; use a SMD pad instead)',
      '(SMD pad has copper and paste layers on different sides of the board)',
    ]);
  });

  it('reports "no outer layers" only for a pad that HAS inner copper', () => {
    // The last arm is `else if ( innerlayers_mask.count() != 0 )`. A pad with
    // no copper anywhere is a paste aperture and says nothing at all; firing
    // for it would flag every stencil-only pad on a board.
    expect(details(pad({ layers: ['In1.Cu'] }))).toContain('(SMD pad has no outer layers)');
    expect(details(pad({ layers: ['F.Paste'] }))).not.toContain('(SMD pad has no outer layers)');
  });

  it('reports a press-fit pad with no hole at all, not only an oblong one', () => {
    // HasDrilledHole() is false both for a slot and for no drill, and the rule
    // is written against that, not against "the drill is oblong".
    const noHole = pad({ type: 'thru_hole', padProperty: 'pad_prop_pressfit', layers: ['*.Cu'] });
    const slot = pad({
      type: 'thru_hole',
      padProperty: 'pad_prop_pressfit',
      layers: ['*.Cu'],
      drill: { oblong: true, w: MM(0.5), h: MM(1) },
    });
    const round = pad({
      type: 'thru_hole',
      padProperty: 'pad_prop_pressfit',
      layers: ['*.Cu'],
      size: { x: MM(2), y: MM(2) },
      drill: { oblong: false, w: MM(0.5), h: MM(0.5) },
    });

    expect(details(noHole)).toContain("('press-fit' pads are normally PTH with round holes)");
    expect(details(slot)).toContain("('press-fit' pads are normally PTH with round holes)");
    expect(details(round)).not.toContain("('press-fit' pads are normally PTH with round holes)");
  });

  it('keeps `through_hole_pad_without_hole` a code of its own', () => {
    // Not a padstack finding: it has its own DRC_ITEM, its own severity and an
    // empty detail. Folding it into `padstack` would change what the dialog
    // counts as an error.
    const p = pad({ type: 'thru_hole', layers: ['*.Cu'], drill: { oblong: false, w: 0, h: 0 } });

    expect(checkPad(p, false).map((f) => f.code)).toContain('through_hole_pad_without_hole');
    expect(checkPad(p, false).find((f) => f.code === 'through_hole_pad_without_hole')!.detail).toBe(
      '',
    );
  });

  it('separates the roundrect and chamfer severity classes', () => {
    // '(corner size will make pad circular)' is a plain padstack finding while
    // both chamfer messages are padstack_invalid. Getting the class wrong moves
    // the finding between the dialog's warning and error counts.
    const roundrect = pad({ shape: 'roundrect', roundrectRatio: 0.9 });
    const chamfered = pad({ shape: 'roundrect', chamferRatio: 0.9 });

    expect(checkPad(roundrect, false)).toEqual([
      { code: 'padstack', detail: '(corner size will make pad circular)' },
    ]);
    expect(checkPad(chamfered, false)).toEqual([
      { code: 'padstack_invalid', detail: '(corner chamfer is too large)' },
    ]);
  });

  it('treats a trapezoid delta equal to the opposing size as legal', () => {
    // The test is strictly greater-than on each of four arms.
    const legal = pad({
      shape: 'trapezoid',
      size: { x: MM(1), y: MM(2) },
      delta: { x: MM(2), y: 0 },
    });
    const tooLarge = pad({
      shape: 'trapezoid',
      size: { x: MM(1), y: MM(2) },
      delta: { x: MM(2) + 1, y: 0 },
    });

    expect(details(legal)).not.toContain('(trapezoid delta is too large)');
    expect(details(tooLarge)).toContain('(trapezoid delta is too large)');
  });

  it('ignores an absent solder-mask margin but not a stated zero-crossing one', () => {
    // The margin is three-valued: absent is "inherit", which is not zero.
    expect(details(pad({}))).not.toContain(
      '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
    );
    expect(details(pad({ localSolderMaskMargin: -MM(2) }))).toContain(
      '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
    );
    expect(details(pad({ localSolderMaskMargin: MM(2) }))).not.toContain(
      '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
    );
  });

  it('reports paste that the margin and ratio between them cancel out', () => {
    // paste = size + margin + KiROUND( size * ratio ), per axis.
    const p = pad({ localSolderPasteMargin: -MM(0.5), localSolderPasteMarginRatio: -0.5 });

    expect(details(p)).toContain(
      '(negative solder paste margin is larger than pad; no solder paste mask will be generated)',
    );
  });
});

describe('CheckShortingPads', () => {
  const th = (number: string, x: number, drill: number, over: Partial<PcbPad> = {}): PcbPad =>
    pad({
      number,
      type: 'thru_hole',
      shape: 'circle',
      at: { x, y: 0 },
      size: { x: MM(2), y: MM(2) },
      drill: { oblong: false, w: drill, h: drill },
      layers: ['*.Cu'],
      ...over,
    });

  it('reports co-located holes and never also reports them as too close', () => {
    // Exact integer equality of the two pad positions, and an `else` against
    // the too-close test.
    const f = fp({ pads: [th('1', 0, MM(0.5)), th('2', 0, MM(0.5))] });
    const found = checkFootprint(f).filter((v) => v.code.startsWith('hole'));

    expect(found.map((v) => v.code)).toEqual(['holes_co_located']);
  });

  it('measures hole-to-hole with the FIRST pad’s width alone', () => {
    // SHAPE_SEGMENT::Collide( SEG, 0 ) uses min_dist = ( widthA + 1 ) / 2 and
    // treats B as a zero-width axis: B's own radius is never added. A 2 mm
    // drill at the origin therefore reaches 1 mm, not 1 mm + B's radius.
    const near = fp({ pads: [th('1', 0, MM(2)), th('2', MM(0.9), MM(2))] });
    const far = fp({ pads: [th('1', 0, MM(2)), th('2', MM(1.1), MM(2))] });

    expect(checkFootprint(near).map((v) => v.code)).toContain('hole_to_hole');
    expect(checkFootprint(far).map((v) => v.code)).not.toContain('hole_to_hole');
  });

  it('treats a separation of exactly min_dist as clear', () => {
    // `dist_sq == 0 || dist_sq < min_dist * min_dist` — strictly less-than, so
    // holes exactly ( width + 1 ) / 2 apart are legal. A `<=` here would report
    // every pair of 2 mm drills on a 1 mm pitch.
    const exact = fp({ pads: [th('1', 0, MM(2)), th('2', MM(1), MM(2))] });
    const inside = fp({ pads: [th('1', 0, MM(2)), th('2', MM(1) - 1, MM(2))] });

    expect(checkFootprint(exact).map((v) => v.code)).not.toContain('hole_to_hole');
    expect(checkFootprint(inside).map((v) => v.code)).toContain('hole_to_hole');
  });

  it('lets file order decide, because the test is asymmetric', () => {
    // A 2 mm drill reaches 1 mm; a 0.2 mm drill reaches 0.1 mm. At a 0.9 mm
    // separation the big-hole-first ordering collides and the reverse does not.
    const bigFirst = fp({ pads: [th('1', 0, MM(2)), th('2', MM(0.9), MM(0.2))] });
    const smallFirst = fp({ pads: [th('1', 0, MM(0.2)), th('2', MM(0.9), MM(2))] });

    expect(checkFootprint(bigFirst).map((v) => v.code)).toContain('hole_to_hole');
    expect(checkFootprint(smallFirst).map((v) => v.code)).not.toContain('hole_to_hole');
  });

  it('exempts slots from both hole rules', () => {
    // HasDrilledHole() means a hole that is round; an oblong drill is silently
    // out of scope for co-located and too-close alike.
    const slot = (number: string, x: number): PcbPad =>
      th(number, x, MM(0.5), { drill: { oblong: true, w: MM(0.5), h: MM(1) } });
    const f = fp({ pads: [slot('1', 0), slot('2', 0)] });

    expect(checkFootprint(f).map((v) => v.code)).not.toContain('holes_co_located');
    expect(checkFootprint(f).map((v) => v.code)).not.toContain('hole_to_hole');
  });

  it('exempts pads sharing a number from shorting but NOT from the hole rules', () => {
    // Two pads with the same number are one logical pad from before custom
    // shapes existed. The `continue` that grants them that sits *after* the
    // hole block, so their drills are still checked.
    const f = fp({ pads: [th('1', 0, MM(0.5)), th('1', 0, MM(0.5))] });
    const found = checkFootprint(f).map((v) => v.code);

    expect(found).toContain('holes_co_located');
    expect(found).not.toContain('shorting_items');
  });

  it('shorts two overlapping pads that both have empty numbers', () => {
    // SameLogicalPadAs requires a NON-empty number, so unnumbered pads are not
    // the same logical pad and their overlap is a real short.
    const f = fp({
      pads: [
        pad({ number: '', at: { x: 0, y: 0 } }),
        pad({ number: '', at: { x: MM(0.5), y: 0 } }),
      ],
    });

    expect(checkFootprint(f).map((v) => v.code)).toContain('shorting_items');
  });

  it('requires a shared copper layer', () => {
    const f = fp({
      pads: [
        pad({ number: '1', layers: ['F.Cu'] }),
        pad({ number: '2', layers: ['B.Cu'], at: { x: MM(0.5), y: 0 } }),
      ],
    });

    expect(checkFootprint(f).map((v) => v.code)).not.toContain('shorting_items');
  });

  it('reports an overlapping pair exactly once', () => {
    // Both padstacks are NORMAL, so RelevantShapeLayers is a single pseudo-
    // layer and the pair cannot be double-reported.
    const f = fp({
      pads: [
        pad({ number: '1', at: { x: 0, y: 0 } }),
        pad({ number: '2', at: { x: MM(0.5), y: 0 } }),
      ],
    });

    expect(checkFootprint(f).filter((v) => v.code === 'shorting_items')).toHaveLength(1);
  });
});

describe('net-tie pad group parsing', () => {
  const groups = (netTiePadGroups: string[], numbers: string[]): Map<string, number> =>
    mapPadNumbersToNetTieGroups(
      fp({ netTiePadGroups, pads: numbers.map((number) => pad({ number })) }),
    );

  it('seeds every pad at -1 and trims the names it reads', () => {
    const map = groups([' 1 , 2 '], ['1', '2', '3']);

    expect([...map]).toEqual([
      ['1', 0],
      ['2', 0],
      ['3', -1],
    ]);
  });

  it('treats a backslash as escaping the next character', () => {
    // A pad genuinely numbered `A,1` is written `A\,1`, so the comma inside it
    // must not split the group.
    expect([...groups(['A\\,1,B'], ['A,1', 'B'])]).toEqual([
      ['A,1', 0],
      ['B', 0],
    ]);
  });

  it('keeps the tail after the last comma and drops a trailing lone backslash', () => {
    expect(groups(['1,2'], ['1', '2']).get('2')).toBe(0);
    expect([...groups(['1\\'], ['1'])]).toEqual([['1', 0]]);
  });

  it('lets the LAST group silently win when a pad is listed twice', () => {
    // The map is keyed by pad number and the write is unconditional, so there
    // is no diagnostic at all — the pad simply belongs to the higher group.
    expect(groups(['1,2', '2,3'], ['1', '2', '3']).get('2')).toBe(1);
  });

  it('keeps an entry for a group name that matches no pad', () => {
    // That entry is exactly what makes the unknown-pad-number check possible.
    expect(groups(['9'], ['1']).get('9')).toBe(0);
  });

  it('is not a net tie when every group string is empty', () => {
    expect(isNetTie(fp({ netTiePadGroups: [''] }))).toBe(false);
    expect(isNetTie(fp({ netTiePadGroups: ['1,2'] }))).toBe(true);
    expect(isNetTie(fp({}))).toBe(false);
  });

  it('returns the queried pad itself among its net-tie pads', () => {
    const pads = [pad({ number: '1' }), pad({ number: '2' }), pad({ number: '3' })];
    const f = fp({ netTiePadGroups: ['1,2'], pads });

    expect(getNetTiePads(f, pads[0]!).map((p) => p.number)).toEqual(['1', '2']);
    expect(getNetTiePads(f, pads[2]!)).toEqual([]);
  });
});

describe('CheckNetTiePadGroups', () => {
  it('reports a group naming a pad the footprint does not have', () => {
    const f = fp({ netTiePadGroups: ['1,99'], pads: [pad({ number: '1' })] });

    expect(checkFootprint(f).map((v) => v.message)).toEqual([
      'Footprint is not valid (net-tie pad group contains unknown pad number 99)',
    ]);
  });

  it('walks the pad numbers in lexicographic order, not file order', () => {
    // Upstream iterates a std::map keyed by pad number. A JS Map iterates in
    // insertion order, which here would put `b` first and `a` second.
    const f = fp({ netTiePadGroups: ['b,a'], pads: [pad({ number: '1' })] });

    expect(checkFootprint(f).map((v) => v.message)).toEqual([
      'Footprint is not valid (net-tie pad group contains unknown pad number a)',
      'Footprint is not valid (net-tie pad group contains unknown pad number b)',
    ]);
  });

  it('never reports "appears in more than one net-tie pad group"', () => {
    // The branch is unreachable upstream — the map's keys are unique by
    // construction — and a port that "fixed" it into a working duplicate
    // detector would produce violations KiCad does not.
    const f = fp({
      netTiePadGroups: ['1,2', '2,3'],
      pads: [pad({ number: '1' }), pad({ number: '2' }), pad({ number: '3' })],
    });

    expect(checkFootprint(f).map((v) => v.message)).not.toContain(
      'Footprint is not valid (pad 2 appears in more than one net-tie pad group)',
    );
  });
});

describe('CheckNetTies', () => {
  const tie = (netTiePadGroups: string[], shapes: PcbShape[]): PcbFootprint =>
    fp({
      netTiePadGroups,
      shapes,
      pads: [
        pad({ number: '1', at: { x: 0, y: 0 }, size: { x: MM(1), y: MM(1) } }),
        pad({ number: '2', at: { x: MM(3), y: 0 }, size: { x: MM(1), y: MM(1) } }),
      ],
    });

  const bridge = [line({ x: 0, y: 0 }, { x: MM(3), y: 0 }, 'F.Cu', MM(0.2))];

  it('reports two pads a copper graphic joins when they are in no common group', () => {
    const found = checkFootprint(tie(['9'], bridge)).filter((v) => v.code === 'shorting_items');

    expect(found).toHaveLength(1);
    // Three refs, the shorting graphic FIRST.
    expect(found[0]!.items.map((i) => i.desc)).toEqual([
      'Graphic on F.Cu',
      'Pad 1 of U1',
      'Pad 2 of U1',
    ]);
  });

  it('accepts the same bridge once both pads are in one group', () => {
    expect(checkFootprint(tie(['1,2'], bridge)).map((v) => v.code)).not.toContain('shorting_items');
  });

  it('never builds its outlines out of pads', () => {
    // The copper set is drawings, zones and fields — pads are only indexed
    // against it. Two pads that merely touch each other are CheckShortingPads'
    // business, and adding pads to the polygon set would report a short for
    // every touching pair here as well.
    const f = fp({
      netTiePadGroups: ['1,2'],
      pads: [
        pad({ number: '1', at: { x: 0, y: 0 } }),
        pad({ number: '2', at: { x: MM(0.5), y: 0 } }),
      ],
    });

    expect(checkFootprint(f).map((v) => v.code)).not.toContain('shorting_items');
  });

  it('never runs at all on a footprint that is not a net tie', () => {
    // IsNetTie() gates both net-tie checks, so a bridged pair with no groups
    // produces nothing from this check (the pads do not touch each other).
    expect(checkFootprint(tie([''], bridge)).map((v) => v.code)).not.toContain('shorting_items');
  });

  it('ignores copper on inner layers past In1.Cu', () => {
    // The layer list is the literal { F_Cu, In1_Cu, B_Cu }.
    const onIn2 = [line({ x: 0, y: 0 }, { x: MM(3), y: 0 }, 'In2.Cu', MM(0.2))];
    const onIn1 = [line({ x: 0, y: 0 }, { x: MM(3), y: 0 }, 'In1.Cu', MM(0.2))];

    expect(checkFootprint(tie(['9'], onIn2)).map((v) => v.code)).not.toContain('shorting_items');
    expect(checkFootprint(tie(['9'], onIn1)).map((v) => v.code)).toContain('shorting_items');
  });

  it('pairs every later pad with pads[0] rather than pairwise', () => {
    // Three ungrouped pads on one outline yield TWO violations, both naming
    // pads[0]; a pairwise port would yield three.
    const f = fp({
      netTiePadGroups: ['9'],
      shapes: [line({ x: 0, y: 0 }, { x: MM(6), y: 0 }, 'F.Cu', MM(0.2))],
      pads: [
        pad({ number: '1', at: { x: 0, y: 0 } }),
        pad({ number: '2', at: { x: MM(3), y: 0 } }),
        pad({ number: '3', at: { x: MM(6), y: 0 } }),
      ],
    });
    const found = checkFootprint(f).filter((v) => v.code === 'shorting_items');

    expect(found).toHaveLength(2);
    expect(found.map((v) => v.items.map((i) => i.desc).join('/'))).toEqual([
      'Graphic on F.Cu/Pad 1 of U1/Pad 2 of U1',
      'Graphic on F.Cu/Pad 1 of U1/Pad 3 of U1',
    ]);
  });

  it('snaps the marker onto the outline instead of leaving it at the midpoint', () => {
    // pos = the truncated midpoint of the two pad centres, then
    // SHAPE_LINE_CHAIN::NearestPoint on the outline it was found in. The
    // midpoint here is the middle of a 0.2 mm-wide trace, so the snap moves it
    // to an edge 0.1 mm away.
    const found = checkFootprint(tie(['9'], bridge)).filter((v) => v.code === 'shorting_items');

    expect(found[0]!.pos.x).toBeCloseTo(MM(1.5), -1);
    expect(Math.abs(found[0]!.pos.y)).toBeCloseTo(MM(0.1), -1);
  });
});

describe('CheckClippedSilk', () => {
  const silk = line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.SilkS');

  it('reports silk clipped by a pad’s mask opening', () => {
    const f = fp({
      shapes: [silk],
      pads: [pad({ at: { x: MM(1), y: 0 }, layers: ['F.Cu', 'F.Mask'] })],
    });
    const found = checkFootprint(f).filter((v) => v.code === 'silk_over_copper');

    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe('Silkscreen clipped by solder mask');
    expect(found[0]!.items.map((i) => i.desc)).toEqual(['Graphic on F.SilkS', 'Pad 1 of U1']);
  });

  it('uses the pad shape UNGROWN, not the shape plus its mask margin', () => {
    // GetEffectiveShape( F_Mask ) does not apply the solder-mask margin, and
    // the clearance is 0 — this is literal clipping, not the Board Setup silk
    // clearance the board-level provider resolves.
    // The silk reaches x = 0.45 mm and the pad's copper starts at x = 1.5 mm,
    // so only a mask margin applied to the pad could bring them together — and
    // the margin here is far more than enough to do it.
    const withMargin = (localSolderMaskMargin?: number): PcbFootprint =>
      fp({
        shapes: [line({ x: 0, y: 0 }, { x: MM(0.4), y: 0 }, 'F.SilkS', MM(0.1))],
        pads: [pad({ at: { x: MM(2), y: 0 }, layers: ['F.Cu', 'F.Mask'], localSolderMaskMargin })],
      });

    expect(checkFootprint(withMargin(MM(2))).map((v) => v.code)).not.toContain('silk_over_copper');
    // …and the fixture really would collide if anything grew the pad: moving
    // the copper itself that far does produce the marker.
    const moved = fp({
      shapes: [line({ x: 0, y: 0 }, { x: MM(0.4), y: 0 }, 'F.SilkS', MM(0.1))],
      pads: [pad({ at: { x: MM(0.4), y: 0 }, layers: ['F.Cu', 'F.Mask'] })],
    });

    expect(checkFootprint(moved).map((v) => v.code)).toContain('silk_over_copper');
  });

  it('never treats a pad as the silk side', () => {
    // The silk item is always a drawing; a pad on F.SilkS is only ever the mask
    // side, and with no drawing at all nothing is examined.
    const f = fp({
      pads: [
        pad({ number: '1', at: { x: 0, y: 0 }, layers: ['F.SilkS'] }),
        pad({ number: '2', at: { x: 0, y: 0 }, layers: ['F.Mask'] }),
      ],
    });

    expect(checkFootprint(f).map((v) => v.code)).not.toContain('silk_over_copper');
  });

  it('reports a mutually overlapping drawing pair twice, once per direction', () => {
    // The inner loop is a full pass, not j > i.
    const both = fp({
      shapes: [
        { ...silk, layer: 'F.SilkS' },
        { ...line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.Mask') },
      ],
    });
    // Only the first is on silk, so only one direction can fire.
    expect(checkFootprint(both).filter((v) => v.code === 'silk_over_copper')).toHaveLength(1);

    const mirrored = fp({
      shapes: [
        { ...silk, layer: 'F.SilkS' },
        { ...line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.SilkS') },
      ],
      pads: [pad({ at: { x: MM(1), y: 0 }, layers: ['F.Mask'] })],
    });
    // Both drawings are on silk and neither is on a mask, so the pad supplies
    // the mask side for each of them: two markers, not one and not four.
    expect(checkFootprint(mirrored).filter((v) => v.code === 'silk_over_copper')).toHaveLength(2);
  });
});

describe('emission order', () => {
  it('runs the seven checks in the dialog’s fixed order', () => {
    // The markers are appended to a list and the tree shows them in insertion
    // order within a severity, so this sequence is observable behaviour and not
    // an implementation detail.
    const f = fp({
      attributes: ['smd'],
      netTiePadGroups: ['99'],
      shapes: [
        line({ x: 0, y: 0 }, { x: MM(2), y: 0 }, 'F.CrtYd'),
        line({ x: 0, y: MM(5) }, { x: MM(4), y: MM(5) }, 'F.SilkS'),
      ],
      pads: [
        pad({
          number: '1',
          type: 'thru_hole',
          shape: 'circle',
          at: { x: MM(1), y: MM(5) },
          size: { x: MM(2), y: MM(2) },
          drill: { oblong: false, w: MM(0.5), h: MM(0.5) },
          layers: ['*.Cu', 'F.Mask'],
        }),
        pad({
          number: '2',
          type: 'thru_hole',
          shape: 'circle',
          at: { x: MM(1), y: MM(5) },
          size: { x: MM(2), y: MM(2) },
          drill: { oblong: false, w: MM(0.5), h: MM(0.5) },
          layers: ['*.Cu', 'F.Mask'],
        }),
      ],
    });

    expect(codes(f)).toEqual([
      'malformed_courtyard',
      'missing_courtyard',
      'footprint_type_mismatch',
      'holes_co_located',
      'shorting_items',
      'footprint',
      'silk_over_copper',
      'silk_over_copper',
    ]);
  });
});

describe('net_tie_pad_groups round trip', () => {
  it('reads every group string, including an empty one', () => {
    const board = readBoard(
      parse(
        '(kicad_pcb (version 20240108) (footprint "L:FP" (layer "F.Cu") (at 0 0)' +
          ' (net_tie_pad_groups "1,2" "") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu"))))',
      ),
    );

    expect(board.footprints[0]!.netTiePadGroups).toEqual(['1,2', '']);
  });

  it('leaves the footprint without the field when the token is absent', () => {
    // Absent must stay absent: `(net_tie_pad_groups "")` is a footprint that is
    // not a net tie, and an invented empty array would read the same way but
    // would be written back where nothing was written before.
    const board = readBoard(
      parse('(kicad_pcb (version 20240108) (footprint "L:FP" (layer "F.Cu") (at 0 0)))'),
    );

    expect(board.footprints[0]!.netTiePadGroups).toBeUndefined();
  });
});
