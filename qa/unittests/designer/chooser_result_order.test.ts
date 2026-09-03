// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The ORDER the Choose Symbol tree puts search results in.
 *
 * Every expectation below is a literal list read off KiCad 10.0.5 — the
 * Connector one off a screenshot of its Choose Symbol dialog, both of them
 * corroborated by qa/probes/chooser_score, which compiles KiCad's own
 * common/eda_pattern_match.cpp and scores the same libraries with it. None of
 * them is our own output written back down; that is the point of the file,
 * because the ranking drifted for months while every scoring unit test passed.
 *
 * The symbol data is verbatim from /usr/share/kicad/symbols (KiCad 10.0.5):
 * inlined rather than read off disk so the test pins a known corpus instead of
 * whatever library version the machine happens to have installed.
 */
import { describe, it, expect } from 'vitest';
import type { LibSymbol } from '@ziroeda/eeschema';
import {
  symbolChooserFields,
  symbolSearchTerms,
} from '@ziroeda/designer/src/editors/schematic/symbol_search_terms.js';
import { LibTreeNode, LibTreeNodeType } from '@ziroeda/designer/src/widgets/lib_tree_model.js';
import { LibTreeModelAdapter } from '@ziroeda/designer/src/widgets/lib_tree_model_adapter.js';

interface Fixture {
  name: string;
  /** The Value field. Not always the symbol name, and it is a shown column. */
  value?: string;
  keywords: string;
  desc: string;
  footprint?: string;
}

/** Enough of a LIB_SYMBOL for the two caches: the property list. */
function libSymbol(nickname: string, f: Fixture): LibSymbol {
  const props = [
    { key: 'Reference', value: 'J', angle: 0 },
    { key: 'Value', value: f.value ?? f.name, angle: 0 },
    { key: 'Footprint', value: f.footprint ?? '', angle: 0 },
    { key: 'Datasheet', value: '~', angle: 0 },
    { key: 'Description', value: f.desc, angle: 0 },
    { key: 'ki_keywords', value: f.keywords, angle: 0 },
    { key: 'ki_fp_filters', value: 'Connector*', angle: 0 },
  ];
  return {
    libId: `${nickname}:${f.name}`,
    isPower: false,
    units: [],
    properties: props,
  } as unknown as LibSymbol;
}

/**
 * One library of fixture symbols, built the way `populateItemNode` builds a
 * row: the item's own terms from `cacheSearchTerms`, the chooser fields from
 * `cacheChooserFields`, then `AssignIntrinsicRanks` to rebuild the terms
 * against the shown columns and hand out the tie-break ranks.
 */
function buildLibrary(nickname: string, fixtures: readonly Fixture[]): LibTreeModelAdapter {
  const adapter = new LibTreeModelAdapter();
  // These orders are the SYMBOL CHOOSER's, so the adapter has to be the one the
  // chooser builds. `SYMBOL_TREE_MODEL_ADAPTER` is the only adapter upstream
  // that adds Value and Footprint (symbol_tree_model_adapter.cpp:54-58, and
  // :74 for the shown set) - the base pair is Item and Description, which is
  // what the symbol EDITOR and both footprint trees get.
  //
  // This used to come free because our base adapter carried the chooser's
  // columns, which is upstream inverted; the expectations below are unchanged,
  // and they are exactly what pins it, since Value is a weight-4 search term
  // and dropping it moves "res" in Device and the DIN-5 score from 34 to 30.
  adapter.setSymbolChooserColumns();
  const lib = adapter.addLibrary(nickname, '', false);

  for (const f of fixtures) {
    const sym = libSymbol(nickname, f);
    const item = new LibTreeNode();
    item.type = LibTreeNodeType.ITEM;
    item.parent = lib;
    item.name = f.name;
    item.libNickname = nickname;
    item.libItemName = f.name;
    item.desc = f.desc;
    item.sourceSearchTerms = symbolSearchTerms(nickname, f.name, sym);
    item.fields = symbolChooserFields(sym);
    lib.children.push(item);
  }

  adapter.finishLibrary(lib);
  adapter.tree.assignIntrinsicRanks();
  return adapter;
}

