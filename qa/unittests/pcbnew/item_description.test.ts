// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE::GetItemDescription` (zone.cpp).
 *
 * The sentence the disambiguation menu reads out. It matters because the case
 * the menu exists for is several pours of the *same net* stacked through a
 * board: the net is what they share, so the layer and the priority are the
 * only parts of the row that tell them apart.
 */
import { describe, it, expect } from 'vitest';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';
import {
  boardLayerName,
  netnameMsg,
  zoneItemDescription,
} from '@ziroeda/pcbnew/src/item_description.js';
import type { SList } from '@ziroeda/sexpr/src/index.js';

const EMPTY = { kind: 'list', items: [] } as unknown as SList;

const board = (over: Partial<Board> = {}): Board =>
  ({
    version: 20241229,
    layers: [
      { id: 0, name: 'F.Cu', kind: 'signal' },
      { id: 1, name: 'In1.Cu', kind: 'signal' },
      { id: 2, name: 'In2.Cu', kind: 'signal' },
      { id: 31, name: 'B.Cu', kind: 'signal' },
    ],
    nets: new Map([
      [0, ''],
      [1, 'GND'],
      [2, '+3.3V'],
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
    groups: [],
    source: EMPTY,
    ...over,
  }) as unknown as Board;

const zone = (over: Partial<PcbZone>): PcbZone =>
  ({ net: 1, layers: ['B.Cu'], fills: [], source: EMPTY, ...over }) as PcbZone;

describe('ZONE::GetItemDescription', () => {
  it('names the net, the layer and the priority', () => {
    // The exact row from pcbnew's menu over a three-pour stack.
    expect(zoneItemDescription(board(), zone({}))).toBe('Zone [GND] on B.Cu, priority 0');
  });

  it('separates two pours of one net by their layer', () => {
    const b = board();
    expect(zoneItemDescription(b, zone({ layers: ['In1.Cu'] }))).toBe(
      'Zone [GND] on In1.Cu, priority 0',
    );
    expect(zoneItemDescription(b, zone({ net: 2, layers: ['In2.Cu'] }))).toBe(
      'Zone [+3.3V] on In2.Cu, priority 0',
    );
  });

  it('carries the assigned priority', () => {
    expect(zoneItemDescription(board(), zone({ priority: 2 }))).toBe(
      'Zone [GND] on B.Cu, priority 2',
    );
  });

  it('quotes a named zone', () => {
    expect(zoneItemDescription(board(), zone({ name: 'analog' }))).toBe(
      "Zone 'analog' [GND] on B.Cu, priority 0",
    );
  });

  it('counts rather than lists past three layers', () => {
    const b = board();
    expect(zoneItemDescription(b, zone({ layers: ['F.Cu', 'B.Cu'] }))).toBe(
      'Zone [GND] on F.Cu and B.Cu, priority 0',
    );
    expect(zoneItemDescription(b, zone({ layers: ['F.Cu', 'In1.Cu', 'B.Cu'] }))).toBe(
      'Zone [GND] on F.Cu, In1.Cu and B.Cu, priority 0',
    );
    expect(zoneItemDescription(b, zone({ layers: ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] }))).toBe(
      'Zone [GND] on F.Cu, In1.Cu and 2 more, priority 0',
    );
  });

  it('says Rule Area for a keepout, with no net and no priority', () => {
    const ruleArea = { tracks: true } as unknown as PcbZone['ruleArea'];
    expect(zoneItemDescription(board(), zone({ net: 0, ruleArea }))).toBe('Rule Area on B.Cu');
    expect(zoneItemDescription(board(), zone({ net: 0, ruleArea, name: 'no-go' }))).toBe(
      "Rule area 'no-go' on B.Cu",
    );
  });

  it('says Teardrop for generated teardrop copper', () => {
    expect(zoneItemDescription(board(), zone({ teardropType: 'viapad' }))).toBe(
      'Teardrop [GND] on B.Cu',
    );
  });

  it('prints the bracketed placeholder when there is no net', () => {
    expect(zoneItemDescription(board(), zone({ net: 0 }))).toBe(
      'Zone [<no net>] on B.Cu, priority 0',
    );
  });

  it('prefers the user name of a renamed layer, like BOARD::GetLayerName', () => {
    const b = board({
      layers: [{ id: 31, name: 'B.Cu', kind: 'signal', userName: 'Ground plane' }],
    });
    expect(boardLayerName(b, 'B.Cu')).toBe('Ground plane');
    expect(zoneItemDescription(b, zone({}))).toBe('Zone [GND] on Ground plane, priority 0');
  });
});

describe('BOARD_CONNECTED_ITEM::GetNetnameMsg', () => {
  it('brackets the net', () => {
    expect(netnameMsg(board(), 1)).toBe('[GND]');
  });
  it('takes an item-carried name over the board table', () => {
    expect(netnameMsg(board(), 1, 'VBUS')).toBe('[VBUS]');
  });
  it('falls back to the placeholder', () => {
    expect(netnameMsg(board(), 99)).toBe('[<no net>]');
  });
});
