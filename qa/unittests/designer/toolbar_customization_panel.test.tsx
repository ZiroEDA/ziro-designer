// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_TOOLBAR_CUSTOMIZATION` — the page itself.
 *
 * One component serves every editor that has this page upstream, so it is
 * driven here with more than one editor's `DefaultToolbarConfig`: a panel that
 * is right for pl_editor and wrong for the board is the shape of bug this
 * codebase produces most, and it cannot be seen by rendering one of them.
 *
 * What is asserted is the panel's *effect on the store*, not its markup. The
 * store is what the frame reads (`toolbar_customization_applies.test.tsx`), so
 * a panel that draws a perfect tree and writes nothing is the failure this
 * whole audit exists to catch, and only the store can tell the two apart.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type JSX } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PanelToolbarCustomization } from '@ziroeda/designer/src/dialogs/prefs/PanelToolbarCustomization.js';
import { resetToolbarsPanel } from '@ziroeda/designer/src/dialogs/prefs/toolbar_reset.js';
import {
  configFromEntries,
  storedToolbarConfig,
  TOOLBAR_SETTINGS_DEFAULTS,
  type ToolbarDefaults,
  type ToolbarSettings,
} from '@ziroeda/designer/src/ui/toolbar_config.js';
import {
  DS_DEFAULT_TOOLBARS,
  DS_LEFT_TOOLBAR,
  DS_TOP_TOOLBAR,
} from '@ziroeda/designer/src/editors/drawingsheet/drawingSheetToolbars.js';
import { SYM_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/symbol/symbolToolbars.js';
import { PCB_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/pcb/pcbToolbars.js';
import { SCH_DEFAULT_TOOLBARS } from '@ziroeda/designer/src/editors/schematic/toolbars_sch_editor.js';

afterEach(cleanup);

/** The dialog's working copy, over React state instead of `PrefsContext`. */
function Harness({
  app,
  defaults,
  seen,
}: {
  app: string;
  defaults: ToolbarDefaults;
  seen: { store: ToolbarSettings; custom: boolean };
}): JSX.Element {
  const [store, setStore] = useState<ToolbarSettings>(() =>
    structuredClone(TOOLBAR_SETTINGS_DEFAULTS),
  );
  const [custom, setCustom] = useState(true);
  seen.store = store;
  seen.custom = custom;
  return (
    <PanelToolbarCustomization
      app={app}
      defaults={defaults}
      custom={custom}
      setCustom={(v) => {
        setCustom(v);
      }}
      store={store}
      update={(fn) =>
        setStore((s) => {
          const n = structuredClone(s);
          fn(n);
          return n;
        })
      }
    />
  );
}

const mount = (
  app: string,
  defaults: ToolbarDefaults,
): { store: ToolbarSettings; custom: boolean } => {
  const seen = { store: structuredClone(TOOLBAR_SETTINGS_DEFAULTS), custom: true };
  render(<Harness app={app} defaults={defaults} seen={seen} />);
  return seen;
};

const isDisabled = (el: HTMLElement): boolean => el.hasAttribute('disabled');

/**
 * `m_tbChoice` is a wxChoice, which is our `Combo`: a BUTTON with a popup, never
 * a native <select>. Its options are all in the DOM as `.ze-combo-ghost` spans —
 * that is how the button reserves the width of its widest entry, the way
 * `wxChoice::GetBestSize` does — and its current value is `.ze-combo-shown`.
 */
const choice = (): HTMLElement => screen.getByLabelText('Toolbar');
const choiceOptions = (): string[] =>
  Array.from(choice().querySelectorAll('.ze-combo-ghost')).map((o) => o.textContent ?? '');
const choiceValue = (): string => choice().querySelector('.ze-combo-shown')?.textContent ?? '';
/** Pick an entry by its visible name, the way a user does. */
const pickToolbar = (label: string): void => {
  fireEvent.click(choice());
  // The popup commits on mouseDown, as a wxChoice's list does.
  fireEvent.mouseDown(screen.getByRole('option', { name: label }));
};

const tree = (): HTMLElement => screen.getByLabelText('Toolbar items');
const treeRows = (): string[] =>
  Array.from(tree().querySelectorAll('.ze-tbcust-row')).map((r) => r.textContent ?? '');
const actionRows = (): string[] =>
  Array.from(screen.getByLabelText('Actions').querySelectorAll('.ze-tbcust-row')).map(
    (r) => r.textContent ?? '',
  );

describe('the Toolbar: choice', () => {
  it('lists only the toolbars the app has, under s_toolbarNameMap’s names', () => {
    // pl_editor's `DefaultToolbarConfig` returns `std::nullopt` for TOP_AUX, so
    // there is no "Top auxiliary" row to pick.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect(choiceOptions()).toEqual(['Left', 'Right', 'Top main']);
  });

  it('lists all four for the board, which has a TOP_AUX', () => {
    mount('pcbnew', PCB_DEFAULT_TOOLBARS);
    expect(choiceOptions()).toEqual(['Left', 'Right', 'Top main', 'Top auxiliary']);
  });

  it('opens on the first toolbar the app has', () => {
    // `m_tbChoice->SetSelection( 0 ); m_currentToolbar = m_toolbarChoices[0];`
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect(choiceValue()).toBe('Left');
    expect(treeRows()).toEqual([
      // `ACTIONS::toggleGrid.FriendlyName()` is "Show Grid" — re-derived from
      // `actions.cpp:1079-1084`, not re-baselined. This read "Show grid", the
      // drawing sheet BUTTON's own title, because the id resolved through no
      // action table: `toggleGrid` is a `common.*` action that had been scoped
      // to eeschema.
      'Show Grid',
      'Units',
      'Units in millimetres',
      'Units in inches',
      'Units in mils',
    ]);
  });
});

describe('the tree shows GetToolbarConfig, not an empty page', () => {
  it('draws pl_editor’s LEFT default, group and members', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    // `populateToolbarTree` labels a TB_GROUP with its name and expands it
    // (`m_toolbarTree->ExpandAll()`), so the members show under it.
    expect(treeRows()).toContain('Units');
    expect(treeRows()).toContain('Units in inches');
  });

  it('draws a separator as "Separator" and a spacer as "Spacer: n"', () => {
    // `_( "Separator" )` and `wxString::Format( _( "Spacer: %i" ), item.m_Size )`.
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    pickToolbar('Top main');
    expect(treeRows()).toContain('Separator');
    expect(seen.store.toolbars).toEqual([]);
  });

  it('names a control by ACTION_TOOLBAR_CONTROL::GetUiName, not by its id', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    pickToolbar('Top main');
    // `toolbars_pl_editor.cpp:176-183`.
    expect(treeRows()).toContain('Origin selector');
    expect(treeRows()).toContain('Page selector');
    expect(treeRows()).not.toContain('originSelector');
  });
});

