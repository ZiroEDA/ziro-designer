// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { EE_GRID_HELPER, nearestSnapAnchor } from '@ziroeda/eeschema/tools/ee_grid_helper.js';
import { ANCHOR_FLAGS, GRID_HELPER, GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { addItems, makeLabel, makeWire, placeSymbol } from '@ziroeda/eeschema/tools/index.js';
import { refId } from '@ziroeda/eeschema/tools/hittest.js';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) =>
  new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));
const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

/** A helper over `sch`, 1.27 mm grid, snapping as asked. */
function helper(sch: Schematic, grid = true): EE_GRID_HELPER {
  const h = new EE_GRID_HELPER();
  h.SetSchematic(sch, libMap(sch));
  h.SetGridSize(at(1.27, 1.27));
  h.SetGridSnapping(grid);
  return h;
}
const CONN = GRID_HELPER_GRIDS.GRID_CONNECTABLE;

describe('EE_GRID_HELPER', () => {
  it('is a GRID_HELPER, as upstream derives it', () => {
    expect(new EE_GRID_HELPER()).toBeInstanceOf(GRID_HELPER);
  });

  describe('BestSnapAnchor (ee_grid_helper.cpp:131-219)', () => {
    // A wire whose end is off the 1.27 mm grid.
    const offGrid = () => addItems({ lines: [makeWire(at(10.3, 0), at(20.3, 0))] }).apply(EMPTY());

    it('prefers the grid node over an anchor when both are in range', () => {
      // Short of the wire's end, so no point on it is level with the cursor:
      // the end (10.3, 0) and the grid node (10.16, 0) are both inside
      // SNAP_RANGE, and the grid wins.
      expect(helper(offGrid()).BestSnapAnchor(at(10.2, 0.1), CONN)).toEqual(at(10.16, 0));
    });

    it('takes the anchor when the grid is off', () => {
      expect(helper(offGrid(), false).BestSnapAnchor(at(10.2, 0.1), CONN)).toEqual(at(10.3, 0));
    });

    it('leaves the cursor alone out of SNAP_RANGE with the grid off', () => {
      // 55 mil = 1.397 mm; the range test is against its diagonal, 1.976 mm.
      const far = at(7, 3);
      expect(helper(offGrid(), false).BestSnapAnchor(far, CONN)).toEqual(far);
    });

    it('offers the point on a straight wire level with the cursor', () => {
      // The VERTICAL/HORIZONTAL anchor: a horizontal wire, the cursor above its
      // middle - the anchor is the cursor's x on the wire.
      expect(helper(offGrid(), false).BestSnapAnchor(at(15.2, 0.4), CONN)).toEqual(at(15.2, 0));
    });

    it('drops the anchors of aSkip', () => {
      const sch = offGrid();
      const skip = new Set([refId('line', sch.lines[0]!.uuid, 0)]);
      const near = at(10.43, 0.1);
      expect(helper(sch, false).BestSnapAnchor(near, CONN, skip)).toEqual(near);
    });

    it('drops connectable anchors under GRID_GRAPHICS', () => {
      const near = at(10.43, 0.1);
      expect(
        helper(offGrid(), false).BestSnapAnchor(near, GRID_HELPER_GRIDS.GRID_GRAPHICS),
      ).toEqual(near);
    });

    it('skips a graphic line, which is not connectable', () => {
      const wire = makeWire(at(10.3, 0), at(20.3, 0));
      const sch = addItems({ lines: [{ ...wire, kind: 'polyline' as const }] }).apply(EMPTY());
      const near = at(10.43, 0.1);
      expect(helper(sch, false).BestSnapAnchor(near, CONN)).toEqual(near);
    });

    it("adds a symbol's position as an ORIGIN anchor, which is not snappable", () => {
      const sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
      const h = helper(sch, false);
      expect(h.BestSnapAnchor(at(0.2, 0.2), CONN)).toEqual(at(0.2, 0.2));
      expect(
        h
          .GetAnchors()
          .filter((a) => a.flags === ANCHOR_FLAGS.ORIGIN)
          .map((a) => a.pos),
      ).toEqual([at(0, 0)]);
    });
  });

  describe('BestDragOrigin (ee_grid_helper.cpp:84-128)', () => {
    it("takes the nearest of the selection's corners and origin", () => {
      const sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
      const ids = new Set([refId('symbol', sch.symbols[0]!.uuid, 0)]);
      const pin = sch.symbols[0] && helper(sch).BestDragOrigin(at(0.1, 3.5), CONN, ids, 1);
      expect(pin).toEqual(at(0, 3.81));
      expect(helper(sch).BestDragOrigin(at(0.1, 0.5), CONN, ids, 1)).toEqual(at(0, 0));
    });

    it('has no snap radius, and falls back to the mouse with no anchors', () => {
      const sch = addItems({ lines: [makeWire(at(0, 0), at(10, 0))] }).apply(EMPTY());
      const ids = new Set([refId('line', sch.lines[0]!.uuid, 0)]);
      expect(helper(sch).BestDragOrigin(at(40, 40), CONN, ids, 1)).toEqual(at(10, 0));
      expect(helper(sch).BestDragOrigin(at(40, 40), CONN, new Set(), 1)).toEqual(at(40, 40));
    });

    it('uses text anchors only when the selection has nothing connectable', () => {
      const text = makeLabel('text', 'note', at(3, 3));
      const sch = addItems({
        labels: [text],
        lines: [makeWire(at(0, 0), at(10, 0))],
      }).apply(EMPTY());
      const textId = refId('label', sch.labels[0]!.uuid, 0);
      const lineId = refId('line', sch.lines[0]!.uuid, 0);
      const near = at(3.1, 3.1);
      const h = helper(sch);
      // `aGrid` is the selection's grid, as SCH_MOVE_TOOL passes it: GRID_TEXT
      // for the text alone, GRID_WIRES once the wire is in.
      const textOnly = new Set([textId]);
      const both = new Set([textId, lineId]);
      expect(h.BestDragOrigin(near, h.GetSelectionGridOf(textOnly), textOnly, 1)).toEqual(at(3, 3));
      // With a wire selected too, the text's origin is not offered.
      expect(h.BestDragOrigin(near, h.GetSelectionGridOf(both), both, 1)).not.toEqual(at(3, 3));
    });
  });

  it('picks the grid by item kind, and the largest over a selection', () => {
    const sch = addItems({
      labels: [makeLabel('text', 'note', at(3, 3))],
      lines: [makeWire(at(0, 0), at(10, 0))],
    }).apply(EMPTY());
    const h = helper(sch);
    const textId = refId('label', sch.labels[0]!.uuid, 0);
    const lineId = refId('line', sch.lines[0]!.uuid, 0);
    expect(h.GetItemGridById(textId)).toBe(GRID_HELPER_GRIDS.GRID_TEXT);
    expect(h.GetItemGridById(lineId)).toBe(GRID_HELPER_GRIDS.GRID_WIRES);
    h.SetGridOverrides({ text: mmToIU(2.54) });
    expect(h.GetSelectionGridOf([lineId, textId])).toBe(GRID_HELPER_GRIDS.GRID_TEXT);
  });

  it('says a sheet is not movable from its anchor, a wire is', () => {
    const sch = readSchematic(
      parse(`(kicad_sch (version 1) (lib_symbols) (sheet (at 50 50) (size 40 30) (uuid "s")))`),
    );
    const w = addItems({ lines: [makeWire(at(0, 0), at(10, 0))] }).apply(sch);
    const h = helper(w);
    expect(h.IsMovableFromAnchorPoint(refId('sheet', 's', 0))).toBe(false);
    expect(h.IsMovableFromAnchorPoint(refId('line', w.lines[0]!.uuid, 0))).toBe(true);
  });

  it('nearestSnapAnchor snaps within range and ignores anchors outside it', () => {
    const h = new EE_GRID_HELPER();
    h.computePinAnchors([at(0, 0), at(10, 0)]);
    expect(nearestSnapAnchor(h, at(0.3, 0.2), mmToIU(0.5))).toEqual(at(0, 0));
    expect(nearestSnapAnchor(h, at(5, 0), mmToIU(0.5))).toBeNull();
  });

  it('nearestAnchor keeps the first of two equally near anchors', () => {
    const h = new EE_GRID_HELPER();
    h.computePinAnchors([at(-1, 0), at(1, 0)]);
    expect(h.nearestAnchor(at(0, 0), ANCHOR_FLAGS.SNAPPABLE, CONN)?.pos).toEqual(at(-1, 0));
  });
});