/** The rows the tree draws: `GetChildren` shows only `m_Score > 0`. */
function resultOrder(adapter: LibTreeModelAdapter, query: string): string[] {
  adapter.updateSearchString(query);
  return adapter.tree.children.flatMap((lib) =>
    lib.children.filter((c) => c.score > 0).map((c) => c.name),
  );
}

// Connector.kicad_sym. Every symbol here matches "ter" somewhere; the two
// Screw_Terminal rows stand in for the 01x01..01x20 block that heads the real
// list, and DVI/RJ45 are the rows our ranking used to lift into the middle.
const CONNECTOR: Fixture[] = [
  {
    name: 'Screw_Terminal_01x01',
    keywords: 'screw terminal',
    desc: 'Generic screw terminal, single row, 01x01, script generated (kicad-library-utils/schlib/autogen/connector/)',
  },
  {
    name: 'Screw_Terminal_01x02',
    keywords: 'screw terminal',
    desc: 'Generic screw terminal, single row, 01x02, script generated (kicad-library-utils/schlib/autogen/connector/)',
  },
  {
    name: 'DIN-7_CenterPin7',
    keywords: 'circular DIN connector',
    desc: '7-pin DIN connector with pin 7 in center',
  },
  {
    name: 'DIN-5_180degree',
    keywords: 'circular DIN connector stereo audio',
    desc: '5-pin DIN connector (5-pin DIN-5 stereo)',
  },
  {
    name: 'Samtec_ASP-134486-01',
    keywords: 'FPGA Mezzanine Card FMC Terminal Connector Header',
    desc: 'Connector array, 10x40, 1.27mm pitch, carrier-card, receptacle, gold finish, VITA 57.1 FMC, SMD',
  },
  {
    name: 'Samtec_ASP-134602-01',
    keywords: 'FPGA Mezzanine Card FMC Terminal Connector Header',
    desc: 'Connector array, 10x40, 1.27mm pitch, mezzanine-card, plug, gold finish, VITA 57.1 FMC, SMD',
  },
  {
    name: 'Barrel_Jack_Switch',
    keywords: 'DC power barrel jack connector',
    desc: 'DC Barrel Jack with an internal switch',
  },
  {
    name: 'Barrel_Jack_Switch_MountingPin',
    keywords: 'DC power barrel jack connector',
    desc: 'DC Barrel Jack with an internal switch and a mounting pin',
  },
  {
    name: 'Barrel_Jack_Switch_Pin3Ring',
    keywords: 'DC power barrel jack connector',
    desc: 'DC Barrel Jack with an internal switch',
  },
  {
    name: 'Conn_ARM_JTAG_SWD_10',
    keywords: 'Cortex Debug Connector ARM SWD JTAG',
    desc: 'Cortex Debug Connector, standard ARM Cortex-M SWD and JTAG interface',
  },
  {
    name: 'Conn_ARM_JTAG_SWD_20',
    keywords: 'IDC20 Pinheader Pins Connector ARM JTAG SWD',
    desc: 'Standard IDC20 Pinheader Connector, ARM legacy JTAG and SWD interface',
  },
  {
    name: 'Conn_ST_STDC14',
    keywords: 'ST STM32 Cortex Debug Connector ARM SWD JTAG',
    desc: 'ST Debug Connector, standard ARM Cortex-M SWD and JTAG interface plus UART',
  },
  {
    name: 'DVI-D_Dual_Link',
    keywords: 'dvi digital visual interface',
    desc: 'DVI-D dual link connector',
  },
  {
    name: 'DVI-I_Dual_Link',
    keywords: 'dvi digital visual interface',
    desc: 'DVI-I dual link connector',
  },
  {
    name: 'RJ45_Bel_V895-1001-AW',
    keywords: 'single port ethernet transformer socket poe center-tap',
    desc: 'RJ45 PoE 10/100 Base-TX Jack with Magnetic Module',
    footprint: 'Connector_RJ:RJ45_Bel_V895-1001-AW_Vertical',
  },
];

