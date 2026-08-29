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
    const choice = screen.getByRole('combobox');
    expect(Array.from(choice.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Left',
      'Right',
      'Top main',
    ]);
  });

  it('lists all four for the board, which has a TOP_AUX', () => {
    mount('pcbnew', PCB_DEFAULT_TOOLBARS);
    const choice = screen.getByRole('combobox');
    expect(Array.from(choice.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'Left',
      'Right',
      'Top main',
      'Top auxiliary',
    ]);
  });

  it('opens on the first toolbar the app has', () => {
    // `m_tbChoice->SetSelection( 0 ); m_currentToolbar = m_toolbarChoices[0];`
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('LEFT');
    expect(treeRows()).toEqual([
      'Show grid',
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TOP_MAIN' } });
    expect(treeRows()).toContain('Separator');
    expect(seen.store.toolbars).toEqual([]);
  });

  it('names a control by ACTION_TOOLBAR_CONTROL::GetUiName, not by its id', () => {
    mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TOP_MAIN' } });
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
    expect(rows).toContain('Show grid');
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
    fireEvent.click(within(tree()).getByText('Show grid'));
    fireEvent.click(screen.getByLabelText('Delete'));

    expect(storedToolbarConfig(seen.store, 'LEFT')).toEqual([
      configFromEntries(DS_LEFT_TOOLBAR)[1],
    ]);
    // The other toolbars are untouched, so they still follow their defaults.
    expect(storedToolbarConfig(seen.store, 'TOP_MAIN')).toBeUndefined();
    expect(treeRows()).not.toContain('Show grid');
  });

  it('Insert Separator inserts after the selection', () => {
    const seen = mount('pl_editor', DS_DEFAULT_TOOLBARS);
    fireEvent.click(within(tree()).getByText('Show grid'));
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TOP_MAIN' } });
    fireEvent.click(within(tree()).getAllByText('Separator')[0] as HTMLElement);
    fireEvent.click(screen.getByLabelText('Delete'));
    expect(
      storedToolbarConfig(seen.store, 'TOP_MAIN')?.some(
        (i) => i.type === 'CONTROL' && i.name === 'originSelector',
      ),
    ).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'LEFT' } });
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
    expect(isDisabled(screen.getByRole('combobox'))).toBe(true);
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
