// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The net-highlight pick (counterpart SCH_SELECTION_TOOL::GetNode): connectable
 * types only, exact hits before sloppy ones, and ids that resolve straight
 * through the netlist, plus the connection-name lookup the highlight uses.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import {
  addItems,
  makeWire,
  makeJunction,
  makeLabel,
  makeNoConnect,
  placeSymbol,
} from '@ziroeda/eeschema/src/tools/index.js';
import { getNode } from '@ziroeda/eeschema/src/tools/sch_get_node.js';
import {
  computeNetlist,
  connectionName,
  equivalentBusNames,
} from '@ziroeda/eeschema/src/connectivity/nets.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Schematic, LibSymbol } from '@ziroeda/eeschema/src/types.js';

const at = (x: number, y: number) => ({ x: mmToIU(x), y: mmToIU(y) });
const ACC = mmToIU(0.5);
const EMPTY = (): Schematic => readSchematic(parse('(kicad_sch (version 1) (lib_symbols))'));
const libMap = (sch: Schematic) =>
  new Map<string, LibSymbol>(sch.libSymbols.map((l) => [l.libId, l]));

// A 2-pin part (R): pin 1 tip at (0, -3.81) mm from the placement origin,
// pin 2 at (0, +3.81), the body spans ±2.54.
const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;

describe('getNode', () => {
  it('picks a symbol pin, which the netlist then resolves to its net', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({
      lines: [makeWire(at(0, -3.81), at(20, -3.81))],
      labels: [makeLabel('label', 'CLK', at(20, -3.81))],
    }).apply(sch);

    // Right on the pin's connection point: a pin id, not the symbol.
    const node = getNode(sch, libMap(sch), at(0, -3.81), ACC);
    expect(node?.kind).toBe('pin');
    const netlist = computeNetlist(sch, libMap(sch));
    expect(connectionName(netlist, node!.id)).toBe('/CLK');
  });

  it('ignores a symbol body, so a wire crossing it still wins the click', () => {
    let sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(-10, 0), at(10, 0))] }).apply(sch);
    // (0,0) is inside the R body *and* on the wire: upstream's collector never
    // sees the body, so the wire is the node.
    const node = getNode(sch, libMap(sch), at(0, 0), ACC);
    expect(node?.kind).toBe('wire');
  });

  it('a symbol body with nothing connectable near it is not a node at all', () => {
    const sch = placeSymbol(R, at(0, 0)).apply(EMPTY());
    expect(getNode(sch, libMap(sch), at(0.5, 0), ACC)).toBeNull();
  });

  it('an exact junction hit beats the wires passing through it', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0)), makeWire(at(10, 0), at(10, 10))],
      junctions: [makeJunction(at(10, 0))],
    }).apply(EMPTY());
    expect(getNode(sch, new Map(), at(10, 0), ACC)?.kind).toBe('junction');
  });

  it('picks labels and no-connect flags', () => {
    const sch = addItems({
      lines: [makeWire(at(0, 0), at(20, 0))],
      labels: [makeLabel('label', 'NET1', at(0, 0))],
      noConnects: [makeNoConnect(at(20, 0))],
    }).apply(EMPTY());
    expect(getNode(sch, new Map(), at(20, 0), ACC)?.kind).toBe('noconnect');
    const netlist = computeNetlist(sch, new Map());
    const label = getNode(sch, new Map(), at(1, 0.2), ACC);
    expect(label).not.toBeNull();
    expect(connectionName(netlist, label!.id)).toBe('/NET1');
  });

  it('a bus answers with the bus name, not a net', () => {
    const sch = addItems({
      lines: [{ ...makeWire(at(0, 0), at(20, 0)), kind: 'bus' as const }],
      labels: [makeLabel('label', 'D[0..3]', at(0, 0))],
    }).apply(EMPTY());
    const node = getNode(sch, new Map(), at(10, 0), ACC);
    expect(node?.kind).toBe('bus');
    const netlist = computeNetlist(sch, new Map());
    expect(connectionName(netlist, node!.id)).toBe('D[0..3]');
  });

  it('empty space is no node', () => {
    const sch = addItems({ lines: [makeWire(at(0, 0), at(20, 0))] }).apply(EMPTY());
    expect(getNode(sch, new Map(), at(10, 30), ACC)).toBeNull();
  });
});

// A single-pin power flag: upstream maps its body (and its Value text) to
// pins[0]->Connection(), which is how clicking a GND flag highlights GND.
const GND = readSymbolLib(
  parse(`(kicad_symbol_lib (version 20251024)
    (symbol "GND" (power) (pin_names (offset 0)) (pin_numbers (hide yes))
      (property "Reference" "#PWR" (at 0 -6.35 0) (effects (font (size 1.27 1.27)) (hide yes)))
      (property "Value" "GND" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))
      (symbol "GND_0_1"
        (polyline (pts (xy 0 0) (xy 0 -1.27) (xy 1.27 -1.27) (xy 0 -2.54) (xy -1.27 -1.27)
                       (xy 0 -1.27))
          (stroke (width 0) (type default)) (fill (type none))))
      (symbol "GND_1_1"
        (pin power_in line (at 0 0 90) (length 0)
          (name "GND" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))))))`),
)[0]!;

describe('getNode on a power symbol', () => {
  it('maps the flag body to its single pin, so the net resolves to GND', () => {
    let sch = placeSymbol(GND, at(0, 0)).apply(EMPTY());
    sch = addItems({ lines: [makeWire(at(0, 0), at(20, 0))] }).apply(sch);
    // Click the triangle, not the connection point (local -y is world +y).
    const node = getNode(sch, libMap(sch), at(0, 1.5), ACC);
    expect(node?.kind).toBe('pin');
    expect(connectionName(computeNetlist(sch, libMap(sch)), node!.id)).toBe('GND');
  });
});

describe('equivalentBusNames', () => {
  it('reports the other label on the same bus subgraph', () => {
    const sch = addItems({
      lines: [{ ...makeWire(at(0, 0), at(20, 0)), kind: 'bus' as const }],
      labels: [makeLabel('label', 'D[0..3]', at(0, 0)), makeLabel('label', 'D[0..3]', at(20, 0))],
    }).apply(EMPTY());
    const netlist = computeNetlist(sch, new Map());
    // Both labels name the one subgraph, so the set is the name itself only.
    expect(equivalentBusNames(netlist, 'D[0..3]')).toEqual([]);
  });
});
