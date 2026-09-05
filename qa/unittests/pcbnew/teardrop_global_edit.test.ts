// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Teardrops (DIALOG_GLOBAL_EDIT_TEARDROPS): the scope checkboxes, the
 * filter gauntlet, and the four actions.
 */
import { describe, it, expect } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import {
  applyGlobalTeardropEdit,
  countGlobalTeardropTargets,
  DEFAULT_GLOBAL_TEARDROP_EDIT,
  type GlobalTeardropEditOptions,
} from '@ziroeda/pcbnew/src/teardrop_global_edit.js';
import {
  defaultTeardropParameters,
  defaultTeardropParametersList,
} from '@ziroeda/pcbnew/src/teardrop.js';
import { fillZones } from '@ziroeda/pcbnew/src/zone_filler.js';
import type { Board, PcbFootprint, PcbPad, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const MM = (n: number): number => mmToIU(n);

const via = (at: { x: number; y: number }, over: Partial<PcbVia> = {}): PcbVia => ({
  at,
  size: MM(0.8),
  drill: MM(0.4),
  layers: ['F.Cu', 'B.Cu'],
  kind: 'through',
  net: 1,
  source: EMPTY,
  ...over,
});

const pad = (at: { x: number; y: number }, over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'smd',
  shape: 'circle',
  at,
  angle: 0,
  size: { x: MM(1.5), y: MM(1.5) },
  layers: ['F.Cu'],
  net: 1,
  source: EMPTY,
  ...over,
});

