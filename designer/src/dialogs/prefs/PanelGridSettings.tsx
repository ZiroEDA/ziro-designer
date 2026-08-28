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
import { type JSX, useState } from 'react';
import { Check, Group, Sel } from './widgets.js';
import {
  GRID_GROUP_TITLES,
  OVERRIDE_ROWS,
  type GridFrameType,
  type GridOverrideKey,
} from './grid_settings_rows.js';
import { DialogGridSettings } from '../dialog_grid_settings.js';
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
      <Group title={GRID_GROUP_TITLES[0]}>
        {/*
          `m_currentGridCtrl`, a `wxListBox` (`panel_grid_settings_base.cpp:29`).
          A list box, not a radio group: its selection is BOTH the current grid
          — `gridCfg.last_size_idx = m_currentGridCtrl->GetSelection()` (`:194`)
          — and the row the five buttons act on. `size` makes it a list rather
          than a drop-down, and `multiple` is what makes Safari and Firefox
          honour that; a single selection is still enforced here because
          nothing ever selects two.
        */}
        <select
          // `.ze-search` is the shared entry chrome, so this states no colour
          // and no metric of its own; `.ze-gridlist` is only a handle.
          id={`${idPrefix}-cur-grid`}
          className="ze-search ze-gridlist"
          size={Math.max(4, Math.min(grid.sizes.length, 12))}
          value={String(grid.last_size_idx)}
          onChange={(e) =>
            update((g) => {
              g.last_size_idx = Number(e.target.value);
            })
          }
          onKeyDown={(e) => e.stopPropagation()}
        >
          {grid.sizes.map((size, i) => (
            // The index is the identity here, as it is upstream: two grids can
            // print the same string and `SetSelection` still names one row.
            // biome-ignore lint/suspicious/noArrayIndexKey: the row IS its index
            <option key={i} value={String(i)}>
              {label(size)}
            </option>
          ))}
        </select>
        {/*
          `bSizerGridButtons` (`panel_grid_settings_base.cpp:34-56`): Add, Edit,
          Move Up, Move Down, a 25 px spacer, then Remove. The four enable rules
          are the `OnUpdate*` handlers at `:352-381`; Add has none and is always
          live.
        */}
        <div className="ze-pref-row ze-gridbtns">
          <button
            type="button"
            className="ze-btn sm"
            title="Add grid"
            onClick={() => setOpen({ kind: 'add' })}
          >
            +
          </button>
          <button
            type="button"
            className="ze-btn sm"
            title="Edit grid"
            // `OnUpdateEditGrid`: `event.Enable( GetSelection() >= 0 )`.
            disabled={!(row >= 0 && row < numRows)}
            onClick={() => setOpen({ kind: 'edit', row })}
          >
            ✎
          </button>
          <button
            type="button"
            className="ze-btn sm"
            title="Move grid up"
            // `OnUpdateMoveUp`: `( numRows > 1 ) && ( curRow > 0 )`.
            disabled={!(numRows > 1 && row > 0)}
            onClick={moveUp}
          >
            ▲
          </button>
          <button
            type="button"
            className="ze-btn sm"
            title="Move grid down"
            // `OnUpdateMoveDown`: `( numRows > 1 ) && ( curRow < numRows - 1 )`.
            disabled={!(numRows > 1 && row < numRows - 1)}
            onClick={moveDown}
          >
            ▼
          </button>
          {/*
            `bSizerGridButtons->Add( 25, 0, 0, wxEXPAND, 5 )`
            (`panel_grid_settings_base.cpp:51`) — the gap that pushes Remove
            away from the other four, so a mis-aimed click cannot delete a grid.
          */}
          {/* [data] the 25 of that Add(), a wxSizer spacer KiCad states itself. */}
          <span style={{ width: 25 }} />
          <button
            type="button"
            className="ze-btn sm"
            title="Remove grid"
            // `OnUpdateRemove`: `event.Enable( m_grids.size() > 1 )`.
            disabled={!(numRows > 1)}
            onClick={removeGrid}
          >
            −
          </button>
        </div>
      </Group>
      <Group title={GRID_GROUP_TITLES[1]}>
        <Sel
          label="Grid 1:"
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
          <Check
            label="Enable grid overrides"
            checked={grid.overrides_enabled}
            onChange={(v) =>
              update((g) => {
                g.overrides_enabled = v;
              })
            }
          />
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
          {rows.map(([key, label]) => {
            const entry = grid.overrides[key];
            if (!entry) return null;
            return (
              <div key={key} className="ze-pref-row">
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
                <input
                  className="ze-search"
                  value={entry.size}
                  style={{ width: 100 }}
                  onChange={(e) =>
                    update((g) => {
                      const o = g.overrides[key];
                      if (o) o.size = e.target.value;
                    })
                  }
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </Group>
      )}
    </>
  );
}
