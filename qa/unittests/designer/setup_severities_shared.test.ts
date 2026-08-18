// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * One Violation Severity panel, the way KiCad has one.
 *
 * `PANEL_SETUP_SEVERITIES` lives in `common/dialogs/panel_setup_severities.cpp`
 * and both Setup dialogs instantiate it with a different rule table —
 * `ERC_ITEM::GetItemsWithSeverities()` (dialog_schematic_setup.cpp:98) and
 * `DRC_ITEM::GetItemsWithSeverities()` (dialog_board_setup.cpp:243). We had two
 * copies, and the same page really did look different in the two dialogs: flex
 * rows, grey non-bold headings under a rule, no indent and no title on the
 * schematic side; a CSS grid, bold headings, a 12 px indent and a "Violation
 * Severity" title on the board side.
 *
 * Neither was right. The C++ is a two-column `wxFlexGridSizer` (:58) with bold
 * headings (:75), a 15 px indent (:87), a trailing colon (:86) and no title of
 * its own — "Violation Severity" is the treebook page label
 * (dialog_schematic_setup.cpp:100, dialog_board_setup.cpp:246).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERC_ITEMS } from '@ziroeda/eeschema';
import { DRC_CATEGORIES } from '@ziroeda/designer/src/editors/pcb/board_settings.js';
import {
  groupSeverityItems,
  type SeverityGroup,
} from '@ziroeda/designer/src/dialogs/panels/severity_items.js';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SHARED = read('../../../designer/src/dialogs/panels/panel_setup_severities.tsx');
const SCH = read(
  '../../../designer/src/editors/schematic/dialogs/panels/panel_setup_severities.tsx',
);
const PCB = read('../../../designer/src/editors/pcb/dialogs/panels/panel_pcb_severities.tsx');

describe('the two Setup dialogs share one severities panel', () => {
  it('is instantiated, not reimplemented, by each editor', () => {
    for (const [name, src] of [
      ['schematic', SCH],
      ['pcb', PCB],
    ] as const) {
      expect(src, name).toContain('dialogs/panels/panel_setup_severities.js');
      // Neither copy may grow its own radio buttons again.
      expect(src, name).not.toContain('type="radio"');
      expect(src, name).not.toContain("label: 'Warning'");
    }
  });

  it('is short, because all it does is pass the rule table', () => {
    // The two copies were 81 and 83 lines of duplicated layout.
    for (const [name, src] of [
      ['schematic', SCH],
      ['pcb', PCB],
    ] as const) {
      const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l) && l.trim());
      expect(code.length, name).toBeLessThan(45);
    }
  });

  it('hands each editor its own rule table', () => {
    // The whole point of the collapse: the panel is generic, the table is not.
    expect(SCH).toMatch(/groups=\{groups\}/);
    expect(SCH).toContain('ercSeverityGroups');
    expect(SCH).toContain('ERC_ITEMS');
    expect(SCH).not.toContain('DRC_CATEGORIES');
    expect(PCB).toMatch(/groups=\{DRC_CATEGORIES\}/);
    expect(PCB).not.toContain('ERC_ITEMS');
  });

  it('passes a different name prefix from each, so the radio groups cannot merge', () => {
    // Upstream gets distinct IDs from `baseID + errorCode * 10 + i` (:97).
    expect(SCH).toContain('namePrefix="erc"');
    expect(PCB).toContain('namePrefix="drc"');
  });
});

describe('the layout is the one in the C++', () => {
  it('is a two-column grid — wxFlexGridSizer( 0, 2, 0, 5 ), :58', () => {
    expect(SHARED).toContain("display: 'grid'");
    expect(SHARED).toMatch(/gridTemplateColumns: '[^']*max-content'/);
  });

  it('gaps the grid by 5, as SetVGap( 5 ) and the sizer hgap do (:58-60)', () => {
    expect(SHARED).toContain('rowGap: 5');
    expect(SHARED).toContain('columnGap: 5');
  });

  it('makes the headings bold — heading->SetFont( headingFont.Bold() ), :75', () => {
    expect(SHARED).toContain('fontWeight: 700');
    // Not the schematic copy's grey rule: there is no border in the C++ panel.
    expect(SHARED).not.toContain('borderBottom');
    expect(SHARED).not.toContain('#8a8c90');
  });

  it('indents each rule label 15 px — wxLEFT, 15, :87', () => {
    expect(SHARED).toContain('paddingLeft: 15');
  });

  it('ends each rule label in a colon — msg + wxT( ":" ), :86', () => {
    expect(SHARED).toContain('{it.title}:');
  });

  it('spaces the radio buttons 30 px apart — wxRIGHT, 30, :104', () => {
    expect(SHARED).toContain('marginRight: 30');
  });

  it('carries no title: "Violation Severity" is the treebook page label', () => {
    // dialog_schematic_setup.cpp:100 / dialog_board_setup.cpp:246 pass it to
    // AddLazySubPage; PagedDialog already draws it in the tree.
    for (const [name, src] of [
      ['shared', SHARED],
      ['schematic', SCH],
      ['pcb', PCB],
    ] as const) {
      expect(src.replace(/\/\*[\s\S]*?\*\//g, ''), name).not.toContain('>Violation Severity<');
    }
    expect(SHARED).not.toContain('Electrical Rules');
  });

  it('scrolls vertically — wxVSCROLL + SetScrollRate( 0, 5 ), :48-52', () => {
    expect(SHARED).toContain("overflowY: 'auto'");
  });

  it('invents no severity for a rule the map does not carry', () => {
    // std::map::operator[] gives RPT_SEVERITY_UNDEFINED and the switch at
    // :224-232 falls through `default: break`, leaving the group unset. The
    // board copy used to substitute Error.
    expect(SHARED).not.toContain("?? 'error'");
    expect(SHARED).toContain('severities[it.code] === lv.id');
  });
});

describe('the rule tables each dialog passes', () => {
  const flat = (gs: readonly SeverityGroup[]): string[] =>
    gs.flatMap((g) => g.items.map((i) => i.code));

  it('keep every ERC rule, in ERC_ITEM order', () => {
    expect(flat(groupSeverityItems(ERC_ITEMS))).toEqual(ERC_ITEMS.map((i) => i.code));
  });

  it('group the ERC rules under their headings, without repeating one', () => {
    const headings = groupSeverityItems(ERC_ITEMS).map((g) => g.heading);
    expect(headings).toEqual([...new Set(headings)]);
    expect(headings).toEqual(['Connections', 'Conflicts', 'Miscellaneous']);
  });

  it('keep every DRC rule', () => {
    expect(flat(DRC_CATEGORIES).length).toBe(
      DRC_CATEGORIES.reduce((n, c) => n + c.items.length, 0),
    );
    expect(DRC_CATEGORIES[0]?.heading).toBe('Electrical');
  });
});
