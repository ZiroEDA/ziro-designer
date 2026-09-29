// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * CONNECTION_SUBGRAPH / CONNECTION_GRAPH on the live items (eeschema stage E3b).  The cases
 * marked "qa:" are KiCad's own (qa/tests/eeschema/test_resolve_drivers.cpp,
 * test_update_items_connectivity.cpp — the second reaches private members, as upstream's
 * test does through `friend`); the rest are read off connection_graph.cpp.  The whole-design
 * pin is connection_graph_oracle.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { ELECTRICAL_PINTYPE } from '@ziroeda/common/pin_type.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ERCE_T } from '@ziroeda/eeschema/erc/erc_settings.js';
import type { SCH_MARKER } from '@ziroeda/eeschema/sch_marker.js';
import { CONNECTION_GRAPH, CONNECTION_SUBGRAPH } from '@ziroeda/eeschema/connection_graph.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import { SCH_BUS_BUS_ENTRY, SCH_BUS_WIRE_ENTRY } from '@ziroeda/eeschema/sch_bus_entry.js';
import { SCH_CONNECTION } from '@ziroeda/eeschema/sch_connection.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import { LABEL_FLAG_SHAPE, SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import { SCH_JUNCTION } from '@ziroeda/eeschema/sch_junction.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import { SCH_SHEET_PIN } from '@ziroeda/eeschema/sch_sheet_pin.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

/** The private members upstream's QA reaches as a friend. */
interface GRAPH_INTERNALS {
  m_global_power_pins: [SCH_SHEET_PATH, SCH_PIN][];
  m_items: SCH_ITEM[];
  updateSymbolConnectivity(
    aSheet: SCH_SHEET_PATH,
    aSymbol: SCH_SYMBOL,
    aMap: Map<string, [VECTOR2I, SCH_ITEM[]]>,
  ): void;
  updateGenericItemConnectivity(
    aSheet: SCH_SHEET_PATH,
    aItem: SCH_ITEM,
    aMap: Map<string, [VECTOR2I, SCH_ITEM[]]>,
  ): void;
}

const internals = (g: CONNECTION_GRAPH): GRAPH_INTERNALS => g as unknown as GRAPH_INTERNALS;
const has = (m: Map<string, unknown>, p: VECTOR2I): boolean => m.has(`${p.x},${p.y}`);

/** RESOLVE_DRIVERS_FIXTURE. */
function resolveFixture() {
  const graph = new CONNECTION_GRAPH();
  const sheet = new SCH_SHEET();
  const sheetPath = new SCH_SHEET_PATH();
  const subgraph = new CONNECTION_SUBGRAPH(graph);

  const MakeLabel = (aText: string): SCH_LABEL => {
    const label = new SCH_LABEL({ x: 0, y: 0 }, aText);
    const conn = label.GetOrInitConnection(sheetPath, graph)!;
    conn.ConfigureFromLabel(aText);
    return label;
  };

  const MakePin = (aLib: LIB_SYMBOL, aType: ELECTRICAL_PINTYPE, aRef: string): SCH_PIN => {
    const libPin = new SCH_PIN(aLib);
    libPin.SetNumber('1');
    libPin.SetName('P');
    libPin.SetType(aType);
    libPin.SetPosition({ x: 0, y: 0 });
    aLib.AddDrawItem(libPin);

    const symbol = new SCH_SYMBOL(aLib, aLib.GetLibId(), sheetPath, 0, 0, { x: 0, y: 0 });
    symbol.SetRef(sheetPath, aRef);
    symbol.UpdatePins();

    const pin = symbol.GetPins(sheetPath)[0]!;
    const conn = pin.GetOrInitConnection(sheetPath, graph)!;
    conn.ConfigureFromLabel('NET');
    return pin;
  };

  const MakeGlobalPowerPin = (): SCH_PIN => {
    const lib = new LIB_SYMBOL('G_PWR');
    lib.SetGlobalPower();
    return MakePin(lib, ELECTRICAL_PINTYPE.PT_POWER_IN, 'PWR1');
  };

  const MakeLocalPowerPin = (): SCH_PIN => {
    const lib = new LIB_SYMBOL('L_PWR');
    lib.SetLocalPower();
    return MakePin(lib, ELECTRICAL_PINTYPE.PT_POWER_IN, 'PWR2');
  };

  const MakeRegularPin = (): SCH_PIN => {
    const lib = new LIB_SYMBOL('REG');
    lib.SetNormal();
    return MakePin(lib, ELECTRICAL_PINTYPE.PT_OUTPUT, 'U1');
  };

  const MakeSheetPin = (aText: string, aShape: LABEL_FLAG_SHAPE): SCH_SHEET_PIN => {
    const pin = new SCH_SHEET_PIN(sheet);
    pin.SetText(aText);
    pin.SetShape(aShape);
    const conn = pin.GetOrInitConnection(new SCH_SHEET_PATH(), graph)!;
    conn.ConfigureFromLabel(aText);
    return pin;
  };

  return {
    graph,
    subgraph,
    MakeLabel,
    MakeGlobalPowerPin,
    MakeLocalPowerPin,
    MakeRegularPin,
    MakeSheetPin,
  };
}

