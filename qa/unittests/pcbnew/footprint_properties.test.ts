// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Footprint Properties, board side (DIALOG_FOOTPRINT_PROPERTIES): the fields it
 * edits, the `(attr …)` flag list it rebuilds, and the source patching that
 * makes each edit reach the file.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyFootprintValues,
  attributesFor,
  collectFootprintValues,
  footprintAt,
  type FootprintValues,
} from '@ziroeda/pcbnew/src/footprint_properties.js';
import type { Board, PcbFootprint } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));
const roundTrip = (b: Board): Board => load(serializeBoard(b));
const fp = (b: Board): PcbFootprint => b.footprints[0]!;
const flat = (b: Board): string => serializeBoard(b).replace(/\s+/g, ' ').replace(/ \)/g, ')');

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "N1")
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (uuid "f1") (at 20 30 90)
    (attr smd)
    (property "Reference" "R1" (at 0 -2 90) (layer "F.SilkS") (uuid "t1")
      (effects (font (size 1 1) (thickness 0.15))))
    (property "Value" "10k" (at 0 2 90) (layer "F.Fab") (uuid "t2")
      (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -0.8 0 90) (size 0.9 0.9) (layers "F.Cu") (net 1) (uuid "p1"))
    (pad "2" smd rect (at 0.8 0 90) (size 0.9 0.9) (layers "F.Cu") (net 1) (uuid "p2")))
)`;

describe('footprintAt', () => {
  const b = load(SRC);

  it('finds a single selected footprint', () => {
    expect(footprintAt(b, ['footprint:0'])).toBe(0);
    expect(footprintAt(b, ['track:0', 'footprint:0'])).toBe(0);
  });

  it('refuses an empty or ambiguous selection', () => {
    expect(footprintAt(b, [])).toBeNull();
    expect(footprintAt(b, ['pad:0:0'])).toBeNull();
    expect(footprintAt(b, ['footprint:0', 'footprint:1'])).toBeNull();
  });
});

describe('collect (TransferDataToWindow)', () => {
  it('reads the footprint, including its attributes', () => {
    const v = collectFootprintValues(fp(load(SRC)));

    expect(v.reference).toBe('R1');
    expect(v.value).toBe('10k');
    expect(v.x).toBe(MM(20));
    expect(v.y).toBe(MM(30));
    expect(v.orientation).toBe(90);
    expect(v.locked).toBe(false);
    expect(v.footprintType).toBe('smd');
    expect(v.notInSchematic).toBe(false);
    expect(v.doNotPopulate).toBe(false);
  });

  it('reports every override as blank when the file has none', () => {
    const v = collectFootprintValues(fp(load(SRC)));

    expect(v.localClearance).toBeNull();
    expect(v.localSolderMaskMargin).toBeNull();
    expect(v.localSolderPasteMargin).toBeNull();
    expect(v.localSolderPasteMarginRatio).toBeNull();
    expect(v.zoneConnection).toBe('inherited');
  });

  it('reads overrides that are present, keeping zero distinct from blank', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (footprint "L:F" (layer "F.Cu") (at 0 0)
        (clearance 0) (solder_mask_margin 0.1)
        (solder_paste_margin_ratio -0.05) (zone_connect 2)))`);
    const v = collectFootprintValues(fp(b));

    // 0 is a real override ("no clearance at all"), not "use the board value".
    expect(v.localClearance).toBe(0);
    expect(v.localSolderMaskMargin).toBe(MM(0.1));
    expect(v.localSolderPasteMarginRatio).toBeCloseTo(-0.05);
    // `(zone_connect 2)` is a static_cast of ZONE_CONNECTION, and 2 is FULL —
    // "pads are covered by copper" (zones.h:46-53: NONE 0, THERMAL 1, FULL 2,
    // THT_THERMAL 3, INHERITED -1). Reading 2 as "none" inverted the two.
    expect(v.zoneConnection).toBe('full');
  });
});

describe('attributesFor', () => {
  const base = collectFootprintValues(fp(load(SRC)));

  it('writes the flags in upstream order', () => {
    expect(
      attributesFor({
        ...base,
        footprintType: 'through_hole',
        notInSchematic: true,
        excludeFromPosFiles: true,
        excludeFromBom: true,
        allowMissingCourtyard: true,
        doNotPopulate: true,
        allowSolderMaskBridges: true,
      }),
    ).toEqual([
      'through_hole',
      'board_only',
      'exclude_from_pos_files',
      'exclude_from_bom',
      'allow_missing_courtyard',
      'dnp',
      'allow_soldermask_bridges',
    ]);
  });

  it('makes the two footprint types exclusive, and unspecified writes neither', () => {
    expect(attributesFor({ ...base, footprintType: 'smd' })).toEqual(['smd']);
    expect(attributesFor({ ...base, footprintType: 'through_hole' })).toEqual(['through_hole']);
    expect(attributesFor({ ...base, footprintType: 'unspecified' })).toEqual([]);
  });
});

