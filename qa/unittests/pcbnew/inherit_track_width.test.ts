// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Automatically select track width" — `PNS_KICAD_IFACE_BASE::inheritTrackWidth`
 * (pcbnew/router/pns_kicad_iface.cpp:982-1096).
 *
 * The TOP_AUX toggle this backs was a hardcoded `disabled: true` placeholder in
 * `pcbToolbars.ts`, which is why the one control KiCad shows *checked* on that
 * bar rendered greyed out in ours. A toggle that flips a flag nothing reads
 * would have looked just as wrong the moment anyone routed with it on, so the
 * width rule is ported with it.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { inheritTrackWidth } from '@ziroeda/pcbnew/src/inherit_track_width.js';

const MM = 1e6;

/**
 * A via at (20, 20) with three tracks meeting it: a wide one heading right on
 * F.Cu, a narrow one heading up on F.Cu, and a middling one on B.Cu.
 */
const board = readBoard(
  parse(`(kicad_pcb (version 20241229) (generator "test")
	(layers (0 "F.Cu" signal) (31 "B.Cu" signal))
	(net 0 "") (net 1 "a")
	(segment (start 20 20) (end 40 20) (width 0.5) (layer "F.Cu") (net 1))
	(segment (start 20 20) (end 20 5) (width 0.2) (layer "F.Cu") (net 1))
	(segment (start 20 20) (end 5 20) (width 0.35) (layer "B.Cu") (net 1))
	(via (at 20 20) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1))
)`),
);

const via = { kind: 'via' as const, at: { x: 20 * MM, y: 20 * MM } };

describe('branch 1 — the start item is itself a track or an arc', () => {
  it('takes its own width', () => {
    // `int itemTrackWidth = tryGetTrackWidth( aItem ); if( itemTrackWidth > 0 )`
    // — the branch that fires when a route begins on an existing trace.
    expect(
      inheritTrackWidth(
        board,
        { kind: 'track', width: 0.5 * MM, at: { x: 30 * MM, y: 20 * MM } },
        'F.Cu',
        null,
      ),
    ).toBe(0.5 * MM);
    expect(
      inheritTrackWidth(board, { kind: 'arc', width: 0.25 * MM, at: { x: 0, y: 0 } }, 'F.Cu', null),
    ).toBe(0.25 * MM);
  });

  it('falls through when the item has no width of its own', () => {
    // A zero width is `!( itemTrackWidth > 0 )`, and a track is not a joint, so
    // upstream's `default: return false` ends it.
    expect(
      inheritTrackWidth(
        board,
        { kind: 'track', width: 0, at: { x: 20 * MM, y: 20 * MM } },
        'F.Cu',
        null,
      ),
    ).toBeNull();
  });
});

describe('branch 2 — a via or pad, with the cursor pointing at an exit stub', () => {
  it('takes the track whose FAR end is nearest the cursor', () => {
    // "Since all tracks share the pad/via endpoint, the far-end direction is a
    // proxy for which exit stub the user is pointing at" (:1025-1027).
    // Cursor off to the right: the far end (40, 20) wins → the 0.5 mm track.
    expect(inheritTrackWidth(board, via, 'F.Cu', { x: 38 * MM, y: 21 * MM })).toBe(0.5 * MM);
    // Cursor above: the far end (20, 5) wins → the 0.2 mm track.
    expect(inheritTrackWidth(board, via, 'F.Cu', { x: 21 * MM, y: 7 * MM })).toBe(0.2 * MM);
  });

  it('only considers stubs on the start layer', () => {
    // `if( item->Layer() != m_startLayer ) continue;` — the B.Cu stub is the
    // nearest one to a cursor on the left, and is still skipped on F.Cu.
    expect(inheritTrackWidth(board, via, 'F.Cu', { x: 7 * MM, y: 20 * MM })).not.toBe(0.35 * MM);
  });

  it('starts from the B.Cu stub when the route starts on B.Cu', () => {
    expect(inheritTrackWidth(board, via, 'B.Cu', { x: 7 * MM, y: 20 * MM })).toBe(0.35 * MM);
  });
});

describe('branch 3 — the fallback minimum', () => {
  it('is the narrowest stub on the start layer when there is no cursor', () => {
    // "Fallback to minimum width when no start position provided": 0.2 mm is
    // the narrowest of the two F.Cu stubs.
    expect(inheritTrackWidth(board, via, 'F.Cu', null)).toBe(0.2 * MM);
  });

  it('is the narrowest on ANY layer when the start layer has none', () => {
    // `if( min_current_layer < INT_MAX ) … else *aInheritedWidth = min_all_layers;`
    expect(inheritTrackWidth(board, via, 'In1.Cu', null)).toBe(0.2 * MM);
  });
});

describe('what it refuses', () => {
  it('answers null at a joint with nothing on it', () => {
    // `if( linkedSegs.Empty() ) return false;` — the route then falls back to
    // the netclass / toolbar width, which is `ImportSizes`'s own next branch.
    expect(
      inheritTrackWidth(board, { kind: 'via', at: { x: 99 * MM, y: 99 * MM } }, 'F.Cu', null),
    ).toBeNull();
  });

  it('only a segment, arc, via or pad is a start item at all', () => {
    // A track endpoint counts, but the item kinds upstream's switch does not
    // name reach `default: return false`.
    expect(
      inheritTrackWidth(board, { kind: 'pad', at: { x: 20 * MM, y: 20 * MM } }, 'F.Cu', null),
    ).toBe(0.2 * MM);
  });
});
