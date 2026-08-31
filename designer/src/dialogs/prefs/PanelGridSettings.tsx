// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_GRID_SETTINGS` — the Grids page, written **once**.
 *
 * Upstream this is `common/dialogs/panel_grid_settings.{h,cpp}`, and it is one
 * class, not one per editor. Every KIFACE constructs the same type and passes
 * its own settings object and its own `FRAME_T`:
 *
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_PL_EDITOR );
 *     (pagelayout_editor/pl_editor.cpp:78)
 *     return new PANEL_GRID_SETTINGS( aParent, this, frame, cfg, FRAME_SCH );
 *     (eeschema/eeschema.cpp, PANEL_SCH_GRIDS)
 *
 * The frame type is not decoration: the constructor
 * (`panel_grid_settings.cpp:53-92`) is nothing but a table of which override
 * rows that frame shows, and how two of them are labelled. That table is
 * {@link OVERRIDE_ROWS} below — KiCad's own data, mirrored, not invented.
 *
 * Ours had a private copy of this page inside `editors/schematic/prefs`, whose
 * own header said "generalising it into a shared base panel every editor can
 * take is follow-up work". This is that follow-up: the schematic's Grids page
 * and the Drawing Sheet Editor's are now two calls to this component, and there
 * is nowhere left for them to drift apart.
 *
 * **The five buttons.** `bSizerGridButtons` (`panel_grid_settings_base.cpp:34-56`)
 * holds Add, Edit, Move Up, Move Down, a 25 px spacer, and Remove — in that
 * order, with Remove pushed away from the rest. Each acts on the SELECTION of
 * `m_currentGridCtrl`, which is also the current-grid list: one control, two
 * jobs, which is why `TransferDataFromWindow` reads `last_size_idx` straight
 * off it (`panel_grid_settings.cpp:194`). Ours had a per-row Remove and an
 * in-place text field, so the list could be extended and trimmed but not
 * reordered, and a grid could not be named.
 *
 * The enable rules are `OnUpdateEditGrid`, `OnUpdateMoveUp`, `OnUpdateMoveDown`
 * and `OnUpdateRemove` (`:352-381`) — wxUpdateUIEvent handlers, so they are
 * evaluated every idle and are properties of the state, not of the last click.
 */
import { Fragment, type JSX, useState } from 'react';
import { Group, Sel } from './widgets.js';
import { Check } from './widgets.js';
import { Combo } from '../../ui/Combo.js';
import { StdBitmapButton } from '../../ui/StdBitmapButton.js';
import {
  GRID_GROUP_TITLES,
  OVERRIDE_ROWS,
  type GridFrameType,
  type GridOverrideKey,
} from './grid_settings_rows.js';
import { DialogGridSettings } from '../dialog_grid_settings.js';
import { HOTKEYS } from '../../editors/schematic/hotkeys.js';
import { MessageDialogError } from '../../ui/dialog_message.js';
import { gridChoiceLabel, gridEquals, type GridEntry } from '../../ui/grid_settings.js';
import type { EdaUnits } from '../../ui/unit_binder.js';
import type { EdaIuScale } from '@ziroeda/common';

/** One `GRID_SETTINGS` override pair — `override_<x>` and `override_<x>_idx`. */
export interface GridOverrideEntry {
  enabled: boolean;
  size: string;
}

/**
 * `APP_SETTINGS_BASE::m_Window.grid`, as much of it as this panel writes —
 * `PANEL_GRID_SETTINGS::TransferDataFromWindow` (`panel_grid_settings.cpp:
 * 186-208`). The appearance keys (`style`, `line_width`, `min_spacing`, `snap`)
 * are `PANEL_GAL_OPTIONS`' and are pointedly absent.
 *
 * `overrides` is partial because which keys exist is the *frame's* business:
 * pl_editor's settings carry only the two rows its page shows.
 */
export interface GridSettingsSlice {
  sizes: GridEntry[];
  last_size_idx: number;
  fast_grid_1: number;
  fast_grid_2: number;
  overrides_enabled: boolean;
  overrides: Partial<Record<GridOverrideKey, GridOverrideEntry>>;
}

/**
 * The Grids page. One component, as `PANEL_GRID_SETTINGS` is one class: what
 * differs between editors arrives as `frameType` and the settings slice, never
 * as a second copy of this file.
 */
/**
 * `GRID{ wxEmptyString, "", "" }` — what `OnAddGrid` opens the dialog on
 * (`panel_grid_settings.cpp:249`). An empty `x` is what makes
 * `DIALOG_GRID_SETTINGS::TransferDataToWindow` fill nothing.
 */
