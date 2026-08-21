// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * BOARD::GetLayerName / LayerName — the name a layer wears in front of the
 * user (`pcbnew/board.cpp:737`, `common/layer_id.cpp:24`).
 *
 * Every expectation here is transcribed from that C++ or read off a real
 * KiCad window, never computed by calling the code under test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard, type Board } from '@ziroeda/pcbnew';
import { GetLayerName, LayerName } from '@ziroeda/pcbnew/src/layer_ids.js';
import { boardLayerName } from '@ziroeda/pcbnew/src/item_description.js';

const demo = (): Board =>
  readBoard(
    parse(
      readFileSync(
        new URL('../../../designer/public/demos/ecc83/ecc83-pp.kicad_pcb', import.meta.url),
        'utf8',
      ),
    ),
  );

describe('LayerName: the standard English name', () => {
  // The ten layers whose UI name differs from the token the file stores,
  // transcribed from the switch in common/layer_id.cpp:24.
  it.each([
    ['F.Adhes', 'F.Adhesive'],
    ['B.Adhes', 'B.Adhesive'],
    ['F.SilkS', 'F.Silkscreen'],
    ['B.SilkS', 'B.Silkscreen'],
    ['Dwgs.User', 'User.Drawings'],
    ['Cmts.User', 'User.Comments'],
    ['Eco1.User', 'User.Eco1'],
    ['Eco2.User', 'User.Eco2'],
    ['F.CrtYd', 'F.Courtyard'],
    ['B.CrtYd', 'B.Courtyard'],
  ])('spells %s as %s', (token, shown) => {
    expect(LayerName(token)).toBe(shown);
  });

  // The default branch of that switch formats In%d.Cu and User.%d, i.e. the
  // token itself; F.Cu/B.Cu/F.Mask/… return wxT() literals equal to the token.
  it.each(['F.Cu', 'B.Cu', 'In1.Cu', 'In7.Cu', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste'])(
    'leaves %s alone',
    (token) => {
      expect(LayerName(token)).toBe(token);
    },
  );

  it.each(['Edge.Cuts', 'Margin', 'F.Fab', 'B.Fab', 'User.1', 'User.45'])(
    'leaves %s alone',
    (token) => {
      expect(LayerName(token)).toBe(token);
    },
  );
});

describe("GetLayerName: the board's own name wins", () => {
  it("returns the board's user name when the file carries one", () => {
    expect(GetLayerName([{ name: 'F.Cu', userName: 'top_cu' }], 'F.Cu')).toBe('top_cu');
  });

  it('falls back to the standard name, not the file token, when there is none', () => {
    // The trap this replaced: `def?.userName || layer` returned 'F.SilkS'.
    expect(GetLayerName([{ name: 'F.SilkS' }], 'F.SilkS')).toBe('F.Silkscreen');
  });

  it('treats an empty user name as absent', () => {
    expect(GetLayerName([{ name: 'B.SilkS', userName: '' }], 'B.SilkS')).toBe('B.Silkscreen');
  });

  it('still names a layer the board does not list', () => {
    expect(GetLayerName([], 'Dwgs.User')).toBe('User.Drawings');
  });

  it('does not let one layer’s user name leak onto another', () => {
    const layers = [
      { name: 'F.Cu', userName: 'top_cu' },
      { name: 'B.Cu', userName: 'bottom_cu' },
      { name: 'F.SilkS' },
    ];
    expect(GetLayerName(layers, 'B.Cu')).toBe('bottom_cu');
    expect(GetLayerName(layers, 'F.SilkS')).toBe('F.Silkscreen');
  });
});

describe('the ecc83 demo board, as real pcbnew shows it', () => {
  // Read off a live KiCad 10.0.5 Appearance panel on this same file: the
  // Layers tab opens on `top_cu` and `bottom_cu`, and the aux-bar layer
  // selector reads `top_cu (PgUp)`.
  it('names the copper layers top_cu and bottom_cu', () => {
    const b = demo();
    expect(GetLayerName(b.layers, 'F.Cu')).toBe('top_cu');
    expect(GetLayerName(b.layers, 'B.Cu')).toBe('bottom_cu');
  });

  it('names the unrenamed technical layers with the standard name', () => {
    const b = demo();
    // `(13 "F.Paste" user)` and `(25 "Edge.Cuts" user)` carry no fourth token.
    expect(GetLayerName(b.layers, 'F.Paste')).toBe('F.Paste');
    expect(GetLayerName(b.layers, 'Edge.Cuts')).toBe('Edge.Cuts');
  });

  it('agrees with the names the file does carry', () => {
    const b = demo();
    expect(GetLayerName(b.layers, 'F.SilkS')).toBe('F.Silkscreen');
    expect(GetLayerName(b.layers, 'Dwgs.User')).toBe('User.Drawings');
  });
});

describe('boardLayerName delegates rather than reimplementing', () => {
  it('gives item descriptions the same answer as the Appearance panel', () => {
    const b = demo();
    for (const layer of ['F.Cu', 'B.Cu', 'F.SilkS', 'F.Paste', 'Edge.Cuts']) {
      expect(boardLayerName(b, layer)).toBe(GetLayerName(b.layers, layer));
    }
    // …and that shared answer is the right one, not merely a shared wrong one.
    expect(boardLayerName(b, 'F.Cu')).toBe('top_cu');
    expect(boardLayerName(b, 'F.SilkS')).toBe('F.Silkscreen');
  });
});
