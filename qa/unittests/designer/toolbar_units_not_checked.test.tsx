// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Units button is not drawn checked, in every editor that has one.
 *
 * This is the rendered half. `toolbar_group_check.test.ts` pins the data and
 * the rule; neither can see what the widget paints, and that is where this bug
 * lived both times it was fixed. A group button lights from `toggled`
 * membership, `toggled` carries the CURRENT unit, and the frame is *required*
 * to put the current unit in it — that is upstream's `SelectToolbarAction`
 * (`common/eda_draw_frame.cpp:354-356`), which is how the button knows which of
 * the three icons to show. So the id being lit and the id being shown are the
 * same id, and only the renderer's own gate separates them.
 *
 * Upstream's gate is the wxWidgets item kind:
 *
 *     bool isToggleEntry = false;
 *     for( const auto& act : aGroup->GetActions() )
 *         isToggleEntry |= act->CheckToolbarState( TOOLBAR_STATE::TOGGLE );
 *     AddTool( groupId, ..., isToggleEntry ? wxITEM_CHECK : wxITEM_NORMAL, ... );
 *         — `ACTION_TOOLBAR::AddGroup`, common/tool/action_toolbar.cpp:527-545
 *
 * A wxITEM_NORMAL has no checked state to paint. `inchesUnits`, `milsUnits` and
 * `millimetersUnits` declare no `.ToolbarState(...)` at all
 * (`common/tool/actions.cpp:1109-1131`), so the Units button is one, in all
 * eight editors that build the group — they share the three action objects.
 *
 * Measured against the real thing: in a capture of KiCad 10.0.5's schematic
 * editor the left toolbar's button bands sample as grid rgb(93,33,12) and grid
 * axes rgb(93,33,12) — the active-toggle tint — against units rgb(55,55,55) and
 * cursor rgb(55,55,55), the plain toolbar face. A unit is obviously active and
 * the button is still not checked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Toolbar } from '@ziroeda/designer/src/ui/Toolbar.js';
import { LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';
import { SYM_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import { DS_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { PCB_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import { FP_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import { GBR_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import type { ToolEntry } from '@ziroeda/designer/src/ui/toolbar_types.js';

// `qa` has no testing-library setup file, so the auto-cleanup that ships with
// one is not running: without this every render stays in the document.
afterEach(cleanup);

/**
 * The six editors of ours that build `TOOLBAR_GROUP_CONFIG( _( "Units" ) )`,
 * with the unit each frame opens in.
 *
 * Upstream has eight — the schematic and symbol editors, pl_editor, the board,
 * footprint and footprint-viewer frames, GerbView and cvpcb's display-footprints
 * frame. The last two of those are not implemented here. The bug was one editor
 * disagreeing with the rest, so every one of ours is rendered separately: a
 * sweep that scanned the tree once, or that only knew the editors an earlier
 * instance of this bug was found in, reported green while eeschema sat lit.
 */
const EDITORS: { name: string; app: string; entries: ToolEntry[]; unit: string }[] = [
  // eeschema is on the imperial side of APP_SETTINGS_BASE's branch, so it opens
  // in mils — the button in the bug report reads "mil".
  { name: 'schematic', app: 'eeschema', entries: LEFT_TOOLBAR, unit: 'unitsMils' },
  { name: 'symbol editor', app: 'symbol_editor', entries: SYM_LEFT_TOOLBAR, unit: 'unitsMils' },
  { name: 'drawing sheet', app: 'pl_editor', entries: DS_LEFT_TOOLBAR, unit: 'unitsMm' },
  { name: 'pcb', app: 'pcbnew', entries: PCB_LEFT_TOOLBAR, unit: 'unitsMm' },
  { name: 'footprint editor', app: 'fp_editor', entries: FP_LEFT_TOOLBAR, unit: 'unitsMm' },
  { name: 'gerbview', app: 'gerbview', entries: GBR_LEFT_TOOLBAR, unit: 'unitsMm' },
];

/**
 * Every button the bar rendered, by the `toggled` id it would light from.
 *
 * A group button carries the id of the action it is DISPLAYING, which for the
 * units group is the current unit — so this finds the units button by the very
 * id that used to light it.
 */
const buttons = (): HTMLElement[] => Array.from(screen.getAllByRole('button'));

const checked = (el: HTMLElement): boolean =>
  el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true';

describe('the units toolbar button, rendered', () => {
  for (const { name, app, entries, unit } of EDITORS) {
    /** The frame's live toggle state: the current unit, and the grid on. */
    const toggled = new Set([unit, 'toggleGrid', 'toggleGridOverrides']);

    const renderBar = (): HTMLElement[] => {
      render(
        <Toolbar
          entries={entries}
          app={app}
          orientation="vertical"
          side="left"
          toggled={toggled}
          onActivate={() => {}}
        />,
      );
      return buttons();
    };

    it(`${name}: draws the units button flat even though ${unit} is active`, () => {
      const all = renderBar();
      // The group renders exactly one button, showing the active unit. Find it
      // by its icon, which `doSelectAction` sets from the displayed action.
      const unitsBtn = all.find((b) => b.querySelector(`img[src*="${unit}"], img[alt*="${unit}"]`));
      const byIcon = unitsBtn ?? all.find((b) => b.className.includes('ze-tbtn-group'));
      expect(byIcon, `${name} rendered no group button`).toBeDefined();
      expect(
        checked(byIcon as HTMLElement),
        'wxITEM_NORMAL has no checked state; the unit picks the icon, not the check',
      ).toBe(false);
    });

    it(`${name}: and no group button on the bar is checked, since all three cycle`, () => {
      // Units, crosshair modes and line modes are the only groups on a left
      // toolbar, and none of their actions declares TOOLBAR_STATE::TOGGLE.
      const rendered = renderBar();
      const groupButtons = rendered.filter((b) => b.className.includes('ze-tbtn-group'));
      // Otherwise an empty list below would mean "the class name changed" just
      // as happily as "nothing is lit".
      expect(
        groupButtons.length,
        'the bar rendered no group buttons at all, so the check below scans nothing',
      ).toBe(entries.filter((e) => typeof e === 'object' && 'group' in e).length);
      const lit = groupButtons
        .filter(checked)
        .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? '?');
      expect(lit).toStrictEqual([]);
    });

    it(`${name}: while the grid toggle on the same bar IS lit`, () => {
      // The contrast, and the proof this is not "nothing on this bar can light".
      // `ACTIONS::toggleGrid` declares TOOLBAR_STATE::TOGGLE (actions.cpp:1083)
      // and is a plain button, not a group.
      const grid = renderBar().find(
        (b) =>
          !b.className.includes('ze-tbtn-group') &&
          /grid/i.test(b.getAttribute('aria-label') ?? b.getAttribute('title') ?? ''),
      );
      expect(grid, `${name} rendered no grid button`).toBeDefined();
      expect(checked(grid as HTMLElement)).toBe(true);
    });
  }
});
