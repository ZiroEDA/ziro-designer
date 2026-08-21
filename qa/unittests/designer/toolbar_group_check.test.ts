// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A cycling toolbar group never stays lit.
 *
 * `ACTION_TOOLBAR::AddGroup` (`common/tool/action_toolbar.cpp:527-535`) makes
 * the group's button a check item only when one of its actions is a toggle:
 *
 *     for( const auto& act : aGroup->GetActions() )
 *         isToggleEntry |= act->CheckToolbarState( TOOLBAR_STATE::TOGGLE );
 *     AddTool( ..., isToggleEntry ? wxITEM_CHECK : wxITEM_NORMAL, ... );
 *
 * The units group is the visible case. `millimetersUnits`, `inchesUnits` and
 * `milsUnits` declare `.Flags( AF_NONE )` and **no `ToolbarState` at all**
 * (`actions.cpp:1113-1131`), so the item is `wxITEM_NORMAL` and *cannot* paint
 * checked — it cycles mm → inches → mils and highlights only under the
 * pointer. The same is true of the crosshair modes (`:1182-1201`) and the line
 * modes (`pcb_actions.cpp:1501-1520`).
 *
 * `ACTIONS::toggleGrid`, directly above units in the same toolbar, DOES
 * declare `TOOLBAR_STATE::TOGGLE` (`actions.cpp:1083`) and does stay lit. A
 * capture of a live pl_editor shows exactly that pair: grid lit, units flat.
 * Ours had every unit action marked as a toggle, so the button sat permanently
 * highlighted in five editors.
 */
import { describe, expect, it } from 'vitest';
import { DS_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { PCB_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import { GBR_LEFT_TOOLBAR } from '@ziroeda/designer/src/editors/gerbview/gerberToolbars.js';
import type { ToolEntry, ToolGroup } from '@ziroeda/designer/src/ui/toolbar_types.js';

const groups = (entries: readonly ToolEntry[]): ToolGroup[] =>
  entries.filter((e): e is ToolGroup => typeof e === 'object' && 'group' in e);

/** Every cycling group in the tree, with the editor it came from. */
const CYCLING: [string, readonly ToolEntry[]][] = [
  ['drawing sheet', DS_LEFT_TOOLBAR],
  ['pcb', PCB_LEFT_TOOLBAR],
  ['gerbview', GBR_LEFT_TOOLBAR],
];

describe('a group that cycles cannot be checked', () => {
  it('found the groups, so this does not pass by scanning nothing', () => {
    const all = CYCLING.flatMap(([, entries]) => groups(entries)).filter((g) => g.cycleOnClick);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.map((g) => g.group)).toContain('Units');
  });

  for (const [editor, entries] of CYCLING) {
    it(`${editor}: no action in a cycling group declares a toggle`, () => {
      const offenders = groups(entries)
        .filter((g) => g.cycleOnClick)
        .flatMap((g) => g.actions.filter((a) => a.toggle).map((a) => `${g.group}/${a.id}`));
      expect(
        offenders,
        'these would make the group a wxITEM_CHECK and leave it permanently lit',
      ).toStrictEqual([]);
    });
  }

  it('leaves the grid toggle beside it lit, which is the contrast', () => {
    // Same toolbar, one entry apart, and the opposite answer — so this is not
    // "nothing in a left toolbar toggles".
    const grid = DS_LEFT_TOOLBAR.find(
      (e): e is Extract<ToolEntry, { id: string }> =>
        typeof e === 'object' && 'id' in e && e.id === 'toggleGrid',
    );
    expect(grid?.toggle).toBe(true);
  });
});
