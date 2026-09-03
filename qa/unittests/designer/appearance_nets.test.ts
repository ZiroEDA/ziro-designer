// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Nets tab's list: which nets it holds and in what order.
 *
 * Both come from `NET_GRID_TABLE::Rebuild`
 * (pcbnew/widgets/appearance_controls.cpp:246-266), and neither could be
 * pinned while they were written inline in `PcbEditor.tsx`.
 *
 * The order is the one a user notices first, because the top of the list is
 * where the power nets live: KiCad's CM5_MINIMA_3 opens on +1V8, +3V3_PI, +5V
 * and +BATT, and ours opened on /CC1 with all four missing from view.
 */
import { describe, expect, it } from 'vitest';
import { appearanceNetRows } from '@ziroeda/designer/src/editors/pcb/appearance_nets.js';

const names = (rows: readonly (readonly [number, string])[]): string[] => rows.map(([, n]) => n);

describe('appearanceNetRows', () => {
  it('sorts by codepoint, so punctuation is a character and not a tie-breaker', () => {
    // `return a.name < b.name` on a wxString. '+' is 0x2B and '/' is 0x2F, so
    // every "+..." net precedes every "/..." one. `localeCompare` does not:
    // its default collation gives punctuation the lowest weight, which put
    // "+3V3_PI" among the "/CM5/..." names.
    const rows = appearanceNetRows(
      new Map([
        [7, '/CM5/BL_GPIO24'],
        [1, '+3V3_PI'],
        [4, '/CC1'],
        [2, '+5V'],
        [3, '+BATT'],
        [8, '+1V8'],
      ]),
    );
    expect(names(rows)).toEqual(['+1V8', '+3V3_PI', '+5V', '+BATT', '/CC1', '/CM5/BL_GPIO24']);
    // The mistake this replaces, stated so the difference is on the record.
    expect([...names(rows)].sort((a, b) => a.localeCompare(b))).not.toEqual(names(rows));
  });

  it('is case sensitive, because a codepoint comparison is', () => {
    // 'Z' is 0x5A and 'a' is 0x61, so every upper-case name comes first. A
    // collation would interleave them.
    expect(
      names(
        appearanceNetRows(
          new Map([
            [1, 'a'],
            [2, 'Z'],
          ]),
        ),
      ),
    ).toEqual(['Z', 'a']);
  });

  it('drops the unconnected pseudo-net and the auto-named pads with it', () => {
    // `netCode > 0 && !pair.first.StartsWith( "unconnected-(" )`. Filtering on
    // code 0 alone left every `unconnected-(...)` name in the list, which on a
    // partly-routed board is most of it.
    const rows = appearanceNetRows(
      new Map([
        [0, ''],
        [1, 'unconnected-(U1-PAD3)'],
        [2, 'GND'],
        [3, 'unconnected-(R4-Pad1)'],
      ]),
    );
    expect(names(rows)).toEqual(['GND']);
  });

  it('keeps a net whose name merely contains that prefix later on', () => {
    // StartsWith, not a substring search.
    expect(names(appearanceNetRows(new Map([[1, '/net-unconnected-(x)']])))).toEqual([
      '/net-unconnected-(x)',
    ]);
  });
});