const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'R',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [],
  nets: new Map([
    [0, ''],
    [1, 'N1'],
    [2, 'N2'],
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

const opts = (over: Partial<GlobalTeardropEditOptions> = {}): GlobalTeardropEditOptions => ({
  ...DEFAULT_GLOBAL_TEARDROP_EDIT,
  ...over,
});

const ctx = () => ({ list: defaultTeardropParametersList() });

/** One via, one SMD pad, one PTH pad, each with a track running into it. */
const mixed = (): Board =>
  board({
    vias: [via({ x: MM(10), y: MM(10) })],
    footprints: [
      footprint([
        pad({ x: MM(20), y: MM(10) }),
        pad({ x: MM(30), y: MM(10) }, { type: 'thru_hole', shape: 'rect' }),
      ]),
    ],
    tracks: [
      {
        start: { x: MM(10), y: MM(10) },
        end: { x: MM(15), y: MM(10) },
        width: MM(0.25),
        layer: 'F.Cu',
        net: 1,
        source: EMPTY,
      },
      {
        start: { x: MM(20), y: MM(10) },
        end: { x: MM(25), y: MM(10) },
        width: MM(0.25),
        layer: 'F.Cu',
        net: 1,
        source: EMPTY,
      },
      {
        start: { x: MM(30), y: MM(10) },
        end: { x: MM(35), y: MM(10) },
        width: MM(0.25),
        layer: 'F.Cu',
        net: 1,
        source: EMPTY,
      },
    ],
  });

const enabledItems = (b: Board): number =>
  b.vias.filter((v) => v.teardrops?.enabled).length +
  b.footprints.flatMap((f) => f.pads).filter((p) => p.teardrops?.enabled).length;

describe('action: add teardrops with default values', () => {
  it('enables every item in scope and generates zones for them', () => {
    const out = applyGlobalTeardropEdit(mixed(), opts(), ctx());

    expect(enabledItems(out.board)).toBe(3);
    expect(out.board.zones.length).toBeGreaterThanOrEqual(3);
    expect(out.board.zones.every((z) => z.teardropType === 'viapad')).toBe(true);
  });

  it('takes the round parameters for round items and the rect ones otherwise', () => {
    const list = defaultTeardropParametersList();
    list.round = { ...list.round, curvedEdges: true };
    list.rect = { ...list.rect, curvedEdges: false };

    const out = applyGlobalTeardropEdit(mixed(), opts(), { list });

    expect(out.board.vias[0]!.teardrops!.curvedEdges).toBe(true);
    const pads = out.board.footprints[0]!.pads;
    expect(pads[0]!.teardrops!.curvedEdges).toBe(true); // circle
    expect(pads[1]!.teardrops!.curvedEdges).toBe(false); // rect
  });

  it('saves the scope checkboxes into the returned parameters list', () => {
    const out = applyGlobalTeardropEdit(
      mixed(),
      opts({ vias: false, pthPads: false, trackToTrack: true, roundPadsOnly: true }),
      ctx(),
    );

    expect(out.list.targetVias).toBe(false);
    expect(out.list.targetPTHPads).toBe(false);
    expect(out.list.targetSMDPads).toBe(true);
    expect(out.list.targetTrack2Track).toBe(true);
    expect(out.list.useRoundShapesOnly).toBe(true);
  });
});

describe('scope', () => {
  it('leaves vias alone when the Vias box is off', () => {
    const out = applyGlobalTeardropEdit(mixed(), opts({ vias: false }), ctx());

    expect(out.board.vias[0]!.teardrops).toBeUndefined();
    expect(enabledItems(out.board)).toBe(2);
  });

  it('splits PTH from SMD pads', () => {
    const smdOnly = applyGlobalTeardropEdit(mixed(), opts({ pthPads: false }), ctx());
    const pads = smdOnly.board.footprints[0]!.pads;

    expect(pads[0]!.teardrops?.enabled).toBe(true);
    expect(pads[1]!.teardrops).toBeUndefined();

    const pthOnly = applyGlobalTeardropEdit(mixed(), opts({ smdPads: false }), ctx());
    const pads2 = pthOnly.board.footprints[0]!.pads;

    expect(pads2[0]!.teardrops).toBeUndefined();
    expect(pads2[1]!.teardrops?.enabled).toBe(true);
  });
});

describe('filters', () => {
  it('filters by net', () => {
    const b = mixed();
    b.vias[0]!.net = 2;

    const out = applyGlobalTeardropEdit(b, opts({ netFilter: 1 }), ctx());

    expect(out.board.vias[0]!.teardrops).toBeUndefined();
    expect(enabledItems(out.board)).toBe(2);
  });

  it('filters by layer', () => {
    const out = applyGlobalTeardropEdit(mixed(), opts({ layerFilter: 'B.Cu' }), ctx());
    expect(enabledItems(out.board)).toBe(0);
  });

  it('filters to round pads only', () => {
    const out = applyGlobalTeardropEdit(mixed(), opts({ roundPadsOnly: true }), ctx());
    const pads = out.board.footprints[0]!.pads;

    expect(pads[0]!.teardrops?.enabled).toBe(true);
    expect(pads[1]!.teardrops).toBeUndefined(); // the rect one
  });

  it('filters to existing teardrops only, and does not enable what was off', () => {
    const b = mixed();
    b.vias[0]!.teardrops = { ...defaultTeardropParameters(), enabled: true };

    const out = applyGlobalTeardropEdit(
      b,
      opts({ action: 'specified', existingOnly: true, specified: { curvedEdges: true } }),
      ctx(),
    );

    expect(out.board.vias[0]!.teardrops!.curvedEdges).toBe(true);
    // The pads had no teardrops, so the filter skipped them entirely.
    expect(out.board.footprints[0]!.pads.every((p) => p.teardrops === undefined)).toBe(true);
  });

  it('filters to the selection', () => {
    const b = mixed();
    const target = b.vias[0]!;

    const out = applyGlobalTeardropEdit(b, opts({ selectedOnly: true }), {
      ...ctx(),
      isSelected: (item) => item === target,
    });

    expect(out.board.vias[0]!.teardrops?.enabled).toBe(true);
    expect(out.board.footprints[0]!.pads.every((p) => p.teardrops === undefined)).toBe(true);
  });

  it('matches nothing on a netclass filter when no resolver is supplied', () => {
    const out = applyGlobalTeardropEdit(mixed(), opts({ netclassFilter: 'Power' }), ctx());
    expect(enabledItems(out.board)).toBe(0);

    const resolved = applyGlobalTeardropEdit(mixed(), opts({ netclassFilter: 'Power' }), {
      ...ctx(),
      netclassOf: (net) => (net === 1 ? ['Power'] : []),
    });
    expect(enabledItems(resolved.board)).toBe(3);
  });
});

describe('action: remove', () => {
  const enabledBoard = (): Board => applyGlobalTeardropEdit(mixed(), opts(), ctx()).board;

  it('clears enabled on the filtered items and drops their zones', () => {
    const out = applyGlobalTeardropEdit(enabledBoard(), opts({ action: 'remove' }), ctx());

    expect(enabledItems(out.board)).toBe(0);
    expect(out.board.zones).toHaveLength(0);
  });

  it('honours the filters', () => {
    const out = applyGlobalTeardropEdit(
      enabledBoard(),
      opts({ action: 'remove', roundPadsOnly: true }),
      ctx(),
    );

    // The rect pad kept its teardrop; the round items lost theirs.
    expect(out.board.footprints[0]!.pads[1]!.teardrops!.enabled).toBe(true);
    expect(out.board.vias[0]!.teardrops!.enabled).toBe(false);
  });

  it('remove-all ignores the filters', () => {
    const out = applyGlobalTeardropEdit(
      enabledBoard(),
      opts({ action: 'removeAll', roundPadsOnly: true, netFilter: 999, vias: false }),
      ctx(),
    );

    expect(enabledItems(out.board)).toBe(0);
  });

  it('remove-all still respects "selected items only"', () => {
    const b = enabledBoard();
    const target = b.vias[0]!;

    const out = applyGlobalTeardropEdit(b, opts({ action: 'removeAll', selectedOnly: true }), {
      ...ctx(),
      isSelected: (item) => item === target,
    });

    expect(out.board.vias[0]!.teardrops!.enabled).toBe(false);
    expect(out.board.footprints[0]!.pads.every((p) => p.teardrops!.enabled)).toBe(true);
  });
});

describe('action: specified values', () => {
  it('overlays only the fields given, leaving the rest untouched', () => {
    const b = mixed();
    b.vias[0]!.teardrops = {
      ...defaultTeardropParameters(),
      enabled: true,
      tdMaxLen: MM(3),
      bestWidthRatio: 0.42,
    };

    const out = applyGlobalTeardropEdit(
      b,
      opts({ action: 'specified', specified: { curvedEdges: true } }),
      ctx(),
    );

    const td = out.board.vias[0]!.teardrops!;
    expect(td.curvedEdges).toBe(true);
    // The indeterminate fields survived.
    expect(td.tdMaxLen).toBe(MM(3));
    expect(td.bestWidthRatio).toBe(0.42);
  });

  it('enables items it touches unless the existing-only filter is on', () => {
    const out = applyGlobalTeardropEdit(
      mixed(),
      opts({ action: 'specified', specified: { tdMaxWidth: MM(1) } }),
      ctx(),
    );

    expect(enabledItems(out.board)).toBe(3);
    expect(out.board.vias[0]!.teardrops!.tdMaxWidth).toBe(MM(1));
  });
});

describe('countGlobalTeardropTargets', () => {
  it('reports what the current options would touch, changing nothing', () => {
    const b = mixed();

    expect(countGlobalTeardropTargets(b, opts(), ctx())).toBe(3);
    expect(countGlobalTeardropTargets(b, opts({ vias: false }), ctx())).toBe(2);
    expect(countGlobalTeardropTargets(b, opts({ roundPadsOnly: true }), ctx())).toBe(2);
    expect(b.vias[0]!.teardrops).toBeUndefined();
  });
});

describe('the zone filler and teardrops', () => {
  it('leaves a teardrop zone’s fill exactly as the generator made it', () => {
    const withTeardrops = applyGlobalTeardropEdit(mixed(), opts(), ctx()).board;
    const before = withTeardrops.zones.map((z) => z.fills[0]!.polys[0]);

    const refilled = fillZones(withTeardrops);

    expect(refilled.zones.map((z) => z.fills[0]!.polys[0])).toEqual(before);
  });
});