// Device.kicad_sym, the rows "res" ranks highest.
const DEVICE: Fixture[] = [
  { name: 'Resonator', keywords: 'ceramic resonator', desc: 'Three pin ceramic resonator' },
  {
    name: 'Resonator_Small',
    keywords: 'ceramic resonator',
    desc: 'Three pin ceramic resonator, small symbol',
  },
  { name: 'R', keywords: 'R res resistor', desc: 'Resistor' },
  { name: 'R_45deg', keywords: 'R res resistor diagonal', desc: 'Resistor, rotated by 45°' },
  { name: 'R_US', keywords: 'R res resistor', desc: 'Resistor, US symbol' },
  {
    name: 'R_Shunt',
    keywords: 'R res shunt resistor',
    desc: 'Shunt resistor with Kelvin connections',
  },
  {
    name: 'R_Trim',
    keywords: 'R res resistor variable potentiometer trimmer',
    desc: 'Trimmable resistor (preset resistor)',
  },
  {
    name: 'R_Variable',
    keywords: 'R res resistor variable potentiometer rheostat',
    desc: 'Variable resistor',
  },
  { name: 'Thermistor', keywords: 'R res thermistor', desc: 'Temperature dependent resistor' },
  {
    name: 'Polyfuse',
    keywords: 'resettable fuse PTC PPTC polyfuse polyswitch',
    desc: 'Resettable fuse, polymeric positive temperature coefficient',
  },
];

describe('Choose Symbol result order', () => {
  /**
   * Read off KiCad 10.0.5's Choose Symbol dialog, query "ter", Connector
   * region, immediately after the Screw_Terminal_01x01..01x20 block.
   *
   * The two pairs that carry the whole finding:
   *
   *   DIN-5_180degree above Samtec_ASP-134486-01, even though Samtec's keyword
   *   "Terminal" matches at position 0 and doubles to 8 where DIN-5's "stereo"
   *   matches mid-word for 4. DIN-5's description matches and Samtec's does
   *   not, and the description is worth 1 as a search term plus 4 as a shown
   *   column. 11 against 10. Without the column term it is 7 against 10 and
   *   they swap.
   *
   *   Barrel_Jack_Switch above DVI-D_Dual_Link, though Barrel matches only in
   *   its description and DVI-D matches a keyword token. Same reason: the
   *   description is worth 5 in total, which ties DVI-D's 4 + 1, and a tie
   *   falls to the intrinsic rank, i.e. to the alphabet.
   */
  it('matches KiCad for "ter" in Connector', () => {
    expect(resultOrder(buildLibrary('Connector', CONNECTOR), 'ter')).toEqual([
      'Screw_Terminal_01x01',
      'Screw_Terminal_01x02',
      'DIN-7_CenterPin7',
      'DIN-5_180degree',
      'Samtec_ASP-134486-01',
      'Samtec_ASP-134602-01',
      'Barrel_Jack_Switch',
      'Barrel_Jack_Switch_MountingPin',
      'Barrel_Jack_Switch_Pin3Ring',
      'Conn_ARM_JTAG_SWD_10',
      'Conn_ARM_JTAG_SWD_20',
      'Conn_ST_STDC14',
      'DVI-D_Dual_Link',
      'DVI-I_Dual_Link',
      'RJ45_Bel_V895-1001-AW',
    ]);
  });

  /**
   * Query "res" in Device. Resonator outranks R although R's name, LIB_ID and
   * three keyword tokens all match: Resonator's VALUE field matches at
   * position 0 for 2 x 4, and Value is a shown column
   * (symbol_tree_model_adapter.cpp:74). 55 against 52. Drop Value from the
   * shown columns and Resonator falls to 47, below all three R rows — which is
   * the case the Connector list cannot see, and the reason Value is in the
   * default column list rather than only Description.
   */
  it('matches KiCad for "res" in Device', () => {
    expect(resultOrder(buildLibrary('Device', DEVICE), 'res').slice(0, 8)).toEqual([
      'Resonator',
      'Resonator_Small',
      'R',
      'R_45deg',
      'R_US',
      'R_Shunt',
      'R_Trim',
      'R_Variable',
    ]);
  });

  /**
   * The scores themselves, so a change that reorders nothing in these two
   * lists still has to explain itself. Both are KiCad's, printed by
   * qa/probes/chooser_score against the full libraries.
   */
  it('scores DIN-5 over Samtec and Resonator over R, by KiCad`s numbers', () => {
    const connector = buildLibrary('Connector', CONNECTOR);
    connector.updateSearchString('ter');
    const byName = (a: LibTreeModelAdapter, n: string) =>
      a.tree.children[0]!.children.find((c) => c.name === n)!.score;

    expect(byName(connector, 'DIN-7_CenterPin7')).toBe(34);
    expect(byName(connector, 'DIN-5_180degree')).toBe(11);
    expect(byName(connector, 'Samtec_ASP-134486-01')).toBe(10);
    expect(byName(connector, 'Barrel_Jack_Switch')).toBe(6);
    expect(byName(connector, 'DVI-D_Dual_Link')).toBe(6);

    const device = buildLibrary('Device', DEVICE);
    device.updateSearchString('res');
    expect(byName(device, 'Resonator')).toBe(55);
    expect(byName(device, 'R')).toBe(52);
  });
});

