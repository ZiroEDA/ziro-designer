// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * search_handlers.cpp's five handlers on a live schematic: qa/data/eeschema/search_pane, which
 * kicad-cli reads as R1 on the root and one sub-sheet used twice (its resistor is R10 on S1 and
 * R2 on S2), plus a power symbol, text, a text box, a local, a global and a directive label, a
 * hierarchical label on the sub-sheet and a group. Every count below is that file's.
 *
 * - An empty query lists everything: each predicate is `findString.IsEmpty() || Matches(...)`
 *   and SEARCH_PANE::RefreshSearch passes the query as it is.
 * - FindAll visits a screen once per sheet path that shows it, so the sub-sheet's items are two
 *   rows each.
 * - Symbols and Power split on IsPower; hidden fields are searched only when asked.
 * - Sort is StrNumCmp: R1, R2, R10.
 * - SelectItems changes to the hits' sheet when they share one, selects, and does nothing more
 *   when they do not.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { searchPaneConfig } from '@ziroeda/common/widgets/search_pane.js';
import type {
  SearchHandler,
  SearchPaneMenuState,
} from '@ziroeda/common/widgets/search_pane_types.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { makeSchSearchHandlers } from '@ziroeda/eeschema/widgets/search_handlers.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const DIR = resolve(__dirname, '../../data/eeschema/search_pane');

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

function setUp(aMenu: Partial<SearchPaneMenuState> = {}) {
  const shown: string[] = [];
  const h = schToolHarness(
    schFrame({
      showModal: (aDialog) => {
        shown.push(aDialog);
        return Promise.resolve(0);
      },
    }),
  );
  openProject(h.frame, DIR, 'search', ['search.kicad_sch', 'sub.kicad_sch', 'search.kicad_pro']);

  const menu: SearchPaneMenuState = {
    selectionZoom: 'none',
    searchHiddenFields: false,
    searchMetadata: false,
    ...aMenu,
  };
  const handlers = makeSchSearchHandlers({
    Schematic: () => h.frame.Schematic(),
    GetCurrentSheet: () => h.frame.GetCurrentSheet(),
    GetToolManager: () => h.frame.GetToolManager(),
    MessageTextFromValue: (v) => h.frame.GetUnitsProvider().MessageTextFromValue(v),
    config: () => searchPaneConfig(menu),
    GetCanvas: () => h.frame.GetCanvas(),
  });
  const tab = (aName: string) => handlers.find((x) => x.name === aName)!;
  const selected = () =>
    h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!.GetSelection().GetItems();
  return { h, handlers, tab, selected, shown };
}

/** Column \a aCol of every row, after a search for \a aQuery. */
function cells(aHandler: SearchHandler, aQuery: string, aCol = 0): string[] {
  const n = aHandler.search(aQuery);
  return Array.from({ length: n }, (_, row) => aHandler.getResultCell(row, aCol));
}

describe('SCH_SEARCH_PANE: the handlers and their columns', () => {
  it('adds Symbols, Power, Text, Labels and Groups, in that order', () => {
    const { handlers } = setUp();
    expect(handlers.map((x) => x.name)).toEqual(['Symbols', 'Power', 'Text', 'Labels', 'Groups']);
    expect(handlers[0]!.columns.map((c) => c.name)).toEqual([
      'Reference',
      'Value',
      'Footprint',
      'Page',
      'X',
      'Y',
      'Excl. Sim',
      'Excl. BOM',
      'Excl. Board',
      'Excl. Pos Files',
      'DNP',
      'Library Link',
      'Library Description',
    ]);
    expect(handlers[4]!.columns.map((c) => c.name)).toEqual(['Name', 'Page', 'X', 'Y']);
  });
});

describe('Search', () => {
  it('an empty query lists everything, a shared sheet once per path', () => {
    const { tab } = setUp();
    expect(cells(tab('Symbols'), '').sort()).toEqual(['R1', 'R10', 'R2']);
    expect(cells(tab('Power'), '')).toEqual(['#PWR01']);
    expect(cells(tab('Text'), '').sort()).toEqual(['Text', 'Text Box']);
    expect(cells(tab('Labels'), '').sort()).toEqual([
      'Directive',
      'Global',
      'Hierarchical',
      'Hierarchical',
      'Local',
    ]);
    expect(cells(tab('Groups'), '')).toEqual(['GRP']);
  });

  it('matches a field substring, permissively', () => {
    const { tab } = setUp();
    expect(cells(tab('Symbols'), 'R1').sort()).toEqual(['R1', 'R10']);
    expect(cells(tab('Symbols'), '4k7').sort()).toEqual(['R10', 'R2']);
    expect(cells(tab('Labels'), 'VCC', 1)).toEqual(['VCC_IN']);
  });

  it('searches a hidden field only when Search Hidden Fields is on', () => {
    expect(cells(setUp().tab('Symbols'), 'R_0603')).toEqual([]);
    expect(cells(setUp({ searchHiddenFields: true }).tab('Symbols'), 'R_0603').sort()).toEqual([
      'R1',
      'R10',
      'R2',
    ]);
  });

  it('Search Metadata finds a symbol by its library link, through SCH_FIELD::Matches', () => {
    // No field says "Device:R"; with search_metadata a field defers to its symbol's Matches,
    // which tries the library link, description and keywords.
    expect(cells(setUp().tab('Symbols'), 'Device:R')).toEqual([]);
    expect(cells(setUp({ searchMetadata: true }).tab('Symbols'), 'Device:R').sort()).toEqual([
      'R1',
      'R10',
      'R2',
    ]);
  });

  it('a power symbol is on the Power tab and never on Symbols', () => {
    const { tab } = setUp();
    expect(cells(tab('Symbols'), 'GND')).toEqual([]);
    expect(cells(tab('Power'), 'GND')).toEqual(['#PWR01']);
  });
});