describe('the action list', () => {
  it('offers the app’s own buttons and its controls, sorted case-insensitively', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const rows = actionRows();
    expect(rows).toContain('Show Grid');
    expect(rows).toContain('Origin selector');
    expect([...rows].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))).toEqual(rows);
  });

  it('offers no other editor’s actions', () => {
    // `isActionSupported` (`:206-241`): pl_editor's page lists `plEditor.*` and
    // `common.*` and never `eeschema.*`. These three are on the schematic's
    // toolbars and on none of pl_editor's.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    for (const schOnly of ['Draw Buses', 'Assign Footprints...', 'Annotate Schematic...'])
      expect(actionRows(), schOnly).not.toContain(schOnly);

    cleanup();
    mount('eeschema', SCH_DEFAULT_TOOLBARS);
    for (const schOnly of ['Draw Buses', 'Assign Footprints...', 'Annotate Schematic...'])
      expect(actionRows(), schOnly).toContain(schOnly);
    // And the drawing sheet's own are not on the schematic's page either.
    expect(actionRows()).not.toContain('Place bitmaps');
  });

  it('filters on the label and the tooltip, upper-cased, as Contains does', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'mils' } });
    expect(actionRows()).toEqual(['Units in mils']);
    // Case-insensitive: `search_text.Contains( aFilter.Upper() )`.
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'MILS' } });
    expect(actionRows()).toEqual(['Units in mils']);
  });
});

