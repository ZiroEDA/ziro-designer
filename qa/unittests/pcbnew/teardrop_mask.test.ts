// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A track that opens the solder mask, as the file carries it. TEARDROP_MANAGER
 * gives such a track's teardrop a matching opening (createTeardropMask); that
 * half is pinned in teardrop_manager.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { PCB_TRACK } from '@ziroeda/pcbnew/pcb_track.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const MM = (n: number): number => pcbIUScale.mmToIU(n);

/** A via with teardrops on, and one track running into it. */
const src = (trackLayers: string, extra = ''): string => `(kicad_pcb (version 20240108)
  (net 0 "")
  (net 1 "N1")
  (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
    (teardrops (enabled yes)) (uuid "aaaaaaaa-0000-4000-8000-000000000001"))
  (segment (start 10 10) (end 20 10) (width 0.25) ${trackLayers} (net 1) ${extra}
    (uuid "aaaaaaaa-0000-4000-8000-000000000002"))
)`;
const track = (text: string): PCB_TRACK =>
  ParseBoard(text)
    .Tracks()
    .find((t) => t.Type() === KICAD_T.PCB_TRACE_T)!;

const PLAIN = src('(layer "F.Cu")');
const MASKED = src('(layers "F.Cu" "F.Mask")');

describe('reading a track that opens the solder mask', () => {
  it('keeps the copper layer and records the mask opening', () => {
    const t = track(MASKED);

    expect(t.GetLayer()).toBe(PCB_LAYER_ID.F_Cu);
    expect(t.HasSolderMask()).toBe(true);
  });

  it('reads the local margin', () => {
    expect(
      track(
        src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.15)'),
      ).GetLocalSolderMaskMargin(),
    ).toBe(MM(0.15));
  });

  it('leaves both unset on an ordinary track', () => {
    const t = track(PLAIN);

    expect(t.HasSolderMask()).toBe(false);
    expect(t.GetLocalSolderMaskMargin()).toBeUndefined();
  });

  it('writes the layers list and the margin back', () => {
    const flat = FormatBoard(
      ParseBoard(src('(layers "F.Cu" "F.Mask")', '(solder_mask_margin 0.15)')),
    )
      .replace(/\s+/g, ' ')
      .replace(/ \)/g, ')');

    expect(flat).toContain('(layers "F.Cu" "F.Mask")');
    expect(flat).toContain('(solder_mask_margin 0.15)');
  });
});