describe('CONNECTION_SUBGRAPH::ResolveDrivers (qa: test_resolve_drivers.cpp)', () => {
  it('BusSupersetPreference', () => {
    const { subgraph, MakeLabel } = resolveFixture();
    let subset = MakeLabel('BUS[1..3]');
    let superset = MakeLabel('BUS[1..4]');

    subgraph.AddItem(subset);
    subgraph.AddItem(superset);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(superset);

    subgraph.RemoveItem(subset);

    // Check that the superset is still the driver after removing the subset
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(superset);

    subgraph.RemoveItem(superset);

    // Check group labels as well
    subset = MakeLabel('BUS{ ONE TWO THREE }');
    superset = MakeLabel('BUS{ ONE TWO THREE FOUR }');
    subgraph.AddItem(subset);
    subgraph.AddItem(superset);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(superset);
  });

  it('PowerSymbolPinPrecedence', () => {
    const { subgraph, MakeRegularPin, MakeLocalPowerPin, MakeGlobalPowerPin } = resolveFixture();
    const regular = MakeRegularPin();
    subgraph.AddItem(regular);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(regular);

    const local = MakeLocalPowerPin();
    subgraph.AddItem(local);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(local);

    const global = MakeGlobalPowerPin();
    subgraph.AddItem(global);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(global);
  });

  it('NameQualityHeuristic', () => {
    const { subgraph, MakeLabel } = resolveFixture();
    const good = MakeLabel('VCC');
    const bad = MakeLabel('Net-Pad1');
    subgraph.AddItem(good);
    subgraph.AddItem(bad);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(good);
  });

  it('AlphabeticalTiebreaker', () => {
    const { subgraph, MakeLabel } = resolveFixture();
    const aaa = MakeLabel('AAA');
    const bbb = MakeLabel('BBB');
    // added in the losing order, so insertion order cannot be what picks AAA
    subgraph.AddItem(bbb);
    subgraph.AddItem(aaa);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(aaa);
  });

  it('SheetPinOutputBias', () => {
    const { subgraph, MakeSheetPin } = resolveFixture();
    const input = MakeSheetPin('IN', LABEL_FLAG_SHAPE.L_INPUT);
    const output = MakeSheetPin('OUT', LABEL_FLAG_SHAPE.L_OUTPUT);
    subgraph.AddItem(input);
    subgraph.AddItem(output);
    subgraph.ResolveDrivers(false);
    expect(subgraph.GetDriver()).toBe(output);
  });

  it('two strong drivers make it multiple-driver; the weak ones are dropped', () => {
    const { subgraph, MakeLabel, MakeRegularPin } = resolveFixture();
    const a = MakeLabel('A');
    const b = MakeLabel('B');
    const pin = MakeRegularPin();
    subgraph.AddItem(a);
    subgraph.AddItem(b);
    subgraph.AddItem(pin);
    expect(subgraph.ResolveDrivers(false)).toBe(true);
    expect(subgraph.m_multiple_drivers).toBe(true);
    expect(subgraph.m_strong_driver).toBe(true);
    expect(subgraph.m_local_driver).toBe(true);
    expect([...subgraph.m_drivers]).toEqual([a, b]);
    expect(subgraph.GetDriverConnection()!.Name(true)).toBe('A');
  });
});

