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
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { buildBoardShapeNode } from '@ziroeda/pcbnew/src/write-board.js';
import { serialize } from '@ziroeda/sexpr/src/serializer.js';

const board = (body: string) =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "/uart/SDA")
${body}
)`),
  );

describe('a copper graphic carrying a net', () => {
  it('reads a net NAME, the shape 10.0 writes', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))',
    );
    expect(b.shapes[0]!.net).toBe(1);
  });

  it('reads a net CODE, the legacy pre-10.0 shape', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net 1))',
    );
    expect(b.shapes[0]!.net).toBe(1);
  });

  it('declares a net the file names but never listed', () => {
    // `FindNet` misses, so upstream creates the NETINFO_ITEM and adds it to the
    // board rather than dropping the reference. Two shapes naming it must land
    // on the same net, which is the part that makes it a net and not a label.
    const b = board(
      `  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/late/GND"))
  (gr_line (start 30 10) (end 40 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/late/GND"))`,
    );
    const code = b.shapes[0]!.net!;
    expect(code).toBeGreaterThan(0);
    expect(b.shapes[1]!.net).toBe(code);
    expect(b.nets.get(code)).toBe('/late/GND');
  });

  it('leaves an ordinary graphic with no net at all', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.SilkS"))',
    );
    expect(b.shapes[0]!.net).toBeUndefined();
  });

  it('keeps the name beside the code, as a zone does', () => {
    const b = board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))',
    );
    expect(b.shapes[0]!.netName).toBe('/uart/SDA');
  });

  it('is written back out by a builder that had no source to copy', () => {
    // An existing shape round-trips through `source`; a newly drawn one goes
    // through the builder, which had no `(net …)` at all. That is the load-side
    // bug of #631 arriving from the other direction, so it gets its own test.
    const node = buildBoardShapeNode({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 1e6, y: 0 },
      width: 2e5,
      fill: false,
      layer: 'F.Cu',
      net: 1,
      netName: '/uart/SDA',
      source: { kind: 'list', items: [] },
    });
    expect(serialize(node)).toContain('(net "/uart/SDA")');
  });

  it('writes no net token for an unconnected graphic', () => {
    // `GetNetCode() > 0` — code 0 is the unconnected net and upstream omits the
    // token entirely rather than writing an empty name.
    const node = buildBoardShapeNode({
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 1e6, y: 0 },
      width: 2e5,
      fill: false,
      layer: 'F.SilkS',
      source: { kind: 'list', items: [] },
    });
    expect(serialize(node)).not.toContain('(net');
  });
});

describe('the reader is not left holding a board it has finished with', () => {
  it('does not resolve a later board against an earlier one', () => {
    // A `.kicad_mod` has no board and its graphics carry no net. If the
    // resolver were left set, a name in one would silently bind to whatever
    // board happened to be parsed before it.
    board(
      '  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))',
    );
    const b2 = readBoard(
      parse(`(kicad_pcb (version 20241229) (generator "test")
  (layers (0 "F.Cu" signal))
  (net 0 "")
  (gr_line (start 10 10) (end 20 10) (stroke (width 0.2) (type solid)) (layer "F.Cu") (net "/uart/SDA"))
)`),
    );
    // A fresh board: the name is unknown here, so it is declared here, not
    // borrowed from the previous parse.
    expect(b2.nets.get(b2.shapes[0]!.net!)).toBe('/uart/SDA');
    expect(b2.nets.size).toBe(2);
  });
});
