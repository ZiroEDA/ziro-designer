// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_DRAW_PANEL_GAL`'s `GAL_LAYER_ORDER[]` against the C++ table itself:
 * the array in `pcbnew/pcb_draw_panel_gal.cpp` is parsed, every entry
 * evaluated through our layer ids and the macros (`ZONE_LAYER_FOR`, ...),
 * and the two sequences must be identical. The order is the rendering
 * order; one swapped pair draws copper over silk.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as L from '@ziroeda/common/layer_ids.js';
import { GAL_LAYER_ORDER } from '@ziroeda/pcbnew/pcb_draw_panel_gal.js';

const CPP = '/home/akshay/kicad-reference/pcbnew/pcb_draw_panel_gal.cpp';

/** One entry of the C++ initialiser: a name, `MACRO( name )`, or `name + n`. */
function evalEntry(aEntry: string): number {
  const entry = aEntry.trim();
  const macro = /^([A-Z_]+)\(\s*([A-Za-z0-9_]+)\s*\)$/.exec(entry);

  if (macro) {
    const fn = (L as unknown as Record<string, (l: number) => number>)[macro[1]!];
    expect(typeof fn, macro[1]).toBe('function');
    return fn!(evalEntry(macro[2]!));
  }

  const plus = /^([A-Za-z0-9_]+)\s*\+\s*(\d+)$/.exec(entry);

  if (plus) return evalEntry(plus[1]!) + Number(plus[2]);

  const enums = L as unknown as Record<string, unknown>;

  if (typeof enums[entry] === 'number') return enums[entry] as number;

  for (const key of ['GAL_LAYER_ID', 'PCB_LAYER_ID', 'NETNAMES_LAYER_ID']) {
    const e = enums[key] as Record<string, unknown>;

    if (typeof e[entry] === 'number') return e[entry] as number;
  }

  throw new Error(`unknown layer ${entry}`);
}

describe.skipIf(!existsSync(CPP))('PCB_DRAW_PANEL_GAL GAL_LAYER_ORDER', () => {
  it('is the C++ table, entry for entry', () => {
    const src = readFileSync(CPP, 'utf8');
    const start = src.indexOf('const int GAL_LAYER_ORDER[] =');
    const open = src.indexOf('{', start);
    const close = src.indexOf('};', open);
    const body = src
      .slice(open + 1, close)
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');

    const entries = body
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    expect(entries.length).toBeGreaterThan(400);

    const expected = entries.map(evalEntry);

    expect([...GAL_LAYER_ORDER]).toEqual(expected);
  });

  it('has no duplicate layer, and every one fits the VIEW', () => {
    expect(new Set(GAL_LAYER_ORDER).size).toBe(GAL_LAYER_ORDER.length);
    for (const layer of GAL_LAYER_ORDER) expect(layer).toBeLessThan(2048);
  });
});