describe('CONNECTION_SUBGRAPH::GetDriverPriority', () => {
  it('the PRIORITY ladder, and a pin on an excluded or "#" symbol drives nothing', () => {
    const P = CONNECTION_SUBGRAPH.PRIORITY;
    const { MakeRegularPin, MakeLocalPowerPin, MakeGlobalPowerPin, MakeLabel, MakeSheetPin } =
      resolveFixture();
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(null)).toBe(P.NONE);
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(MakeLabel('X'))).toBe(P.LOCAL_LABEL);
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(MakeSheetPin('S', LABEL_FLAG_SHAPE.L_INPUT))).toBe(
      P.SHEET_PIN,
    );
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(MakeLocalPowerPin())).toBe(P.LOCAL_POWER_PIN);
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(MakeGlobalPowerPin())).toBe(P.GLOBAL_POWER_PIN);

    const pin = MakeRegularPin();
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(pin)).toBe(P.PIN);
    const symbol = pin.GetParentSymbol() as unknown as SCH_SYMBOL;
    symbol.GetLibSymbolRef()!.GetReferenceField().SetText('#FLG');
    expect(CONNECTION_SUBGRAPH.GetDriverPriority(pin)).toBe(P.NONE);
  });
});

describe('CONNECTION_GRAPH::matchBusMember', () => {
  const bus = (label: string): SCH_CONNECTION => {
    const c = new SCH_CONNECTION({ GetBusAlias: () => null, GetSubgraphForItem: () => null });
    c.ConfigureFromLabel(label);
    return c;
  };

  it('a vector bus matches by vector index, not by name', () => {
    const d = bus('D[3..0]');
    const q = bus('Q[3..0]');
    expect(CONNECTION_GRAPH.matchBusMember(d, q.Members()[2]!)!.Name(true)).toBe('D2');
  });

  it('a group matches by local name, inside a vector member too; else by flat index', () => {
    const g = bus('{A B[1..0] C}');
    expect(CONNECTION_GRAPH.matchBusMember(g, bus('{C}').Members()[0]!)!.Name(true)).toBe('C');
    expect(CONNECTION_GRAPH.matchBusMember(g, bus('B[1..0]').Members()[1]!)!.Name(true)).toBe('B1');
    // no name match: the search's vector index walks the flattened members (A, B0, B1, C)
    const other = bus('Z[3..0]').Members()[3]!;
    expect(CONNECTION_GRAPH.matchBusMember(g, other)!.Name(true)).toBe('C');
    expect(CONNECTION_GRAPH.matchBusMember(bus('N'), other)).toBeNull();
  });
});