describe('editing writes to the store', () => {
  it('does nothing until something is edited', () => {
    // The store is only written once a toolbar is actually changed, so an
    // untouched toolbar keeps following DefaultToolbarConfig.
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect(seen.store).toEqual({ toolbars: [] });
  });

  it('delete removes the selected item from that toolbar only', () => {
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(within(tree()).getByText('Show Grid'));
    fireEvent.click(screen.getByLabelText('Delete'));

    expect(storedToolbarConfig(seen.store, 'LEFT')).toEqual([
      configFromEntries(DS_LEFT_TOOLBAR)[1],
    ]);
    // The other toolbars are untouched, so they still follow their defaults.
    expect(storedToolbarConfig(seen.store, 'TOP_MAIN')).toBeUndefined();
    expect(treeRows()).not.toContain('Show Grid');
  });

  it('Insert Separator inserts after the selection', () => {
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(within(tree()).getByText('Show Grid'));
    fireEvent.click(screen.getByText('Insert Separator'));
    expect(storedToolbarConfig(seen.store, 'LEFT')?.[1]).toEqual({ type: 'SEPARATOR' });
  });

  it('the left-arrow button adds the selected action', () => {
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'mils' } });
    fireEvent.click(within(screen.getByLabelText('Actions')).getByText('Units in mils'));
    fireEvent.click(screen.getByLabelText('Add to toolbar'));

    const left = storedToolbarConfig(seen.store, 'LEFT');
    expect(left?.some((i) => i.type === 'TOOL' && i.name === 'unitsMils')).toBe(true);
  });

  it('adding a control takes it off every other toolbar', () => {
    // `removeControlFromOtherToolbars` (`:1052-1069`) — a control may appear on
    // one toolbar only.
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    // Touch TOP_MAIN first so it is stored and carries the two controls.
    pickToolbar('Top main');
    fireEvent.click(within(tree()).getAllByText('Separator')[0] as HTMLElement);
    fireEvent.click(screen.getByLabelText('Delete'));
    expect(
      storedToolbarConfig(seen.store, 'TOP_MAIN')?.some(
        (i) => i.type === 'CONTROL' && i.name === 'originSelector',
      ),
    ).toBe(true);

    pickToolbar('Left');
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'Origin' } });
    fireEvent.click(within(screen.getByLabelText('Actions')).getByText('Origin selector'));
    fireEvent.click(screen.getByLabelText('Add to toolbar'));

    expect(
      storedToolbarConfig(seen.store, 'LEFT')?.some(
        (i) => i.type === 'CONTROL' && i.name === 'originSelector',
      ),
    ).toBe(true);
    expect(
      storedToolbarConfig(seen.store, 'TOP_MAIN')?.some(
        (i) => i.type === 'CONTROL' && i.name === 'originSelector',
      ),
    ).toBe(false);
  });
});

describe('the controls the checkbox governs', () => {
  it('everything below "Customize toolbars" is disabled while it is off', () => {
    // `enableCustomControls` / `enableToolbarControls` (`:812-831`).
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(screen.getByLabelText('Customize toolbars'));
    expect(seen.custom).toBe(false);
    expect(isDisabled(choice())).toBe(true);
    expect(isDisabled(screen.getByLabelText('Filter actions'))).toBe(true);
    expect(isDisabled(screen.getByLabelText('Add to toolbar'))).toBe(true);
    expect(isDisabled(screen.getByText('Insert Separator'))).toBe(true);
  });

  it('leaves Move up and Move down dead, as upstream does', () => {
    // `m_btnToolMoveDown->Enable( false ); m_btnToolMoveUp->Enable( false );`
    // under `// TODO (ISM): Enable draging` (`:188-190`). Not a gap here:
    // making them work would be a divergence from the shipped build.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect(isDisabled(screen.getByLabelText('Move up'))).toBe(true);
    expect(isDisabled(screen.getByLabelText('Move down'))).toBe(true);
  });
});

describe('ResetPanel', () => {
  it('drops the customisation so every toolbar follows its default again', () => {
    const store: ToolbarSettings = { toolbars: [] };
    store.toolbars.push({ name: 'TOP_MAIN', contents: configFromEntries(DS_TOP_TOOLBAR) });
    store.toolbars.push({ name: 'LEFT', contents: [] });
    resetToolbarsPanel(store);
    expect(store).toEqual(TOOLBAR_SETTINGS_DEFAULTS);
  });
});

/**
 * The page's METRICS, which are the widgets' own. Every number below was read
 * off the controls `PANEL_TOOLBAR_CUSTOMIZATION` builds by asking wx for them
 * on this machine and this theme — `qa/probes/toolbar_customization_probe.cpp`
 * builds the same `UP_DOWN_TREE` and `wxListCtrl` with a 24 px image list and
 * prints `GetIndent()`, the row heights and the label rects.
 *
 * We had the icons at 16 in rows of ~25 against KiCad's 24 in rows of 26 and
 * 30, and no expander column at all, so a group was told apart from a leaf only
 * by its missing icon and nothing lined up with anything.
 */
const CSS = readFileSync(resolve(process.cwd(), '../designer/src/ui/shell.css'), 'utf8');
/** A rule body by exact selector, comments stripped. */
const rule = (selector: string): string => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (sel.split(',').some((x) => x.trim() === selector)) return m[2] ?? '';
  }
  return '';
};

