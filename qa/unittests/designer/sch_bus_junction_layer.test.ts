// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A junction dot on a bus is a BUS junction, and takes the bus-junction colour.
 *
 * KiCad decides this in the connection graph, not in the painter:
 *
 *     else if( connected_item->Type() == SCH_JUNCTION_T )
 *         connected_item->SetLayer( busLine ? LAYER_BUS_JUNCTION : LAYER_JUNCTION );
 *     (`connection_graph.cpp:1451-1454`)
 *
 * with `busLine = screen->GetBus( point )`. Ours had no such step at all, so
 * every dot painted in LAYER_JUNCTION's green — and on a bus-heavy sheet, where
 * telling a bus junction from a wire junction is most of what the colour is
 * for, they all looked the same.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readSchematic } from '@ziroeda/eeschema';
import { busJunctionIds } from '@ziroeda/eeschema/src/connectivity/bus.js';

const doc = (body: string) =>
  readSchematic(
    parse(`(kicad_sch (version 20250114) (generator "eeschema")
${body}
  (sheet_instances (path "/" (page "1"))))`),
  );

const wire = (uuid: string, x1: number, y1: number, x2: number, y2: number): string =>
  `  (wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const bus = (uuid: string, x1: number, y1: number, x2: number, y2: number): string =>
  `  (bus (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0) (type default)) (uuid "${uuid}"))`;

const junction = (uuid: string, x: number, y: number): string =>
  `  (junction (at ${x} ${y}) (diameter 0) (color 0 0 0 0) (uuid "${uuid}"))`;

describe('which junctions the graph puts on the bus layer', () => {
  it('is the one sitting on a bus', () => {
    const d = doc(
      [bus('b1', 0, 0, 40, 0), bus('b2', 20, 0, 20, 20), junction('j1', 20, 0)].join('\n'),
    );
    expect([...busJunctionIds(d)]).toEqual(['j1']);
  });

  it('is not the one sitting only on wires', () => {
    const d = doc(
      [wire('w1', 0, 0, 40, 0), wire('w2', 20, 0, 20, 20), junction('j1', 20, 0)].join('\n'),
    );
    expect([...busJunctionIds(d)]).toEqual([]);
  });

  /**
   * `GetBus` searches `ENTIRE_LENGTH_T` (`sch_screen.h:451-455`), so a junction
   * in the MIDDLE of a bus counts — which is the ordinary case, a bus tapped by
   * a second bus partway along.
   */
  it('counts a junction partway along a bus, not only at its ends', () => {
    const d = doc([bus('b1', 0, 0, 40, 0), junction('j1', 17, 0)].join('\n'));
    expect([...busJunctionIds(d)]).toEqual(['j1']);
  });

  it('does not count one merely near the bus', () => {
    const d = doc([bus('b1', 0, 0, 40, 0), junction('j1', 17, 1)].join('\n'));
    expect([...busJunctionIds(d)]).toEqual([]);
  });

  it('separates the two on a sheet that has both', () => {
    // The case the colour exists for: one dot on the wires, one on the bus.
    const d = doc(
      [
        wire('w1', 0, 10, 40, 10),
        wire('w2', 20, 10, 20, 30),
        junction('jw', 20, 10),
        bus('b1', 0, 0, 40, 0),
        bus('b2', 30, 0, 30, -20),
        junction('jb', 30, 0),
      ].join('\n'),
    );
    expect([...busJunctionIds(d)].sort()).toEqual(['jb']);
  });

  it('answers nothing at all on a sheet with no buses', () => {
    const d = doc([wire('w1', 0, 0, 40, 0), junction('j1', 20, 0)].join('\n'));
    expect(busJunctionIds(d).size).toBe(0);
  });
});

/**
 * The painter's half. Read as source rather than by rendering, because the
 * colour is chosen inside one expression and a pixel test could not tell a
 * bus-junction colour that happened to match from one that was looked up.
 */
describe('the painter reads that answer rather than the geometry', () => {
  const RENDERER = new URL(
    '../../../designer/src/editors/schematic/render/renderer.ts',
    import.meta.url,
  );

  it('picks the layer colour from the set it is handed', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(RENDERER, 'utf8'));
    expect(src).toContain('opts.busJunctionIds?.has(jid) ? theme.busJunction : theme.junction');
  });

  it('leaves an explicit per-junction colour winning over the layer', async () => {
    // `SCH_JUNCTION::GetJunctionColor`: the item's own colour beats the layer's,
    // whichever layer that is. The choice moved into `itemColour`, which is the
    // one place the theme's "override individual item colors" can suppress it;
    // that the own colour actually reaches the canvas is painted and checked in
    // `override_item_colors.test.tsx`.
    const src = await import('node:fs').then((fs) => fs.readFileSync(RENDERER, 'utf8'));
    expect(src).toContain('itemColour(j.color, layerColour)');
  });
});
