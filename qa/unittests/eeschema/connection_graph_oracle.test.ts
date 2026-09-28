// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The live CONNECTION_GRAPH against the `(nets …)` section `kicad-cli sch export netlist`
 * wrote for the same design (qa/data/eeschema/netlist_oracle, the designs
 * `designer/netlist_oracle.test.ts` pins the record-model engine to, and the other 21 of
 * KiCad's qa/data/eeschema/netlists designs in netlist_oracle_graph).
 *
 * Each design is read with the live-model reader (SCH_IO_KICAD_SEXPR), prepared the way
 * EESCHEMA_HELPERS::LoadSchematic prepares it, and the graph recalculated unconditionally.
 * The nets section is then written the way NETLIST_EXPORTER_XML::makeListOfNets writes it
 * (GNL_OPT_KICAD: escaped names, board-excluded pins dropped, sorted by StrNumCmp, nodes by
 * reference then pin, "#" references skipped, stacked pins expanded) and compared whole,
 * line for line, with the oracle's.  Everything in it — every net name, every code (the
 * sorted position), every node, the no_connect marks — comes from the graph.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT } from '@ziroeda/common/project.js';
import { PROJECT_FILE } from '@ziroeda/common/project/project_file.js';
import { PRETTIFIED_STRING_FORMATTER } from '@ziroeda/common/richio.js';
import { strNumCmp, unescapeString } from '@ziroeda/common/string_utils.js';
import { XNODE, wxXmlNodeType } from '@ziroeda/common/xnode.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { CONNECTION_GRAPH } from '@ziroeda/eeschema/connection_graph.js';
import { SCH_IO_KICAD_SEXPR } from '@ziroeda/eeschema/sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import type { SCH_PIN } from '@ziroeda/eeschema/sch_pin.js';
import { SCH_RULE_AREA } from '@ziroeda/eeschema/sch_rule_area.js';
import { SCH_SCREENS } from '@ziroeda/eeschema/sch_screen.js';
import type { SCH_SHEET_PATH } from '@ziroeda/eeschema/sch_sheet_path.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCHEMATIC } from '@ziroeda/eeschema/schematic.js';

const DATA = new URL('../../data/eeschema/', import.meta.url).pathname;
const ORACLES = [`${DATA}netlist_oracle/`, `${DATA}netlist_oracle_graph/`];

/** EESCHEMA_HELPERS::LoadSchematic, as far as the live model has it, then Recalculate. */
function loadAndConnect(aDir: string, aName: string) {
  const file = join(aDir, `${aName}.kicad_sch`);
  const pro = join(aDir, `${aName}.kicad_pro`);
  const project = new PROJECT();
  project.setProjectFullName(pro);
  const projectFile = new PROJECT_FILE(pro);
  project.setProjectFile(projectFile);

  if (existsSync(pro)) projectFile.LoadFromFile(JSON.parse(readFileSync(pro, 'utf8')));

  const readFile = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);

  const schematic = new SCHEMATIC(project);
  schematic.CreateDefaultScreens();

  const pi = new SCH_IO_KICAD_SEXPR('eeschema');
  const rootSheet = pi.LoadSchematicFile(file, schematic, aDir, readFile);
  schematic.SetTopLevelSheets([rootSheet]);

  if (rootSheet.GetName() === '') rootSheet.SetName('Root');

  const sheetList = schematic.BuildSheetListSortedByPageNumbers();
  const screens = new SCH_SCREENS(schematic.Root());

  for (let screen = screens.GetFirst(); screen; screen = screens.GetNext())
    screen.UpdateLocalLibSymbolLinks();

  const rootScreen = schematic.RootScreen()!;

  if (rootScreen.GetFileFormatVersionAtLoad() < 20221002)
    sheetList.UpdateSymbolInstanceData(rootScreen.GetSymbolInstances());

  sheetList.UpdateSheetInstanceData(rootScreen.GetSheetInstances());

  if (rootScreen.GetFileFormatVersionAtLoad() < 20230221) screens.FixLegacyPowerSymbolMismatches();

  if (sheetList.AllSheetPageNumbersEmpty()) sheetList.SetInitialPageNumbers();
  else sheetList.RepairPageNumbers();

  schematic.SetCurrentSheet(sheetList[0]!);

  // SCHEMATIC::RecalculateConnections( GLOBAL_CLEANUP ): the rule areas, then the graph.
  // (CleanUp is not on the live model; these KiCad-written files are already clean.)
  const list = schematic.BuildSheetListSortedByPageNumbers();
  SCH_RULE_AREA.UpdateRuleAreasInScreens(new Set(list.map((path) => path.LastScreen()!)));

  const graph = new CONNECTION_GRAPH(schematic);
  graph.Recalculate(list, true);

  return { schematic, project, graph };
}

function node(aName: string, aContent = ''): XNODE {
  const n = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, aName);

  if (aContent.length > 0) n.AddChild(new XNODE(wxXmlNodeType.wxXML_TEXT_NODE, '', aContent));

  return n;
}