describe('the two lists are the size the widgets are', () => {
  it('draws every icon at c_defSize, which is 24', () => {
    // `const int c_defSize = 24` (panel_toolbar_customization.cpp:583) — one
    // bundle vector, handed to both the tree and the list.
    expect(rule('.ze-tbcust-row img')).toMatch(/width:\s*24px/);
    expect(rule('.ze-tbcust-row img')).toMatch(/height:\s*24px/);
  });

  it('gives each list the row height its own control reports', () => {
    expect(rule('.ze-tbcust-tree .ze-tbcust-row')).toMatch(/height:\s*26px/);
    expect(rule('.ze-tbcust-list .ze-tbcust-row')).toMatch(/height:\s*30px/);
  });

  it('reserves the expander gutter on every tree row, and indents by GetIndent', () => {
    // Probed: a top-level label starts at 33 with no image, the expander is
    // 16 x 16, and one level in adds GetIndent() = 15.
    const gutter = rule('.ze-tbcust-tree .ze-tbcust-row > .twisty');
    expect(gutter).toMatch(/width:\s*16px/);
    expect(gutter).toMatch(/margin-right:\s*17px/);
    expect(rule('.ze-tbcust-tree li > ul')).toMatch(/margin-left:\s*15px/);
  });

  it('has a child list for the indent rule to land on', () => {
    // The text assertion above cannot tell a live selector from a dead one:
    // `.ze-tbcust-tree ul ul` read exactly as well and matched nothing, because
    // `.ze-tbcust-tree` is itself the outer <ul>.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect(tree().querySelectorAll('li > ul').length).toBeGreaterThan(0);
  });

  it('puts a twisty on every row, so a leaf lines up with a group label', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const rows = Array.from(tree().querySelectorAll('.ze-tbcust-row'));
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect(r.querySelector(':scope > .twisty')).not.toBeNull();
  });

  it('labels a tree row with the action’s FriendlyName', () => {
    // Both boxes use `GetFriendlyName()` — `AppendItem( root, toolIter->second
    // ->GetFriendlyName(), … )` (`:526`) and `entry.label = tool->
    // GetFriendlyName()` (`:611`). `toggleGrid` is `common.Control.toggleGrid`,
    // whose FriendlyName is "Show Grid".
    //
    // `toolbarButtonLabel` looked only at `TOOLBAR_ACTIONS[app]` and never at
    // `COMMON_TOOLBAR_ACTIONS`, so every common action fell through to the
    // BUTTON's `title` — a tooltip-ish sentence, not the action's name — and
    // the page read "Toggle grid display" where KiCad reads "Show Grid".
    mount('symbol', SYM_DEFAULT_TOOLBARS);
    const labels = Array.from(tree().querySelectorAll('.ze-tbcust-row')).map((r) =>
      r.textContent?.trim(),
    );
    expect(labels).toContain('Show Grid');
    expect(labels).toContain('Grid Overrides');
    expect(labels).toContain('Show Hidden Pins');
    expect(labels).toContain('Library Tree');
    expect(labels).toContain('Properties');
    // ...and none of the fallback titles it used to show.
    expect(labels).not.toContain('Toggle grid display');
    expect(labels).not.toContain('Show properties manager');
  });

  it('names a CONTROL by its GetUiName, never by its id', () => {
    // `AppendItem( root, controlIter->second->GetUiName(), -1, -1, … )`
    // (`:499`). An untranscribed control falls back to the key, which is how
    // the raw id `bodyStyleSelector` appeared in the action list as its own
    // label — `control.BodyStyleSelector` is "Symbol body style selector"
    // (`action_toolbar.cpp:1268-1270`).
    mount('symbol', SYM_DEFAULT_TOOLBARS);
    const all = document.body.textContent ?? '';
    expect(all).not.toContain('bodyStyleSelector');
    expect(all).toContain('Symbol body style selector');
  });

  it('reserves NO image cell on a row that has no image', () => {
    // Probed on this machine's wx, both controls:
    //
    //   tree  "Show Grid" (image) label x=61   "Separator" (none) label x=33
    //   list  row with image      label x=31   row with none      label x=2
    //
    // `AppendItem( …, -1 )` and a `wxListItem` with no image reserve nothing,
    // so an iconless row's text starts where the image would have. A 24 px
    // spacer stood in for the missing icon, which lined every row up and put
    // "Separator", "Units" and "Crosshair modes" 28 px right of KiCad's.
    expect(CSS, 'the spacer element must be gone').not.toContain('ze-tbcust-noicon');
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const rows = Array.from(tree().querySelectorAll('.ze-tbcust-row'));
    // A GROUP row is the iconless case this toolbar has: `AppendItem( root,
    // item.m_GroupName, -1, -1, … )` (`:536`). It must carry no image and no
    // stand-in for one — twisty and label, nothing between.
    const group = rows.find((r) => r.querySelector(':scope > .twisty.expandable') !== null);
    expect(group, 'the left toolbar has one group').toBeTruthy();
    expect(group?.querySelector('img')).toBeNull();
    expect(group?.children.length).toBe(2);
    // ...and a row that DOES have one still draws it, so this is not "no icons".
    expect(rows.some((r) => r.querySelector('img') !== null)).toBe(true);
  });
});

