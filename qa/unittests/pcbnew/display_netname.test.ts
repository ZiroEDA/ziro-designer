// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A net name shown to a person is unescaped; a net name used as a key is not.
 *
 * Reported as issue #626: the board drew `SDA{slash}A4` on its pads and tracks.
 * `{slash}` is not a name anybody chose — it is how `EscapeString( …,
 * CTX_NETNAME )` stores a `/` that belongs to a *label's own name*, in a file
 * where `/` already separates hierarchy. Every painter site computed the short
 * net name inline with `slice( lastIndexOf( '/' ) + 1 )` and drew the result
 * raw, so the escape reached the screen.
 *
 * Upstream has one accessor — `BOARD_CONNECTED_ITEM::GetDisplayNetname()`,
 * `UnescapeString( shortNetname )` — and five painter call sites reach for it
 * (`pcb_painter.cpp`: track segment, arc, via, pad, shape). Having one here too
 * is the point: five inline copies is exactly how four of them stayed wrong.
 *
 * The other half of this is the part that must NOT change. DRC rules match
 * `A.NetName == '…'` against the stored name, and netclass assignments are
 * keyed by it, so unescaping before a lookup would silently match nothing.
 * Both directions are asserted here, because only fixing one of them is how
 * this bug turns into a worse one.
 */
import { describe, expect, it } from 'vitest';
import { displayNetname, shortNetname } from '@ziroeda/pcbnew/src/netinfo.js';
import { netnameMsg } from '@ziroeda/pcbnew/src/item_description.js';
import { netInspectorRows } from '@ziroeda/pcbnew/src/net_inspector.js';
import { escapeNetName, unescapeString } from '@ziroeda/common/src/string_utils.js';
import type { Board, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

const board = (nets: [number, string][]): Board =>
  ({
    version: 20241229,
    layers: [{ id: 0, name: 'F.Cu', kind: 'signal' }],
    nets: new Map(nets),
    tracks: [],
    arcs: [],
    vias: [],
    zones: [],
    footprints: [],
    shapes: [],
    texts: [],
    source: EMPTY,
  }) as unknown as Board;

describe('the short net name', () => {
  it('splits on the hierarchy separator only', () => {
    // `/` between sheets is structure; a `/` inside a label's own name is
    // written `{slash}` precisely so this split cannot see it.
    expect(shortNetname('/Sheet1/SDA{slash}A4')).toBe('SDA{slash}A4');
    expect(shortNetname('GND')).toBe('GND');
  });

  it('splits before unescaping, never after', () => {
    // The ordering is the whole reason the escape exists. Unescape first and
    // `SDA{slash}A4` becomes `SDA/A4`, whose "short name" is then `A4` — a
    // different net's name, shown with total confidence.
    expect(displayNetname('/Sheet1/SDA{slash}A4')).toBe('SDA/A4');
    expect(displayNetname(unescapeString('/Sheet1/SDA{slash}A4'))).not.toBe('SDA/A4');
  });
});

describe('what a painter draws', () => {
  it('unescapes, so a slash in a label name reads as a slash', () => {
    expect(displayNetname(escapeNetName('SDA/A4'))).toBe('SDA/A4');
  });

  it('leaves an ordinary name alone', () => {
    expect(displayNetname('/Power/GND')).toBe('GND');
    expect(displayNetname('')).toBe('');
  });

  it('does not mistake markup for an escape', () => {
    // `${VAR}` is a text variable and `~{…}` an overbar: `unescapeString` keeps
    // a braced group whose introducer is `$ ~ ^ _`, and a net name may hold one.
    expect(displayNetname('${VAR}')).toBe('${VAR}');
  });
});

describe('what a description says', () => {
  it('unescapes the full name, not the short one', () => {
    // A description names the whole path — `GetNetnameMsg` is `UnescapeString(
    // GetNetname() )`, the full net name, where a painter takes the short one.
    expect(netnameMsg(board([[1, '/Sheet1/SDA{slash}A4']]), 1)).toBe('[/Sheet1/SDA/A4]');
  });

  it('still says [<no net>] for no net at all', () => {
    expect(netnameMsg(board([]), 99)).toBe('[<no net>]');
  });
});

describe('what the Net Inspector lists', () => {
  const pad = (net: number): PcbPad =>
    ({
      number: '1',
      type: 'smd',
      shape: 'rect',
      at: { x: 0, y: 0 },
      angle: 0,
      size: { x: 1, y: 1 },
      layers: ['F.Cu'],
      net,
      source: EMPTY,
    }) as unknown as PcbPad;

  const withPad = (name: string): Board => {
    const b = board([[1, name]]);
    return {
      ...b,
      footprints: [{ pads: [pad(1)], at: { x: 0, y: 0 }, angle: 0, source: EMPTY }],
    } as unknown as Board;
  };

  it('shows the name unescaped', () => {
    const rows = netInspectorRows(withPad('/Sheet1/SDA{slash}A4'));
    expect(rows.map((r) => r.name)).toEqual(['/Sheet1/SDA/A4']);
  });

  it('looks the netclass up by the STORED name, not the shown one', () => {
    // The half that must not move. Netclass assignments are keyed by the
    // escaped name; unescaping before the lookup matches nothing, and the
    // column silently empties for exactly the nets this bug was about.
    const seen: string[] = [];
    const rows = netInspectorRows(withPad('/Sheet1/SDA{slash}A4'), (n) => {
      seen.push(n);
      return n === '/Sheet1/SDA{slash}A4' ? ['HighSpeed'] : [];
    });
    expect(seen).toContain('/Sheet1/SDA{slash}A4');
    expect(rows[0]!.netclass).toBe('HighSpeed');
  });
});
