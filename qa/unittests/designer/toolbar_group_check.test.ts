// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Units toolbar group is never a check item — in EVERY editor that builds it.
 *
 * `ACTION_TOOLBAR::AddGroup` (`common/tool/action_toolbar.cpp:527-545`) makes
 * the group's button a check item only when one of its actions is a toggle:
 *
 *     bool isToggleEntry = false;
 *     for( const auto& act : aGroup->GetActions() )
 *         isToggleEntry |= act->CheckToolbarState( TOOLBAR_STATE::TOGGLE );
 *     AddTool( groupId, ..., isToggleEntry ? wxITEM_CHECK : wxITEM_NORMAL, ... );
 *
 * `millimetersUnits`, `inchesUnits` and `milsUnits` declare `.Flags( AF_NONE )`
 * and **no `ToolbarState` at all** (`actions.cpp:1109-1131`), so the item is
 * wxITEM_NORMAL and *cannot* paint checked — it cycles and highlights only under
 * the pointer. The same is true of the crosshair modes (`:1182-1201`) and the
 * line modes (`sch_actions.cpp:1341-1367`, `pcb_actions.cpp:1501-1527`).
 * `ACTIONS::toggleGrid`, one entry above Units on the same toolbar, DOES declare
 * `TOOLBAR_STATE::TOGGLE` (`actions.cpp:1083`) and does stay lit — a capture of
 * a live KiCad 10.0.5 schematic editor shows exactly that pair, grid and grid
 * overrides lit, units and cursor flat.
 *
 * **Why this is per editor and not one sweep.** Eight editors build the same
 * `TOOLBAR_GROUP_CONFIG( _( "Units" ) )` out of the same three `ACTIONS::`
 * objects — `eeschema/toolbars_sch_editor.cpp:81-84`,
 * `eeschema/symbol_editor/toolbars_symbol_editor.cpp`,
 * `pagelayout_editor/toolbars_pl_editor.cpp:57-60`,
 * `pcbnew/toolbars_pcb_editor.cpp`, `pcbnew/toolbars_footprint_editor.cpp`,
 * `pcbnew/toolbars_footprint_viewer.cpp`, `gerbview/toolbars_gerber.cpp`,
 * `cvpcb/toolbars_display_footprints.cpp`. The bug was ONE of ours disagreeing
 * with the other seven, so a check that scanned the tree in one pass, or that
 * only knew about the editors a previous bug was found in, would have reported
 * green while the schematic editor sat lit.
 */