describe('a group is a tree node, not an unmarked row', () => {
  it('draws an expander on the group and on nothing else', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const open = tree().querySelectorAll('.twisty.expandable');
    // The Drawing Sheet Editor's LEFT toolbar has exactly one group.
    expect(open.length).toBe(1);
    expect(open[0]?.classList.contains('open')).toBe(true);
  });

  it('shuts and reopens the group, as wxTR_HAS_BUTTONS lets it', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const before = treeRows().length;
    const twisty = tree().querySelector('.twisty.expandable') as HTMLElement;

    fireEvent.click(twisty);
    expect(treeRows().length).toBeLessThan(before);
    expect(tree().querySelector('.twisty.expandable')?.classList.contains('open')).toBe(false);

    fireEvent.click(tree().querySelector('.twisty.expandable') as HTMLElement);
    expect(treeRows().length).toBe(before);
  });

  it('does not move the selection when the expander is clicked', () => {
    // The expander is a hit region of the row, not the row: `stopPropagation`.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(tree().querySelector('.twisty.expandable') as HTMLElement);
    expect(tree().querySelectorAll('.ze-tbcust-row.sel')).toHaveLength(0);
  });
});

describe('every control on the page is the app’s own', () => {
  it('has no native <select> and no bare bitmap button', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    // A wxChoice is our Combo; a native <select> paints the browser's chevron
    // and its own popup, which is the one control that would not be ours.
    expect(document.querySelectorAll('select')).toHaveLength(0);
    expect(document.querySelectorAll('.ze-combo')).toHaveLength(1);
    // STD_BITMAP_BUTTON: up, down, delete and the add arrow.
    expect(document.querySelectorAll('.ze-gridbtn')).toHaveLength(4);
  });

  it('builds Insert Separator as SPLIT_BUTTON’s two halves', () => {
    // `OnPaint` calls `DrawPushButton` twice, over `[0, width)` and over
    // `[width - 2, width - 2 + 20)` (split_button.cpp:262-322).
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const split = document.querySelector('.ze-splitbtn');
    expect(split).not.toBeNull();
    expect(split?.querySelectorAll('button')).toHaveLength(2);
    expect(split?.querySelector('.ze-splitbtn-arrow .twisty')).not.toBeNull();
  });

  it('takes the arrow half’s width and its two-pixel overlap from the widget', () => {
    const arrow = rule('.ze-splitbtn-arrow');
    expect(arrow).toMatch(/width:\s*20px/); // m_arrowButtonWidth = FromDIP( 20 )
    expect(arrow).toMatch(/margin-left:\s*-2px/); // r2.x -= 2
    expect(rule('.ze-splitbtn > .ze-btn:first-child')).toMatch(/padding-left:\s*10px/);
  });

  it('opens the two rows the split menu holds', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(screen.getByLabelText('Insert'));
    // `insertMenu->Append( ID_SPACER_MENU, … ); Append( ID_GROUP_MENU, … )`.
    expect(screen.getByText('Insert Spacer')).toBeTruthy();
    expect(screen.getByText('Insert Group')).toBeTruthy();
  });

  it('draws the filter as a wxSearchCtrl, magnifier and cancel', () => {
    // `ShowCancelButton( true )` (`:175`), and GTK draws the magnifier as the
    // entry's own primary icon.
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    const wrap = document.querySelector('.ze-tbcust-filter');
    expect(wrap?.querySelector('.mag')).not.toBeNull();
    // The ✕ appears only once there is something to clear.
    expect(wrap?.querySelector('.cancel')).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'grid' } });
    expect(document.querySelector('.ze-tbcust-filter .cancel')).not.toBeNull();
  });

  it('clears the filter from the cancel button', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.change(screen.getByLabelText('Filter actions'), { target: { value: 'grid' } });
    const before = actionRows().length;
    fireEvent.click(document.querySelector('.ze-tbcust-filter .cancel') as HTMLElement);
    expect((screen.getByLabelText('Filter actions') as HTMLInputElement).value).toBe('');
    expect(actionRows().length).toBeGreaterThan(before);
  });
});