describe('CONNECTION_GRAPH item connectivity (qa: test_update_items_connectivity.cpp)', () => {
  const rootSheet = () => {
    const schematic = new SCHEMATIC(null);
    const screen = new SCH_SCREEN(null);
    const sheet = new SCH_SHEET(null, { x: 0, y: 0 }, { x: 1000, y: 1000 });
    sheet.SetScreen(screen);
    sheet.SetParent(schematic);
    const sheetPath = new SCH_SHEET_PATH();
    sheetPath.push_back(sheet);
    return sheetPath;
  };

  it('SymbolConnectivityLinksPins', () => {
    const sheetPath = rootSheet();

    // Build library symbol
    const lib = new LIB_SYMBOL('TEST');
    lib.SetGlobalPower();
    lib.SetDuplicatePinNumbersAreJumpers(true);
    lib.JumperPinGroups().push(new Set(['3', '4']));

    const make_pin = (num: string, name: string, type: ELECTRICAL_PINTYPE, pos: VECTOR2I) => {
      const pin = new SCH_PIN(lib);
      pin.SetNumber(num);
      pin.SetName(name);
      pin.SetType(type);
      pin.SetPosition(pos);
      lib.AddDrawItem(pin);
    };

    make_pin('1', 'VCC', ELECTRICAL_PINTYPE.PT_POWER_IN, { x: 0, y: 0 });
    make_pin('2', 'A', ELECTRICAL_PINTYPE.PT_INPUT, { x: 1000, y: 0 });
    make_pin('2', 'B', ELECTRICAL_PINTYPE.PT_INPUT, { x: 2000, y: 0 });
    make_pin('3', 'C', ELECTRICAL_PINTYPE.PT_INPUT, { x: 3000, y: 0 });
    make_pin('4', 'D', ELECTRICAL_PINTYPE.PT_INPUT, { x: 4000, y: 0 });

    // Create schematic symbol instance
    const symbol = new SCH_SYMBOL(lib, lib.GetLibId(), sheetPath, 0, 0, { x: 0, y: 0 });
    symbol.SetValueFieldText('VCC');
    symbol.UpdatePins();

    const pins = symbol.GetPins(sheetPath);
    let powerPin: SCH_PIN | null = null;
    let dupA: SCH_PIN | null = null;
    let dupB: SCH_PIN | null = null;
    let jumpC: SCH_PIN | null = null;
    let jumpD: SCH_PIN | null = null;

    for (const pin of pins) {
      if (pin.GetNumber() === '1') powerPin = pin;
      else if (pin.GetNumber() === '2') {
        if (!dupA) dupA = pin;
        else dupB = pin;
      } else if (pin.GetNumber() === '3') jumpC = pin;
      else if (pin.GetNumber() === '4') jumpD = pin;
    }

    const graph = new CONNECTION_GRAPH();
    const connection_map = new Map<string, [VECTOR2I, SCH_ITEM[]]>();
    internals(graph).updateSymbolConnectivity(sheetPath, symbol, connection_map);

    // Global power pin captured
    expect(internals(graph).m_global_power_pins).toHaveLength(1);
    expect(internals(graph).m_global_power_pins[0]![1]).toBe(powerPin);
    expect(powerPin!.Connection(sheetPath)!.Name(true)).toBe('VCC');

    // Duplicate pin numbers link together
    expect(dupA!.ConnectedItems(sheetPath)).toContain(dupB);
    expect(dupB!.ConnectedItems(sheetPath)).toContain(dupA);

    // Jumper group links pins
    expect(jumpC!.ConnectedItems(sheetPath)).toContain(jumpD);
    expect(jumpD!.ConnectedItems(sheetPath)).toContain(jumpC);

    // Connection map contains all pins
    const mapPins = new Set<SCH_ITEM>();

    for (const [, items] of connection_map.values()) for (const item of items) mapPins.add(item);

    expect(mapPins.size).toBe(5);

    // Item list contains all pins
    expect(internals(graph).m_items).toHaveLength(5);

    for (const pin of [powerPin, dupA, dupB, jumpC, jumpD])
      expect(internals(graph).m_items).toContain(pin);
  });

  it('GenericItemConnectivity', () => {
    const sheetPath = rootSheet();
    const graph = new CONNECTION_GRAPH();
    const cmap = new Map<string, [VECTOR2I, SCH_ITEM[]]>();

    // Wire line
    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint({ x: 100, y: 0 });
    internals(graph).updateGenericItemConnectivity(sheetPath, wire, cmap);
    const wireConn = wire.Connection(sheetPath)!;
    expect(wireConn.IsNet()).toBe(true);
    expect(has(cmap, wire.GetStartPoint())).toBe(true);
    expect(has(cmap, wire.GetEndPoint())).toBe(true);

    // Bus line
    cmap.clear();
    const bus = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    bus.SetEndPoint({ x: 0, y: 100 });
    internals(graph).updateGenericItemConnectivity(sheetPath, bus, cmap);
    expect(bus.Connection(sheetPath)!.IsBus()).toBe(true);
    expect(has(cmap, bus.GetStartPoint())).toBe(true);
    expect(has(cmap, bus.GetEndPoint())).toBe(true);

    // Bus-to-bus entry
    cmap.clear();
    const busEntry = new SCH_BUS_BUS_ENTRY({ x: 0, y: 0 }, false);
    busEntry.m_connected_bus_items[0] = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    busEntry.m_connected_bus_items[1] = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    internals(graph).updateGenericItemConnectivity(sheetPath, busEntry, cmap);
    expect(busEntry.Connection(sheetPath)!.IsBus()).toBe(true);
    expect(busEntry.m_connected_bus_items).toEqual([null, null]);
    const ptsBB = busEntry.GetConnectionPoints();
    expect(has(cmap, ptsBB[0]!)).toBe(true);
    expect(has(cmap, ptsBB[1]!)).toBe(true);

    // Bus-wire entry
    cmap.clear();
    const bwEntry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 0 }, false);
    bwEntry.m_connected_bus_item = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_BUS);
    internals(graph).updateGenericItemConnectivity(sheetPath, bwEntry, cmap);
    expect(bwEntry.Connection(sheetPath)!.IsNet()).toBe(true);
    expect(bwEntry.m_connected_bus_item).toBeNull();
    const ptsBW = bwEntry.GetConnectionPoints();
    expect(has(cmap, ptsBW[0]!)).toBe(true);
    expect(has(cmap, ptsBW[1]!)).toBe(true);

    // Pin
    cmap.clear();
    const libSymbol = new LIB_SYMBOL('PWR');
    const libPin = new SCH_PIN(libSymbol);
    libPin.SetNumber('1');
    libPin.SetName('P');
    libPin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
    libPin.SetPosition({ x: 10, y: 10 });
    libSymbol.AddDrawItem(libPin);
    libSymbol.SetGlobalPower();

    const symbol = new SCH_SYMBOL(libSymbol, libSymbol.GetLibId(), sheetPath, 0, 0, {
      x: 0,
      y: 0,
    });
    symbol.SetRef(sheetPath, 'U1');
    symbol.UpdatePins();

    const pin = symbol.GetPins(sheetPath)[0]!;
    internals(graph).updateGenericItemConnectivity(sheetPath, pin, cmap);
    expect(pin.Connection(sheetPath)!.IsNet()).toBe(true);
    expect(internals(graph).m_global_power_pins).toHaveLength(1);
    expect(has(cmap, pin.GetPosition())).toBe(true);
  });
});