describe('what the chooser searches', () => {
  const sym = libSymbol('Connector', CONNECTOR[3]!); // DIN-5_180degree

  /**
   * cacheChooserFields takes every field. SCH_FIELD::m_showInChooser is
   * initialised true (eeschema/sch_field.cpp:130) and nothing in KiCad 10.0.5
   * ever clears it, so a symbol that carries no `show_in_chooser` token — which
   * is every symbol, the token does not exist in this format — still offers all
   * of its fields. Gating on our parsed flag left this map holding only the
   * "Keywords" fallback, and that is what unranked the tree.
   */
  it('offers every field as a chooser field, with no show_in_chooser flag set', () => {
    const fields = symbolChooserFields(sym);
    expect([...fields.keys()].sort()).toEqual([
      'Datasheet',
      'Description',
      'Footprint',
      'Keywords',
      'Reference',
      'Value',
    ]);
    expect(fields.get('Description')).toBe('5-pin DIN connector (5-pin DIN-5 stereo)');
    expect(fields.get('Value')).toBe('DIN-5_180degree');
  });

  /** The four the parser eats into LIB_SYMBOL members are not fields. */
  it('does not offer ki_keywords or ki_fp_filters as columns', () => {
    const fields = symbolChooserFields(sym);
    expect(fields.has('ki_keywords')).toBe(false);
    expect(fields.has('ki_fp_filters')).toBe(false);
    // ...but the keywords still reach the tree, under the name upstream gives
    // them when the symbol has no field of its own called "Keywords".
    expect(fields.get('Keywords')).toBe('circular DIN connector stereo audio');
  });

  /** cacheSearchTerms, in order and with upstream's weights. */
  it('builds the seven weighted terms', () => {
    expect(symbolSearchTerms('Connector', 'DIN-5_180degree', sym)).toEqual([
      { text: 'Connector', score: 4, isName: false },
      { text: 'DIN-5_180degree', score: 8, isName: true },
      { text: 'Connector:DIN-5_180degree', score: 16, isName: true },
      { text: 'circular', score: 4, isName: false },
      { text: 'DIN', score: 4, isName: false },
      { text: 'connector', score: 4, isName: false },
      { text: 'stereo', score: 4, isName: false },
      { text: 'audio', score: 4, isName: false },
      { text: 'circular DIN connector stereo audio', score: 1, isName: false },
      { text: '5-pin DIN connector (5-pin DIN-5 stereo)', score: 1, isName: false },
    ]);
  });

  /** An empty Footprint contributes no term at all (`if( !footprint.IsEmpty() )`). */
  it('adds the footprint term only when the symbol has one', () => {
    const withFp = libSymbol('Connector', CONNECTOR[14]!); // RJ45_Bel, has a footprint
    const terms = symbolSearchTerms('Connector', 'RJ45_Bel_V895-1001-AW', withFp);
    expect(terms.at(-1)).toEqual({
      text: 'Connector_RJ:RJ45_Bel_V895-1001-AW_Vertical',
      score: 1,
      isName: false,
    });
    expect(symbolSearchTerms('Connector', 'DIN-5_180degree', sym).map((t) => t.text)).not.toContain(
      '',
    );
  });
});
