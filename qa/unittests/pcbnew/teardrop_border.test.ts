// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * ZONE_BORDER_DISPLAY_STYLE::INVISIBLE_BORDER on teardrop zones — the style
 * upstream's writer has no token for, so the reader has to restore it.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { applyTeardrops } from '@ziroeda/pcbnew/src/teardrop.js';
import type { Board } from '@ziroeda/pcbnew/src/types.js';

const load = (text: string): Board => readBoard(parse(text));

const SRC = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (net 0 "")
  (net 1 "N1")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
    (teardrops (enabled yes)) (uuid "v1"))
  (segment (start 10 10) (end 20 10) (width 0.25) (layer "F.Cu") (net 1) (uuid "t1"))
)`;

describe('teardrop zone borders', () => {
  it('the generator marks them invisible', () => {
    const out = applyTeardrops(load(SRC));

    expect(out.zones).toHaveLength(1);
    expect(out.zones[0]!.hatchStyle).toBe('invisible');
  });

  it('the writer spells it `none`, as upstream’s switch falls through', () => {
    const text = serializeBoard(applyTeardrops(load(SRC)));
    const flat = text.replace(/\s+/g, ' ').replace(/ \)/g, ')');

    expect(flat).toContain('(hatch none 0.5)');
    expect(flat).not.toContain('invisible');
  });

  it('the reader restores it for teardrop zones', () => {
    const reread = load(serializeBoard(applyTeardrops(load(SRC))));

    expect(reread.zones[0]!.teardropType).toBe('viapad');
    expect(reread.zones[0]!.hatchStyle).toBe('invisible');
  });

  it('leaves a plain zone’s `none` alone', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (zone (net 1) (net_name "N1") (layer "F.Cu") (hatch none 0.5)
        (connect_pads (clearance 0.5)) (min_thickness 0.25)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(b.zones[0]!.hatchStyle).toBe('none');
    expect(b.zones[0]!.teardropType).toBeUndefined();
  });

  it('keeps edge and full styles intact', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (zone (net 1) (layer "F.Cu") (hatch edge 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
      (zone (net 1) (layer "F.Cu") (hatch full 0.5)
        (fill yes) (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))
    )`);

    expect(b.zones.map((z) => z.hatchStyle)).toEqual(['edge', 'full']);
  });
});
