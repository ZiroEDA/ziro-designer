// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `placeImportedItems` in `tools/drawing_tool.ts`, the model half of
 * `DRAWING_TOOL::PlaceImportedGraphics` this repo ported for File > Import >
 * Graphics: welding (`ConnectBoardShapes`, reused from `fix_board_shape.ts`)
 * and turning the importer's plain records into board-ready ones.
 */
import { describe, expect, it } from 'vitest';
import { placeImportedItems, weldImportedShapes } from '@ziroeda/pcbnew/tools/drawing_tool.js';
import type { IMPORTED_ITEM } from '@ziroeda/pcbnew/import_gfx/graphics_importer_pcbnew.js';
import type { PcbShape } from '@ziroeda/pcbnew/types.js';

const line = (start: { x: number; y: number }, end: { x: number; y: number }): PcbShape => ({
  kind: 'line',
  start,
  end,
  width: 100_000,
  fillMode: 'none',
  layer: 'Dwgs.User',
});

describe('weldImportedShapes: ConnectBoardShapes on the freshly-imported set', () => {
  it('extends two segments short of a corner to their sharp intersection', () => {
    // `fix_board_shape.test.ts`'s own "extends a real corner" case: for a
    // COLLINEAR pair only a sub-0.01mm gap welds (a hairline, not a feature);
    // for a real corner the two lines are extended to where they cross.
    const a = line({ x: 0, y: 0 }, { x: 9_999_000, y: 0 });
    const b = line({ x: 10_000_000, y: 0 }, { x: 10_000_000, y: 10_000_000 });

    const [wa, wb] = weldImportedShapes([a, b], 2_000_000);

    expect(wa!.end).toEqual(wb!.start);
    expect(wa!.end).toEqual({ x: 10_000_000, y: 0 });
  });

  it('leaves shapes alone past the tolerance', () => {
    const a = line({ x: 0, y: 0 }, { x: 10_000_000, y: 0 });
    const b = line({ x: 15_000_000, y: 0 }, { x: 20_000_000, y: 0 });

    const [wa, wb] = weldImportedShapes([a, b], 1_000_000);

    expect(wa!.end).toEqual(a.end);
    expect(wb!.start).toEqual(b.start);
  });

  it('welds an arc to an adjoining segment, keeping the arc a valid arc', () => {
    // `EDA_SHAPE::SetArcGeometry` can swap which of the three points it
    // stores as `start` vs `end` to keep its own winding convention (the
    // visual arc is identical either way), so the assertion is geometric —
    // one of the arc's two ends now meets the segment — not a fixed label.
    const seg = line({ x: 0, y: 0 }, { x: 9_999_000, y: 0 });
    const arc: PcbShape = {
      kind: 'arc',
      start: { x: 10_000_000, y: 0 },
      mid: { x: 15_000_000, y: 5_000_000 },
      end: { x: 20_000_000, y: 0 },
      width: 100_000,
      fillMode: 'none',
      layer: 'Dwgs.User',
    };

    const [ws, wa] = weldImportedShapes([seg, arc], 2_000_000);

    expect([wa!.start, wa!.end]).toContainEqual(ws!.end);
    // The arc keeps a real midpoint — welding must not collapse it to a line.
    expect(wa!.mid).toBeDefined();
    expect(wa!.mid).not.toEqual(wa!.start);
    expect(wa!.mid).not.toEqual(wa!.end);
  });

  it('does not touch a circle: only SEGMENT/ARC/BEZIER may start a weld walk', () => {
    // `fix_board_shape.cpp:401-410` restricts `startCandidates` to those three
    // kinds; a circle among the imported shapes must come back byte-identical.
    const circle: PcbShape = {
      kind: 'circle',
      center: { x: 0, y: 0 },
      end: { x: 5_000_000, y: 0 },
      width: 100_000,
      fillMode: 'none',
      layer: 'Dwgs.User',
    };

    const [out] = weldImportedShapes([circle], 2_000_000);

    expect(out).toEqual(circle);
  });

  it('is a no-op on an empty list', () => {
    expect(weldImportedShapes([], 1)).toEqual([]);
  });
});

describe('placeImportedItems: splitting IMPORTED_ITEM and stamping KIIDs', () => {
  // A 5000 IU (0.005 mm) collinear gap: under `WELD_GAP_TOLERANCE` (0.01 mm),
  // so it welds at the midpoint regardless of the passed tolerance — see
  // `fix_board_shape.test.ts`'s "welds a hairline collinear gap" case.
  const items: IMPORTED_ITEM[] = [
    { type: 'shape', shape: line({ x: 0, y: 0 }, { x: 1_000_000, y: 0 }) },
    { type: 'shape', shape: line({ x: 1_005_000, y: 0 }, { x: 2_000_000, y: 0 }) },
    {
      type: 'text',
      text: {
        kind: 'user',
        text: 'hi',
        at: { x: 0, y: 0 },
        angle: 0,
        layer: 'Dwgs.User',
        size: { x: 1_000_000, y: 1_000_000 },
        thickness: 100_000,
        justify: ['left', 'center'],
      },
    },
  ];

  it('splits shapes and texts, each with a fresh, distinct uuid', () => {
    const placed = placeImportedItems(items, { fixDiscontinuities: false, toleranceMM: 1 });

    expect(placed.shapes).toHaveLength(2);
    expect(placed.texts).toHaveLength(1);
    const uuids = [...placed.shapes.map((s) => s.uuid), ...placed.texts.map((t) => t.uuid)];
    expect(uuids.every((u) => typeof u === 'string' && u.length > 0)).toBe(true);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('welds only when fixDiscontinuities is asked for', () => {
    const left = placeImportedItems(items, { fixDiscontinuities: false, toleranceMM: 1 });
    expect(left.shapes[0]!.end).toEqual({ x: 1_000_000, y: 0 });

    const welded = placeImportedItems(items, { fixDiscontinuities: true, toleranceMM: 1 });
    expect(welded.shapes[0]!.end).toEqual(welded.shapes[1]!.start);
  });
});