/** NETLIST_EXPORTER_XML::makeListOfNets( GNL_OPT_KICAD ), over the graph's net map. */
function netsSection(graph: CONNECTION_GRAPH, project: PROJECT): string {
  interface NET_NODE {
    pin: SCH_PIN;
    sheet: SCH_SHEET_PATH;
  }
  interface NET_RECORD {
    name: string;
    cls: string;
    hasNoConnect: boolean;
    nodes: NET_NODE[];
  }

  const nets: NET_RECORD[] = [];
  const netSettings = project.GetProjectFile().m_NetSettings;

  for (const [key, subgraphs] of graph.GetNetMap()) {
    if (subgraphs.length === 0) continue;

    const rec: NET_RECORD = { name: key.Name, cls: '', hasNoConnect: false, nodes: [] };
    nets.push(rec);

    const nc = netSettings.GetEffectiveNetClass(key.Name);

    if (nc) rec.cls = unescapeString(nc.GetName());

    for (const subgraph of subgraphs) {
      const noConnect = subgraph.GetNoConnect();
      const sheet = subgraph.GetSheet();

      if (noConnect && noConnect.Type() === KICAD_T.SCH_NO_CONNECT_T) rec.hasNoConnect = true;

      for (const item of subgraph.GetItems()) {
        if (item.Type() !== KICAD_T.SCH_PIN_T) continue;

        const pin = item as SCH_PIN;
        const symbol = pin.GetParentSymbol() as unknown as SCH_SYMBOL | null;

        if (!symbol || symbol.Type() !== KICAD_T.SCH_SYMBOL_T) continue;

        if (sheet.GetExcludedFromBoard() || symbol.ResolveExcludedFromBoard()) continue;

        rec.nodes.push({ pin, sheet });
      }
    }
  }

  nets.sort((a, b) => strNumCmp(a.name, b.name));

  const refOf = (n: NET_NODE): string =>
    (n.pin.GetParentSymbol() as unknown as SCH_SYMBOL).GetRef(n.sheet);

  const xnets = node('nets');

  nets.forEach((rec, i) => {
    rec.nodes.sort((a, b) => {
      const refA = refOf(a);
      const refB = refOf(b);

      if (refA === refB) {
        const na = a.pin.GetShownNumber();
        const nb = b.pin.GetShownNumber();
        return na < nb ? -1 : na > nb ? 1 : 0;
      }

      return refA < refB ? -1 : 1;
    });

    rec.nodes = rec.nodes.filter(
      (n, k) =>
        k === 0 ||
        !(
          refOf(rec.nodes[k - 1]!) === refOf(n) &&
          rec.nodes[k - 1]!.pin.GetShownNumber() === n.pin.GetShownNumber()
        ),
    );

    let allNetPinsStacked = true;

    if (rec.nodes.length > 1) {
      const firstPin = rec.nodes[0]!.pin;
      allNetPinsStacked = rec.nodes
        .slice(1)
        .every(
          (n) =>
            firstPin.GetParent() === n.pin.GetParent() &&
            firstPin.GetPosition().x === n.pin.GetPosition().x &&
            firstPin.GetPosition().y === n.pin.GetPosition().y &&
            firstPin.GetName() === n.pin.GetName(),
        );
    }

    let xnet: XNODE | null = null;

    for (const n of rec.nodes) {
      const refText = refOf(n);

      // Skip power symbols and virtual symbols
      if (refText[0] === '#') continue;

      if (!xnet) {
        xnet = node('net');
        xnets.AddChild(xnet);
        xnet.AddAttribute('code', String(i + 1));
        xnet.AddAttribute('name', rec.name);
        xnet.AddAttribute('class', rec.cls);
      }

      const nums = n.pin.GetStackedPinNumbers();
      const baseName = n.pin.GetShownName();
      const pinType = n.pin.GetCanonicalElectricalTypeName();

      for (const num of nums) {
        const xnode = node('node');
        xnet.AddChild(xnode);
        xnode.AddAttribute('ref', refText);
        xnode.AddAttribute('pin', num);

        const fullName = baseName === '' ? num : `${baseName}_${num}`;

        if (baseName !== '' || nums.length > 1) xnode.AddAttribute('pinfunction', fullName);

        let typeAttr = pinType;

        if (rec.hasNoConnect && (rec.nodes.length === 1 || allNetPinsStacked))
          typeAttr += '+no_connect';

        xnode.AddAttribute('pintype', typeAttr);
      }
    }
  });

  const root = node('export');
  root.AddChild(xnets);
  const formatter = new PRETTIFIED_STRING_FORMATTER();
  root.Format(formatter);
  return extractNets(formatter.Finish());
}

/** The `\t(nets` … `\t)` block of a KiCad netlist (the whole section, both ends included). */
function extractNets(aText: string): string {
  const lines = aText.split('\n');
  const start = lines.findIndex((l) => l === '\t(nets');

  if (start < 0) return '';

  const end = lines.findIndex((l, i) => i > start && l === '\t)');
  return lines.slice(start, end + 1).join('\n');
}

describe('CONNECTION_GRAPH: the nets section, against kicad-cli', () => {
  it('has every KiCad netlist design', () => {
    const names = ORACLES.flatMap((o) => readdirSync(o).filter((n) => !n.includes('.')));
    expect(names).toHaveLength(45);
  });

  // One folder per design; each passes whole or not at all.
  for (const oracle of ORACLES) {
    for (const name of readdirSync(oracle).filter((n) => !n.includes('.'))) {
      it(`${name}: nets match line for line`, { timeout: 60000 }, () => {
        const dir = `${oracle}${name}/`;
        const { graph, project } = loadAndConnect(dir, name);

        const want = extractNets(readFileSync(`${dir}${name}.kicad-cli.net`, 'utf8')).split('\n');
        const got = netsSection(graph, project).split('\n');
        const firstDiff = want.findIndex((line, i) => line !== got[i]);

        expect(want.length).toBeGreaterThan(2);
        expect(
          firstDiff === -1
            ? null
            : {
                line: firstDiff + 1,
                want: want.slice(Math.max(0, firstDiff - 6), firstDiff + 3),
                got: got.slice(Math.max(0, firstDiff - 6), firstDiff + 3),
              },
        ).toBeNull();
        expect(got.length).toBe(want.length);
      });
    }
  }
});
