// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER` on a real KiCad board and on a synthetic one.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { VIATYPE } from '@ziroeda/pcbnew/pcb_track_types.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const mmToIU = (n: number): number => pcbIUScale.mmToIU(n);

// Local KiCad source clone (gitignored); the suite is skipped when absent.
const STICKHUB = new URL('../../../kicad-src/demos/stickhub/StickHub.kicad_pcb', import.meta.url)
  .pathname;

describe.skipIf(!existsSync(STICKHUB))('ParseBoard (real KiCad demo board)', () => {
  // Guarded read: vitest still executes skipped suite factories during collection.
  const board = existsSync(STICKHUB)
    ? ParseBoard(readFileSync(STICKHUB, 'utf8'))
    : (undefined as never);

  it('reads the layer table, nets and main item lists', () => {
    expect(board.GetEnabledLayers().count()).toBeGreaterThan(5);
    expect(board.IsLayerEnabled(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(board.FindNet(0)!.GetNetname()).toBe('');
    expect(board.Footprints().length).toBeGreaterThan(0);
    expect(board.Tracks().length).toBeGreaterThan(0);
  });

  it('places pads in board space: most netted pads meet a track end', () => {
    const ends = board.Tracks().flatMap((t) => [t.GetStart(), t.GetEnd()]);
    let matched = 0;
    let checked = 0;
    for (const fp of board.Footprints()) {
      for (const p of fp.Pads()) {
        if (p.GetNetCode() <= 0) continue;
        checked++;
        const size = p.GetSize(PCB_LAYER_ID.F_Cu);
        const tol = Math.max(size.x, size.y) / 2 + mmToIU(0.01);
        const at = p.GetPosition();
        if (ends.some((e) => Math.abs(e.x - at.x) <= tol && Math.abs(e.y - at.y) <= tol)) matched++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(matched / checked).toBeGreaterThan(0.5);
  });
});

describe('ParseBoard (synthetic)', () => {
  // A 90°-rotated footprint: pad at local (1, 0) must land at fp + (0, -1)
  // (KiCad RotatePoint +90°: (x,y) -> (y,-x)), and the file pad angle is
  // board-absolute so it stays 90 regardless of the footprint rotation.
  // Version 20250210: a `filled_polygon` in an older file is a stroked fill,
  // which `parseZONE` inflates by half the min thickness with round corners
  // ("Zone fills will be converted on best-effort basis"), so the four
  // corners below would come back as twenty.
  const src = `(kicad_pcb (version 20250210) (generator "pcbnew")
    (general (thickness 1.6))
    (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
    (net 0 "") (net 1 "GND")
    (footprint "T:FP" (layer "F.Cu") (at 100 50 90)
      (pad "1" smd rect (at 1 0 90) (size 1 0.5) (layers "F.Cu") (net 1 "GND"))
      (pad "2" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu"))
      (fp_line (start 0 0) (end 2 0) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
    )
    (segment (start 100 49) (end 110 49) (width 0.25) (layer "F.Cu") (net 1))
    (via (at 105 49) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
    (zone (net 1) (net_name "GND") (layers "B.Cu")
      (polygon (pts (xy 90 40) (xy 120 40) (xy 120 60) (xy 90 60)))
      (filled_polygon (layer "B.Cu") (pts (xy 90 40) (xy 120 40) (xy 120 60) (xy 90 60)))))`;
  const board = ParseBoard(src);

  it('rotates footprint children into board coordinates', () => {
    const fp = board.Footprints()[0]!;
    const pad1 = fp.Pads().find((p) => p.GetNumber() === '1')!;
    expect(pad1.GetPosition()).toEqual({ x: mmToIU(100), y: mmToIU(49) });
    expect(pad1.GetOrientationDegrees()).toBe(90); // board-absolute, straight from the file
    // fp_line end (2,0) -> (100, 48)
    const line = fp.GraphicalItems()[0]! as PCB_SHAPE;
    expect(line.GetEnd()).toEqual({ x: mmToIU(100), y: mmToIU(48) });
    // The rotated pad now coincides with the track start.
    expect(board.Tracks()[0]!.GetStart()).toEqual(pad1.GetPosition());
  });

  it('reads via, zone fill and through-pad drill', () => {
    const via = board.Tracks().find((t) => t.Type() === KICAD_T.PCB_VIA_T)! as PCB_VIA;
    expect(via.GetWidth(PCB_LAYER_ID.F_Cu)).toBe(mmToIU(0.6));
    expect(via.GetViaType()).toBe(VIATYPE.THROUGH);
    const fill = board.Zones()[0]!.GetFilledPolysList(PCB_LAYER_ID.B_Cu);
    expect(fill.OutlineCount()).toBe(1);
    expect(fill.COutline(0).PointCount()).toBe(4);
    const pad2 = board
      .Footprints()[0]!
      .Pads()
      .find((p) => p.GetNumber() === '2')!;
    expect(pad2.GetDrillSize()).toEqual({ x: mmToIU(0.8), y: mmToIU(0.8) });
    expect(pad2.GetOffset(PCB_LAYER_ID.F_Cu)).toEqual({ x: 0, y: 0 });
    // `*.Cu` is every copper layer, not the board's two (m_layerMasks).
    expect(pad2.IsOnLayer(PCB_LAYER_ID.B_Cu) && pad2.IsOnLayer(PCB_LAYER_ID.In1_Cu)).toBe(true);
  });
});
