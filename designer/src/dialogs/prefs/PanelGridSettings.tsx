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
 * **What is still ours rather than KiCad's**, and deliberately: upstream stores
 * a `GRID{ name, x, y }` per row, renders it through `GRID::MessageText` as
 * `"%s%s (%s)"` in both unit systems, and edits it in a `DIALOG_GRID_SETTINGS`
 * modal reached from an Edit button — alongside Move Up and Move Down buttons.
 * Ours stores one unit-bearing string per grid and edits it in place in a text
 * field. That is the shape both settings objects already had; porting
 * `DIALOG_GRID_SETTINGS` and the reorder buttons is separate work and is
 * recorded as such rather than half-done here.
 */
import type { JSX } from 'react';
import { Check, Group, Sel } from './widgets.js';
import {
  GRID_GROUP_TITLES,
  OVERRIDE_ROWS,
  type GridFrameType,
  type GridOverrideKey,
} from './grid_settings_rows.js';

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
  sizes: string[];
  last_size_idx: number;
  fast_grid_1: number;
  fast_grid_2: number;
  overrides_enabled: boolean;
  overrides: Partial<Record<GridOverrideKey, GridOverrideEntry>>;
}

/**
 * The grid a new row starts on. `OnAddGrid` opens `DIALOG_GRID_SETTINGS` on an
 * empty `GRID{ "", "", "" }` (`panel_grid_settings.cpp:250`); with no such
 * dialog here the caller says what an added row should read, because the answer
 * is per-editor — a schematic grid is in mils and a drawing sheet's in mm.
 */
export function PanelGridSettings({
  grid,
  update,
  frameType,
  newGridSize,
  idPrefix,
}: {
  grid: GridSettingsSlice;
  update: (fn: (g: GridSettingsSlice) => void) => void;
  frameType: GridFrameType;
  newGridSize: string;
  /** The current-grid radio group's `name`; see `Radio` in `./widgets.js`. */
  idPrefix: string;
}): JSX.Element {
  const rows = OVERRIDE_ROWS[frameType];
  return (
    <>
      <Group title={GRID_GROUP_TITLES[0]}>
        {grid.sizes.map((size, i) => (
          <div key={i} className="ze-pref-row">
            <input
              type="radio"
              name={`${idPrefix}-cur-grid`}
              checked={grid.last_size_idx === i}
              onChange={() =>
                update((g) => {
                  g.last_size_idx = i;
                })
              }
            />
            <input
              className="ze-search"
              value={size}
              style={{ width: 120 }}
              onChange={(e) =>
                update((g) => {
                  g.sizes[i] = e.target.value;
                })
              }
              onKeyDown={(e) => e.stopPropagation()}
            />
            {/*
              `OnRemoveGrid` returns early on `m_grids.size() <= 1`
              (`panel_grid_settings.cpp:322-325`), so the last grid cannot be
              deleted. Upstream leaves the button live and does nothing; a
              disabled button says the same thing and says it before the click.
            */}
            <button
              className="ze-btn sm"
              title="Remove grid"
              disabled={grid.sizes.length <= 1}
              onClick={() =>
                update((g) => {
                  g.sizes.splice(i, 1);
                  const clamp = (n: number): number => Math.min(n, g.sizes.length - 1);
                  g.last_size_idx = clamp(g.last_size_idx);
                  g.fast_grid_1 = clamp(g.fast_grid_1);
                  g.fast_grid_2 = clamp(g.fast_grid_2);
                })
              }
            >
              −
            </button>
          </div>
        ))}
        <div className="ze-pref-row">
          <button
            className="ze-btn sm"
            onClick={() =>
              update((g) => {
                g.sizes.push(newGridSize);
              })
            }
          >
            + Add grid
          </button>
        </div>
      </Group>
      <Group title={GRID_GROUP_TITLES[1]}>
        <Sel
          label="Grid 1:"
          value={grid.fast_grid_1}
          options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
          onChange={(v) =>
            update((g) => {
              g.fast_grid_1 = v;
            })
          }
        />
        <Sel
          label="Grid 2:"
          value={grid.fast_grid_2}
          options={grid.sizes.map((sz, i) => [i, sz] as [number, string])}
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
