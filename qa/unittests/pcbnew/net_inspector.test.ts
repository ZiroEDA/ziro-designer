// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Net Inspector's rows on a live BOARD.
 * Counterpart: `PCB_NET_INSPECTOR_PANEL::buildNetsList` / `netFilterMatches` /
 * `calculateNets` (pcb_net_inspector_panel.cpp:513-760) and LIST_ITEM.
 */
import { describe, expect, it } from 'vitest';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import { ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import {
  DEFAULT_NET_INSPECTOR_FILTER,
  netInspectorRows,
} from '@ziroeda/pcbnew/widgets/pcb_net_inspector_panel.js';

const MM = (n: number): number => mmToIU(n);
const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const pad = (num: string, x: number, net: number, name: string, extra = '') =>
  `(pad "${num}" smd rect (at ${x} 0) (size 1 1) (layers "F.Cu") (net ${net} "${name}") ${extra}(uuid "${U(100 + Number(num))}"))`;

const BOARD_TEXT = `(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")
  (general (thickness 1.6) (legacy_teardrops no)) (paper "A4")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "GND") (net 2 "VCC") (net 3 "N3") (net 4 "unconnected-(R1-Pad4)")
  (net 5 "TRK") (net 6 "N10") (net 7 "N9") (net 8 "/Sheet1/SDA{slash}A4")
  (footprint "R" (layer "F.Cu") (at 10 10) (uuid "${U(1)}")
    ${pad('1', -3, 1, 'GND', '(die_length 1.5) ')}
    ${pad('2', -1, 1, 'GND')}
    ${pad('3', 1, 2, 'VCC')}
    ${pad('4', 3, 4, 'unconnected-(R1-Pad4)')}
    ${pad('5', 5, 6, 'N10')}
    ${pad('6', 7, 7, 'N9')}
    ${pad('7', 9, 8, '/Sheet1/SDA{slash}A4')})
  (segment (start 0 30) (end 10 30) (width 0.2) (layer "F.Cu") (net 1) (uuid "${U(2)}"))
  (via (at 30 30) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1) (uuid "${U(3)}"))
  (segment (start 0 40) (end 5 40) (width 0.2) (layer "F.Cu") (net 5) (uuid "${U(4)}"))
)`;

function load(): BOARD {
  const board = ParseBoard(BOARD_TEXT);
  board.BuildConnectivity();
  return board;
}

describe('calculateNets', () => {
  it('counts pads and vias, and measures the wire and pad-to-die lengths', () => {
    const gnd = netInspectorRows(load()).find((r) => r.name === 'GND')!;

    expect(gnd.padCount).toBe(2);
    // NumVias counts only under m_UseHeightForLengthCalcs, which is on by default.
    expect(gnd.viaCount).toBe(1);
    // The one 10 mm segment, nowhere near a pad, so nothing is trimmed.
    expect(gnd.boardLength).toBe(MM(10));
    // Pad 1's (die_length 1.5); pad 2 has none.
    expect(gnd.padDieLength).toBe(MM(1.5));
    expect(gnd.netclass).toBe('Default');
  });

  it('lists only nets that have connectivity items and at least one pad', () => {
    // N3 has nothing on it (not in foundNets); TRK is a track with no pad
    // (NumPads == 0, m_showZeroPadNets off); the unconnected-( net is filtered.
    expect(netInspectorRows(load()).map((r) => r.name)).toEqual([
      '/Sheet1/SDA/A4',
      'GND',
      'N9',
      'N10',
      'VCC',
    ]);
  });

  it('shows the zero-pad net when asked', () => {
    const rows = netInspectorRows(load(), {
      ...DEFAULT_NET_INSPECTOR_FILTER,
      showZeroPadNets: true,
    });
    expect(rows.find((r) => r.name === 'TRK')).toMatchObject({ padCount: 0, boardLength: MM(5) });
    // Still not N3: it was never found among the connectivity items.
    expect(rows.some((r) => r.name === 'N3')).toBe(false);
  });

  it('shows the unconnected-( nets when asked', () => {
    const rows = netInspectorRows(load(), {
      ...DEFAULT_NET_INSPECTOR_FILTER,
      showUnconnectedNets: true,
    });
    expect(rows.some((r) => r.name === 'unconnected-(R1-Pad4)')).toBe(true);
  });
});

describe('netFilterMatches', () => {
  it('matches the net name case-insensitively', () => {
    const rows = netInspectorRows(load(), { ...DEFAULT_NET_INSPECTOR_FILTER, filterText: 'gn' });
    expect(rows.map((r) => r.name)).toEqual(['GND']);
  });

  it('matches the netclass name too, unless that is switched off', () => {
    const all = netInspectorRows(load(), { ...DEFAULT_NET_INSPECTOR_FILTER, filterText: 'defa' });
    expect(all).toHaveLength(5);

    const none = netInspectorRows(load(), {
      ...DEFAULT_NET_INSPECTOR_FILTER,
      filterText: 'defa',
      filterByNetclass: false,
    });
    expect(none).toHaveLength(0);
  });

  it('matches the shown (unescaped) name', () => {
    const rows = netInspectorRows(load(), {
      ...DEFAULT_NET_INSPECTOR_FILTER,
      filterText: 'SDA/A4',
    });
    expect(rows.map((r) => r.name)).toEqual(['/Sheet1/SDA/A4']);
  });
});
