// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The rest of `PCB_PAINTER`'s netname layer, after #626 fixed the unescaping.
 *
 * #626 was one missing `UnescapeString`. Auditing the whole netname path
 * against `pcb_painter.cpp` afterwards turned up six more divergences, none of
 * which any test could see — which is the reason this file exists rather than a
 * line in the last one.
 *
 *  1. **Arcs carried no net name at all.** `draw( const PCB_ARC* )` puts one at
 *     the arc midpoint, turned to the tangent, gated on the arc's own length.
 *  2. **The pad number was not unescaped** — `UnescapeString( aPad->GetNumber() )`
 *     (pcb_painter.cpp:1395, and `BRDITEMS_PLOTTER::PlotPadNumber`). Same bug as
 *     #626, one line further down the same function.
 *  3. **Pad net names ignored the setting.** `m_NetNames == 1 || == 3` decides
 *     whether a pad carries one; there was no such gate, so "tracks only" still
 *     lettered every pad.
 *  4. **`x` and `*` were gated by that setting too.** `IsNoConnectPad()` and
 *     `IsFreePad()` are applied *after* it is read and regardless of it, so a
 *     no-connect pad keeps its mark with net names switched off.
 *  5. **`IsFreePad()` was tested against the unescaped name.** Upstream tests
 *     `GetShortNetname()`, the escaped one.
 *  6. **Vias used the tracks threshold.** Their gate is `m_NetNames != 0`, so
 *     "pads only" letters vias too; `>= 2` hid them.
 *  7. **A hidden partner left the survivor mis-laid-out.** The two pad strings
 *     are sized and offset *together*; when only one shows it is centred at full
 *     size. Hiding one at draw time kept the paired layout, so turning pad
 *     numbers off left the net name at 40% size, still offset below the centre.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';
import {
  buildScene,
  DEFAULT_DRAW_OPTIONS,
  showsArcNetName,
} from '@ziroeda/designer/src/editors/pcb/renderBoard.js';
import { GL_PATH_FACTORY } from '@ziroeda/designer/src/render/gl/gl_path.js';
import { printableCharCount } from '@ziroeda/common/src/string_utils.js';

const MM = 1e6;

