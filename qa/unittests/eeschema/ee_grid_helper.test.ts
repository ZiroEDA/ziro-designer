// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import {
  EE_GRID_HELPER,
  nearestSnapAnchor,
  selectionSnapPoints,
  sheetAnchors,
} from '@ziroeda/eeschema/tools/ee_grid_helper.js';
import { ANCHOR_FLAGS, GRID_HELPER, GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { addItems, makeWire, placeSymbol } from '@ziroeda/eeschema/tools/index.js';
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

const snappable = (h: EE_GRID_HELPER) =>
  h
    .GetAnchors()
    .filter((a) => a.flags & ANCHOR_FLAGS.SNAPPABLE)
    .map((a) => a.pos);

describe('EE_GRID_HELPER (connectable snapping)', () => {
  it('is a GRID_HELPER, as upstream derives it', () => {
    expect(new EE_GRID_HELPER()).toBeInstanceOf(GRID_HELPER);
  });

  it('collects wire endpoints and symbol pins as anchors', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(10, 0), at(20, 0))] }).apply(sch);
    const anchors = snappable(sheetAnchors(sch, libMap(sch)));
    // R has two pins + wire has two endpoints.
    expect(anchors.length).toBe(4);
    expect(anchors.some((a) => a.x === mmToIU(10) && a.y === 0)).toBe(true);
  });

  it("adds a symbol's position as an ORIGIN anchor, which is not snappable", () => {
    // `case SCH_SYMBOL_T: addAnchor( aItem->GetPosition(), ORIGIN, aItem )`.
    const sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    const all = sheetAnchors(sch, libMap(sch)).GetAnchors();
    expect(all.filter((a) => a.flags === ANCHOR_FLAGS.ORIGIN).map((a) => a.pos)).toEqual([
      at(0, 0),
    ]);
    expect(snappable(sheetAnchors(sch, libMap(sch)))).not.toContainEqual(at(0, 0));
  });

  it('skips a graphic line, which is not connectable', () => {
    // "Don't add anchors for graphic lines unless we're including text".
    const wire = makeWire(at(10, 0), at(20, 0));
    const sch = addItems({ lines: [{ ...wire, kind: 'polyline' as const }] }).apply(EMPTY());
    expect(sheetAnchors(sch, libMap(sch)).GetAnchors()).toHaveLength(0);
  });

  it('nearestSnapAnchor snaps within range and ignores anchors outside it', () => {
    const helper = new EE_GRID_HELPER();
    helper.computePinAnchors([at(0, 0), at(10, 0)]);
    expect(nearestSnapAnchor(helper, at(0.3, 0.2), mmToIU(0.5))).toEqual(at(0, 0));
    expect(nearestSnapAnchor(helper, at(5, 0), mmToIU(0.5))).toBeNull();
  });

  it('nearestAnchor keeps the first of two equally near anchors', () => {
    // `if( dist < minDist )`: a strict less-than, so the first found wins.
    const helper = new EE_GRID_HELPER();
    helper.computePinAnchors([at(-1, 0), at(1, 0)]);
    const got = helper.nearestAnchor(
      at(0, 0),
      ANCHOR_FLAGS.SNAPPABLE,
      GRID_HELPER_GRIDS.GRID_CONNECTABLE,
    );
    expect(got?.pos).toEqual(at(-1, 0));
  });

  it('excludes the moved item from the fixed anchors and returns its own points', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(0, -3.81), at(20, -3.81))] }).apply(sch);
    const wireId = refId('line', sch.lines[0]!.uuid, 0);
    const moved = new Set([wireId]);
    const fixed = snappable(sheetAnchors(sch, libMap(sch), moved)); // only R's pins
    const own = selectionSnapPoints(sch, libMap(sch), moved); // the wire's endpoints
    expect(fixed.length).toBe(2);
    expect(own).toHaveLength(2);
    // The wire's near end coincides with R's pin, so snapping keeps them attached.
    expect(fixed.some((a) => a.x === own[0]!.x && a.y === own[0]!.y)).toBe(true);
  });
});
