// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live SCH_CONNECTION and SCH_ITEM's per-sheet connection map (eeschema stage
 * E3b). The cases marked "qa:" are KiCad's own (qa/tests/eeschema/test_bus_parsing.cpp);
 * the rest are read off sch_connection.cpp / sch_item.cpp.
 */
import { describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import { ELECTRICAL_PINTYPE, PIN_ORIENTATION } from '@ziroeda/common/pin_type.js';
import { BUS_ALIAS } from '@ziroeda/eeschema/bus_alias.js';
import { LIB_SYMBOL } from '@ziroeda/eeschema/lib_symbol.js';
import {
  CONNECTION_TYPE,
  SCH_CONNECTION,
  type SCH_CONNECTION_GRAPH,
} from '@ziroeda/eeschema/sch_connection.js';
import { SCH_GLOBALLABEL, SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_SCREEN } from '@ziroeda/eeschema/sch_screen.js';
import { SCH_SHEET } from '@ziroeda/eeschema/sch_sheet.js';
import { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

/** A graph that answers bus aliases from a table, and no subgraphs. */
function aliasGraph(aliases: Record<string, string[]>): SCH_CONNECTION_GRAPH {
  return {
    GetBusAlias(aName: string) {
      const members = aliases[aName];
      if (!members) return null;
      const alias = new BUS_ALIAS();
      alias.SetName(aName);
      alias.SetMembers(members);
      return alias;
    },
    GetSubgraphForItem: () => null,
  };
}

/** A schematic with a top sheet and a sub-sheet named "sub", and a label on the sub-sheet. */
function withSubSheet() {
  const schematic = new SCHEMATIC(null);
  schematic.CreateDefaultScreens();
  const topScreen = schematic.Hierarchy()[0]!.LastScreen()!;
  const subScreen = new SCH_SCREEN(schematic);
  const sub = new SCH_SHEET(topScreen);
  sub.SetScreen(subScreen);
  sub.SetName('sub');
  sub.SetFileName('sub.kicad_sch');
  topScreen.Append(sub);
  const label = new SCH_LABEL({ x: 0, y: 0 }, 'N');
  subScreen.Append(label);
  schematic.RefreshHierarchy();
  const [top, subPath] = schematic.Hierarchy();
  return { schematic, top: top!, subPath: subPath!, label };
}

describe('SCH_CONNECTION::PrintBusForUI (qa: test_bus_parsing.cpp)', () => {
  it('PrintBusForUIHandlesEscapedSpaces', () => {
    expect(SCH_CONNECTION.PrintBusForUI('net\\ name')).toBe('net name');
    expect(SCH_CONNECTION.PrintBusForUI('bus\\ name.net\\ 1')).toBe('bus name.net 1');
    expect(SCH_CONNECTION.PrintBusForUI('my\\ net\\ name')).toBe('my net name');
    expect(SCH_CONNECTION.PrintBusForUI('simple_net')).toBe('simple_net');
  });

  it('PrintBusForUIHandlesMixedFormatting', () => {
    expect(SCH_CONNECTION.PrintBusForUI('~{reset}')).toBe('~reset');
    expect(SCH_CONNECTION.PrintBusForUI('my\\ ~{signal}')).toBe('my ~signal');
  });

  it('PrintBusForUIUnescapesNetNameTokens', () => {
    expect(SCH_CONNECTION.PrintBusForUI('R{slash}~{W}')).toBe('R/~W');
    expect(SCH_CONNECTION.PrintBusForUI('A{slash}B')).toBe('A/B');
    expect(SCH_CONNECTION.PrintBusForUI('R/~{W}')).toBe('R/~W');
  });

  it('a group: the "}" test runs before the append, so the closing brace is never printed', () => {
    expect(SCH_CONNECTION.PrintBusForUI('USB{DP DM}')).toBe('USB{DP DM');
  });
});

describe('SCH_CONNECTION', () => {
  it('a fresh connection is unconnected, dirty, and named <NO NET> once recached', () => {
    const c = new SCH_CONNECTION();
    expect(c.IsUnconnected()).toBe(true);
    expect(c.IsDirty()).toBe(true);
    expect(c.Parent()).toBeNull();
    c.SetName('');
    expect(c.Name()).toBe('<NO NET>');
  });

  it('ConfigureFromLabel: a plain net', () => {
    const c = new SCH_CONNECTION();
    c.ConfigureFromLabel('CLK');
    expect(c.Type()).toBe(CONNECTION_TYPE.NET);
    expect(c.IsNet()).toBe(true);
    expect(c.Members()).toHaveLength(0);
    expect(c.Name(true)).toBe('CLK');
    expect(c.LocalName()).toBe('CLK');
  });

  it('ConfigureFromLabel: a vector bus expands low-to-high whichever way it is written (ParseBusVector swaps)', () => {
    const c = new SCH_CONNECTION();
    c.ConfigureFromLabel('A[3..0]');
    expect(c.Type()).toBe(CONNECTION_TYPE.BUS);
    expect(c.IsBus()).toBe(true);
    expect(c.VectorPrefix()).toBe('A');
    expect(c.Members().map((m) => [m.Name(true), m.VectorIndex(), m.Type()])).toEqual([
      ['A0', 0, CONNECTION_TYPE.NET],
      ['A1', 1, CONNECTION_TYPE.NET],
      ['A2', 2, CONNECTION_TYPE.NET],
      ['A3', 3, CONNECTION_TYPE.NET],
    ]);
  });

  it('ConfigureFromLabel: a named group prefixes its members with "NAME."', () => {
    const c = new SCH_CONNECTION(aliasGraph({}));
    c.ConfigureFromLabel('USB{DP DM}');
    expect(c.Type()).toBe(CONNECTION_TYPE.BUS_GROUP);
    expect(c.BusPrefix()).toBe('USB');
    expect(c.Members().map((m) => m.Name(true))).toEqual(['USB.DP', 'USB.DM']);
    expect(c.Members().map((m) => m.FullLocalName())).toEqual(['USB.DP', 'USB.DM']);

    // an unnamed group adds no prefix, and a vector inside a group is itself a bus
    const u = new SCH_CONNECTION(aliasGraph({}));
    u.ConfigureFromLabel('{D[1..0] RW}');
    expect(u.Members().map((m) => [m.Name(true), m.Type()])).toEqual([
      ['D[1..0]', CONNECTION_TYPE.BUS],
      ['RW', CONNECTION_TYPE.NET],
    ]);
    expect(u.AllMembers().map((m) => m.Name(true))).toEqual(['D[1..0]', 'RW', 'D0', 'D1']);
  });

  it('ConfigureFromLabel: an alias inside a group expands to the alias members', () => {
    const c = new SCH_CONNECTION(aliasGraph({ MEM: ['A0', 'A/B'] }));
    c.ConfigureFromLabel('BUS{MEM CE}');
    // the alias member is escaped (CTX_NETNAME) before it is configured
    expect(c.Members().map((m) => m.Name(true))).toEqual(['BUS.A0', 'BUS.A{slash}B', 'BUS.CE']);
  });

  it('SetPrefix pushes to members; SetSuffix stays on the bus (issue #21798)', () => {
    const c = new SCH_CONNECTION();
    c.ConfigureFromLabel('D[1..0]');
    c.SetPrefix('P.');
    expect(c.Name(true)).toBe('P.D[1..0]');
    expect(c.Members().map((m) => m.Name(true))).toEqual(['P.D0', 'P.D1']);
    c.SetSuffix('_1');
    expect(c.Name(true)).toBe('P.D[1..0]_1');
    expect(c.Members().map((m) => m.Name(true))).toEqual(['P.D0', 'P.D1']);
  });

  it('recacheName: a sheet path is prepended unless a global label or non-local-power pin drives', () => {
    const { subPath, label } = withSubSheet();
    const c = new SCH_CONNECTION(label, subPath);
    c.ConfigureFromLabel('N');
    expect(c.Name()).toBe('/sub/N');
    expect(c.Name(true)).toBe('N');

    c.SetDriver(new SCH_GLOBALLABEL({ x: 0, y: 0 }, 'N'));
    expect(c.Name()).toBe('N');

    const lib = new LIB_SYMBOL('PWR');
    const pin = SCH_PIN.makeLibPin(
      lib,
      'VCC',
      '1',
      PIN_ORIENTATION.PIN_DOWN,
      ELECTRICAL_PINTYPE.PT_POWER_IN,
      100,
      50,
      50,
      0,
      { x: 0, y: 0 },
      1,
    );
    lib.AddDrawItem(pin);
    lib.SetGlobalPower();
    c.SetDriver(pin);
    expect(c.Name()).toBe('N');
    lib.SetLocalPower();
    c.SetDriver(pin);
    expect(c.Name()).toBe('/sub/N');

    // no parent: never a path
    const orphan = new SCH_CONNECTION(null, subPath);
    orphan.ConfigureFromLabel('N');
    expect(orphan.Name()).toBe('N');
  });

  it('SetDriver / SetSheet reach the members; the driver-changed flag tracks Reset', () => {
    const { top, subPath, label } = withSubSheet();
    const c = new SCH_CONNECTION(label, top);
    c.ConfigureFromLabel('D[1..0]');
    c.SetDriver(label);
    expect(c.Members().every((m) => m.Driver() === label)).toBe(true);
    c.SetSheet(subPath);
    expect(c.Members().every((m) => m.Sheet().equals(subPath))).toBe(true);
    expect(c.Name()).toBe('/sub/D[1..0]');

    expect(c.HasDriverChanged()).toBe(true); // last driver was null
    c.ClearDriverChanged();
    expect(c.HasDriverChanged()).toBe(false);
    const other = new SCH_LABEL();
    c.SetDriver(other); // changed since ClearDriverChanged: Reset remembers this one
    c.Reset();
    expect(c.GetLastDriver()).toBe(other);
    expect(c.Driver()).toBeNull();
    expect(c.HasDriverChanged()).toBe(true);
    expect(c.IsUnconnected()).toBe(true);
    expect(c.Members()).toHaveLength(0);
  });

  it('Clone copies the net but not the local name once set, the subgraph code, or the local sheet', () => {
    const { top, subPath, label } = withSubSheet();
    const src = new SCH_CONNECTION(label, subPath);
    src.ConfigureFromLabel('SRC');
    src.SetSubgraphCode(7);
    src.SetNetCode(3);

    const dst = new SCH_CONNECTION(label, top);
    dst.ConfigureFromLabel('DST');
    dst.Clone(src);
    expect(dst.Name(true)).toBe('SRC');
    expect(dst.LocalName()).toBe('DST'); // not cloned once set
    expect(dst.SubgraphCode()).toBe(0);
    expect(dst.NetCode()).toBe(3);
    expect(dst.Sheet().equals(subPath)).toBe(true);
    expect(dst.LocalSheet().equals(top)).toBe(true);

    const blank = new SCH_CONNECTION(label, top);
    blank.Clone(src);
    expect(blank.LocalName()).toBe('SRC'); // empty, so taken

    // equality is the net, not the owner or the codes
    expect(dst.equals(src)).toBe(true);
    dst.SetSubgraphCode(99);
    expect(dst.equals(src)).toBe(true);
    dst.SetName('OTHER');
    expect(dst.notEquals(src)).toBe(true);
  });

  it('Clone of bus into bus keeps member local names; vector index of existing members stays', () => {
    const src = new SCH_CONNECTION();
    src.ConfigureFromLabel('X[1..0]');
    const dst = new SCH_CONNECTION();
    dst.ConfigureFromLabel('Y[1..0]');
    dst.Clone(src);
    expect(dst.Members().map((m) => [m.Name(true), m.LocalName()])).toEqual([
      ['X0', 'Y0'],
      ['X1', 'Y1'],
    ]);

    // a net cloned from a bus gets fresh member copies, not the source's objects
    const net = new SCH_CONNECTION();
    net.ConfigureFromLabel('N');
    net.Clone(src);
    expect(net.IsBus()).toBe(true);
    expect(net.Members().map((m) => [m.Name(true), m.VectorIndex()])).toEqual([
      ['X0', 0],
      ['X1', 1],
    ]);
    expect(net.Members()[0]).not.toBe(src.Members()[0]);

    // group into group matches members by local name
    const g1 = new SCH_CONNECTION(aliasGraph({}));
    g1.ConfigureFromLabel('{A B}');
    const g2 = new SCH_CONNECTION(aliasGraph({}));
    g2.ConfigureFromLabel('{B A}');
    g2.Members()[0]!.SetName('RENAMED');
    g1.Clone(g2);
    expect(g1.Members().map((m) => m.Name(true))).toEqual(['A', 'RENAMED']);
  });

  it('IsSubsetOf / IsMemberOfBus', () => {
    const g = new SCH_CONNECTION(aliasGraph({}));
    g.ConfigureFromLabel('{A B C}');
    const ab = new SCH_CONNECTION(aliasGraph({}));
    ab.ConfigureFromLabel('{A B}');
    const ad = new SCH_CONNECTION(aliasGraph({}));
    ad.ConfigureFromLabel('{A D}');
    const b = new SCH_CONNECTION();
    b.ConfigureFromLabel('B');
    const d = new SCH_CONNECTION();
    d.ConfigureFromLabel('D');

    expect(ab.IsSubsetOf(g)).toBe(true);
    expect(ad.IsSubsetOf(g)).toBe(false);
    expect(b.IsSubsetOf(g)).toBe(true);
    expect(d.IsSubsetOf(g)).toBe(false);
    expect(g.IsSubsetOf(b)).toBe(false); // not a bus
    expect(b.IsMemberOfBus(g)).toBe(true);
    expect(d.IsMemberOfBus(g)).toBe(false);
    expect(b.IsMemberOfBus(d)).toBe(false);
  });

  it('IsBusLabel / MightBeBusLabel', () => {
    expect(SCH_CONNECTION.IsBusLabel('A[0..7]')).toBe(true);
    expect(SCH_CONNECTION.IsBusLabel('USB{DP DM}')).toBe(true);
    expect(SCH_CONNECTION.IsBusLabel('A[0]')).toBe(false);
    expect(SCH_CONNECTION.MightBeBusLabel('A[0]')).toBe(true);
    expect(SCH_CONNECTION.MightBeBusLabel('~{RST}')).toBe(true);
    expect(SCH_CONNECTION.MightBeBusLabel('RST')).toBe(false);
  });

  it('IsDriver: labels, sheet pins and sheets drive; a pin only when power or annotated', () => {
    const { schematic, top } = withSubSheet();
    expect(new SCH_CONNECTION(new SCH_LABEL()).IsDriver()).toBe(true);
    expect(new SCH_CONNECTION(new SCH_GLOBALLABEL()).IsDriver()).toBe(true);

    const lib = new LIB_SYMBOL('R');
    lib.AddDrawItem(
      SCH_PIN.makeLibPin(
        lib,
        '~',
        '1',
        PIN_ORIENTATION.PIN_DOWN,
        ELECTRICAL_PINTYPE.PT_PASSIVE,
        100,
        50,
        50,
        0,
        { x: 0, y: 0 },
        1,
      ),
    );
    const symbol = new SCH_SYMBOL(lib, new LIB_ID('Device', 'R'), top, 1, 0, { x: 0, y: 0 });
    top.LastScreen()!.Append(symbol);
    const pin = symbol.GetPins(top)[0]!;
    expect(pin.GetParentSymbol()).toBe(symbol);
    expect(schematic).toBeTruthy();

    symbol.SetRef(top, 'R?');
    expect(new SCH_CONNECTION(pin, top).IsDriver()).toBe(false);
    symbol.SetRef(top, 'R1');
    expect(new SCH_CONNECTION(pin, top).IsDriver()).toBe(true);
  });

  it('GetNetName asks the graph for the parent item subgraph', () => {
    const label = new SCH_LABEL();
    const c = new SCH_CONNECTION(label);
    expect(c.GetNetName()).toBe('');
    c.SetGraph({
      GetBusAlias: () => null,
      GetSubgraphForItem: (item) => (item === label ? { GetNetName: () => '/X' } : null),
    });
    expect(c.GetNetName()).toBe('/X');
  });
});

describe("SCH_ITEM's connection map", () => {
  it('InitializeConnection makes one connection per sheet; a second call resets it', () => {
    const { schematic, top, subPath, label } = withSubSheet();
    const graph = aliasGraph({});
    expect(label.Connection(subPath)).toBeNull();

    const onSub = label.InitializeConnection(subPath, graph);
    expect(onSub.Parent()).toBe(label);
    expect(onSub.Sheet().equals(subPath)).toBe(true);
    expect(label.Connection(subPath)).toBe(onSub);
    expect(label.Connection(top)).toBeNull();

    const onTop = label.GetOrInitConnection(top, graph)!;
    expect(onTop).not.toBe(onSub);
    expect(label.GetOrInitConnection(top, graph)).toBe(onTop);

    onSub.ConfigureFromLabel('N');
    expect(label.InitializeConnection(subPath, graph)).toBe(onSub);
    expect(onSub.IsUnconnected()).toBe(true);

    // no sheet: the schematic's current sheet
    schematic.SetCurrentSheet(subPath);
    expect(label.Connection()).toBe(onSub);

    // SetConnectionGraph reaches every connection and member
    onTop.ConfigureFromLabel('B[1..0]');
    label.SetConnectionGraph({
      GetBusAlias: () => null,
      GetSubgraphForItem: () => ({ GetNetName: () => 'G' }),
    });
    expect(onTop.GetNetName()).toBe('G');
    expect(onTop.Members()[1]!.GetNetName()).toBe('G');
  });

  it('an item that cannot connect never has a connection', () => {
    const { top } = withSubSheet();
    const sheet = new SCH_SCREEN();
    expect(sheet).toBeTruthy();
    const notConnectable = new LIB_SYMBOL('X');
    expect(notConnectable.GetOrInitConnection(top, null)).toBeNull();
    expect(notConnectable.Connection(top)).toBeNull();
  });
});
