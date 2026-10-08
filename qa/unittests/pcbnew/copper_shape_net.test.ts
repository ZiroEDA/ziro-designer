// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A copper graphic belongs to a net, and the reader keeps it (#631).
 *
 * `PCB_SHAPE` derives from `BOARD_CONNECTED_ITEM` (`pcbnew/pcb_shape.h:37`), so
 * a graphic on a copper layer is a connected item exactly as a track is, and the
 * writer emits `(net …)` whenever `GetNetCode() > 0`
 * (`pcb_io_kicad_sexpr.cpp:1116`). We dropped the whole token on load, which
 * lost the net name from the painter and the connection from everything else.
 *
 * `parseNet` (`pcb_io_kicad_sexpr_parser.cpp:296`) accepts two spellings and
 * both are still written by files in the wild:
 *
 *  - a **net code**, `(net 5)`, in files from before 10.0 — "authoritative",
 *    says the comment;
 *  - a **net name**, `(net "/uart/SDA")`, from 10.0 on.
 *
 * Reading only the number would have silently dropped the net on every board
 * KiCad 10 has saved — which is every board that has one.
 */
import { describe, expect, it } from 'vitest';
import { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { PCB_SHAPE } from '@ziroeda/pcbnew/pcb_shape.js';
import {
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { flatText, writtenNode } from './support/written_node.js';

const board = (body: string): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user))
  (net 0 "")
  (net 1 "/uart/SDA")
${body}
)`);
const shapes = (b: BOARD): PCB_SHAPE[] => b.Drawings() as PCB_SHAPE[];
/** A 1 mm line drawn on that layer, added to the board. */
const draw = (b: BOARD, layer: PCB_LAYER_ID, net = 0): PCB_SHAPE => {
  const s = new PCB_SHAPE(b, SHAPE_T.SEGMENT);
  s.SetStart({ x: 0, y: 0 });
  s.SetEnd({ x: 1e6, y: 0 });
  s.SetWidth(2e5);
  s.SetLayer(layer);
  s.SetNetCode(net);
  b.Add(s);
  return s;
};

describe('a copper graphic carrying a net', () => {
  it('reads a net NAME, the shape 10.0 writes', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))',
    );
    expect(shapes(b)[0]!.GetNetCode()).toBe(1);
    expect(shapes(b)[0]!.GetNetname()).toBe('/uart/SDA');
  });

  it('reads a net CODE, the legacy pre-10.0 shape', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net 1))',
    );
    expect(shapes(b)[0]!.GetNetCode()).toBe(1);
  });

  it('declares a net the file names but never listed', () => {
    // `FindNet` misses, so upstream creates the NETINFO_ITEM and adds it to the
    // board rather than dropping the reference. Two shapes naming it must land
    // on the same net.
    const b = board(
      `  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/late/GND"))
  (gr_line (start 30 10) (end 40 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/late/GND"))`,
    );
    const code = shapes(b)[0]!.GetNetCode();
    expect(code).toBeGreaterThan(0);
    expect(shapes(b)[1]!.GetNetCode()).toBe(code);
    expect(b.FindNet(code)!.GetNetname()).toBe('/late/GND');
  });

  it('leaves an ordinary graphic with no net at all', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.SilkS"))',
    );
    expect(shapes(b)[0]!.GetNetCode()).toBe(0);
  });

  it('is written back out for a shape the editor drew', () => {
    const b = board('');
    draw(b, PCB_LAYER_ID.F_Cu, 1);
    expect(flatText(writtenNode(b, 'gr_line'))).toContain('(net "/uart/SDA")');
  });

  it('writes no net token for an unconnected graphic', () => {
    // `GetNetCode() > 0` — code 0 is the unconnected net and upstream omits the
    // token entirely rather than writing an empty name.
    const b = board('');
    draw(b, PCB_LAYER_ID.F_SilkS);
    expect(flatText(writtenNode(b, 'gr_line'))).not.toContain('(net');
  });
});

describe('the reader is not left holding a board it has finished with', () => {
  it('does not resolve a footprint file against the last board read', () => {
    // A `.kicad_mod` read has no board, so a net name in it binds to nothing -
    // not to whichever board happened to be parsed before it.
    board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))',
    );
    const fp = ParseFootprintFile(`(footprint "R_0805" (layer "F.Cu")
  (fp_line (start 0 0) (end 1 0) (stroke (width 0.1) (type solid)) (layer "F.Cu") (net "/uart/SDA"))
)`);
    // The constructor's `m_netinfo( NETINFO_LIST::OrphanedItem() )`
    // (board_connected_item.cpp:46), a NETINFO_ITEM with code UNCONNECTED, 0.
    expect((fp.GraphicalItems()[0] as PCB_SHAPE).GetNetCode()).toBe(0);
  });

  it('does not let one board declare a net into the next one', () => {
    board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/late/GND"))',
    );
    const b2 = ParseBoard(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
  (net 0 "")
)`);
    expect(b2.GetNetCount()).toBe(1);
  });
});
