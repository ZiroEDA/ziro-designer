// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Pad Properties, board side (DIALOG_PAD_PROPERTIES).
 *
 * The board-editor wrinkle: a pad's position is board-absolute in this model
 * but footprint-local in the file, so every position edit has to convert back
 * through the parent's rotation and anchor. A rotated footprint is therefore
 * the interesting case, and the fixture has one.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyPadValues,
  collectPadValues,
  padAt,
  padLocalPos,
  type PadValues,
} from '@ziroeda/pcbnew/src/pad_properties.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const pad = (b: Board, i = 0): PcbPad => b.footprints[0]!.pads[i]!;
const flat = (b: Board): string => serializeBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');

/** A footprint rotated 90°, so the local/absolute conversion has to work. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "") (net 1 "N1") (net 2 "N2")
  (footprint "L:R" (layer "F.Cu") (uuid "f1") (at 20 30 90)
    (pad "1" smd roundrect (at -1 0 90) (size 1 2) (layers "F.Cu" "F.Paste" "F.Mask")
      (roundrect_rratio 0.25) (net 1) (uuid "p1"))
    (pad "2" thru_hole circle (at 1 0 90) (size 1.5 1.5) (drill 0.8)
      (layers "*.Cu" "*.Mask") (net 1) (uuid "p2")))
)`;

describe('padAt', () => {
  const b = load(SRC);

  it('resolves a single pad id', () => {
    expect(padAt(b, ['pad:0:1'])).toEqual({ footprint: 0, pad: 1 });
  });

  it('refuses an empty or ambiguous selection', () => {
    expect(padAt(b, [])).toBeNull();
    expect(padAt(b, ['footprint:0'])).toBeNull();
    expect(padAt(b, ['pad:0:0', 'pad:0:1'])).toBeNull();
  });
});

describe('padLocalPos', () => {
  it('inverts the reader’s board transform', () => {
    const b = load(SRC);
    const fp = b.footprints[0]!;

    // The file said (at -1 0); the reader baked it to board coordinates.
    expect(padLocalPos(fp, fp.pads[0]!.at)).toEqual({ x: MM(-1), y: 0 });
    expect(padLocalPos(fp, fp.pads[1]!.at)).toEqual({ x: MM(1), y: 0 });
  });
});

describe('collect', () => {
  const b = load(SRC);

  it('reads the pad', () => {
    const v = collectPadValues(pad(b));

    expect(v.number).toBe('1');
    expect(v.type).toBe('smd');
    expect(v.shape).toBe('roundrect');
    expect(v.sizeX).toBe(MM(1));
    expect(v.sizeY).toBe(MM(2));
    expect(v.orientation).toBe(90);
    expect(v.net).toBe(1);
    expect(v.layers).toEqual(['F.Cu', 'F.Paste', 'F.Mask']);
    expect(v.roundrectRatio).toBeCloseTo(0.25);
    expect(v.hasHole).toBe(false);
  });

  it('reads a through-hole pad’s drill', () => {
    const v = collectPadValues(pad(b, 1));

    expect(v.type).toBe('thru_hole');
    expect(v.hasHole).toBe(true);
    expect(v.holeW).toBe(MM(0.8));
    expect(v.holeOblong).toBe(false);
  });

  it('reports absent overrides as blank', () => {
    const v = collectPadValues(pad(b));

    expect(v.localClearance).toBeNull();
    expect(v.thermalGap).toBeNull();
    expect(v.padToDieLength).toBeNull();
    expect(v.zoneConnection).toBe('inherited');
  });

  it('keeps a zero override distinct from a blank one', () => {
    const z = load(`(kicad_pcb (version 20240108)
      (footprint "L:R" (layer "F.Cu") (at 0 0)
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (clearance 0) (zone_connect 3))))`);
    const v = collectPadValues(pad(z));

    expect(v.localClearance).toBe(0);
    // 3 is THT_THERMAL, "thermal relief only for THT pads" (zones.h:46-53).
    expect(v.zoneConnection).toBe('tht_thermal');
  });
});

describe('apply', () => {
  const b = load(SRC);
  const ref = { footprint: 0, pad: 0 };
  const base = collectPadValues(pad(b));
  const edit = (over: Partial<PadValues>): Board => applyPadValues(b, ref, { ...base, ...over });

  it('is a no-op when nothing changed', () => {
    expect(applyPadValues(b, ref, base)).toBe(b);
  });

  it('renames the pad and changes its net', () => {
    const out = roundTrip(edit({ number: '7', net: 2 }));
    expect(pad(out).number).toBe('7');
    expect(pad(out).net).toBe(2);
  });

  it('changes type and shape, which are positional atoms', () => {
    const out = edit({ type: 'thru_hole', shape: 'circle', hasHole: true, holeW: MM(0.6) });

    expect(flat(out)).toContain('(pad "1" thru_hole circle');
    const back = pad(roundTrip(out));
    expect(back.type).toBe('thru_hole');
    expect(back.shape).toBe('circle');
  });

  it('resizes', () => {
    const out = pad(roundTrip(edit({ sizeX: MM(2), sizeY: MM(3) })));
    expect(out.size).toEqual({ x: MM(2), y: MM(3) });
  });

  it('moves the pad, writing footprint-local coordinates', () => {
    // Board-absolute target; the file must hold it in the rotated local frame.
    const target = { x: MM(25), y: MM(35) };
    const out = edit({ x: target.x, y: target.y });

    const local = padLocalPos(b.footprints[0]!, target);
    expect(flat(out)).toContain(`(at ${local.x / MM(1)} ${local.y / MM(1)} 90)`);

    // And it reads back at the board position the dialog was given.
    expect(pad(roundTrip(out)).at).toEqual(target);
  });

  it('changes the orientation', () => {
    expect(pad(roundTrip(edit({ orientation: 45 }))).angle).toBe(45);
  });

  it('changes the layer set', () => {
    const out = pad(roundTrip(edit({ layers: ['B.Cu', 'B.Mask'] })));
    expect(out.layers).toEqual(['B.Cu', 'B.Mask']);
  });

  it('drops the roundrect ratio when the shape stops being a roundrect', () => {
    const out = edit({ shape: 'rect' });
    expect(flat(out)).not.toContain('roundrect_rratio');
    expect(pad(roundTrip(out)).roundrectRatio).toBeUndefined();
  });

  it('writes a trapezoid delta only for a trapezoid', () => {
    const trap = edit({ shape: 'trapezoid', deltaX: MM(0.5), deltaY: 0 });
    expect(flat(trap)).toContain('(rect_delta 0.5 0)');

    const rect = applyPadValues(trap, ref, { ...collectPadValues(pad(trap)), shape: 'rect' });
    expect(flat(rect)).not.toContain('rect_delta');
  });

  it('adds, reshapes and removes the hole', () => {
    const drilled = edit({ hasHole: true, holeW: MM(0.9) });
    expect(pad(roundTrip(drilled)).drill?.w).toBe(MM(0.9));

    const oblong = applyPadValues(drilled, ref, {
      ...collectPadValues(pad(drilled)),
      holeOblong: true,
      holeH: MM(1.4),
    });
    const back = pad(roundTrip(oblong)).drill!;
    expect(back.oblong).toBe(true);
    expect(back.h).toBe(MM(1.4));

    const smd = applyPadValues(oblong, ref, {
      ...collectPadValues(pad(oblong)),
      hasHole: false,
    });
    // Scope the check to this pad's node: pad 2 keeps its own drill.
    expect(flat(smd)).toContain('(pad "1" smd roundrect');
    expect(flat(smd).split('(pad "2"')[0]).not.toContain('(drill');
    expect(pad(roundTrip(smd)).drill).toBeUndefined();
  });

  it('writes the hole offset only when it is non-zero', () => {
    const centred = edit({ hasHole: true, holeW: MM(0.9) });
    expect(flat(centred)).not.toContain('(offset');

    const shifted = edit({ hasHole: true, holeW: MM(0.9), holeOffsetX: MM(0.2) });
    expect(flat(shifted)).toContain('(offset 0.2 0)');
    expect(pad(roundTrip(shifted)).drill?.offset).toEqual({ x: MM(0.2), y: 0 });
  });

  it('writes the clearance and thermal overrides', () => {
    const out = pad(
      roundTrip(
        edit({
          localClearance: MM(0.25),
          localSolderMaskMargin: MM(0.05),
          localSolderPasteMargin: MM(-0.1),
          localSolderPasteMarginRatio: -0.05,
          thermalBridgeWidth: MM(0.4),
          thermalGap: MM(0.35),
          padToDieLength: MM(1.2),
        }),
      ),
    );

    expect(out.localClearance).toBe(MM(0.25));
    expect(out.localSolderMaskMargin).toBe(MM(0.05));
    expect(out.localSolderPasteMarginRatio).toBeCloseTo(-0.05);
    expect(out.thermalBridgeWidth).toBe(MM(0.4));
    expect(out.thermalGap).toBe(MM(0.35));
    expect(out.padToDieLength).toBe(MM(1.2));
  });

  it('drops an override when the box is cleared, and keeps zero', () => {
    expect(flat(edit({ localClearance: 0 }))).toContain('(clearance 0)');

    const on = edit({ localClearance: MM(0.25) });
    const off = applyPadValues(on, ref, {
      ...collectPadValues(pad(on)),
      localClearance: null,
    });
    expect(flat(off)).not.toContain('(clearance');
  });

  it('writes the zone connection as the enum, and drops it when inherited', () => {
    // ZONE_CONNECTION's own numbering (zones.h:46-53), which `(zone_connect N)`
    // carries verbatim: FULL is 2. INHERITED is -1 and is never written — the
    // token's ABSENCE is what "inherit" is, which is why the clear drops it.
    const solid = edit({ zoneConnection: 'full' });
    expect(flat(solid)).toContain('(zone_connect 2)');
    expect(pad(roundTrip(solid)).zoneConnection).toBe('full');

    const tht = edit({ zoneConnection: 'tht_thermal' });
    expect(flat(tht)).toContain('(zone_connect 3)');
    expect(pad(roundTrip(tht)).zoneConnection).toBe('tht_thermal');

    const back = applyPadValues(solid, ref, {
      ...collectPadValues(pad(solid)),
      zoneConnection: 'inherited',
    });
    expect(flat(back)).not.toContain('zone_connect');
  });

  it('leaves the other pad and the footprint alone', () => {
    const out = roundTrip(edit({ sizeX: MM(2) }));

    expect(pad(out, 1).number).toBe('2');
    expect(pad(out, 1).drill?.w).toBe(MM(0.8));
    expect(out.footprints[0]!.at).toEqual(b.footprints[0]!.at);
    expect(pad(out).uuid).toBe('p1');
  });

  it('survives a collect/apply round with no edits', () => {
    const once = edit({ sizeX: MM(2) });
    expect(applyPadValues(once, ref, collectPadValues(pad(once)))).toBe(once);
  });
});