const read = (body: string): Board =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "/uart/SDA{slash}A4")
${body}
)`),
  );

const scene = (body: string) => buildScene(read(body), {}, GL_PATH_FACTORY);

/** The one pad label's items, by which of the two strings they are. */
const padItems = (s: ReturnType<typeof scene>) => {
  const label = s.padLabels[0]!;
  return {
    label,
    net: label.items.find((i) => i.padText === 'net'),
    number: label.items.find((i) => i.padText === 'number'),
  };
};

const FP = (pad: string): string =>
  `  (footprint "R" (layer "F.Cu") (at 100 100)
     ${pad}
   )`;

describe('an arc carries its net name', () => {
  // A quarter circle of radius 10 mm about (100,100): a long arc, so the
  // length gate passes and the label is emitted.
  const arcBoard = () =>
    scene(
      '  (arc (start 110 100) (mid 107.07 107.07) (end 100 110) (width 2) (layer "F.Cu") (net 1))',
    );

  it('is placed at the arc midpoint, not the chord midpoint', () => {
    const s = arcBoard();
    expect(s.arcNetLabels).toHaveLength(1);
    const l = s.arcNetLabels[0]!;
    // The mid point the file gave, which is on the copper. The chord midpoint
    // would be (105, 105) — about 1.5 mm off the track.
    expect(l.at.x / MM).toBeCloseTo(107.07, 2);
    expect(l.at.y / MM).toBeCloseTo(107.07, 2);
  });

  it('is unescaped and short, like every other painter string', () => {
    expect(arcBoard().arcNetLabels[0]!.text).toBe('SDA/A4');
  });

  it('measures the arc, not the chord, for its length gate', () => {
    const l = arcBoard().arcNetLabels[0]!;
    // Quarter of a 10 mm-radius circle: π/2 · 10 ≈ 15.7 mm. The chord is
    // 10·√2 ≈ 14.1 mm, so a chord-based gate would be measurably meaner.
    expect(l.arcLength / MM).toBeCloseTo((Math.PI / 2) * 10, 1);
  });

  it('hides the name when the arc is too short to hold it', () => {
    // `arcLen < width · chars` — six characters of a 2 mm-wide arc need 12 mm.
    const view = { scale: 40 / MM, tx: 0, ty: 0 };
    const l = arcBoard().arcNetLabels[0]!;
    expect(showsArcNetName(l, view)).toBe(true);
    expect(showsArcNetName({ ...l, arcLength: 5 * MM }, view)).toBe(false);
  });

  it('stays hidden at a zoom where the arc is hairline', () => {
    const l = arcBoard().arcNetLabels[0]!;
    expect(showsArcNetName(l, { scale: 0.02 / MM, tx: 0, ty: 0 })).toBe(false);
  });

  it('emits nothing for an unconnected arc', () => {
    const s = scene(
      '  (arc (start 110 100) (mid 107.07 107.07) (end 100 110) (width 2) (layer "F.Cu") (net 0))',
    );
    expect(s.arcNetLabels).toHaveLength(0);
  });
});

describe('a pad number', () => {
  it('is unescaped, like the net name beside it', () => {
    const s = scene(
      FP(
        '(pad "A{slash}1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "/uart/SDA{slash}A4"))',
      ),
    );
    expect(padItems(s).number!.text).toBe('A/1');
  });
});

describe('a free or no-connect pad', () => {
  it('marks a no-connect pad with x', () => {
    const s = scene(
      FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (pintype "no_connect"))'),
    );
    expect(padItems(s).net!.text).toBe('x');
    expect(s.padLabels[0]!.netIsOverride).toBe(true);
  });

  it('marks a free pad on an unconnected net with *', () => {
    const b = read(
      `  (net 2 "unconnected-(U1-PAD1)")
${FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 2 "unconnected-(U1-PAD1)") (pintype "free"))')}`,
    );
    const s = buildScene(b, {}, GL_PATH_FACTORY);
    expect(padItems(s).net!.text).toBe('*');
  });

  it('tests the STORED short name, not the displayed one', () => {
    // `IsFreePad()` reads `GetShortNetname()`. A net whose *escaped* name does
    // not start with `unconnected-(` is not a free pad, however it displays.
    const b = read(
      `  (net 2 "{dollar}unconnected-(U1-PAD1)")
${FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 2 "{dollar}unconnected-(U1-PAD1)") (pintype "free"))')}`,
    );
    const s = buildScene(b, {}, GL_PATH_FACTORY);
    expect(padItems(s).net!.text).not.toBe('*');
    expect(s.padLabels[0]!.netIsOverride).toBeUndefined();
  });

  it('is an override, so the net-name setting does not gate it', () => {
    const s = scene(
      FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (pintype "no_connect"))'),
    );
    // The flag the draw pass reads to keep it when `m_NetNames` says no names.
    expect(s.padLabels[0]!.netIsOverride).toBe(true);
  });

  it('marks an ordinary net as not an override', () => {
    const s = scene(
      FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "/uart/SDA{slash}A4"))'),
    );
    expect(s.padLabels[0]!.netIsOverride).toBeUndefined();
  });
});

