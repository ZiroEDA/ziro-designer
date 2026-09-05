// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Edit Track & Via Properties" — the scope, the filters, and what they set.
 * Counterparts: `DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS::visitItem` and
 * `PCB_EDIT_FRAME::SetTrackSegmentWidth`.
 *
 * The interesting cases are all places where the dialog does something its own
 * UI does not suggest: arcs have no checkbox and ride the tracks one, a via's
 * layers can never be changed even though a layer *filter* selects vias, a
 * microvia ignores the size you typed, and net 0 is a real filter value that a
 * truthiness test would silently discard.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGlobalTrackViaEdit,
  countGlobalTrackViaTargets,
  passesGlobalTrackViaFilters,
} from '@ziroeda/pcbnew/src/global_edit_tracks_and_vias.js';
import type { Board, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

const track = (over: Record<string, unknown> = {}) => ({
  start: P(0, 0),
  end: P(1000, 0),
  width: 250_000,
  layer: 'F.Cu',
  net: 1,
  source: EMPTY,
  ...over,
});
const arc = (over: Record<string, unknown> = {}) => ({ ...track(), mid: P(500, 100), ...over });
const via = (over: Partial<PcbVia> = {}): PcbVia => ({
  at: P(0, 0),
  size: 800_000,
  drill: 400_000,
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
  ],
  nets: new Map([
    [0, ''],
    [1, 'A'],
    [2, 'B'],
  ]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** Everything in scope, nothing filtered. */
const ALL = { tracks: true, throughVias: true, microVias: true, blindVias: true };

describe('the netclass filter is a name, not a pattern', () => {
  it('compares the chosen netclass name for equality', () => {
    // dialog_global_edit_tracks_and_vias.cpp:365 —
    // `netclass->ContainsNetclassWithName( filterNetclass )`, where
    // filterNetclass is `m_netclassFilter->GetStringSelection()`, one entry of
    // a wxChoice of the board's netclasses. There is no wildcard here.
    const b = board({ tracks: [track({ net: 1 })] });
    const ctx = { netclassOf: () => ['PowerRail'] };
    const pass = (netclassFilter: string): boolean =>
      passesGlobalTrackViaFilters(b, 'track', 0, { ...ALL, netclassFilter }, ctx);

    expect(pass('PowerRail')).toBe(true);
    expect(pass('Power*')).toBe(false);
    expect(pass('Power')).toBe(false);
    expect(pass('powerrail')).toBe(false);
  });

  it('searches every constituent class of the net, not one aggregate name', () => {
    const b = board({ tracks: [track({ net: 1 })] });
    const ctx = { netclassOf: () => ['Default', 'HighSpeed'] };

    expect(
      passesGlobalTrackViaFilters(b, 'track', 0, { ...ALL, netclassFilter: 'HighSpeed' }, ctx),
    ).toBe(true);
  });
});

describe('the filters', () => {
  it('treats net 0 as a real filter value', () => {
    // Unconnected copper is exactly what someone filtering for net 0 wants.
    // `if (opts.netFilter)` would discard the filter and edit the whole board.
    const b = board({ tracks: [track({ net: 0 }), track({ net: 1 })] });

    expect(passesGlobalTrackViaFilters(b, 'track', 0, { ...ALL, netFilter: 0 }, {})).toBe(true);
    expect(passesGlobalTrackViaFilters(b, 'track', 1, { ...ALL, netFilter: 0 }, {})).toBe(false);
  });

  it('is inert when the net filter is negative', () => {
    // A ticked checkbox with no net chosen: upstream gates on `>= 0`.
    const b = board({ tracks: [track({ net: 7 })] });

    expect(passesGlobalTrackViaFilters(b, 'track', 0, { ...ALL, netFilter: -1 }, {})).toBe(true);
  });

  it('filters vias by their start layer', () => {
    // A via has no single layer, but the layer filter still applies to it —
    // which is how the dialog can select vias by layer while being unable to
    // change a via's layers at all.
    const b = board({ vias: [via({ layers: ['In1.Cu', 'B.Cu'] })] });

    expect(passesGlobalTrackViaFilters(b, 'via', 0, { ...ALL, layerFilter: 'In1.Cu' }, {})).toBe(
      true,
    );
    expect(passesGlobalTrackViaFilters(b, 'via', 0, { ...ALL, layerFilter: 'F.Cu' }, {})).toBe(
      false,
    );
  });

  it('applies the width filter to arcs as well as tracks', () => {
    const b = board({ arcs: [arc({ width: 250_000 }), arc({ width: 500_000 })] });

    expect(
      passesGlobalTrackViaFilters(b, 'arc', 0, { ...ALL, trackWidthFilter: 250_000 }, {}),
    ).toBe(true);
    expect(
      passesGlobalTrackViaFilters(b, 'arc', 1, { ...ALL, trackWidthFilter: 250_000 }, {}),
    ).toBe(false);
  });

  it('passes an item whose ancestor group is selected, however deep', () => {
    // An unselected item rides a selected group. It has to walk *up*, not stop
    // at the top-level group, or a selected inner group selects nothing.
    const b = board({
      tracks: [track({ uuid: 't-1' })],
      groups: [
        { name: 'inner', uuid: 'g-inner', members: ['t-1'], source: EMPTY },
        { name: 'outer', uuid: 'g-outer', members: ['g-inner'], source: EMPTY },
      ],
    });
    const opts = { ...ALL, selectedOnly: true };

    expect(
      passesGlobalTrackViaFilters(b, 'track', 0, opts, { isSelected: (id) => id === 'g-outer' }),
    ).toBe(true);
    expect(
      passesGlobalTrackViaFilters(b, 'track', 0, opts, { isSelected: (id) => id === 'g-inner' }),
    ).toBe(true);
    expect(passesGlobalTrackViaFilters(b, 'track', 0, opts, { isSelected: () => false })).toBe(
      false,
    );
  });

  it('does not spin on a group cycle', () => {
    // Malformed input, not a real board — but the walk must terminate.
    const b = board({
      tracks: [track({ uuid: 't-1' })],
      groups: [
        { name: 'a', uuid: 'g-a', members: ['t-1', 'g-b'], source: EMPTY },
        { name: 'b', uuid: 'g-b', members: ['g-a'], source: EMPTY },
      ],
    });

    expect(
      passesGlobalTrackViaFilters(
        b,
        'track',
        0,
        { ...ALL, selectedOnly: true },
        { isSelected: () => false },
      ),
    ).toBe(false);
  });
});

describe('the scope boxes', () => {
  it('lets arcs ride the tracks checkbox', () => {
    // There is no arc scope anywhere in the dialog.
    const b = board({ arcs: [arc()] });
    const out = applyGlobalTrackViaEdit(b, { ...ALL, trackWidth: 500_000 }, {});

    expect(out.changed).toBe(1);
    expect(out.board.arcs[0]!.width).toBe(500_000);
  });

  it('leaves arcs alone when tracks are out of scope', () => {
    const b = board({ arcs: [arc()] });

    expect(
      applyGlobalTrackViaEdit(b, { ...ALL, tracks: false, trackWidth: 500_000 }, {}).changed,
    ).toBe(0);
  });

  it('gates each via kind on its own box', () => {
    const b = board({
      vias: [via({ kind: 'through' }), via({ kind: 'blind' }), via({ kind: 'micro' })],
    });
    const opts = {
      tracks: false,
      throughVias: true,
      microVias: false,
      blindVias: false,
      viaSize: { diameter: 900_000, drill: 500_000 },
    };
    const out = applyGlobalTrackViaEdit(b, opts, {});

    expect(out.changed).toBe(1);
    expect(out.board.vias[0]!.size).toBe(900_000);
    expect(out.board.vias[1]).toBe(b.vias[1]);
    expect(out.board.vias[2]).toBe(b.vias[2]);
  });
});

describe('what it sets', () => {
  it('never changes a via’s layers, even when the layer action is set', () => {
    // The layer sub-action is guarded by `(isArc || isTrack)`. A via selected
    // by the layer filter still keeps its own layer pair.
    const b = board({ vias: [via({ layers: ['F.Cu', 'B.Cu'] })] });
    const out = applyGlobalTrackViaEdit(b, { ...ALL, layer: 'In1.Cu' }, {});

    expect(out.board.vias[0]!.layers).toEqual(['F.Cu', 'B.Cu']);
  });

  it('makes a microvia ignore the size you typed', () => {
    // `GetViaType() == MICROVIA` is tested *before* the generic via branch, so
    // the netclass microvia size wins outright rather than as a fallback.
    const b = board({ vias: [via({ kind: 'micro', net: 1 })] });
    const out = applyGlobalTrackViaEdit(
      b,
      { ...ALL, viaSize: { diameter: 900_000, drill: 500_000 } },
      { netclassUViaOf: () => ({ diameter: 300_000, drill: 150_000 }) },
    );

    expect(out.board.vias[0]!.size).toBe(300_000);
    expect(out.board.vias[0]!.drill).toBe(150_000);
  });

  it('keeps the existing hole when the chosen drill is zero', () => {
    // GetCurrentViaDrill() returns -1 for a zero drill and the `<= 0` guard
    // then keeps the via's own hole, so the pad resizes and the hole does not.
    const b = board({ vias: [via({ size: 800_000, drill: 400_000 })] });
    const out = applyGlobalTrackViaEdit(
      b,
      { ...ALL, viaSize: { diameter: 900_000, drill: 0 } },
      {},
    );

    expect(out.board.vias[0]!.size).toBe(900_000);
    expect(out.board.vias[0]!.drill).toBe(400_000);
  });

  it('leaves a property alone when the action is indeterminate', () => {
    // An absent field is INDETERMINATE_ACTION, not "set it to zero".
    const b = board({ tracks: [track({ width: 250_000, layer: 'F.Cu' })] });
    const out = applyGlobalTrackViaEdit(b, { ...ALL, layer: 'B.Cu' }, {});

    expect(out.board.tracks[0]!.width).toBe(250_000);
    expect(out.board.tracks[0]!.layer).toBe('B.Cu');
  });

  it('returns the same board when nothing matched', () => {
    // No undo entry for a run that changed nothing.
    const b = board({ tracks: [track()] });
    const out = applyGlobalTrackViaEdit(b, { ...ALL, netFilter: 99, trackWidth: 500_000 }, {});

    expect(out.board).toBe(b);
    expect(out.changed).toBe(0);
  });

  it('returns the same board when the new value equals the old one', () => {
    const b = board({ tracks: [track({ width: 250_000 })] });

    expect(applyGlobalTrackViaEdit(b, { ...ALL, trackWidth: 250_000 }, {}).board).toBe(b);
  });
});

describe('counting what will be touched', () => {
  it('agrees with what apply actually changes', () => {
    // The preview and the effect share one gauntlet, so they cannot drift.
    const b = board({
      tracks: [track({ net: 1 }), track({ net: 2 })],
      arcs: [arc({ net: 1 })],
      vias: [via({ net: 1 }), via({ net: 2, kind: 'blind' })],
    });
    const opts = {
      ...ALL,
      netFilter: 1,
      trackWidth: 500_000,
      viaSize: { diameter: 900_000, drill: 500_000 },
    };

    expect(countGlobalTrackViaTargets(b, opts, {})).toBe(3);
    expect(applyGlobalTrackViaEdit(b, opts, {}).changed).toBe(3);
  });

  it('does not count vias whose kind is out of scope', () => {
    const b = board({ vias: [via({ kind: 'micro' }), via({ kind: 'through' })] });

    expect(countGlobalTrackViaTargets(b, { ...ALL, microVias: false }, {})).toBe(1);
  });
});
