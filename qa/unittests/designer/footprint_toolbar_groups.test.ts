// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The footprint editor's toolbars have groups.
 *
 * `AppendGroup( TOOLBAR_GROUP_CONFIG( ... ) )` renders as ONE button showing
 * the selected action with a triangle in its corner; the palette opens on a
 * 500 ms press or a drag off it. `footprintToolbars.ts` had **no `group:` at
 * all**, so all five of upstream's groups were flattened — sixteen buttons
 * standing where KiCad draws five.
 *
 * Two audits found this independently tonight, from opposite ends: the PCB
 * frame audit reading `footprintToolbars.ts`, and the Symbol Editor pass
 * finding the same flattening there. The PCB editor's own bar was already
 * right, which is what made it invisible — one launcher correct is exactly how
 * a per-launcher defect hides.
 */
import { describe, expect, it } from 'vitest';
import {
  FP_LEFT_TOOLBAR,
  FP_RIGHT_TOOLBAR,
} from '@ziroeda/designer/src/editors/footprint/footprintToolbars.js';
import {
  groupIsCheckItem,
  type ToolEntry,
  type ToolGroup,
} from '@ziroeda/designer/src/ui/toolbar_types.js';

const groups = (entries: readonly ToolEntry[]): ToolGroup[] =>
  entries.filter((e): e is ToolGroup => typeof e === 'object' && 'group' in e);

const byName = (entries: readonly ToolEntry[], name: string): ToolGroup | undefined =>
  groups(entries).find((g) => g.group === name);

describe('the five groups upstream declares', () => {
  it('found the toolbars, so this cannot pass by scanning nothing', () => {
    expect(FP_LEFT_TOOLBAR.length).toBeGreaterThan(8);
    expect(FP_RIGHT_TOOLBAR.length).toBeGreaterThan(8);
  });

  /**
   * Named individually rather than counted. A count passes with one group
   * flattened and another invented, and the point here is that these exact five
   * exist — `toolbars_footprint_editor.cpp:65-76, 79-83, 94-96, 124-129`.
   */
  const EXPECTED: [string, readonly ToolEntry[], string[]][] = [
    ['Units', FP_LEFT_TOOLBAR, ['unitsMm', 'unitsInches', 'unitsMils']],
    ['Crosshair modes', FP_LEFT_TOOLBAR, ['crosshairSmall', 'crosshairFull', 'crosshair45']],
    ['Line modes', FP_LEFT_TOOLBAR, ['lineModeFree', 'lineMode90', 'lineMode45']],
    ['Selection modes', FP_RIGHT_TOOLBAR, ['selectSetRect', 'selectSetLasso']],
    [
      'Dimension objects',
      FP_RIGHT_TOOLBAR,
      [
        'drawOrthogonalDimension',
        'drawAlignedDimension',
        'drawCenterDimension',
        'drawRadialDimension',
        'drawLeader',
      ],
    ],
  ];

  for (const [name, bar, members] of EXPECTED) {
    it(`"${name}" is one group, in upstream's order`, () => {
      const g = byName(bar, name);
      expect(g, `${name} is flattened or missing`).toBeDefined();
      expect(g?.actions.map((a) => a.id)).toStrictEqual(members);
    });
  }

  it('and none of those members is left loose beside its group', () => {
    // The failure mode a "group exists" check misses: the group added and the
    // flat buttons never removed, so the bar grows instead of shrinking.
    const loose = [...FP_LEFT_TOOLBAR, ...FP_RIGHT_TOOLBAR]
      .filter((e): e is Extract<ToolEntry, { id: string }> => typeof e === 'object' && 'id' in e)
      .map((e) => e.id);
    const grouped = EXPECTED.flatMap(([, , m]) => m);
    expect(loose.filter((id) => grouped.includes(id))).toStrictEqual([]);
  });
});

describe('which groups can paint checked, and which only cycle', () => {
  /**
   * `AddGroup`'s `isToggleEntry` is an OR over the actions'
   * `CheckToolbarState( TOOLBAR_STATE::TOGGLE )`. Units, crosshairs and line
   * modes declare `.Flags( AF_NONE )` and no ToolbarState at all, so the item
   * is wxITEM_NORMAL and CANNOT paint checked — it cycles and lights only under
   * the pointer. Selection modes and Dimension objects are activations and do
   * declare TOGGLE, so those buttons stay lit.
   *
   * Both halves are asserted, because "nothing is checkable" and "everything
   * is" would each pass a one-sided test.
   */
  for (const name of ['Units', 'Crosshair modes', 'Line modes']) {
    it(`"${name}" cycles and never stays lit`, () => {
      const g = byName(FP_LEFT_TOOLBAR, name);
      expect(g?.cycleOnClick).toBe(true);
      expect(g?.actions.some((a) => a.toggle)).toBe(false);
      expect(groupIsCheckItem(g as ToolGroup)).toBe(false);
    });
  }

  for (const name of ['Selection modes', 'Dimension objects']) {
    it(`"${name}" is a tool group, so its button does stay lit`, () => {
      const g = byName(FP_RIGHT_TOOLBAR, name);
      expect(g?.cycleOnClick).toBeUndefined();
      expect(groupIsCheckItem(g as ToolGroup)).toBe(true);
    });
  }
});
