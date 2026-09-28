// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A track that opens the solder mask, as the file carries it. TEARDROP_MANAGER
 * gives such a track's teardrop a matching opening (createTeardropMask); that
 * half is pinned in teardrop_manager.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { readBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { serializeBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import type { Board } from '@ziroeda/pcbnew/types.js';

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
