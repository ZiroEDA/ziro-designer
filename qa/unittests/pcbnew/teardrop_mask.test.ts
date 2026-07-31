// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * TEARDROP_MANAGER::createTeardropMask: a track that opens the solder mask
 * gets a matching opening over its teardrop, or the flare would sit under mask
 * while the track it grew from is exposed.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { applyTeardrops, updateTeardrops } from '@ziroeda/pcbnew/src/teardrop.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const MM = (n: number): number => mmToIU(n);
const load = (text: string): Board => readBoard(parse(text));

/** A via with teardrops on, and one track running into it. */
const src = (trackLayers: string, extra = ''): string => `(kicad_pcb (version 20240108)
  (net 0 "")
  (net 1 "N1")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
    (teardrops (enabled yes)) (uuid "v1"))
  (segment (start 10 10) (end 20 10) (width 0.25) ${trackLayers} (net 1) ${extra} (uuid "t1"))
)`;

const PLAIN = src('(layer "F.Cu")');
const MASKED = src('(layers "F.Cu" "F.Mask")');

describe('reading a track that opens the solder mask', () => {
  it('keeps the copper layer and records the mask layer', () => {
    const t = load(MASKED).tracks[0]!;

    expect(t.layer).toBe('F.Cu');
    expect(t.maskLayer).toBe('F.Mask');
  });

  it('reads the local margin', () => {
    const t = load(src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.15)')).tracks[0]!;

    expect(t.solderMaskMargin).toBe(MM(0.15));
  });

  it('leaves both fields unset on an ordinary track', () => {
    const t = load(PLAIN).tracks[0]!;

    expect(t.maskLayer).toBeUndefined();
    expect(t.solderMaskMargin).toBeUndefined();
  });

  it('round-trips the layers list and the margin', () => {
    const b = load(src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.15)'));
    // Rebuild from the model rather than echoing the source node.
    const rebuilt: Board = {
      ...b,
      tracks: b.tracks.map((t) => ({ ...t, source: { kind: 'list' as const, items: [] } })),
    };
    const flat = serializeBoard(rebuilt).replace(/\s+/g, ' ').replace(/ \)/g, ')');

    expect(flat).toContain('(layers "F.Cu" "F.Mask")');
    expect(flat).toContain('(solder_mask_margin 0.15)');
  });
});

describe('the teardrop mask zone', () => {
  it('is not built for a track with no mask opening', () => {
    const tds = updateTeardrops(load(PLAIN), { list: undefined });
    expect(tds[0]!.mask).toBeUndefined();
  });

  it('is built on the matching mask layer', () => {
    const tds = updateTeardrops(load(MASKED));

    expect(tds).toHaveLength(1);
    expect(tds[0]!.mask?.layer).toBe('F.Mask');
  });

  it('takes B.Mask for a track on B.Cu', () => {
    const b = load(src('(layers "B.Cu" "B.Mask")'));
    expect(updateTeardrops(b)[0]!.mask?.layer).toBe('B.Mask');
  });

  it('matches the copper shape when the expansion is zero', () => {
    const td = updateTeardrops(load(MASKED))[0]!;
    expect(td.mask!.corners).toEqual(td.corners);
  });

  it('grows the opening by the board expansion', () => {
    const td = updateTeardrops(load(MASKED), { solderMaskExpansion: MM(0.2) })[0]!;

    const span = (pts: { x: number; y: number }[]) =>
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

    expect(span(td.mask!.corners)).toBeGreaterThan(span(td.corners));
    // The zone's min thickness rises to the expansion, so the deflate/reinflate
    // does the corner rounding upstream delegates to it.
    expect(td.mask!.minThickness).toBe(MM(0.2));
  });

  it('prefers the track’s own margin over the board default', () => {
    const b = load(src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.3)'));
    const td = updateTeardrops(b, { solderMaskExpansion: MM(0.05) })[0]!;

    expect(td.mask!.minThickness).toBe(MM(0.3));
  });

  it('clamps a negative margin so the opening cannot invert', () => {
    // -1 mm on a 0.25 mm track clamps to -width/2 = -0.125 mm.
    const b = load(src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin -1)'));
    const td = updateTeardrops(b)[0]!;

    const span = (pts: { x: number; y: number }[]) =>
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));

    expect(span(td.mask!.corners)).toBeLessThan(span(td.corners));
    expect(span(td.mask!.corners)).toBeGreaterThan(0);
  });
});

describe('mask zones on the board', () => {
  it('appear next to the copper ones, netless', () => {
    const out = applyTeardrops(load(MASKED), { solderMaskExpansion: MM(0.1) });

    const copper = out.zones.filter((z) => z.layers[0] === 'F.Cu');
    const mask = out.zones.filter((z) => z.layers[0] === 'F.Mask');

    expect(copper).toHaveLength(1);
    expect(mask).toHaveLength(1);
    // A mask opening is not copper; a net on it would put it in the ratsnest.
    expect(mask[0]!.net).toBe(0);
    expect(mask[0]!.teardropType).toBe('viapad');
  });

  it('are removed and rebuilt with the copper ones', () => {
    const once = applyTeardrops(load(MASKED));
    const twice = applyTeardrops(once);

    expect(twice.zones).toHaveLength(once.zones.length);
  });

  it('write out on their mask layer', () => {
    const text = serializeBoard(applyTeardrops(load(MASKED)));
    const flat = text.replace(/\s+/g, ' ').replace(/ \)/g, ')');

    expect(flat).toContain('(layer "F.Mask")');
    expect(flat).toContain('(attr (teardrop (type padvia)))');
  });
});