describe('apply', () => {
  const b = load(SRC);
  const base = collectFootprintValues(fp(b));
  const edit = (over: Partial<FootprintValues>): Board =>
    applyFootprintValues(b, 0, { ...base, ...over });

  it('is a no-op when nothing changed', () => {
    expect(applyFootprintValues(b, 0, base)).toBe(b);
  });

  it('renames the reference and value', () => {
    const out = roundTrip(edit({ reference: 'R42', value: '4k7' }));
    expect(fp(out).reference).toBe('R42');
    expect(fp(out).value).toBe('4k7');
  });

  it('moves the whole footprint, pads included', () => {
    const padBefore = fp(b).pads[0]!.at;
    const out = roundTrip(edit({ x: MM(25), y: MM(35) }));

    expect(fp(out).at).toEqual({ x: MM(25), y: MM(35) });
    // Pads are stored board-absolute, so they have to travel with the anchor.
    expect(fp(out).pads[0]!.at).toEqual({ x: padBefore.x + MM(5), y: padBefore.y + MM(5) });
  });

  it('rotates the whole footprint', () => {
    const out = roundTrip(edit({ orientation: 180 }));
    expect(fp(out).angle).toBe(180);
    // The pads rotated about the anchor rather than staying put.
    expect(fp(out).pads[0]!.at).not.toEqual(fp(b).pads[0]!.at);
  });

  it('locks and unlocks', () => {
    const locked = edit({ locked: true });
    expect(fp(roundTrip(locked)).locked).toBe(true);

    const unlocked = applyFootprintValues(locked, 0, {
      ...collectFootprintValues(fp(locked)),
      locked: false,
    });
    expect(fp(roundTrip(unlocked)).locked).toBeFalsy();
  });

  it('rewrites the attribute list', () => {
    const out = edit({
      footprintType: 'through_hole',
      doNotPopulate: true,
      excludeFromBom: true,
    });

    expect(flat(out)).toContain('(attr through_hole exclude_from_bom dnp)');
    expect(collectFootprintValues(fp(roundTrip(out))).doNotPopulate).toBe(true);
  });

  it('drops (attr …) entirely when no flag is left', () => {
    const out = edit({ footprintType: 'unspecified' });
    expect(flat(out)).not.toContain('(attr');
    expect(fp(roundTrip(out)).attributes).toBeUndefined();
  });

  it('writes the clearance overrides', () => {
    const out = roundTrip(
      edit({
        localClearance: MM(0.3),
        localSolderMaskMargin: MM(0.05),
        localSolderPasteMargin: MM(-0.1),
        localSolderPasteMarginRatio: -0.05,
      }),
    );

    expect(fp(out).localClearance).toBe(MM(0.3));
    expect(fp(out).localSolderMaskMargin).toBe(MM(0.05));
    expect(fp(out).localSolderPasteMargin).toBe(MM(-0.1));
    expect(fp(out).localSolderPasteMarginRatio).toBeCloseTo(-0.05);
  });

  it('treats a zero override as a real value, not a blank', () => {
    const out = edit({ localClearance: 0 });
    expect(flat(out)).toContain('(clearance 0)');
    expect(fp(roundTrip(out)).localClearance).toBe(0);
  });

  it('drops an override when the box is cleared', () => {
    const on = edit({ localClearance: MM(0.3) });
    const off = applyFootprintValues(on, 0, {
      ...collectFootprintValues(fp(on)),
      localClearance: null,
    });

    expect(flat(off)).not.toContain('(clearance');
    expect(fp(roundTrip(off)).localClearance).toBeUndefined();
  });

  it('writes the zone connection as the enum, and drops it when inherited', () => {
    // `(zone_connect N)` is `static_cast<int>( ZONE_CONNECTION )` on the way out
    // and a plain cast back on the way in (zones.h:46-53) — NONE 0, THERMAL 1,
    // FULL 2, THT_THERMAL 3. The numbers are the enum's, not a private encoding:
    // writing 3 for "solid" makes KiCad read the footprint back as "thermal
    // reliefs for PTH".
    const none = edit({ zoneConnection: 'none' });
    expect(flat(none)).toContain('(zone_connect 0)');
    expect(fp(roundTrip(none)).zoneConnection).toBe('none');

    for (const [mode, code] of [
      ['thermal', 1],
      ['full', 2],
      ['tht_thermal', 3],
    ] as const) {
      expect(flat(edit({ zoneConnection: mode }))).toContain(`(zone_connect ${code})`);
      expect(fp(roundTrip(edit({ zoneConnection: mode }))).zoneConnection).toBe(mode);
    }

    const back = applyFootprintValues(none, 0, {
      ...collectFootprintValues(fp(none)),
      zoneConnection: 'inherited',
    });
    expect(flat(back)).not.toContain('zone_connect');
  });

  it('leaves the rest of the footprint alone', () => {
    const out = roundTrip(edit({ localClearance: MM(0.3) }));

    expect(fp(out).lib).toBe('Resistor_SMD:R_0603');
    expect(fp(out).uuid).toBe('f1');
    expect(fp(out).pads).toHaveLength(2);
    expect(fp(out).pads[1]!.number).toBe('2');
  });

  it('survives a collect/apply round with no edits', () => {
    const once = edit({ localClearance: MM(0.3) });
    expect(applyFootprintValues(once, 0, collectFootprintValues(fp(once)))).toBe(once);
  });

  it('changes the side by flipping the footprint in place', () => {
    const out = roundTrip(edit({ side: 'back' }));

    expect(fp(out).layer).toBe('B.Cu');
    // Flipping in place: the anchor stays put, everything else swaps side.
    expect(fp(out).at).toEqual(fp(b).at);
    expect(fp(out).angle).toBe(-90);
    expect(fp(out).pads[0]!.layers).toEqual(['B.Cu']);

    // And the dialog reads the new side back.
    expect(collectFootprintValues(fp(out)).side).toBe('back');
  });

  it('applies position and orientation before the flip, as upstream does', () => {
    // Flipping first would let the rotate undo the angle negation the flip
    // just applied, and the footprint would come out facing the wrong way.
    const out = roundTrip(edit({ side: 'back', x: MM(50), y: MM(60) }));

    expect(fp(out).layer).toBe('B.Cu');
    expect(fp(out).at).toEqual({ x: MM(50), y: MM(60) });
  });
});