import { describe, expect, it } from 'vitest';
import {
  LEFT_TOOLBAR,
  RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import { DS_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import {
  PCB_LEFT_TOOLBAR,
  PCB_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import { GBR_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import {
  SYM_LEFT_TOOLBAR,
  SYM_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import {
  FP_LEFT_TOOLBAR,
  FP_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import {
  actionIsToolbarToggle,
  GROUP_ACTION_TOOLBAR_TOGGLE,
} from '@ziroeda/designer/src/ui/toolbar_action_state.js';
import {
  groupIsCheckItem,
  type ToolButton,
  type ToolEntry,
  type ToolGroup,
} from '@ziroeda/designer/src/ui/toolbar_types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOOLBAR_TSX = readFileSync(
  fileURLToPath(new URL('../../../designer/src/ui/Toolbar.tsx', import.meta.url)),
  'utf8',
);

const groups = (entries: readonly ToolEntry[]): ToolGroup[] =>
  entries.filter((e): e is ToolGroup => typeof e === 'object' && 'group' in e);

const button = (entries: readonly ToolEntry[], id: string): ToolButton | undefined =>
  entries.find((e): e is ToolButton => typeof e === 'object' && 'id' in e && e.id === id);

/**
 * Every editor of ours that builds the Units group, with the bars it appears on.
 *
 * `left` is the bar carrying Units; `bars` is everything the editor declares,
 * because the table-coverage and no-local-flag rules are about ALL groups, not
 * just this one.
 */
const EDITORS: { name: string; left: readonly ToolEntry[]; bars: readonly ToolEntry[][] }[] = [
  { name: 'schematic', left: LEFT_TOOLBAR, bars: [LEFT_TOOLBAR, RIGHT_TOOLBAR] },
  { name: 'symbol editor', left: SYM_LEFT_TOOLBAR, bars: [SYM_LEFT_TOOLBAR, SYM_RIGHT_TOOLBAR] },
  { name: 'drawing sheet', left: DS_LEFT_TOOLBAR, bars: [DS_LEFT_TOOLBAR] },
  { name: 'pcb', left: PCB_LEFT_TOOLBAR, bars: [PCB_LEFT_TOOLBAR, PCB_RIGHT_TOOLBAR] },
  { name: 'footprint editor', left: FP_LEFT_TOOLBAR, bars: [FP_LEFT_TOOLBAR, FP_RIGHT_TOOLBAR] },
  { name: 'gerbview', left: GBR_LEFT_TOOLBAR, bars: [GBR_LEFT_TOOLBAR] },
];

describe('the Units toolbar group is not a check item, per editor', () => {
  it('every editor that has a units toggle is in the list', () => {
    // The list is the thing that can rot: an editor added later, or one whose
    // Units group moved bar, must not just drop out of the sweep. Six of
    // upstream's eight are implemented here (the footprint viewer and cvpcb's
    // display-footprints frame are not), so this is the count to hold.
    expect(EDITORS).toHaveLength(6);
    for (const { name, left } of EDITORS) {
      const units = groups(left).find((g) => g.group === 'Units');
      expect(units, `${name} has no Units group to check`).toBeDefined();
      expect(units?.actions.map((a) => a.id).sort()).toStrictEqual([
        'unitsInches',
        'unitsMils',
        'unitsMm',
      ]);
    }
  });

  for (const { name, left } of EDITORS) {
    it(`${name}: the Units button cannot paint checked`, () => {
      const units = groups(left).find((g) => g.group === 'Units') as ToolGroup;
      expect(
        groupIsCheckItem(units),
        'isToggleEntry is false for these three actions, so the item is wxITEM_NORMAL',
      ).toBe(false);
    });

    it(`${name}: the grid toggle beside it DOES stay lit, which is the contrast`, () => {
      // Same toolbar, one entry apart, opposite answer — so this is not
      // "nothing on a left toolbar can be checked".
      const grid = button(left, 'toggleGrid');
      expect(grid, `${name} lost its grid toggle`).toBeDefined();
      expect(actionIsToolbarToggle('toggleGrid')).toBe(true);
    });
  }

  /**
   * The per-editor flag that caused the bug: eeschema's inventory marked all
   * three unit actions `toggle: true` while the other five wrote the same three
   * actions without it. The flag is a property of the ACTION upstream, so no
   * editor's toolbar file may carry it on a group member at all.
   */
  for (const { name, bars } of EDITORS) {
    it(`${name}: no group member restates the action's toolbar state locally`, () => {
      const offenders = bars.flatMap((bar) =>
        groups(bar).flatMap((g) =>
          g.actions.filter((a) => a.toggle).map((a) => `${g.group}/${a.id}`),
        ),
      );
      expect(
        offenders,
        'toolbar_action_state.ts is where TOOLBAR_STATE::TOGGLE lives; a local copy can disagree with it',
      ).toStrictEqual([]);
    });

    it(`${name}: every group member is transcribed in the shared table`, () => {
      // An unlisted id silently answers `false`, which is upstream's default
      // but would also quietly un-light a real tool group.
      const missing = bars.flatMap((bar) =>
        groups(bar).flatMap((g) =>
          g.actions.filter((a) => !(a.id in GROUP_ACTION_TOOLBAR_TOGGLE)).map((a) => a.id),
        ),
      );
      expect(missing).toStrictEqual([]);
    });
  }

  /**
   * The other half of upstream's OR, and the reason the rule is not simply
   * "a group is never checked". Gating these off would be its own regression.
   */
  const TOOL_GROUPS: [string, readonly ToolEntry[], string][] = [
    ['schematic', RIGHT_TOOLBAR, 'Selection modes'],
    ['schematic', RIGHT_TOOLBAR, 'Labels'],
    ['pcb', PCB_RIGHT_TOOLBAR, 'Selection modes'],
    ['pcb', PCB_RIGHT_TOOLBAR, 'Track routing tools'],
    ['pcb', PCB_RIGHT_TOOLBAR, 'PCB origins and points'],
    ['footprint editor', FP_RIGHT_TOOLBAR, 'Dimension objects'],
  ];

  for (const [editor, bar, name] of TOOL_GROUPS) {
    it(`${editor}: "${name}" IS a check item, because its actions declare TOGGLE`, () => {
      const g = groups(bar).find((x) => x.group === name);
      expect(g, `${editor} has no "${name}" group`).toBeDefined();
      expect(groupIsCheckItem(g as ToolGroup)).toBe(true);
    });
  }

  /**
   * The half the data alone cannot pin, and the reason this fix had to be made
   * three times.
   *
   * A group button lights from `toggled` membership, and `toggled` carries the
   * CURRENT unit whatever the action's flags say. So removing `toggle: true`
   * from the three unit actions did NOT stop the highlight on its own — and a
   * mutation sweep against the data-only cases above reported the renderer's
   * guard as dead when it was the only thing doing the work. A survivor from a
   * test that cannot observe the behaviour is not evidence the code is
   * redundant.
   */
  describe('and the rule itself', () => {
    const units: ToolGroup = {
      group: 'Units',
      cycleOnClick: true,
      actions: [
        { id: 'unitsMm', icon: 'unitsMm', title: 'mm' },
        { id: 'unitsMils', icon: 'unitsMils', title: 'mils' },
      ],
    };

    it('reads the action table, not the editor-local flag', () => {
      // The exact shape of the bug: one editor asserting a toggle the action
      // does not declare. Upstream's OR runs over the ACTIONS, so this must
      // still be false.
      expect(
        groupIsCheckItem({ ...units, actions: [{ ...units.actions[0]!, toggle: true }] }),
      ).toBe(false);
    });

    it('does not consult cycleOnClick either', () => {
      // `cycleOnClick` is upstream's OTHER test (onToolEvent: "none of the
      // actions is an activation"), which decides click behaviour. That it
      // correlated with the check-item answer is a fact about KiCad's action
      // table, not the rule.
      const { cycleOnClick: _drop, ...notCycling } = units;
      expect(groupIsCheckItem(notCycling as ToolGroup)).toBe(false);
    });

    it('is an OR, so a mixed group is still a check item', () => {
      // "PCB origins and points": gridSetOrigin declares TOGGLE, drillOrigin
      // does not, and upstream's `|=` makes the button wxITEM_CHECK.
      expect(actionIsToolbarToggle('gridSetOrigin')).toBe(true);
      expect(actionIsToolbarToggle('drillOrigin')).toBe(false);
      expect(
        groupIsCheckItem({
          group: 'PCB origins and points',
          actions: [
            { id: 'gridSetOrigin', icon: 'gridSetOrigin' },
            { id: 'drillOrigin', icon: 'drillOrigin' },
          ],
        }),
      ).toBe(true);
    });

    it('and Toolbar actually consults it', () => {
      // Without this the cases above pass while the renderer ignores them —
      // the exact shape that let the highlight come back.
      expect(TOOLBAR_TSX).toMatch(/groupIsCheckItem\(/);
      expect(TOOLBAR_TSX).toMatch(/groupChecks\s*&&/);
    });
  });
});
