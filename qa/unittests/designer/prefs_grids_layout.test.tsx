// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Preferences > … > Grids — `PANEL_GRID_SETTINGS`
 * (`common/dialogs/panel_grid_settings_base.cpp`), the page every editor shows.
 *
 * Its SHAPE was wrong in four ways, and its behaviour in one:
 *
 *   * `bSizerColumns` (`:20-62`) is horizontal — the grid list and its buttons
 *     on the left, Fast Grid Switching and Grid Overrides on the right. Ours
 *     stacked all three groups into one column.
 *   * the five list buttons are `STD_BITMAP_BUTTON`s carrying `small_plus`,
 *     `edit`, `small_up`, `small_down` and `small_trash`
 *     (`panel_grid_settings.cpp:100-104`). Ours drew `+ ✎ ▲ ▼ −` as text on
 *     standard-width buttons.
 *   * `fgSizer3` has THREE columns (`:75`): the label, the choice, and
 *     `m_grid1HotKey`, which the panel fills with the action's own binding
 *     (`:94-98`). Ours had no third column.
 *   * an override is a `wxChoice` over the grid list (`:127`, selected by index
 *     at `:239-243`). Ours was a free text field, on a page whose whole point is
 *     "pick one of these grids".
 *   * and ours carried an "Enable grid overrides" checkbox that
 *     PANEL_GRID_SETTINGS does not have at all — `overrides_enabled` is
 *     `ACTIONS::toggleGridOverrides`, on the View menu.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { schIUScale } from '@ziroeda/common';
import {
  PanelGridSettings,
  type GridSettingsSlice,
} from '@ziroeda/designer/src/dialogs/prefs/PanelGridSettings.js';
import type { GridEntry } from '@ziroeda/designer/src/ui/grid_settings.js';

afterEach(cleanup);

const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');

/** A rule body by exact selector, comments stripped. */
function rule(selector: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((s) => s.trim() === selector)) return m[2] ?? '';
  }
  return '';
}

const GRIDS: GridEntry[] = [
  { name: '', x: '2.54', y: '2.54' },
  { name: '', x: '1.27', y: '1.27' },
  { name: '', x: '0.635', y: '0.635' },
];

function Harness(): React.JSX.Element {
  const [grid, setGrid] = useState<GridSettingsSlice>({
    sizes: structuredClone(GRIDS),
    last_size_idx: 0,
    fast_grid_1: 1,
    fast_grid_2: 2,
    overrides_enabled: true,
    overrides: {
      connected: { enabled: true, size: '1.27' },
      wires: { enabled: false, size: '1.27' },
      text: { enabled: false, size: '0.635' },
      graphics: { enabled: false, size: '0.635' },
    },
  });
  return (
    <PanelGridSettings
      grid={grid}
      update={(fn) =>
        setGrid((prev) => {
          const next = structuredClone(prev);
          fn(next);
          return next;
        })
      }
      frameType="FRAME_SCH"
      units="mils"
      iuScale={schIUScale}
      idPrefix="sch"
    />
  );
}

describe('the page is the two columns its sizer makes', () => {
  it('splits the list from the switching and overrides', () => {
    render(<Harness />);
    const columns = document.querySelector('.ze-pref-columns');
    expect(columns, 'no column container').not.toBeNull();
    expect(columns?.children.length).toBe(2);
  });

  it("takes the gutter that sizer states, not another page's", () => {
    // [data] `Add( bSizerLeftCol, …, wxRIGHT|wxLEFT, 5 )`, `Add( 16, 0 )`, and
    // the right column's own wxLEFT 5.
    expect(rule('.ze-pref-columns.ze-gutter-26 > div:first-child')).toMatch(/margin-right:\s*26px/);
  });
});

describe('the list buttons are the bitmaps KiCad sets', () => {
  it.each([
    ['Add grid', 'small_plus'],
    ['Edit grid', 'edit'],
    ['Move grid up', 'small_up'],
    ['Move grid down', 'small_down'],
    ['Remove grid', 'small_trash'],
  ])('%s draws %s', (title, bitmap) => {
    render(<Harness />);
    const btn = screen.getByTitle(title);
    const img = btn.querySelector('img');
    expect(img, `${title} draws no bitmap`).not.toBeNull();
    expect(img?.getAttribute('src') ?? '').toContain(bitmap);
    // ...and it carries no text of its own.
    expect(btn.textContent).toBe('');
  });
});

describe('the list and its buttons are sized the way the sizer sizes them', () => {
  it('lets the list fill the column, as `Add( m_currentGridCtrl, 1, wxEXPAND )` does', () => {
    // Both columns are added with wxEXPAND inside a row that takes the page,
    // so the list grows and the buttons sit at the bottom. `.ze-pref-columns`
    // aligns to flex-start for the pages whose columns are stacks of groups.
    expect(rule('.ze-prefs-panel > .ze-pref-columns.ze-stretch')).toMatch(/align-items:\s*stretch/);
    expect(rule('.ze-gridlist-col > .ze-gridlist')).toMatch(/flex:\s*1/);
  });

  it('draws every button bitmap at one size', () => {
    // Our SVGs are KiCad's own files and their headers differ — `small_*` is
    // 16 x 16, `edit.svg` is 24 x 24 with a nominal width of 1920 — while
    // `KiBitmapBundle` renders them all into the same small button.
    expect(rule('.ze-gridbtn img')).toMatch(/width:\s*16px/);
    expect(rule('.ze-gridbtn img')).toMatch(/height:\s*16px/);
  });
});

describe('Fast Grid Switching shows the binding, as the third column does', () => {
  it('prints the hotkey beside each choice', () => {
    render(<Harness />);
    // `m_grid1HotKey->SetLabel( Format( "(%s)", KeyNameFromKeyCode( hk1 ) ) )`,
    // and ours reads the same registry the Hotkeys page lists.
    expect(document.body.textContent).toContain('(Alt+1)');
    expect(document.body.textContent).toContain('(Alt+2)');
  });
});

describe('an override picks a grid, and only a grid', () => {
  /** The "Grid Overrides" group's own element. */
  const overrides = (): Element => {
    const group = [...document.querySelectorAll('.ze-pref-group')].find((g) =>
      g.querySelector('.ze-pref-group-title')?.textContent?.includes('Grid Overrides'),
    );
    expect(group, 'no Grid Overrides group').toBeDefined();
    return group as Element;
  };

  it('is a choice over the list, not a text field', () => {
    render(<Harness />);
    const group = overrides();
    // Four rows, four combos — the shared Combo, which is a button and never a
    // native <select>.
    expect(group.querySelectorAll('.ze-combo')).toHaveLength(4);
    expect(group.querySelectorAll('input[type="text"]')).toHaveLength(0);
    expect(group.querySelectorAll('select')).toHaveLength(0);
    // ...and the grid list is not one either: a native listbox paints its own
    // highlight over `option:checked` as soon as it has focus.
    expect(document.querySelector('select.ze-gridlist')).toBeNull();
    expect(rule('.ze-gridlist-row.selected')).toContain('var(--chrome-active)');
  });

  it('offers exactly the grids in the list', () => {
    render(<Harness />);
    // The Combo renders its current option as its label; `1.27` is the second
    // grid, which eeschema's short form prints as 50 mils.
    expect(overrides().textContent).toContain('50 mils');
  });

  it('has no master enable, because the panel has none', () => {
    render(<Harness />);
    // `overrides_enabled` is ACTIONS::toggleGridOverrides, on the View menu.
    expect(screen.queryByLabelText('Enable grid overrides')).toBeNull();
    expect(document.body.textContent).not.toContain('Enable grid overrides');
  });
});
