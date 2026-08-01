// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Track & Via Properties (DIALOG_TRACK_VIA_PROPERTIES): the three-state form
 * over a multi-item selection, and the source patching that makes an edit
 * actually reach the file.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  applyTrackViaValues,
  collectTrackViaValues,
  hasTrackOrVia,
  trackViaSelection,
  type TrackViaValues,
} from '@ziroeda/pcbnew/src/track_via_properties.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));

/** Two tracks of different widths on one layer, one arc, two vias. */
const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
  (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
  (segment (start 10 0) (end 20 0) (width 0.5) (layer "F.Cu") (net 1) (uuid "t2"))
  (arc (start 20 0) (mid 25 5) (end 30 0) (width 0.25) (layer "F.Cu") (net 1) (uuid "a1"))
  (via (at 40 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
  (via micro (at 50 0) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 2) (uuid "v2"))
)`;

const sel = (board: Board, ids: string[]) => trackViaSelection(board, ids);

/** Serialize and read back, the only way to prove a source patch landed. */
const roundTrip = (board: Board): Board => load(serializeBoard(board));

describe('selection resolution', () => {
  it('picks out tracks, arcs and vias, ignoring everything else', () => {
    const b = load(SRC);
    const s = sel(b, ['track:0', 'arc:0', 'via:1', 'zone:0', 'nonsense']);

    expect(s.tracks.map((t) => t.index)).toEqual([0]);
    expect(s.arcs.map((a) => a.index)).toEqual([0]);
    expect(s.vias.map((v) => v.index)).toEqual([1]);
    expect(hasTrackOrVia(s)).toBe(true);
    expect(hasTrackOrVia(sel(b, ['zone:0']))).toBe(false);
  });
});

describe('collect (TransferDataToWindow)', () => {
  const b = load(SRC);

  it('seeds every field from a single track', () => {
    const v = collectTrackViaValues(sel(b, ['track:0']));

    expect(v.net).toBe(1);
    expect(v.startX).toBe(0);
    expect(v.endX).toBe(MM(10));
    expect(v.trackWidth).toBe(MM(0.25));
    expect(v.layer).toBe('F.Cu');
    expect(v.locked).toBe(false);
    expect(v.hasMask).toBe(false);
    expect(v.maskMargin).toBeNull();
  });

  it('blanks a field the selection disagrees on, and keeps the ones it shares', () => {
    const v = collectTrackViaValues(sel(b, ['track:0', 'track:1']));

    // Different widths and endpoints.
    expect(v.trackWidth).toBeUndefined();
    expect(v.startX).toBeUndefined();
    // Same layer and net.
    expect(v.layer).toBe('F.Cu');
    expect(v.net).toBe(1);
  });

  it('an arc in the selection blanks the endpoint boxes but not width or layer', () => {
    const v = collectTrackViaValues(sel(b, ['track:0', 'arc:0']));

    expect(v.startX).toBeUndefined();
    expect(v.endY).toBeUndefined();
    // Both are 0.25 mm on F.Cu.
    expect(v.trackWidth).toBe(MM(0.25));
    expect(v.layer).toBe('F.Cu');
  });

  it('seeds the via fields, including the type and layer span', () => {
    const v = collectTrackViaValues(sel(b, ['via:1']));

    expect(v.viaX).toBe(MM(50));
    expect(v.viaDiameter).toBe(MM(0.6));
    expect(v.viaDrill).toBe(MM(0.3));
    expect(v.viaType).toBe('micro');
    expect(v.startLayer).toBe('F.Cu');
    expect(v.endLayer).toBe('In1.Cu');
    expect(v.net).toBe(2);
  });

  it('blanks the via type and net across a mixed via selection', () => {
    const v = collectTrackViaValues(sel(b, ['via:0', 'via:1']));

    expect(v.viaType).toBeUndefined();
    expect(v.net).toBeUndefined();
    expect(v.viaDiameter).toBeUndefined();
  });

  it('seeds the teardrop fields from the via defaults', () => {
    const v = collectTrackViaValues(sel(b, ['via:0']));

    expect(v.tdEnabled).toBe(false);
    expect(v.tdBestLengthPct).toBe(50);
    expect(v.tdBestWidthPct).toBe(100);
    expect(v.tdFilterPct).toBeCloseTo(90);
  });

  it('a field stays indeterminate once blanked, even if a later item matches the seed', () => {
    // widths 0.25, 0.5, 0.25 — the third agrees with the first.
    const v = collectTrackViaValues(sel(b, ['track:0', 'track:1', 'arc:0']));
    expect(v.trackWidth).toBeUndefined();
  });
});

describe('apply (TransferDataFromWindow)', () => {
  it('writes only the fields that hold a value', () => {
    const b = load(SRC);
    const s = sel(b, ['track:0', 'track:1']);
    const out = applyTrackViaValues(b, s, { trackWidth: MM(0.3) });

    expect(out.tracks[0]!.width).toBe(MM(0.3));
    expect(out.tracks[1]!.width).toBe(MM(0.3));
    // Untouched fields survive.
    expect(out.tracks[0]!.start).toEqual(b.tracks[0]!.start);
    expect(out.tracks[1]!.net).toBe(1);
  });

  it('leaves items outside the selection alone', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { trackWidth: MM(0.3) });

    expect(out.tracks[1]).toBe(b.tracks[1]);
    expect(out.arcs[0]).toBe(b.arcs[0]);
  });

  it('returns the same board when nothing changed', () => {
    const b = load(SRC);
    expect(applyTrackViaValues(b, sel(b, ['track:0']), {})).toBe(b);
    // Setting a field to its current value is not a change either.
    expect(applyTrackViaValues(b, sel(b, ['track:0']), { trackWidth: MM(0.25) })).toBe(b);
  });

  it('moves an endpoint on every selected track', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { startY: MM(2) });

    expect(out.tracks[0]!.start).toEqual({ x: 0, y: MM(2) });
    expect(out.tracks[0]!.end).toEqual(b.tracks[0]!.end);
  });

  it('edits via geometry, type and layer span', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['via:0']), {
      viaDiameter: MM(1),
      viaDrill: MM(0.5),
      viaType: 'blind',
      endLayer: 'In2.Cu',
    });

    const via = out.vias[0]!;
    expect(via.size).toBe(MM(1));
    expect(via.drill).toBe(MM(0.5));
    expect(via.kind).toBe('blind');
    expect(via.layers).toEqual(['F.Cu', 'In2.Cu']);
  });

  it('edits the per-via teardrop parameters', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['via:0']), {
      tdEnabled: true,
      tdBestLengthPct: 70,
      tdCurvedEdges: true,
    });

    const td = out.vias[0]!.teardrops!;
    expect(td.enabled).toBe(true);
    expect(td.bestLengthRatio).toBeCloseTo(0.7);
    expect(td.curvedEdges).toBe(true);
    // The fields the form left blank keep the via's own values.
    expect(td.bestWidthRatio).toBe(1);
  });
});

describe('source patching — the edit has to reach the file', () => {
  it('a width change survives serialize/reload', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { trackWidth: MM(0.3) });

    expect(roundTrip(out).tracks[0]!.width).toBe(MM(0.3));
  });

  it('an endpoint move survives', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { startY: MM(2), endY: MM(3) });
    const back = roundTrip(out).tracks[0]!;

    expect(back.start).toEqual({ x: 0, y: MM(2) });
    expect(back.end).toEqual({ x: MM(10), y: MM(3) });
  });

  it('a net and layer change survives', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { net: 2, layer: 'B.Cu' });
    const back = roundTrip(out).tracks[0]!;

    expect(back.net).toBe(2);
    expect(back.layer).toBe('B.Cu');
  });

  it('locking and unlocking survives, and unlocking drops the token', () => {
    const b = load(SRC);
    const locked = applyTrackViaValues(b, sel(b, ['track:0']), { locked: true });
    expect(roundTrip(locked).tracks[0]!.locked).toBe(true);

    const unlocked = applyTrackViaValues(locked, sel(locked, ['track:0']), { locked: false });
    expect(roundTrip(unlocked).tracks[0]!.locked).toBeFalsy();
    expect(serializeBoard(unlocked).replace(/\s+/g, ' ')).not.toContain('(locked yes)');
  });

  it('turning the solder mask on rewrites (layer …) as (layers …)', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), {
      hasMask: true,
      maskMargin: MM(0.1),
    });
    const flat = serializeBoard(out).replace(/\s+/g, ' ').replace(/ \)/g, ')');

    expect(flat).toContain('(layers "F.Cu" "F.Mask")');
    expect(flat).toContain('(solder_mask_margin 0.1)');

    const back = roundTrip(out).tracks[0]!;
    expect(back.layer).toBe('F.Cu');
    expect(back.maskLayer).toBe('F.Mask');
    expect(back.solderMaskMargin).toBe(MM(0.1));
  });

  it('turning it back off restores (layer …) and drops the margin', () => {
    const b = load(SRC);
    const on = applyTrackViaValues(b, sel(b, ['track:0']), { hasMask: true, maskMargin: MM(0.1) });
    const off = applyTrackViaValues(on, sel(on, ['track:0']), { hasMask: false, maskMargin: null });
    const flat = serializeBoard(off).replace(/\s+/g, ' ').replace(/ \)/g, ')');

    expect(flat).toContain('(layer "F.Cu")');
    expect(flat).not.toContain('F.Mask');
    expect(flat).not.toContain('solder_mask_margin');
    expect(roundTrip(off).tracks[0]!.maskLayer).toBeUndefined();
  });

  it('a via diameter, drill and layer-span change survives', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['via:0']), {
      viaDiameter: MM(1),
      viaDrill: MM(0.5),
      endLayer: 'In2.Cu',
    });
    const back = roundTrip(out).vias[0]!;

    expect(back.size).toBe(MM(1));
    expect(back.drill).toBe(MM(0.5));
    expect(back.layers).toEqual(['F.Cu', 'In2.Cu']);
  });

  it('the via type is a positional atom, added and removed in place', () => {
    const b = load(SRC);

    // through -> blind inserts the atom right after the head.
    const blind = applyTrackViaValues(b, sel(b, ['via:0']), { viaType: 'blind' });
    expect(serializeBoard(blind).replace(/\s+/g, ' ')).toContain('(via blind');
    expect(roundTrip(blind).vias[0]!.kind).toBe('blind');

    // micro -> through removes it, and does not leave both atoms behind.
    const through = applyTrackViaValues(b, sel(b, ['via:1']), { viaType: 'through' });
    const flat = serializeBoard(through).replace(/\s+/g, ' ');
    expect(flat).not.toContain('(via micro');
    expect(roundTrip(through).vias[1]!.kind).toBe('through');
  });

  it('teardrop parameters survive, and default ones are not written', () => {
    const b = load(SRC);
    const on = applyTrackViaValues(b, sel(b, ['via:0']), { tdEnabled: true, tdBestLengthPct: 70 });
    const back = roundTrip(on).vias[0]!.teardrops!;

    expect(back.enabled).toBe(true);
    expect(back.bestLengthRatio).toBeCloseTo(0.7);

    // Back to stock: upstream omits the block entirely.
    const off = applyTrackViaValues(on, sel(on, ['via:0']), {
      tdEnabled: false,
      tdBestLengthPct: 50,
    });
    expect(serializeBoard(off).replace(/\s+/g, ' ')).not.toContain('(teardrops');
  });

  it('everything else in the file is untouched', () => {
    const b = load(SRC);
    const out = applyTrackViaValues(b, sel(b, ['track:0']), { trackWidth: MM(0.3) });
    const back = roundTrip(out);

    expect(back.tracks[1]!.width).toBe(MM(0.5));
    expect(back.arcs[0]!.mid).toEqual({ x: MM(25), y: MM(5) });
    expect(back.vias[1]!.kind).toBe('micro');
    expect(back.tracks[0]!.uuid).toBe('t1');
  });
});

describe('a full round of the dialog', () => {
  it('collect then apply unchanged is a no-op', () => {
    const b = load(SRC);
    const s = sel(b, ['track:0', 'track:1', 'via:0', 'via:1', 'arc:0']);
    const values: TrackViaValues = collectTrackViaValues(s);

    expect(applyTrackViaValues(b, s, values)).toBe(b);
  });
});