/** A schematic with a project (buildConnectionGraph reads the project's net settings). */
function projectSchematic(): SCHEMATIC {
  const project = new PROJECT();
  project.setProjectFile(new PROJECT_FILE('t.kicad_pro'));
  return new SCHEMATIC(project);
}

describe('CONNECTION_GRAPH::Recalculate on a hand-built sheet', () => {
  /** One sheet with \a aItems on it, recalculated. */
  const recalc = (aItems: SCH_ITEM[]) => {
    const schematic = projectSchematic();
    schematic.CreateDefaultScreens();
    const sheet = schematic.Hierarchy()[0]!;
    const screen = sheet.LastScreen()!;

    for (const item of aItems) screen.Append(item);

    schematic.SetCurrentSheet(sheet);
    const graph = new CONNECTION_GRAPH(schematic);
    graph.Recalculate(schematic.BuildSheetListSortedByPageNumbers(), true);
    return { schematic, sheet, screen, graph };
  };

  const wire = (a: VECTOR2I, b: VECTOR2I, layer = SCH_LAYER_ID.LAYER_WIRE): SCH_LINE => {
    const line = new SCH_LINE(a, layer);
    line.SetEndPoint(b);
    return line;
  };

  it('JunctionAtWireMidpointConnectsNet (qa: test_issue23143_junction_midpoint.cpp)', () => {
    const hWire = wire({ x: -1000, y: 0 }, { x: 1000, y: 0 });
    const junction = new SCH_JUNCTION({ x: 0, y: 0 });
    const vWire = wire({ x: 0, y: 0 }, { x: 0, y: -1000 });
    const { graph } = recalc([hWire, junction, vWire]);

    const sgH = graph.GetSubgraphForItem(hWire)!;
    expect(graph.GetSubgraphForItem(vWire)).toBe(sgH);
    expect(graph.GetSubgraphForItem(junction)).toBe(sgH);
  });

  it("a bus entry's bus end joins only the bus, not a wire ending on the same point", () => {
    const bus = wire({ x: 0, y: 0 }, { x: 0, y: 10000 }, SCH_LAYER_ID.LAYER_BUS);
    const entry = new SCH_BUS_WIRE_ENTRY({ x: 0, y: 5000 }, false);
    const stray = wire({ x: 0, y: 5000 }, { x: -5000, y: 5000 });
    const { sheet } = recalc([bus, entry, stray]);

    expect(entry.GetConnectionPoints()[0]).toEqual({ x: 0, y: 5000 });
    expect(entry.ConnectedItems(sheet)).not.toContain(stray);
    expect(stray.ConnectedItems(sheet)).not.toContain(entry);
    expect(entry.m_connected_bus_item).toBe(bus);
  });

  it('a pin of a symbol out of the netlist ("#" reference) never names the net', () => {
    const lib = new LIB_SYMBOL('R');
    const libPin = new SCH_PIN(lib);
    libPin.SetNumber('1');
    libPin.SetType(ELECTRICAL_PINTYPE.PT_PASSIVE);
    libPin.SetPosition({ x: 0, y: 0 });
    lib.AddDrawItem(libPin);
    lib.GetReferenceField().SetText('R');

    const schematic = projectSchematic();
    schematic.CreateDefaultScreens();
    const sheet = schematic.Hierarchy()[0]!;
    const screen = sheet.LastScreen()!;

    const place = (ref: string, x: number): SCH_SYMBOL => {
      const symbol = new SCH_SYMBOL(lib, lib.GetLibId(), sheet, 1, 0, { x, y: 0 });
      symbol.SetRef(sheet, ref);
      screen.Append(symbol);
      return symbol;
    };

    // "#" sorts before "R": without the IsInNetlist skip, #R1 would drive
    place('#R1', 0);
    const r = place('R2', 5000);
    screen.Append(wire({ x: 0, y: 0 }, { x: 5000, y: 0 }));

    schematic.SetCurrentSheet(sheet);
    const graph = new CONNECTION_GRAPH(schematic);
    graph.Recalculate(schematic.BuildSheetListSortedByPageNumbers(), true);

    expect(r.GetPins(sheet)[0]!.Connection(sheet)!.Name()).toBe('Net-(R2-Pad1)');
  });

  it('global power symbols are named by their value, not their pin name', () => {
    const schematic = projectSchematic();
    schematic.CreateDefaultScreens();
    const sheet = schematic.Hierarchy()[0]!;
    const screen = sheet.LastScreen()!;

    const power = (value: string, x: number): SCH_SYMBOL => {
      const lib = new LIB_SYMBOL(value);
      lib.SetGlobalPower();
      const pin = new SCH_PIN(lib);
      pin.SetNumber('1');
      pin.SetName('PWR'); // the same pin name on both: only the value tells them apart
      pin.SetType(ELECTRICAL_PINTYPE.PT_POWER_IN);
      pin.SetPosition({ x: 0, y: 0 });
      lib.AddDrawItem(pin);
      const symbol = new SCH_SYMBOL(lib, lib.GetLibId(), sheet, 1, 0, { x, y: 0 });
      symbol.SetRef(sheet, `#PWR0${x}`);
      symbol.SetValueFieldText(value);
      screen.Append(symbol);
      return symbol;
    };

    const gnd = power('GND', 0);
    const vcc = power('VCC', 5000);

    schematic.SetCurrentSheet(sheet);
    const graph = new CONNECTION_GRAPH(schematic);
    graph.Recalculate(schematic.BuildSheetListSortedByPageNumbers(), true);

    expect(gnd.GetPins(sheet)[0]!.Connection(sheet)!.Name()).toBe('GND');
    expect(vcc.GetPins(sheet)[0]!.Connection(sheet)!.Name()).toBe('VCC');
    expect([...graph.GetNetMap()].map(([k]) => k.Name).sort()).toEqual(['GND', 'VCC']);
  });

  it('a wire joins two labels into one net; the second name is a multiple-driver ERC', () => {
    const schematic = projectSchematic();
    schematic.CreateDefaultScreens();
    const sheet = schematic.Hierarchy()[0]!;
    const screen = sheet.LastScreen()!;

    const wire = new SCH_LINE({ x: 0, y: 0 }, SCH_LAYER_ID.LAYER_WIRE);
    wire.SetEndPoint({ x: 1000, y: 0 });
    const a = new SCH_LABEL({ x: 0, y: 0 }, 'ZED');
    const b = new SCH_LABEL({ x: 1000, y: 0 }, 'ALPHA');
    const lone = new SCH_LINE({ x: 0, y: 5000 }, SCH_LAYER_ID.LAYER_WIRE);
    lone.SetEndPoint({ x: 1000, y: 5000 });

    for (const item of [wire, a, b, lone]) screen.Append(item);

    schematic.SetCurrentSheet(sheet);
    const graph = new CONNECTION_GRAPH(schematic);
    graph.Recalculate(schematic.BuildSheetListSortedByPageNumbers(), true);

    // Alphabetical: ALPHA drives, and every item on the net carries it
    expect(wire.Connection(sheet)!.Name()).toBe('/ALPHA');
    expect(a.Connection(sheet)!.Name()).toBe('/ALPHA');

    const sg = graph.GetSubgraphForItem(wire)!;
    expect(sg.GetDriver()).toBe(b);
    expect(graph.GetSubgraphForItem(a)).toBe(sg);
    expect(graph.FindSubgraphByName('/ALPHA', sheet)).toBe(sg);
    expect(graph.GetResolvedSubgraphName(sg)).toBe('/ALPHA');

    // the undriven wire is no net at all
    expect(graph.GetSubgraphForItem(lone)!.GetDriver()).toBeNull();
    expect([...graph.GetNetMap()].map(([k]) => k.Name)).toEqual(['/ALPHA']);

    // ERC: the conflicting names, and the floating wire
    graph.RunERC();
    const codes = screen
      .Items()
      .OfType(KICAD_T.SCH_MARKER_T)
      .map((m) => (m as SCH_MARKER).GetRCItem()!.GetErrorCode());
    expect(codes).toContain(ERCE_T.ERCE_DRIVER_CONFLICT);
    expect(codes).toContain(ERCE_T.ERCE_WIRE_DANGLING);
    const conflict = screen
      .Items()
      .OfType(KICAD_T.SCH_MARKER_T)
      .map((m) => (m as SCH_MARKER).GetRCItem()!)
      .find((i) => i.GetErrorCode() === ERCE_T.ERCE_DRIVER_CONFLICT)!;
    expect(conflict.GetErrorMessage(false)).toBe(
      'Both ALPHA and ZED are attached to the same items; ALPHA will be used in the netlist',
    );
    expect(conflict.GetMainItemID()).toBe(b.m_Uuid);
    expect(conflict.GetAuxItemID()).toBe(a.m_Uuid);
  });
});
