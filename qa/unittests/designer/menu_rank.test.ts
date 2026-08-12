// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `CONDITIONAL_MENU`'s two assembly rules, which decide what a KiCad context
 * menu looks like far more than the order the code reads in.
 *
 * The cases below are the two real menus this was written against, taken from
 * KiCad screenshots: a right-click on empty canvas and one on a hierarchical
 * sheet. Both were wrong here in ways that survived review — entries in the
 * wrong order, and a separator where upstream has none — because the menu was
 * built by pushing items in source order rather than by rank.
 */
import { describe, it, expect } from 'vitest';
import { assembleMenu, type RankedItem } from '@ziroeda/designer/src/ui/menu_rank.js';
import type { MenuItem } from '@ziroeda/designer/src/ui/menu_types.js';

/** The separators the schematic canvas menu declares. */
const SEPS = [100, 101, 200, 300, 400, 401, 1000];

const at = (order: number, label: string): RankedItem => ({ order, item: { label } });

/** The menu as a reader sees it, with '---' for each separator. */
const render = (items: MenuItem[]): string[] => items.map((i) => (i.sep ? '---' : i.label!));

describe('assembling a ranked menu', () => {
  it('puts the ranks in order however they were added', () => {
    const out = assembleMenu([at(300, 'Paste'), at(100, 'Draw Wires'), at(150, 'Move')], SEPS);
    expect(render(out)).toEqual(['Draw Wires', '---', 'Move', '---', 'Paste']);
  });

  it('keeps insertion order within one rank', () => {
    // `addEntry` inserts after everything of the same rank, so this is the
    // order the *tools* registered in — a sort that was not stable would
    // scramble the sheet block.
    const out = assembleMenu([at(250, 'Place Junction'), at(250, 'Break'), at(250, 'Slice')], SEPS);
    expect(render(out)).toEqual(['Place Junction', 'Break', 'Slice']);
  });

  it('drops a separator with nothing in front of it', () => {
    // The leading separator: nothing precedes rank 100, so the menu must not
    // open with a line.
    const out = assembleMenu([at(100, 'Draw Wires')], SEPS);
    expect(render(out)).toEqual(['Draw Wires']);
  });

  it('drops a separator with nothing between it and the last', () => {
    // `if( menu_count ) AppendSeparator()`. Rank 200 and 250 are empty here, so
    // the 200 separator collapses into the 300 one instead of doubling up.
    const out = assembleMenu([at(150, 'Leave Sheet'), at(300, 'Paste')], SEPS);
    expect(render(out)).toEqual(['Leave Sheet', '---', 'Paste']);
  });

  it('never ends on a separator', () => {
    const out = assembleMenu([at(100, 'Draw Wires')], SEPS);
    expect(out[out.length - 1]!.sep).toBeUndefined();
  });

  it('builds the empty-canvas menu exactly', () => {
    // KiCad, right-click on empty canvas of a top-level sheet.
    const out = assembleMenu(
      [
        at(100, 'Draw Wires'),
        at(100, 'Draw Buses'),
        at(150, 'Leave Sheet'),
        at(300, 'Paste'),
        at(300, 'Paste Special...'),
        at(300, 'Duplicate'),
        at(401, 'Select All'),
        at(401, 'Unselect All'),
        at(1000, 'Zoom'),
        at(1000, 'Grid'),
      ],
      SEPS,
    );
    expect(render(out)).toEqual([
      'Draw Wires',
      'Draw Buses',
      '---',
      'Leave Sheet',
      '---',
      'Paste',
      'Paste Special...',
      'Duplicate',
      '---',
      'Select All',
      'Unselect All',
      '---',
      'Zoom',
      'Grid',
    ]);
  });

  it('builds the sheet menu exactly', () => {
    // KiCad, right-click on a hierarchical sheet. Note what is *not* here: no
    // line between Grouping and Enter Sheet, because the two rank-100
    // separators both collapse once Draw Wires/Buses drop out.
    const out = assembleMenu(
      [
        at(101, 'Grouping'),
        at(150, 'Enter Sheet'),
        at(150, 'Leave Sheet'),
        at(150, 'Move'),
        at(150, 'Drag'),
        at(150, 'Align Items to Grid'),
        at(200, 'Transform Selection'),
        at(200, 'Attributes'),
        at(200, 'Properties...'),
        at(200, 'Autoplace Fields'),
        at(250.2, 'Place Pins from Sheet'),
        at(250.2, 'Autoplace All Sheet Pins'),
        at(250.2, 'Sync Selected Sheet Pins...'),
        at(250.4, 'Edit Sheet Page Number...'),
        at(300, 'Cut'),
        at(300, 'Copy'),
        at(300, 'Paste'),
        at(300, 'Paste Special...'),
        at(300, 'Delete'),
        at(300, 'Duplicate'),
        at(401, 'Select All'),
        at(401, 'Unselect All'),
        at(1000, 'Zoom'),
        at(1000, 'Grid'),
      ],
      SEPS,
    );
    expect(render(out)).toEqual([
      'Grouping',
      'Enter Sheet',
      'Leave Sheet',
      'Move',
      'Drag',
      'Align Items to Grid',
      '---',
      'Transform Selection',
      'Attributes',
      'Properties...',
      'Autoplace Fields',
      'Place Pins from Sheet',
      'Autoplace All Sheet Pins',
      'Sync Selected Sheet Pins...',
      'Edit Sheet Page Number...',
      '---',
      'Cut',
      'Copy',
      'Paste',
      'Paste Special...',
      'Delete',
      'Duplicate',
      '---',
      'Select All',
      'Unselect All',
      '---',
      'Zoom',
      'Grid',
    ]);
  });
});