describe('a pad string left on its own', () => {
  const both = () =>
    padItems(
      scene(
        FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu") (net 1 "/uart/SDA{slash}A4"))'),
      ),
    );

  it('carries the layout it would have had alone', () => {
    // Both shown: small and offset. The alternative is kept beside it so the
    // per-frame gate can re-centre whichever string survives.
    const { net, number } = both();
    expect(net!.solo).toBeDefined();
    expect(number!.solo).toBeDefined();
  });

  it('is centred on the pad when alone, and offset when paired', () => {
    const { net } = both();
    // Paired: pushed below the pad centre (the number goes above).
    expect(net!.at.y).toBeGreaterThan(100 * MM);
    // Alone: on the centre line, exactly as `draw( const PAD* )` leaves it when
    // `padNumber` is empty.
    expect(net!.solo!.at.y).toBe(100 * MM);
  });

  it('is drawn larger alone than paired, where the cap is what binds', () => {
    // `tsize = min( 1.5 · padsize.x / max(chars, 3), size )`, and only `size` is
    // halved when both are shown. So the size changes only for a string short
    // enough that the cap is the binding term — a one-character pad number on a
    // 2 mm pad is; a six-character net name is not, and re-centres without
    // resizing. Asserting otherwise would be asserting a formula KiCad does not
    // have (pcb_painter.cpp:1538-1571).
    const { net, number } = both();
    expect(number!.solo!.glyph).toBeGreaterThan(number!.glyph);
    expect(net!.solo!.glyph).toBe(net!.glyph);
  });

  it('has no alternative when it never had a partner', () => {
    const s = scene(FP('(pad "1" smd rect (at 0 0) (size 2 2) (layers "F.Cu"))'));
    const { number, net } = padItems(s);
    expect(net).toBeUndefined();
    // Already the only string, so it is already laid out as one.
    expect(number!.solo).toBeUndefined();
  });
});

describe('the character count the size is divided by', () => {
  it('does not count overbar markup', () => {
    // `PrintableCharCount`, not `length`: `~{…}` draws an overbar and the
    // introducer and braces print nothing. Counting them makes the string look
    // longer and the text comes out smaller than KiCad draws it.
    expect(printableCharCount('~{RESET}')).toBe(5);
    expect(printableCharCount('RESET')).toBe(5);
  });

  it('does not count super- or subscript markup', () => {
    expect(printableCharCount('A^{2}')).toBe(2);
    expect(printableCharCount('A_{n}')).toBe(2);
  });

  it('counts an introducer that opens nothing', () => {
    // `~` only starts a group when a brace follows immediately; on its own it
    // is an ordinary character.
    expect(printableCharCount('~RESET')).toBe(6);
    expect(printableCharCount('A^B')).toBe(3);
  });

  it('counts braces that are not markup', () => {
    expect(printableCharCount('{x}')).toBe(3);
  });

  it('drops tabs, which bitmap text does not lay out', () => {
    expect(printableCharCount('A\tB')).toBe(2);
  });

  it('sizes a marked-up net name as the text it prints', () => {
    // The whole point, at the surface: `~{RESET}` must be sized as five
    // characters, not eight.
    const marked = scene(
      `  (net 3 "~{RESET}")
${FP('(pad "1" smd rect (at 0 0) (size 4 4) (layers "F.Cu") (net 3 "~{RESET}"))')}`,
    );
    const plain = scene(
      `  (net 4 "RESET")
${FP('(pad "1" smd rect (at 0 0) (size 4 4) (layers "F.Cu") (net 4 "RESET"))')}`,
    );
    expect(padItems(marked).net!.text).toBe('~{RESET}');
    expect(padItems(marked).net!.glyph).toBe(padItems(plain).net!.glyph);
  });
});

describe('the display options', () => {
  it('separates the pad, track and via thresholds', () => {
    // One 4-valued setting in KiCad — 0 none, 1 pads, 2 tracks, 3 both — read
    // at three different thresholds. Collapsing them onto one boolean is what
    // made "pads only" hide vias and "tracks only" letter pads.
    expect(DEFAULT_DRAW_OPTIONS.netNames).toBe(true); // >= 2
    expect(DEFAULT_DRAW_OPTIONS.padNetNames).toBe(true); // == 1 || == 3
    expect(DEFAULT_DRAW_OPTIONS.viaNetNames).toBe(true); // != 0
  });
});