const EMPTY_GRID: GridEntry = { name: '', x: '', y: '' };

/**
 * `_( "Grid size '%s' already exists." )` (`panel_grid_settings.cpp:259-261`
 * and `:296-298`), whose `%s` is `g.UserUnitsMessageText( m_unitsProvider )` —
 * the EXISTING row's text in the user's units, not the one just typed.
 */
const duplicateMessage = (existing: string): string => `Grid size '${existing}' already exists.`;

/** Which modal, if any, the panel has open. */
type OpenDialog =
  /** `OnAddGrid` (`:245`). */
  | { kind: 'add' }
  /** `onEditGrid` (`:275`), on the row at `row`. */
  | { kind: 'edit'; row: number }
  /** `DisplayError` from either of them. */
  | { kind: 'error'; message: string };

export function PanelGridSettings({
  grid,
  update,
  frameType,
  units,
  iuScale,
  idPrefix,
}: {
  /** `m_cfg->m_Window.grid`, the slice this panel writes back. */
  grid: GridSettingsSlice;
  /** Mutate a clone of it — the working copy the shell commits on OK. */
  update: (fn: (g: GridSettingsSlice) => void) => void;
  /**
   * `FRAME_T aFrameType`, the constructor's fifth argument. It selects the
   * Grid Overrides rows and nothing else, exactly as upstream.
   */
  frameType: GridFrameType;
  /**
   * `UNITS_PROVIDER* aUnitsProvider`, the constructor's second argument
   * (`panel_grid_settings.h:40`) — upstream the calling FRAME. It decides the
   * unit each row is printed in (`RebuildGridSizes`, `:130-137`), the unit
   * `DIALOG_GRID_SETTINGS`' two fields read and write, and the unit the
   * duplicate message quotes.
   */
  units: EdaUnits;
  /** `aUnitsProvider->GetIuScale()`, which decides the printed precision. */
  iuScale: EdaIuScale;
  /** The current-grid list's DOM id; see the `<select>` below. */
  idPrefix: string;
}): JSX.Element {
  const rows = OVERRIDE_ROWS[frameType];
  const [open, setOpen] = useState<OpenDialog | null>(null);

  /** `m_currentGridCtrl->GetSelection()`, which every button reads. */
  const row = grid.last_size_idx;
  const numRows = grid.sizes.length;

  /** `GRID::UserUnitsMessageText`, and the `"%s%s (%s)"` of `RebuildGridSizes`. */
  const label = (g: GridEntry): string => gridChoiceLabel(g, units, iuScale.IU_PER_MM, g.name);

  /**
   * `m_grid1HotKey` / `m_grid2HotKey`, filled in from the actions themselves:
   *
   *     int hk1 = ACTIONS::gridFast1.GetHotKey();
   *     m_grid1HotKey->SetLabel( wxString::Format( "(%s)", KeyNameFromKeyCode( hk1 ) ) );
   *     (`panel_grid_settings.cpp:94-98`)
   *
   * So the label is whatever the binding IS, not a string typed here — ours had
   * no third column at all. `HOTKEYS` is the same registry the Hotkeys page
   * lists, so a rebinding shows up on both pages.
   */
  const keyOf = (id: string): string => HOTKEYS.find((h) => h.id === id)?.keys ?? '';
  const fastGrid1Key = keyOf('gridFast1');
  const fastGrid2Key = keyOf('gridFast2');

  /**
   * The grid list, as a `wxChoice`'s options — plus, at the head, whatever the
   * override currently holds if that is not one of the grids. Upstream cannot
   * be in that state (it stores an INDEX into the list, and `safeGrid` clamps
   * it, `panel_grid_settings.cpp:232-243`); ours stores the size string, and a
   * list the stored value is missing from would otherwise show blank.
   */
  const overrideChoices = (current: string): { value: string; label: string }[] => {
    // A grid's X is millimetres with the unit implied (`GridEntry.x`), and an
    // override's size is parsed by `gridSizeToMM`, which reads a bare number as
    // millimetres — so the row's own X IS the value to store.
    const opts = grid.sizes.map((sz) => ({ value: sz.x, label: label(sz) }));
    return opts.some((o) => o.value === current)
      ? opts
      : [{ value: current, label: current }, ...opts];
  };

  /**
   * `RebuildGridSizes` (`:117-181`) for the two Fast Grid choices.
   *
   * It saves each choice's STRING, re-fills the list, and re-selects that
   * string — falling back to `grids.front()` for Grid 1 and `grids.back()` for
   * Grid 2 (`:161-168`). So a grid that moves takes its fast-grid binding with
   * it, where re-using the old index would silently rebind to whatever landed
   * there. The current-grid selection is restored the same way and then
   * overwritten by each handler's explicit `SetSelection`, which is why it is
   * not remapped here.
   *
   * The override choices upstream are indices into the same list; ours store
   * the size STRING itself, so they need no remapping at all.
   */
  const rebuild = (g: GridSettingsSlice, before: readonly GridEntry[]): void => {
    const find = (idx: number, fallback: number): number => {
      const was = before[idx];
      if (!was) return fallback;
      const at = g.sizes.findIndex((c) => label(c) === label(was));
      return at >= 0 ? at : fallback;
    };
    g.fast_grid_1 = find(g.fast_grid_1, 0);
    g.fast_grid_2 = find(g.fast_grid_2, g.sizes.length - 1);
  };

  /** The duplicate scan both `OnAddGrid` and `onEditGrid` run (`:251-264`). */
  const duplicateOf = (candidate: GridEntry, list: readonly GridEntry[]): GridEntry | undefined =>
    list.find((g) => gridEquals(candidate, g));

  /** `OnAddGrid` (`panel_grid_settings.cpp:245-266`). */
  const addGrid = (newGrid: GridEntry): void => {
    const clash = duplicateOf(newGrid, grid.sizes);
    if (clash) {
      setOpen({ kind: 'error', message: duplicateMessage(label(clash)) });
      return;
    }
    update((g) => {
      const before = [...g.sizes];
      // `m_grids.insert( m_grids.begin() + row, newGrid )` — BEFORE the
      // selected row, and the selection index then names the new grid.
      const at = Math.max(0, Math.min(row, g.sizes.length));
      g.sizes.splice(at, 0, newGrid);
      rebuild(g, before);
      g.last_size_idx = at;
    });
    setOpen(null);
  };

  /** `onEditGrid` (`panel_grid_settings.cpp:275-306`). */
  const editGrid = (at: number, edited: GridEntry): void => {
    const current = grid.sizes[at];
    // "If the user just clicked OK without changing anything, then return or
    // we'll trigger the same grid check" (:285-288).
    if (current && gridEquals(edited, current)) {
      setOpen(null);
      return;
    }
    const clash = duplicateOf(edited, grid.sizes);
    if (clash) {
      setOpen({ kind: 'error', message: duplicateMessage(label(clash)) });
      return;
    }
    update((g) => {
      const before = [...g.sizes];
      g.sizes[at] = edited;
      rebuild(g, before);
      g.last_size_idx = at;
    });
    setOpen(null);
  };

  /** `OnRemoveGrid` (`panel_grid_settings.cpp:309-321`). */
  const removeGrid = (): void => {
    if (numRows <= 1) return;
    update((g) => {
      const before = [...g.sizes];
      g.sizes.splice(row, 1);
      rebuild(g, before);
      // `if( row != 0 ) SetSelection( row - 1 )` — removing the first row
      // leaves the selection on index 0, which is now the row beneath it.
      if (row !== 0) g.last_size_idx = row - 1;
    });
  };

  /** `OnMoveGridUp` (`panel_grid_settings.cpp:324-335`). */
  const moveUp = (): void => {
    if (numRows <= 1 || row === 0) return;
    update((g) => {
      const before = [...g.sizes];
      const a = g.sizes[row];
      const b = g.sizes[row - 1];
      if (!a || !b) return;
      g.sizes[row] = b;
      g.sizes[row - 1] = a;
      rebuild(g, before);
      g.last_size_idx = row - 1;
    });
  };

  /** `OnMoveGridDown` (`panel_grid_settings.cpp:338-349`). */
  const moveDown = (): void => {
    if (numRows <= 1 || row === numRows - 1) return;
    update((g) => {
      const before = [...g.sizes];
      const a = g.sizes[row];
      const b = g.sizes[row + 1];
      if (!a || !b) return;
      g.sizes[row] = b;
      g.sizes[row + 1] = a;
      rebuild(g, before);
      // `if( row != 0 ) SetSelection( row + 1 )` — upstream's own guard, and
      // it is asymmetric with the one above: moving the FIRST grid down leaves
      // the selection on index 0, so the selection stops following it. Copied,
      // not corrected: it is the source.
      if (row !== 0) g.last_size_idx = row + 1;
    });
  };

  return (
    <>
      {open?.kind === 'add' && (
        <DialogGridSettings
          grid={EMPTY_GRID}
          units={units}
          iuScale={iuScale}
          onOk={addGrid}
          onCancel={() => setOpen(null)}
        />
      )}
      {open?.kind === 'edit' && grid.sizes[open.row] && (
        <DialogGridSettings
          grid={grid.sizes[open.row]!}
          units={units}
          iuScale={iuScale}
          onOk={(edited) => editGrid(open.row, edited)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open?.kind === 'error' && (
        <MessageDialogError message={open.message} onClose={() => setOpen(null)} />
      )}
      {/* `bSizerColumns` (`panel_grid_settings_base.cpp:20-62`), horizontal:
          the grid list and its buttons on the left, Fast Grid Switching and
          Grid Overrides on the right, with a 16 px spacer between the two
          columns' own 5 px borders. Ours stacked all three groups. */}
      <div className="ze-pref-columns ze-gutter-26 ze-stretch">
        <div>
          {/* `bSizerLeftCol->Add( m_gridsLabel, 0, wxTOP|wxRIGHT|wxLEFT, 5 )`
              (`:27`) and NOTHING after it: this column's heading has no
              `wxStaticLine`, where every other heading on the page does. Ours
              drew one, and at the heading border of 13 rather than 5. */}
          <div className="ze-gridlist-col">
            <div className="ze-pref-group-title ze-noline">{GRID_GROUP_TITLES[0]}</div>
            {/*
              `m_currentGridCtrl`, a `wxListBox` (`panel_grid_settings_base.cpp:29`).
              Its selection is BOTH the current grid —
              `gridCfg.last_size_idx = m_currentGridCtrl->GetSelection()` (`:194`)
              — and the row the five buttons act on.

              NOT a `<select size>`, which is what this was. A native listbox
              paints its selected row in the BROWSER's highlight the moment it
              has focus, and that beats any `option:checked` rule: the row came
              up in KiCad's orange and turned blue on the first click. On GTK a
              wxListBox is a treeview in a scrolled frame, and the Hotkeys page
              already draws one of those as a list of rows; this is the same,
              so the selection is `treeview.view:selected` and the frame is
              `.frame`, both from the theme.
            */}
            <div
              id={`${idPrefix}-cur-grid`}
              className="ze-gridlist"
              role="listbox"
              aria-label={GRID_GROUP_TITLES[0]}
              tabIndex={0}
              onKeyDown={(e) => {
                // A wxListBox moves its selection on the arrow keys; nothing
                // else here is a keystroke the editor behind the dialog should
                // ever see.
                e.stopPropagation();
                if (e.key === 'ArrowDown' && row < numRows - 1) {
                  e.preventDefault();
                  update((g) => {
                    g.last_size_idx = row + 1;
                  });
                } else if (e.key === 'ArrowUp' && row > 0) {
                  e.preventDefault();
                  update((g) => {
                    g.last_size_idx = row - 1;
                  });
                }
              }}
            >
              {grid.sizes.map((size, i) => (
                // The index is the identity here, as it is upstream: two grids
                // can print the same string and `SetSelection` still names one
                // row.
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: the row IS its index
                  key={i}
                  role="option"
                  aria-selected={i === row}
                  className={`ze-gridlist-row${i === row ? ' selected' : ''}`}
                  onMouseDown={() =>
                    update((g) => {
                      g.last_size_idx = i;
                    })
                  }
                  // `OnGridDClick` (`panel_grid_settings.cpp`) opens the editor
                  // on the row that was double-clicked.
                  onDoubleClick={() => setOpen({ kind: 'edit', row: i })}
                >
                  {label(size)}
                </div>
              ))}
            </div>
            {/*
          `bSizerGridButtons` (`panel_grid_settings_base.cpp:34-56`): Add, Edit,
          Move Up, Move Down, a 25 px spacer, then Remove. The four enable rules
          are the `OnUpdate*` handlers at `:352-381`; Add has none and is always
          live.
        */}
            <div className="ze-gridbtns">
              {/* `SetBitmap( KiBitmapBundle( BITMAPS::small_plus / edit / small_up /
              small_down / small_trash ) )` (`panel_grid_settings.cpp:100-104`).
              These are STD_BITMAP_BUTTONs, sized by their bitmap — ours drew
              `+ ✎ ▲ ▼ −` as text on standard-width buttons. */}
              <StdBitmapButton
                bitmap="small_plus"
                title="Add grid"
                onClick={() => setOpen({ kind: 'add' })}
              />
              <StdBitmapButton
                bitmap="edit"
                title="Edit grid"
                // `OnUpdateEditGrid`: `event.Enable( GetSelection() >= 0 )`.
                disabled={!(row >= 0 && row < numRows)}
                onClick={() => setOpen({ kind: 'edit', row })}
              />
              <StdBitmapButton
                bitmap="small_up"
                title="Move grid up"
                // `OnUpdateMoveUp`: `( numRows > 1 ) && ( curRow > 0 )`.
                disabled={!(numRows > 1 && row > 0)}
                onClick={moveUp}
              />
              <StdBitmapButton
                bitmap="small_down"
                title="Move grid down"
                // `OnUpdateMoveDown`: `( numRows > 1 ) && ( curRow < numRows - 1 )`.
                disabled={!(numRows > 1 && row < numRows - 1)}
                onClick={moveDown}
              />
              {/*
            `bSizerGridButtons->Add( 25, 0, 0, wxEXPAND, 5 )`
            (`panel_grid_settings_base.cpp:51`) — the gap that pushes Remove
            away from the other four, so a mis-aimed click cannot delete a grid.
          */}
              {/* [data] the 25 of that Add(), a wxSizer spacer KiCad states itself. */}
              <span style={{ width: 25 }} />
              <StdBitmapButton
                bitmap="small_trash"
                title="Remove grid"
                // `OnUpdateRemove`: `event.Enable( m_grids.size() > 1 )`.
                disabled={!(numRows > 1)}
                onClick={removeGrid}
              />
            </div>
          </div>
        </div>
        <div>
          <Group title={GRID_GROUP_TITLES[1]}>
            {/* `fgSizer3 = new wxFlexGridSizer( 2, 3, 6, 5 )` (`:75`) — three
            columns, the third being `m_grid1HotKey`, a wxStaticText the panel
            fills in with the action's own binding (`panel_grid_settings.cpp:94-98`). */}
            <Sel
              label="Grid 1:"
              unit={`(${fastGrid1Key})`}
              value={grid.fast_grid_1}
              options={grid.sizes.map((sz, i) => [i, label(sz)] as [number, string])}
              onChange={(v) =>
                update((g) => {
                  g.fast_grid_1 = v;
                })
              }
            />
            <Sel
              label="Grid 2:"
              unit={`(${fastGrid2Key})`}
              value={grid.fast_grid_2}
              options={grid.sizes.map((sz, i) => [i, label(sz)] as [number, string])}
              onChange={(v) =>
                update((g) => {
                  g.fast_grid_2 = v;
                })
              }
            />
          </Group>
          {/*
        Gerbview has no Grid Overrides group at all — `m_overridesLabel` and
        `m_staticline3` are hidden along with its last two rows
        (`panel_grid_settings.cpp:82-90`). An empty row table is that frame.
      */}
          {rows.length > 0 && (
            <Group title={GRID_GROUP_TITLES[2]}>
              {/*
            PANEL_GRID_SETTINGS never disables these rows: the label and the
            five checkbox/choice pairs are always live
            (common/dialogs/panel_grid_settings_base.cpp:109-163, and
            panel_grid_settings.cpp only ever calls Show(false) on rows an
            editor has no use for). `overrides_enabled` is not part of that
            panel at all upstream — it is ACTIONS::toggleGridOverrides, on
            the View menu — so greying the rows out when it is off was ours,
            not KiCad's, and it is what made a fresh install show a page of
            dead controls.
          */}
              <div className="ze-gridoverrides">
                {rows.map(([key, label]) => {
                  const entry = grid.overrides[key];
                  if (!entry) return null;
                  return (
                    <Fragment key={key}>
                      <Check
                        label={label}
                        checked={entry.enabled}
                        onChange={(v) =>
                          update((g) => {
                            const e = g.overrides[key];
                            if (e) e.enabled = v;
                          })
                        }
                      />
                      {/* `m_gridOverride*Choice` is a wxChoice over the grid list
                    (`panel_grid_settings_base.cpp:127`, and
                    `panel_grid_settings.cpp:239-243` selects into it by index).
                    Ours was a free text field, which is how a page whose whole
                    point is "pick one of these grids" ended up accepting
                    anything at all. */}
                      <Combo
                        value={entry.size}
                        ariaLabel={label}
                        options={overrideChoices(entry.size)}
                        onChange={(v) =>
                          update((g) => {
                            const o = g.overrides[key];
                            if (o) o.size = v;
                          })
                        }
                      />
                    </Fragment>
                  );
                })}
              </div>
            </Group>
          )}
        </div>
      </div>
    </>
  );
}