describe('GetResultCell', () => {
  it('a symbol row: reference, value, footprint, page, position, flags and library link', () => {
    const { h, tab } = setUp();
    const symbols = tab('Symbols');
    const n = symbols.search('');
    const row = Array.from({ length: n }, (_, i) => i).find(
      (i) => symbols.getResultCell(i, 0) === 'R1',
    )!;
    const mm = (v: number) => h.frame.GetUnitsProvider().MessageTextFromValue(v);

    expect(Array.from({ length: 13 }, (_, c) => symbols.getResultCell(row, c))).toEqual([
      'R1',
      '10k',
      'Resistor_SMD:R_0603_1608Metric',
      '1',
      mm(508000),
      mm(508000),
      ' ',
      ' ',
      ' ',
      ' ',
      ' ',
      'Device:R',
      symbols.getResultCell(row, 12), // the library's description, whatever it says
    ]);
  });

  it('the sub-sheet rows carry their own page', () => {
    const { tab } = setUp();
    const symbols = tab('Symbols');
    const n = symbols.search('4k7');
    const pages = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        symbols.getResultCell(i, 0),
        symbols.getResultCell(i, 3),
      ]),
    );
    expect(pages).toEqual({ R10: '2', R2: '3' });
  });
});

describe('Sort', () => {
  it('is StrNumCmp on the column, ascending or descending', () => {
    const { tab } = setUp();
    const symbols = tab('Symbols');
    const n = symbols.search('');
    const refs = () => Array.from({ length: n }, (_, i) => symbols.getResultCell(i, 0));

    symbols.sort(0, true, []);
    expect(refs()).toEqual(['R1', 'R2', 'R10']);
    symbols.sort(0, false, []);
    expect(refs()).toEqual(['R10', 'R2', 'R1']);
  });

  it('carries the selected rows to their new places', () => {
    const { tab } = setUp();
    const symbols = tab('Symbols');
    symbols.search('');
    symbols.sort(0, true, []); // R1, R2, R10
    // R1 is row 0 ascending; descending it is row 2
    expect(symbols.sort(0, false, [0])).toEqual([2]);
    // The selection is kept by item, not by row: R10 and R2 are one SCH_SYMBOL on two sheet
    // paths, so picking either row carries both (alg::contains( selection, hit.item )).
    symbols.sort(0, true, []);
    expect(symbols.sort(0, false, [2])).toEqual([0, 1]);
  });
});

describe('SelectItems', () => {
  it('goes to the sheet of a hit on another page and selects it', () => {
    const { h, tab, selected } = setUp();
    const symbols = tab('Symbols');
    symbols.search('');
    symbols.sort(0, true, []); // R1, R2, R10

    expect(h.frame.GetCurrentSheet().PathHumanReadable()).toBe('/');
    symbols.selectItems!([1]); // R2, on S2

    expect(h.frame.GetCurrentSheet().PathHumanReadable()).toBe('/S2/');
    const items = selected();
    expect(items.length).toBe(1);
    expect(items[0]!.Type()).toBe(KICAD_T.SCH_SYMBOL_T);
  });

  it('hits on different pages change nothing but the cleared selection', () => {
    const { h, tab, selected } = setUp();
    const symbols = tab('Symbols');
    symbols.search('');
    symbols.sort(0, true, []);

    symbols.selectItems!([1, 2]); // R2 on S2, R10 on S1

    expect(h.frame.GetCurrentSheet().PathHumanReadable()).toBe('/');
    expect(selected().length).toBe(0);
  });

  it('ActivateItem selects the row, then opens its properties', () => {
    const { tab, selected, shown } = setUp();
    const symbols = tab('Symbols');
    symbols.search('R1');
    symbols.sort(0, true, []); // R1, R10
    symbols.activateItem!(0);

    expect(selected().length).toBe(1);
    expect(shown.length).toBeGreaterThan(0);
  });
});
